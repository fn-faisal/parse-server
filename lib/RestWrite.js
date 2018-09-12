'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _RestQuery = require('./RestQuery');

var _RestQuery2 = _interopRequireDefault(_RestQuery);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _logger = require('./logger');

var _logger2 = _interopRequireDefault(_logger);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// A RestWrite encapsulates everything we need to run an operation
// that writes to the database.
// This could be either a "create" or an "update".

var SchemaController = require('./Controllers/SchemaController');
var deepcopy = require('deepcopy');

const Auth = require('./Auth');
var cryptoUtils = require('./cryptoUtils');
var passwordCrypto = require('./password');
var Parse = require('parse/node');
var triggers = require('./triggers');
var ClientSDK = require('./ClientSDK');


// query and data are both provided in REST API format. So data
// types are encoded by plain old objects.
// If query is null, this is a "create" and the data in data should be
// created.
// Otherwise this is an "update" - the object matching the query
// should get updated with data.
// RestWrite will handle objectId, createdAt, and updatedAt for
// everything. It also knows to use triggers and special modifications
// for the _User class.
function RestWrite(config, auth, className, query, data, originalData, clientSDK, options) {
  if (auth.isReadOnly) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Cannot perform a write operation when using readOnlyMasterKey');
  }
  this.config = config;
  this.auth = auth;
  this.className = className;
  this.clientSDK = clientSDK;
  this.storage = {};
  this.runOptions = {};
  const allowObjectId = options && options.allowObjectId === true;
  if (!query && data.objectId && !allowObjectId) {
    throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'objectId is an invalid field name.');
  }

  // When the operation is complete, this.response may have several
  // fields.
  // response: the actual data to be returned
  // status: the http status code. if not present, treated like a 200
  // location: the location header. if not present, no location header
  this.response = null;

  // Processing this operation may mutate our data, so we operate on a
  // copy
  this.query = deepcopy(query);
  this.data = deepcopy(data);
  // We never change originalData, so we do not need a deep copy
  this.originalData = originalData;

  // The timestamp we'll use for this whole operation
  this.updatedAt = Parse._encode(new Date()).iso;
}

// A convenient method to perform all the steps of processing the
// write, in order.
// Returns a promise for a {response, status, location} object.
// status and location are optional.
RestWrite.prototype.execute = function () {
  return Promise.resolve().then(() => {
    return this.getUserAndRoleACL();
  }).then(() => {
    return this.validateClientClassCreation();
  }).then(() => {
    return this.handleInstallation();
  }).then(() => {
    return this.handleSession();
  }).then(() => {
    return this.validateAuthData();
  }).then(() => {
    return this.runBeforeTrigger();
  }).then(() => {
    return this.validateSchema();
  }).then(() => {
    return this.setRequiredFieldsIfNeeded();
  }).then(() => {
    return this.transformUser();
  }).then(() => {
    return this.expandFilesForExistingObjects();
  }).then(() => {
    return this.destroyDuplicatedSessions();
  }).then(() => {
    return this.runDatabaseOperation();
  }).then(() => {
    return this.createSessionTokenIfNeeded();
  }).then(() => {
    return this.handleFollowup();
  }).then(() => {
    return this.runAfterTrigger();
  }).then(() => {
    return this.cleanUserAuthData();
  }).then(() => {
    return this.response;
  });
};

// Uses the Auth object to get the list of roles, adds the user id
RestWrite.prototype.getUserAndRoleACL = function () {
  if (this.auth.isMaster) {
    return Promise.resolve();
  }

  this.runOptions.acl = ['*'];

  if (this.auth.user) {
    return this.auth.getUserRoles().then(roles => {
      this.runOptions.acl = this.runOptions.acl.concat(roles, [this.auth.user.id]);
      return;
    });
  } else {
    return Promise.resolve();
  }
};

// Validates this operation against the allowClientClassCreation config.
RestWrite.prototype.validateClientClassCreation = function () {
  if (this.config.allowClientClassCreation === false && !this.auth.isMaster && SchemaController.systemClasses.indexOf(this.className) === -1) {
    return this.config.database.loadSchema().then(schemaController => schemaController.hasClass(this.className)).then(hasClass => {
      if (hasClass !== true) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'This user is not allowed to access ' + 'non-existent class: ' + this.className);
      }
    });
  } else {
    return Promise.resolve();
  }
};

// Validates this operation against the schema.
RestWrite.prototype.validateSchema = function () {
  return this.config.database.validateObject(this.className, this.data, this.query, this.runOptions);
};

// Runs any beforeSave triggers against this operation.
// Any change leads to our data being mutated.
RestWrite.prototype.runBeforeTrigger = function () {
  if (this.response) {
    return;
  }

  // Avoid doing any setup for triggers if there is no 'beforeSave' trigger for this class.
  if (!triggers.triggerExists(this.className, triggers.Types.beforeSave, this.config.applicationId)) {
    return Promise.resolve();
  }

  // Cloud code gets a bit of extra data for its objects
  var extraData = { className: this.className };
  if (this.query && this.query.objectId) {
    extraData.objectId = this.query.objectId;
  }

  let originalObject = null;
  const updatedObject = this.buildUpdatedObject(extraData);
  if (this.query && this.query.objectId) {
    // This is an update for existing object.
    originalObject = triggers.inflate(extraData, this.originalData);
  }

  return Promise.resolve().then(() => {
    return triggers.maybeRunTrigger(triggers.Types.beforeSave, this.auth, updatedObject, originalObject, this.config);
  }).then(response => {
    if (response && response.object) {
      this.storage.fieldsChangedByTrigger = _lodash2.default.reduce(response.object, (result, value, key) => {
        if (!_lodash2.default.isEqual(this.data[key], value)) {
          result.push(key);
        }
        return result;
      }, []);
      this.data = response.object;
      // We should delete the objectId for an update write
      if (this.query && this.query.objectId) {
        delete this.data.objectId;
      }
    }
  });
};

RestWrite.prototype.setRequiredFieldsIfNeeded = function () {
  if (this.data) {
    // Add default fields
    this.data.updatedAt = this.updatedAt;
    if (!this.query) {
      this.data.createdAt = this.updatedAt;

      // Only assign new objectId if we are creating new object
      if (!this.data.objectId) {
        this.data.objectId = cryptoUtils.newObjectId(this.config.objectIdSize);
      }
    }
  }
  return Promise.resolve();
};

// Transforms auth data for a user object.
// Does nothing if this isn't a user object.
// Returns a promise for when we're done if it can't finish this tick.
RestWrite.prototype.validateAuthData = function () {
  if (this.className !== '_User') {
    return;
  }

  if (!this.query && !this.data.authData) {
    if (typeof this.data.username !== 'string' || _lodash2.default.isEmpty(this.data.username)) {
      throw new Parse.Error(Parse.Error.USERNAME_MISSING, 'bad or missing username');
    }
    if (typeof this.data.password !== 'string' || _lodash2.default.isEmpty(this.data.password)) {
      throw new Parse.Error(Parse.Error.PASSWORD_MISSING, 'password is required');
    }
  }

  if (!this.data.authData || !Object.keys(this.data.authData).length) {
    return;
  }

  var authData = this.data.authData;
  var providers = Object.keys(authData);
  if (providers.length > 0) {
    const canHandleAuthData = providers.reduce((canHandle, provider) => {
      var providerAuthData = authData[provider];
      var hasToken = providerAuthData && providerAuthData.id;
      return canHandle && (hasToken || providerAuthData == null);
    }, true);
    if (canHandleAuthData) {
      return this.handleAuthData(authData);
    }
  }
  throw new Parse.Error(Parse.Error.UNSUPPORTED_SERVICE, 'This authentication method is unsupported.');
};

RestWrite.prototype.handleAuthDataValidation = function (authData) {
  const validations = Object.keys(authData).map(provider => {
    if (authData[provider] === null) {
      return Promise.resolve();
    }
    const validateAuthData = this.config.authDataManager.getValidatorForProvider(provider);
    if (!validateAuthData) {
      throw new Parse.Error(Parse.Error.UNSUPPORTED_SERVICE, 'This authentication method is unsupported.');
    }
    return validateAuthData(authData[provider]);
  });
  return Promise.all(validations);
};

RestWrite.prototype.findUsersWithAuthData = function (authData) {
  const providers = Object.keys(authData);
  const query = providers.reduce((memo, provider) => {
    if (!authData[provider]) {
      return memo;
    }
    const queryKey = `authData.${provider}.id`;
    const query = {};
    query[queryKey] = authData[provider].id;
    memo.push(query);
    return memo;
  }, []).filter(q => {
    return typeof q !== 'undefined';
  });

  let findPromise = Promise.resolve([]);
  if (query.length > 0) {
    findPromise = this.config.database.find(this.className, { '$or': query }, {});
  }

  return findPromise;
};

RestWrite.prototype.filteredObjectsByACL = function (objects) {
  if (this.auth.isMaster) {
    return objects;
  }
  return objects.filter(object => {
    if (!object.ACL) {
      return true; // legacy users that have no ACL field on them
    }
    // Regular users that have been locked out.
    return object.ACL && Object.keys(object.ACL).length > 0;
  });
};

RestWrite.prototype.handleAuthData = function (authData) {
  let results;
  return this.findUsersWithAuthData(authData).then(r => {
    results = this.filteredObjectsByACL(r);
    if (results.length > 1) {
      // More than 1 user with the passed id's
      throw new Parse.Error(Parse.Error.ACCOUNT_ALREADY_LINKED, 'this auth is already used');
    }

    this.storage['authProvider'] = Object.keys(authData).join(',');

    if (results.length > 0) {
      const userResult = results[0];
      const mutatedAuthData = {};
      Object.keys(authData).forEach(provider => {
        const providerData = authData[provider];
        const userAuthData = userResult.authData[provider];
        if (!_lodash2.default.isEqual(providerData, userAuthData)) {
          mutatedAuthData[provider] = providerData;
        }
      });
      const hasMutatedAuthData = Object.keys(mutatedAuthData).length !== 0;
      let userId;
      if (this.query && this.query.objectId) {
        userId = this.query.objectId;
      } else if (this.auth && this.auth.user && this.auth.user.id) {
        userId = this.auth.user.id;
      }
      if (!userId || userId === userResult.objectId) {
        // no user making the call
        // OR the user making the call is the right one
        // Login with auth data
        delete results[0].password;

        // need to set the objectId first otherwise location has trailing undefined
        this.data.objectId = userResult.objectId;

        if (!this.query || !this.query.objectId) {
          // this a login call, no userId passed
          this.response = {
            response: userResult,
            location: this.location()
          };
        }
        // If we didn't change the auth data, just keep going
        if (!hasMutatedAuthData) {
          return;
        }
        // We have authData that is updated on login
        // that can happen when token are refreshed,
        // We should update the token and let the user in
        // We should only check the mutated keys
        return this.handleAuthDataValidation(mutatedAuthData).then(() => {
          // IF we have a response, we'll skip the database operation / beforeSave / afterSave etc...
          // we need to set it up there.
          // We are supposed to have a response only on LOGIN with authData, so we skip those
          // If we're not logging in, but just updating the current user, we can safely skip that part
          if (this.response) {
            // Assign the new authData in the response
            Object.keys(mutatedAuthData).forEach(provider => {
              this.response.response.authData[provider] = mutatedAuthData[provider];
            });
            // Run the DB update directly, as 'master'
            // Just update the authData part
            // Then we're good for the user, early exit of sorts
            return this.config.database.update(this.className, { objectId: this.data.objectId }, { authData: mutatedAuthData }, {});
          }
        });
      } else if (userId) {
        // Trying to update auth data but users
        // are different
        if (userResult.objectId !== userId) {
          throw new Parse.Error(Parse.Error.ACCOUNT_ALREADY_LINKED, 'this auth is already used');
        }
        // No auth data was mutated, just keep going
        if (!hasMutatedAuthData) {
          return;
        }
      }
    }
    return this.handleAuthDataValidation(authData);
  });
};

// The non-third-party parts of User transformation
RestWrite.prototype.transformUser = function () {
  var promise = Promise.resolve();

  if (this.className !== '_User') {
    return promise;
  }

  if (!this.auth.isMaster && "emailVerified" in this.data) {
    const error = `Clients aren't allowed to manually update email verification.`;
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, error);
  }

  // Do not cleanup session if objectId is not set
  if (this.query && this.objectId()) {
    // If we're updating a _User object, we need to clear out the cache for that user. Find all their
    // session tokens, and remove them from the cache.
    promise = new _RestQuery2.default(this.config, Auth.master(this.config), '_Session', {
      user: {
        __type: "Pointer",
        className: "_User",
        objectId: this.objectId()
      }
    }).execute().then(results => {
      results.results.forEach(session => this.config.cacheController.user.del(session.sessionToken));
    });
  }

  return promise.then(() => {
    // Transform the password
    if (this.data.password === undefined) {
      // ignore only if undefined. should proceed if empty ('')
      return Promise.resolve();
    }

    if (this.query) {
      this.storage['clearSessions'] = true;
      // Generate a new session only if the user requested
      if (!this.auth.isMaster) {
        this.storage['generateNewSession'] = true;
      }
    }

    return this._validatePasswordPolicy().then(() => {
      return passwordCrypto.hash(this.data.password).then(hashedPassword => {
        this.data._hashed_password = hashedPassword;
        delete this.data.password;
      });
    });
  }).then(() => {
    return this._validateUserName();
  }).then(() => {
    return this._validateEmail();
  });
};

RestWrite.prototype._validateUserName = function () {
  // Check for username uniqueness
  if (!this.data.username) {
    if (!this.query) {
      this.data.username = cryptoUtils.randomString(25);
      this.responseShouldHaveUsername = true;
    }
    return Promise.resolve();
  }
  // We need to a find to check for duplicate username in case they are missing the unique index on usernames
  // TODO: Check if there is a unique index, and if so, skip this query.
  return this.config.database.find(this.className, { username: this.data.username, objectId: { '$ne': this.objectId() } }, { limit: 1 }).then(results => {
    if (results.length > 0) {
      throw new Parse.Error(Parse.Error.USERNAME_TAKEN, 'Account already exists for this username.');
    }
    return;
  });
};

RestWrite.prototype._validateEmail = function () {
  if (!this.data.email || this.data.email.__op === 'Delete') {
    return Promise.resolve();
  }
  // Validate basic email address format
  if (!this.data.email.match(/^.+@.+$/)) {
    return Promise.reject(new Parse.Error(Parse.Error.INVALID_EMAIL_ADDRESS, 'Email address format is invalid.'));
  }
  // Same problem for email as above for username
  return this.config.database.find(this.className, { email: this.data.email, objectId: { '$ne': this.objectId() } }, { limit: 1 }).then(results => {
    if (results.length > 0) {
      throw new Parse.Error(Parse.Error.EMAIL_TAKEN, 'Account already exists for this email address.');
    }
    if (!this.data.authData || !Object.keys(this.data.authData).length || Object.keys(this.data.authData).length === 1 && Object.keys(this.data.authData)[0] === 'anonymous') {
      // We updated the email, send a new validation
      this.storage['sendVerificationEmail'] = true;
      this.config.userController.setEmailVerifyToken(this.data);
    }
  });
};

RestWrite.prototype._validatePasswordPolicy = function () {
  if (!this.config.passwordPolicy) return Promise.resolve();
  return this._validatePasswordRequirements().then(() => {
    return this._validatePasswordHistory();
  });
};

RestWrite.prototype._validatePasswordRequirements = function () {
  // check if the password conforms to the defined password policy if configured
  const policyError = 'Password does not meet the Password Policy requirements.';

  // check whether the password meets the password strength requirements
  if (this.config.passwordPolicy.patternValidator && !this.config.passwordPolicy.patternValidator(this.data.password) || this.config.passwordPolicy.validatorCallback && !this.config.passwordPolicy.validatorCallback(this.data.password)) {
    return Promise.reject(new Parse.Error(Parse.Error.VALIDATION_ERROR, policyError));
  }

  // check whether password contain username
  if (this.config.passwordPolicy.doNotAllowUsername === true) {
    if (this.data.username) {
      // username is not passed during password reset
      if (this.data.password.indexOf(this.data.username) >= 0) return Promise.reject(new Parse.Error(Parse.Error.VALIDATION_ERROR, policyError));
    } else {
      // retrieve the User object using objectId during password reset
      return this.config.database.find('_User', { objectId: this.objectId() }).then(results => {
        if (results.length != 1) {
          throw undefined;
        }
        if (this.data.password.indexOf(results[0].username) >= 0) return Promise.reject(new Parse.Error(Parse.Error.VALIDATION_ERROR, policyError));
        return Promise.resolve();
      });
    }
  }
  return Promise.resolve();
};

RestWrite.prototype._validatePasswordHistory = function () {
  // check whether password is repeating from specified history
  if (this.query && this.config.passwordPolicy.maxPasswordHistory) {
    return this.config.database.find('_User', { objectId: this.objectId() }, { keys: ["_password_history", "_hashed_password"] }).then(results => {
      if (results.length != 1) {
        throw undefined;
      }
      const user = results[0];
      let oldPasswords = [];
      if (user._password_history) oldPasswords = _lodash2.default.take(user._password_history, this.config.passwordPolicy.maxPasswordHistory - 1);
      oldPasswords.push(user.password);
      const newPassword = this.data.password;
      // compare the new password hash with all old password hashes
      const promises = oldPasswords.map(function (hash) {
        return passwordCrypto.compare(newPassword, hash).then(result => {
          if (result) // reject if there is a match
            return Promise.reject("REPEAT_PASSWORD");
          return Promise.resolve();
        });
      });
      // wait for all comparisons to complete
      return Promise.all(promises).then(() => {
        return Promise.resolve();
      }).catch(err => {
        if (err === "REPEAT_PASSWORD") // a match was found
          return Promise.reject(new Parse.Error(Parse.Error.VALIDATION_ERROR, `New password should not be the same as last ${this.config.passwordPolicy.maxPasswordHistory} passwords.`));
        throw err;
      });
    });
  }
  return Promise.resolve();
};

RestWrite.prototype.createSessionTokenIfNeeded = function () {
  if (this.className !== '_User') {
    return;
  }
  if (this.query) {
    return;
  }
  if (!this.storage['authProvider'] // signup call, with
  && this.config.preventLoginWithUnverifiedEmail // no login without verification
  && this.config.verifyUserEmails) {
    // verification is on
    return; // do not create the session token in that case!
  }
  return this.createSessionToken();
};

RestWrite.prototype.createSessionToken = function () {
  // cloud installationId from Cloud Code,
  // never create session tokens from there.
  if (this.auth.installationId && this.auth.installationId === 'cloud') {
    return;
  }

  const {
    sessionData,
    createSession
  } = Auth.createSession(this.config, {
    userId: this.objectId(),
    createdWith: {
      'action': this.storage['authProvider'] ? 'login' : 'signup',
      'authProvider': this.storage['authProvider'] || 'password'
    },
    installationId: this.auth.installationId
  });

  if (this.response && this.response.response) {
    this.response.response.sessionToken = sessionData.sessionToken;
  }

  return createSession();
};

RestWrite.prototype.destroyDuplicatedSessions = function () {
  // Only for _Session, and at creation time
  if (this.className != '_Session' || this.query) {
    return;
  }
  // Destroy the sessions in 'Background'
  const {
    user,
    installationId,
    sessionToken
  } = this.data;
  if (!user || !installationId) {
    return;
  }
  if (!user.objectId) {
    return;
  }
  this.config.database.destroy('_Session', {
    user,
    installationId,
    sessionToken: { '$ne': sessionToken }
  });
};

// Handles any followup logic
RestWrite.prototype.handleFollowup = function () {
  if (this.storage && this.storage['clearSessions'] && this.config.revokeSessionOnPasswordReset) {
    var sessionQuery = {
      user: {
        __type: 'Pointer',
        className: '_User',
        objectId: this.objectId()
      }
    };
    delete this.storage['clearSessions'];
    return this.config.database.destroy('_Session', sessionQuery).then(this.handleFollowup.bind(this));
  }

  if (this.storage && this.storage['generateNewSession']) {
    delete this.storage['generateNewSession'];
    return this.createSessionToken().then(this.handleFollowup.bind(this));
  }

  if (this.storage && this.storage['sendVerificationEmail']) {
    delete this.storage['sendVerificationEmail'];
    // Fire and forget!
    this.config.userController.sendVerificationEmail(this.data);
    return this.handleFollowup.bind(this);
  }
};

// Handles the _Session class specialness.
// Does nothing if this isn't an _Session object.
RestWrite.prototype.handleSession = function () {
  if (this.response || this.className !== '_Session') {
    return;
  }

  if (!this.auth.user && !this.auth.isMaster) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Session token required.');
  }

  // TODO: Verify proper error to throw
  if (this.data.ACL) {
    throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'Cannot set ' + 'ACL on a Session.');
  }

  if (this.query) {
    if (this.data.user && !this.auth.isMaster && this.data.user.objectId != this.auth.user.id) {
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME);
    } else if (this.data.installationId) {
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME);
    } else if (this.data.sessionToken) {
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME);
    }
  }

  if (!this.query && !this.auth.isMaster) {
    const additionalSessionData = {};
    for (var key in this.data) {
      if (key === 'objectId' || key === 'user') {
        continue;
      }
      additionalSessionData[key] = this.data[key];
    }

    const { sessionData, createSession } = Auth.createSession(this.config, {
      userId: this.auth.user.id,
      createdWith: {
        action: 'create'
      },
      additionalSessionData
    });

    return createSession().then(results => {
      if (!results.response) {
        throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'Error creating session.');
      }
      sessionData['objectId'] = results.response['objectId'];
      this.response = {
        status: 201,
        location: results.location,
        response: sessionData
      };
    });
  }
};

// Handles the _Installation class specialness.
// Does nothing if this isn't an installation object.
// If an installation is found, this can mutate this.query and turn a create
// into an update.
// Returns a promise for when we're done if it can't finish this tick.
RestWrite.prototype.handleInstallation = function () {
  if (this.response || this.className !== '_Installation') {
    return;
  }

  if (!this.query && !this.data.deviceToken && !this.data.installationId && !this.auth.installationId) {
    throw new Parse.Error(135, 'at least one ID field (deviceToken, installationId) ' + 'must be specified in this operation');
  }

  // If the device token is 64 characters long, we assume it is for iOS
  // and lowercase it.
  if (this.data.deviceToken && this.data.deviceToken.length == 64) {
    this.data.deviceToken = this.data.deviceToken.toLowerCase();
  }

  // We lowercase the installationId if present
  if (this.data.installationId) {
    this.data.installationId = this.data.installationId.toLowerCase();
  }

  let installationId = this.data.installationId;

  // If data.installationId is not set and we're not master, we can lookup in auth
  if (!installationId && !this.auth.isMaster) {
    installationId = this.auth.installationId;
  }

  if (installationId) {
    installationId = installationId.toLowerCase();
  }

  // Updating _Installation but not updating anything critical
  if (this.query && !this.data.deviceToken && !installationId && !this.data.deviceType) {
    return;
  }

  var promise = Promise.resolve();

  var idMatch; // Will be a match on either objectId or installationId
  var objectIdMatch;
  var installationIdMatch;
  var deviceTokenMatches = [];

  // Instead of issuing 3 reads, let's do it with one OR.
  const orQueries = [];
  if (this.query && this.query.objectId) {
    orQueries.push({
      objectId: this.query.objectId
    });
  }
  if (installationId) {
    orQueries.push({
      'installationId': installationId
    });
  }
  if (this.data.deviceToken) {
    orQueries.push({ 'deviceToken': this.data.deviceToken });
  }

  if (orQueries.length == 0) {
    return;
  }

  promise = promise.then(() => {
    return this.config.database.find('_Installation', {
      '$or': orQueries
    }, {});
  }).then(results => {
    results.forEach(result => {
      if (this.query && this.query.objectId && result.objectId == this.query.objectId) {
        objectIdMatch = result;
      }
      if (result.installationId == installationId) {
        installationIdMatch = result;
      }
      if (result.deviceToken == this.data.deviceToken) {
        deviceTokenMatches.push(result);
      }
    });

    // Sanity checks when running a query
    if (this.query && this.query.objectId) {
      if (!objectIdMatch) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Object not found for update.');
      }
      if (this.data.installationId && objectIdMatch.installationId && this.data.installationId !== objectIdMatch.installationId) {
        throw new Parse.Error(136, 'installationId may not be changed in this ' + 'operation');
      }
      if (this.data.deviceToken && objectIdMatch.deviceToken && this.data.deviceToken !== objectIdMatch.deviceToken && !this.data.installationId && !objectIdMatch.installationId) {
        throw new Parse.Error(136, 'deviceToken may not be changed in this ' + 'operation');
      }
      if (this.data.deviceType && this.data.deviceType && this.data.deviceType !== objectIdMatch.deviceType) {
        throw new Parse.Error(136, 'deviceType may not be changed in this ' + 'operation');
      }
    }

    if (this.query && this.query.objectId && objectIdMatch) {
      idMatch = objectIdMatch;
    }

    if (installationId && installationIdMatch) {
      idMatch = installationIdMatch;
    }
    // need to specify deviceType only if it's new
    if (!this.query && !this.data.deviceType && !idMatch) {
      throw new Parse.Error(135, 'deviceType must be specified in this operation');
    }
  }).then(() => {
    if (!idMatch) {
      if (!deviceTokenMatches.length) {
        return;
      } else if (deviceTokenMatches.length == 1 && (!deviceTokenMatches[0]['installationId'] || !installationId)) {
        // Single match on device token but none on installationId, and either
        // the passed object or the match is missing an installationId, so we
        // can just return the match.
        return deviceTokenMatches[0]['objectId'];
      } else if (!this.data.installationId) {
        throw new Parse.Error(132, 'Must specify installationId when deviceToken ' + 'matches multiple Installation objects');
      } else {
        // Multiple device token matches and we specified an installation ID,
        // or a single match where both the passed and matching objects have
        // an installation ID. Try cleaning out old installations that match
        // the deviceToken, and return nil to signal that a new object should
        // be created.
        var delQuery = {
          'deviceToken': this.data.deviceToken,
          'installationId': {
            '$ne': installationId
          }
        };
        if (this.data.appIdentifier) {
          delQuery['appIdentifier'] = this.data.appIdentifier;
        }
        this.config.database.destroy('_Installation', delQuery).catch(err => {
          if (err.code == Parse.Error.OBJECT_NOT_FOUND) {
            // no deletions were made. Can be ignored.
            return;
          }
          // rethrow the error
          throw err;
        });
        return;
      }
    } else {
      if (deviceTokenMatches.length == 1 && !deviceTokenMatches[0]['installationId']) {
        // Exactly one device token match and it doesn't have an installation
        // ID. This is the one case where we want to merge with the existing
        // object.
        const delQuery = { objectId: idMatch.objectId };
        return this.config.database.destroy('_Installation', delQuery).then(() => {
          return deviceTokenMatches[0]['objectId'];
        }).catch(err => {
          if (err.code == Parse.Error.OBJECT_NOT_FOUND) {
            // no deletions were made. Can be ignored
            return;
          }
          // rethrow the error
          throw err;
        });
      } else {
        if (this.data.deviceToken && idMatch.deviceToken != this.data.deviceToken) {
          // We're setting the device token on an existing installation, so
          // we should try cleaning out old installations that match this
          // device token.
          const delQuery = {
            'deviceToken': this.data.deviceToken
          };
          // We have a unique install Id, use that to preserve
          // the interesting installation
          if (this.data.installationId) {
            delQuery['installationId'] = {
              '$ne': this.data.installationId
            };
          } else if (idMatch.objectId && this.data.objectId && idMatch.objectId == this.data.objectId) {
            // we passed an objectId, preserve that instalation
            delQuery['objectId'] = {
              '$ne': idMatch.objectId
            };
          } else {
            // What to do here? can't really clean up everything...
            return idMatch.objectId;
          }
          if (this.data.appIdentifier) {
            delQuery['appIdentifier'] = this.data.appIdentifier;
          }
          this.config.database.destroy('_Installation', delQuery).catch(err => {
            if (err.code == Parse.Error.OBJECT_NOT_FOUND) {
              // no deletions were made. Can be ignored.
              return;
            }
            // rethrow the error
            throw err;
          });
        }
        // In non-merge scenarios, just return the installation match id
        return idMatch.objectId;
      }
    }
  }).then(objId => {
    if (objId) {
      this.query = { objectId: objId };
      delete this.data.objectId;
      delete this.data.createdAt;
    }
    // TODO: Validate ops (add/remove on channels, $inc on badge, etc.)
  });
  return promise;
};

// If we short-circuted the object response - then we need to make sure we expand all the files,
// since this might not have a query, meaning it won't return the full result back.
// TODO: (nlutsenko) This should die when we move to per-class based controllers on _Session/_User
RestWrite.prototype.expandFilesForExistingObjects = function () {
  // Check whether we have a short-circuited response - only then run expansion.
  if (this.response && this.response.response) {
    this.config.filesController.expandFilesInObject(this.config, this.response.response);
  }
};

RestWrite.prototype.runDatabaseOperation = function () {
  if (this.response) {
    return;
  }

  if (this.className === '_Role') {
    this.config.cacheController.role.clear();
  }

  if (this.className === '_User' && this.query && this.auth.isUnauthenticated()) {
    throw new Parse.Error(Parse.Error.SESSION_MISSING, `Cannot modify user ${this.query.objectId}.`);
  }

  if (this.className === '_Product' && this.data.download) {
    this.data.downloadName = this.data.download.name;
  }

  // TODO: Add better detection for ACL, ensuring a user can't be locked from
  //       their own user record.
  if (this.data.ACL && this.data.ACL['*unresolved']) {
    throw new Parse.Error(Parse.Error.INVALID_ACL, 'Invalid ACL.');
  }

  if (this.query) {
    // Force the user to not lockout
    // Matched with parse.com
    if (this.className === '_User' && this.data.ACL && this.auth.isMaster !== true) {
      this.data.ACL[this.query.objectId] = { read: true, write: true };
    }
    // update password timestamp if user password is being changed
    if (this.className === '_User' && this.data._hashed_password && this.config.passwordPolicy && this.config.passwordPolicy.maxPasswordAge) {
      this.data._password_changed_at = Parse._encode(new Date());
    }
    // Ignore createdAt when update
    delete this.data.createdAt;

    let defer = Promise.resolve();
    // if password history is enabled then save the current password to history
    if (this.className === '_User' && this.data._hashed_password && this.config.passwordPolicy && this.config.passwordPolicy.maxPasswordHistory) {
      defer = this.config.database.find('_User', { objectId: this.objectId() }, { keys: ["_password_history", "_hashed_password"] }).then(results => {
        if (results.length != 1) {
          throw undefined;
        }
        const user = results[0];
        let oldPasswords = [];
        if (user._password_history) {
          oldPasswords = _lodash2.default.take(user._password_history, this.config.passwordPolicy.maxPasswordHistory);
        }
        //n-1 passwords go into history including last password
        while (oldPasswords.length > this.config.passwordPolicy.maxPasswordHistory - 2) {
          oldPasswords.shift();
        }
        oldPasswords.push(user.password);
        this.data._password_history = oldPasswords;
      });
    }

    return defer.then(() => {
      // Run an update
      return this.config.database.update(this.className, this.query, this.data, this.runOptions).then(response => {
        response.updatedAt = this.updatedAt;
        this._updateResponseWithData(response, this.data);
        this.response = { response };
      });
    });
  } else {
    // Set the default ACL and password timestamp for the new _User
    if (this.className === '_User') {
      var ACL = this.data.ACL;
      // default public r/w ACL
      if (!ACL) {
        ACL = {};
        ACL['*'] = { read: true, write: false };
      }
      // make sure the user is not locked down
      ACL[this.data.objectId] = { read: true, write: true };
      this.data.ACL = ACL;
      // password timestamp to be used when password expiry policy is enforced
      if (this.config.passwordPolicy && this.config.passwordPolicy.maxPasswordAge) {
        this.data._password_changed_at = Parse._encode(new Date());
      }
    }

    // Run a create
    return this.config.database.create(this.className, this.data, this.runOptions).catch(error => {
      if (this.className !== '_User' || error.code !== Parse.Error.DUPLICATE_VALUE) {
        throw error;
      }

      // Quick check, if we were able to infer the duplicated field name
      if (error && error.userInfo && error.userInfo.duplicated_field === 'username') {
        throw new Parse.Error(Parse.Error.USERNAME_TAKEN, 'Account already exists for this username.');
      }

      if (error && error.userInfo && error.userInfo.duplicated_field === 'email') {
        throw new Parse.Error(Parse.Error.EMAIL_TAKEN, 'Account already exists for this email address.');
      }

      // If this was a failed user creation due to username or email already taken, we need to
      // check whether it was username or email and return the appropriate error.
      // Fallback to the original method
      // TODO: See if we can later do this without additional queries by using named indexes.
      return this.config.database.find(this.className, { username: this.data.username, objectId: { '$ne': this.objectId() } }, { limit: 1 }).then(results => {
        if (results.length > 0) {
          throw new Parse.Error(Parse.Error.USERNAME_TAKEN, 'Account already exists for this username.');
        }
        return this.config.database.find(this.className, { email: this.data.email, objectId: { '$ne': this.objectId() } }, { limit: 1 });
      }).then(results => {
        if (results.length > 0) {
          throw new Parse.Error(Parse.Error.EMAIL_TAKEN, 'Account already exists for this email address.');
        }
        throw new Parse.Error(Parse.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
      });
    }).then(response => {
      response.objectId = this.data.objectId;
      response.createdAt = this.data.createdAt;

      if (this.responseShouldHaveUsername) {
        response.username = this.data.username;
      }
      this._updateResponseWithData(response, this.data);
      this.response = {
        status: 201,
        response,
        location: this.location()
      };
    });
  }
};

// Returns nothing - doesn't wait for the trigger.
RestWrite.prototype.runAfterTrigger = function () {
  if (!this.response || !this.response.response) {
    return;
  }

  // Avoid doing any setup for triggers if there is no 'afterSave' trigger for this class.
  const hasAfterSaveHook = triggers.triggerExists(this.className, triggers.Types.afterSave, this.config.applicationId);
  const hasLiveQuery = this.config.liveQueryController.hasLiveQuery(this.className);
  if (!hasAfterSaveHook && !hasLiveQuery) {
    return Promise.resolve();
  }

  var extraData = { className: this.className };
  if (this.query && this.query.objectId) {
    extraData.objectId = this.query.objectId;
  }

  // Build the original object, we only do this for a update write.
  let originalObject;
  if (this.query && this.query.objectId) {
    originalObject = triggers.inflate(extraData, this.originalData);
  }

  // Build the inflated object, different from beforeSave, originalData is not empty
  // since developers can change data in the beforeSave.
  const updatedObject = this.buildUpdatedObject(extraData);
  updatedObject._handleSaveResponse(this.response.response, this.response.status || 200);

  // Notifiy LiveQueryServer if possible
  this.config.liveQueryController.onAfterSave(updatedObject.className, updatedObject, originalObject);

  // Run afterSave trigger
  return triggers.maybeRunTrigger(triggers.Types.afterSave, this.auth, updatedObject, originalObject, this.config).catch(function (err) {
    _logger2.default.warn('afterSave caught an error', err);
  });
};

// A helper to figure out what location this operation happens at.
RestWrite.prototype.location = function () {
  var middle = this.className === '_User' ? '/users/' : '/classes/' + this.className + '/';
  return this.config.mount + middle + this.data.objectId;
};

// A helper to get the object id for this operation.
// Because it could be either on the query or on the data
RestWrite.prototype.objectId = function () {
  return this.data.objectId || this.query.objectId;
};

// Returns a copy of the data and delete bad keys (_auth_data, _hashed_password...)
RestWrite.prototype.sanitizedData = function () {
  const data = Object.keys(this.data).reduce((data, key) => {
    // Regexp comes from Parse.Object.prototype.validate
    if (!/^[A-Za-z][0-9A-Za-z_]*$/.test(key)) {
      delete data[key];
    }
    return data;
  }, deepcopy(this.data));
  return Parse._decode(undefined, data);
};

// Returns an updated copy of the object
RestWrite.prototype.buildUpdatedObject = function (extraData) {
  const updatedObject = triggers.inflate(extraData, this.originalData);
  Object.keys(this.data).reduce(function (data, key) {
    if (key.indexOf(".") > 0) {
      // subdocument key with dot notation ('x.y':v => 'x':{'y':v})
      const splittedKey = key.split(".");
      const parentProp = splittedKey[0];
      let parentVal = updatedObject.get(parentProp);
      if (typeof parentVal !== 'object') {
        parentVal = {};
      }
      parentVal[splittedKey[1]] = data[key];
      updatedObject.set(parentProp, parentVal);
      delete data[key];
    }
    return data;
  }, deepcopy(this.data));

  updatedObject.set(this.sanitizedData());
  return updatedObject;
};

RestWrite.prototype.cleanUserAuthData = function () {
  if (this.response && this.response.response && this.className === '_User') {
    const user = this.response.response;
    if (user.authData) {
      Object.keys(user.authData).forEach(provider => {
        if (user.authData[provider] === null) {
          delete user.authData[provider];
        }
      });
      if (Object.keys(user.authData).length == 0) {
        delete user.authData;
      }
    }
  }
};

RestWrite.prototype._updateResponseWithData = function (response, data) {
  if (_lodash2.default.isEmpty(this.storage.fieldsChangedByTrigger)) {
    return response;
  }
  const clientSupportsDelete = ClientSDK.supportsForwardDelete(this.clientSDK);
  this.storage.fieldsChangedByTrigger.forEach(fieldName => {
    const dataValue = data[fieldName];

    if (!response.hasOwnProperty(fieldName)) {
      response[fieldName] = dataValue;
    }

    // Strips operations from responses
    if (response[fieldName] && response[fieldName].__op) {
      delete response[fieldName];
      if (clientSupportsDelete && dataValue.__op == 'Delete') {
        response[fieldName] = dataValue;
      }
    }
  });
  return response;
};

exports.default = RestWrite;

module.exports = RestWrite;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9SZXN0V3JpdGUuanMiXSwibmFtZXMiOlsiU2NoZW1hQ29udHJvbGxlciIsInJlcXVpcmUiLCJkZWVwY29weSIsIkF1dGgiLCJjcnlwdG9VdGlscyIsInBhc3N3b3JkQ3J5cHRvIiwiUGFyc2UiLCJ0cmlnZ2VycyIsIkNsaWVudFNESyIsIlJlc3RXcml0ZSIsImNvbmZpZyIsImF1dGgiLCJjbGFzc05hbWUiLCJxdWVyeSIsImRhdGEiLCJvcmlnaW5hbERhdGEiLCJjbGllbnRTREsiLCJvcHRpb25zIiwiaXNSZWFkT25seSIsIkVycm9yIiwiT1BFUkFUSU9OX0ZPUkJJRERFTiIsInN0b3JhZ2UiLCJydW5PcHRpb25zIiwiYWxsb3dPYmplY3RJZCIsIm9iamVjdElkIiwiSU5WQUxJRF9LRVlfTkFNRSIsInJlc3BvbnNlIiwidXBkYXRlZEF0IiwiX2VuY29kZSIsIkRhdGUiLCJpc28iLCJwcm90b3R5cGUiLCJleGVjdXRlIiwiUHJvbWlzZSIsInJlc29sdmUiLCJ0aGVuIiwiZ2V0VXNlckFuZFJvbGVBQ0wiLCJ2YWxpZGF0ZUNsaWVudENsYXNzQ3JlYXRpb24iLCJoYW5kbGVJbnN0YWxsYXRpb24iLCJoYW5kbGVTZXNzaW9uIiwidmFsaWRhdGVBdXRoRGF0YSIsInJ1bkJlZm9yZVRyaWdnZXIiLCJ2YWxpZGF0ZVNjaGVtYSIsInNldFJlcXVpcmVkRmllbGRzSWZOZWVkZWQiLCJ0cmFuc2Zvcm1Vc2VyIiwiZXhwYW5kRmlsZXNGb3JFeGlzdGluZ09iamVjdHMiLCJkZXN0cm95RHVwbGljYXRlZFNlc3Npb25zIiwicnVuRGF0YWJhc2VPcGVyYXRpb24iLCJjcmVhdGVTZXNzaW9uVG9rZW5JZk5lZWRlZCIsImhhbmRsZUZvbGxvd3VwIiwicnVuQWZ0ZXJUcmlnZ2VyIiwiY2xlYW5Vc2VyQXV0aERhdGEiLCJpc01hc3RlciIsImFjbCIsInVzZXIiLCJnZXRVc2VyUm9sZXMiLCJyb2xlcyIsImNvbmNhdCIsImlkIiwiYWxsb3dDbGllbnRDbGFzc0NyZWF0aW9uIiwic3lzdGVtQ2xhc3NlcyIsImluZGV4T2YiLCJkYXRhYmFzZSIsImxvYWRTY2hlbWEiLCJzY2hlbWFDb250cm9sbGVyIiwiaGFzQ2xhc3MiLCJ2YWxpZGF0ZU9iamVjdCIsInRyaWdnZXJFeGlzdHMiLCJUeXBlcyIsImJlZm9yZVNhdmUiLCJhcHBsaWNhdGlvbklkIiwiZXh0cmFEYXRhIiwib3JpZ2luYWxPYmplY3QiLCJ1cGRhdGVkT2JqZWN0IiwiYnVpbGRVcGRhdGVkT2JqZWN0IiwiaW5mbGF0ZSIsIm1heWJlUnVuVHJpZ2dlciIsIm9iamVjdCIsImZpZWxkc0NoYW5nZWRCeVRyaWdnZXIiLCJfIiwicmVkdWNlIiwicmVzdWx0IiwidmFsdWUiLCJrZXkiLCJpc0VxdWFsIiwicHVzaCIsImNyZWF0ZWRBdCIsIm5ld09iamVjdElkIiwib2JqZWN0SWRTaXplIiwiYXV0aERhdGEiLCJ1c2VybmFtZSIsImlzRW1wdHkiLCJVU0VSTkFNRV9NSVNTSU5HIiwicGFzc3dvcmQiLCJQQVNTV09SRF9NSVNTSU5HIiwiT2JqZWN0Iiwia2V5cyIsImxlbmd0aCIsInByb3ZpZGVycyIsImNhbkhhbmRsZUF1dGhEYXRhIiwiY2FuSGFuZGxlIiwicHJvdmlkZXIiLCJwcm92aWRlckF1dGhEYXRhIiwiaGFzVG9rZW4iLCJoYW5kbGVBdXRoRGF0YSIsIlVOU1VQUE9SVEVEX1NFUlZJQ0UiLCJoYW5kbGVBdXRoRGF0YVZhbGlkYXRpb24iLCJ2YWxpZGF0aW9ucyIsIm1hcCIsImF1dGhEYXRhTWFuYWdlciIsImdldFZhbGlkYXRvckZvclByb3ZpZGVyIiwiYWxsIiwiZmluZFVzZXJzV2l0aEF1dGhEYXRhIiwibWVtbyIsInF1ZXJ5S2V5IiwiZmlsdGVyIiwicSIsImZpbmRQcm9taXNlIiwiZmluZCIsImZpbHRlcmVkT2JqZWN0c0J5QUNMIiwib2JqZWN0cyIsIkFDTCIsInJlc3VsdHMiLCJyIiwiQUNDT1VOVF9BTFJFQURZX0xJTktFRCIsImpvaW4iLCJ1c2VyUmVzdWx0IiwibXV0YXRlZEF1dGhEYXRhIiwiZm9yRWFjaCIsInByb3ZpZGVyRGF0YSIsInVzZXJBdXRoRGF0YSIsImhhc011dGF0ZWRBdXRoRGF0YSIsInVzZXJJZCIsImxvY2F0aW9uIiwidXBkYXRlIiwicHJvbWlzZSIsImVycm9yIiwiUmVzdFF1ZXJ5IiwibWFzdGVyIiwiX190eXBlIiwic2Vzc2lvbiIsImNhY2hlQ29udHJvbGxlciIsImRlbCIsInNlc3Npb25Ub2tlbiIsInVuZGVmaW5lZCIsIl92YWxpZGF0ZVBhc3N3b3JkUG9saWN5IiwiaGFzaCIsImhhc2hlZFBhc3N3b3JkIiwiX2hhc2hlZF9wYXNzd29yZCIsIl92YWxpZGF0ZVVzZXJOYW1lIiwiX3ZhbGlkYXRlRW1haWwiLCJyYW5kb21TdHJpbmciLCJyZXNwb25zZVNob3VsZEhhdmVVc2VybmFtZSIsImxpbWl0IiwiVVNFUk5BTUVfVEFLRU4iLCJlbWFpbCIsIl9fb3AiLCJtYXRjaCIsInJlamVjdCIsIklOVkFMSURfRU1BSUxfQUREUkVTUyIsIkVNQUlMX1RBS0VOIiwidXNlckNvbnRyb2xsZXIiLCJzZXRFbWFpbFZlcmlmeVRva2VuIiwicGFzc3dvcmRQb2xpY3kiLCJfdmFsaWRhdGVQYXNzd29yZFJlcXVpcmVtZW50cyIsIl92YWxpZGF0ZVBhc3N3b3JkSGlzdG9yeSIsInBvbGljeUVycm9yIiwicGF0dGVyblZhbGlkYXRvciIsInZhbGlkYXRvckNhbGxiYWNrIiwiVkFMSURBVElPTl9FUlJPUiIsImRvTm90QWxsb3dVc2VybmFtZSIsIm1heFBhc3N3b3JkSGlzdG9yeSIsIm9sZFBhc3N3b3JkcyIsIl9wYXNzd29yZF9oaXN0b3J5IiwidGFrZSIsIm5ld1Bhc3N3b3JkIiwicHJvbWlzZXMiLCJjb21wYXJlIiwiY2F0Y2giLCJlcnIiLCJwcmV2ZW50TG9naW5XaXRoVW52ZXJpZmllZEVtYWlsIiwidmVyaWZ5VXNlckVtYWlscyIsImNyZWF0ZVNlc3Npb25Ub2tlbiIsImluc3RhbGxhdGlvbklkIiwic2Vzc2lvbkRhdGEiLCJjcmVhdGVTZXNzaW9uIiwiY3JlYXRlZFdpdGgiLCJkZXN0cm95IiwicmV2b2tlU2Vzc2lvbk9uUGFzc3dvcmRSZXNldCIsInNlc3Npb25RdWVyeSIsImJpbmQiLCJzZW5kVmVyaWZpY2F0aW9uRW1haWwiLCJJTlZBTElEX1NFU1NJT05fVE9LRU4iLCJhZGRpdGlvbmFsU2Vzc2lvbkRhdGEiLCJhY3Rpb24iLCJJTlRFUk5BTF9TRVJWRVJfRVJST1IiLCJzdGF0dXMiLCJkZXZpY2VUb2tlbiIsInRvTG93ZXJDYXNlIiwiZGV2aWNlVHlwZSIsImlkTWF0Y2giLCJvYmplY3RJZE1hdGNoIiwiaW5zdGFsbGF0aW9uSWRNYXRjaCIsImRldmljZVRva2VuTWF0Y2hlcyIsIm9yUXVlcmllcyIsIk9CSkVDVF9OT1RfRk9VTkQiLCJkZWxRdWVyeSIsImFwcElkZW50aWZpZXIiLCJjb2RlIiwib2JqSWQiLCJmaWxlc0NvbnRyb2xsZXIiLCJleHBhbmRGaWxlc0luT2JqZWN0Iiwicm9sZSIsImNsZWFyIiwiaXNVbmF1dGhlbnRpY2F0ZWQiLCJTRVNTSU9OX01JU1NJTkciLCJkb3dubG9hZCIsImRvd25sb2FkTmFtZSIsIm5hbWUiLCJJTlZBTElEX0FDTCIsInJlYWQiLCJ3cml0ZSIsIm1heFBhc3N3b3JkQWdlIiwiX3Bhc3N3b3JkX2NoYW5nZWRfYXQiLCJkZWZlciIsInNoaWZ0IiwiX3VwZGF0ZVJlc3BvbnNlV2l0aERhdGEiLCJjcmVhdGUiLCJEVVBMSUNBVEVfVkFMVUUiLCJ1c2VySW5mbyIsImR1cGxpY2F0ZWRfZmllbGQiLCJoYXNBZnRlclNhdmVIb29rIiwiYWZ0ZXJTYXZlIiwiaGFzTGl2ZVF1ZXJ5IiwibGl2ZVF1ZXJ5Q29udHJvbGxlciIsIl9oYW5kbGVTYXZlUmVzcG9uc2UiLCJvbkFmdGVyU2F2ZSIsImxvZ2dlciIsIndhcm4iLCJtaWRkbGUiLCJtb3VudCIsInNhbml0aXplZERhdGEiLCJ0ZXN0IiwiX2RlY29kZSIsInNwbGl0dGVkS2V5Iiwic3BsaXQiLCJwYXJlbnRQcm9wIiwicGFyZW50VmFsIiwiZ2V0Iiwic2V0IiwiY2xpZW50U3VwcG9ydHNEZWxldGUiLCJzdXBwb3J0c0ZvcndhcmREZWxldGUiLCJmaWVsZE5hbWUiLCJkYXRhVmFsdWUiLCJoYXNPd25Qcm9wZXJ0eSIsIm1vZHVsZSIsImV4cG9ydHMiXSwibWFwcGluZ3MiOiI7Ozs7OztBQWFBOzs7O0FBQ0E7Ozs7QUFDQTs7Ozs7O0FBZkE7QUFDQTtBQUNBOztBQUVBLElBQUlBLG1CQUFtQkMsUUFBUSxnQ0FBUixDQUF2QjtBQUNBLElBQUlDLFdBQVdELFFBQVEsVUFBUixDQUFmOztBQUVBLE1BQU1FLE9BQU9GLFFBQVEsUUFBUixDQUFiO0FBQ0EsSUFBSUcsY0FBY0gsUUFBUSxlQUFSLENBQWxCO0FBQ0EsSUFBSUksaUJBQWlCSixRQUFRLFlBQVIsQ0FBckI7QUFDQSxJQUFJSyxRQUFRTCxRQUFRLFlBQVIsQ0FBWjtBQUNBLElBQUlNLFdBQVdOLFFBQVEsWUFBUixDQUFmO0FBQ0EsSUFBSU8sWUFBWVAsUUFBUSxhQUFSLENBQWhCOzs7QUFLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxTQUFTUSxTQUFULENBQW1CQyxNQUFuQixFQUEyQkMsSUFBM0IsRUFBaUNDLFNBQWpDLEVBQTRDQyxLQUE1QyxFQUFtREMsSUFBbkQsRUFBeURDLFlBQXpELEVBQXVFQyxTQUF2RSxFQUFrRkMsT0FBbEYsRUFBMkY7QUFDekYsTUFBSU4sS0FBS08sVUFBVCxFQUFxQjtBQUNuQixVQUFNLElBQUlaLE1BQU1hLEtBQVYsQ0FBZ0JiLE1BQU1hLEtBQU4sQ0FBWUMsbUJBQTVCLEVBQWlELCtEQUFqRCxDQUFOO0FBQ0Q7QUFDRCxPQUFLVixNQUFMLEdBQWNBLE1BQWQ7QUFDQSxPQUFLQyxJQUFMLEdBQVlBLElBQVo7QUFDQSxPQUFLQyxTQUFMLEdBQWlCQSxTQUFqQjtBQUNBLE9BQUtJLFNBQUwsR0FBaUJBLFNBQWpCO0FBQ0EsT0FBS0ssT0FBTCxHQUFlLEVBQWY7QUFDQSxPQUFLQyxVQUFMLEdBQWtCLEVBQWxCO0FBQ0EsUUFBTUMsZ0JBQWdCTixXQUFXQSxRQUFRTSxhQUFSLEtB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O0FBQ0EsT0FBS0ssT0FBTCxDQUFheUQsc0JBQWIsQ0FBb0NrRCxPQUFwQyxDQUE0QzRILGFBQWE7QUFDdkQsVUFBTUMsWUFBWS9PLEtBQUs4TyxTQUFMLENBQWxCOztBQUVBLFFBQUcsQ0FBQ2xPLFNBQVNvTyxjQUFULENBQXdCRixTQUF4QixDQUFKLEVBQXdDO0FBQ3RDbE8sZUFBU2tPLFNBQVQsSUFBc0JDLFNBQXRCO0FBQ0Q7O0FBRUQ7QUFDQSxRQUFJbk8sU0FBU2tPLFNBQVQsS0FBdUJsTyxTQUFTa08sU0FBVCxFQUFvQmhHLElBQS9DLEVBQXFEO0FBQ25ELGFBQU9sSSxTQUFTa08sU0FBVCxDQUFQO0FBQ0EsVUFBSUYsd0JBQXdCRyxVQUFVakcsSUFBVixJQUFrQixRQUE5QyxFQUF3RDtBQUN0RGxJLGlCQUFTa08sU0FBVCxJQUFzQkMsU0FBdEI7QUFDRDtBQUNGO0FBQ0YsR0FkRDtBQWVBLFNBQU9uTyxRQUFQO0FBQ0QsQ0FyQkQ7O2tCQXVCZWpCLFM7O0FBQ2ZzUCxPQUFPQyxPQUFQLEdBQWlCdlAsU0FBakIiLCJmaWxlIjoiUmVzdFdyaXRlLmpzIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQSBSZXN0V3JpdGUgZW5jYXBzdWxhdGVzIGV2ZXJ5dGhpbmcgd2UgbmVlZCB0byBydW4gYW4gb3BlcmF0aW9uXG4vLyB0aGF0IHdyaXRlcyB0byB0aGUgZGF0YWJhc2UuXG4vLyBUaGlzIGNvdWxkIGJlIGVpdGhlciBhIFwiY3JlYXRlXCIgb3IgYW4gXCJ1cGRhdGVcIi5cblxudmFyIFNjaGVtYUNvbnRyb2xsZXIgPSByZXF1aXJlKCcuL0NvbnRyb2xsZXJzL1NjaGVtYUNvbnRyb2xsZXInKTtcbnZhciBkZWVwY29weSA9IHJlcXVpcmUoJ2RlZXBjb3B5Jyk7XG5cbmNvbnN0IEF1dGggPSByZXF1aXJlKCcuL0F1dGgnKTtcbnZhciBjcnlwdG9VdGlscyA9IHJlcXVpcmUoJy4vY3J5cHRvVXRpbHMnKTtcbnZhciBwYXNzd29yZENyeXB0byA9IHJlcXVpcmUoJy4vcGFzc3dvcmQnKTtcbnZhciBQYXJzZSA9IHJlcXVpcmUoJ3BhcnNlL25vZGUnKTtcbnZhciB0cmlnZ2VycyA9IHJlcXVpcmUoJy4vdHJpZ2dlcnMnKTtcbnZhciBDbGllbnRTREsgPSByZXF1aXJlKCcuL0NsaWVudFNESycpO1xuaW1wb3J0IFJlc3RRdWVyeSBmcm9tICcuL1Jlc3RRdWVyeSc7XG5pbXBvcnQgXyAgICAgICAgIGZyb20gJ2xvZGFzaCc7XG5pbXBvcnQgbG9nZ2VyICAgIGZyb20gJy4vbG9nZ2VyJztcblxuLy8gcXVlcnkgYW5kIGRhdGEgYXJlIGJvdGggcHJvdmlkZWQgaW4gUkVTVCBBUEkgZm9ybWF0LiBTbyBkYXRhXG4vLyB0eXBlcyBhcmUgZW5jb2RlZCBieSBwbGFpbiBvbGQgb2JqZWN0cy5cbi8vIElmIHF1ZXJ5IGlzIG51bGwsIHRoaXMgaXMgYSBcImNyZWF0ZVwiIGFuZCB0aGUgZGF0YSBpbiBkYXRhIHNob3VsZCBiZVxuLy8gY3JlYXRlZC5cbi8vIE90aGVyd2lzZSB0aGlzIGlzIGFuIFwidXBkYXRlXCIgLSB0aGUgb2JqZWN0IG1hdGNoaW5nIHRoZSBxdWVyeVxuLy8gc2hvdWxkIGdldCB1cGRhdGVkIHdpdGggZGF0YS5cbi8vIFJlc3RXcml0ZSB3aWxsIGhhbmRsZSBvYmplY3RJZCwgY3JlYXRlZEF0LCBhbmQgdXBkYXRlZEF0IGZvclxuLy8gZXZlcnl0aGluZy4gSXQgYWxzbyBrbm93cyB0byB1c2UgdHJpZ2dlcnMgYW5kIHNwZWNpYWwgbW9kaWZpY2F0aW9uc1xuLy8gZm9yIHRoZSBfVXNlciBjbGFzcy5cbmZ1bmN0aW9uIFJlc3RXcml0ZShjb25maWcsIGF1dGgsIGNsYXNzTmFtZSwgcXVlcnksIGRhdGEsIG9yaWdpbmFsRGF0YSwgY2xpZW50U0RLLCBvcHRpb25zKSB7XG4gIGlmIChhdXRoLmlzUmVhZE9ubHkpIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTiwgJ0Nhbm5vdCBwZXJmb3JtIGEgd3JpdGUgb3BlcmF0aW9uIHdoZW4gdXNpbmcgcmVhZE9ubHlNYXN0ZXJLZXknKTtcbiAgfVxuICB0aGlzLmNvbmZpZyA9IGNvbmZpZztcbiAgdGhpcy5hdXRoID0gYXV0aDtcbiAgdGhpcy5jbGFzc05hbWUgPSBjbGFzc05hbWU7XG4gIHRoaXMuY2xpZW50U0RLID0gY2xpZW50U0RLO1xuICB0aGlzLnN0b3JhZ2UgPSB7fTtcbiAgdGhpcy5ydW5PcHRpb25zID0ge307XG4gIGNvbnN0IGFsbG93T2JqZWN0SWQgPSBvcHRpb25zICYmIG9wdGlvbnMuYWxsb3dPYmplY3RJZCA9PT0gdHJ1ZTtcbiAgaWYgKCFxdWVyeSAmJiBkYXRhLm9iamVjdElkICYmICFhbGxvd09iamVjdElkKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUsICdvYmplY3RJZCBpcyBhbiBpbnZhbGlkIGZpZWxkIG5hbWUuJyk7XG4gIH1cblxuICAvLyBXaGVuIHRoZSBvcGVyYXRpb24gaXMgY29tcGxldGUsIHRoaXMucmVzcG9uc2UgbWF5IGhhdmUgc2V2ZXJhbFxuICAvLyBmaWVsZHMuXG4gIC8vIHJlc3BvbnNlOiB0aGUgYWN0dWFsIGRhdGEgdG8gYmUgcmV0dXJuZWRcbiAgLy8gc3RhdHVzOiB0aGUgaHR0cCBzdGF0dXMgY29kZS4gaWYgbm90IHByZXNlbnQsIHRyZWF0ZWQgbGlrZSBhIDIwMFxuICAvLyBsb2NhdGlvbjogdGhlIGxvY2F0aW9uIGhlYWRlci4gaWYgbm90IHByZXNlbnQsIG5vIGxvY2F0aW9uIGhlYWRlclxuICB0aGlzLnJlc3BvbnNlID0gbnVsbDtcblxuICAvLyBQcm9jZXNzaW5nIHRoaXMgb3BlcmF0aW9uIG1heSBtdXRhdGUgb3VyIGRhdGEsIHNvIHdlIG9wZXJhdGUgb24gYVxuICAvLyBjb3B5XG4gIHRoaXMucXVlcnkgPSBkZWVwY29weShxdWVyeSk7XG4gIHRoaXMuZGF0YSA9IGRlZXBjb3B5KGRhdGEpO1xuICAvLyBXZSBuZXZlciBjaGFuZ2Ugb3JpZ2luYWxEYXRhLCBzbyB3ZSBkbyBub3QgbmVlZCBhIGRlZXAgY29weVxuICB0aGlzLm9yaWdpbmFsRGF0YSA9IG9yaWdpbmFsRGF0YTtcblxuICAvLyBUaGUgdGltZXN0YW1wIHdlJ2xsIHVzZSBmb3IgdGhpcyB3aG9sZSBvcGVyYXRpb25cbiAgdGhpcy51cGRhdGVkQXQgPSBQYXJzZS5fZW5jb2RlKG5ldyBEYXRlKCkpLmlzbztcbn1cblxuLy8gQSBjb252ZW5pZW50IG1ldGhvZCB0byBwZXJmb3JtIGFsbCB0aGUgc3RlcHMgb2YgcHJvY2Vzc2luZyB0aGVcbi8vIHdyaXRlLCBpbiBvcmRlci5cbi8vIFJldHVybnMgYSBwcm9taXNlIGZvciBhIHtyZXNwb25zZSwgc3RhdHVzLCBsb2NhdGlvbn0gb2JqZWN0LlxuLy8gc3RhdHVzIGFuZCBsb2NhdGlvbiBhcmUgb3B0aW9uYWwuXG5SZXN0V3JpdGUucHJvdG90eXBlLmV4ZWN1dGUgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLmdldFVzZXJBbmRSb2xlQUNMKCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLnZhbGlkYXRlQ2xpZW50Q2xhc3NDcmVhdGlvbigpO1xuICB9KS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5oYW5kbGVJbnN0YWxsYXRpb24oKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMuaGFuZGxlU2Vzc2lvbigpO1xuICB9KS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy52YWxpZGF0ZUF1dGhEYXRhKCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLnJ1bkJlZm9yZVRyaWdnZXIoKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMudmFsaWRhdGVTY2hlbWEoKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMuc2V0UmVxdWlyZWRGaWVsZHNJZk5lZWRlZCgpO1xuICB9KS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy50cmFuc2Zvcm1Vc2VyKCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLmV4cGFuZEZpbGVzRm9yRXhpc3RpbmdPYmplY3RzKCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLmRlc3Ryb3lEdXBsaWNhdGVkU2Vzc2lvbnMoKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMucnVuRGF0YWJhc2VPcGVyYXRpb24oKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMuY3JlYXRlU2Vzc2lvblRva2VuSWZOZWVkZWQoKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMuaGFuZGxlRm9sbG93dXAoKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMucnVuQWZ0ZXJUcmlnZ2VyKCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLmNsZWFuVXNlckF1dGhEYXRhKCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLnJlc3BvbnNlO1xuICB9KVxufTtcblxuLy8gVXNlcyB0aGUgQXV0aCBvYmplY3QgdG8gZ2V0IHRoZSBsaXN0IG9mIHJvbGVzLCBhZGRzIHRoZSB1c2VyIGlkXG5SZXN0V3JpdGUucHJvdG90eXBlLmdldFVzZXJBbmRSb2xlQUNMID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLmF1dGguaXNNYXN0ZXIpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICB0aGlzLnJ1bk9wdGlvbnMuYWNsID0gWycqJ107XG5cbiAgaWYgKHRoaXMuYXV0aC51c2VyKSB7XG4gICAgcmV0dXJuIHRoaXMuYXV0aC5nZXRVc2VyUm9sZXMoKS50aGVuKChyb2xlcykgPT4ge1xuICAgICAgdGhpcy5ydW5PcHRpb25zLmFjbCA9IHRoaXMucnVuT3B0aW9ucy5hY2wuY29uY2F0KHJvbGVzLCBbdGhpcy5hdXRoLnVzZXIuaWRdKTtcbiAgICAgIHJldHVybjtcbiAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cbn07XG5cbi8vIFZhbGlkYXRlcyB0aGlzIG9wZXJhdGlvbiBhZ2FpbnN0IHRoZSBhbGxvd0NsaWVudENsYXNzQ3JlYXRpb24gY29uZmlnLlxuUmVzdFdyaXRlLnByb3RvdHlwZS52YWxpZGF0ZUNsaWVudENsYXNzQ3JlYXRpb24gPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMuY29uZmlnLmFsbG93Q2xpZW50Q2xhc3NDcmVhdGlvbiA9PT0gZmFsc2UgJiYgIXRoaXMuYXV0aC5pc01hc3RlclxuICAgICAgJiYgU2NoZW1hQ29udHJvbGxlci5zeXN0ZW1DbGFzc2VzLmluZGV4T2YodGhpcy5jbGFzc05hbWUpID09PSAtMSkge1xuICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZS5sb2FkU2NoZW1hKClcbiAgICAgIC50aGVuKHNjaGVtYUNvbnRyb2xsZXIgPT4gc2NoZW1hQ29udHJvbGxlci5oYXNDbGFzcyh0aGlzLmNsYXNzTmFtZSkpXG4gICAgICAudGhlbihoYXNDbGFzcyA9PiB7XG4gICAgICAgIGlmIChoYXNDbGFzcyAhPT0gdHJ1ZSkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PUEVSQVRJT05fRk9SQklEREVOLFxuICAgICAgICAgICAgJ1RoaXMgdXNlciBpcyBub3QgYWxsb3dlZCB0byBhY2Nlc3MgJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdub24tZXhpc3RlbnQgY2xhc3M6ICcgKyB0aGlzLmNsYXNzTmFtZSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxufTtcblxuLy8gVmFsaWRhdGVzIHRoaXMgb3BlcmF0aW9uIGFnYWluc3QgdGhlIHNjaGVtYS5cblJlc3RXcml0ZS5wcm90b3R5cGUudmFsaWRhdGVTY2hlbWEgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlLnZhbGlkYXRlT2JqZWN0KHRoaXMuY2xhc3NOYW1lLCB0aGlzLmRhdGEsIHRoaXMucXVlcnksIHRoaXMucnVuT3B0aW9ucyk7XG59O1xuXG4vLyBSdW5zIGFueSBiZWZvcmVTYXZlIHRyaWdnZXJzIGFnYWluc3QgdGhpcyBvcGVyYXRpb24uXG4vLyBBbnkgY2hhbmdlIGxlYWRzIHRvIG91ciBkYXRhIGJlaW5nIG11dGF0ZWQuXG5SZXN0V3JpdGUucHJvdG90eXBlLnJ1bkJlZm9yZVRyaWdnZXIgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMucmVzcG9uc2UpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBBdm9pZCBkb2luZyBhbnkgc2V0dXAgZm9yIHRyaWdnZXJzIGlmIHRoZXJlIGlzIG5vICdiZWZvcmVTYXZlJyB0cmlnZ2VyIGZvciB0aGlzIGNsYXNzLlxuICBpZiAoIXRyaWdnZXJzLnRyaWdnZXJFeGlzdHModGhpcy5jbGFzc05hbWUsIHRyaWdnZXJzLlR5cGVzLmJlZm9yZVNhdmUsIHRoaXMuY29uZmlnLmFwcGxpY2F0aW9uSWQpKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgLy8gQ2xvdWQgY29kZSBnZXRzIGEgYml0IG9mIGV4dHJhIGRhdGEgZm9yIGl0cyBvYmplY3RzXG4gIHZhciBleHRyYURhdGEgPSB7Y2xhc3NOYW1lOiB0aGlzLmNsYXNzTmFtZX07XG4gIGlmICh0aGlzLnF1ZXJ5ICYmIHRoaXMucXVlcnkub2JqZWN0SWQpIHtcbiAgICBleHRyYURhdGEub2JqZWN0SWQgPSB0aGlzLnF1ZXJ5Lm9iamVjdElkO1xuICB9XG5cbiAgbGV0IG9yaWdpbmFsT2JqZWN0ID0gbnVsbDtcbiAgY29uc3QgdXBkYXRlZE9iamVjdCA9IHRoaXMuYnVpbGRVcGRhdGVkT2JqZWN0KGV4dHJhRGF0YSk7XG4gIGlmICh0aGlzLnF1ZXJ5ICYmIHRoaXMucXVlcnkub2JqZWN0SWQpIHtcbiAgICAvLyBUaGlzIGlzIGFuIHVwZGF0ZSBmb3IgZXhpc3Rpbmcgb2JqZWN0LlxuICAgIG9yaWdpbmFsT2JqZWN0ID0gdHJpZ2dlcnMuaW5mbGF0ZShleHRyYURhdGEsIHRoaXMub3JpZ2luYWxEYXRhKTtcbiAgfVxuXG4gIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdHJpZ2dlcnMubWF5YmVSdW5UcmlnZ2VyKHRyaWdnZXJzLlR5cGVzLmJlZm9yZVNhdmUsIHRoaXMuYXV0aCwgdXBkYXRlZE9iamVjdCwgb3JpZ2luYWxPYmplY3QsIHRoaXMuY29uZmlnKTtcbiAgfSkudGhlbigocmVzcG9uc2UpID0+IHtcbiAgICBpZiAocmVzcG9uc2UgJiYgcmVzcG9uc2Uub2JqZWN0KSB7XG4gICAgICB0aGlzLnN0b3JhZ2UuZmllbGRzQ2hhbmdlZEJ5VHJpZ2dlciA9IF8ucmVkdWNlKHJlc3BvbnNlLm9iamVjdCwgKHJlc3VsdCwgdmFsdWUsIGtleSkgPT4ge1xuICAgICAgICBpZiAoIV8uaXNFcXVhbCh0aGlzLmRhdGFba2V5XSwgdmFsdWUpKSB7XG4gICAgICAgICAgcmVzdWx0LnB1c2goa2V5KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgfSwgW10pO1xuICAgICAgdGhpcy5kYXRhID0gcmVzcG9uc2Uub2JqZWN0O1xuICAgICAgLy8gV2Ugc2hvdWxkIGRlbGV0ZSB0aGUgb2JqZWN0SWQgZm9yIGFuIHVwZGF0ZSB3cml0ZVxuICAgICAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5xdWVyeS5vYmplY3RJZCkge1xuICAgICAgICBkZWxldGUgdGhpcy5kYXRhLm9iamVjdElkXG4gICAgICB9XG4gICAgfVxuICB9KTtcbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuc2V0UmVxdWlyZWRGaWVsZHNJZk5lZWRlZCA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5kYXRhKSB7XG4gICAgLy8gQWRkIGRlZmF1bHQgZmllbGRzXG4gICAgdGhpcy5kYXRhLnVwZGF0ZWRBdCA9IHRoaXMudXBkYXRlZEF0O1xuICAgIGlmICghdGhpcy5xdWVyeSkge1xuICAgICAgdGhpcy5kYXRhLmNyZWF0ZWRBdCA9IHRoaXMudXBkYXRlZEF0O1xuXG4gICAgICAvLyBPbmx5IGFzc2lnbiBuZXcgb2JqZWN0SWQgaWYgd2UgYXJlIGNyZWF0aW5nIG5ldyBvYmplY3RcbiAgICAgIGlmICghdGhpcy5kYXRhLm9iamVjdElkKSB7XG4gICAgICAgIHRoaXMuZGF0YS5vYmplY3RJZCA9IGNyeXB0b1V0aWxzLm5ld09iamVjdElkKHRoaXMuY29uZmlnLm9iamVjdElkU2l6ZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbn07XG5cbi8vIFRyYW5zZm9ybXMgYXV0aCBkYXRhIGZvciBhIHVzZXIgb2JqZWN0LlxuLy8gRG9lcyBub3RoaW5nIGlmIHRoaXMgaXNuJ3QgYSB1c2VyIG9iamVjdC5cbi8vIFJldHVybnMgYSBwcm9taXNlIGZvciB3aGVuIHdlJ3JlIGRvbmUgaWYgaXQgY2FuJ3QgZmluaXNoIHRoaXMgdGljay5cblJlc3RXcml0ZS5wcm90b3R5cGUudmFsaWRhdGVBdXRoRGF0YSA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5jbGFzc05hbWUgIT09ICdfVXNlcicpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAoIXRoaXMucXVlcnkgJiYgIXRoaXMuZGF0YS5hdXRoRGF0YSkge1xuICAgIGlmICh0eXBlb2YgdGhpcy5kYXRhLnVzZXJuYW1lICE9PSAnc3RyaW5nJyB8fCBfLmlzRW1wdHkodGhpcy5kYXRhLnVzZXJuYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlVTRVJOQU1FX01JU1NJTkcsXG4gICAgICAgICdiYWQgb3IgbWlzc2luZyB1c2VybmFtZScpO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIHRoaXMuZGF0YS5wYXNzd29yZCAhPT0gJ3N0cmluZycgfHwgXy5pc0VtcHR5KHRoaXMuZGF0YS5wYXNzd29yZCkpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QQVNTV09SRF9NSVNTSU5HLFxuICAgICAgICAncGFzc3dvcmQgaXMgcmVxdWlyZWQnKTtcbiAgICB9XG4gIH1cblxuICBpZiAoIXRoaXMuZGF0YS5hdXRoRGF0YSB8fCAhT2JqZWN0LmtleXModGhpcy5kYXRhLmF1dGhEYXRhKS5sZW5ndGgpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICB2YXIgYXV0aERhdGEgPSB0aGlzLmRhdGEuYXV0aERhdGE7XG4gIHZhciBwcm92aWRlcnMgPSBPYmplY3Qua2V5cyhhdXRoRGF0YSk7XG4gIGlmIChwcm92aWRlcnMubGVuZ3RoID4gMCkge1xuICAgIGNvbnN0IGNhbkhhbmRsZUF1dGhEYXRhID0gcHJvdmlkZXJzLnJlZHVjZSgoY2FuSGFuZGxlLCBwcm92aWRlcikgPT4ge1xuICAgICAgdmFyIHByb3ZpZGVyQXV0aERhdGEgPSBhdXRoRGF0YVtwcm92aWRlcl07XG4gICAgICB2YXIgaGFzVG9rZW4gPSAocHJvdmlkZXJBdXRoRGF0YSAmJiBwcm92aWRlckF1dGhEYXRhLmlkKTtcbiAgICAgIHJldHVybiBjYW5IYW5kbGUgJiYgKGhhc1Rva2VuIHx8IHByb3ZpZGVyQXV0aERhdGEgPT0gbnVsbCk7XG4gICAgfSwgdHJ1ZSk7XG4gICAgaWYgKGNhbkhhbmRsZUF1dGhEYXRhKSB7XG4gICAgICByZXR1cm4gdGhpcy5oYW5kbGVBdXRoRGF0YShhdXRoRGF0YSk7XG4gICAgfVxuICB9XG4gIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5VTlNVUFBPUlRFRF9TRVJWSUNFLFxuICAgICdUaGlzIGF1dGhlbnRpY2F0aW9uIG1ldGhvZCBpcyB1bnN1cHBvcnRlZC4nKTtcbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuaGFuZGxlQXV0aERhdGFWYWxpZGF0aW9uID0gZnVuY3Rpb24oYXV0aERhdGEpIHtcbiAgY29uc3QgdmFsaWRhdGlvbnMgPSBPYmplY3Qua2V5cyhhdXRoRGF0YSkubWFwKChwcm92aWRlcikgPT4ge1xuICAgIGlmIChhdXRoRGF0YVtwcm92aWRlcl0gPT09IG51bGwpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG4gICAgY29uc3QgdmFsaWRhdGVBdXRoRGF0YSA9IHRoaXMuY29uZmlnLmF1dGhEYXRhTWFuYWdlci5nZXRWYWxpZGF0b3JGb3JQcm92aWRlcihwcm92aWRlcik7XG4gICAgaWYgKCF2YWxpZGF0ZUF1dGhEYXRhKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuVU5TVVBQT1JURURfU0VSVklDRSxcbiAgICAgICAgJ1RoaXMgYXV0aGVudGljYXRpb24gbWV0aG9kIGlzIHVuc3VwcG9ydGVkLicpO1xuICAgIH1cbiAgICByZXR1cm4gdmFsaWRhdGVBdXRoRGF0YShhdXRoRGF0YVtwcm92aWRlcl0pO1xuICB9KTtcbiAgcmV0dXJuIFByb21pc2UuYWxsKHZhbGlkYXRpb25zKTtcbn1cblxuUmVzdFdyaXRlLnByb3RvdHlwZS5maW5kVXNlcnNXaXRoQXV0aERhdGEgPSBmdW5jdGlvbihhdXRoRGF0YSkge1xuICBjb25zdCBwcm92aWRlcnMgPSBPYmplY3Qua2V5cyhhdXRoRGF0YSk7XG4gIGNvbnN0IHF1ZXJ5ID0gcHJvdmlkZXJzLnJlZHVjZSgobWVtbywgcHJvdmlkZXIpID0+IHtcbiAgICBpZiAoIWF1dGhEYXRhW3Byb3ZpZGVyXSkge1xuICAgICAgcmV0dXJuIG1lbW87XG4gICAgfVxuICAgIGNvbnN0IHF1ZXJ5S2V5ID0gYGF1dGhEYXRhLiR7cHJvdmlkZXJ9LmlkYDtcbiAgICBjb25zdCBxdWVyeSA9IHt9O1xuICAgIHF1ZXJ5W3F1ZXJ5S2V5XSA9IGF1dGhEYXRhW3Byb3ZpZGVyXS5pZDtcbiAgICBtZW1vLnB1c2gocXVlcnkpO1xuICAgIHJldHVybiBtZW1vO1xuICB9LCBbXSkuZmlsdGVyKChxKSA9PiB7XG4gICAgcmV0dXJuIHR5cGVvZiBxICE9PSAndW5kZWZpbmVkJztcbiAgfSk7XG5cbiAgbGV0IGZpbmRQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKFtdKTtcbiAgaWYgKHF1ZXJ5Lmxlbmd0aCA+IDApIHtcbiAgICBmaW5kUHJvbWlzZSA9IHRoaXMuY29uZmlnLmRhdGFiYXNlLmZpbmQoXG4gICAgICB0aGlzLmNsYXNzTmFtZSxcbiAgICAgIHsnJG9yJzogcXVlcnl9LCB7fSlcbiAgfVxuXG4gIHJldHVybiBmaW5kUHJvbWlzZTtcbn1cblxuUmVzdFdyaXRlLnByb3RvdHlwZS5maWx0ZXJlZE9iamVjdHNCeUFDTCA9IGZ1bmN0aW9uKG9iamVjdHMpIHtcbiAgaWYgKHRoaXMuYXV0aC5pc01hc3Rlcikge1xuICAgIHJldHVybiBvYmplY3RzO1xuICB9XG4gIHJldHVybiBvYmplY3RzLmZpbHRlcigob2JqZWN0KSA9PiB7XG4gICAgaWYgKCFvYmplY3QuQUNMKSB7XG4gICAgICByZXR1cm4gdHJ1ZTsgLy8gbGVnYWN5IHVzZXJzIHRoYXQgaGF2ZSBubyBBQ0wgZmllbGQgb24gdGhlbVxuICAgIH1cbiAgICAvLyBSZWd1bGFyIHVzZXJzIHRoYXQgaGF2ZSBiZWVuIGxvY2tlZCBvdXQuXG4gICAgcmV0dXJuIG9iamVjdC5BQ0wgJiYgT2JqZWN0LmtleXMob2JqZWN0LkFDTCkubGVuZ3RoID4gMDtcbiAgfSk7XG59XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuaGFuZGxlQXV0aERhdGEgPSBmdW5jdGlvbihhdXRoRGF0YSkge1xuICBsZXQgcmVzdWx0cztcbiAgcmV0dXJuIHRoaXMuZmluZFVzZXJzV2l0aEF1dGhEYXRhKGF1dGhEYXRhKS50aGVuKChyKSA9PiB7XG4gICAgcmVzdWx0cyA9IHRoaXMuZmlsdGVyZWRPYmplY3RzQnlBQ0wocik7XG4gICAgaWYgKHJlc3VsdHMubGVuZ3RoID4gMSkge1xuICAgICAgLy8gTW9yZSB0aGFuIDEgdXNlciB3aXRoIHRoZSBwYXNzZWQgaWQnc1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLkFDQ09VTlRfQUxSRUFEWV9MSU5LRUQsXG4gICAgICAgICd0aGlzIGF1dGggaXMgYWxyZWFkeSB1c2VkJyk7XG4gICAgfVxuXG4gICAgdGhpcy5zdG9yYWdlWydhdXRoUHJvdmlkZXInXSA9IE9iamVjdC5rZXlzKGF1dGhEYXRhKS5qb2luKCcsJyk7XG5cbiAgICBpZiAocmVzdWx0cy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCB1c2VyUmVzdWx0ID0gcmVzdWx0c1swXTtcbiAgICAgIGNvbnN0IG11dGF0ZWRBdXRoRGF0YSA9IHt9O1xuICAgICAgT2JqZWN0LmtleXMoYXV0aERhdGEpLmZvckVhY2goKHByb3ZpZGVyKSA9PiB7XG4gICAgICAgIGNvbnN0IHByb3ZpZGVyRGF0YSA9IGF1dGhEYXRhW3Byb3ZpZGVyXTtcbiAgICAgICAgY29uc3QgdXNlckF1dGhEYXRhID0gdXNlclJlc3VsdC5hdXRoRGF0YVtwcm92aWRlcl07XG4gICAgICAgIGlmICghXy5pc0VxdWFsKHByb3ZpZGVyRGF0YSwgdXNlckF1dGhEYXRhKSkge1xuICAgICAgICAgIG11dGF0ZWRBdXRoRGF0YVtwcm92aWRlcl0gPSBwcm92aWRlckRhdGE7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgY29uc3QgaGFzTXV0YXRlZEF1dGhEYXRhID0gT2JqZWN0LmtleXMobXV0YXRlZEF1dGhEYXRhKS5sZW5ndGggIT09IDA7XG4gICAgICBsZXQgdXNlcklkO1xuICAgICAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5xdWVyeS5vYmplY3RJZCkge1xuICAgICAgICB1c2VySWQgPSB0aGlzLnF1ZXJ5Lm9iamVjdElkO1xuICAgICAgfSBlbHNlIGlmICh0aGlzLmF1dGggJiYgdGhpcy5hdXRoLnVzZXIgJiYgdGhpcy5hdXRoLnVzZXIuaWQpIHtcbiAgICAgICAgdXNlcklkID0gdGhpcy5hdXRoLnVzZXIuaWQ7XG4gICAgICB9XG4gICAgICBpZiAoIXVzZXJJZCB8fCB1c2VySWQgPT09IHVzZXJSZXN1bHQub2JqZWN0SWQpIHsgLy8gbm8gdXNlciBtYWtpbmcgdGhlIGNhbGxcbiAgICAgICAgLy8gT1IgdGhlIHVzZXIgbWFraW5nIHRoZSBjYWxsIGlzIHRoZSByaWdodCBvbmVcbiAgICAgICAgLy8gTG9naW4gd2l0aCBhdXRoIGRhdGFcbiAgICAgICAgZGVsZXRlIHJlc3VsdHNbMF0ucGFzc3dvcmQ7XG5cbiAgICAgICAgLy8gbmVlZCB0byBzZXQgdGhlIG9iamVjdElkIGZpcnN0IG90aGVyd2lzZSBsb2NhdGlvbiBoYXMgdHJhaWxpbmcgdW5kZWZpbmVkXG4gICAgICAgIHRoaXMuZGF0YS5vYmplY3RJZCA9IHVzZXJSZXN1bHQub2JqZWN0SWQ7XG5cbiAgICAgICAgaWYgKCF0aGlzLnF1ZXJ5IHx8ICF0aGlzLnF1ZXJ5Lm9iamVjdElkKSB7IC8vIHRoaXMgYSBsb2dpbiBjYWxsLCBubyB1c2VySWQgcGFzc2VkXG4gICAgICAgICAgdGhpcy5yZXNwb25zZSA9IHtcbiAgICAgICAgICAgIHJlc3BvbnNlOiB1c2VyUmVzdWx0LFxuICAgICAgICAgICAgbG9jYXRpb246IHRoaXMubG9jYXRpb24oKVxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgLy8gSWYgd2UgZGlkbid0IGNoYW5nZSB0aGUgYXV0aCBkYXRhLCBqdXN0IGtlZXAgZ29pbmdcbiAgICAgICAgaWYgKCFoYXNNdXRhdGVkQXV0aERhdGEpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgLy8gV2UgaGF2ZSBhdXRoRGF0YSB0aGF0IGlzIHVwZGF0ZWQgb24gbG9naW5cbiAgICAgICAgLy8gdGhhdCBjYW4gaGFwcGVuIHdoZW4gdG9rZW4gYXJlIHJlZnJlc2hlZCxcbiAgICAgICAgLy8gV2Ugc2hvdWxkIHVwZGF0ZSB0aGUgdG9rZW4gYW5kIGxldCB0aGUgdXNlciBpblxuICAgICAgICAvLyBXZSBzaG91bGQgb25seSBjaGVjayB0aGUgbXV0YXRlZCBrZXlzXG4gICAgICAgIHJldHVybiB0aGlzLmhhbmRsZUF1dGhEYXRhVmFsaWRhdGlvbihtdXRhdGVkQXV0aERhdGEpLnRoZW4oKCkgPT4ge1xuICAgICAgICAgIC8vIElGIHdlIGhhdmUgYSByZXNwb25zZSwgd2UnbGwgc2tpcCB0aGUgZGF0YWJhc2Ugb3BlcmF0aW9uIC8gYmVmb3JlU2F2ZSAvIGFmdGVyU2F2ZSBldGMuLi5cbiAgICAgICAgICAvLyB3ZSBuZWVkIHRvIHNldCBpdCB1cCB0aGVyZS5cbiAgICAgICAgICAvLyBXZSBhcmUgc3VwcG9zZWQgdG8gaGF2ZSBhIHJlc3BvbnNlIG9ubHkgb24gTE9HSU4gd2l0aCBhdXRoRGF0YSwgc28gd2Ugc2tpcCB0aG9zZVxuICAgICAgICAgIC8vIElmIHdlJ3JlIG5vdCBsb2dnaW5nIGluLCBidXQganVzdCB1cGRhdGluZyB0aGUgY3VycmVudCB1c2VyLCB3ZSBjYW4gc2FmZWx5IHNraXAgdGhhdCBwYXJ0XG4gICAgICAgICAgaWYgKHRoaXMucmVzcG9uc2UpIHtcbiAgICAgICAgICAgIC8vIEFzc2lnbiB0aGUgbmV3IGF1dGhEYXRhIGluIHRoZSByZXNwb25zZVxuICAgICAgICAgICAgT2JqZWN0LmtleXMobXV0YXRlZEF1dGhEYXRhKS5mb3JFYWNoKChwcm92aWRlcikgPT4ge1xuICAgICAgICAgICAgICB0aGlzLnJlc3BvbnNlLnJlc3BvbnNlLmF1dGhEYXRhW3Byb3ZpZGVyXSA9IG11dGF0ZWRBdXRoRGF0YVtwcm92aWRlcl07XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIC8vIFJ1biB0aGUgREIgdXBkYXRlIGRpcmVjdGx5LCBhcyAnbWFzdGVyJ1xuICAgICAgICAgICAgLy8gSnVzdCB1cGRhdGUgdGhlIGF1dGhEYXRhIHBhcnRcbiAgICAgICAgICAgIC8vIFRoZW4gd2UncmUgZ29vZCBmb3IgdGhlIHVzZXIsIGVhcmx5IGV4aXQgb2Ygc29ydHNcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZS51cGRhdGUodGhpcy5jbGFzc05hbWUsIHtvYmplY3RJZDogdGhpcy5kYXRhLm9iamVjdElkfSwge2F1dGhEYXRhOiBtdXRhdGVkQXV0aERhdGF9LCB7fSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSBpZiAodXNlcklkKSB7XG4gICAgICAgIC8vIFRyeWluZyB0byB1cGRhdGUgYXV0aCBkYXRhIGJ1dCB1c2Vyc1xuICAgICAgICAvLyBhcmUgZGlmZmVyZW50XG4gICAgICAgIGlmICh1c2VyUmVzdWx0Lm9iamVjdElkICE9PSB1c2VySWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuQUNDT1VOVF9BTFJFQURZX0xJTktFRCxcbiAgICAgICAgICAgICd0aGlzIGF1dGggaXMgYWxyZWFkeSB1c2VkJyk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gTm8gYXV0aCBkYXRhIHdhcyBtdXRhdGVkLCBqdXN0IGtlZXAgZ29pbmdcbiAgICAgICAgaWYgKCFoYXNNdXRhdGVkQXV0aERhdGEpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuaGFuZGxlQXV0aERhdGFWYWxpZGF0aW9uKGF1dGhEYXRhKTtcbiAgfSk7XG59XG5cblxuLy8gVGhlIG5vbi10aGlyZC1wYXJ0eSBwYXJ0cyBvZiBVc2VyIHRyYW5zZm9ybWF0aW9uXG5SZXN0V3JpdGUucHJvdG90eXBlLnRyYW5zZm9ybVVzZXIgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKTtcblxuICBpZiAodGhpcy5jbGFzc05hbWUgIT09ICdfVXNlcicpIHtcbiAgICByZXR1cm4gcHJvbWlzZTtcbiAgfVxuXG4gIGlmICghdGhpcy5hdXRoLmlzTWFzdGVyICYmIFwiZW1haWxWZXJpZmllZFwiIGluIHRoaXMuZGF0YSkge1xuICAgIGNvbnN0IGVycm9yID0gYENsaWVudHMgYXJlbid0IGFsbG93ZWQgdG8gbWFudWFsbHkgdXBkYXRlIGVtYWlsIHZlcmlmaWNhdGlvbi5gXG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9QRVJBVElPTl9GT1JCSURERU4sIGVycm9yKTtcbiAgfVxuXG4gIC8vIERvIG5vdCBjbGVhbnVwIHNlc3Npb24gaWYgb2JqZWN0SWQgaXMgbm90IHNldFxuICBpZiAodGhpcy5xdWVyeSAmJiB0aGlzLm9iamVjdElkKCkpIHtcbiAgICAvLyBJZiB3ZSdyZSB1cGRhdGluZyBhIF9Vc2VyIG9iamVjdCwgd2UgbmVlZCB0byBjbGVhciBvdXQgdGhlIGNhY2hlIGZvciB0aGF0IHVzZXIuIEZpbmQgYWxsIHRoZWlyXG4gICAgLy8gc2Vzc2lvbiB0b2tlbnMsIGFuZCByZW1vdmUgdGhlbSBmcm9tIHRoZSBjYWNoZS5cbiAgICBwcm9taXNlID0gbmV3IFJlc3RRdWVyeSh0aGlzLmNvbmZpZywgQXV0aC5tYXN0ZXIodGhpcy5jb25maWcpLCAnX1Nlc3Npb24nLCB7XG4gICAgICB1c2VyOiB7XG4gICAgICAgIF9fdHlwZTogXCJQb2ludGVyXCIsXG4gICAgICAgIGNsYXNzTmFtZTogXCJfVXNlclwiLFxuICAgICAgICBvYmplY3RJZDogdGhpcy5vYmplY3RJZCgpLFxuICAgICAgfVxuICAgIH0pLmV4ZWN1dGUoKVxuICAgICAgLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICAgIHJlc3VsdHMucmVzdWx0cy5mb3JFYWNoKHNlc3Npb24gPT4gdGhpcy5jb25maWcuY2FjaGVDb250cm9sbGVyLnVzZXIuZGVsKHNlc3Npb24uc2Vzc2lvblRva2VuKSk7XG4gICAgICB9KTtcbiAgfVxuXG4gIHJldHVybiBwcm9taXNlLnRoZW4oKCkgPT4ge1xuICAgIC8vIFRyYW5zZm9ybSB0aGUgcGFzc3dvcmRcbiAgICBpZiAodGhpcy5kYXRhLnBhc3N3b3JkID09PSB1bmRlZmluZWQpIHsgLy8gaWdub3JlIG9ubHkgaWYgdW5kZWZpbmVkLiBzaG91bGQgcHJvY2VlZCBpZiBlbXB0eSAoJycpXG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMucXVlcnkpIHtcbiAgICAgIHRoaXMuc3RvcmFnZVsnY2xlYXJTZXNzaW9ucyddID0gdHJ1ZTtcbiAgICAgIC8vIEdlbmVyYXRlIGEgbmV3IHNlc3Npb24gb25seSBpZiB0aGUgdXNlciByZXF1ZXN0ZWRcbiAgICAgIGlmICghdGhpcy5hdXRoLmlzTWFzdGVyKSB7XG4gICAgICAgIHRoaXMuc3RvcmFnZVsnZ2VuZXJhdGVOZXdTZXNzaW9uJ10gPSB0cnVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl92YWxpZGF0ZVBhc3N3b3JkUG9saWN5KCkudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gcGFzc3dvcmRDcnlwdG8uaGFzaCh0aGlzLmRhdGEucGFzc3dvcmQpLnRoZW4oKGhhc2hlZFBhc3N3b3JkKSA9PiB7XG4gICAgICAgIHRoaXMuZGF0YS5faGFzaGVkX3Bhc3N3b3JkID0gaGFzaGVkUGFzc3dvcmQ7XG4gICAgICAgIGRlbGV0ZSB0aGlzLmRhdGEucGFzc3dvcmQ7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICB9KS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5fdmFsaWRhdGVVc2VyTmFtZSgpO1xuICB9KS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5fdmFsaWRhdGVFbWFpbCgpO1xuICB9KTtcbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuX3ZhbGlkYXRlVXNlck5hbWUgPSBmdW5jdGlvbiAoKSB7XG4gIC8vIENoZWNrIGZvciB1c2VybmFtZSB1bmlxdWVuZXNzXG4gIGlmICghdGhpcy5kYXRhLnVzZXJuYW1lKSB7XG4gICAgaWYgKCF0aGlzLnF1ZXJ5KSB7XG4gICAgICB0aGlzLmRhdGEudXNlcm5hbWUgPSBjcnlwdG9VdGlscy5yYW5kb21TdHJpbmcoMjUpO1xuICAgICAgdGhpcy5yZXNwb25zZVNob3VsZEhhdmVVc2VybmFtZSA9IHRydWU7XG4gICAgfVxuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuICAvLyBXZSBuZWVkIHRvIGEgZmluZCB0byBjaGVjayBmb3IgZHVwbGljYXRlIHVzZXJuYW1lIGluIGNhc2UgdGhleSBhcmUgbWlzc2luZyB0aGUgdW5pcXVlIGluZGV4IG9uIHVzZXJuYW1lc1xuICAvLyBUT0RPOiBDaGVjayBpZiB0aGVyZSBpcyBhIHVuaXF1ZSBpbmRleCwgYW5kIGlmIHNvLCBza2lwIHRoaXMgcXVlcnkuXG4gIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZS5maW5kKFxuICAgIHRoaXMuY2xhc3NOYW1lLFxuICAgIHt1c2VybmFtZTogdGhpcy5kYXRhLnVzZXJuYW1lLCBvYmplY3RJZDogeyckbmUnOiB0aGlzLm9iamVjdElkKCl9fSxcbiAgICB7bGltaXQ6IDF9XG4gICkudGhlbihyZXN1bHRzID0+IHtcbiAgICBpZiAocmVzdWx0cy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuVVNFUk5BTUVfVEFLRU4sICdBY2NvdW50IGFscmVhZHkgZXhpc3RzIGZvciB0aGlzIHVzZXJuYW1lLicpO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH0pO1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5fdmFsaWRhdGVFbWFpbCA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMuZGF0YS5lbWFpbCB8fCB0aGlzLmRhdGEuZW1haWwuX19vcCA9PT0gJ0RlbGV0ZScpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cbiAgLy8gVmFsaWRhdGUgYmFzaWMgZW1haWwgYWRkcmVzcyBmb3JtYXRcbiAgaWYgKCF0aGlzLmRhdGEuZW1haWwubWF0Y2goL14uK0AuKyQvKSkge1xuICAgIHJldHVybiBQcm9taXNlLnJlamVjdChuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9FTUFJTF9BRERSRVNTLCAnRW1haWwgYWRkcmVzcyBmb3JtYXQgaXMgaW52YWxpZC4nKSk7XG4gIH1cbiAgLy8gU2FtZSBwcm9ibGVtIGZvciBlbWFpbCBhcyBhYm92ZSBmb3IgdXNlcm5hbWVcbiAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlLmZpbmQoXG4gICAgdGhpcy5jbGFzc05hbWUsXG4gICAge2VtYWlsOiB0aGlzLmRhdGEuZW1haWwsIG9iamVjdElkOiB7JyRuZSc6IHRoaXMub2JqZWN0SWQoKX19LFxuICAgIHtsaW1pdDogMX1cbiAgKS50aGVuKHJlc3VsdHMgPT4ge1xuICAgIGlmIChyZXN1bHRzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5FTUFJTF9UQUtFTiwgJ0FjY291bnQgYWxyZWFkeSBleGlzdHMgZm9yIHRoaXMgZW1haWwgYWRkcmVzcy4nKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgIXRoaXMuZGF0YS5hdXRoRGF0YSB8fFxuICAgICAgIU9iamVjdC5rZXlzKHRoaXMuZGF0YS5hdXRoRGF0YSkubGVuZ3RoIHx8XG4gICAgICBPYmplY3Qua2V5cyh0aGlzLmRhdGEuYXV0aERhdGEpLmxlbmd0aCA9PT0gMSAmJiBPYmplY3Qua2V5cyh0aGlzLmRhdGEuYXV0aERhdGEpWzBdID09PSAnYW5vbnltb3VzJ1xuICAgICkge1xuICAgICAgLy8gV2UgdXBkYXRlZCB0aGUgZW1haWwsIHNlbmQgYSBuZXcgdmFsaWRhdGlvblxuICAgICAgdGhpcy5zdG9yYWdlWydzZW5kVmVyaWZpY2F0aW9uRW1haWwnXSA9IHRydWU7XG4gICAgICB0aGlzLmNvbmZpZy51c2VyQ29udHJvbGxlci5zZXRFbWFpbFZlcmlmeVRva2VuKHRoaXMuZGF0YSk7XG4gICAgfVxuICB9KTtcbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuX3ZhbGlkYXRlUGFzc3dvcmRQb2xpY3kgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeSlcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIHJldHVybiB0aGlzLl92YWxpZGF0ZVBhc3N3b3JkUmVxdWlyZW1lbnRzKCkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMuX3ZhbGlkYXRlUGFzc3dvcmRIaXN0b3J5KCk7XG4gIH0pO1xufTtcblxuXG5SZXN0V3JpdGUucHJvdG90eXBlLl92YWxpZGF0ZVBhc3N3b3JkUmVxdWlyZW1lbnRzID0gZnVuY3Rpb24oKSB7XG4gIC8vIGNoZWNrIGlmIHRoZSBwYXNzd29yZCBjb25mb3JtcyB0byB0aGUgZGVmaW5lZCBwYXNzd29yZCBwb2xpY3kgaWYgY29uZmlndXJlZFxuICBjb25zdCBwb2xpY3lFcnJvciA9ICdQYXNzd29yZCBkb2VzIG5vdCBtZWV0IHRoZSBQYXNzd29yZCBQb2xpY3kgcmVxdWlyZW1lbnRzLic7XG5cbiAgLy8gY2hlY2sgd2hldGhlciB0aGUgcGFzc3dvcmQgbWVldHMgdGhlIHBhc3N3b3JkIHN0cmVuZ3RoIHJlcXVpcmVtZW50c1xuICBpZiAodGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kucGF0dGVyblZhbGlkYXRvciAmJiAhdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kucGF0dGVyblZhbGlkYXRvcih0aGlzLmRhdGEucGFzc3dvcmQpIHx8XG4gICAgdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kudmFsaWRhdG9yQ2FsbGJhY2sgJiYgIXRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5LnZhbGlkYXRvckNhbGxiYWNrKHRoaXMuZGF0YS5wYXNzd29yZCkpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlZBTElEQVRJT05fRVJST1IsIHBvbGljeUVycm9yKSk7XG4gIH1cblxuICAvLyBjaGVjayB3aGV0aGVyIHBhc3N3b3JkIGNvbnRhaW4gdXNlcm5hbWVcbiAgaWYgKHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5LmRvTm90QWxsb3dVc2VybmFtZSA9PT0gdHJ1ZSkge1xuICAgIGlmICh0aGlzLmRhdGEudXNlcm5hbWUpIHsgLy8gdXNlcm5hbWUgaXMgbm90IHBhc3NlZCBkdXJpbmcgcGFzc3dvcmQgcmVzZXRcbiAgICAgIGlmICh0aGlzLmRhdGEucGFzc3dvcmQuaW5kZXhPZih0aGlzLmRhdGEudXNlcm5hbWUpID49IDApXG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuVkFMSURBVElPTl9FUlJPUiwgcG9saWN5RXJyb3IpKTtcbiAgICB9IGVsc2UgeyAvLyByZXRyaWV2ZSB0aGUgVXNlciBvYmplY3QgdXNpbmcgb2JqZWN0SWQgZHVyaW5nIHBhc3N3b3JkIHJlc2V0XG4gICAgICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UuZmluZCgnX1VzZXInLCB7b2JqZWN0SWQ6IHRoaXMub2JqZWN0SWQoKX0pXG4gICAgICAgIC50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgICAgIGlmIChyZXN1bHRzLmxlbmd0aCAhPSAxKSB7XG4gICAgICAgICAgICB0aHJvdyB1bmRlZmluZWQ7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICh0aGlzLmRhdGEucGFzc3dvcmQuaW5kZXhPZihyZXN1bHRzWzBdLnVzZXJuYW1lKSA+PSAwKVxuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5WQUxJREFUSU9OX0VSUk9SLCBwb2xpY3lFcnJvcikpO1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgfSk7XG4gICAgfVxuICB9XG4gIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuX3ZhbGlkYXRlUGFzc3dvcmRIaXN0b3J5ID0gZnVuY3Rpb24oKSB7XG4gIC8vIGNoZWNrIHdoZXRoZXIgcGFzc3dvcmQgaXMgcmVwZWF0aW5nIGZyb20gc3BlY2lmaWVkIGhpc3RvcnlcbiAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRIaXN0b3J5KSB7XG4gICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlLmZpbmQoJ19Vc2VyJywge29iamVjdElkOiB0aGlzLm9iamVjdElkKCl9LCB7a2V5czogW1wiX3Bhc3N3b3JkX2hpc3RvcnlcIiwgXCJfaGFzaGVkX3Bhc3N3b3JkXCJdfSlcbiAgICAgIC50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgICBpZiAocmVzdWx0cy5sZW5ndGggIT0gMSkge1xuICAgICAgICAgIHRocm93IHVuZGVmaW5lZDtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB1c2VyID0gcmVzdWx0c1swXTtcbiAgICAgICAgbGV0IG9sZFBhc3N3b3JkcyA9IFtdO1xuICAgICAgICBpZiAodXNlci5fcGFzc3dvcmRfaGlzdG9yeSlcbiAgICAgICAgICBvbGRQYXNzd29yZHMgPSBfLnRha2UodXNlci5fcGFzc3dvcmRfaGlzdG9yeSwgdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRIaXN0b3J5IC0gMSk7XG4gICAgICAgIG9sZFBhc3N3b3Jkcy5wdXNoKHVzZXIucGFzc3dvcmQpO1xuICAgICAgICBjb25zdCBuZXdQYXNzd29yZCA9IHRoaXMuZGF0YS5wYXNzd29yZDtcbiAgICAgICAgLy8gY29tcGFyZSB0aGUgbmV3IHBhc3N3b3JkIGhhc2ggd2l0aCBhbGwgb2xkIHBhc3N3b3JkIGhhc2hlc1xuICAgICAgICBjb25zdCBwcm9taXNlcyA9IG9sZFBhc3N3b3Jkcy5tYXAoZnVuY3Rpb24gKGhhc2gpIHtcbiAgICAgICAgICByZXR1cm4gcGFzc3dvcmRDcnlwdG8uY29tcGFyZShuZXdQYXNzd29yZCwgaGFzaCkudGhlbigocmVzdWx0KSA9PiB7XG4gICAgICAgICAgICBpZiAocmVzdWx0KSAvLyByZWplY3QgaWYgdGhlcmUgaXMgYSBtYXRjaFxuICAgICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QoXCJSRVBFQVRfUEFTU1dPUkRcIik7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgICAgfSlcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIHdhaXQgZm9yIGFsbCBjb21wYXJpc29ucyB0byBjb21wbGV0ZVxuICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwocHJvbWlzZXMpLnRoZW4oKCkgPT4ge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgfSkuY2F0Y2goZXJyID0+IHtcbiAgICAgICAgICBpZiAoZXJyID09PSBcIlJFUEVBVF9QQVNTV09SRFwiKSAvLyBhIG1hdGNoIHdhcyBmb3VuZFxuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5WQUxJREFUSU9OX0VSUk9SLCBgTmV3IHBhc3N3b3JkIHNob3VsZCBub3QgYmUgdGhlIHNhbWUgYXMgbGFzdCAke3RoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5Lm1heFBhc3N3b3JkSGlzdG9yeX0gcGFzc3dvcmRzLmApKTtcbiAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5jcmVhdGVTZXNzaW9uVG9rZW5JZk5lZWRlZCA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5jbGFzc05hbWUgIT09ICdfVXNlcicpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHRoaXMucXVlcnkpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCF0aGlzLnN0b3JhZ2VbJ2F1dGhQcm92aWRlciddIC8vIHNpZ251cCBjYWxsLCB3aXRoXG4gICAgICAmJiB0aGlzLmNvbmZpZy5wcmV2ZW50TG9naW5XaXRoVW52ZXJpZmllZEVtYWlsIC8vIG5vIGxvZ2luIHdpdGhvdXQgdmVyaWZpY2F0aW9uXG4gICAgICAmJiB0aGlzLmNvbmZpZy52ZXJpZnlVc2VyRW1haWxzKSB7IC8vIHZlcmlmaWNhdGlvbiBpcyBvblxuICAgIHJldHVybjsgLy8gZG8gbm90IGNyZWF0ZSB0aGUgc2Vzc2lvbiB0b2tlbiBpbiB0aGF0IGNhc2UhXG4gIH1cbiAgcmV0dXJuIHRoaXMuY3JlYXRlU2Vzc2lvblRva2VuKCk7XG59XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuY3JlYXRlU2Vzc2lvblRva2VuID0gZnVuY3Rpb24oKSB7XG4gIC8vIGNsb3VkIGluc3RhbGxhdGlvbklkIGZyb20gQ2xvdWQgQ29kZSxcbiAgLy8gbmV2ZXIgY3JlYXRlIHNlc3Npb24gdG9rZW5zIGZyb20gdGhlcmUuXG4gIGlmICh0aGlzLmF1dGguaW5zdGFsbGF0aW9uSWQgJiYgdGhpcy5hdXRoLmluc3RhbGxhdGlvbklkID09PSAnY2xvdWQnKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3Qge1xuICAgIHNlc3Npb25EYXRhLFxuICAgIGNyZWF0ZVNlc3Npb24sXG4gIH0gPSBBdXRoLmNyZWF0ZVNlc3Npb24odGhpcy5jb25maWcsIHtcbiAgICB1c2VySWQ6IHRoaXMub2JqZWN0SWQoKSxcbiAgICBjcmVhdGVkV2l0aDoge1xuICAgICAgJ2FjdGlvbic6IHRoaXMuc3RvcmFnZVsnYXV0aFByb3ZpZGVyJ10gPyAnbG9naW4nIDogJ3NpZ251cCcsXG4gICAgICAnYXV0aFByb3ZpZGVyJzogdGhpcy5zdG9yYWdlWydhdXRoUHJvdmlkZXInXSB8fCAncGFzc3dvcmQnXG4gICAgfSxcbiAgICBpbnN0YWxsYXRpb25JZDogdGhpcy5hdXRoLmluc3RhbGxhdGlvbklkLFxuICB9KTtcblxuICBpZiAodGhpcy5yZXNwb25zZSAmJiB0aGlzLnJlc3BvbnNlLnJlc3BvbnNlKSB7XG4gICAgdGhpcy5yZXNwb25zZS5yZXNwb25zZS5zZXNzaW9uVG9rZW4gPSBzZXNzaW9uRGF0YS5zZXNzaW9uVG9rZW47XG4gIH1cblxuICByZXR1cm4gY3JlYXRlU2Vzc2lvbigpO1xufVxuXG5SZXN0V3JpdGUucHJvdG90eXBlLmRlc3Ryb3lEdXBsaWNhdGVkU2Vzc2lvbnMgPSBmdW5jdGlvbigpIHtcbiAgLy8gT25seSBmb3IgX1Nlc3Npb24sIGFuZCBhdCBjcmVhdGlvbiB0aW1lXG4gIGlmICh0aGlzLmNsYXNzTmFtZSAhPSAnX1Nlc3Npb24nIHx8IHRoaXMucXVlcnkpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gRGVzdHJveSB0aGUgc2Vzc2lvbnMgaW4gJ0JhY2tncm91bmQnXG4gIGNvbnN0IHtcbiAgICB1c2VyLFxuICAgIGluc3RhbGxhdGlvbklkLFxuICAgIHNlc3Npb25Ub2tlbixcbiAgfSA9IHRoaXMuZGF0YTtcbiAgaWYgKCF1c2VyIHx8ICFpbnN0YWxsYXRpb25JZCkgIHtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCF1c2VyLm9iamVjdElkKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIHRoaXMuY29uZmlnLmRhdGFiYXNlLmRlc3Ryb3koJ19TZXNzaW9uJywge1xuICAgIHVzZXIsXG4gICAgaW5zdGFsbGF0aW9uSWQsXG4gICAgc2Vzc2lvblRva2VuOiB7ICckbmUnOiBzZXNzaW9uVG9rZW4gfSxcbiAgfSk7XG59XG5cbi8vIEhhbmRsZXMgYW55IGZvbGxvd3VwIGxvZ2ljXG5SZXN0V3JpdGUucHJvdG90eXBlLmhhbmRsZUZvbGxvd3VwID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLnN0b3JhZ2UgJiYgdGhpcy5zdG9yYWdlWydjbGVhclNlc3Npb25zJ10gJiYgdGhpcy5jb25maWcucmV2b2tlU2Vzc2lvbk9uUGFzc3dvcmRSZXNldCkge1xuICAgIHZhciBzZXNzaW9uUXVlcnkgPSB7XG4gICAgICB1c2VyOiB7XG4gICAgICAgIF9fdHlwZTogJ1BvaW50ZXInLFxuICAgICAgICBjbGFzc05hbWU6ICdfVXNlcicsXG4gICAgICAgIG9iamVjdElkOiB0aGlzLm9iamVjdElkKClcbiAgICAgIH1cbiAgICB9O1xuICAgIGRlbGV0ZSB0aGlzLnN0b3JhZ2VbJ2NsZWFyU2Vzc2lvbnMnXTtcbiAgICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UuZGVzdHJveSgnX1Nlc3Npb24nLCBzZXNzaW9uUXVlcnkpXG4gICAgICAudGhlbih0aGlzLmhhbmRsZUZvbGxvd3VwLmJpbmQodGhpcykpO1xuICB9XG5cbiAgaWYgKHRoaXMuc3RvcmFnZSAmJiB0aGlzLnN0b3JhZ2VbJ2dlbmVyYXRlTmV3U2Vzc2lvbiddKSB7XG4gICAgZGVsZXRlIHRoaXMuc3RvcmFnZVsnZ2VuZXJhdGVOZXdTZXNzaW9uJ107XG4gICAgcmV0dXJuIHRoaXMuY3JlYXRlU2Vzc2lvblRva2VuKClcbiAgICAgIC50aGVuKHRoaXMuaGFuZGxlRm9sbG93dXAuYmluZCh0aGlzKSk7XG4gIH1cblxuICBpZiAodGhpcy5zdG9yYWdlICYmIHRoaXMuc3RvcmFnZVsnc2VuZFZlcmlmaWNhdGlvbkVtYWlsJ10pIHtcbiAgICBkZWxldGUgdGhpcy5zdG9yYWdlWydzZW5kVmVyaWZpY2F0aW9uRW1haWwnXTtcbiAgICAvLyBGaXJlIGFuZCBmb3JnZXQhXG4gICAgdGhpcy5jb25maWcudXNlckNvbnRyb2xsZXIuc2VuZFZlcmlmaWNhdGlvbkVtYWlsKHRoaXMuZGF0YSk7XG4gICAgcmV0dXJuIHRoaXMuaGFuZGxlRm9sbG93dXAuYmluZCh0aGlzKTtcbiAgfVxufTtcblxuLy8gSGFuZGxlcyB0aGUgX1Nlc3Npb24gY2xhc3Mgc3BlY2lhbG5lc3MuXG4vLyBEb2VzIG5vdGhpbmcgaWYgdGhpcyBpc24ndCBhbiBfU2Vzc2lvbiBvYmplY3QuXG5SZXN0V3JpdGUucHJvdG90eXBlLmhhbmRsZVNlc3Npb24gPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMucmVzcG9uc2UgfHwgdGhpcy5jbGFzc05hbWUgIT09ICdfU2Vzc2lvbicpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAoIXRoaXMuYXV0aC51c2VyICYmICF0aGlzLmF1dGguaXNNYXN0ZXIpIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9TRVNTSU9OX1RPS0VOLFxuICAgICAgJ1Nlc3Npb24gdG9rZW4gcmVxdWlyZWQuJyk7XG4gIH1cblxuICAvLyBUT0RPOiBWZXJpZnkgcHJvcGVyIGVycm9yIHRvIHRocm93XG4gIGlmICh0aGlzLmRhdGEuQUNMKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUsICdDYW5ub3Qgc2V0ICcgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAnQUNMIG9uIGEgU2Vzc2lvbi4nKTtcbiAgfVxuXG4gIGlmICh0aGlzLnF1ZXJ5KSB7XG4gICAgaWYgKHRoaXMuZGF0YS51c2VyICYmICF0aGlzLmF1dGguaXNNYXN0ZXIgJiYgdGhpcy5kYXRhLnVzZXIub2JqZWN0SWQgIT0gdGhpcy5hdXRoLnVzZXIuaWQpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuZGF0YS5pbnN0YWxsYXRpb25JZCkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5kYXRhLnNlc3Npb25Ub2tlbikge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUpO1xuICAgIH1cbiAgfVxuXG4gIGlmICghdGhpcy5xdWVyeSAmJiAhdGhpcy5hdXRoLmlzTWFzdGVyKSB7XG4gICAgY29uc3QgYWRkaXRpb25hbFNlc3Npb25EYXRhID0ge307XG4gICAgZm9yICh2YXIga2V5IGluIHRoaXMuZGF0YSkge1xuICAgICAgaWYgKGtleSA9PT0gJ29iamVjdElkJyB8fCBrZXkgPT09ICd1c2VyJykge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGFkZGl0aW9uYWxTZXNzaW9uRGF0YVtrZXldID0gdGhpcy5kYXRhW2tleV07XG4gICAgfVxuXG4gICAgY29uc3QgeyBzZXNzaW9uRGF0YSwgY3JlYXRlU2Vzc2lvbiB9ID0gQXV0aC5jcmVhdGVTZXNzaW9uKHRoaXMuY29uZmlnLCB7XG4gICAgICB1c2VySWQ6IHRoaXMuYXV0aC51c2VyLmlkLFxuICAgICAgY3JlYXRlZFdpdGg6IHtcbiAgICAgICAgYWN0aW9uOiAnY3JlYXRlJyxcbiAgICAgIH0sXG4gICAgICBhZGRpdGlvbmFsU2Vzc2lvbkRhdGFcbiAgICB9KTtcblxuICAgIHJldHVybiBjcmVhdGVTZXNzaW9uKCkudGhlbigocmVzdWx0cykgPT4ge1xuICAgICAgaWYgKCFyZXN1bHRzLnJlc3BvbnNlKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlRFUk5BTF9TRVJWRVJfRVJST1IsXG4gICAgICAgICAgJ0Vycm9yIGNyZWF0aW5nIHNlc3Npb24uJyk7XG4gICAgICB9XG4gICAgICBzZXNzaW9uRGF0YVsnb2JqZWN0SWQnXSA9IHJlc3VsdHMucmVzcG9uc2VbJ29iamVjdElkJ107XG4gICAgICB0aGlzLnJlc3BvbnNlID0ge1xuICAgICAgICBzdGF0dXM6IDIwMSxcbiAgICAgICAgbG9jYXRpb246IHJlc3VsdHMubG9jYXRpb24sXG4gICAgICAgIHJlc3BvbnNlOiBzZXNzaW9uRGF0YVxuICAgICAgfTtcbiAgICB9KTtcbiAgfVxufTtcblxuLy8gSGFuZGxlcyB0aGUgX0luc3RhbGxhdGlvbiBjbGFzcyBzcGVjaWFsbmVzcy5cbi8vIERvZXMgbm90aGluZyBpZiB0aGlzIGlzbid0IGFuIGluc3RhbGxhdGlvbiBvYmplY3QuXG4vLyBJZiBhbiBpbnN0YWxsYXRpb24gaXMgZm91bmQsIHRoaXMgY2FuIG11dGF0ZSB0aGlzLnF1ZXJ5IGFuZCB0dXJuIGEgY3JlYXRlXG4vLyBpbnRvIGFuIHVwZGF0ZS5cbi8vIFJldHVybnMgYSBwcm9taXNlIGZvciB3aGVuIHdlJ3JlIGRvbmUgaWYgaXQgY2FuJ3QgZmluaXNoIHRoaXMgdGljay5cblJlc3RXcml0ZS5wcm90b3R5cGUuaGFuZGxlSW5zdGFsbGF0aW9uID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLnJlc3BvbnNlIHx8IHRoaXMuY2xhc3NOYW1lICE9PSAnX0luc3RhbGxhdGlvbicpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAoIXRoaXMucXVlcnkgJiYgIXRoaXMuZGF0YS5kZXZpY2VUb2tlbiAmJiAhdGhpcy5kYXRhLmluc3RhbGxhdGlvbklkICYmICF0aGlzLmF1dGguaW5zdGFsbGF0aW9uSWQpIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoMTM1LFxuICAgICAgJ2F0IGxlYXN0IG9uZSBJRCBmaWVsZCAoZGV2aWNlVG9rZW4sIGluc3RhbGxhdGlvbklkKSAnICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgJ211c3QgYmUgc3BlY2lmaWVkIGluIHRoaXMgb3BlcmF0aW9uJyk7XG4gIH1cblxuICAvLyBJZiB0aGUgZGV2aWNlIHRva2VuIGlzIDY0IGNoYXJhY3RlcnMgbG9uZywgd2UgYXNzdW1lIGl0IGlzIGZvciBpT1NcbiAgLy8gYW5kIGxvd2VyY2FzZSBpdC5cbiAgaWYgKHRoaXMuZGF0YS5kZXZpY2VUb2tlbiAmJiB0aGlzLmRhdGEuZGV2aWNlVG9rZW4ubGVuZ3RoID09IDY0KSB7XG4gICAgdGhpcy5kYXRhLmRldmljZVRva2VuID0gdGhpcy5kYXRhLmRldmljZVRva2VuLnRvTG93ZXJDYXNlKCk7XG4gIH1cblxuICAvLyBXZSBsb3dlcmNhc2UgdGhlIGluc3RhbGxhdGlvbklkIGlmIHByZXNlbnRcbiAgaWYgKHRoaXMuZGF0YS5pbnN0YWxsYXRpb25JZCkge1xuICAgIHRoaXMuZGF0YS5pbnN0YWxsYXRpb25JZCA9IHRoaXMuZGF0YS5pbnN0YWxsYXRpb25JZC50b0xvd2VyQ2FzZSgpO1xuICB9XG5cbiAgbGV0IGluc3RhbGxhdGlvbklkID0gdGhpcy5kYXRhLmluc3RhbGxhdGlvbklkO1xuXG4gIC8vIElmIGRhdGEuaW5zdGFsbGF0aW9uSWQgaXMgbm90IHNldCBhbmQgd2UncmUgbm90IG1hc3Rlciwgd2UgY2FuIGxvb2t1cCBpbiBhdXRoXG4gIGlmICghaW5zdGFsbGF0aW9uSWQgJiYgIXRoaXMuYXV0aC5pc01hc3Rlcikge1xuICAgIGluc3RhbGxhdGlvbklkID0gdGhpcy5hdXRoLmluc3RhbGxhdGlvbklkO1xuICB9XG5cbiAgaWYgKGluc3RhbGxhdGlvbklkKSB7XG4gICAgaW5zdGFsbGF0aW9uSWQgPSBpbnN0YWxsYXRpb25JZC50b0xvd2VyQ2FzZSgpO1xuICB9XG5cbiAgLy8gVXBkYXRpbmcgX0luc3RhbGxhdGlvbiBidXQgbm90IHVwZGF0aW5nIGFueXRoaW5nIGNyaXRpY2FsXG4gIGlmICh0aGlzLnF1ZXJ5ICYmICF0aGlzLmRhdGEuZGV2aWNlVG9rZW5cbiAgICAgICAgICAgICAgICAgICYmICFpbnN0YWxsYXRpb25JZCAmJiAhdGhpcy5kYXRhLmRldmljZVR5cGUpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICB2YXIgcHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xuXG4gIHZhciBpZE1hdGNoOyAvLyBXaWxsIGJlIGEgbWF0Y2ggb24gZWl0aGVyIG9iamVjdElkIG9yIGluc3RhbGxhdGlvbklkXG4gIHZhciBvYmplY3RJZE1hdGNoO1xuICB2YXIgaW5zdGFsbGF0aW9uSWRNYXRjaDtcbiAgdmFyIGRldmljZVRva2VuTWF0Y2hlcyA9IFtdO1xuXG4gIC8vIEluc3RlYWQgb2YgaXNzdWluZyAzIHJlYWRzLCBsZXQncyBkbyBpdCB3aXRoIG9uZSBPUi5cbiAgY29uc3Qgb3JRdWVyaWVzID0gW107XG4gIGlmICh0aGlzLnF1ZXJ5ICYmIHRoaXMucXVlcnkub2JqZWN0SWQpIHtcbiAgICBvclF1ZXJpZXMucHVzaCh7XG4gICAgICBvYmplY3RJZDogdGhpcy5xdWVyeS5vYmplY3RJZFxuICAgIH0pO1xuICB9XG4gIGlmIChpbnN0YWxsYXRpb25JZCkge1xuICAgIG9yUXVlcmllcy5wdXNoKHtcbiAgICAgICdpbnN0YWxsYXRpb25JZCc6IGluc3RhbGxhdGlvbklkXG4gICAgfSk7XG4gIH1cbiAgaWYgKHRoaXMuZGF0YS5kZXZpY2VUb2tlbikge1xuICAgIG9yUXVlcmllcy5wdXNoKHsnZGV2aWNlVG9rZW4nOiB0aGlzLmRhdGEuZGV2aWNlVG9rZW59KTtcbiAgfVxuXG4gIGlmIChvclF1ZXJpZXMubGVuZ3RoID09IDApIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBwcm9taXNlID0gcHJvbWlzZS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UuZmluZCgnX0luc3RhbGxhdGlvbicsIHtcbiAgICAgICckb3InOiBvclF1ZXJpZXNcbiAgICB9LCB7fSk7XG4gIH0pLnRoZW4oKHJlc3VsdHMpID0+IHtcbiAgICByZXN1bHRzLmZvckVhY2goKHJlc3VsdCkgPT4ge1xuICAgICAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5xdWVyeS5vYmplY3RJZCAmJiByZXN1bHQub2JqZWN0SWQgPT0gdGhpcy5xdWVyeS5vYmplY3RJZCkge1xuICAgICAgICBvYmplY3RJZE1hdGNoID0gcmVzdWx0O1xuICAgICAgfVxuICAgICAgaWYgKHJlc3VsdC5pbnN0YWxsYXRpb25JZCA9PSBpbnN0YWxsYXRpb25JZCkge1xuICAgICAgICBpbnN0YWxsYXRpb25JZE1hdGNoID0gcmVzdWx0O1xuICAgICAgfVxuICAgICAgaWYgKHJlc3VsdC5kZXZpY2VUb2tlbiA9PSB0aGlzLmRhdGEuZGV2aWNlVG9rZW4pIHtcbiAgICAgICAgZGV2aWNlVG9rZW5NYXRjaGVzLnB1c2gocmVzdWx0KTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIFNhbml0eSBjaGVja3Mgd2hlbiBydW5uaW5nIGEgcXVlcnlcbiAgICBpZiAodGhpcy5xdWVyeSAmJiB0aGlzLnF1ZXJ5Lm9iamVjdElkKSB7XG4gICAgICBpZiAoIW9iamVjdElkTWF0Y2gpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsXG4gICAgICAgICAgJ09iamVjdCBub3QgZm91bmQgZm9yIHVwZGF0ZS4nKTtcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLmRhdGEuaW5zdGFsbGF0aW9uSWQgJiYgb2JqZWN0SWRNYXRjaC5pbnN0YWxsYXRpb25JZCAmJlxuICAgICAgICAgIHRoaXMuZGF0YS5pbnN0YWxsYXRpb25JZCAhPT0gb2JqZWN0SWRNYXRjaC5pbnN0YWxsYXRpb25JZCkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoMTM2LFxuICAgICAgICAgICdpbnN0YWxsYXRpb25JZCBtYXkgbm90IGJlIGNoYW5nZWQgaW4gdGhpcyAnICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ29wZXJhdGlvbicpO1xuICAgICAgfVxuICAgICAgaWYgKHRoaXMuZGF0YS5kZXZpY2VUb2tlbiAmJiBvYmplY3RJZE1hdGNoLmRldmljZVRva2VuICYmXG4gICAgICAgICAgdGhpcy5kYXRhLmRldmljZVRva2VuICE9PSBvYmplY3RJZE1hdGNoLmRldmljZVRva2VuICYmXG4gICAgICAgICAgIXRoaXMuZGF0YS5pbnN0YWxsYXRpb25JZCAmJiAhb2JqZWN0SWRNYXRjaC5pbnN0YWxsYXRpb25JZCkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoMTM2LFxuICAgICAgICAgICdkZXZpY2VUb2tlbiBtYXkgbm90IGJlIGNoYW5nZWQgaW4gdGhpcyAnICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ29wZXJhdGlvbicpO1xuICAgICAgfVxuICAgICAgaWYgKHRoaXMuZGF0YS5kZXZpY2VUeXBlICYmIHRoaXMuZGF0YS5kZXZpY2VUeXBlICYmXG4gICAgICAgICAgdGhpcy5kYXRhLmRldmljZVR5cGUgIT09IG9iamVjdElkTWF0Y2guZGV2aWNlVHlwZSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoMTM2LFxuICAgICAgICAgICdkZXZpY2VUeXBlIG1heSBub3QgYmUgY2hhbmdlZCBpbiB0aGlzICcgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnb3BlcmF0aW9uJyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5xdWVyeS5vYmplY3RJZCAmJiBvYmplY3RJZE1hdGNoKSB7XG4gICAgICBpZE1hdGNoID0gb2JqZWN0SWRNYXRjaDtcbiAgICB9XG5cbiAgICBpZiAoaW5zdGFsbGF0aW9uSWQgJiYgaW5zdGFsbGF0aW9uSWRNYXRjaCkge1xuICAgICAgaWRNYXRjaCA9IGluc3RhbGxhdGlvbklkTWF0Y2g7XG4gICAgfVxuICAgIC8vIG5lZWQgdG8gc3BlY2lmeSBkZXZpY2VUeXBlIG9ubHkgaWYgaXQncyBuZXdcbiAgICBpZiAoIXRoaXMucXVlcnkgJiYgIXRoaXMuZGF0YS5kZXZpY2VUeXBlICYmICFpZE1hdGNoKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoMTM1LFxuICAgICAgICAnZGV2aWNlVHlwZSBtdXN0IGJlIHNwZWNpZmllZCBpbiB0aGlzIG9wZXJhdGlvbicpO1xuICAgIH1cblxuICB9KS50aGVuKCgpID0+IHtcbiAgICBpZiAoIWlkTWF0Y2gpIHtcbiAgICAgIGlmICghZGV2aWNlVG9rZW5NYXRjaGVzLmxlbmd0aCkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9IGVsc2UgaWYgKGRldmljZVRva2VuTWF0Y2hlcy5sZW5ndGggPT0gMSAmJlxuICAgICAgICAoIWRldmljZVRva2VuTWF0Y2hlc1swXVsnaW5zdGFsbGF0aW9uSWQnXSB8fCAhaW5zdGFsbGF0aW9uSWQpXG4gICAgICApIHtcbiAgICAgICAgLy8gU2luZ2xlIG1hdGNoIG9uIGRldmljZSB0b2tlbiBidXQgbm9uZSBvbiBpbnN0YWxsYXRpb25JZCwgYW5kIGVpdGhlclxuICAgICAgICAvLyB0aGUgcGFzc2VkIG9iamVjdCBvciB0aGUgbWF0Y2ggaXMgbWlzc2luZyBhbiBpbnN0YWxsYXRpb25JZCwgc28gd2VcbiAgICAgICAgLy8gY2FuIGp1c3QgcmV0dXJuIHRoZSBtYXRjaC5cbiAgICAgICAgcmV0dXJuIGRldmljZVRva2VuTWF0Y2hlc1swXVsnb2JqZWN0SWQnXTtcbiAgICAgIH0gZWxzZSBpZiAoIXRoaXMuZGF0YS5pbnN0YWxsYXRpb25JZCkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoMTMyLFxuICAgICAgICAgICdNdXN0IHNwZWNpZnkgaW5zdGFsbGF0aW9uSWQgd2hlbiBkZXZpY2VUb2tlbiAnICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdtYXRjaGVzIG11bHRpcGxlIEluc3RhbGxhdGlvbiBvYmplY3RzJyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBNdWx0aXBsZSBkZXZpY2UgdG9rZW4gbWF0Y2hlcyBhbmQgd2Ugc3BlY2lmaWVkIGFuIGluc3RhbGxhdGlvbiBJRCxcbiAgICAgICAgLy8gb3IgYSBzaW5nbGUgbWF0Y2ggd2hlcmUgYm90aCB0aGUgcGFzc2VkIGFuZCBtYXRjaGluZyBvYmplY3RzIGhhdmVcbiAgICAgICAgLy8gYW4gaW5zdGFsbGF0aW9uIElELiBUcnkgY2xlYW5pbmcgb3V0IG9sZCBpbnN0YWxsYXRpb25zIHRoYXQgbWF0Y2hcbiAgICAgICAgLy8gdGhlIGRldmljZVRva2VuLCBhbmQgcmV0dXJuIG5pbCB0byBzaWduYWwgdGhhdCBhIG5ldyBvYmplY3Qgc2hvdWxkXG4gICAgICAgIC8vIGJlIGNyZWF0ZWQuXG4gICAgICAgIHZhciBkZWxRdWVyeSA9IHtcbiAgICAgICAgICAnZGV2aWNlVG9rZW4nOiB0aGlzLmRhdGEuZGV2aWNlVG9rZW4sXG4gICAgICAgICAgJ2luc3RhbGxhdGlvbklkJzoge1xuICAgICAgICAgICAgJyRuZSc6IGluc3RhbGxhdGlvbklkXG4gICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgICBpZiAodGhpcy5kYXRhLmFwcElkZW50aWZpZXIpIHtcbiAgICAgICAgICBkZWxRdWVyeVsnYXBwSWRlbnRpZmllciddID0gdGhpcy5kYXRhLmFwcElkZW50aWZpZXI7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5jb25maWcuZGF0YWJhc2UuZGVzdHJveSgnX0luc3RhbGxhdGlvbicsIGRlbFF1ZXJ5KVxuICAgICAgICAgIC5jYXRjaChlcnIgPT4ge1xuICAgICAgICAgICAgaWYgKGVyci5jb2RlID09IFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQpIHtcbiAgICAgICAgICAgICAgLy8gbm8gZGVsZXRpb25zIHdlcmUgbWFkZS4gQ2FuIGJlIGlnbm9yZWQuXG4gICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIHJldGhyb3cgdGhlIGVycm9yXG4gICAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgICAgfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKGRldmljZVRva2VuTWF0Y2hlcy5sZW5ndGggPT0gMSAmJlxuICAgICAgICAhZGV2aWNlVG9rZW5NYXRjaGVzWzBdWydpbnN0YWxsYXRpb25JZCddKSB7XG4gICAgICAgIC8vIEV4YWN0bHkgb25lIGRldmljZSB0b2tlbiBtYXRjaCBhbmQgaXQgZG9lc24ndCBoYXZlIGFuIGluc3RhbGxhdGlvblxuICAgICAgICAvLyBJRC4gVGhpcyBpcyB0aGUgb25lIGNhc2Ugd2hlcmUgd2Ugd2FudCB0byBtZXJnZSB3aXRoIHRoZSBleGlzdGluZ1xuICAgICAgICAvLyBvYmplY3QuXG4gICAgICAgIGNvbnN0IGRlbFF1ZXJ5ID0ge29iamVjdElkOiBpZE1hdGNoLm9iamVjdElkfTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlLmRlc3Ryb3koJ19JbnN0YWxsYXRpb24nLCBkZWxRdWVyeSlcbiAgICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gZGV2aWNlVG9rZW5NYXRjaGVzWzBdWydvYmplY3RJZCddO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLmNhdGNoKGVyciA9PiB7XG4gICAgICAgICAgICBpZiAoZXJyLmNvZGUgPT0gUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCkge1xuICAgICAgICAgICAgICAvLyBubyBkZWxldGlvbnMgd2VyZSBtYWRlLiBDYW4gYmUgaWdub3JlZFxuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyByZXRocm93IHRoZSBlcnJvclxuICAgICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHRoaXMuZGF0YS5kZXZpY2VUb2tlbiAmJlxuICAgICAgICAgIGlkTWF0Y2guZGV2aWNlVG9rZW4gIT0gdGhpcy5kYXRhLmRldmljZVRva2VuKSB7XG4gICAgICAgICAgLy8gV2UncmUgc2V0dGluZyB0aGUgZGV2aWNlIHRva2VuIG9uIGFuIGV4aXN0aW5nIGluc3RhbGxhdGlvbiwgc29cbiAgICAgICAgICAvLyB3ZSBzaG91bGQgdHJ5IGNsZWFuaW5nIG91dCBvbGQgaW5zdGFsbGF0aW9ucyB0aGF0IG1hdGNoIHRoaXNcbiAgICAgICAgICAvLyBkZXZpY2UgdG9rZW4uXG4gICAgICAgICAgY29uc3QgZGVsUXVlcnkgPSB7XG4gICAgICAgICAgICAnZGV2aWNlVG9rZW4nOiB0aGlzLmRhdGEuZGV2aWNlVG9rZW4sXG4gICAgICAgICAgfTtcbiAgICAgICAgICAvLyBXZSBoYXZlIGEgdW5pcXVlIGluc3RhbGwgSWQsIHVzZSB0aGF0IHRvIHByZXNlcnZlXG4gICAgICAgICAgLy8gdGhlIGludGVyZXN0aW5nIGluc3RhbGxhdGlvblxuICAgICAgICAgIGlmICh0aGlzLmRhdGEuaW5zdGFsbGF0aW9uSWQpIHtcbiAgICAgICAgICAgIGRlbFF1ZXJ5WydpbnN0YWxsYXRpb25JZCddID0ge1xuICAgICAgICAgICAgICAnJG5lJzogdGhpcy5kYXRhLmluc3RhbGxhdGlvbklkXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBlbHNlIGlmIChpZE1hdGNoLm9iamVjdElkICYmIHRoaXMuZGF0YS5vYmplY3RJZFxuICAgICAgICAgICAgICAgICAgICAmJiBpZE1hdGNoLm9iamVjdElkID09IHRoaXMuZGF0YS5vYmplY3RJZCkge1xuICAgICAgICAgICAgLy8gd2UgcGFzc2VkIGFuIG9iamVjdElkLCBwcmVzZXJ2ZSB0aGF0IGluc3RhbGF0aW9uXG4gICAgICAgICAgICBkZWxRdWVyeVsnb2JqZWN0SWQnXSA9IHtcbiAgICAgICAgICAgICAgJyRuZSc6IGlkTWF0Y2gub2JqZWN0SWRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gV2hhdCB0byBkbyBoZXJlPyBjYW4ndCByZWFsbHkgY2xlYW4gdXAgZXZlcnl0aGluZy4uLlxuICAgICAgICAgICAgcmV0dXJuIGlkTWF0Y2gub2JqZWN0SWQ7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICh0aGlzLmRhdGEuYXBwSWRlbnRpZmllcikge1xuICAgICAgICAgICAgZGVsUXVlcnlbJ2FwcElkZW50aWZpZXInXSA9IHRoaXMuZGF0YS5hcHBJZGVudGlmaWVyO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLmNvbmZpZy5kYXRhYmFzZS5kZXN0cm95KCdfSW5zdGFsbGF0aW9uJywgZGVsUXVlcnkpXG4gICAgICAgICAgICAuY2F0Y2goZXJyID0+IHtcbiAgICAgICAgICAgICAgaWYgKGVyci5jb2RlID09IFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQpIHtcbiAgICAgICAgICAgICAgICAvLyBubyBkZWxldGlvbnMgd2VyZSBtYWRlLiBDYW4gYmUgaWdub3JlZC5cbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgLy8gcmV0aHJvdyB0aGUgZXJyb3JcbiAgICAgICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gSW4gbm9uLW1lcmdlIHNjZW5hcmlvcywganVzdCByZXR1cm4gdGhlIGluc3RhbGxhdGlvbiBtYXRjaCBpZFxuICAgICAgICByZXR1cm4gaWRNYXRjaC5vYmplY3RJZDtcbiAgICAgIH1cbiAgICB9XG4gIH0pLnRoZW4oKG9iaklkKSA9PiB7XG4gICAgaWYgKG9iaklkKSB7XG4gICAgICB0aGlzLnF1ZXJ5ID0ge29iamVjdElkOiBvYmpJZH07XG4gICAgICBkZWxldGUgdGhpcy5kYXRhLm9iamVjdElkO1xuICAgICAgZGVsZXRlIHRoaXMuZGF0YS5jcmVhdGVkQXQ7XG4gICAgfVxuICAgIC8vIFRPRE86IFZhbGlkYXRlIG9wcyAoYWRkL3JlbW92ZSBvbiBjaGFubmVscywgJGluYyBvbiBiYWRnZSwgZXRjLilcbiAgfSk7XG4gIHJldHVybiBwcm9taXNlO1xufTtcblxuLy8gSWYgd2Ugc2hvcnQtY2lyY3V0ZWQgdGhlIG9iamVjdCByZXNwb25zZSAtIHRoZW4gd2UgbmVlZCB0byBtYWtlIHN1cmUgd2UgZXhwYW5kIGFsbCB0aGUgZmlsZXMsXG4vLyBzaW5jZSB0aGlzIG1pZ2h0IG5vdCBoYXZlIGEgcXVlcnksIG1lYW5pbmcgaXQgd29uJ3QgcmV0dXJuIHRoZSBmdWxsIHJlc3VsdCBiYWNrLlxuLy8gVE9ETzogKG5sdXRzZW5rbykgVGhpcyBzaG91bGQgZGllIHdoZW4gd2UgbW92ZSB0byBwZXItY2xhc3MgYmFzZWQgY29udHJvbGxlcnMgb24gX1Nlc3Npb24vX1VzZXJcblJlc3RXcml0ZS5wcm90b3R5cGUuZXhwYW5kRmlsZXNGb3JFeGlzdGluZ09iamVjdHMgPSBmdW5jdGlvbigpIHtcbiAgLy8gQ2hlY2sgd2hldGhlciB3ZSBoYXZlIGEgc2hvcnQtY2lyY3VpdGVkIHJlc3BvbnNlIC0gb25seSB0aGVuIHJ1biBleHBhbnNpb24uXG4gIGlmICh0aGlzLnJlc3BvbnNlICYmIHRoaXMucmVzcG9uc2UucmVzcG9uc2UpIHtcbiAgICB0aGlzLmNvbmZpZy5maWxlc0NvbnRyb2xsZXIuZXhwYW5kRmlsZXNJbk9iamVjdCh0aGlzLmNvbmZpZywgdGhpcy5yZXNwb25zZS5yZXNwb25zZSk7XG4gIH1cbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUucnVuRGF0YWJhc2VPcGVyYXRpb24gPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMucmVzcG9uc2UpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAodGhpcy5jbGFzc05hbWUgPT09ICdfUm9sZScpIHtcbiAgICB0aGlzLmNvbmZpZy5jYWNoZUNvbnRyb2xsZXIucm9sZS5jbGVhcigpO1xuICB9XG5cbiAgaWYgKHRoaXMuY2xhc3NOYW1lID09PSAnX1VzZXInICYmXG4gICAgICB0aGlzLnF1ZXJ5ICYmXG4gICAgICB0aGlzLmF1dGguaXNVbmF1dGhlbnRpY2F0ZWQoKSkge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5TRVNTSU9OX01JU1NJTkcsIGBDYW5ub3QgbW9kaWZ5IHVzZXIgJHt0aGlzLnF1ZXJ5Lm9iamVjdElkfS5gKTtcbiAgfVxuXG4gIGlmICh0aGlzLmNsYXNzTmFtZSA9PT0gJ19Qcm9kdWN0JyAmJiB0aGlzLmRhdGEuZG93bmxvYWQpIHtcbiAgICB0aGlzLmRhdGEuZG93bmxvYWROYW1lID0gdGhpcy5kYXRhLmRvd25sb2FkLm5hbWU7XG4gIH1cblxuICAvLyBUT0RPOiBBZGQgYmV0dGVyIGRldGVjdGlvbiBmb3IgQUNMLCBlbnN1cmluZyBhIHVzZXIgY2FuJ3QgYmUgbG9ja2VkIGZyb21cbiAgLy8gICAgICAgdGhlaXIgb3duIHVzZXIgcmVjb3JkLlxuICBpZiAodGhpcy5kYXRhLkFDTCAmJiB0aGlzLmRhdGEuQUNMWycqdW5yZXNvbHZlZCddKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfQUNMLCAnSW52YWxpZCBBQ0wuJyk7XG4gIH1cblxuICBpZiAodGhpcy5xdWVyeSkge1xuICAgIC8vIEZvcmNlIHRoZSB1c2VyIHRvIG5vdCBsb2Nrb3V0XG4gICAgLy8gTWF0Y2hlZCB3aXRoIHBhcnNlLmNvbVxuICAgIGlmICh0aGlzLmNsYXNzTmFtZSA9PT0gJ19Vc2VyJyAmJiB0aGlzLmRhdGEuQUNMICYmIHRoaXMuYXV0aC5pc01hc3RlciAhPT0gdHJ1ZSkge1xuICAgICAgdGhpcy5kYXRhLkFDTFt0aGlzLnF1ZXJ5Lm9iamVjdElkXSA9IHsgcmVhZDogdHJ1ZSwgd3JpdGU6IHRydWUgfTtcbiAgICB9XG4gICAgLy8gdXBkYXRlIHBhc3N3b3JkIHRpbWVzdGFtcCBpZiB1c2VyIHBhc3N3b3JkIGlzIGJlaW5nIGNoYW5nZWRcbiAgICBpZiAodGhpcy5jbGFzc05hbWUgPT09ICdfVXNlcicgJiYgdGhpcy5kYXRhLl9oYXNoZWRfcGFzc3dvcmQgJiYgdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kgJiYgdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRBZ2UpIHtcbiAgICAgIHRoaXMuZGF0YS5fcGFzc3dvcmRfY2hhbmdlZF9hdCA9IFBhcnNlLl9lbmNvZGUobmV3IERhdGUoKSk7XG4gICAgfVxuICAgIC8vIElnbm9yZSBjcmVhdGVkQXQgd2hlbiB1cGRhdGVcbiAgICBkZWxldGUgdGhpcy5kYXRhLmNyZWF0ZWRBdDtcblxuICAgIGxldCBkZWZlciA9IFByb21pc2UucmVzb2x2ZSgpO1xuICAgIC8vIGlmIHBhc3N3b3JkIGhpc3RvcnkgaXMgZW5hYmxlZCB0aGVuIHNhdmUgdGhlIGN1cnJlbnQgcGFzc3dvcmQgdG8gaGlzdG9yeVxuICAgIGlmICh0aGlzLmNsYXNzTmFtZSA9PT0gJ19Vc2VyJyAmJiB0aGlzLmRhdGEuX2hhc2hlZF9wYXNzd29yZCAmJiB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeSAmJiB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS5tYXhQYXNzd29yZEhpc3RvcnkpIHtcbiAgICAgIGRlZmVyID0gdGhpcy5jb25maWcuZGF0YWJhc2UuZmluZCgnX1VzZXInLCB7b2JqZWN0SWQ6IHRoaXMub2JqZWN0SWQoKX0sIHtrZXlzOiBbXCJfcGFzc3dvcmRfaGlzdG9yeVwiLCBcIl9oYXNoZWRfcGFzc3dvcmRcIl19KS50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgICBpZiAocmVzdWx0cy5sZW5ndGggIT0gMSkge1xuICAgICAgICAgIHRocm93IHVuZGVmaW5lZDtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB1c2VyID0gcmVzdWx0c1swXTtcbiAgICAgICAgbGV0IG9sZFBhc3N3b3JkcyA9IFtdO1xuICAgICAgICBpZiAodXNlci5fcGFzc3dvcmRfaGlzdG9yeSkge1xuICAgICAgICAgIG9sZFBhc3N3b3JkcyA9IF8udGFrZSh1c2VyLl9wYXNzd29yZF9oaXN0b3J5LCB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS5tYXhQYXNzd29yZEhpc3RvcnkpO1xuICAgICAgICB9XG4gICAgICAgIC8vbi0xIHBhc3N3b3JkcyBnbyBpbnRvIGhpc3RvcnkgaW5jbHVkaW5nIGxhc3QgcGFzc3dvcmRcbiAgICAgICAgd2hpbGUgKG9sZFBhc3N3b3Jkcy5sZW5ndGggPiB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS5tYXhQYXNzd29yZEhpc3RvcnkgLSAyKSB7XG4gICAgICAgICAgb2xkUGFzc3dvcmRzLnNoaWZ0KCk7XG4gICAgICAgIH1cbiAgICAgICAgb2xkUGFzc3dvcmRzLnB1c2godXNlci5wYXNzd29yZCk7XG4gICAgICAgIHRoaXMuZGF0YS5fcGFzc3dvcmRfaGlzdG9yeSA9IG9sZFBhc3N3b3JkcztcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBkZWZlci50aGVuKCgpID0+IHtcbiAgICAgIC8vIFJ1biBhbiB1cGRhdGVcbiAgICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZS51cGRhdGUodGhpcy5jbGFzc05hbWUsIHRoaXMucXVlcnksIHRoaXMuZGF0YSwgdGhpcy5ydW5PcHRpb25zKVxuICAgICAgICAudGhlbihyZXNwb25zZSA9PiB7XG4gICAgICAgICAgcmVzcG9uc2UudXBkYXRlZEF0ID0gdGhpcy51cGRhdGVkQXQ7XG4gICAgICAgICAgdGhpcy5fdXBkYXRlUmVzcG9uc2VXaXRoRGF0YShyZXNwb25zZSwgdGhpcy5kYXRhKTtcbiAgICAgICAgICB0aGlzLnJlc3BvbnNlID0geyByZXNwb25zZSB9O1xuICAgICAgICB9KTtcbiAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICAvLyBTZXQgdGhlIGRlZmF1bHQgQUNMIGFuZCBwYXNzd29yZCB0aW1lc3RhbXAgZm9yIHRoZSBuZXcgX1VzZXJcbiAgICBpZiAodGhpcy5jbGFzc05hbWUgPT09ICdfVXNlcicpIHtcbiAgICAgIHZhciBBQ0wgPSB0aGlzLmRhdGEuQUNMO1xuICAgICAgLy8gZGVmYXVsdCBwdWJsaWMgci93IEFDTFxuICAgICAgaWYgKCFBQ0wpIHtcbiAgICAgICAgQUNMID0ge307XG4gICAgICAgIEFDTFsnKiddID0geyByZWFkOiB0cnVlLCB3cml0ZTogZmFsc2UgfTtcbiAgICAgIH1cbiAgICAgIC8vIG1ha2Ugc3VyZSB0aGUgdXNlciBpcyBub3QgbG9ja2VkIGRvd25cbiAgICAgIEFDTFt0aGlzLmRhdGEub2JqZWN0SWRdID0geyByZWFkOiB0cnVlLCB3cml0ZTogdHJ1ZSB9O1xuICAgICAgdGhpcy5kYXRhLkFDTCA9IEFDTDtcbiAgICAgIC8vIHBhc3N3b3JkIHRpbWVzdGFtcCB0byBiZSB1c2VkIHdoZW4gcGFzc3dvcmQgZXhwaXJ5IHBvbGljeSBpcyBlbmZvcmNlZFxuICAgICAgaWYgKHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5ICYmIHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5Lm1heFBhc3N3b3JkQWdlKSB7XG4gICAgICAgIHRoaXMuZGF0YS5fcGFzc3dvcmRfY2hhbmdlZF9hdCA9IFBhcnNlLl9lbmNvZGUobmV3IERhdGUoKSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gUnVuIGEgY3JlYXRlXG4gICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlLmNyZWF0ZSh0aGlzLmNsYXNzTmFtZSwgdGhpcy5kYXRhLCB0aGlzLnJ1bk9wdGlvbnMpXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAodGhpcy5jbGFzc05hbWUgIT09ICdfVXNlcicgfHwgZXJyb3IuY29kZSAhPT0gUGFyc2UuRXJyb3IuRFVQTElDQVRFX1ZBTFVFKSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBRdWljayBjaGVjaywgaWYgd2Ugd2VyZSBhYmxlIHRvIGluZmVyIHRoZSBkdXBsaWNhdGVkIGZpZWxkIG5hbWVcbiAgICAgICAgaWYgKGVycm9yICYmIGVycm9yLnVzZXJJbmZvICYmIGVycm9yLnVzZXJJbmZvLmR1cGxpY2F0ZWRfZmllbGQgPT09ICd1c2VybmFtZScpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuVVNFUk5BTUVfVEFLRU4sICdBY2NvdW50IGFscmVhZHkgZXhpc3RzIGZvciB0aGlzIHVzZXJuYW1lLicpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGVycm9yICYmIGVycm9yLnVzZXJJbmZvICYmIGVycm9yLnVzZXJJbmZvLmR1cGxpY2F0ZWRfZmllbGQgPT09ICdlbWFpbCcpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuRU1BSUxfVEFLRU4sICdBY2NvdW50IGFscmVhZHkgZXhpc3RzIGZvciB0aGlzIGVtYWlsIGFkZHJlc3MuJyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBJZiB0aGlzIHdhcyBhIGZhaWxlZCB1c2VyIGNyZWF0aW9uIGR1ZSB0byB1c2VybmFtZSBvciBlbWFpbCBhbHJlYWR5IHRha2VuLCB3ZSBuZWVkIHRvXG4gICAgICAgIC8vIGNoZWNrIHdoZXRoZXIgaXQgd2FzIHVzZXJuYW1lIG9yIGVtYWlsIGFuZCByZXR1cm4gdGhlIGFwcHJvcHJpYXRlIGVycm9yLlxuICAgICAgICAvLyBGYWxsYmFjayB0byB0aGUgb3JpZ2luYWwgbWV0aG9kXG4gICAgICAgIC8vIFRPRE86IFNlZSBpZiB3ZSBjYW4gbGF0ZXIgZG8gdGhpcyB3aXRob3V0IGFkZGl0aW9uYWwgcXVlcmllcyBieSB1c2luZyBuYW1lZCBpbmRleGVzLlxuICAgICAgICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UuZmluZChcbiAgICAgICAgICB0aGlzLmNsYXNzTmFtZSxcbiAgICAgICAgICB7IHVzZXJuYW1lOiB0aGlzLmRhdGEudXNlcm5hbWUsIG9iamVjdElkOiB7JyRuZSc6IHRoaXMub2JqZWN0SWQoKX0gfSxcbiAgICAgICAgICB7IGxpbWl0OiAxIH1cbiAgICAgICAgKVxuICAgICAgICAgIC50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgICAgICAgaWYgKHJlc3VsdHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuVVNFUk5BTUVfVEFLRU4sICdBY2NvdW50IGFscmVhZHkgZXhpc3RzIGZvciB0aGlzIHVzZXJuYW1lLicpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlLmZpbmQoXG4gICAgICAgICAgICAgIHRoaXMuY2xhc3NOYW1lLFxuICAgICAgICAgICAgICB7IGVtYWlsOiB0aGlzLmRhdGEuZW1haWwsIG9iamVjdElkOiB7JyRuZSc6IHRoaXMub2JqZWN0SWQoKX0gfSxcbiAgICAgICAgICAgICAgeyBsaW1pdDogMSB9XG4gICAgICAgICAgICApO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICAgICAgICBpZiAocmVzdWx0cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5FTUFJTF9UQUtFTiwgJ0FjY291bnQgYWxyZWFkeSBleGlzdHMgZm9yIHRoaXMgZW1haWwgYWRkcmVzcy4nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUUsICdBIGR1cGxpY2F0ZSB2YWx1ZSBmb3IgYSBmaWVsZCB3aXRoIHVuaXF1ZSB2YWx1ZXMgd2FzIHByb3ZpZGVkJyk7XG4gICAgICAgICAgfSk7XG4gICAgICB9KVxuICAgICAgLnRoZW4ocmVzcG9uc2UgPT4ge1xuICAgICAgICByZXNwb25zZS5vYmplY3RJZCA9IHRoaXMuZGF0YS5vYmplY3RJZDtcbiAgICAgICAgcmVzcG9uc2UuY3JlYXRlZEF0ID0gdGhpcy5kYXRhLmNyZWF0ZWRBdDtcblxuICAgICAgICBpZiAodGhpcy5yZXNwb25zZVNob3VsZEhhdmVVc2VybmFtZSkge1xuICAgICAgICAgIHJlc3BvbnNlLnVzZXJuYW1lID0gdGhpcy5kYXRhLnVzZXJuYW1lO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX3VwZGF0ZVJlc3BvbnNlV2l0aERhdGEocmVzcG9uc2UsIHRoaXMuZGF0YSk7XG4gICAgICAgIHRoaXMucmVzcG9uc2UgPSB7XG4gICAgICAgICAgc3RhdHVzOiAyMDEsXG4gICAgICAgICAgcmVzcG9uc2UsXG4gICAgICAgICAgbG9jYXRpb246IHRoaXMubG9jYXRpb24oKVxuICAgICAgICB9O1xuICAgICAgfSk7XG4gIH1cbn07XG5cbi8vIFJldHVybnMgbm90aGluZyAtIGRvZXNuJ3Qgd2FpdCBmb3IgdGhlIHRyaWdnZXIuXG5SZXN0V3JpdGUucHJvdG90eXBlLnJ1bkFmdGVyVHJpZ2dlciA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMucmVzcG9uc2UgfHwgIXRoaXMucmVzcG9uc2UucmVzcG9uc2UpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBBdm9pZCBkb2luZyBhbnkgc2V0dXAgZm9yIHRyaWdnZXJzIGlmIHRoZXJlIGlzIG5vICdhZnRlclNhdmUnIHRyaWdnZXIgZm9yIHRoaXMgY2xhc3MuXG4gIGNvbnN0IGhhc0FmdGVyU2F2ZUhvb2sgPSB0cmlnZ2Vycy50cmlnZ2VyRXhpc3RzKHRoaXMuY2xhc3NOYW1lLCB0cmlnZ2Vycy5UeXBlcy5hZnRlclNhdmUsIHRoaXMuY29uZmlnLmFwcGxpY2F0aW9uSWQpO1xuICBjb25zdCBoYXNMaXZlUXVlcnkgPSB0aGlzLmNvbmZpZy5saXZlUXVlcnlDb250cm9sbGVyLmhhc0xpdmVRdWVyeSh0aGlzLmNsYXNzTmFtZSk7XG4gIGlmICghaGFzQWZ0ZXJTYXZlSG9vayAmJiAhaGFzTGl2ZVF1ZXJ5KSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgdmFyIGV4dHJhRGF0YSA9IHtjbGFzc05hbWU6IHRoaXMuY2xhc3NOYW1lfTtcbiAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5xdWVyeS5vYmplY3RJZCkge1xuICAgIGV4dHJhRGF0YS5vYmplY3RJZCA9IHRoaXMucXVlcnkub2JqZWN0SWQ7XG4gIH1cblxuICAvLyBCdWlsZCB0aGUgb3JpZ2luYWwgb2JqZWN0LCB3ZSBvbmx5IGRvIHRoaXMgZm9yIGEgdXBkYXRlIHdyaXRlLlxuICBsZXQgb3JpZ2luYWxPYmplY3Q7XG4gIGlmICh0aGlzLnF1ZXJ5ICYmIHRoaXMucXVlcnkub2JqZWN0SWQpIHtcbiAgICBvcmlnaW5hbE9iamVjdCA9IHRyaWdnZXJzLmluZmxhdGUoZXh0cmFEYXRhLCB0aGlzLm9yaWdpbmFsRGF0YSk7XG4gIH1cblxuICAvLyBCdWlsZCB0aGUgaW5mbGF0ZWQgb2JqZWN0LCBkaWZmZXJlbnQgZnJvbSBiZWZvcmVTYXZlLCBvcmlnaW5hbERhdGEgaXMgbm90IGVtcHR5XG4gIC8vIHNpbmNlIGRldmVsb3BlcnMgY2FuIGNoYW5nZSBkYXRhIGluIHRoZSBiZWZvcmVTYXZlLlxuICBjb25zdCB1cGRhdGVkT2JqZWN0ID0gdGhpcy5idWlsZFVwZGF0ZWRPYmplY3QoZXh0cmFEYXRhKTtcbiAgdXBkYXRlZE9iamVjdC5faGFuZGxlU2F2ZVJlc3BvbnNlKHRoaXMucmVzcG9uc2UucmVzcG9uc2UsIHRoaXMucmVzcG9uc2Uuc3RhdHVzIHx8IDIwMCk7XG5cbiAgLy8gTm90aWZpeSBMaXZlUXVlcnlTZXJ2ZXIgaWYgcG9zc2libGVcbiAgdGhpcy5jb25maWcubGl2ZVF1ZXJ5Q29udHJvbGxlci5vbkFmdGVyU2F2ZSh1cGRhdGVkT2JqZWN0LmNsYXNzTmFtZSwgdXBkYXRlZE9iamVjdCwgb3JpZ2luYWxPYmplY3QpO1xuXG4gIC8vIFJ1biBhZnRlclNhdmUgdHJpZ2dlclxuICByZXR1cm4gdHJpZ2dlcnMubWF5YmVSdW5UcmlnZ2VyKHRyaWdnZXJzLlR5cGVzLmFmdGVyU2F2ZSwgdGhpcy5hdXRoLCB1cGRhdGVkT2JqZWN0LCBvcmlnaW5hbE9iamVjdCwgdGhpcy5jb25maWcpXG4gICAgLmNhdGNoKGZ1bmN0aW9uKGVycikge1xuICAgICAgbG9nZ2VyLndhcm4oJ2FmdGVyU2F2ZSBjYXVnaHQgYW4gZXJyb3InLCBlcnIpO1xuICAgIH0pXG59O1xuXG4vLyBBIGhlbHBlciB0byBmaWd1cmUgb3V0IHdoYXQgbG9jYXRpb24gdGhpcyBvcGVyYXRpb24gaGFwcGVucyBhdC5cblJlc3RXcml0ZS5wcm90b3R5cGUubG9jYXRpb24gPSBmdW5jdGlvbigpIHtcbiAgdmFyIG1pZGRsZSA9ICh0aGlzLmNsYXNzTmFtZSA9PT0gJ19Vc2VyJyA/ICcvdXNlcnMvJyA6XG4gICAgJy9jbGFzc2VzLycgKyB0aGlzLmNsYXNzTmFtZSArICcvJyk7XG4gIHJldHVybiB0aGlzLmNvbmZpZy5tb3VudCArIG1pZGRsZSArIHRoaXMuZGF0YS5vYmplY3RJZDtcbn07XG5cbi8vIEEgaGVscGVyIHRvIGdldCB0aGUgb2JqZWN0IGlkIGZvciB0aGlzIG9wZXJhdGlvbi5cbi8vIEJlY2F1c2UgaXQgY291bGQgYmUgZWl0aGVyIG9uIHRoZSBxdWVyeSBvciBvbiB0aGUgZGF0YVxuUmVzdFdyaXRlLnByb3RvdHlwZS5vYmplY3RJZCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5kYXRhLm9iamVjdElkIHx8IHRoaXMucXVlcnkub2JqZWN0SWQ7XG59O1xuXG4vLyBSZXR1cm5zIGEgY29weSBvZiB0aGUgZGF0YSBhbmQgZGVsZXRlIGJhZCBrZXlzIChfYXV0aF9kYXRhLCBfaGFzaGVkX3Bhc3N3b3JkLi4uKVxuUmVzdFdyaXRlLnByb3RvdHlwZS5zYW5pdGl6ZWREYXRhID0gZnVuY3Rpb24oKSB7XG4gIGNvbnN0IGRhdGEgPSBPYmplY3Qua2V5cyh0aGlzLmRhdGEpLnJlZHVjZSgoZGF0YSwga2V5KSA9PiB7XG4gICAgLy8gUmVnZXhwIGNvbWVzIGZyb20gUGFyc2UuT2JqZWN0LnByb3RvdHlwZS52YWxpZGF0ZVxuICAgIGlmICghKC9eW0EtWmEtel1bMC05QS1aYS16X10qJC8pLnRlc3Qoa2V5KSkge1xuICAgICAgZGVsZXRlIGRhdGFba2V5XTtcbiAgICB9XG4gICAgcmV0dXJuIGRhdGE7XG4gIH0sIGRlZXBjb3B5KHRoaXMuZGF0YSkpO1xuICByZXR1cm4gUGFyc2UuX2RlY29kZSh1bmRlZmluZWQsIGRhdGEpO1xufVxuXG4vLyBSZXR1cm5zIGFuIHVwZGF0ZWQgY29weSBvZiB0aGUgb2JqZWN0XG5SZXN0V3JpdGUucHJvdG90eXBlLmJ1aWxkVXBkYXRlZE9iamVjdCA9IGZ1bmN0aW9uIChleHRyYURhdGEpIHtcbiAgY29uc3QgdXBkYXRlZE9iamVjdCA9IHRyaWdnZXJzLmluZmxhdGUoZXh0cmFEYXRhLCB0aGlzLm9yaWdpbmFsRGF0YSk7XG4gIE9iamVjdC5rZXlzKHRoaXMuZGF0YSkucmVkdWNlKGZ1bmN0aW9uIChkYXRhLCBrZXkpIHtcbiAgICBpZiAoa2V5LmluZGV4T2YoXCIuXCIpID4gMCkge1xuICAgICAgLy8gc3ViZG9jdW1lbnQga2V5IHdpdGggZG90IG5vdGF0aW9uICgneC55Jzp2ID0+ICd4Jzp7J3knOnZ9KVxuICAgICAgY29uc3Qgc3BsaXR0ZWRLZXkgPSBrZXkuc3BsaXQoXCIuXCIpO1xuICAgICAgY29uc3QgcGFyZW50UHJvcCA9IHNwbGl0dGVkS2V5WzBdO1xuICAgICAgbGV0IHBhcmVudFZhbCA9IHVwZGF0ZWRPYmplY3QuZ2V0KHBhcmVudFByb3ApO1xuICAgICAgaWYodHlwZW9mIHBhcmVudFZhbCAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgcGFyZW50VmFsID0ge307XG4gICAgICB9XG4gICAgICBwYXJlbnRWYWxbc3BsaXR0ZWRLZXlbMV1dID0gZGF0YVtrZXldO1xuICAgICAgdXBkYXRlZE9iamVjdC5zZXQocGFyZW50UHJvcCwgcGFyZW50VmFsKTtcbiAgICAgIGRlbGV0ZSBkYXRhW2tleV07XG4gICAgfVxuICAgIHJldHVybiBkYXRhO1xuICB9LCBkZWVwY29weSh0aGlzLmRhdGEpKTtcblxuICB1cGRhdGVkT2JqZWN0LnNldCh0aGlzLnNhbml0aXplZERhdGEoKSk7XG4gIHJldHVybiB1cGRhdGVkT2JqZWN0O1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5jbGVhblVzZXJBdXRoRGF0YSA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5yZXNwb25zZSAmJiB0aGlzLnJlc3BvbnNlLnJlc3BvbnNlICYmIHRoaXMuY2xhc3NOYW1lID09PSAnX1VzZXInKSB7XG4gICAgY29uc3QgdXNlciA9IHRoaXMucmVzcG9uc2UucmVzcG9uc2U7XG4gICAgaWYgKHVzZXIuYXV0aERhdGEpIHtcbiAgICAgIE9iamVjdC5rZXlzKHVzZXIuYXV0aERhdGEpLmZvckVhY2goKHByb3ZpZGVyKSA9PiB7XG4gICAgICAgIGlmICh1c2VyLmF1dGhEYXRhW3Byb3ZpZGVyXSA9PT0gbnVsbCkge1xuICAgICAgICAgIGRlbGV0ZSB1c2VyLmF1dGhEYXRhW3Byb3ZpZGVyXTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBpZiAoT2JqZWN0LmtleXModXNlci5hdXRoRGF0YSkubGVuZ3RoID09IDApIHtcbiAgICAgICAgZGVsZXRlIHVzZXIuYXV0aERhdGE7XG4gICAgICB9XG4gICAgfVxuICB9XG59O1xuXG5SZXN0V3JpdGUucHJvdG90eXBlLl91cGRhdGVSZXNwb25zZVdpdGhEYXRhID0gZnVuY3Rpb24ocmVzcG9uc2UsIGRhdGEpIHtcbiAgaWYgKF8uaXNFbXB0eSh0aGlzLnN0b3JhZ2UuZmllbGRzQ2hhbmdlZEJ5VHJpZ2dlcikpIHtcbiAgICByZXR1cm4gcmVzcG9uc2U7XG4gIH1cbiAgY29uc3QgY2xpZW50U3VwcG9ydHNEZWxldGUgPSBDbGllbnRTREsuc3VwcG9ydHNGb3J3YXJkRGVsZXRlKHRoaXMuY2xpZW50U0RLKTtcbiAgdGhpcy5zdG9yYWdlLmZpZWxkc0NoYW5nZWRCeVRyaWdnZXIuZm9yRWFjaChmaWVsZE5hbWUgPT4ge1xuICAgIGNvbnN0IGRhdGFWYWx1ZSA9IGRhdGFbZmllbGROYW1lXTtcblxuICAgIGlmKCFyZXNwb25zZS5oYXNPd25Qcm9wZXJ0eShmaWVsZE5hbWUpKSB7XG4gICAgICByZXNwb25zZVtmaWVsZE5hbWVdID0gZGF0YVZhbHVlO1xuICAgIH1cblxuICAgIC8vIFN0cmlwcyBvcGVyYXRpb25zIGZyb20gcmVzcG9uc2VzXG4gICAgaWYgKHJlc3BvbnNlW2ZpZWxkTmFtZV0gJiYgcmVzcG9uc2VbZmllbGROYW1lXS5fX29wKSB7XG4gICAgICBkZWxldGUgcmVzcG9uc2VbZmllbGROYW1lXTtcbiAgICAgIGlmIChjbGllbnRTdXBwb3J0c0RlbGV0ZSAmJiBkYXRhVmFsdWUuX19vcCA9PSAnRGVsZXRlJykge1xuICAgICAgICByZXNwb25zZVtmaWVsZE5hbWVdID0gZGF0YVZhbHVlO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG4gIHJldHVybiByZXNwb25zZTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgUmVzdFdyaXRlO1xubW9kdWxlLmV4cG9ydHMgPSBSZXN0V3JpdGU7XG4iXX0=