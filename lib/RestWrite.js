"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _RestQuery = _interopRequireDefault(require("./RestQuery"));

var _lodash = _interopRequireDefault(require("lodash"));

var _logger = _interopRequireDefault(require("./logger"));

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
  this.context = {};
  const allowObjectId = options && options.allowObjectId === true;

  if (!query && data.objectId && !allowObjectId) {
    throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'objectId is an invalid field name.');
  } // When the operation is complete, this.response may have several
  // fields.
  // response: the actual data to be returned
  // status: the http status code. if not present, treated like a 200
  // location: the location header. if not present, no location header


  this.response = null; // Processing this operation may mutate our data, so we operate on a
  // copy

  this.query = deepcopy(query);
  this.data = deepcopy(data); // We never change originalData, so we do not need a deep copy

  this.originalData = originalData; // The timestamp we'll use for this whole operation

  this.updatedAt = Parse._encode(new Date()).iso;
} // A convenient method to perform all the steps of processing the
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
    return this.runBeforeSaveTrigger();
  }).then(() => {
    return this.deleteEmailResetTokenIfNeeded();
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
    return this.runAfterSaveTrigger();
  }).then(() => {
    return this.cleanUserAuthData();
  }).then(() => {
    return this.response;
  });
}; // Uses the Auth object to get the list of roles, adds the user id


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
}; // Validates this operation against the allowClientClassCreation config.


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
}; // Validates this operation against the schema.


RestWrite.prototype.validateSchema = function () {
  return this.config.database.validateObject(this.className, this.data, this.query, this.runOptions);
}; // Runs any beforeSave triggers against this operation.
// Any change leads to our data being mutated.


RestWrite.prototype.runBeforeSaveTrigger = function () {
  if (this.response) {
    return;
  } // Avoid doing any setup for triggers if there is no 'beforeSave' trigger for this class.


  if (!triggers.triggerExists(this.className, triggers.Types.beforeSave, this.config.applicationId)) {
    return Promise.resolve();
  } // Cloud code gets a bit of extra data for its objects


  var extraData = {
    className: this.className
  };

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
    // Before calling the trigger, validate the permissions for the save operation
    let databasePromise = null;

    if (this.query) {
      // Validate for updating
      databasePromise = this.config.database.update(this.className, this.query, this.data, this.runOptions, false, true);
    } else {
      // Validate for creating
      databasePromise = this.config.database.create(this.className, this.data, this.runOptions, true);
    } // In the case that there is no permission for the operation, it throws an error


    return databasePromise.then(result => {
      if (!result || result.length <= 0) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Object not found.');
      }
    });
  }).then(() => {
    return triggers.maybeRunTrigger(triggers.Types.beforeSave, this.auth, updatedObject, originalObject, this.config, this.context);
  }).then(response => {
    if (response && response.object) {
      this.storage.fieldsChangedByTrigger = _lodash.default.reduce(response.object, (result, value, key) => {
        if (!_lodash.default.isEqual(this.data[key], value)) {
          result.push(key);
        }

        return result;
      }, []);
      this.data = response.object; // We should delete the objectId for an update write

      if (this.query && this.query.objectId) {
        delete this.data.objectId;
      }
    }
  });
};

RestWrite.prototype.runBeforeLoginTrigger = async function (userData) {
  // Avoid doing any setup for triggers if there is no 'beforeLogin' trigger
  if (!triggers.triggerExists(this.className, triggers.Types.beforeLogin, this.config.applicationId)) {
    return;
  } // Cloud code gets a bit of extra data for its objects


  const extraData = {
    className: this.className
  };
  const user = triggers.inflate(extraData, userData); // no need to return a response

  await triggers.maybeRunTrigger(triggers.Types.beforeLogin, this.auth, user, null, this.config, this.context);
};

RestWrite.prototype.setRequiredFieldsIfNeeded = function () {
  if (this.data) {
    // Add default fields
    this.data.updatedAt = this.updatedAt;

    if (!this.query) {
      this.data.createdAt = this.updatedAt; // Only assign new objectId if we are creating new object

      if (!this.data.objectId) {
        this.data.objectId = cryptoUtils.newObjectId(this.config.objectIdSize);
      }
    }
  }

  return Promise.resolve();
}; // Transforms auth data for a user object.
// Does nothing if this isn't a user object.
// Returns a promise for when we're done if it can't finish this tick.


RestWrite.prototype.validateAuthData = function () {
  if (this.className !== '_User') {
    return;
  }

  if (!this.query && !this.data.authData) {
    if (typeof this.data.username !== 'string' || _lodash.default.isEmpty(this.data.username)) {
      throw new Parse.Error(Parse.Error.USERNAME_MISSING, 'bad or missing username');
    }

    if (typeof this.data.password !== 'string' || _lodash.default.isEmpty(this.data.password)) {
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
    findPromise = this.config.database.find(this.className, {
      $or: query
    }, {});
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
    } // Regular users that have been locked out.


    return object.ACL && Object.keys(object.ACL).length > 0;
  });
};

RestWrite.prototype.handleAuthData = function (authData) {
  let results;
  return this.findUsersWithAuthData(authData).then(async r => {
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

        if (!_lodash.default.isEqual(providerData, userAuthData)) {
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
        delete results[0].password; // need to set the objectId first otherwise location has trailing undefined

        this.data.objectId = userResult.objectId;

        if (!this.query || !this.query.objectId) {
          // this a login call, no userId passed
          this.response = {
            response: userResult,
            location: this.location()
          }; // Run beforeLogin hook before storing any updates
          // to authData on the db; changes to userResult
          // will be ignored.

          await this.runBeforeLoginTrigger(deepcopy(userResult));
        } // If we didn't change the auth data, just keep going


        if (!hasMutatedAuthData) {
          return;
        } // We have authData that is updated on login
        // that can happen when token are refreshed,
        // We should update the token and let the user in
        // We should only check the mutated keys


        return this.handleAuthDataValidation(mutatedAuthData).then(async () => {
          // IF we have a response, we'll skip the database operation / beforeSave / afterSave etc...
          // we need to set it up there.
          // We are supposed to have a response only on LOGIN with authData, so we skip those
          // If we're not logging in, but just updating the current user, we can safely skip that part
          if (this.response) {
            // Assign the new authData in the response
            Object.keys(mutatedAuthData).forEach(provider => {
              this.response.response.authData[provider] = mutatedAuthData[provider];
            }); // Run the DB update directly, as 'master'
            // Just update the authData part
            // Then we're good for the user, early exit of sorts

            return this.config.database.update(this.className, {
              objectId: this.data.objectId
            }, {
              authData: mutatedAuthData
            }, {});
          }
        });
      } else if (userId) {
        // Trying to update auth data but users
        // are different
        if (userResult.objectId !== userId) {
          throw new Parse.Error(Parse.Error.ACCOUNT_ALREADY_LINKED, 'this auth is already used');
        } // No auth data was mutated, just keep going


        if (!hasMutatedAuthData) {
          return;
        }
      }
    }

    return this.handleAuthDataValidation(authData);
  });
}; // The non-third-party parts of User transformation


RestWrite.prototype.transformUser = function () {
  var promise = Promise.resolve();

  if (this.className !== '_User') {
    return promise;
  }

  if (!this.auth.isMaster && 'emailVerified' in this.data) {
    const error = `Clients aren't allowed to manually update email verification.`;
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, error);
  } // Do not cleanup session if objectId is not set


  if (this.query && this.objectId()) {
    // If we're updating a _User object, we need to clear out the cache for that user. Find all their
    // session tokens, and remove them from the cache.
    promise = new _RestQuery.default(this.config, Auth.master(this.config), '_Session', {
      user: {
        __type: 'Pointer',
        className: '_User',
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
      this.storage['clearSessions'] = true; // Generate a new session only if the user requested

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
  } // We need to a find to check for duplicate username in case they are missing the unique index on usernames
  // TODO: Check if there is a unique index, and if so, skip this query.


  return this.config.database.find(this.className, {
    username: this.data.username,
    objectId: {
      $ne: this.objectId()
    }
  }, {
    limit: 1
  }).then(results => {
    if (results.length > 0) {
      throw new Parse.Error(Parse.Error.USERNAME_TAKEN, 'Account already exists for this username.');
    }

    return;
  });
};

RestWrite.prototype._validateEmail = function () {
  if (!this.data.email || this.data.email.__op === 'Delete') {
    return Promise.resolve();
  } // Validate basic email address format


  if (!this.data.email.match(/^.+@.+$/)) {
    return Promise.reject(new Parse.Error(Parse.Error.INVALID_EMAIL_ADDRESS, 'Email address format is invalid.'));
  } // Same problem for email as above for username


  return this.config.database.find(this.className, {
    email: this.data.email,
    objectId: {
      $ne: this.objectId()
    }
  }, {
    limit: 1
  }).then(results => {
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
  // If we specified a custom error in our configuration use it.
  // Example: "Passwords must include a Capital Letter, Lowercase Letter, and a number."
  //
  // This is especially useful on the generic "password reset" page,
  // as it allows the programmer to communicate specific requirements instead of:
  // a. making the user guess whats wrong
  // b. making a custom password reset page that shows the requirements
  const policyError = this.config.passwordPolicy.validationError ? this.config.passwordPolicy.validationError : 'Password does not meet the Password Policy requirements.';
  const containsUsernameError = 'Password cannot contain your username.'; // check whether the password meets the password strength requirements

  if (this.config.passwordPolicy.patternValidator && !this.config.passwordPolicy.patternValidator(this.data.password) || this.config.passwordPolicy.validatorCallback && !this.config.passwordPolicy.validatorCallback(this.data.password)) {
    return Promise.reject(new Parse.Error(Parse.Error.VALIDATION_ERROR, policyError));
  } // check whether password contain username


  if (this.config.passwordPolicy.doNotAllowUsername === true) {
    if (this.data.username) {
      // username is not passed during password reset
      if (this.data.password.indexOf(this.data.username) >= 0) return Promise.reject(new Parse.Error(Parse.Error.VALIDATION_ERROR, containsUsernameError));
    } else {
      // retrieve the User object using objectId during password reset
      return this.config.database.find('_User', {
        objectId: this.objectId()
      }).then(results => {
        if (results.length != 1) {
          throw undefined;
        }

        if (this.data.password.indexOf(results[0].username) >= 0) return Promise.reject(new Parse.Error(Parse.Error.VALIDATION_ERROR, containsUsernameError));
        return Promise.resolve();
      });
    }
  }

  return Promise.resolve();
};

RestWrite.prototype._validatePasswordHistory = function () {
  // check whether password is repeating from specified history
  if (this.query && this.config.passwordPolicy.maxPasswordHistory) {
    return this.config.database.find('_User', {
      objectId: this.objectId()
    }, {
      keys: ['_password_history', '_hashed_password']
    }).then(results => {
      if (results.length != 1) {
        throw undefined;
      }

      const user = results[0];
      let oldPasswords = [];
      if (user._password_history) oldPasswords = _lodash.default.take(user._password_history, this.config.passwordPolicy.maxPasswordHistory - 1);
      oldPasswords.push(user.password);
      const newPassword = this.data.password; // compare the new password hash with all old password hashes

      const promises = oldPasswords.map(function (hash) {
        return passwordCrypto.compare(newPassword, hash).then(result => {
          if (result) // reject if there is a match
            return Promise.reject('REPEAT_PASSWORD');
          return Promise.resolve();
        });
      }); // wait for all comparisons to complete

      return Promise.all(promises).then(() => {
        return Promise.resolve();
      }).catch(err => {
        if (err === 'REPEAT_PASSWORD') // a match was found
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

  if (!this.storage['authProvider'] && // signup call, with
  this.config.preventLoginWithUnverifiedEmail && // no login without verification
  this.config.verifyUserEmails) {
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
      action: this.storage['authProvider'] ? 'login' : 'signup',
      authProvider: this.storage['authProvider'] || 'password'
    },
    installationId: this.auth.installationId
  });

  if (this.response && this.response.response) {
    this.response.response.sessionToken = sessionData.sessionToken;
  }

  return createSession();
}; // Delete email reset tokens if user is changing password or email.


RestWrite.prototype.deleteEmailResetTokenIfNeeded = function () {
  if (this.className !== '_User' || this.query === null) {
    // null query means create
    return;
  }

  if ('password' in this.data || 'email' in this.data) {
    const addOps = {
      _perishable_token: {
        __op: 'Delete'
      },
      _perishable_token_expires_at: {
        __op: 'Delete'
      }
    };
    this.data = Object.assign(this.data, addOps);
  }
};

RestWrite.prototype.destroyDuplicatedSessions = function () {
  // Only for _Session, and at creation time
  if (this.className != '_Session' || this.query) {
    return;
  } // Destroy the sessions in 'Background'


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
    sessionToken: {
      $ne: sessionToken
    }
  });
}; // Handles any followup logic


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
    delete this.storage['sendVerificationEmail']; // Fire and forget!

    this.config.userController.sendVerificationEmail(this.data);
    return this.handleFollowup.bind(this);
  }
}; // Handles the _Session class specialness.
// Does nothing if this isn't an _Session object.


RestWrite.prototype.handleSession = function () {
  if (this.response || this.className !== '_Session') {
    return;
  }

  if (!this.auth.user && !this.auth.isMaster) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Session token required.');
  } // TODO: Verify proper error to throw


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

    const {
      sessionData,
      createSession
    } = Auth.createSession(this.config, {
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
}; // Handles the _Installation class specialness.
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
  } // If the device token is 64 characters long, we assume it is for iOS
  // and lowercase it.


  if (this.data.deviceToken && this.data.deviceToken.length == 64) {
    this.data.deviceToken = this.data.deviceToken.toLowerCase();
  } // We lowercase the installationId if present


  if (this.data.installationId) {
    this.data.installationId = this.data.installationId.toLowerCase();
  }

  let installationId = this.data.installationId; // If data.installationId is not set and we're not master, we can lookup in auth

  if (!installationId && !this.auth.isMaster) {
    installationId = this.auth.installationId;
  }

  if (installationId) {
    installationId = installationId.toLowerCase();
  } // Updating _Installation but not updating anything critical


  if (this.query && !this.data.deviceToken && !installationId && !this.data.deviceType) {
    return;
  }

  var promise = Promise.resolve();
  var idMatch; // Will be a match on either objectId or installationId

  var objectIdMatch;
  var installationIdMatch;
  var deviceTokenMatches = []; // Instead of issuing 3 reads, let's do it with one OR.

  const orQueries = [];

  if (this.query && this.query.objectId) {
    orQueries.push({
      objectId: this.query.objectId
    });
  }

  if (installationId) {
    orQueries.push({
      installationId: installationId
    });
  }

  if (this.data.deviceToken) {
    orQueries.push({
      deviceToken: this.data.deviceToken
    });
  }

  if (orQueries.length == 0) {
    return;
  }

  promise = promise.then(() => {
    return this.config.database.find('_Installation', {
      $or: orQueries
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
    }); // Sanity checks when running a query

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
    } // need to specify deviceType only if it's new


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
          deviceToken: this.data.deviceToken,
          installationId: {
            $ne: installationId
          }
        };

        if (this.data.appIdentifier) {
          delQuery['appIdentifier'] = this.data.appIdentifier;
        }

        this.config.database.destroy('_Installation', delQuery).catch(err => {
          if (err.code == Parse.Error.OBJECT_NOT_FOUND) {
            // no deletions were made. Can be ignored.
            return;
          } // rethrow the error


          throw err;
        });
        return;
      }
    } else {
      if (deviceTokenMatches.length == 1 && !deviceTokenMatches[0]['installationId']) {
        // Exactly one device token match and it doesn't have an installation
        // ID. This is the one case where we want to merge with the existing
        // object.
        const delQuery = {
          objectId: idMatch.objectId
        };
        return this.config.database.destroy('_Installation', delQuery).then(() => {
          return deviceTokenMatches[0]['objectId'];
        }).catch(err => {
          if (err.code == Parse.Error.OBJECT_NOT_FOUND) {
            // no deletions were made. Can be ignored
            return;
          } // rethrow the error


          throw err;
        });
      } else {
        if (this.data.deviceToken && idMatch.deviceToken != this.data.deviceToken) {
          // We're setting the device token on an existing installation, so
          // we should try cleaning out old installations that match this
          // device token.
          const delQuery = {
            deviceToken: this.data.deviceToken
          }; // We have a unique install Id, use that to preserve
          // the interesting installation

          if (this.data.installationId) {
            delQuery['installationId'] = {
              $ne: this.data.installationId
            };
          } else if (idMatch.objectId && this.data.objectId && idMatch.objectId == this.data.objectId) {
            // we passed an objectId, preserve that instalation
            delQuery['objectId'] = {
              $ne: idMatch.objectId
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
            } // rethrow the error


            throw err;
          });
        } // In non-merge scenarios, just return the installation match id


        return idMatch.objectId;
      }
    }
  }).then(objId => {
    if (objId) {
      this.query = {
        objectId: objId
      };
      delete this.data.objectId;
      delete this.data.createdAt;
    } // TODO: Validate ops (add/remove on channels, $inc on badge, etc.)

  });
  return promise;
}; // If we short-circuted the object response - then we need to make sure we expand all the files,
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
  } // TODO: Add better detection for ACL, ensuring a user can't be locked from
  //       their own user record.


  if (this.data.ACL && this.data.ACL['*unresolved']) {
    throw new Parse.Error(Parse.Error.INVALID_ACL, 'Invalid ACL.');
  }

  if (this.query) {
    // Force the user to not lockout
    // Matched with parse.com
    if (this.className === '_User' && this.data.ACL && this.auth.isMaster !== true) {
      this.data.ACL[this.query.objectId] = {
        read: true,
        write: true
      };
    } // update password timestamp if user password is being changed


    if (this.className === '_User' && this.data._hashed_password && this.config.passwordPolicy && this.config.passwordPolicy.maxPasswordAge) {
      this.data._password_changed_at = Parse._encode(new Date());
    } // Ignore createdAt when update


    delete this.data.createdAt;
    let defer = Promise.resolve(); // if password history is enabled then save the current password to history

    if (this.className === '_User' && this.data._hashed_password && this.config.passwordPolicy && this.config.passwordPolicy.maxPasswordHistory) {
      defer = this.config.database.find('_User', {
        objectId: this.objectId()
      }, {
        keys: ['_password_history', '_hashed_password']
      }).then(results => {
        if (results.length != 1) {
          throw undefined;
        }

        const user = results[0];
        let oldPasswords = [];

        if (user._password_history) {
          oldPasswords = _lodash.default.take(user._password_history, this.config.passwordPolicy.maxPasswordHistory);
        } //n-1 passwords go into history including last password


        while (oldPasswords.length > Math.max(0, this.config.passwordPolicy.maxPasswordHistory - 2)) {
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

        this.response = {
          response
        };
      });
    });
  } else {
    // Set the default ACL and password timestamp for the new _User
    if (this.className === '_User') {
      var ACL = this.data.ACL; // default public r/w ACL

      if (!ACL) {
        ACL = {};
        ACL['*'] = {
          read: true,
          write: false
        };
      } // make sure the user is not locked down


      ACL[this.data.objectId] = {
        read: true,
        write: true
      };
      this.data.ACL = ACL; // password timestamp to be used when password expiry policy is enforced

      if (this.config.passwordPolicy && this.config.passwordPolicy.maxPasswordAge) {
        this.data._password_changed_at = Parse._encode(new Date());
      }
    } // Run a create


    return this.config.database.create(this.className, this.data, this.runOptions).catch(error => {
      if (this.className !== '_User' || error.code !== Parse.Error.DUPLICATE_VALUE) {
        throw error;
      } // Quick check, if we were able to infer the duplicated field name


      if (error && error.userInfo && error.userInfo.duplicated_field === 'username') {
        throw new Parse.Error(Parse.Error.USERNAME_TAKEN, 'Account already exists for this username.');
      }

      if (error && error.userInfo && error.userInfo.duplicated_field === 'email') {
        throw new Parse.Error(Parse.Error.EMAIL_TAKEN, 'Account already exists for this email address.');
      } // If this was a failed user creation due to username or email already taken, we need to
      // check whether it was username or email and return the appropriate error.
      // Fallback to the original method
      // TODO: See if we can later do this without additional queries by using named indexes.


      return this.config.database.find(this.className, {
        username: this.data.username,
        objectId: {
          $ne: this.objectId()
        }
      }, {
        limit: 1
      }).then(results => {
        if (results.length > 0) {
          throw new Parse.Error(Parse.Error.USERNAME_TAKEN, 'Account already exists for this username.');
        }

        return this.config.database.find(this.className, {
          email: this.data.email,
          objectId: {
            $ne: this.objectId()
          }
        }, {
          limit: 1
        });
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
}; // Returns nothing - doesn't wait for the trigger.


RestWrite.prototype.runAfterSaveTrigger = function () {
  if (!this.response || !this.response.response) {
    return;
  } // Avoid doing any setup for triggers if there is no 'afterSave' trigger for this class.


  const hasAfterSaveHook = triggers.triggerExists(this.className, triggers.Types.afterSave, this.config.applicationId);
  const hasLiveQuery = this.config.liveQueryController.hasLiveQuery(this.className);

  if (!hasAfterSaveHook && !hasLiveQuery) {
    return Promise.resolve();
  }

  var extraData = {
    className: this.className
  };

  if (this.query && this.query.objectId) {
    extraData.objectId = this.query.objectId;
  } // Build the original object, we only do this for a update write.


  let originalObject;

  if (this.query && this.query.objectId) {
    originalObject = triggers.inflate(extraData, this.originalData);
  } // Build the inflated object, different from beforeSave, originalData is not empty
  // since developers can change data in the beforeSave.


  const updatedObject = this.buildUpdatedObject(extraData);

  updatedObject._handleSaveResponse(this.response.response, this.response.status || 200);

  this.config.database.loadSchema().then(schemaController => {
    // Notifiy LiveQueryServer if possible
    const perms = schemaController.getClassLevelPermissions(updatedObject.className);
    this.config.liveQueryController.onAfterSave(updatedObject.className, updatedObject, originalObject, perms);
  }); // Run afterSave trigger

  return triggers.maybeRunTrigger(triggers.Types.afterSave, this.auth, updatedObject, originalObject, this.config, this.context).catch(function (err) {
    _logger.default.warn('afterSave caught an error', err);
  });
}; // A helper to figure out what location this operation happens at.


RestWrite.prototype.location = function () {
  var middle = this.className === '_User' ? '/users/' : '/classes/' + this.className + '/';
  return this.config.mount + middle + this.data.objectId;
}; // A helper to get the object id for this operation.
// Because it could be either on the query or on the data


RestWrite.prototype.objectId = function () {
  return this.data.objectId || this.query.objectId;
}; // Returns a copy of the data and delete bad keys (_auth_data, _hashed_password...)


RestWrite.prototype.sanitizedData = function () {
  const data = Object.keys(this.data).reduce((data, key) => {
    // Regexp comes from Parse.Object.prototype.validate
    if (!/^[A-Za-z][0-9A-Za-z_]*$/.test(key)) {
      delete data[key];
    }

    return data;
  }, deepcopy(this.data));
  return Parse._decode(undefined, data);
}; // Returns an updated copy of the object


RestWrite.prototype.buildUpdatedObject = function (extraData) {
  const updatedObject = triggers.inflate(extraData, this.originalData);
  Object.keys(this.data).reduce(function (data, key) {
    if (key.indexOf('.') > 0) {
      // subdocument key with dot notation ('x.y':v => 'x':{'y':v})
      const splittedKey = key.split('.');
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
  if (_lodash.default.isEmpty(this.storage.fieldsChangedByTrigger)) {
    return response;
  }

  const clientSupportsDelete = ClientSDK.supportsForwardDelete(this.clientSDK);
  this.storage.fieldsChangedByTrigger.forEach(fieldName => {
    const dataValue = data[fieldName];

    if (!response.hasOwnProperty(fieldName)) {
      response[fieldName] = dataValue;
    } // Strips operations from responses


    if (response[fieldName] && response[fieldName].__op) {
      delete response[fieldName];

      if (clientSupportsDelete && dataValue.__op == 'Delete') {
        response[fieldName] = dataValue;
      }
    }
  });
  return response;
};

var _default = RestWrite;
exports.default = _default;
module.exports = RestWrite;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9SZXN0V3JpdGUuanMiXSwibmFtZXMiOlsiU2NoZW1hQ29udHJvbGxlciIsInJlcXVpcmUiLCJkZWVwY29weSIsIkF1dGgiLCJjcnlwdG9VdGlscyIsInBhc3N3b3JkQ3J5cHRvIiwiUGFyc2UiLCJ0cmlnZ2VycyIsIkNsaWVudFNESyIsIlJlc3RXcml0ZSIsImNvbmZpZyIsImF1dGgiLCJjbGFzc05hbWUiLCJxdWVyeSIsImRhdGEiLCJvcmlnaW5hbERhdGEiLCJjbGllbnRTREsiLCJvcHRpb25zIiwiaXNSZWFkT25seSIsIkVycm9yIiwiT1BFUkFUSU9OX0ZPUkJJRERFTiIsInN0b3JhZ2UiLCJydW5PcHRpb25zIiwiY29udGV4dCIsImFsbG93T2JqZWN0SWQiLCJvYmplY3RJZCIsIklOVkFMSURfS0VZX05BTUUiLCJyZXNwb25zZSIsInVwZGF0ZWRBdCIsIl9lbmNvZGUiLCJEYXRlIiwiaXNvIiwicHJvdG90eXBlIiwiZXhlY3V0ZSIsIlByb21pc2UiLCJyZXNvbHZlIiwidGhlbiIsImdldFVzZXJBbmRSb2xlQUNMIiwidmFsaWRhdGVDbGllbnRDbGFzc0NyZWF0aW9uIiwiaGFuZGxlSW5zdGFsbGF0aW9uIiwiaGFuZGxlU2Vzc2lvbiIsInZhbGlkYXRlQXV0aERhdGEiLCJydW5CZWZvcmVTYXZlVHJpZ2dlciIsImRlbGV0ZUVtYWlsUmVzZXRUb2tlbklmTmVlZGVkIiwidmFsaWRhdGVTY2hlbWEiLCJzZXRSZXF1aXJlZEZpZWxkc0lmTmVlZGVkIiwidHJhbnNmb3JtVXNlciIsImV4cGFuZEZpbGVzRm9yRXhpc3RpbmdPYmplY3RzIiwiZGVzdHJveUR1cGxpY2F0ZWRTZXNzaW9ucyIsInJ1bkRhdGFiYXNlT3BlcmF0aW9uIiwiY3JlYXRlU2Vzc2lvblRva2VuSWZOZWVkZWQiLCJoYW5kbGVGb2xsb3d1cCIsInJ1bkFmdGVyU2F2ZVRyaWdnZXIiLCJjbGVhblVzZXJBdXRoRGF0YSIsImlzTWFzdGVyIiwiYWNsIiwidXNlciIsImdldFVzZXJSb2xlcyIsInJvbGVzIiwiY29uY2F0IiwiaWQiLCJhbGxvd0NsaWVudENsYXNzQ3JlYXRpb24iLCJzeXN0ZW1DbGFzc2VzIiwiaW5kZXhPZiIsImRhdGFiYXNlIiwibG9hZFNjaGVtYSIsInNjaGVtYUNvbnRyb2xsZXIiLCJoYXNDbGFzcyIsInZhbGlkYXRlT2JqZWN0IiwidHJpZ2dlckV4aXN0cyIsIlR5cGVzIiwiYmVmb3JlU2F2ZSIsImFwcGxpY2F0aW9uSWQiLCJleHRyYURhdGEiLCJvcmlnaW5hbE9iamVjdCIsInVwZGF0ZWRPYmplY3QiLCJidWlsZFVwZGF0ZWRPYmplY3QiLCJpbmZsYXRlIiwiZGF0YWJhc2VQcm9taXNlIiwidXBkYXRlIiwiY3JlYXRlIiwicmVzdWx0IiwibGVuZ3RoIiwiT0JKRUNUX05PVF9GT1VORCIsIm1heWJlUnVuVHJpZ2dlciIsIm9iamVjdCIsImZpZWxkc0NoYW5nZWRCeVRyaWdnZXIiLCJfIiwicmVkdWNlIiwidmFsdWUiLCJrZXkiLCJpc0VxdWFsIiwicHVzaCIsInJ1bkJlZm9yZUxvZ2luVHJpZ2dlciIsInVzZXJEYXRhIiwiYmVmb3JlTG9naW4iLCJjcmVhdGVkQXQiLCJuZXdPYmplY3RJZCIsIm9iamVjdElkU2l6ZSIsImF1dGhEYXRhIiwidXNlcm5hbWUiLCJpc0VtcHR5IiwiVVNFUk5BTUVfTUlTU0lORyIsInBhc3N3b3JkIiwiUEFTU1dPUkRfTUlTU0lORyIsIk9iamVjdCIsImtleXMiLCJwcm92aWRlcnMiLCJjYW5IYW5kbGVBdXRoRGF0YSIsImNhbkhhbmRsZSIsInByb3ZpZGVyIiwicHJvdmlkZXJBdXRoRGF0YSIsImhhc1Rva2VuIiwiaGFuZGxlQXV0aERhdGEiLCJVTlNVUFBPUlRFRF9TRVJWSUNFIiwiaGFuZGxlQXV0aERhdGFWYWxpZGF0aW9uIiwidmFsaWRhdGlvbnMiLCJtYXAiLCJhdXRoRGF0YU1hbmFnZXIiLCJnZXRWYWxpZGF0b3JGb3JQcm92aWRlciIsImFsbCIsImZpbmRVc2Vyc1dpdGhBdXRoRGF0YSIsIm1lbW8iLCJxdWVyeUtleSIsImZpbHRlciIsInEiLCJmaW5kUHJvbWlzZSIsImZpbmQiLCIkb3IiLCJmaWx0ZXJlZE9iamVjdHNCeUFDTCIsIm9iamVjdHMiLCJBQ0wiLCJyZXN1bHRzIiwiciIsIkFDQ09VTlRfQUxSRUFEWV9MSU5LRUQiLCJqb2luIiwidXNlclJlc3VsdCIsIm11dGF0ZWRBdXRoRGF0YSIsImZvckVhY2giLCJwcm92aWRlckRhdGEiLCJ1c2VyQXV0aERhdGEiLCJoYXNNdXRhdGVkQXV0aERhdGEiLCJ1c2VySWQiLCJsb2NhdGlvbiIsInByb21pc2UiLCJlcnJvciIsIlJlc3RRdWVyeSIsIm1hc3RlciIsIl9fdHlwZSIsInNlc3Npb24iLCJjYWNoZUNvbnRyb2xsZXIiLCJkZWwiLCJzZXNzaW9uVG9rZW4iLCJ1bmRlZmluZWQiLCJfdmFsaWRhdGVQYXNzd29yZFBvbGljeSIsImhhc2giLCJoYXNoZWRQYXNzd29yZCIsIl9oYXNoZWRfcGFzc3dvcmQiLCJfdmFsaWRhdGVVc2VyTmFtZSIsIl92YWxpZGF0ZUVtYWlsIiwicmFuZG9tU3RyaW5nIiwicmVzcG9uc2VTaG91bGRIYXZlVXNlcm5hbWUiLCIkbmUiLCJsaW1pdCIsIlVTRVJOQU1FX1RBS0VOIiwiZW1haWwiLCJfX29wIiwibWF0Y2giLCJyZWplY3QiLCJJTlZBTElEX0VNQUlMX0FERFJFU1MiLCJFTUFJTF9UQUtFTiIsInVzZXJDb250cm9sbGVyIiwic2V0RW1haWxWZXJpZnlUb2tlbiIsInBhc3N3b3JkUG9saWN5IiwiX3ZhbGlkYXRlUGFzc3dvcmRSZXF1aXJlbWVudHMiLCJfdmFsaWRhdGVQYXNzd29yZEhpc3RvcnkiLCJwb2xpY3lFcnJvciIsInZhbGlkYXRpb25FcnJvciIsImNvbnRhaW5zVXNlcm5hbWVFcnJvciIsInBhdHRlcm5WYWxpZGF0b3IiLCJ2YWxpZGF0b3JDYWxsYmFjayIsIlZBTElEQVRJT05fRVJST1IiLCJkb05vdEFsbG93VXNlcm5hbWUiLCJtYXhQYXNzd29yZEhpc3RvcnkiLCJvbGRQYXNzd29yZHMiLCJfcGFzc3dvcmRfaGlzdG9yeSIsInRha2UiLCJuZXdQYXNzd29yZCIsInByb21pc2VzIiwiY29tcGFyZSIsImNhdGNoIiwiZXJyIiwicHJldmVudExvZ2luV2l0aFVudmVyaWZpZWRFbWFpbCIsInZlcmlmeVVzZXJFbWFpbHMiLCJjcmVhdGVTZXNzaW9uVG9rZW4iLCJpbnN0YWxsYXRpb25JZCIsInNlc3Npb25EYXRhIiwiY3JlYXRlU2Vzc2lvbiIsImNyZWF0ZWRXaXRoIiwiYWN0aW9uIiwiYXV0aFByb3ZpZGVyIiwiYWRkT3BzIiwiX3BlcmlzaGFibGVfdG9rZW4iLCJfcGVyaXNoYWJsZV90b2tlbl9leHBpcmVzX2F0IiwiYXNzaWduIiwiZGVzdHJveSIsInJldm9rZVNlc3Npb25PblBhc3N3b3JkUmVzZXQiLCJzZXNzaW9uUXVlcnkiLCJiaW5kIiwic2VuZFZlcmlmaWNhdGlvbkVtYWlsIiwiSU5WQUxJRF9TRVNTSU9OX1RPS0VOIiwiYWRkaXRpb25hbFNlc3Npb25EYXRhIiwiSU5URVJOQUxfU0VSVkVSX0VSUk9SIiwic3RhdHVzIiwiZGV2aWNlVG9rZW4iLCJ0b0xvd2VyQ2FzZSIsImRldmljZVR5cGUiLCJpZE1hdGNoIiwib2JqZWN0SWRNYXRjaCIsImluc3RhbGxhdGlvbklkTWF0Y2giLCJkZXZpY2VUb2tlbk1hdGNoZXMiLCJvclF1ZXJpZXMiLCJkZWxRdWVyeSIsImFwcElkZW50aWZpZXIiLCJjb2RlIiwib2JqSWQiLCJmaWxlc0NvbnRyb2xsZXIiLCJleHBhbmRGaWxlc0luT2JqZWN0Iiwicm9sZSIsImNsZWFyIiwiaXNVbmF1dGhlbnRpY2F0ZWQiLCJTRVNTSU9OX01JU1NJTkciLCJkb3dubG9hZCIsImRvd25sb2FkTmFtZSIsIm5hbWUiLCJJTlZBTElEX0FDTCIsInJlYWQiLCJ3cml0ZSIsIm1heFBhc3N3b3JkQWdlIiwiX3Bhc3N3b3JkX2NoYW5nZWRfYXQiLCJkZWZlciIsIk1hdGgiLCJtYXgiLCJzaGlmdCIsIl91cGRhdGVSZXNwb25zZVdpdGhEYXRhIiwiRFVQTElDQVRFX1ZBTFVFIiwidXNlckluZm8iLCJkdXBsaWNhdGVkX2ZpZWxkIiwiaGFzQWZ0ZXJTYXZlSG9vayIsImFmdGVyU2F2ZSIsImhhc0xpdmVRdWVyeSIsImxpdmVRdWVyeUNvbnRyb2xsZXIiLCJfaGFuZGxlU2F2ZVJlc3BvbnNlIiwicGVybXMiLCJnZXRDbGFzc0xldmVsUGVybWlzc2lvbnMiLCJvbkFmdGVyU2F2ZSIsImxvZ2dlciIsIndhcm4iLCJtaWRkbGUiLCJtb3VudCIsInNhbml0aXplZERhdGEiLCJ0ZXN0IiwiX2RlY29kZSIsInNwbGl0dGVkS2V5Iiwic3BsaXQiLCJwYXJlbnRQcm9wIiwicGFyZW50VmFsIiwiZ2V0Iiwic2V0IiwiY2xpZW50U3VwcG9ydHNEZWxldGUiLCJzdXBwb3J0c0ZvcndhcmREZWxldGUiLCJmaWVsZE5hbWUiLCJkYXRhVmFsdWUiLCJoYXNPd25Qcm9wZXJ0eSIsIm1vZHVsZSIsImV4cG9ydHMiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFhQTs7QUFDQTs7QUFDQTs7OztBQWZBO0FBQ0E7QUFDQTtBQUVBLElBQUlBLGdCQUFnQixHQUFHQyxPQUFPLENBQUMsZ0NBQUQsQ0FBOUI7O0FBQ0EsSUFBSUMsUUFBUSxHQUFHRCxPQUFPLENBQUMsVUFBRCxDQUF0Qjs7QUFFQSxNQUFNRSxJQUFJLEdBQUdGLE9BQU8sQ0FBQyxRQUFELENBQXBCOztBQUNBLElBQUlHLFdBQVcsR0FBR0gsT0FBTyxDQUFDLGVBQUQsQ0FBekI7O0FBQ0EsSUFBSUksY0FBYyxHQUFHSixPQUFPLENBQUMsWUFBRCxDQUE1Qjs7QUFDQSxJQUFJSyxLQUFLLEdBQUdMLE9BQU8sQ0FBQyxZQUFELENBQW5COztBQUNBLElBQUlNLFFBQVEsR0FBR04sT0FBTyxDQUFDLFlBQUQsQ0FBdEI7O0FBQ0EsSUFBSU8sU0FBUyxHQUFHUCxPQUFPLENBQUMsYUFBRCxDQUF2Qjs7QUFLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxTQUFTUSxTQUFULENBQ0VDLE1BREYsRUFFRUMsSUFGRixFQUdFQyxTQUhGLEVBSUVDLEtBSkYsRUFLRUMsSUFMRixFQU1FQyxZQU5GLEVBT0VDLFNBUEYsRUFRRUMsT0FSRixFQVNFO0FBQ0EsTUFBSU4sSUFBSSxDQUFDTyxVQUFULEVBQXFCO0FBQ25CLFVBQU0sSUFBSVosS0FBSyxDQUFDYSxLQUFWLENBQ0piLEtBQUssQ0FBQ2EsS0FBTixDQUFZQyxtQkFEUixFQUVKLCtEQUZJLENBQU47QUFJRDs7QUFDRCxPQUFLVixNQUFMLEdBQWNBLE1BQWQ7QUFDQSxPQUFLQyxJQUFMLEdBQVlBLElBQVo7QUFDQSxPQUFLQyxTQUFMLEdBQWlCQSxTQUFqQjtBQUNBLE9BQUtJLFNBQUwsR0FBaUJBLFNBQWpCO0FBQ0EsT0FBS0ssT0FBTCxHQUFlLEVBQWY7QUFDQSxPQUFLQyxVQUFMLEdBQWtCLEVBQWxCO0FBQ0EsT0FBS0MsT0FBTCxHQUFlLEVBQWY7QUFFQSxRQUFNQyxhQUFhLEdBQUdQLE9BQU8sSUFBSUEsT0FBTyxDQUFDTyxhQUFSLEtBQTBCLElBQTNEOztBQUNBLE1BQUksQ0FBQ1gsS0FBRCxJQUFVQyxJQUFJLENBQUNXLFFBQWYsSUFBMkIsQ0FBQ0QsYUFBaEMsRUFBK0M7QUFDN0MsVUFBTSxJQUFJbEIsS0FBSyxDQUFDYSxLQUFWLENBQ0piLEtBQUssQ0FBQ2EsS0FBTixDQUFZTyxnQkFEUixFQUVKLG9DQUZJLENBQU47QUFJRCxHQXJCRCxDQXVCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUFDQSxPQUFLQyxRQUFMLEdBQWdCLElBQWhCLENBNUJBLENBOEJBO0FBQ0E7O0FBQ0EsT0FBS2QsS0FBTCxHQUFhWCxRQUFRLENBQUNXLEtBQUQsQ0FBckI7QUFDQSxPQUFLQyxJQUFMLEdBQVlaLFFBQVEsQ0FBQ1ksSUFBRCxDQUFwQixDQWpDQSxDQWtDQTs7QUFDQSxPQUFLQyxZQUFMLEdBQW9CQSxZQUFwQixDQW5DQSxDQXFDQTs7QUFDQSxPQUFLYSxTQUFMLEdBQWlCdEIsS0FBSyxDQUFDdUIsT0FBTixDQUFjLElBQUlDLElBQUosRUFBZCxFQUEwQkMsR0FBM0M7QUFDRCxDLENBRUQ7QUFDQTtBQUNBO0FBQ0E7OztBQUNBdEIsU0FBUyxDQUFDdUIsU0FBVixDQUFvQkMsT0FBcEIsR0FBOEIsWUFBVztBQUN2QyxTQUFPQyxPQUFPLENBQUNDLE9BQVIsR0FDSkMsSUFESSxDQUNDLE1BQU07QUFDVixXQUFPLEtBQUtDLGlCQUFMLEVBQVA7QUFDRCxHQUhJLEVBSUpELElBSkksQ0FJQyxNQUFNO0FBQ1YsV0FBTyxLQUFLRSwyQkFBTCxFQUFQO0FBQ0QsR0FOSSxFQU9KRixJQVBJLENBT0MsTUFBTTtBQUNWLFdBQU8sS0FBS0csa0JBQUwsRUFBUDtBQUNELEdBVEksRUFVSkgsSUFWSSxDQVVDLE1BQU07QUFDVixXQUFPLEtBQUtJLGFBQUwsRUFBUDtBQUNELEdBWkksRUFhSkosSUFiSSxDQWFDLE1BQU07QUFDVixXQUFPLEtBQUtLLGdCQUFMLEVBQVA7QUFDRCxHQWZJLEVBZ0JKTCxJQWhCSSxDQWdCQyxNQUFNO0FBQ1YsV0FBTyxLQUFLTSxvQkFBTCxFQUFQO0FBQ0QsR0FsQkksRUFtQkpOLElBbkJJLENBbUJDLE1BQU07QUFDVixXQUFPLEtBQUtPLDZCQUFMLEVBQVA7QUFDRCxHQXJCSSxFQXNCSlAsSUF0QkksQ0FzQkMsTUFBTTtBQUNWLFdBQU8sS0FBS1EsY0FBTCxFQUFQO0FBQ0QsR0F4QkksRUF5QkpSLElBekJJLENBeUJDLE1BQU07QUFDVixXQUFPLEtBQUtTLHlCQUFMLEVBQVA7QUFDRCxHQTNCSSxFQTRCSlQsSUE1QkksQ0E0QkMsTUFBTTtBQUNWLFdBQU8sS0FBS1UsYUFBTCxFQUFQO0FBQ0QsR0E5QkksRUErQkpWLElBL0JJLENBK0JDLE1BQU07QUFDVixXQUFPLEtBQUtXLDZCQUFMLEVBQVA7QUFDRCxHQWpDSSxFQWtDSlgsSUFsQ0ksQ0FrQ0MsTUFBTTtBQUNWLFdBQU8sS0FBS1kseUJBQUwsRUFBUDtBQUNELEdBcENJLEVBcUNKWixJQXJDSSxDQXFDQyxNQUFNO0FBQ1YsV0FBTyxLQUFLYSxvQkFBTCxFQUFQO0FBQ0QsR0F2Q0ksRUF3Q0piLElBeENJLENBd0NDLE1BQU07QUFDVixXQUFPLEtBQUtjLDBCQUFMLEVBQVA7QUFDRCxHQTFDSSxFQTJDSmQsSUEzQ0ksQ0EyQ0MsTUFBTTtBQUNWLFdBQU8sS0FBS2UsY0FBTCxFQUFQO0FBQ0QsR0E3Q0ksRUE4Q0pmLElBOUNJLENBOENDLE1BQU07QUFDVixXQUFPLEtBQUtnQixtQkFBTCxFQUFQO0FBQ0QsR0FoREksRUFpREpoQixJQWpESSxDQWlEQyxNQUFNO0FBQ1YsV0FBTyxLQUFLaUIsaUJBQUwsRUFBUDtBQUNELEdBbkRJLEVBb0RKakIsSUFwREksQ0FvREMsTUFBTTtBQUNWLFdBQU8sS0FBS1QsUUFBWjtBQUNELEdBdERJLENBQVA7QUF1REQsQ0F4REQsQyxDQTBEQTs7O0FBQ0FsQixTQUFTLENBQUN1QixTQUFWLENBQW9CSyxpQkFBcEIsR0FBd0MsWUFBVztBQUNqRCxNQUFJLEtBQUsxQixJQUFMLENBQVUyQyxRQUFkLEVBQXdCO0FBQ3RCLFdBQU9wQixPQUFPLENBQUNDLE9BQVIsRUFBUDtBQUNEOztBQUVELE9BQUtiLFVBQUwsQ0FBZ0JpQyxHQUFoQixHQUFzQixDQUFDLEdBQUQsQ0FBdEI7O0FBRUEsTUFBSSxLQUFLNUMsSUFBTCxDQUFVNkMsSUFBZCxFQUFvQjtBQUNsQixXQUFPLEtBQUs3QyxJQUFMLENBQVU4QyxZQUFWLEdBQXlCckIsSUFBekIsQ0FBOEJzQixLQUFLLElBQUk7QUFDNUMsV0FBS3BDLFVBQUwsQ0FBZ0JpQyxHQUFoQixHQUFzQixLQUFLakMsVUFBTCxDQUFnQmlDLEdBQWhCLENBQW9CSSxNQUFwQixDQUEyQkQsS0FBM0IsRUFBa0MsQ0FDdEQsS0FBSy9DLElBQUwsQ0FBVTZDLElBQVYsQ0FBZUksRUFEdUMsQ0FBbEMsQ0FBdEI7QUFHQTtBQUNELEtBTE0sQ0FBUDtBQU1ELEdBUEQsTUFPTztBQUNMLFdBQU8xQixPQUFPLENBQUNDLE9BQVIsRUFBUDtBQUNEO0FBQ0YsQ0FqQkQsQyxDQW1CQTs7O0FBQ0ExQixTQUFTLENBQUN1QixTQUFWLENBQW9CTSwyQkFBcEIsR0FBa0QsWUFBVztBQUMzRCxNQUNFLEtBQUs1QixNQUFMLENBQVltRCx3QkFBWixLQUF5QyxLQUF6QyxJQUNBLENBQUMsS0FBS2xELElBQUwsQ0FBVTJDLFFBRFgsSUFFQXRELGdCQUFnQixDQUFDOEQsYUFBakIsQ0FBK0JDLE9BQS9CLENBQXVDLEtBQUtuRCxTQUE1QyxNQUEyRCxDQUFDLENBSDlELEVBSUU7QUFDQSxXQUFPLEtBQUtGLE1BQUwsQ0FBWXNELFFBQVosQ0FDSkMsVUFESSxHQUVKN0IsSUFGSSxDQUVDOEIsZ0JBQWdCLElBQUlBLGdCQUFnQixDQUFDQyxRQUFqQixDQUEwQixLQUFLdkQsU0FBL0IsQ0FGckIsRUFHSndCLElBSEksQ0FHQytCLFFBQVEsSUFBSTtBQUNoQixVQUFJQSxRQUFRLEtBQUssSUFBakIsRUFBdUI7QUFDckIsY0FBTSxJQUFJN0QsS0FBSyxDQUFDYSxLQUFWLENBQ0piLEtBQUssQ0FBQ2EsS0FBTixDQUFZQyxtQkFEUixFQUVKLHdDQUNFLHNCQURGLEdBRUUsS0FBS1IsU0FKSCxDQUFOO0FBTUQ7QUFDRixLQVpJLENBQVA7QUFhRCxHQWxCRCxNQWtCTztBQUNMLFdBQU9zQixPQUFPLENBQUNDLE9BQVIsRUFBUDtBQUNEO0FBQ0YsQ0F0QkQsQyxDQXdCQTs7O0FBQ0ExQixTQUFTLENBQUN1QixTQUFWLENBQW9CWSxjQUFwQixHQUFxQyxZQUFXO0FBQzlDLFNBQU8sS0FBS2xDLE1BQUwsQ0FBWXNELFFBQVosQ0FBcUJJLGNBQXJCLENBQ0wsS0FBS3hELFNBREEsRUFFTCxLQUFLRSxJQUZBLEVBR0wsS0FBS0QsS0FIQSxFQUlMLEtBQUtTLFVBSkEsQ0FBUDtBQU1ELENBUEQsQyxDQVNBO0FBQ0E7OztBQUNBYixTQUFTLENBQUN1QixTQUFWLENBQW9CVSxvQkFBcEIsR0FBMkMsWUFBVztBQUNwRCxNQUFJLEtBQUtmLFFBQVQsRUFBbUI7QUFDakI7QUFDRCxHQUhtRCxDQUtwRDs7O0FBQ0EsTUFDRSxDQUFDcEIsUUFBUSxDQUFDOEQsYUFBVCxDQUNDLEtBQUt6RCxTQUROLEVBRUNMLFFBQVEsQ0FBQytELEtBQVQsQ0FBZUMsVUFGaEIsRUFHQyxLQUFLN0QsTUFBTCxDQUFZOEQsYUFIYixDQURILEVBTUU7QUFDQSxXQUFPdEMsT0FBTyxDQUFDQyxPQUFSLEVBQVA7QUFDRCxHQWRtRCxDQWdCcEQ7OztBQUNBLE1BQUlzQyxTQUFTLEdBQUc7QUFBRTdELElBQUFBLFNBQVMsRUFBRSxLQUFLQTtBQUFsQixHQUFoQjs7QUFDQSxNQUFJLEtBQUtDLEtBQUwsSUFBYyxLQUFLQSxLQUFMLENBQVdZLFFBQTdCLEVBQXVDO0FBQ3JDZ0QsSUFBQUEsU0FBUyxDQUFDaEQsUUFBVixHQUFxQixLQUFLWixLQUFMLENBQVdZLFFBQWhDO0FBQ0Q7O0FBRUQsTUFBSWlELGNBQWMsR0FBRyxJQUFyQjtBQUNBLFFBQU1DLGFBQWEsR0FBRyxLQUFLQyxrQkFBTCxDQUF3QkgsU0FBeEIsQ0FBdEI7O0FBQ0EsTUFBSSxLQUFLNUQsS0FBTCxJQUFjLEtBQUtBLEtBQUwsQ0FBV1ksUUFBN0IsRUFBdUM7QUFDckM7QUFDQWlELElBQUFBLGNBQWMsR0FBR25FLFFBQVEsQ0FBQ3NFLE9BQVQsQ0FBaUJKLFNBQWpCLEVBQTRCLEtBQUsxRCxZQUFqQyxDQUFqQjtBQUNEOztBQUVELFNBQU9tQixPQUFPLENBQUNDLE9BQVIsR0FDSkMsSUFESSxDQUNDLE1BQU07QUFDVjtBQUNBLFFBQUkwQyxlQUFlLEdBQUcsSUFBdEI7O0FBQ0EsUUFBSSxLQUFLakUsS0FBVCxFQUFnQjtBQUNkO0FBQ0FpRSxNQUFBQSxlQUFlLEdBQUcsS0FBS3BFLE1BQUwsQ0FBWXNELFFBQVosQ0FBcUJlLE1BQXJCLENBQ2hCLEtBQUtuRSxTQURXLEVBRWhCLEtBQUtDLEtBRlcsRUFHaEIsS0FBS0MsSUFIVyxFQUloQixLQUFLUSxVQUpXLEVBS2hCLEtBTGdCLEVBTWhCLElBTmdCLENBQWxCO0FBUUQsS0FWRCxNQVVPO0FBQ0w7QUFDQXdELE1BQUFBLGVBQWUsR0FBRyxLQUFLcEUsTUFBTCxDQUFZc0QsUUFBWixDQUFxQmdCLE1BQXJCLENBQ2hCLEtBQUtwRSxTQURXLEVBRWhCLEtBQUtFLElBRlcsRUFHaEIsS0FBS1EsVUFIVyxFQUloQixJQUpnQixDQUFsQjtBQU1ELEtBckJTLENBc0JWOzs7QUFDQSxXQUFPd0QsZUFBZSxDQUFDMUMsSUFBaEIsQ0FBcUI2QyxNQUFNLElBQUk7QUFDcEMsVUFBSSxDQUFDQSxNQUFELElBQVdBLE1BQU0sQ0FBQ0MsTUFBUCxJQUFpQixDQUFoQyxFQUFtQztBQUNqQyxjQUFNLElBQUk1RSxLQUFLLENBQUNhLEtBQVYsQ0FDSmIsS0FBSyxDQUFDYSxLQUFOLENBQVlnRSxnQkFEUixFQUVKLG1CQUZJLENBQU47QUFJRDtBQUNGLEtBUE0sQ0FBUDtBQVFELEdBaENJLEVBaUNKL0MsSUFqQ0ksQ0FpQ0MsTUFBTTtBQUNWLFdBQU83QixRQUFRLENBQUM2RSxlQUFULENBQ0w3RSxRQUFRLENBQUMrRCxLQUFULENBQWVDLFVBRFYsRUFFTCxLQUFLNUQsSUFGQSxFQUdMZ0UsYUFISyxFQUlMRCxjQUpLLEVBS0wsS0FBS2hFLE1BTEEsRUFNTCxLQUFLYSxPQU5BLENBQVA7QUFRRCxHQTFDSSxFQTJDSmEsSUEzQ0ksQ0EyQ0NULFFBQVEsSUFBSTtBQUNoQixRQUFJQSxRQUFRLElBQUlBLFFBQVEsQ0FBQzBELE1BQXpCLEVBQWlDO0FBQy9CLFdBQUtoRSxPQUFMLENBQWFpRSxzQkFBYixHQUFzQ0MsZ0JBQUVDLE1BQUYsQ0FDcEM3RCxRQUFRLENBQUMwRCxNQUQyQixFQUVwQyxDQUFDSixNQUFELEVBQVNRLEtBQVQsRUFBZ0JDLEdBQWhCLEtBQXdCO0FBQ3RCLFlBQUksQ0FBQ0gsZ0JBQUVJLE9BQUYsQ0FBVSxLQUFLN0UsSUFBTCxDQUFVNEUsR0FBVixDQUFWLEVBQTBCRCxLQUExQixDQUFMLEVBQXVDO0FBQ3JDUixVQUFBQSxNQUFNLENBQUNXLElBQVAsQ0FBWUYsR0FBWjtBQUNEOztBQUNELGVBQU9ULE1BQVA7QUFDRCxPQVBtQyxFQVFwQyxFQVJvQyxDQUF0QztBQVVBLFdBQUtuRSxJQUFMLEdBQVlhLFFBQVEsQ0FBQzBELE1BQXJCLENBWCtCLENBWS9COztBQUNBLFVBQUksS0FBS3hFLEtBQUwsSUFBYyxLQUFLQSxLQUFMLENBQVdZLFFBQTdCLEVBQXVDO0FBQ3JDLGVBQU8sS0FBS1gsSUFBTCxDQUFVVyxRQUFqQjtBQUNEO0FBQ0Y7QUFDRixHQTdESSxDQUFQO0FBOERELENBM0ZEOztBQTZGQWhCLFNBQVMsQ0FBQ3VCLFNBQVYsQ0FBb0I2RCxxQkFBcEIsR0FBNEMsZ0JBQWVDLFFBQWYsRUFBeUI7QUFDbkU7QUFDQSxNQUNFLENBQUN2RixRQUFRLENBQUM4RCxhQUFULENBQ0MsS0FBS3pELFNBRE4sRUFFQ0wsUUFBUSxDQUFDK0QsS0FBVCxDQUFleUIsV0FGaEIsRUFHQyxLQUFLckYsTUFBTCxDQUFZOEQsYUFIYixDQURILEVBTUU7QUFDQTtBQUNELEdBVmtFLENBWW5FOzs7QUFDQSxRQUFNQyxTQUFTLEdBQUc7QUFBRTdELElBQUFBLFNBQVMsRUFBRSxLQUFLQTtBQUFsQixHQUFsQjtBQUNBLFFBQU00QyxJQUFJLEdBQUdqRCxRQUFRLENBQUNzRSxPQUFULENBQWlCSixTQUFqQixFQUE0QnFCLFFBQTVCLENBQWIsQ0FkbUUsQ0FnQm5FOztBQUNBLFFBQU12RixRQUFRLENBQUM2RSxlQUFULENBQ0o3RSxRQUFRLENBQUMrRCxLQUFULENBQWV5QixXQURYLEVBRUosS0FBS3BGLElBRkQsRUFHSjZDLElBSEksRUFJSixJQUpJLEVBS0osS0FBSzlDLE1BTEQsRUFNSixLQUFLYSxPQU5ELENBQU47QUFRRCxDQXpCRDs7QUEyQkFkLFNBQVMsQ0FBQ3VCLFNBQVYsQ0FBb0JhLHlCQUFwQixHQUFnRCxZQUFXO0FBQ3pELE1BQUksS0FBSy9CLElBQVQsRUFBZTtBQUNiO0FBQ0EsU0FBS0EsSUFBTCxDQUFVYyxTQUFWLEdBQXNCLEtBQUtBLFNBQTNCOztBQUNBLFFBQUksQ0FBQyxLQUFLZixLQUFWLEVBQWlCO0FBQ2YsV0FBS0MsSUFBTCxDQUFVa0YsU0FBVixHQUFzQixLQUFLcEUsU0FBM0IsQ0FEZSxDQUdmOztBQUNBLFVBQUksQ0FBQyxLQUFLZCxJQUFMLENBQVVXLFFBQWYsRUFBeUI7QUFDdkIsYUFBS1gsSUFBTCxDQUFVVyxRQUFWLEdBQXFCckIsV0FBVyxDQUFDNkYsV0FBWixDQUF3QixLQUFLdkYsTUFBTCxDQUFZd0YsWUFBcEMsQ0FBckI7QUFDRDtBQUNGO0FBQ0Y7O0FBQ0QsU0FBT2hFLE9BQU8sQ0FBQ0MsT0FBUixFQUFQO0FBQ0QsQ0FkRCxDLENBZ0JBO0FBQ0E7QUFDQTs7O0FBQ0ExQixTQUFTLENBQUN1QixTQUFWLENBQW9CUyxnQkFBcEIsR0FBdUMsWUFBVztBQUNoRCxNQUFJLEtBQUs3QixTQUFMLEtBQW1CLE9BQXZCLEVBQWdDO0FBQzlCO0FBQ0Q7O0FBRUQsTUFBSSxDQUFDLEtBQUtDLEtBQU4sSUFBZSxDQUFDLEtBQUtDLElBQUwsQ0FBVXFGLFFBQTlCLEVBQXdDO0FBQ3RDLFFBQ0UsT0FBTyxLQUFLckYsSUFBTCxDQUFVc0YsUUFBakIsS0FBOEIsUUFBOUIsSUFDQWIsZ0JBQUVjLE9BQUYsQ0FBVSxLQUFLdkYsSUFBTCxDQUFVc0YsUUFBcEIsQ0FGRixFQUdFO0FBQ0EsWUFBTSxJQUFJOUYsS0FBSyxDQUFDYSxLQUFWLENBQ0piLEtBQUssQ0FBQ2EsS0FBTixDQUFZbUYsZ0JBRFIsRUFFSix5QkFGSSxDQUFOO0FBSUQ7O0FBQ0QsUUFDRSxPQUFPLEtBQUt4RixJQUFMLENBQVV5RixRQUFqQixLQUE4QixRQUE5QixJQUNBaEIsZ0JBQUVjLE9BQUYsQ0FBVSxLQUFLdkYsSUFBTCxDQUFVeUYsUUFBcEIsQ0FGRixFQUdFO0FBQ0EsWUFBTSxJQUFJakcsS0FBSyxDQUFDYSxLQUFWLENBQ0piLEtBQUssQ0FBQ2EsS0FBTixDQUFZcUYsZ0JBRFIsRUFFSixzQkFGSSxDQUFOO0FBSUQ7QUFDRjs7QUFFRCxNQUFJLENBQUMsS0FBSzFGLElBQUwsQ0FBVXFGLFFBQVgsSUFBdUIsQ0FBQ00sTUFBTSxDQUFDQyxJQUFQLENBQVksS0FBSzVGLElBQUwsQ0FBVXFGLFFBQXRCLEVBQWdDakIsTUFBNUQsRUFBb0U7QUFDbEU7QUFDRDs7QUFFRCxNQUFJaUIsUUFBUSxHQUFHLEtBQUtyRixJQUFMLENBQVVxRixRQUF6QjtBQUNBLE1BQUlRLFNBQVMsR0FBR0YsTUFBTSxDQUFDQyxJQUFQLENBQVlQLFFBQVosQ0FBaEI7O0FBQ0EsTUFBSVEsU0FBUyxDQUFDekIsTUFBVixHQUFtQixDQUF2QixFQUEwQjtBQUN4QixVQUFNMEIsaUJBQWlCLEdBQUdELFNBQVMsQ0FBQ25CLE1BQVYsQ0FBaUIsQ0FBQ3FCLFNBQUQsRUFBWUMsUUFBWixLQUF5QjtBQUNsRSxVQUFJQyxnQkFBZ0IsR0FBR1osUUFBUSxDQUFDVyxRQUFELENBQS9CO0FBQ0EsVUFBSUUsUUFBUSxHQUFHRCxnQkFBZ0IsSUFBSUEsZ0JBQWdCLENBQUNuRCxFQUFwRDtBQUNBLGFBQU9pRCxTQUFTLEtBQUtHLFFBQVEsSUFBSUQsZ0JBQWdCLElBQUksSUFBckMsQ0FBaEI7QUFDRCxLQUp5QixFQUl2QixJQUp1QixDQUExQjs7QUFLQSxRQUFJSCxpQkFBSixFQUF1QjtBQUNyQixhQUFPLEtBQUtLLGNBQUwsQ0FBb0JkLFFBQXBCLENBQVA7QUFDRDtBQUNGOztBQUNELFFBQU0sSUFBSTdGLEtBQUssQ0FBQ2EsS0FBVixDQUNKYixLQUFLLENBQUNhLEtBQU4sQ0FBWStGLG1CQURSLEVBRUosNENBRkksQ0FBTjtBQUlELENBOUNEOztBQWdEQXpHLFNBQVMsQ0FBQ3VCLFNBQVYsQ0FBb0JtRix3QkFBcEIsR0FBK0MsVUFBU2hCLFFBQVQsRUFBbUI7QUFDaEUsUUFBTWlCLFdBQVcsR0FBR1gsTUFBTSxDQUFDQyxJQUFQLENBQVlQLFFBQVosRUFBc0JrQixHQUF0QixDQUEwQlAsUUFBUSxJQUFJO0FBQ3hELFFBQUlYLFFBQVEsQ0FBQ1csUUFBRCxDQUFSLEtBQXVCLElBQTNCLEVBQWlDO0FBQy9CLGFBQU81RSxPQUFPLENBQUNDLE9BQVIsRUFBUDtBQUNEOztBQUNELFVBQU1NLGdCQUFnQixHQUFHLEtBQUsvQixNQUFMLENBQVk0RyxlQUFaLENBQTRCQyx1QkFBNUIsQ0FDdkJULFFBRHVCLENBQXpCOztBQUdBLFFBQUksQ0FBQ3JFLGdCQUFMLEVBQXVCO0FBQ3JCLFlBQU0sSUFBSW5DLEtBQUssQ0FBQ2EsS0FBVixDQUNKYixLQUFLLENBQUNhLEtBQU4sQ0FBWStGLG1CQURSLEVBRUosNENBRkksQ0FBTjtBQUlEOztBQUNELFdBQU96RSxnQkFBZ0IsQ0FBQzBELFFBQVEsQ0FBQ1csUUFBRCxDQUFULENBQXZCO0FBQ0QsR0FkbUIsQ0FBcEI7QUFlQSxTQUFPNUUsT0FBTyxDQUFDc0YsR0FBUixDQUFZSixXQUFaLENBQVA7QUFDRCxDQWpCRDs7QUFtQkEzRyxTQUFTLENBQUN1QixTQUFWLENBQW9CeUYscUJBQXBCLEdBQTRDLFVBQVN0QixRQUFULEVBQW1CO0FBQzdELFFBQU1RLFNBQVMsR0FBR0YsTUFBTSxDQUFDQyxJQUFQLENBQVlQLFFBQVosQ0FBbEI7QUFDQSxRQUFNdEYsS0FBSyxHQUFHOEYsU0FBUyxDQUNwQm5CLE1BRFcsQ0FDSixDQUFDa0MsSUFBRCxFQUFPWixRQUFQLEtBQW9CO0FBQzFCLFFBQUksQ0FBQ1gsUUFBUSxDQUFDVyxRQUFELENBQWIsRUFBeUI7QUFDdkIsYUFBT1ksSUFBUDtBQUNEOztBQUNELFVBQU1DLFFBQVEsR0FBSSxZQUFXYixRQUFTLEtBQXRDO0FBQ0EsVUFBTWpHLEtBQUssR0FBRyxFQUFkO0FBQ0FBLElBQUFBLEtBQUssQ0FBQzhHLFFBQUQsQ0FBTCxHQUFrQnhCLFFBQVEsQ0FBQ1csUUFBRCxDQUFSLENBQW1CbEQsRUFBckM7QUFDQThELElBQUFBLElBQUksQ0FBQzlCLElBQUwsQ0FBVS9FLEtBQVY7QUFDQSxXQUFPNkcsSUFBUDtBQUNELEdBVlcsRUFVVCxFQVZTLEVBV1hFLE1BWFcsQ0FXSkMsQ0FBQyxJQUFJO0FBQ1gsV0FBTyxPQUFPQSxDQUFQLEtBQWEsV0FBcEI7QUFDRCxHQWJXLENBQWQ7QUFlQSxNQUFJQyxXQUFXLEdBQUc1RixPQUFPLENBQUNDLE9BQVIsQ0FBZ0IsRUFBaEIsQ0FBbEI7O0FBQ0EsTUFBSXRCLEtBQUssQ0FBQ3FFLE1BQU4sR0FBZSxDQUFuQixFQUFzQjtBQUNwQjRDLElBQUFBLFdBQVcsR0FBRyxLQUFLcEgsTUFBTCxDQUFZc0QsUUFBWixDQUFxQitELElBQXJCLENBQTBCLEtBQUtuSCxTQUEvQixFQUEwQztBQUFFb0gsTUFBQUEsR0FBRyxFQUFFbkg7QUFBUCxLQUExQyxFQUEwRCxFQUExRCxDQUFkO0FBQ0Q7O0FBRUQsU0FBT2lILFdBQVA7QUFDRCxDQXZCRDs7QUF5QkFySCxTQUFTLENBQUN1QixTQUFWLENBQW9CaUcsb0JBQXBCLEdBQTJDLFVBQVNDLE9BQVQsRUFBa0I7QUFDM0QsTUFBSSxLQUFLdkgsSUFBTCxDQUFVMkMsUUFBZCxFQUF3QjtBQUN0QixXQUFPNEUsT0FBUDtBQUNEOztBQUNELFNBQU9BLE9BQU8sQ0FBQ04sTUFBUixDQUFldkMsTUFBTSxJQUFJO0FBQzlCLFFBQUksQ0FBQ0EsTUFBTSxDQUFDOEMsR0FBWixFQUFpQjtBQUNmLGFBQU8sSUFBUCxDQURlLENBQ0Y7QUFDZCxLQUg2QixDQUk5Qjs7O0FBQ0EsV0FBTzlDLE1BQU0sQ0FBQzhDLEdBQVAsSUFBYzFCLE1BQU0sQ0FBQ0MsSUFBUCxDQUFZckIsTUFBTSxDQUFDOEMsR0FBbkIsRUFBd0JqRCxNQUF4QixHQUFpQyxDQUF0RDtBQUNELEdBTk0sQ0FBUDtBQU9ELENBWEQ7O0FBYUF6RSxTQUFTLENBQUN1QixTQUFWLENBQW9CaUYsY0FBcEIsR0FBcUMsVUFBU2QsUUFBVCxFQUFtQjtBQUN0RCxNQUFJaUMsT0FBSjtBQUNBLFNBQU8sS0FBS1gscUJBQUwsQ0FBMkJ0QixRQUEzQixFQUFxQy9ELElBQXJDLENBQTBDLE1BQU1pRyxDQUFOLElBQVc7QUFDMURELElBQUFBLE9BQU8sR0FBRyxLQUFLSCxvQkFBTCxDQUEwQkksQ0FBMUIsQ0FBVjs7QUFDQSxRQUFJRCxPQUFPLENBQUNsRCxNQUFSLEdBQWlCLENBQXJCLEVBQXdCO0FBQ3RCO0FBQ0EsWUFBTSxJQUFJNUUsS0FBSyxDQUFDYSxLQUFWLENBQ0piLEtBQUssQ0FBQ2EsS0FBTixDQUFZbUgsc0JBRFIsRUFFSiwyQkFGSSxDQUFOO0FBSUQ7O0FBRUQsU0FBS2pILE9BQUwsQ0FBYSxjQUFiLElBQStCb0YsTUFBTSxDQUFDQyxJQUFQLENBQVlQLFFBQVosRUFBc0JvQyxJQUF0QixDQUEyQixHQUEzQixDQUEvQjs7QUFFQSxRQUFJSCxPQUFPLENBQUNsRCxNQUFSLEdBQWlCLENBQXJCLEVBQXdCO0FBQ3RCLFlBQU1zRCxVQUFVLEdBQUdKLE9BQU8sQ0FBQyxDQUFELENBQTFCO0FBQ0EsWUFBTUssZUFBZSxHQUFHLEVBQXhCO0FBQ0FoQyxNQUFBQSxNQUFNLENBQUNDLElBQVAsQ0FBWVAsUUFBWixFQUFzQnVDLE9BQXRCLENBQThCNUIsUUFBUSxJQUFJO0FBQ3hDLGNBQU02QixZQUFZLEdBQUd4QyxRQUFRLENBQUNXLFFBQUQsQ0FBN0I7QUFDQSxjQUFNOEIsWUFBWSxHQUFHSixVQUFVLENBQUNyQyxRQUFYLENBQW9CVyxRQUFwQixDQUFyQjs7QUFDQSxZQUFJLENBQUN2QixnQkFBRUksT0FBRixDQUFVZ0QsWUFBVixFQUF3QkMsWUFBeEIsQ0FBTCxFQUE0QztBQUMxQ0gsVUFBQUEsZUFBZSxDQUFDM0IsUUFBRCxDQUFmLEdBQTRCNkIsWUFBNUI7QUFDRDtBQUNGLE9BTkQ7QUFPQSxZQUFNRSxrQkFBa0IsR0FBR3BDLE1BQU0sQ0FBQ0MsSUFBUCxDQUFZK0IsZUFBWixFQUE2QnZELE1BQTdCLEtBQXdDLENBQW5FO0FBQ0EsVUFBSTRELE1BQUo7O0FBQ0EsVUFBSSxLQUFLakksS0FBTCxJQUFjLEtBQUtBLEtBQUwsQ0FBV1ksUUFBN0IsRUFBdUM7QUFDckNxSCxRQUFBQSxNQUFNLEdBQUcsS0FBS2pJLEtBQUwsQ0FBV1ksUUFBcEI7QUFDRCxPQUZELE1BRU8sSUFBSSxLQUFLZCxJQUFMLElBQWEsS0FBS0EsSUFBTCxDQUFVNkMsSUFBdkIsSUFBK0IsS0FBSzdDLElBQUwsQ0FBVTZDLElBQVYsQ0FBZUksRUFBbEQsRUFBc0Q7QUFDM0RrRixRQUFBQSxNQUFNLEdBQUcsS0FBS25JLElBQUwsQ0FBVTZDLElBQVYsQ0FBZUksRUFBeEI7QUFDRDs7QUFDRCxVQUFJLENBQUNrRixNQUFELElBQVdBLE1BQU0sS0FBS04sVUFBVSxDQUFDL0csUUFBckMsRUFBK0M7QUFDN0M7QUFDQTtBQUNBO0FBQ0EsZUFBTzJHLE9BQU8sQ0FBQyxDQUFELENBQVAsQ0FBVzdCLFFBQWxCLENBSjZDLENBTTdDOztBQUNBLGFBQUt6RixJQUFMLENBQVVXLFFBQVYsR0FBcUIrRyxVQUFVLENBQUMvRyxRQUFoQzs7QUFFQSxZQUFJLENBQUMsS0FBS1osS0FBTixJQUFlLENBQUMsS0FBS0EsS0FBTCxDQUFXWSxRQUEvQixFQUF5QztBQUN2QztBQUNBLGVBQUtFLFFBQUwsR0FBZ0I7QUFDZEEsWUFBQUEsUUFBUSxFQUFFNkcsVUFESTtBQUVkTyxZQUFBQSxRQUFRLEVBQUUsS0FBS0EsUUFBTDtBQUZJLFdBQWhCLENBRnVDLENBTXZDO0FBQ0E7QUFDQTs7QUFDQSxnQkFBTSxLQUFLbEQscUJBQUwsQ0FBMkIzRixRQUFRLENBQUNzSSxVQUFELENBQW5DLENBQU47QUFDRCxTQW5CNEMsQ0FxQjdDOzs7QUFDQSxZQUFJLENBQUNLLGtCQUFMLEVBQXlCO0FBQ3ZCO0FBQ0QsU0F4QjRDLENBeUI3QztBQUNBO0FBQ0E7QUFDQTs7O0FBQ0EsZUFBTyxLQUFLMUIsd0JBQUwsQ0FBOEJzQixlQUE5QixFQUErQ3JHLElBQS9DLENBQW9ELFlBQVk7QUFDckU7QUFDQTtBQUNBO0FBQ0E7QUFDQSxjQUFJLEtBQUtULFFBQVQsRUFBbUI7QUFDakI7QUFDQThFLFlBQUFBLE1BQU0sQ0FBQ0MsSUFBUCxDQUFZK0IsZUFBWixFQUE2QkMsT0FBN0IsQ0FBcUM1QixRQUFRLElBQUk7QUFDL0MsbUJBQUtuRixRQUFMLENBQWNBLFFBQWQsQ0FBdUJ3RSxRQUF2QixDQUFnQ1csUUFBaEMsSUFDRTJCLGVBQWUsQ0FBQzNCLFFBQUQsQ0FEakI7QUFFRCxhQUhELEVBRmlCLENBT2pCO0FBQ0E7QUFDQTs7QUFDQSxtQkFBTyxLQUFLcEcsTUFBTCxDQUFZc0QsUUFBWixDQUFxQmUsTUFBckIsQ0FDTCxLQUFLbkUsU0FEQSxFQUVMO0FBQUVhLGNBQUFBLFFBQVEsRUFBRSxLQUFLWCxJQUFMLENBQVVXO0FBQXRCLGFBRkssRUFHTDtBQUFFMEUsY0FBQUEsUUFBUSxFQUFFc0M7QUFBWixhQUhLLEVBSUwsRUFKSyxDQUFQO0FBTUQ7QUFDRixTQXRCTSxDQUFQO0FBdUJELE9BcERELE1Bb0RPLElBQUlLLE1BQUosRUFBWTtBQUNqQjtBQUNBO0FBQ0EsWUFBSU4sVUFBVSxDQUFDL0csUUFBWCxLQUF3QnFILE1BQTVCLEVBQW9DO0FBQ2xDLGdCQUFNLElBQUl4SSxLQUFLLENBQUNhLEtBQVYsQ0FDSmIsS0FBSyxDQUFDYSxLQUFOLENBQVltSCxzQkFEUixFQUVKLDJCQUZJLENBQU47QUFJRCxTQVJnQixDQVNqQjs7O0FBQ0EsWUFBSSxDQUFDTyxrQkFBTCxFQUF5QjtBQUN2QjtBQUNEO0FBQ0Y7QUFDRjs7QUFDRCxXQUFPLEtBQUsxQix3QkFBTCxDQUE4QmhCLFFBQTlCLENBQVA7QUFDRCxHQWpHTSxDQUFQO0FBa0dELENBcEdELEMsQ0FzR0E7OztBQUNBMUYsU0FBUyxDQUFDdUIsU0FBVixDQUFvQmMsYUFBcEIsR0FBb0MsWUFBVztBQUM3QyxNQUFJa0csT0FBTyxHQUFHOUcsT0FBTyxDQUFDQyxPQUFSLEVBQWQ7O0FBRUEsTUFBSSxLQUFLdkIsU0FBTCxLQUFtQixPQUF2QixFQUFnQztBQUM5QixXQUFPb0ksT0FBUDtBQUNEOztBQUVELE1BQUksQ0FBQyxLQUFLckksSUFBTCxDQUFVMkMsUUFBWCxJQUF1QixtQkFBbUIsS0FBS3hDLElBQW5ELEVBQXlEO0FBQ3ZELFVBQU1tSSxLQUFLLEdBQUksK0RBQWY7QUFDQSxVQUFNLElBQUkzSSxLQUFLLENBQUNhLEtBQVYsQ0FBZ0JiLEtBQUssQ0FBQ2EsS0FBTixDQUFZQyxtQkFBNUIsRUFBaUQ2SCxLQUFqRCxDQUFOO0FBQ0QsR0FWNEMsQ0FZN0M7OztBQUNBLE1BQUksS0FBS3BJLEtBQUwsSUFBYyxLQUFLWSxRQUFMLEVBQWxCLEVBQW1DO0FBQ2pDO0FBQ0E7QUFDQXVILElBQUFBLE9BQU8sR0FBRyxJQUFJRSxrQkFBSixDQUFjLEtBQUt4SSxNQUFuQixFQUEyQlAsSUFBSSxDQUFDZ0osTUFBTCxDQUFZLEtBQUt6SSxNQUFqQixDQUEzQixFQUFxRCxVQUFyRCxFQUFpRTtBQUN6RThDLE1BQUFBLElBQUksRUFBRTtBQUNKNEYsUUFBQUEsTUFBTSxFQUFFLFNBREo7QUFFSnhJLFFBQUFBLFNBQVMsRUFBRSxPQUZQO0FBR0phLFFBQUFBLFFBQVEsRUFBRSxLQUFLQSxRQUFMO0FBSE47QUFEbUUsS0FBakUsRUFPUFEsT0FQTyxHQVFQRyxJQVJPLENBUUZnRyxPQUFPLElBQUk7QUFDZkEsTUFBQUEsT0FBTyxDQUFDQSxPQUFSLENBQWdCTSxPQUFoQixDQUF3QlcsT0FBTyxJQUM3QixLQUFLM0ksTUFBTCxDQUFZNEksZUFBWixDQUE0QjlGLElBQTVCLENBQWlDK0YsR0FBakMsQ0FBcUNGLE9BQU8sQ0FBQ0csWUFBN0MsQ0FERjtBQUdELEtBWk8sQ0FBVjtBQWFEOztBQUVELFNBQU9SLE9BQU8sQ0FDWDVHLElBREksQ0FDQyxNQUFNO0FBQ1Y7QUFDQSxRQUFJLEtBQUt0QixJQUFMLENBQVV5RixRQUFWLEtBQXVCa0QsU0FBM0IsRUFBc0M7QUFDcEM7QUFDQSxhQUFPdkgsT0FBTyxDQUFDQyxPQUFSLEVBQVA7QUFDRDs7QUFFRCxRQUFJLEtBQUt0QixLQUFULEVBQWdCO0FBQ2QsV0FBS1EsT0FBTCxDQUFhLGVBQWIsSUFBZ0MsSUFBaEMsQ0FEYyxDQUVkOztBQUNBLFVBQUksQ0FBQyxLQUFLVixJQUFMLENBQVUyQyxRQUFmLEVBQXlCO0FBQ3ZCLGFBQUtqQyxPQUFMLENBQWEsb0JBQWIsSUFBcUMsSUFBckM7QUFDRDtBQUNGOztBQUVELFdBQU8sS0FBS3FJLHVCQUFMLEdBQStCdEgsSUFBL0IsQ0FBb0MsTUFBTTtBQUMvQyxhQUFPL0IsY0FBYyxDQUFDc0osSUFBZixDQUFvQixLQUFLN0ksSUFBTCxDQUFVeUYsUUFBOUIsRUFBd0NuRSxJQUF4QyxDQUE2Q3dILGNBQWMsSUFBSTtBQUNwRSxhQUFLOUksSUFBTCxDQUFVK0ksZ0JBQVYsR0FBNkJELGNBQTdCO0FBQ0EsZUFBTyxLQUFLOUksSUFBTCxDQUFVeUYsUUFBakI7QUFDRCxPQUhNLENBQVA7QUFJRCxLQUxNLENBQVA7QUFNRCxHQXRCSSxFQXVCSm5FLElBdkJJLENBdUJDLE1BQU07QUFDVixXQUFPLEtBQUswSCxpQkFBTCxFQUFQO0FBQ0QsR0F6QkksRUEwQkoxSCxJQTFCSSxDQTBCQyxNQUFNO0FBQ1YsV0FBTyxLQUFLMkgsY0FBTCxFQUFQO0FBQ0QsR0E1QkksQ0FBUDtBQTZCRCxDQTVERDs7QUE4REF0SixTQUFTLENBQUN1QixTQUFWLENBQW9COEgsaUJBQXBCLEdBQXdDLFlBQVc7QUFDakQ7QUFDQSxNQUFJLENBQUMsS0FBS2hKLElBQUwsQ0FBVXNGLFFBQWYsRUFBeUI7QUFDdkIsUUFBSSxDQUFDLEtBQUt2RixLQUFWLEVBQWlCO0FBQ2YsV0FBS0MsSUFBTCxDQUFVc0YsUUFBVixHQUFxQmhHLFdBQVcsQ0FBQzRKLFlBQVosQ0FBeUIsRUFBekIsQ0FBckI7QUFDQSxXQUFLQywwQkFBTCxHQUFrQyxJQUFsQztBQUNEOztBQUNELFdBQU8vSCxPQUFPLENBQUNDLE9BQVIsRUFBUDtBQUNELEdBUmdELENBU2pEO0FBQ0E7OztBQUNBLFNBQU8sS0FBS3pCLE1BQUwsQ0FBWXNELFFBQVosQ0FDSitELElBREksQ0FFSCxLQUFLbkgsU0FGRixFQUdIO0FBQUV3RixJQUFBQSxRQUFRLEVBQUUsS0FBS3RGLElBQUwsQ0FBVXNGLFFBQXRCO0FBQWdDM0UsSUFBQUEsUUFBUSxFQUFFO0FBQUV5SSxNQUFBQSxHQUFHLEVBQUUsS0FBS3pJLFFBQUw7QUFBUDtBQUExQyxHQUhHLEVBSUg7QUFBRTBJLElBQUFBLEtBQUssRUFBRTtBQUFULEdBSkcsRUFNSi9ILElBTkksQ0FNQ2dHLE9BQU8sSUFBSTtBQUNmLFFBQUlBLE9BQU8sQ0FBQ2xELE1BQVIsR0FBaUIsQ0FBckIsRUFBd0I7QUFDdEIsWUFBTSxJQUFJNUUsS0FBSyxDQUFDYSxLQUFWLENBQ0piLEtBQUssQ0FBQ2EsS0FBTixDQUFZaUosY0FEUixFQUVKLDJDQUZJLENBQU47QUFJRDs7QUFDRDtBQUNELEdBZEksQ0FBUDtBQWVELENBMUJEOztBQTRCQTNKLFNBQVMsQ0FBQ3VCLFNBQVYsQ0FBb0IrSCxjQUFwQixHQUFxQyxZQUFXO0FBQzlDLE1BQUksQ0FBQyxLQUFLakosSUFBTCxDQUFVdUosS0FBWCxJQUFvQixLQUFLdkosSUFBTCxDQUFVdUosS0FBVixDQUFnQkMsSUFBaEIsS0FBeUIsUUFBakQsRUFBMkQ7QUFDekQsV0FBT3BJLE9BQU8sQ0FBQ0MsT0FBUixFQUFQO0FBQ0QsR0FINkMsQ0FJOUM7OztBQUNBLE1BQUksQ0FBQyxLQUFLckIsSUFBTCxDQUFVdUosS0FBVixDQUFnQkUsS0FBaEIsQ0FBc0IsU0FBdEIsQ0FBTCxFQUF1QztBQUNyQyxXQUFPckksT0FBTyxDQUFDc0ksTUFBUixDQUNMLElBQUlsSyxLQUFLLENBQUNhLEtBQVYsQ0FDRWIsS0FBSyxDQUFDYSxLQUFOLENBQVlzSixxQkFEZCxFQUVFLGtDQUZGLENBREssQ0FBUDtBQU1ELEdBWjZDLENBYTlDOzs7QUFDQSxTQUFPLEtBQUsvSixNQUFMLENBQVlzRCxRQUFaLENBQ0orRCxJQURJLENBRUgsS0FBS25ILFNBRkYsRUFHSDtBQUFFeUosSUFBQUEsS0FBSyxFQUFFLEtBQUt2SixJQUFMLENBQVV1SixLQUFuQjtBQUEwQjVJLElBQUFBLFFBQVEsRUFBRTtBQUFFeUksTUFBQUEsR0FBRyxFQUFFLEtBQUt6SSxRQUFMO0FBQVA7QUFBcEMsR0FIRyxFQUlIO0FBQUUwSSxJQUFBQSxLQUFLLEVBQUU7QUFBVCxHQUpHLEVBTUovSCxJQU5JLENBTUNnRyxPQUFPLElBQUk7QUFDZixRQUFJQSxPQUFPLENBQUNsRCxNQUFSLEdBQWlCLENBQXJCLEVBQXdCO0FBQ3RCLFlBQU0sSUFBSTVFLEtBQUssQ0FBQ2EsS0FBVixDQUNKYixLQUFLLENBQUNhLEtBQU4sQ0FBWXVKLFdBRFIsRUFFSixnREFGSSxDQUFOO0FBSUQ7O0FBQ0QsUUFDRSxDQUFDLEtBQUs1SixJQUFMLENBQVVxRixRQUFYLElBQ0EsQ0FBQ00sTUFBTSxDQUFDQyxJQUFQLENBQVksS0FBSzVGLElBQUwsQ0FBVXFGLFFBQXRCLEVBQWdDakIsTUFEakMsSUFFQ3VCLE1BQU0sQ0FBQ0MsSUFBUCxDQUFZLEtBQUs1RixJQUFMLENBQVVxRixRQUF0QixFQUFnQ2pCLE1BQWhDLEtBQTJDLENBQTNDLElBQ0N1QixNQUFNLENBQUNDLElBQVAsQ0FBWSxLQUFLNUYsSUFBTCxDQUFVcUYsUUFBdEIsRUFBZ0MsQ0FBaEMsTUFBdUMsV0FKM0MsRUFLRTtBQUNBO0FBQ0EsV0FBSzlFLE9BQUwsQ0FBYSx1QkFBYixJQUF3QyxJQUF4QztBQUNBLFdBQUtYLE1BQUwsQ0FBWWlLLGNBQVosQ0FBMkJDLG1CQUEzQixDQUErQyxLQUFLOUosSUFBcEQ7QUFDRDtBQUNGLEdBdkJJLENBQVA7QUF3QkQsQ0F0Q0Q7O0FBd0NBTCxTQUFTLENBQUN1QixTQUFWLENBQW9CMEgsdUJBQXBCLEdBQThDLFlBQVc7QUFDdkQsTUFBSSxDQUFDLEtBQUtoSixNQUFMLENBQVltSyxjQUFqQixFQUFpQyxPQUFPM0ksT0FBTyxDQUFDQyxPQUFSLEVBQVA7QUFDakMsU0FBTyxLQUFLMkksNkJBQUwsR0FBcUMxSSxJQUFyQyxDQUEwQyxNQUFNO0FBQ3JELFdBQU8sS0FBSzJJLHdCQUFMLEVBQVA7QUFDRCxHQUZNLENBQVA7QUFHRCxDQUxEOztBQU9BdEssU0FBUyxDQUFDdUIsU0FBVixDQUFvQjhJLDZCQUFwQixHQUFvRCxZQUFXO0FBQzdEO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxRQUFNRSxXQUFXLEdBQUcsS0FBS3RLLE1BQUwsQ0FBWW1LLGNBQVosQ0FBMkJJLGVBQTNCLEdBQ2hCLEtBQUt2SyxNQUFMLENBQVltSyxjQUFaLENBQTJCSSxlQURYLEdBRWhCLDBEQUZKO0FBR0EsUUFBTUMscUJBQXFCLEdBQUcsd0NBQTlCLENBWjZELENBYzdEOztBQUNBLE1BQ0csS0FBS3hLLE1BQUwsQ0FBWW1LLGNBQVosQ0FBMkJNLGdCQUEzQixJQUNDLENBQUMsS0FBS3pLLE1BQUwsQ0FBWW1LLGNBQVosQ0FBMkJNLGdCQUEzQixDQUE0QyxLQUFLckssSUFBTCxDQUFVeUYsUUFBdEQsQ0FESCxJQUVDLEtBQUs3RixNQUFMLENBQVltSyxjQUFaLENBQTJCTyxpQkFBM0IsSUFDQyxDQUFDLEtBQUsxSyxNQUFMLENBQVltSyxjQUFaLENBQTJCTyxpQkFBM0IsQ0FBNkMsS0FBS3RLLElBQUwsQ0FBVXlGLFFBQXZELENBSkwsRUFLRTtBQUNBLFdBQU9yRSxPQUFPLENBQUNzSSxNQUFSLENBQ0wsSUFBSWxLLEtBQUssQ0FBQ2EsS0FBVixDQUFnQmIsS0FBSyxDQUFDYSxLQUFOLENBQVlrSyxnQkFBNUIsRUFBOENMLFdBQTlDLENBREssQ0FBUDtBQUdELEdBeEI0RCxDQTBCN0Q7OztBQUNBLE1BQUksS0FBS3RLLE1BQUwsQ0FBWW1LLGNBQVosQ0FBMkJTLGtCQUEzQixLQUFrRCxJQUF0RCxFQUE0RDtBQUMxRCxRQUFJLEtBQUt4SyxJQUFMLENBQVVzRixRQUFkLEVBQXdCO0FBQ3RCO0FBQ0EsVUFBSSxLQUFLdEYsSUFBTCxDQUFVeUYsUUFBVixDQUFtQnhDLE9BQW5CLENBQTJCLEtBQUtqRCxJQUFMLENBQVVzRixRQUFyQyxLQUFrRCxDQUF0RCxFQUNFLE9BQU9sRSxPQUFPLENBQUNzSSxNQUFSLENBQ0wsSUFBSWxLLEtBQUssQ0FBQ2EsS0FBVixDQUFnQmIsS0FBSyxDQUFDYSxLQUFOLENBQVlrSyxnQkFBNUIsRUFBOENILHFCQUE5QyxDQURLLENBQVA7QUFHSCxLQU5ELE1BTU87QUFDTDtBQUNBLGFBQU8sS0FBS3hLLE1BQUwsQ0FBWXNELFFBQVosQ0FDSitELElBREksQ0FDQyxPQURELEVBQ1U7QUFBRXRHLFFBQUFBLFFBQVEsRUFBRSxLQUFLQSxRQUFMO0FBQVosT0FEVixFQUVKVyxJQUZJLENBRUNnRyxPQUFPLElBQUk7QUFDZixZQUFJQSxPQUFPLENBQUNsRCxNQUFSLElBQWtCLENBQXRCLEVBQXlCO0FBQ3ZCLGdCQUFNdUUsU0FBTjtBQUNEOztBQUNELFlBQUksS0FBSzNJLElBQUwsQ0FBVXlGLFFBQVYsQ0FBbUJ4QyxPQUFuQixDQUEyQnFFLE9BQU8sQ0FBQyxDQUFELENBQVAsQ0FBV2hDLFFBQXRDLEtBQW1ELENBQXZELEVBQ0UsT0FBT2xFLE9BQU8sQ0FBQ3NJLE1BQVIsQ0FDTCxJQUFJbEssS0FBSyxDQUFDYSxLQUFWLENBQ0ViLEtBQUssQ0FBQ2EsS0FBTixDQUFZa0ssZ0JBRGQsRUFFRUgscUJBRkYsQ0FESyxDQUFQO0FBTUYsZUFBT2hKLE9BQU8sQ0FBQ0MsT0FBUixFQUFQO0FBQ0QsT0FkSSxDQUFQO0FBZUQ7QUFDRjs7QUFDRCxTQUFPRCxPQUFPLENBQUNDLE9BQVIsRUFBUDtBQUNELENBdEREOztBQXdEQTFCLFNBQVMsQ0FBQ3VCLFNBQVYsQ0FBb0IrSSx3QkFBcEIsR0FBK0MsWUFBVztBQUN4RDtBQUNBLE1BQUksS0FBS2xLLEtBQUwsSUFBYyxLQUFLSCxNQUFMLENBQVltSyxjQUFaLENBQTJCVSxrQkFBN0MsRUFBaUU7QUFDL0QsV0FBTyxLQUFLN0ssTUFBTCxDQUFZc0QsUUFBWixDQUNKK0QsSUFESSxDQUVILE9BRkcsRUFHSDtBQUFFdEcsTUFBQUEsUUFBUSxFQUFFLEtBQUtBLFFBQUw7QUFBWixLQUhHLEVBSUg7QUFBRWlGLE1BQUFBLElBQUksRUFBRSxDQUFDLG1CQUFELEVBQXNCLGtCQUF0QjtBQUFSLEtBSkcsRUFNSnRFLElBTkksQ0FNQ2dHLE9BQU8sSUFBSTtBQUNmLFVBQUlBLE9BQU8sQ0FBQ2xELE1BQVIsSUFBa0IsQ0FBdEIsRUFBeUI7QUFDdkIsY0FBTXVFLFNBQU47QUFDRDs7QUFDRCxZQUFNakcsSUFBSSxHQUFHNEUsT0FBTyxDQUFDLENBQUQsQ0FBcEI7QUFDQSxVQUFJb0QsWUFBWSxHQUFHLEVBQW5CO0FBQ0EsVUFBSWhJLElBQUksQ0FBQ2lJLGlCQUFULEVBQ0VELFlBQVksR0FBR2pHLGdCQUFFbUcsSUFBRixDQUNibEksSUFBSSxDQUFDaUksaUJBRFEsRUFFYixLQUFLL0ssTUFBTCxDQUFZbUssY0FBWixDQUEyQlUsa0JBQTNCLEdBQWdELENBRm5DLENBQWY7QUFJRkMsTUFBQUEsWUFBWSxDQUFDNUYsSUFBYixDQUFrQnBDLElBQUksQ0FBQytDLFFBQXZCO0FBQ0EsWUFBTW9GLFdBQVcsR0FBRyxLQUFLN0ssSUFBTCxDQUFVeUYsUUFBOUIsQ0FaZSxDQWFmOztBQUNBLFlBQU1xRixRQUFRLEdBQUdKLFlBQVksQ0FBQ25FLEdBQWIsQ0FBaUIsVUFBU3NDLElBQVQsRUFBZTtBQUMvQyxlQUFPdEosY0FBYyxDQUFDd0wsT0FBZixDQUF1QkYsV0FBdkIsRUFBb0NoQyxJQUFwQyxFQUEwQ3ZILElBQTFDLENBQStDNkMsTUFBTSxJQUFJO0FBQzlELGNBQUlBLE1BQUosRUFDRTtBQUNBLG1CQUFPL0MsT0FBTyxDQUFDc0ksTUFBUixDQUFlLGlCQUFmLENBQVA7QUFDRixpQkFBT3RJLE9BQU8sQ0FBQ0MsT0FBUixFQUFQO0FBQ0QsU0FMTSxDQUFQO0FBTUQsT0FQZ0IsQ0FBakIsQ0FkZSxDQXNCZjs7QUFDQSxhQUFPRCxPQUFPLENBQUNzRixHQUFSLENBQVlvRSxRQUFaLEVBQ0p4SixJQURJLENBQ0MsTUFBTTtBQUNWLGVBQU9GLE9BQU8sQ0FBQ0MsT0FBUixFQUFQO0FBQ0QsT0FISSxFQUlKMkosS0FKSSxDQUlFQyxHQUFHLElBQUk7QUFDWixZQUFJQSxHQUFHLEtBQUssaUJBQVosRUFDRTtBQUNBLGlCQUFPN0osT0FBTyxDQUFDc0ksTUFBUixDQUNMLElBQUlsSyxLQUFLLENBQUNhLEtBQVYsQ0FDRWIsS0FBSyxDQUFDYSxLQUFOLENBQVlrSyxnQkFEZCxFQUVHLCtDQUNDLEtBQUszSyxNQUFMLENBQVltSyxjQUFaLENBQTJCVSxrQkFDNUIsYUFKSCxDQURLLENBQVA7QUFRRixjQUFNUSxHQUFOO0FBQ0QsT0FoQkksQ0FBUDtBQWlCRCxLQTlDSSxDQUFQO0FBK0NEOztBQUNELFNBQU83SixPQUFPLENBQUNDLE9BQVIsRUFBUDtBQUNELENBcEREOztBQXNEQTFCLFNBQVMsQ0FBQ3VCLFNBQVYsQ0FBb0JrQiwwQkFBcEIsR0FBaUQsWUFBVztBQUMxRCxNQUFJLEtBQUt0QyxTQUFMLEtBQW1CLE9BQXZCLEVBQWdDO0FBQzlCO0FBQ0Q7O0FBQ0QsTUFBSSxLQUFLQyxLQUFULEVBQWdCO0FBQ2Q7QUFDRDs7QUFDRCxNQUNFLENBQUMsS0FBS1EsT0FBTCxDQUFhLGNBQWIsQ0FBRCxJQUFpQztBQUNqQyxPQUFLWCxNQUFMLENBQVlzTCwrQkFEWixJQUMrQztBQUMvQyxPQUFLdEwsTUFBTCxDQUFZdUwsZ0JBSGQsRUFJRTtBQUNBO0FBQ0EsV0FGQSxDQUVRO0FBQ1Q7O0FBQ0QsU0FBTyxLQUFLQyxrQkFBTCxFQUFQO0FBQ0QsQ0FoQkQ7O0FBa0JBekwsU0FBUyxDQUFDdUIsU0FBVixDQUFvQmtLLGtCQUFwQixHQUF5QyxZQUFXO0FBQ2xEO0FBQ0E7QUFDQSxNQUFJLEtBQUt2TCxJQUFMLENBQVV3TCxjQUFWLElBQTRCLEtBQUt4TCxJQUFMLENBQVV3TCxjQUFWLEtBQTZCLE9BQTdELEVBQXNFO0FBQ3BFO0FBQ0Q7O0FBRUQsUUFBTTtBQUFFQyxJQUFBQSxXQUFGO0FBQWVDLElBQUFBO0FBQWYsTUFBaUNsTSxJQUFJLENBQUNrTSxhQUFMLENBQW1CLEtBQUszTCxNQUF4QixFQUFnQztBQUNyRW9JLElBQUFBLE1BQU0sRUFBRSxLQUFLckgsUUFBTCxFQUQ2RDtBQUVyRTZLLElBQUFBLFdBQVcsRUFBRTtBQUNYQyxNQUFBQSxNQUFNLEVBQUUsS0FBS2xMLE9BQUwsQ0FBYSxjQUFiLElBQStCLE9BQS9CLEdBQXlDLFFBRHRDO0FBRVhtTCxNQUFBQSxZQUFZLEVBQUUsS0FBS25MLE9BQUwsQ0FBYSxjQUFiLEtBQWdDO0FBRm5DLEtBRndEO0FBTXJFOEssSUFBQUEsY0FBYyxFQUFFLEtBQUt4TCxJQUFMLENBQVV3TDtBQU4yQyxHQUFoQyxDQUF2Qzs7QUFTQSxNQUFJLEtBQUt4SyxRQUFMLElBQWlCLEtBQUtBLFFBQUwsQ0FBY0EsUUFBbkMsRUFBNkM7QUFDM0MsU0FBS0EsUUFBTCxDQUFjQSxRQUFkLENBQXVCNkgsWUFBdkIsR0FBc0M0QyxXQUFXLENBQUM1QyxZQUFsRDtBQUNEOztBQUVELFNBQU82QyxhQUFhLEVBQXBCO0FBQ0QsQ0FyQkQsQyxDQXVCQTs7O0FBQ0E1TCxTQUFTLENBQUN1QixTQUFWLENBQW9CVyw2QkFBcEIsR0FBb0QsWUFBVztBQUM3RCxNQUFJLEtBQUsvQixTQUFMLEtBQW1CLE9BQW5CLElBQThCLEtBQUtDLEtBQUwsS0FBZSxJQUFqRCxFQUF1RDtBQUNyRDtBQUNBO0FBQ0Q7O0FBRUQsTUFBSSxjQUFjLEtBQUtDLElBQW5CLElBQTJCLFdBQVcsS0FBS0EsSUFBL0MsRUFBcUQ7QUFDbkQsVUFBTTJMLE1BQU0sR0FBRztBQUNiQyxNQUFBQSxpQkFBaUIsRUFBRTtBQUFFcEMsUUFBQUEsSUFBSSxFQUFFO0FBQVIsT0FETjtBQUVicUMsTUFBQUEsNEJBQTRCLEVBQUU7QUFBRXJDLFFBQUFBLElBQUksRUFBRTtBQUFSO0FBRmpCLEtBQWY7QUFJQSxTQUFLeEosSUFBTCxHQUFZMkYsTUFBTSxDQUFDbUcsTUFBUCxDQUFjLEtBQUs5TCxJQUFuQixFQUF5QjJMLE1BQXpCLENBQVo7QUFDRDtBQUNGLENBYkQ7O0FBZUFoTSxTQUFTLENBQUN1QixTQUFWLENBQW9CZ0IseUJBQXBCLEdBQWdELFlBQVc7QUFDekQ7QUFDQSxNQUFJLEtBQUtwQyxTQUFMLElBQWtCLFVBQWxCLElBQWdDLEtBQUtDLEtBQXpDLEVBQWdEO0FBQzlDO0FBQ0QsR0FKd0QsQ0FLekQ7OztBQUNBLFFBQU07QUFBRTJDLElBQUFBLElBQUY7QUFBUTJJLElBQUFBLGNBQVI7QUFBd0IzQyxJQUFBQTtBQUF4QixNQUF5QyxLQUFLMUksSUFBcEQ7O0FBQ0EsTUFBSSxDQUFDMEMsSUFBRCxJQUFTLENBQUMySSxjQUFkLEVBQThCO0FBQzVCO0FBQ0Q7O0FBQ0QsTUFBSSxDQUFDM0ksSUFBSSxDQUFDL0IsUUFBVixFQUFvQjtBQUNsQjtBQUNEOztBQUNELE9BQUtmLE1BQUwsQ0FBWXNELFFBQVosQ0FBcUI2SSxPQUFyQixDQUE2QixVQUE3QixFQUF5QztBQUN2Q3JKLElBQUFBLElBRHVDO0FBRXZDMkksSUFBQUEsY0FGdUM7QUFHdkMzQyxJQUFBQSxZQUFZLEVBQUU7QUFBRVUsTUFBQUEsR0FBRyxFQUFFVjtBQUFQO0FBSHlCLEdBQXpDO0FBS0QsQ0FsQkQsQyxDQW9CQTs7O0FBQ0EvSSxTQUFTLENBQUN1QixTQUFWLENBQW9CbUIsY0FBcEIsR0FBcUMsWUFBVztBQUM5QyxNQUNFLEtBQUs5QixPQUFMLElBQ0EsS0FBS0EsT0FBTCxDQUFhLGVBQWIsQ0FEQSxJQUVBLEtBQUtYLE1BQUwsQ0FBWW9NLDRCQUhkLEVBSUU7QUFDQSxRQUFJQyxZQUFZLEdBQUc7QUFDakJ2SixNQUFBQSxJQUFJLEVBQUU7QUFDSjRGLFFBQUFBLE1BQU0sRUFBRSxTQURKO0FBRUp4SSxRQUFBQSxTQUFTLEVBQUUsT0FGUDtBQUdKYSxRQUFBQSxRQUFRLEVBQUUsS0FBS0EsUUFBTDtBQUhOO0FBRFcsS0FBbkI7QUFPQSxXQUFPLEtBQUtKLE9BQUwsQ0FBYSxlQUFiLENBQVA7QUFDQSxXQUFPLEtBQUtYLE1BQUwsQ0FBWXNELFFBQVosQ0FDSjZJLE9BREksQ0FDSSxVQURKLEVBQ2dCRSxZQURoQixFQUVKM0ssSUFGSSxDQUVDLEtBQUtlLGNBQUwsQ0FBb0I2SixJQUFwQixDQUF5QixJQUF6QixDQUZELENBQVA7QUFHRDs7QUFFRCxNQUFJLEtBQUszTCxPQUFMLElBQWdCLEtBQUtBLE9BQUwsQ0FBYSxvQkFBYixDQUFwQixFQUF3RDtBQUN0RCxXQUFPLEtBQUtBLE9BQUwsQ0FBYSxvQkFBYixDQUFQO0FBQ0EsV0FBTyxLQUFLNkssa0JBQUwsR0FBMEI5SixJQUExQixDQUErQixLQUFLZSxjQUFMLENBQW9CNkosSUFBcEIsQ0FBeUIsSUFBekIsQ0FBL0IsQ0FBUDtBQUNEOztBQUVELE1BQUksS0FBSzNMLE9BQUwsSUFBZ0IsS0FBS0EsT0FBTCxDQUFhLHVCQUFiLENBQXBCLEVBQTJEO0FBQ3pELFdBQU8sS0FBS0EsT0FBTCxDQUFhLHVCQUFiLENBQVAsQ0FEeUQsQ0FFekQ7O0FBQ0EsU0FBS1gsTUFBTCxDQUFZaUssY0FBWixDQUEyQnNDLHFCQUEzQixDQUFpRCxLQUFLbk0sSUFBdEQ7QUFDQSxXQUFPLEtBQUtxQyxjQUFMLENBQW9CNkosSUFBcEIsQ0FBeUIsSUFBekIsQ0FBUDtBQUNEO0FBQ0YsQ0E5QkQsQyxDQWdDQTtBQUNBOzs7QUFDQXZNLFNBQVMsQ0FBQ3VCLFNBQVYsQ0FBb0JRLGFBQXBCLEdBQW9DLFlBQVc7QUFDN0MsTUFBSSxLQUFLYixRQUFMLElBQWlCLEtBQUtmLFNBQUwsS0FBbUIsVUFBeEMsRUFBb0Q7QUFDbEQ7QUFDRDs7QUFFRCxNQUFJLENBQUMsS0FBS0QsSUFBTCxDQUFVNkMsSUFBWCxJQUFtQixDQUFDLEtBQUs3QyxJQUFMLENBQVUyQyxRQUFsQyxFQUE0QztBQUMxQyxVQUFNLElBQUloRCxLQUFLLENBQUNhLEtBQVYsQ0FDSmIsS0FBSyxDQUFDYSxLQUFOLENBQVkrTCxxQkFEUixFQUVKLHlCQUZJLENBQU47QUFJRCxHQVY0QyxDQVk3Qzs7O0FBQ0EsTUFBSSxLQUFLcE0sSUFBTCxDQUFVcUgsR0FBZCxFQUFtQjtBQUNqQixVQUFNLElBQUk3SCxLQUFLLENBQUNhLEtBQVYsQ0FDSmIsS0FBSyxDQUFDYSxLQUFOLENBQVlPLGdCQURSLEVBRUosZ0JBQWdCLG1CQUZaLENBQU47QUFJRDs7QUFFRCxNQUFJLEtBQUtiLEtBQVQsRUFBZ0I7QUFDZCxRQUNFLEtBQUtDLElBQUwsQ0FBVTBDLElBQVYsSUFDQSxDQUFDLEtBQUs3QyxJQUFMLENBQVUyQyxRQURYLElBRUEsS0FBS3hDLElBQUwsQ0FBVTBDLElBQVYsQ0FBZS9CLFFBQWYsSUFBMkIsS0FBS2QsSUFBTCxDQUFVNkMsSUFBVixDQUFlSSxFQUg1QyxFQUlFO0FBQ0EsWUFBTSxJQUFJdEQsS0FBSyxDQUFDYSxLQUFWLENBQWdCYixLQUFLLENBQUNhLEtBQU4sQ0FBWU8sZ0JBQTVCLENBQU47QUFDRCxLQU5ELE1BTU8sSUFBSSxLQUFLWixJQUFMLENBQVVxTCxjQUFkLEVBQThCO0FBQ25DLFlBQU0sSUFBSTdMLEtBQUssQ0FBQ2EsS0FBVixDQUFnQmIsS0FBSyxDQUFDYSxLQUFOLENBQVlPLGdCQUE1QixDQUFOO0FBQ0QsS0FGTSxNQUVBLElBQUksS0FBS1osSUFBTCxDQUFVMEksWUFBZCxFQUE0QjtBQUNqQyxZQUFNLElBQUlsSixLQUFLLENBQUNhLEtBQVYsQ0FBZ0JiLEtBQUssQ0FBQ2EsS0FBTixDQUFZTyxnQkFBNUIsQ0FBTjtBQUNEO0FBQ0Y7O0FBRUQsTUFBSSxDQUFDLEtBQUtiLEtBQU4sSUFBZSxDQUFDLEtBQUtGLElBQUwsQ0FBVTJDLFFBQTlCLEVBQXdDO0FBQ3RDLFVBQU02SixxQkFBcUIsR0FBRyxFQUE5Qjs7QUFDQSxTQUFLLElBQUl6SCxHQUFULElBQWdCLEtBQUs1RSxJQUFyQixFQUEyQjtBQUN6QixVQUFJNEUsR0FBRyxLQUFLLFVBQVIsSUFBc0JBLEdBQUcsS0FBSyxNQUFsQyxFQUEwQztBQUN4QztBQUNEOztBQUNEeUgsTUFBQUEscUJBQXFCLENBQUN6SCxHQUFELENBQXJCLEdBQTZCLEtBQUs1RSxJQUFMLENBQVU0RSxHQUFWLENBQTdCO0FBQ0Q7O0FBRUQsVUFBTTtBQUFFMEcsTUFBQUEsV0FBRjtBQUFlQyxNQUFBQTtBQUFmLFFBQWlDbE0sSUFBSSxDQUFDa00sYUFBTCxDQUFtQixLQUFLM0wsTUFBeEIsRUFBZ0M7QUFDckVvSSxNQUFBQSxNQUFNLEVBQUUsS0FBS25JLElBQUwsQ0FBVTZDLElBQVYsQ0FBZUksRUFEOEM7QUFFckUwSSxNQUFBQSxXQUFXLEVBQUU7QUFDWEMsUUFBQUEsTUFBTSxFQUFFO0FBREcsT0FGd0Q7QUFLckVZLE1BQUFBO0FBTHFFLEtBQWhDLENBQXZDO0FBUUEsV0FBT2QsYUFBYSxHQUFHakssSUFBaEIsQ0FBcUJnRyxPQUFPLElBQUk7QUFDckMsVUFBSSxDQUFDQSxPQUFPLENBQUN6RyxRQUFiLEVBQXVCO0FBQ3JCLGNBQU0sSUFBSXJCLEtBQUssQ0FBQ2EsS0FBVixDQUNKYixLQUFLLENBQUNhLEtBQU4sQ0FBWWlNLHFCQURSLEVBRUoseUJBRkksQ0FBTjtBQUlEOztBQUNEaEIsTUFBQUEsV0FBVyxDQUFDLFVBQUQsQ0FBWCxHQUEwQmhFLE9BQU8sQ0FBQ3pHLFFBQVIsQ0FBaUIsVUFBakIsQ0FBMUI7QUFDQSxXQUFLQSxRQUFMLEdBQWdCO0FBQ2QwTCxRQUFBQSxNQUFNLEVBQUUsR0FETTtBQUVkdEUsUUFBQUEsUUFBUSxFQUFFWCxPQUFPLENBQUNXLFFBRko7QUFHZHBILFFBQUFBLFFBQVEsRUFBRXlLO0FBSEksT0FBaEI7QUFLRCxLQWJNLENBQVA7QUFjRDtBQUNGLENBbEVELEMsQ0FvRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FBQ0EzTCxTQUFTLENBQUN1QixTQUFWLENBQW9CTyxrQkFBcEIsR0FBeUMsWUFBVztBQUNsRCxNQUFJLEtBQUtaLFFBQUwsSUFBaUIsS0FBS2YsU0FBTCxLQUFtQixlQUF4QyxFQUF5RDtBQUN2RDtBQUNEOztBQUVELE1BQ0UsQ0FBQyxLQUFLQyxLQUFOLElBQ0EsQ0FBQyxLQUFLQyxJQUFMLENBQVV3TSxXQURYLElBRUEsQ0FBQyxLQUFLeE0sSUFBTCxDQUFVcUwsY0FGWCxJQUdBLENBQUMsS0FBS3hMLElBQUwsQ0FBVXdMLGNBSmIsRUFLRTtBQUNBLFVBQU0sSUFBSTdMLEtBQUssQ0FBQ2EsS0FBVixDQUNKLEdBREksRUFFSix5REFDRSxxQ0FIRSxDQUFOO0FBS0QsR0FoQmlELENBa0JsRDtBQUNBOzs7QUFDQSxNQUFJLEtBQUtMLElBQUwsQ0FBVXdNLFdBQVYsSUFBeUIsS0FBS3hNLElBQUwsQ0FBVXdNLFdBQVYsQ0FBc0JwSSxNQUF0QixJQUFnQyxFQUE3RCxFQUFpRTtBQUMvRCxTQUFLcEUsSUFBTCxDQUFVd00sV0FBVixHQUF3QixLQUFLeE0sSUFBTCxDQUFVd00sV0FBVixDQUFzQkMsV0FBdEIsRUFBeEI7QUFDRCxHQXRCaUQsQ0F3QmxEOzs7QUFDQSxNQUFJLEtBQUt6TSxJQUFMLENBQVVxTCxjQUFkLEVBQThCO0FBQzVCLFNBQUtyTCxJQUFMLENBQVVxTCxjQUFWLEdBQTJCLEtBQUtyTCxJQUFMLENBQVVxTCxjQUFWLENBQXlCb0IsV0FBekIsRUFBM0I7QUFDRDs7QUFFRCxNQUFJcEIsY0FBYyxHQUFHLEtBQUtyTCxJQUFMLENBQVVxTCxjQUEvQixDQTdCa0QsQ0ErQmxEOztBQUNBLE1BQUksQ0FBQ0EsY0FBRCxJQUFtQixDQUFDLEtBQUt4TCxJQUFMLENBQVUyQyxRQUFsQyxFQUE0QztBQUMxQzZJLElBQUFBLGNBQWMsR0FBRyxLQUFLeEwsSUFBTCxDQUFVd0wsY0FBM0I7QUFDRDs7QUFFRCxNQUFJQSxjQUFKLEVBQW9CO0FBQ2xCQSxJQUFBQSxjQUFjLEdBQUdBLGNBQWMsQ0FBQ29CLFdBQWYsRUFBakI7QUFDRCxHQXRDaUQsQ0F3Q2xEOzs7QUFDQSxNQUNFLEtBQUsxTSxLQUFMLElBQ0EsQ0FBQyxLQUFLQyxJQUFMLENBQVV3TSxXQURYLElBRUEsQ0FBQ25CLGNBRkQsSUFHQSxDQUFDLEtBQUtyTCxJQUFMLENBQVUwTSxVQUpiLEVBS0U7QUFDQTtBQUNEOztBQUVELE1BQUl4RSxPQUFPLEdBQUc5RyxPQUFPLENBQUNDLE9BQVIsRUFBZDtBQUVBLE1BQUlzTCxPQUFKLENBcERrRCxDQW9EckM7O0FBQ2IsTUFBSUMsYUFBSjtBQUNBLE1BQUlDLG1CQUFKO0FBQ0EsTUFBSUMsa0JBQWtCLEdBQUcsRUFBekIsQ0F2RGtELENBeURsRDs7QUFDQSxRQUFNQyxTQUFTLEdBQUcsRUFBbEI7O0FBQ0EsTUFBSSxLQUFLaE4sS0FBTCxJQUFjLEtBQUtBLEtBQUwsQ0FBV1ksUUFBN0IsRUFBdUM7QUFDckNvTSxJQUFBQSxTQUFTLENBQUNqSSxJQUFWLENBQWU7QUFDYm5FLE1BQUFBLFFBQVEsRUFBRSxLQUFLWixLQUFMLENBQVdZO0FBRFIsS0FBZjtBQUdEOztBQUNELE1BQUkwSyxjQUFKLEVBQW9CO0FBQ2xCMEIsSUFBQUEsU0FBUyxDQUFDakksSUFBVixDQUFlO0FBQ2J1RyxNQUFBQSxjQUFjLEVBQUVBO0FBREgsS0FBZjtBQUdEOztBQUNELE1BQUksS0FBS3JMLElBQUwsQ0FBVXdNLFdBQWQsRUFBMkI7QUFDekJPLElBQUFBLFNBQVMsQ0FBQ2pJLElBQVYsQ0FBZTtBQUFFMEgsTUFBQUEsV0FBVyxFQUFFLEtBQUt4TSxJQUFMLENBQVV3TTtBQUF6QixLQUFmO0FBQ0Q7O0FBRUQsTUFBSU8sU0FBUyxDQUFDM0ksTUFBVixJQUFvQixDQUF4QixFQUEyQjtBQUN6QjtBQUNEOztBQUVEOEQsRUFBQUEsT0FBTyxHQUFHQSxPQUFPLENBQ2Q1RyxJQURPLENBQ0YsTUFBTTtBQUNWLFdBQU8sS0FBSzFCLE1BQUwsQ0FBWXNELFFBQVosQ0FBcUIrRCxJQUFyQixDQUNMLGVBREssRUFFTDtBQUNFQyxNQUFBQSxHQUFHLEVBQUU2RjtBQURQLEtBRkssRUFLTCxFQUxLLENBQVA7QUFPRCxHQVRPLEVBVVB6TCxJQVZPLENBVUZnRyxPQUFPLElBQUk7QUFDZkEsSUFBQUEsT0FBTyxDQUFDTSxPQUFSLENBQWdCekQsTUFBTSxJQUFJO0FBQ3hCLFVBQ0UsS0FBS3BFLEtBQUwsSUFDQSxLQUFLQSxLQUFMLENBQVdZLFFBRFgsSUFFQXdELE1BQU0sQ0FBQ3hELFFBQVAsSUFBbUIsS0FBS1osS0FBTCxDQUFXWSxRQUhoQyxFQUlFO0FBQ0FpTSxRQUFBQSxhQUFhLEdBQUd6SSxNQUFoQjtBQUNEOztBQUNELFVBQUlBLE1BQU0sQ0FBQ2tILGNBQVAsSUFBeUJBLGNBQTdCLEVBQTZDO0FBQzNDd0IsUUFBQUEsbUJBQW1CLEdBQUcxSSxNQUF0QjtBQUNEOztBQUNELFVBQUlBLE1BQU0sQ0FBQ3FJLFdBQVAsSUFBc0IsS0FBS3hNLElBQUwsQ0FBVXdNLFdBQXBDLEVBQWlEO0FBQy9DTSxRQUFBQSxrQkFBa0IsQ0FBQ2hJLElBQW5CLENBQXdCWCxNQUF4QjtBQUNEO0FBQ0YsS0FkRCxFQURlLENBaUJmOztBQUNBLFFBQUksS0FBS3BFLEtBQUwsSUFBYyxLQUFLQSxLQUFMLENBQVdZLFFBQTdCLEVBQXVDO0FBQ3JDLFVBQUksQ0FBQ2lNLGFBQUwsRUFBb0I7QUFDbEIsY0FBTSxJQUFJcE4sS0FBSyxDQUFDYSxLQUFWLENBQ0piLEtBQUssQ0FBQ2EsS0FBTixDQUFZZ0UsZ0JBRFIsRUFFSiw4QkFGSSxDQUFOO0FBSUQ7O0FBQ0QsVUFDRSxLQUFLckUsSUFBTCxDQUFVcUwsY0FBVixJQUNBdUIsYUFBYSxDQUFDdkIsY0FEZCxJQUVBLEtBQUtyTCxJQUFMLENBQVVxTCxjQUFWLEtBQTZCdUIsYUFBYSxDQUFDdkIsY0FIN0MsRUFJRTtBQUNBLGNBQU0sSUFBSTdMLEtBQUssQ0FBQ2EsS0FBVixDQUNKLEdBREksRUFFSiwrQ0FBK0MsV0FGM0MsQ0FBTjtBQUlEOztBQUNELFVBQ0UsS0FBS0wsSUFBTCxDQUFVd00sV0FBVixJQUNBSSxhQUFhLENBQUNKLFdBRGQsSUFFQSxLQUFLeE0sSUFBTCxDQUFVd00sV0FBVixLQUEwQkksYUFBYSxDQUFDSixXQUZ4QyxJQUdBLENBQUMsS0FBS3hNLElBQUwsQ0FBVXFMLGNBSFgsSUFJQSxDQUFDdUIsYUFBYSxDQUFDdkIsY0FMakIsRUFNRTtBQUNBLGNBQU0sSUFBSTdMLEtBQUssQ0FBQ2EsS0FBVixDQUNKLEdBREksRUFFSiw0Q0FBNEMsV0FGeEMsQ0FBTjtBQUlEOztBQUNELFVBQ0UsS0FBS0wsSUFBTCxDQUFVME0sVUFBVixJQUNBLEtBQUsxTSxJQUFMLENBQVUwTSxVQURWLElBRUEsS0FBSzFNLElBQUwsQ0FBVTBNLFVBQVYsS0FBeUJFLGFBQWEsQ0FBQ0YsVUFIekMsRUFJRTtBQUNBLGNBQU0sSUFBSWxOLEtBQUssQ0FBQ2EsS0FBVixDQUNKLEdBREksRUFFSiwyQ0FBMkMsV0FGdkMsQ0FBTjtBQUlEO0FBQ0Y7O0FBRUQsUUFBSSxLQUFLTixLQUFMLElBQWMsS0FBS0EsS0FBTCxDQUFXWSxRQUF6QixJQUFxQ2lNLGFBQXpDLEVBQXdEO0FBQ3RERCxNQUFBQSxPQUFPLEdBQUdDLGFBQVY7QUFDRDs7QUFFRCxRQUFJdkIsY0FBYyxJQUFJd0IsbUJBQXRCLEVBQTJDO0FBQ3pDRixNQUFBQSxPQUFPLEdBQUdFLG1CQUFWO0FBQ0QsS0FqRWMsQ0FrRWY7OztBQUNBLFFBQUksQ0FBQyxLQUFLOU0sS0FBTixJQUFlLENBQUMsS0FBS0MsSUFBTCxDQUFVME0sVUFBMUIsSUFBd0MsQ0FBQ0MsT0FBN0MsRUFBc0Q7QUFDcEQsWUFBTSxJQUFJbk4sS0FBSyxDQUFDYSxLQUFWLENBQ0osR0FESSxFQUVKLGdEQUZJLENBQU47QUFJRDtBQUNGLEdBbkZPLEVBb0ZQaUIsSUFwRk8sQ0FvRkYsTUFBTTtBQUNWLFFBQUksQ0FBQ3FMLE9BQUwsRUFBYztBQUNaLFVBQUksQ0FBQ0csa0JBQWtCLENBQUMxSSxNQUF4QixFQUFnQztBQUM5QjtBQUNELE9BRkQsTUFFTyxJQUNMMEksa0JBQWtCLENBQUMxSSxNQUFuQixJQUE2QixDQUE3QixLQUNDLENBQUMwSSxrQkFBa0IsQ0FBQyxDQUFELENBQWxCLENBQXNCLGdCQUF0QixDQUFELElBQTRDLENBQUN6QixjQUQ5QyxDQURLLEVBR0w7QUFDQTtBQUNBO0FBQ0E7QUFDQSxlQUFPeUIsa0JBQWtCLENBQUMsQ0FBRCxDQUFsQixDQUFzQixVQUF0QixDQUFQO0FBQ0QsT0FSTSxNQVFBLElBQUksQ0FBQyxLQUFLOU0sSUFBTCxDQUFVcUwsY0FBZixFQUErQjtBQUNwQyxjQUFNLElBQUk3TCxLQUFLLENBQUNhLEtBQVYsQ0FDSixHQURJLEVBRUosa0RBQ0UsdUNBSEUsQ0FBTjtBQUtELE9BTk0sTUFNQTtBQUNMO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxZQUFJMk0sUUFBUSxHQUFHO0FBQ2JSLFVBQUFBLFdBQVcsRUFBRSxLQUFLeE0sSUFBTCxDQUFVd00sV0FEVjtBQUVibkIsVUFBQUEsY0FBYyxFQUFFO0FBQ2RqQyxZQUFBQSxHQUFHLEVBQUVpQztBQURTO0FBRkgsU0FBZjs7QUFNQSxZQUFJLEtBQUtyTCxJQUFMLENBQVVpTixhQUFkLEVBQTZCO0FBQzNCRCxVQUFBQSxRQUFRLENBQUMsZUFBRCxDQUFSLEdBQTRCLEtBQUtoTixJQUFMLENBQVVpTixhQUF0QztBQUNEOztBQUNELGFBQUtyTixNQUFMLENBQVlzRCxRQUFaLENBQXFCNkksT0FBckIsQ0FBNkIsZUFBN0IsRUFBOENpQixRQUE5QyxFQUF3RGhDLEtBQXhELENBQThEQyxHQUFHLElBQUk7QUFDbkUsY0FBSUEsR0FBRyxDQUFDaUMsSUFBSixJQUFZMU4sS0FBSyxDQUFDYSxLQUFOLENBQVlnRSxnQkFBNUIsRUFBOEM7QUFDNUM7QUFDQTtBQUNELFdBSmtFLENBS25FOzs7QUFDQSxnQkFBTTRHLEdBQU47QUFDRCxTQVBEO0FBUUE7QUFDRDtBQUNGLEtBMUNELE1BMENPO0FBQ0wsVUFDRTZCLGtCQUFrQixDQUFDMUksTUFBbkIsSUFBNkIsQ0FBN0IsSUFDQSxDQUFDMEksa0JBQWtCLENBQUMsQ0FBRCxDQUFsQixDQUFzQixnQkFBdEIsQ0FGSCxFQUdFO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsY0FBTUUsUUFBUSxHQUFHO0FBQUVyTSxVQUFBQSxRQUFRLEVBQUVnTSxPQUFPLENBQUNoTTtBQUFwQixTQUFqQjtBQUNBLGVBQU8sS0FBS2YsTUFBTCxDQUFZc0QsUUFBWixDQUNKNkksT0FESSxDQUNJLGVBREosRUFDcUJpQixRQURyQixFQUVKMUwsSUFGSSxDQUVDLE1BQU07QUFDVixpQkFBT3dMLGtCQUFrQixDQUFDLENBQUQsQ0FBbEIsQ0FBc0IsVUFBdEIsQ0FBUDtBQUNELFNBSkksRUFLSjlCLEtBTEksQ0FLRUMsR0FBRyxJQUFJO0FBQ1osY0FBSUEsR0FBRyxDQUFDaUMsSUFBSixJQUFZMU4sS0FBSyxDQUFDYSxLQUFOLENBQVlnRSxnQkFBNUIsRUFBOEM7QUFDNUM7QUFDQTtBQUNELFdBSlcsQ0FLWjs7O0FBQ0EsZ0JBQU00RyxHQUFOO0FBQ0QsU0FaSSxDQUFQO0FBYUQsT0FyQkQsTUFxQk87QUFDTCxZQUNFLEtBQUtqTCxJQUFMLENBQVV3TSxXQUFWLElBQ0FHLE9BQU8sQ0FBQ0gsV0FBUixJQUF1QixLQUFLeE0sSUFBTCxDQUFVd00sV0FGbkMsRUFHRTtBQUNBO0FBQ0E7QUFDQTtBQUNBLGdCQUFNUSxRQUFRLEdBQUc7QUFDZlIsWUFBQUEsV0FBVyxFQUFFLEtBQUt4TSxJQUFMLENBQVV3TTtBQURSLFdBQWpCLENBSkEsQ0FPQTtBQUNBOztBQUNBLGNBQUksS0FBS3hNLElBQUwsQ0FBVXFMLGNBQWQsRUFBOEI7QUFDNUIyQixZQUFBQSxRQUFRLENBQUMsZ0JBQUQsQ0FBUixHQUE2QjtBQUMzQjVELGNBQUFBLEdBQUcsRUFBRSxLQUFLcEosSUFBTCxDQUFVcUw7QUFEWSxhQUE3QjtBQUdELFdBSkQsTUFJTyxJQUNMc0IsT0FBTyxDQUFDaE0sUUFBUixJQUNBLEtBQUtYLElBQUwsQ0FBVVcsUUFEVixJQUVBZ00sT0FBTyxDQUFDaE0sUUFBUixJQUFvQixLQUFLWCxJQUFMLENBQVVXLFFBSHpCLEVBSUw7QUFDQTtBQUNBcU0sWUFBQUEsUUFBUSxDQUFDLFVBQUQsQ0FBUixHQUF1QjtBQUNyQjVELGNBQUFBLEdBQUcsRUFBRXVELE9BQU8sQ0FBQ2hNO0FBRFEsYUFBdkI7QUFHRCxXQVRNLE1BU0E7QUFDTDtBQUNBLG1CQUFPZ00sT0FBTyxDQUFDaE0sUUFBZjtBQUNEOztBQUNELGNBQUksS0FBS1gsSUFBTCxDQUFVaU4sYUFBZCxFQUE2QjtBQUMzQkQsWUFBQUEsUUFBUSxDQUFDLGVBQUQsQ0FBUixHQUE0QixLQUFLaE4sSUFBTCxDQUFVaU4sYUFBdEM7QUFDRDs7QUFDRCxlQUFLck4sTUFBTCxDQUFZc0QsUUFBWixDQUNHNkksT0FESCxDQUNXLGVBRFgsRUFDNEJpQixRQUQ1QixFQUVHaEMsS0FGSCxDQUVTQyxHQUFHLElBQUk7QUFDWixnQkFBSUEsR0FBRyxDQUFDaUMsSUFBSixJQUFZMU4sS0FBSyxDQUFDYSxLQUFOLENBQVlnRSxnQkFBNUIsRUFBOEM7QUFDNUM7QUFDQTtBQUNELGFBSlcsQ0FLWjs7O0FBQ0Esa0JBQU00RyxHQUFOO0FBQ0QsV0FUSDtBQVVELFNBM0NJLENBNENMOzs7QUFDQSxlQUFPMEIsT0FBTyxDQUFDaE0sUUFBZjtBQUNEO0FBQ0Y7QUFDRixHQXJNTyxFQXNNUFcsSUF0TU8sQ0FzTUY2TCxLQUFLLElBQUk7QUFDYixRQUFJQSxLQUFKLEVBQVc7QUFDVCxXQUFLcE4sS0FBTCxHQUFhO0FBQUVZLFFBQUFBLFFBQVEsRUFBRXdNO0FBQVosT0FBYjtBQUNBLGFBQU8sS0FBS25OLElBQUwsQ0FBVVcsUUFBakI7QUFDQSxhQUFPLEtBQUtYLElBQUwsQ0FBVWtGLFNBQWpCO0FBQ0QsS0FMWSxDQU1iOztBQUNELEdBN01PLENBQVY7QUE4TUEsU0FBT2dELE9BQVA7QUFDRCxDQTVSRCxDLENBOFJBO0FBQ0E7QUFDQTs7O0FBQ0F2SSxTQUFTLENBQUN1QixTQUFWLENBQW9CZSw2QkFBcEIsR0FBb0QsWUFBVztBQUM3RDtBQUNBLE1BQUksS0FBS3BCLFFBQUwsSUFBaUIsS0FBS0EsUUFBTCxDQUFjQSxRQUFuQyxFQUE2QztBQUMzQyxTQUFLakIsTUFBTCxDQUFZd04sZUFBWixDQUE0QkMsbUJBQTVCLENBQ0UsS0FBS3pOLE1BRFAsRUFFRSxLQUFLaUIsUUFBTCxDQUFjQSxRQUZoQjtBQUlEO0FBQ0YsQ0FSRDs7QUFVQWxCLFNBQVMsQ0FBQ3VCLFNBQVYsQ0FBb0JpQixvQkFBcEIsR0FBMkMsWUFBVztBQUNwRCxNQUFJLEtBQUt0QixRQUFULEVBQW1CO0FBQ2pCO0FBQ0Q7O0FBRUQsTUFBSSxLQUFLZixTQUFMLEtBQW1CLE9BQXZCLEVBQWdDO0FBQzlCLFNBQUtGLE1BQUwsQ0FBWTRJLGVBQVosQ0FBNEI4RSxJQUE1QixDQUFpQ0MsS0FBakM7QUFDRDs7QUFFRCxNQUNFLEtBQUt6TixTQUFMLEtBQW1CLE9BQW5CLElBQ0EsS0FBS0MsS0FETCxJQUVBLEtBQUtGLElBQUwsQ0FBVTJOLGlCQUFWLEVBSEYsRUFJRTtBQUNBLFVBQU0sSUFBSWhPLEtBQUssQ0FBQ2EsS0FBVixDQUNKYixLQUFLLENBQUNhLEtBQU4sQ0FBWW9OLGVBRFIsRUFFSCxzQkFBcUIsS0FBSzFOLEtBQUwsQ0FBV1ksUUFBUyxHQUZ0QyxDQUFOO0FBSUQ7O0FBRUQsTUFBSSxLQUFLYixTQUFMLEtBQW1CLFVBQW5CLElBQWlDLEtBQUtFLElBQUwsQ0FBVTBOLFFBQS9DLEVBQXlEO0FBQ3ZELFNBQUsxTixJQUFMLENBQVUyTixZQUFWLEdBQXlCLEtBQUszTixJQUFMLENBQVUwTixRQUFWLENBQW1CRSxJQUE1QztBQUNELEdBdEJtRCxDQXdCcEQ7QUFDQTs7O0FBQ0EsTUFBSSxLQUFLNU4sSUFBTCxDQUFVcUgsR0FBVixJQUFpQixLQUFLckgsSUFBTCxDQUFVcUgsR0FBVixDQUFjLGFBQWQsQ0FBckIsRUFBbUQ7QUFDakQsVUFBTSxJQUFJN0gsS0FBSyxDQUFDYSxLQUFWLENBQWdCYixLQUFLLENBQUNhLEtBQU4sQ0FBWXdOLFdBQTVCLEVBQXlDLGNBQXpDLENBQU47QUFDRDs7QUFFRCxNQUFJLEtBQUs5TixLQUFULEVBQWdCO0FBQ2Q7QUFDQTtBQUNBLFFBQ0UsS0FBS0QsU0FBTCxLQUFtQixPQUFuQixJQUNBLEtBQUtFLElBQUwsQ0FBVXFILEdBRFYsSUFFQSxLQUFLeEgsSUFBTCxDQUFVMkMsUUFBVixLQUF1QixJQUh6QixFQUlFO0FBQ0EsV0FBS3hDLElBQUwsQ0FBVXFILEdBQVYsQ0FBYyxLQUFLdEgsS0FBTCxDQUFXWSxRQUF6QixJQUFxQztBQUFFbU4sUUFBQUEsSUFBSSxFQUFFLElBQVI7QUFBY0MsUUFBQUEsS0FBSyxFQUFFO0FBQXJCLE9BQXJDO0FBQ0QsS0FUYSxDQVVkOzs7QUFDQSxRQUNFLEtBQUtqTyxTQUFMLEtBQW1CLE9BQW5CLElBQ0EsS0FBS0UsSUFBTCxDQUFVK0ksZ0JBRFYsSUFFQSxLQUFLbkosTUFBTCxDQUFZbUssY0FGWixJQUdBLEtBQUtuSyxNQUFMLENBQVltSyxjQUFaLENBQTJCaUUsY0FKN0IsRUFLRTtBQUNBLFdBQUtoTyxJQUFMLENBQVVpTyxvQkFBVixHQUFpQ3pPLEtBQUssQ0FBQ3VCLE9BQU4sQ0FBYyxJQUFJQyxJQUFKLEVBQWQsQ0FBakM7QUFDRCxLQWxCYSxDQW1CZDs7O0FBQ0EsV0FBTyxLQUFLaEIsSUFBTCxDQUFVa0YsU0FBakI7QUFFQSxRQUFJZ0osS0FBSyxHQUFHOU0sT0FBTyxDQUFDQyxPQUFSLEVBQVosQ0F0QmMsQ0F1QmQ7O0FBQ0EsUUFDRSxLQUFLdkIsU0FBTCxLQUFtQixPQUFuQixJQUNBLEtBQUtFLElBQUwsQ0FBVStJLGdCQURWLElBRUEsS0FBS25KLE1BQUwsQ0FBWW1LLGNBRlosSUFHQSxLQUFLbkssTUFBTCxDQUFZbUssY0FBWixDQUEyQlUsa0JBSjdCLEVBS0U7QUFDQXlELE1BQUFBLEtBQUssR0FBRyxLQUFLdE8sTUFBTCxDQUFZc0QsUUFBWixDQUNMK0QsSUFESyxDQUVKLE9BRkksRUFHSjtBQUFFdEcsUUFBQUEsUUFBUSxFQUFFLEtBQUtBLFFBQUw7QUFBWixPQUhJLEVBSUo7QUFBRWlGLFFBQUFBLElBQUksRUFBRSxDQUFDLG1CQUFELEVBQXNCLGtCQUF0QjtBQUFSLE9BSkksRUFNTHRFLElBTkssQ0FNQWdHLE9BQU8sSUFBSTtBQUNmLFlBQUlBLE9BQU8sQ0FBQ2xELE1BQVIsSUFBa0IsQ0FBdEIsRUFBeUI7QUFDdkIsZ0JBQU11RSxTQUFOO0FBQ0Q7O0FBQ0QsY0FBTWpHLElBQUksR0FBRzRFLE9BQU8sQ0FBQyxDQUFELENBQXBCO0FBQ0EsWUFBSW9ELFlBQVksR0FBRyxFQUFuQjs7QUFDQSxZQUFJaEksSUFBSSxDQUFDaUksaUJBQVQsRUFBNEI7QUFDMUJELFVBQUFBLFlBQVksR0FBR2pHLGdCQUFFbUcsSUFBRixDQUNibEksSUFBSSxDQUFDaUksaUJBRFEsRUFFYixLQUFLL0ssTUFBTCxDQUFZbUssY0FBWixDQUEyQlUsa0JBRmQsQ0FBZjtBQUlELFNBWGMsQ0FZZjs7O0FBQ0EsZUFDRUMsWUFBWSxDQUFDdEcsTUFBYixHQUNBK0osSUFBSSxDQUFDQyxHQUFMLENBQVMsQ0FBVCxFQUFZLEtBQUt4TyxNQUFMLENBQVltSyxjQUFaLENBQTJCVSxrQkFBM0IsR0FBZ0QsQ0FBNUQsQ0FGRixFQUdFO0FBQ0FDLFVBQUFBLFlBQVksQ0FBQzJELEtBQWI7QUFDRDs7QUFDRDNELFFBQUFBLFlBQVksQ0FBQzVGLElBQWIsQ0FBa0JwQyxJQUFJLENBQUMrQyxRQUF2QjtBQUNBLGFBQUt6RixJQUFMLENBQVUySyxpQkFBVixHQUE4QkQsWUFBOUI7QUFDRCxPQTNCSyxDQUFSO0FBNEJEOztBQUVELFdBQU93RCxLQUFLLENBQUM1TSxJQUFOLENBQVcsTUFBTTtBQUN0QjtBQUNBLGFBQU8sS0FBSzFCLE1BQUwsQ0FBWXNELFFBQVosQ0FDSmUsTUFESSxDQUNHLEtBQUtuRSxTQURSLEVBQ21CLEtBQUtDLEtBRHhCLEVBQytCLEtBQUtDLElBRHBDLEVBQzBDLEtBQUtRLFVBRC9DLEVBRUpjLElBRkksQ0FFQ1QsUUFBUSxJQUFJO0FBQ2hCQSxRQUFBQSxRQUFRLENBQUNDLFNBQVQsR0FBcUIsS0FBS0EsU0FBMUI7O0FBQ0EsYUFBS3dOLHVCQUFMLENBQTZCek4sUUFBN0IsRUFBdUMsS0FBS2IsSUFBNUM7O0FBQ0EsYUFBS2EsUUFBTCxHQUFnQjtBQUFFQSxVQUFBQTtBQUFGLFNBQWhCO0FBQ0QsT0FOSSxDQUFQO0FBT0QsS0FUTSxDQUFQO0FBVUQsR0F0RUQsTUFzRU87QUFDTDtBQUNBLFFBQUksS0FBS2YsU0FBTCxLQUFtQixPQUF2QixFQUFnQztBQUM5QixVQUFJdUgsR0FBRyxHQUFHLEtBQUtySCxJQUFMLENBQVVxSCxHQUFwQixDQUQ4QixDQUU5Qjs7QUFDQSxVQUFJLENBQUNBLEdBQUwsRUFBVTtBQUNSQSxRQUFBQSxHQUFHLEdBQUcsRUFBTjtBQUNBQSxRQUFBQSxHQUFHLENBQUMsR0FBRCxDQUFILEdBQVc7QUFBRXlHLFVBQUFBLElBQUksRUFBRSxJQUFSO0FBQWNDLFVBQUFBLEtBQUssRUFBRTtBQUFyQixTQUFYO0FBQ0QsT0FONkIsQ0FPOUI7OztBQUNBMUcsTUFBQUEsR0FBRyxDQUFDLEtBQUtySCxJQUFMLENBQVVXLFFBQVgsQ0FBSCxHQUEwQjtBQUFFbU4sUUFBQUEsSUFBSSxFQUFFLElBQVI7QUFBY0MsUUFBQUEsS0FBSyxFQUFFO0FBQXJCLE9BQTFCO0FBQ0EsV0FBSy9OLElBQUwsQ0FBVXFILEdBQVYsR0FBZ0JBLEdBQWhCLENBVDhCLENBVTlCOztBQUNBLFVBQ0UsS0FBS3pILE1BQUwsQ0FBWW1LLGNBQVosSUFDQSxLQUFLbkssTUFBTCxDQUFZbUssY0FBWixDQUEyQmlFLGNBRjdCLEVBR0U7QUFDQSxhQUFLaE8sSUFBTCxDQUFVaU8sb0JBQVYsR0FBaUN6TyxLQUFLLENBQUN1QixPQUFOLENBQWMsSUFBSUMsSUFBSixFQUFkLENBQWpDO0FBQ0Q7QUFDRixLQW5CSSxDQXFCTDs7O0FBQ0EsV0FBTyxLQUFLcEIsTUFBTCxDQUFZc0QsUUFBWixDQUNKZ0IsTUFESSxDQUNHLEtBQUtwRSxTQURSLEVBQ21CLEtBQUtFLElBRHhCLEVBQzhCLEtBQUtRLFVBRG5DLEVBRUp3SyxLQUZJLENBRUU3QyxLQUFLLElBQUk7QUFDZCxVQUNFLEtBQUtySSxTQUFMLEtBQW1CLE9BQW5CLElBQ0FxSSxLQUFLLENBQUMrRSxJQUFOLEtBQWUxTixLQUFLLENBQUNhLEtBQU4sQ0FBWWtPLGVBRjdCLEVBR0U7QUFDQSxjQUFNcEcsS0FBTjtBQUNELE9BTmEsQ0FRZDs7O0FBQ0EsVUFDRUEsS0FBSyxJQUNMQSxLQUFLLENBQUNxRyxRQUROLElBRUFyRyxLQUFLLENBQUNxRyxRQUFOLENBQWVDLGdCQUFmLEtBQW9DLFVBSHRDLEVBSUU7QUFDQSxjQUFNLElBQUlqUCxLQUFLLENBQUNhLEtBQVYsQ0FDSmIsS0FBSyxDQUFDYSxLQUFOLENBQVlpSixjQURSLEVBRUosMkNBRkksQ0FBTjtBQUlEOztBQUVELFVBQ0VuQixLQUFLLElBQ0xBLEtBQUssQ0FBQ3FHLFFBRE4sSUFFQXJHLEtBQUssQ0FBQ3FHLFFBQU4sQ0FBZUMsZ0JBQWYsS0FBb0MsT0FIdEMsRUFJRTtBQUNBLGNBQU0sSUFBSWpQLEtBQUssQ0FBQ2EsS0FBVixDQUNKYixLQUFLLENBQUNhLEtBQU4sQ0FBWXVKLFdBRFIsRUFFSixnREFGSSxDQUFOO0FBSUQsT0E3QmEsQ0ErQmQ7QUFDQTtBQUNBO0FBQ0E7OztBQUNBLGFBQU8sS0FBS2hLLE1BQUwsQ0FBWXNELFFBQVosQ0FDSitELElBREksQ0FFSCxLQUFLbkgsU0FGRixFQUdIO0FBQ0V3RixRQUFBQSxRQUFRLEVBQUUsS0FBS3RGLElBQUwsQ0FBVXNGLFFBRHRCO0FBRUUzRSxRQUFBQSxRQUFRLEVBQUU7QUFBRXlJLFVBQUFBLEdBQUcsRUFBRSxLQUFLekksUUFBTDtBQUFQO0FBRlosT0FIRyxFQU9IO0FBQUUwSSxRQUFBQSxLQUFLLEVBQUU7QUFBVCxPQVBHLEVBU0ovSCxJQVRJLENBU0NnRyxPQUFPLElBQUk7QUFDZixZQUFJQSxPQUFPLENBQUNsRCxNQUFSLEdBQWlCLENBQXJCLEVBQXdCO0FBQ3RCLGdCQUFNLElBQUk1RSxLQUFLLENBQUNhLEtBQVYsQ0FDSmIsS0FBSyxDQUFDYSxLQUFOLENBQVlpSixjQURSLEVBRUosMkNBRkksQ0FBTjtBQUlEOztBQUNELGVBQU8sS0FBSzFKLE1BQUwsQ0FBWXNELFFBQVosQ0FBcUIrRCxJQUFyQixDQUNMLEtBQUtuSCxTQURBLEVBRUw7QUFBRXlKLFVBQUFBLEtBQUssRUFBRSxLQUFLdkosSUFBTCxDQUFVdUosS0FBbkI7QUFBMEI1SSxVQUFBQSxRQUFRLEVBQUU7QUFBRXlJLFlBQUFBLEdBQUcsRUFBRSxLQUFLekksUUFBTDtBQUFQO0FBQXBDLFNBRkssRUFHTDtBQUFFMEksVUFBQUEsS0FBSyxFQUFFO0FBQVQsU0FISyxDQUFQO0FBS0QsT0FyQkksRUFzQkovSCxJQXRCSSxDQXNCQ2dHLE9BQU8sSUFBSTtBQUNmLFlBQUlBLE9BQU8sQ0FBQ2xELE1BQVIsR0FBaUIsQ0FBckIsRUFBd0I7QUFDdEIsZ0JBQU0sSUFBSTVFLEtBQUssQ0FBQ2EsS0FBVixDQUNKYixLQUFLLENBQUNhLEtBQU4sQ0FBWXVKLFdBRFIsRUFFSixnREFGSSxDQUFOO0FBSUQ7O0FBQ0QsY0FBTSxJQUFJcEssS0FBSyxDQUFDYSxLQUFWLENBQ0piLEtBQUssQ0FBQ2EsS0FBTixDQUFZa08sZUFEUixFQUVKLCtEQUZJLENBQU47QUFJRCxPQWpDSSxDQUFQO0FBa0NELEtBdkVJLEVBd0VKak4sSUF4RUksQ0F3RUNULFFBQVEsSUFBSTtBQUNoQkEsTUFBQUEsUUFBUSxDQUFDRixRQUFULEdBQW9CLEtBQUtYLElBQUwsQ0FBVVcsUUFBOUI7QUFDQUUsTUFBQUEsUUFBUSxDQUFDcUUsU0FBVCxHQUFxQixLQUFLbEYsSUFBTCxDQUFVa0YsU0FBL0I7O0FBRUEsVUFBSSxLQUFLaUUsMEJBQVQsRUFBcUM7QUFDbkN0SSxRQUFBQSxRQUFRLENBQUN5RSxRQUFULEdBQW9CLEtBQUt0RixJQUFMLENBQVVzRixRQUE5QjtBQUNEOztBQUNELFdBQUtnSix1QkFBTCxDQUE2QnpOLFFBQTdCLEVBQXVDLEtBQUtiLElBQTVDOztBQUNBLFdBQUthLFFBQUwsR0FBZ0I7QUFDZDBMLFFBQUFBLE1BQU0sRUFBRSxHQURNO0FBRWQxTCxRQUFBQSxRQUZjO0FBR2RvSCxRQUFBQSxRQUFRLEVBQUUsS0FBS0EsUUFBTDtBQUhJLE9BQWhCO0FBS0QsS0FyRkksQ0FBUDtBQXNGRDtBQUNGLENBak5ELEMsQ0FtTkE7OztBQUNBdEksU0FBUyxDQUFDdUIsU0FBVixDQUFvQm9CLG1CQUFwQixHQUEwQyxZQUFXO0FBQ25ELE1BQUksQ0FBQyxLQUFLekIsUUFBTixJQUFrQixDQUFDLEtBQUtBLFFBQUwsQ0FBY0EsUUFBckMsRUFBK0M7QUFDN0M7QUFDRCxHQUhrRCxDQUtuRDs7O0FBQ0EsUUFBTTZOLGdCQUFnQixHQUFHalAsUUFBUSxDQUFDOEQsYUFBVCxDQUN2QixLQUFLekQsU0FEa0IsRUFFdkJMLFFBQVEsQ0FBQytELEtBQVQsQ0FBZW1MLFNBRlEsRUFHdkIsS0FBSy9PLE1BQUwsQ0FBWThELGFBSFcsQ0FBekI7QUFLQSxRQUFNa0wsWUFBWSxHQUFHLEtBQUtoUCxNQUFMLENBQVlpUCxtQkFBWixDQUFnQ0QsWUFBaEMsQ0FDbkIsS0FBSzlPLFNBRGMsQ0FBckI7O0FBR0EsTUFBSSxDQUFDNE8sZ0JBQUQsSUFBcUIsQ0FBQ0UsWUFBMUIsRUFBd0M7QUFDdEMsV0FBT3hOLE9BQU8sQ0FBQ0MsT0FBUixFQUFQO0FBQ0Q7O0FBRUQsTUFBSXNDLFNBQVMsR0FBRztBQUFFN0QsSUFBQUEsU0FBUyxFQUFFLEtBQUtBO0FBQWxCLEdBQWhCOztBQUNBLE1BQUksS0FBS0MsS0FBTCxJQUFjLEtBQUtBLEtBQUwsQ0FBV1ksUUFBN0IsRUFBdUM7QUFDckNnRCxJQUFBQSxTQUFTLENBQUNoRCxRQUFWLEdBQXFCLEtBQUtaLEtBQUwsQ0FBV1ksUUFBaEM7QUFDRCxHQXJCa0QsQ0F1Qm5EOzs7QUFDQSxNQUFJaUQsY0FBSjs7QUFDQSxNQUFJLEtBQUs3RCxLQUFMLElBQWMsS0FBS0EsS0FBTCxDQUFXWSxRQUE3QixFQUF1QztBQUNyQ2lELElBQUFBLGNBQWMsR0FBR25FLFFBQVEsQ0FBQ3NFLE9BQVQsQ0FBaUJKLFNBQWpCLEVBQTRCLEtBQUsxRCxZQUFqQyxDQUFqQjtBQUNELEdBM0JrRCxDQTZCbkQ7QUFDQTs7O0FBQ0EsUUFBTTRELGFBQWEsR0FBRyxLQUFLQyxrQkFBTCxDQUF3QkgsU0FBeEIsQ0FBdEI7O0FBQ0FFLEVBQUFBLGFBQWEsQ0FBQ2lMLG1CQUFkLENBQ0UsS0FBS2pPLFFBQUwsQ0FBY0EsUUFEaEIsRUFFRSxLQUFLQSxRQUFMLENBQWMwTCxNQUFkLElBQXdCLEdBRjFCOztBQUtBLE9BQUszTSxNQUFMLENBQVlzRCxRQUFaLENBQXFCQyxVQUFyQixHQUFrQzdCLElBQWxDLENBQXVDOEIsZ0JBQWdCLElBQUk7QUFDekQ7QUFDQSxVQUFNMkwsS0FBSyxHQUFHM0wsZ0JBQWdCLENBQUM0TCx3QkFBakIsQ0FDWm5MLGFBQWEsQ0FBQy9ELFNBREYsQ0FBZDtBQUdBLFNBQUtGLE1BQUwsQ0FBWWlQLG1CQUFaLENBQWdDSSxXQUFoQyxDQUNFcEwsYUFBYSxDQUFDL0QsU0FEaEIsRUFFRStELGFBRkYsRUFHRUQsY0FIRixFQUlFbUwsS0FKRjtBQU1ELEdBWEQsRUFyQ21ELENBa0RuRDs7QUFDQSxTQUFPdFAsUUFBUSxDQUNaNkUsZUFESSxDQUVIN0UsUUFBUSxDQUFDK0QsS0FBVCxDQUFlbUwsU0FGWixFQUdILEtBQUs5TyxJQUhGLEVBSUhnRSxhQUpHLEVBS0hELGNBTEcsRUFNSCxLQUFLaEUsTUFORixFQU9ILEtBQUthLE9BUEYsRUFTSnVLLEtBVEksQ0FTRSxVQUFTQyxHQUFULEVBQWM7QUFDbkJpRSxvQkFBT0MsSUFBUCxDQUFZLDJCQUFaLEVBQXlDbEUsR0FBekM7QUFDRCxHQVhJLENBQVA7QUFZRCxDQS9ERCxDLENBaUVBOzs7QUFDQXRMLFNBQVMsQ0FBQ3VCLFNBQVYsQ0FBb0IrRyxRQUFwQixHQUErQixZQUFXO0FBQ3hDLE1BQUltSCxNQUFNLEdBQ1IsS0FBS3RQLFNBQUwsS0FBbUIsT0FBbkIsR0FBNkIsU0FBN0IsR0FBeUMsY0FBYyxLQUFLQSxTQUFuQixHQUErQixHQUQxRTtBQUVBLFNBQU8sS0FBS0YsTUFBTCxDQUFZeVAsS0FBWixHQUFvQkQsTUFBcEIsR0FBNkIsS0FBS3BQLElBQUwsQ0FBVVcsUUFBOUM7QUFDRCxDQUpELEMsQ0FNQTtBQUNBOzs7QUFDQWhCLFNBQVMsQ0FBQ3VCLFNBQVYsQ0FBb0JQLFFBQXBCLEdBQStCLFlBQVc7QUFDeEMsU0FBTyxLQUFLWCxJQUFMLENBQVVXLFFBQVYsSUFBc0IsS0FBS1osS0FBTCxDQUFXWSxRQUF4QztBQUNELENBRkQsQyxDQUlBOzs7QUFDQWhCLFNBQVMsQ0FBQ3VCLFNBQVYsQ0FBb0JvTyxhQUFwQixHQUFvQyxZQUFXO0FBQzdDLFFBQU10UCxJQUFJLEdBQUcyRixNQUFNLENBQUNDLElBQVAsQ0FBWSxLQUFLNUYsSUFBakIsRUFBdUIwRSxNQUF2QixDQUE4QixDQUFDMUUsSUFBRCxFQUFPNEUsR0FBUCxLQUFlO0FBQ3hEO0FBQ0EsUUFBSSxDQUFDLDBCQUEwQjJLLElBQTFCLENBQStCM0ssR0FBL0IsQ0FBTCxFQUEwQztBQUN4QyxhQUFPNUUsSUFBSSxDQUFDNEUsR0FBRCxDQUFYO0FBQ0Q7O0FBQ0QsV0FBTzVFLElBQVA7QUFDRCxHQU5ZLEVBTVZaLFFBQVEsQ0FBQyxLQUFLWSxJQUFOLENBTkUsQ0FBYjtBQU9BLFNBQU9SLEtBQUssQ0FBQ2dRLE9BQU4sQ0FBYzdHLFNBQWQsRUFBeUIzSSxJQUF6QixDQUFQO0FBQ0QsQ0FURCxDLENBV0E7OztBQUNBTCxTQUFTLENBQUN1QixTQUFWLENBQW9CNEMsa0JBQXBCLEdBQXlDLFVBQVNILFNBQVQsRUFBb0I7QUFDM0QsUUFBTUUsYUFBYSxHQUFHcEUsUUFBUSxDQUFDc0UsT0FBVCxDQUFpQkosU0FBakIsRUFBNEIsS0FBSzFELFlBQWpDLENBQXRCO0FBQ0EwRixFQUFBQSxNQUFNLENBQUNDLElBQVAsQ0FBWSxLQUFLNUYsSUFBakIsRUFBdUIwRSxNQUF2QixDQUE4QixVQUFTMUUsSUFBVCxFQUFlNEUsR0FBZixFQUFvQjtBQUNoRCxRQUFJQSxHQUFHLENBQUMzQixPQUFKLENBQVksR0FBWixJQUFtQixDQUF2QixFQUEwQjtBQUN4QjtBQUNBLFlBQU13TSxXQUFXLEdBQUc3SyxHQUFHLENBQUM4SyxLQUFKLENBQVUsR0FBVixDQUFwQjtBQUNBLFlBQU1DLFVBQVUsR0FBR0YsV0FBVyxDQUFDLENBQUQsQ0FBOUI7QUFDQSxVQUFJRyxTQUFTLEdBQUcvTCxhQUFhLENBQUNnTSxHQUFkLENBQWtCRixVQUFsQixDQUFoQjs7QUFDQSxVQUFJLE9BQU9DLFNBQVAsS0FBcUIsUUFBekIsRUFBbUM7QUFDakNBLFFBQUFBLFNBQVMsR0FBRyxFQUFaO0FBQ0Q7O0FBQ0RBLE1BQUFBLFNBQVMsQ0FBQ0gsV0FBVyxDQUFDLENBQUQsQ0FBWixDQUFULEdBQTRCelAsSUFBSSxDQUFDNEUsR0FBRCxDQUFoQztBQUNBZixNQUFBQSxhQUFhLENBQUNpTSxHQUFkLENBQWtCSCxVQUFsQixFQUE4QkMsU0FBOUI7QUFDQSxhQUFPNVAsSUFBSSxDQUFDNEUsR0FBRCxDQUFYO0FBQ0Q7O0FBQ0QsV0FBTzVFLElBQVA7QUFDRCxHQWRELEVBY0daLFFBQVEsQ0FBQyxLQUFLWSxJQUFOLENBZFg7QUFnQkE2RCxFQUFBQSxhQUFhLENBQUNpTSxHQUFkLENBQWtCLEtBQUtSLGFBQUwsRUFBbEI7QUFDQSxTQUFPekwsYUFBUDtBQUNELENBcEJEOztBQXNCQWxFLFNBQVMsQ0FBQ3VCLFNBQVYsQ0FBb0JxQixpQkFBcEIsR0FBd0MsWUFBVztBQUNqRCxNQUFJLEtBQUsxQixRQUFMLElBQWlCLEtBQUtBLFFBQUwsQ0FBY0EsUUFBL0IsSUFBMkMsS0FBS2YsU0FBTCxLQUFtQixPQUFsRSxFQUEyRTtBQUN6RSxVQUFNNEMsSUFBSSxHQUFHLEtBQUs3QixRQUFMLENBQWNBLFFBQTNCOztBQUNBLFFBQUk2QixJQUFJLENBQUMyQyxRQUFULEVBQW1CO0FBQ2pCTSxNQUFBQSxNQUFNLENBQUNDLElBQVAsQ0FBWWxELElBQUksQ0FBQzJDLFFBQWpCLEVBQTJCdUMsT0FBM0IsQ0FBbUM1QixRQUFRLElBQUk7QUFDN0MsWUFBSXRELElBQUksQ0FBQzJDLFFBQUwsQ0FBY1csUUFBZCxNQUE0QixJQUFoQyxFQUFzQztBQUNwQyxpQkFBT3RELElBQUksQ0FBQzJDLFFBQUwsQ0FBY1csUUFBZCxDQUFQO0FBQ0Q7QUFDRixPQUpEOztBQUtBLFVBQUlMLE1BQU0sQ0FBQ0MsSUFBUCxDQUFZbEQsSUFBSSxDQUFDMkMsUUFBakIsRUFBMkJqQixNQUEzQixJQUFxQyxDQUF6QyxFQUE0QztBQUMxQyxlQUFPMUIsSUFBSSxDQUFDMkMsUUFBWjtBQUNEO0FBQ0Y7QUFDRjtBQUNGLENBZEQ7O0FBZ0JBMUYsU0FBUyxDQUFDdUIsU0FBVixDQUFvQm9OLHVCQUFwQixHQUE4QyxVQUFTek4sUUFBVCxFQUFtQmIsSUFBbkIsRUFBeUI7QUFDckUsTUFBSXlFLGdCQUFFYyxPQUFGLENBQVUsS0FBS2hGLE9BQUwsQ0FBYWlFLHNCQUF2QixDQUFKLEVBQW9EO0FBQ2xELFdBQU8zRCxRQUFQO0FBQ0Q7O0FBQ0QsUUFBTWtQLG9CQUFvQixHQUFHclEsU0FBUyxDQUFDc1EscUJBQVYsQ0FBZ0MsS0FBSzlQLFNBQXJDLENBQTdCO0FBQ0EsT0FBS0ssT0FBTCxDQUFhaUUsc0JBQWIsQ0FBb0NvRCxPQUFwQyxDQUE0Q3FJLFNBQVMsSUFBSTtBQUN2RCxVQUFNQyxTQUFTLEdBQUdsUSxJQUFJLENBQUNpUSxTQUFELENBQXRCOztBQUVBLFFBQUksQ0FBQ3BQLFFBQVEsQ0FBQ3NQLGNBQVQsQ0FBd0JGLFNBQXhCLENBQUwsRUFBeUM7QUFDdkNwUCxNQUFBQSxRQUFRLENBQUNvUCxTQUFELENBQVIsR0FBc0JDLFNBQXRCO0FBQ0QsS0FMc0QsQ0FPdkQ7OztBQUNBLFFBQUlyUCxRQUFRLENBQUNvUCxTQUFELENBQVIsSUFBdUJwUCxRQUFRLENBQUNvUCxTQUFELENBQVIsQ0FBb0J6RyxJQUEvQyxFQUFxRDtBQUNuRCxhQUFPM0ksUUFBUSxDQUFDb1AsU0FBRCxDQUFmOztBQUNBLFVBQUlGLG9CQUFvQixJQUFJRyxTQUFTLENBQUMxRyxJQUFWLElBQWtCLFFBQTlDLEVBQXdEO0FBQ3REM0ksUUFBQUEsUUFBUSxDQUFDb1AsU0FBRCxDQUFSLEdBQXNCQyxTQUF0QjtBQUNEO0FBQ0Y7QUFDRixHQWREO0FBZUEsU0FBT3JQLFFBQVA7QUFDRCxDQXJCRDs7ZUF1QmVsQixTOztBQUNmeVEsTUFBTSxDQUFDQyxPQUFQLEdBQWlCMVEsU0FBakIiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBBIFJlc3RXcml0ZSBlbmNhcHN1bGF0ZXMgZXZlcnl0aGluZyB3ZSBuZWVkIHRvIHJ1biBhbiBvcGVyYXRpb25cbi8vIHRoYXQgd3JpdGVzIHRvIHRoZSBkYXRhYmFzZS5cbi8vIFRoaXMgY291bGQgYmUgZWl0aGVyIGEgXCJjcmVhdGVcIiBvciBhbiBcInVwZGF0ZVwiLlxuXG52YXIgU2NoZW1hQ29udHJvbGxlciA9IHJlcXVpcmUoJy4vQ29udHJvbGxlcnMvU2NoZW1hQ29udHJvbGxlcicpO1xudmFyIGRlZXBjb3B5ID0gcmVxdWlyZSgnZGVlcGNvcHknKTtcblxuY29uc3QgQXV0aCA9IHJlcXVpcmUoJy4vQXV0aCcpO1xudmFyIGNyeXB0b1V0aWxzID0gcmVxdWlyZSgnLi9jcnlwdG9VdGlscycpO1xudmFyIHBhc3N3b3JkQ3J5cHRvID0gcmVxdWlyZSgnLi9wYXNzd29yZCcpO1xudmFyIFBhcnNlID0gcmVxdWlyZSgncGFyc2Uvbm9kZScpO1xudmFyIHRyaWdnZXJzID0gcmVxdWlyZSgnLi90cmlnZ2VycycpO1xudmFyIENsaWVudFNESyA9IHJlcXVpcmUoJy4vQ2xpZW50U0RLJyk7XG5pbXBvcnQgUmVzdFF1ZXJ5IGZyb20gJy4vUmVzdFF1ZXJ5JztcbmltcG9ydCBfIGZyb20gJ2xvZGFzaCc7XG5pbXBvcnQgbG9nZ2VyIGZyb20gJy4vbG9nZ2VyJztcblxuLy8gcXVlcnkgYW5kIGRhdGEgYXJlIGJvdGggcHJvdmlkZWQgaW4gUkVTVCBBUEkgZm9ybWF0LiBTbyBkYXRhXG4vLyB0eXBlcyBhcmUgZW5jb2RlZCBieSBwbGFpbiBvbGQgb2JqZWN0cy5cbi8vIElmIHF1ZXJ5IGlzIG51bGwsIHRoaXMgaXMgYSBcImNyZWF0ZVwiIGFuZCB0aGUgZGF0YSBpbiBkYXRhIHNob3VsZCBiZVxuLy8gY3JlYXRlZC5cbi8vIE90aGVyd2lzZSB0aGlzIGlzIGFuIFwidXBkYXRlXCIgLSB0aGUgb2JqZWN0IG1hdGNoaW5nIHRoZSBxdWVyeVxuLy8gc2hvdWxkIGdldCB1cGRhdGVkIHdpdGggZGF0YS5cbi8vIFJlc3RXcml0ZSB3aWxsIGhhbmRsZSBvYmplY3RJZCwgY3JlYXRlZEF0LCBhbmQgdXBkYXRlZEF0IGZvclxuLy8gZXZlcnl0aGluZy4gSXQgYWxzbyBrbm93cyB0byB1c2UgdHJpZ2dlcnMgYW5kIHNwZWNpYWwgbW9kaWZpY2F0aW9uc1xuLy8gZm9yIHRoZSBfVXNlciBjbGFzcy5cbmZ1bmN0aW9uIFJlc3RXcml0ZShcbiAgY29uZmlnLFxuICBhdXRoLFxuICBjbGFzc05hbWUsXG4gIHF1ZXJ5LFxuICBkYXRhLFxuICBvcmlnaW5hbERhdGEsXG4gIGNsaWVudFNESyxcbiAgb3B0aW9uc1xuKSB7XG4gIGlmIChhdXRoLmlzUmVhZE9ubHkpIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICBQYXJzZS5FcnJvci5PUEVSQVRJT05fRk9SQklEREVOLFxuICAgICAgJ0Nhbm5vdCBwZXJmb3JtIGEgd3JpdGUgb3BlcmF0aW9uIHdoZW4gdXNpbmcgcmVhZE9ubHlNYXN0ZXJLZXknXG4gICAgKTtcbiAgfVxuICB0aGlzLmNvbmZpZyA9IGNvbmZpZztcbiAgdGhpcy5hdXRoID0gYXV0aDtcbiAgdGhpcy5jbGFzc05hbWUgPSBjbGFzc05hbWU7XG4gIHRoaXMuY2xpZW50U0RLID0gY2xpZW50U0RLO1xuICB0aGlzLnN0b3JhZ2UgPSB7fTtcbiAgdGhpcy5ydW5PcHRpb25zID0ge307XG4gIHRoaXMuY29udGV4dCA9IHt9O1xuXG4gIGNvbnN0IGFsbG93T2JqZWN0SWQgPSBvcHRpb25zICYmIG9wdGlvbnMuYWxsb3dPYmplY3RJZCA9PT0gdHJ1ZTtcbiAgaWYgKCFxdWVyeSAmJiBkYXRhLm9iamVjdElkICYmICFhbGxvd09iamVjdElkKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSxcbiAgICAgICdvYmplY3RJZCBpcyBhbiBpbnZhbGlkIGZpZWxkIG5hbWUuJ1xuICAgICk7XG4gIH1cblxuICAvLyBXaGVuIHRoZSBvcGVyYXRpb24gaXMgY29tcGxldGUsIHRoaXMucmVzcG9uc2UgbWF5IGhhdmUgc2V2ZXJhbFxuICAvLyBmaWVsZHMuXG4gIC8vIHJlc3BvbnNlOiB0aGUgYWN0dWFsIGRhdGEgdG8gYmUgcmV0dXJuZWRcbiAgLy8gc3RhdHVzOiB0aGUgaHR0cCBzdGF0dXMgY29kZS4gaWYgbm90IHByZXNlbnQsIHRyZWF0ZWQgbGlrZSBhIDIwMFxuICAvLyBsb2NhdGlvbjogdGhlIGxvY2F0aW9uIGhlYWRlci4gaWYgbm90IHByZXNlbnQsIG5vIGxvY2F0aW9uIGhlYWRlclxuICB0aGlzLnJlc3BvbnNlID0gbnVsbDtcblxuICAvLyBQcm9jZXNzaW5nIHRoaXMgb3BlcmF0aW9uIG1heSBtdXRhdGUgb3VyIGRhdGEsIHNvIHdlIG9wZXJhdGUgb24gYVxuICAvLyBjb3B5XG4gIHRoaXMucXVlcnkgPSBkZWVwY29weShxdWVyeSk7XG4gIHRoaXMuZGF0YSA9IGRlZXBjb3B5KGRhdGEpO1xuICAvLyBXZSBuZXZlciBjaGFuZ2Ugb3JpZ2luYWxEYXRhLCBzbyB3ZSBkbyBub3QgbmVlZCBhIGRlZXAgY29weVxuICB0aGlzLm9yaWdpbmFsRGF0YSA9IG9yaWdpbmFsRGF0YTtcblxuICAvLyBUaGUgdGltZXN0YW1wIHdlJ2xsIHVzZSBmb3IgdGhpcyB3aG9sZSBvcGVyYXRpb25cbiAgdGhpcy51cGRhdGVkQXQgPSBQYXJzZS5fZW5jb2RlKG5ldyBEYXRlKCkpLmlzbztcbn1cblxuLy8gQSBjb252ZW5pZW50IG1ldGhvZCB0byBwZXJmb3JtIGFsbCB0aGUgc3RlcHMgb2YgcHJvY2Vzc2luZyB0aGVcbi8vIHdyaXRlLCBpbiBvcmRlci5cbi8vIFJldHVybnMgYSBwcm9taXNlIGZvciBhIHtyZXNwb25zZSwgc3RhdHVzLCBsb2NhdGlvbn0gb2JqZWN0LlxuLy8gc3RhdHVzIGFuZCBsb2NhdGlvbiBhcmUgb3B0aW9uYWwuXG5SZXN0V3JpdGUucHJvdG90eXBlLmV4ZWN1dGUgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuZ2V0VXNlckFuZFJvbGVBQ0woKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLnZhbGlkYXRlQ2xpZW50Q2xhc3NDcmVhdGlvbigpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlSW5zdGFsbGF0aW9uKCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5oYW5kbGVTZXNzaW9uKCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy52YWxpZGF0ZUF1dGhEYXRhKCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5ydW5CZWZvcmVTYXZlVHJpZ2dlcigpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuZGVsZXRlRW1haWxSZXNldFRva2VuSWZOZWVkZWQoKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLnZhbGlkYXRlU2NoZW1hKCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5zZXRSZXF1aXJlZEZpZWxkc0lmTmVlZGVkKCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy50cmFuc2Zvcm1Vc2VyKCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5leHBhbmRGaWxlc0ZvckV4aXN0aW5nT2JqZWN0cygpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuZGVzdHJveUR1cGxpY2F0ZWRTZXNzaW9ucygpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMucnVuRGF0YWJhc2VPcGVyYXRpb24oKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVNlc3Npb25Ub2tlbklmTmVlZGVkKCk7XG4gICAgfSlcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5oYW5kbGVGb2xsb3d1cCgpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMucnVuQWZ0ZXJTYXZlVHJpZ2dlcigpO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuY2xlYW5Vc2VyQXV0aERhdGEoKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLnJlc3BvbnNlO1xuICAgIH0pO1xufTtcblxuLy8gVXNlcyB0aGUgQXV0aCBvYmplY3QgdG8gZ2V0IHRoZSBsaXN0IG9mIHJvbGVzLCBhZGRzIHRoZSB1c2VyIGlkXG5SZXN0V3JpdGUucHJvdG90eXBlLmdldFVzZXJBbmRSb2xlQUNMID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLmF1dGguaXNNYXN0ZXIpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICB0aGlzLnJ1bk9wdGlvbnMuYWNsID0gWycqJ107XG5cbiAgaWYgKHRoaXMuYXV0aC51c2VyKSB7XG4gICAgcmV0dXJuIHRoaXMuYXV0aC5nZXRVc2VyUm9sZXMoKS50aGVuKHJvbGVzID0+IHtcbiAgICAgIHRoaXMucnVuT3B0aW9ucy5hY2wgPSB0aGlzLnJ1bk9wdGlvbnMuYWNsLmNvbmNhdChyb2xlcywgW1xuICAgICAgICB0aGlzLmF1dGgudXNlci5pZCxcbiAgICAgIF0pO1xuICAgICAgcmV0dXJuO1xuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxufTtcblxuLy8gVmFsaWRhdGVzIHRoaXMgb3BlcmF0aW9uIGFnYWluc3QgdGhlIGFsbG93Q2xpZW50Q2xhc3NDcmVhdGlvbiBjb25maWcuXG5SZXN0V3JpdGUucHJvdG90eXBlLnZhbGlkYXRlQ2xpZW50Q2xhc3NDcmVhdGlvbiA9IGZ1bmN0aW9uKCkge1xuICBpZiAoXG4gICAgdGhpcy5jb25maWcuYWxsb3dDbGllbnRDbGFzc0NyZWF0aW9uID09PSBmYWxzZSAmJlxuICAgICF0aGlzLmF1dGguaXNNYXN0ZXIgJiZcbiAgICBTY2hlbWFDb250cm9sbGVyLnN5c3RlbUNsYXNzZXMuaW5kZXhPZih0aGlzLmNsYXNzTmFtZSkgPT09IC0xXG4gICkge1xuICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZVxuICAgICAgLmxvYWRTY2hlbWEoKVxuICAgICAgLnRoZW4oc2NoZW1hQ29udHJvbGxlciA9PiBzY2hlbWFDb250cm9sbGVyLmhhc0NsYXNzKHRoaXMuY2xhc3NOYW1lKSlcbiAgICAgIC50aGVuKGhhc0NsYXNzID0+IHtcbiAgICAgICAgaWYgKGhhc0NsYXNzICE9PSB0cnVlKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTixcbiAgICAgICAgICAgICdUaGlzIHVzZXIgaXMgbm90IGFsbG93ZWQgdG8gYWNjZXNzICcgK1xuICAgICAgICAgICAgICAnbm9uLWV4aXN0ZW50IGNsYXNzOiAnICtcbiAgICAgICAgICAgICAgdGhpcy5jbGFzc05hbWVcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cbn07XG5cbi8vIFZhbGlkYXRlcyB0aGlzIG9wZXJhdGlvbiBhZ2FpbnN0IHRoZSBzY2hlbWEuXG5SZXN0V3JpdGUucHJvdG90eXBlLnZhbGlkYXRlU2NoZW1hID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZS52YWxpZGF0ZU9iamVjdChcbiAgICB0aGlzLmNsYXNzTmFtZSxcbiAgICB0aGlzLmRhdGEsXG4gICAgdGhpcy5xdWVyeSxcbiAgICB0aGlzLnJ1bk9wdGlvbnNcbiAgKTtcbn07XG5cbi8vIFJ1bnMgYW55IGJlZm9yZVNhdmUgdHJpZ2dlcnMgYWdhaW5zdCB0aGlzIG9wZXJhdGlvbi5cbi8vIEFueSBjaGFuZ2UgbGVhZHMgdG8gb3VyIGRhdGEgYmVpbmcgbXV0YXRlZC5cblJlc3RXcml0ZS5wcm90b3R5cGUucnVuQmVmb3JlU2F2ZVRyaWdnZXIgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMucmVzcG9uc2UpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBBdm9pZCBkb2luZyBhbnkgc2V0dXAgZm9yIHRyaWdnZXJzIGlmIHRoZXJlIGlzIG5vICdiZWZvcmVTYXZlJyB0cmlnZ2VyIGZvciB0aGlzIGNsYXNzLlxuICBpZiAoXG4gICAgIXRyaWdnZXJzLnRyaWdnZXJFeGlzdHMoXG4gICAgICB0aGlzLmNsYXNzTmFtZSxcbiAgICAgIHRyaWdnZXJzLlR5cGVzLmJlZm9yZVNhdmUsXG4gICAgICB0aGlzLmNvbmZpZy5hcHBsaWNhdGlvbklkXG4gICAgKVxuICApIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICAvLyBDbG91ZCBjb2RlIGdldHMgYSBiaXQgb2YgZXh0cmEgZGF0YSBmb3IgaXRzIG9iamVjdHNcbiAgdmFyIGV4dHJhRGF0YSA9IHsgY2xhc3NOYW1lOiB0aGlzLmNsYXNzTmFtZSB9O1xuICBpZiAodGhpcy5xdWVyeSAmJiB0aGlzLnF1ZXJ5Lm9iamVjdElkKSB7XG4gICAgZXh0cmFEYXRhLm9iamVjdElkID0gdGhpcy5xdWVyeS5vYmplY3RJZDtcbiAgfVxuXG4gIGxldCBvcmlnaW5hbE9iamVjdCA9IG51bGw7XG4gIGNvbnN0IHVwZGF0ZWRPYmplY3QgPSB0aGlzLmJ1aWxkVXBkYXRlZE9iamVjdChleHRyYURhdGEpO1xuICBpZiAodGhpcy5xdWVyeSAmJiB0aGlzLnF1ZXJ5Lm9iamVjdElkKSB7XG4gICAgLy8gVGhpcyBpcyBhbiB1cGRhdGUgZm9yIGV4aXN0aW5nIG9iamVjdC5cbiAgICBvcmlnaW5hbE9iamVjdCA9IHRyaWdnZXJzLmluZmxhdGUoZXh0cmFEYXRhLCB0aGlzLm9yaWdpbmFsRGF0YSk7XG4gIH1cblxuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAudGhlbigoKSA9PiB7XG4gICAgICAvLyBCZWZvcmUgY2FsbGluZyB0aGUgdHJpZ2dlciwgdmFsaWRhdGUgdGhlIHBlcm1pc3Npb25zIGZvciB0aGUgc2F2ZSBvcGVyYXRpb25cbiAgICAgIGxldCBkYXRhYmFzZVByb21pc2UgPSBudWxsO1xuICAgICAgaWYgKHRoaXMucXVlcnkpIHtcbiAgICAgICAgLy8gVmFsaWRhdGUgZm9yIHVwZGF0aW5nXG4gICAgICAgIGRhdGFiYXNlUHJvbWlzZSA9IHRoaXMuY29uZmlnLmRhdGFiYXNlLnVwZGF0ZShcbiAgICAgICAgICB0aGlzLmNsYXNzTmFtZSxcbiAgICAgICAgICB0aGlzLnF1ZXJ5LFxuICAgICAgICAgIHRoaXMuZGF0YSxcbiAgICAgICAgICB0aGlzLnJ1bk9wdGlvbnMsXG4gICAgICAgICAgZmFsc2UsXG4gICAgICAgICAgdHJ1ZVxuICAgICAgICApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gVmFsaWRhdGUgZm9yIGNyZWF0aW5nXG4gICAgICAgIGRhdGFiYXNlUHJvbWlzZSA9IHRoaXMuY29uZmlnLmRhdGFiYXNlLmNyZWF0ZShcbiAgICAgICAgICB0aGlzLmNsYXNzTmFtZSxcbiAgICAgICAgICB0aGlzLmRhdGEsXG4gICAgICAgICAgdGhpcy5ydW5PcHRpb25zLFxuICAgICAgICAgIHRydWVcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIC8vIEluIHRoZSBjYXNlIHRoYXQgdGhlcmUgaXMgbm8gcGVybWlzc2lvbiBmb3IgdGhlIG9wZXJhdGlvbiwgaXQgdGhyb3dzIGFuIGVycm9yXG4gICAgICByZXR1cm4gZGF0YWJhc2VQcm9taXNlLnRoZW4ocmVzdWx0ID0+IHtcbiAgICAgICAgaWYgKCFyZXN1bHQgfHwgcmVzdWx0Lmxlbmd0aCA8PSAwKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCxcbiAgICAgICAgICAgICdPYmplY3Qgbm90IGZvdW5kLidcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0cmlnZ2Vycy5tYXliZVJ1blRyaWdnZXIoXG4gICAgICAgIHRyaWdnZXJzLlR5cGVzLmJlZm9yZVNhdmUsXG4gICAgICAgIHRoaXMuYXV0aCxcbiAgICAgICAgdXBkYXRlZE9iamVjdCxcbiAgICAgICAgb3JpZ2luYWxPYmplY3QsXG4gICAgICAgIHRoaXMuY29uZmlnLFxuICAgICAgICB0aGlzLmNvbnRleHRcbiAgICAgICk7XG4gICAgfSlcbiAgICAudGhlbihyZXNwb25zZSA9PiB7XG4gICAgICBpZiAocmVzcG9uc2UgJiYgcmVzcG9uc2Uub2JqZWN0KSB7XG4gICAgICAgIHRoaXMuc3RvcmFnZS5maWVsZHNDaGFuZ2VkQnlUcmlnZ2VyID0gXy5yZWR1Y2UoXG4gICAgICAgICAgcmVzcG9uc2Uub2JqZWN0LFxuICAgICAgICAgIChyZXN1bHQsIHZhbHVlLCBrZXkpID0+IHtcbiAgICAgICAgICAgIGlmICghXy5pc0VxdWFsKHRoaXMuZGF0YVtrZXldLCB2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgcmVzdWx0LnB1c2goa2V5KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgICAgfSxcbiAgICAgICAgICBbXVxuICAgICAgICApO1xuICAgICAgICB0aGlzLmRhdGEgPSByZXNwb25zZS5vYmplY3Q7XG4gICAgICAgIC8vIFdlIHNob3VsZCBkZWxldGUgdGhlIG9iamVjdElkIGZvciBhbiB1cGRhdGUgd3JpdGVcbiAgICAgICAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5xdWVyeS5vYmplY3RJZCkge1xuICAgICAgICAgIGRlbGV0ZSB0aGlzLmRhdGEub2JqZWN0SWQ7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUucnVuQmVmb3JlTG9naW5UcmlnZ2VyID0gYXN5bmMgZnVuY3Rpb24odXNlckRhdGEpIHtcbiAgLy8gQXZvaWQgZG9pbmcgYW55IHNldHVwIGZvciB0cmlnZ2VycyBpZiB0aGVyZSBpcyBubyAnYmVmb3JlTG9naW4nIHRyaWdnZXJcbiAgaWYgKFxuICAgICF0cmlnZ2Vycy50cmlnZ2VyRXhpc3RzKFxuICAgICAgdGhpcy5jbGFzc05hbWUsXG4gICAgICB0cmlnZ2Vycy5UeXBlcy5iZWZvcmVMb2dpbixcbiAgICAgIHRoaXMuY29uZmlnLmFwcGxpY2F0aW9uSWRcbiAgICApXG4gICkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIENsb3VkIGNvZGUgZ2V0cyBhIGJpdCBvZiBleHRyYSBkYXRhIGZvciBpdHMgb2JqZWN0c1xuICBjb25zdCBleHRyYURhdGEgPSB7IGNsYXNzTmFtZTogdGhpcy5jbGFzc05hbWUgfTtcbiAgY29uc3QgdXNlciA9IHRyaWdnZXJzLmluZmxhdGUoZXh0cmFEYXRhLCB1c2VyRGF0YSk7XG5cbiAgLy8gbm8gbmVlZCB0byByZXR1cm4gYSByZXNwb25zZVxuICBhd2FpdCB0cmlnZ2Vycy5tYXliZVJ1blRyaWdnZXIoXG4gICAgdHJpZ2dlcnMuVHlwZXMuYmVmb3JlTG9naW4sXG4gICAgdGhpcy5hdXRoLFxuICAgIHVzZXIsXG4gICAgbnVsbCxcbiAgICB0aGlzLmNvbmZpZyxcbiAgICB0aGlzLmNvbnRleHRcbiAgKTtcbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuc2V0UmVxdWlyZWRGaWVsZHNJZk5lZWRlZCA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5kYXRhKSB7XG4gICAgLy8gQWRkIGRlZmF1bHQgZmllbGRzXG4gICAgdGhpcy5kYXRhLnVwZGF0ZWRBdCA9IHRoaXMudXBkYXRlZEF0O1xuICAgIGlmICghdGhpcy5xdWVyeSkge1xuICAgICAgdGhpcy5kYXRhLmNyZWF0ZWRBdCA9IHRoaXMudXBkYXRlZEF0O1xuXG4gICAgICAvLyBPbmx5IGFzc2lnbiBuZXcgb2JqZWN0SWQgaWYgd2UgYXJlIGNyZWF0aW5nIG5ldyBvYmplY3RcbiAgICAgIGlmICghdGhpcy5kYXRhLm9iamVjdElkKSB7XG4gICAgICAgIHRoaXMuZGF0YS5vYmplY3RJZCA9IGNyeXB0b1V0aWxzLm5ld09iamVjdElkKHRoaXMuY29uZmlnLm9iamVjdElkU2l6ZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbn07XG5cbi8vIFRyYW5zZm9ybXMgYXV0aCBkYXRhIGZvciBhIHVzZXIgb2JqZWN0LlxuLy8gRG9lcyBub3RoaW5nIGlmIHRoaXMgaXNuJ3QgYSB1c2VyIG9iamVjdC5cbi8vIFJldHVybnMgYSBwcm9taXNlIGZvciB3aGVuIHdlJ3JlIGRvbmUgaWYgaXQgY2FuJ3QgZmluaXNoIHRoaXMgdGljay5cblJlc3RXcml0ZS5wcm90b3R5cGUudmFsaWRhdGVBdXRoRGF0YSA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5jbGFzc05hbWUgIT09ICdfVXNlcicpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAoIXRoaXMucXVlcnkgJiYgIXRoaXMuZGF0YS5hdXRoRGF0YSkge1xuICAgIGlmIChcbiAgICAgIHR5cGVvZiB0aGlzLmRhdGEudXNlcm5hbWUgIT09ICdzdHJpbmcnIHx8XG4gICAgICBfLmlzRW1wdHkodGhpcy5kYXRhLnVzZXJuYW1lKVxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5VU0VSTkFNRV9NSVNTSU5HLFxuICAgICAgICAnYmFkIG9yIG1pc3NpbmcgdXNlcm5hbWUnXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICB0eXBlb2YgdGhpcy5kYXRhLnBhc3N3b3JkICE9PSAnc3RyaW5nJyB8fFxuICAgICAgXy5pc0VtcHR5KHRoaXMuZGF0YS5wYXNzd29yZClcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuUEFTU1dPUkRfTUlTU0lORyxcbiAgICAgICAgJ3Bhc3N3b3JkIGlzIHJlcXVpcmVkJ1xuICAgICAgKTtcbiAgICB9XG4gIH1cblxuICBpZiAoIXRoaXMuZGF0YS5hdXRoRGF0YSB8fCAhT2JqZWN0LmtleXModGhpcy5kYXRhLmF1dGhEYXRhKS5sZW5ndGgpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICB2YXIgYXV0aERhdGEgPSB0aGlzLmRhdGEuYXV0aERhdGE7XG4gIHZhciBwcm92aWRlcnMgPSBPYmplY3Qua2V5cyhhdXRoRGF0YSk7XG4gIGlmIChwcm92aWRlcnMubGVuZ3RoID4gMCkge1xuICAgIGNvbnN0IGNhbkhhbmRsZUF1dGhEYXRhID0gcHJvdmlkZXJzLnJlZHVjZSgoY2FuSGFuZGxlLCBwcm92aWRlcikgPT4ge1xuICAgICAgdmFyIHByb3ZpZGVyQXV0aERhdGEgPSBhdXRoRGF0YVtwcm92aWRlcl07XG4gICAgICB2YXIgaGFzVG9rZW4gPSBwcm92aWRlckF1dGhEYXRhICYmIHByb3ZpZGVyQXV0aERhdGEuaWQ7XG4gICAgICByZXR1cm4gY2FuSGFuZGxlICYmIChoYXNUb2tlbiB8fCBwcm92aWRlckF1dGhEYXRhID09IG51bGwpO1xuICAgIH0sIHRydWUpO1xuICAgIGlmIChjYW5IYW5kbGVBdXRoRGF0YSkge1xuICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlQXV0aERhdGEoYXV0aERhdGEpO1xuICAgIH1cbiAgfVxuICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgUGFyc2UuRXJyb3IuVU5TVVBQT1JURURfU0VSVklDRSxcbiAgICAnVGhpcyBhdXRoZW50aWNhdGlvbiBtZXRob2QgaXMgdW5zdXBwb3J0ZWQuJ1xuICApO1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5oYW5kbGVBdXRoRGF0YVZhbGlkYXRpb24gPSBmdW5jdGlvbihhdXRoRGF0YSkge1xuICBjb25zdCB2YWxpZGF0aW9ucyA9IE9iamVjdC5rZXlzKGF1dGhEYXRhKS5tYXAocHJvdmlkZXIgPT4ge1xuICAgIGlmIChhdXRoRGF0YVtwcm92aWRlcl0gPT09IG51bGwpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG4gICAgY29uc3QgdmFsaWRhdGVBdXRoRGF0YSA9IHRoaXMuY29uZmlnLmF1dGhEYXRhTWFuYWdlci5nZXRWYWxpZGF0b3JGb3JQcm92aWRlcihcbiAgICAgIHByb3ZpZGVyXG4gICAgKTtcbiAgICBpZiAoIXZhbGlkYXRlQXV0aERhdGEpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuVU5TVVBQT1JURURfU0VSVklDRSxcbiAgICAgICAgJ1RoaXMgYXV0aGVudGljYXRpb24gbWV0aG9kIGlzIHVuc3VwcG9ydGVkLidcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiB2YWxpZGF0ZUF1dGhEYXRhKGF1dGhEYXRhW3Byb3ZpZGVyXSk7XG4gIH0pO1xuICByZXR1cm4gUHJvbWlzZS5hbGwodmFsaWRhdGlvbnMpO1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5maW5kVXNlcnNXaXRoQXV0aERhdGEgPSBmdW5jdGlvbihhdXRoRGF0YSkge1xuICBjb25zdCBwcm92aWRlcnMgPSBPYmplY3Qua2V5cyhhdXRoRGF0YSk7XG4gIGNvbnN0IHF1ZXJ5ID0gcHJvdmlkZXJzXG4gICAgLnJlZHVjZSgobWVtbywgcHJvdmlkZXIpID0+IHtcbiAgICAgIGlmICghYXV0aERhdGFbcHJvdmlkZXJdKSB7XG4gICAgICAgIHJldHVybiBtZW1vO1xuICAgICAgfVxuICAgICAgY29uc3QgcXVlcnlLZXkgPSBgYXV0aERhdGEuJHtwcm92aWRlcn0uaWRgO1xuICAgICAgY29uc3QgcXVlcnkgPSB7fTtcbiAgICAgIHF1ZXJ5W3F1ZXJ5S2V5XSA9IGF1dGhEYXRhW3Byb3ZpZGVyXS5pZDtcbiAgICAgIG1lbW8ucHVzaChxdWVyeSk7XG4gICAgICByZXR1cm4gbWVtbztcbiAgICB9LCBbXSlcbiAgICAuZmlsdGVyKHEgPT4ge1xuICAgICAgcmV0dXJuIHR5cGVvZiBxICE9PSAndW5kZWZpbmVkJztcbiAgICB9KTtcblxuICBsZXQgZmluZFByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoW10pO1xuICBpZiAocXVlcnkubGVuZ3RoID4gMCkge1xuICAgIGZpbmRQcm9taXNlID0gdGhpcy5jb25maWcuZGF0YWJhc2UuZmluZCh0aGlzLmNsYXNzTmFtZSwgeyAkb3I6IHF1ZXJ5IH0sIHt9KTtcbiAgfVxuXG4gIHJldHVybiBmaW5kUHJvbWlzZTtcbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuZmlsdGVyZWRPYmplY3RzQnlBQ0wgPSBmdW5jdGlvbihvYmplY3RzKSB7XG4gIGlmICh0aGlzLmF1dGguaXNNYXN0ZXIpIHtcbiAgICByZXR1cm4gb2JqZWN0cztcbiAgfVxuICByZXR1cm4gb2JqZWN0cy5maWx0ZXIob2JqZWN0ID0+IHtcbiAgICBpZiAoIW9iamVjdC5BQ0wpIHtcbiAgICAgIHJldHVybiB0cnVlOyAvLyBsZWdhY3kgdXNlcnMgdGhhdCBoYXZlIG5vIEFDTCBmaWVsZCBvbiB0aGVtXG4gICAgfVxuICAgIC8vIFJlZ3VsYXIgdXNlcnMgdGhhdCBoYXZlIGJlZW4gbG9ja2VkIG91dC5cbiAgICByZXR1cm4gb2JqZWN0LkFDTCAmJiBPYmplY3Qua2V5cyhvYmplY3QuQUNMKS5sZW5ndGggPiAwO1xuICB9KTtcbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuaGFuZGxlQXV0aERhdGEgPSBmdW5jdGlvbihhdXRoRGF0YSkge1xuICBsZXQgcmVzdWx0cztcbiAgcmV0dXJuIHRoaXMuZmluZFVzZXJzV2l0aEF1dGhEYXRhKGF1dGhEYXRhKS50aGVuKGFzeW5jIHIgPT4ge1xuICAgIHJlc3VsdHMgPSB0aGlzLmZpbHRlcmVkT2JqZWN0c0J5QUNMKHIpO1xuICAgIGlmIChyZXN1bHRzLmxlbmd0aCA+IDEpIHtcbiAgICAgIC8vIE1vcmUgdGhhbiAxIHVzZXIgd2l0aCB0aGUgcGFzc2VkIGlkJ3NcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuQUNDT1VOVF9BTFJFQURZX0xJTktFRCxcbiAgICAgICAgJ3RoaXMgYXV0aCBpcyBhbHJlYWR5IHVzZWQnXG4gICAgICApO1xuICAgIH1cblxuICAgIHRoaXMuc3RvcmFnZVsnYXV0aFByb3ZpZGVyJ10gPSBPYmplY3Qua2V5cyhhdXRoRGF0YSkuam9pbignLCcpO1xuXG4gICAgaWYgKHJlc3VsdHMubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgdXNlclJlc3VsdCA9IHJlc3VsdHNbMF07XG4gICAgICBjb25zdCBtdXRhdGVkQXV0aERhdGEgPSB7fTtcbiAgICAgIE9iamVjdC5rZXlzKGF1dGhEYXRhKS5mb3JFYWNoKHByb3ZpZGVyID0+IHtcbiAgICAgICAgY29uc3QgcHJvdmlkZXJEYXRhID0gYXV0aERhdGFbcHJvdmlkZXJdO1xuICAgICAgICBjb25zdCB1c2VyQXV0aERhdGEgPSB1c2VyUmVzdWx0LmF1dGhEYXRhW3Byb3ZpZGVyXTtcbiAgICAgICAgaWYgKCFfLmlzRXF1YWwocHJvdmlkZXJEYXRhLCB1c2VyQXV0aERhdGEpKSB7XG4gICAgICAgICAgbXV0YXRlZEF1dGhEYXRhW3Byb3ZpZGVyXSA9IHByb3ZpZGVyRGF0YTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBjb25zdCBoYXNNdXRhdGVkQXV0aERhdGEgPSBPYmplY3Qua2V5cyhtdXRhdGVkQXV0aERhdGEpLmxlbmd0aCAhPT0gMDtcbiAgICAgIGxldCB1c2VySWQ7XG4gICAgICBpZiAodGhpcy5xdWVyeSAmJiB0aGlzLnF1ZXJ5Lm9iamVjdElkKSB7XG4gICAgICAgIHVzZXJJZCA9IHRoaXMucXVlcnkub2JqZWN0SWQ7XG4gICAgICB9IGVsc2UgaWYgKHRoaXMuYXV0aCAmJiB0aGlzLmF1dGgudXNlciAmJiB0aGlzLmF1dGgudXNlci5pZCkge1xuICAgICAgICB1c2VySWQgPSB0aGlzLmF1dGgudXNlci5pZDtcbiAgICAgIH1cbiAgICAgIGlmICghdXNlcklkIHx8IHVzZXJJZCA9PT0gdXNlclJlc3VsdC5vYmplY3RJZCkge1xuICAgICAgICAvLyBubyB1c2VyIG1ha2luZyB0aGUgY2FsbFxuICAgICAgICAvLyBPUiB0aGUgdXNlciBtYWtpbmcgdGhlIGNhbGwgaXMgdGhlIHJpZ2h0IG9uZVxuICAgICAgICAvLyBMb2dpbiB3aXRoIGF1dGggZGF0YVxuICAgICAgICBkZWxldGUgcmVzdWx0c1swXS5wYXNzd29yZDtcblxuICAgICAgICAvLyBuZWVkIHRvIHNldCB0aGUgb2JqZWN0SWQgZmlyc3Qgb3RoZXJ3aXNlIGxvY2F0aW9uIGhhcyB0cmFpbGluZyB1bmRlZmluZWRcbiAgICAgICAgdGhpcy5kYXRhLm9iamVjdElkID0gdXNlclJlc3VsdC5vYmplY3RJZDtcblxuICAgICAgICBpZiAoIXRoaXMucXVlcnkgfHwgIXRoaXMucXVlcnkub2JqZWN0SWQpIHtcbiAgICAgICAgICAvLyB0aGlzIGEgbG9naW4gY2FsbCwgbm8gdXNlcklkIHBhc3NlZFxuICAgICAgICAgIHRoaXMucmVzcG9uc2UgPSB7XG4gICAgICAgICAgICByZXNwb25zZTogdXNlclJlc3VsdCxcbiAgICAgICAgICAgIGxvY2F0aW9uOiB0aGlzLmxvY2F0aW9uKCksXG4gICAgICAgICAgfTtcbiAgICAgICAgICAvLyBSdW4gYmVmb3JlTG9naW4gaG9vayBiZWZvcmUgc3RvcmluZyBhbnkgdXBkYXRlc1xuICAgICAgICAgIC8vIHRvIGF1dGhEYXRhIG9uIHRoZSBkYjsgY2hhbmdlcyB0byB1c2VyUmVzdWx0XG4gICAgICAgICAgLy8gd2lsbCBiZSBpZ25vcmVkLlxuICAgICAgICAgIGF3YWl0IHRoaXMucnVuQmVmb3JlTG9naW5UcmlnZ2VyKGRlZXBjb3B5KHVzZXJSZXN1bHQpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIElmIHdlIGRpZG4ndCBjaGFuZ2UgdGhlIGF1dGggZGF0YSwganVzdCBrZWVwIGdvaW5nXG4gICAgICAgIGlmICghaGFzTXV0YXRlZEF1dGhEYXRhKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIC8vIFdlIGhhdmUgYXV0aERhdGEgdGhhdCBpcyB1cGRhdGVkIG9uIGxvZ2luXG4gICAgICAgIC8vIHRoYXQgY2FuIGhhcHBlbiB3aGVuIHRva2VuIGFyZSByZWZyZXNoZWQsXG4gICAgICAgIC8vIFdlIHNob3VsZCB1cGRhdGUgdGhlIHRva2VuIGFuZCBsZXQgdGhlIHVzZXIgaW5cbiAgICAgICAgLy8gV2Ugc2hvdWxkIG9ubHkgY2hlY2sgdGhlIG11dGF0ZWQga2V5c1xuICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVBdXRoRGF0YVZhbGlkYXRpb24obXV0YXRlZEF1dGhEYXRhKS50aGVuKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAvLyBJRiB3ZSBoYXZlIGEgcmVzcG9uc2UsIHdlJ2xsIHNraXAgdGhlIGRhdGFiYXNlIG9wZXJhdGlvbiAvIGJlZm9yZVNhdmUgLyBhZnRlclNhdmUgZXRjLi4uXG4gICAgICAgICAgLy8gd2UgbmVlZCB0byBzZXQgaXQgdXAgdGhlcmUuXG4gICAgICAgICAgLy8gV2UgYXJlIHN1cHBvc2VkIHRvIGhhdmUgYSByZXNwb25zZSBvbmx5IG9uIExPR0lOIHdpdGggYXV0aERhdGEsIHNvIHdlIHNraXAgdGhvc2VcbiAgICAgICAgICAvLyBJZiB3ZSdyZSBub3QgbG9nZ2luZyBpbiwgYnV0IGp1c3QgdXBkYXRpbmcgdGhlIGN1cnJlbnQgdXNlciwgd2UgY2FuIHNhZmVseSBza2lwIHRoYXQgcGFydFxuICAgICAgICAgIGlmICh0aGlzLnJlc3BvbnNlKSB7XG4gICAgICAgICAgICAvLyBBc3NpZ24gdGhlIG5ldyBhdXRoRGF0YSBpbiB0aGUgcmVzcG9uc2VcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKG11dGF0ZWRBdXRoRGF0YSkuZm9yRWFjaChwcm92aWRlciA9PiB7XG4gICAgICAgICAgICAgIHRoaXMucmVzcG9uc2UucmVzcG9uc2UuYXV0aERhdGFbcHJvdmlkZXJdID1cbiAgICAgICAgICAgICAgICBtdXRhdGVkQXV0aERhdGFbcHJvdmlkZXJdO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIFJ1biB0aGUgREIgdXBkYXRlIGRpcmVjdGx5LCBhcyAnbWFzdGVyJ1xuICAgICAgICAgICAgLy8gSnVzdCB1cGRhdGUgdGhlIGF1dGhEYXRhIHBhcnRcbiAgICAgICAgICAgIC8vIFRoZW4gd2UncmUgZ29vZCBmb3IgdGhlIHVzZXIsIGVhcmx5IGV4aXQgb2Ygc29ydHNcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZS51cGRhdGUoXG4gICAgICAgICAgICAgIHRoaXMuY2xhc3NOYW1lLFxuICAgICAgICAgICAgICB7IG9iamVjdElkOiB0aGlzLmRhdGEub2JqZWN0SWQgfSxcbiAgICAgICAgICAgICAgeyBhdXRoRGF0YTogbXV0YXRlZEF1dGhEYXRhIH0sXG4gICAgICAgICAgICAgIHt9XG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2UgaWYgKHVzZXJJZCkge1xuICAgICAgICAvLyBUcnlpbmcgdG8gdXBkYXRlIGF1dGggZGF0YSBidXQgdXNlcnNcbiAgICAgICAgLy8gYXJlIGRpZmZlcmVudFxuICAgICAgICBpZiAodXNlclJlc3VsdC5vYmplY3RJZCAhPT0gdXNlcklkKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuQUNDT1VOVF9BTFJFQURZX0xJTktFRCxcbiAgICAgICAgICAgICd0aGlzIGF1dGggaXMgYWxyZWFkeSB1c2VkJ1xuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gTm8gYXV0aCBkYXRhIHdhcyBtdXRhdGVkLCBqdXN0IGtlZXAgZ29pbmdcbiAgICAgICAgaWYgKCFoYXNNdXRhdGVkQXV0aERhdGEpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuaGFuZGxlQXV0aERhdGFWYWxpZGF0aW9uKGF1dGhEYXRhKTtcbiAgfSk7XG59O1xuXG4vLyBUaGUgbm9uLXRoaXJkLXBhcnR5IHBhcnRzIG9mIFVzZXIgdHJhbnNmb3JtYXRpb25cblJlc3RXcml0ZS5wcm90b3R5cGUudHJhbnNmb3JtVXNlciA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xuXG4gIGlmICh0aGlzLmNsYXNzTmFtZSAhPT0gJ19Vc2VyJykge1xuICAgIHJldHVybiBwcm9taXNlO1xuICB9XG5cbiAgaWYgKCF0aGlzLmF1dGguaXNNYXN0ZXIgJiYgJ2VtYWlsVmVyaWZpZWQnIGluIHRoaXMuZGF0YSkge1xuICAgIGNvbnN0IGVycm9yID0gYENsaWVudHMgYXJlbid0IGFsbG93ZWQgdG8gbWFudWFsbHkgdXBkYXRlIGVtYWlsIHZlcmlmaWNhdGlvbi5gO1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PUEVSQVRJT05fRk9SQklEREVOLCBlcnJvcik7XG4gIH1cblxuICAvLyBEbyBub3QgY2xlYW51cCBzZXNzaW9uIGlmIG9iamVjdElkIGlzIG5vdCBzZXRcbiAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5vYmplY3RJZCgpKSB7XG4gICAgLy8gSWYgd2UncmUgdXBkYXRpbmcgYSBfVXNlciBvYmplY3QsIHdlIG5lZWQgdG8gY2xlYXIgb3V0IHRoZSBjYWNoZSBmb3IgdGhhdCB1c2VyLiBGaW5kIGFsbCB0aGVpclxuICAgIC8vIHNlc3Npb24gdG9rZW5zLCBhbmQgcmVtb3ZlIHRoZW0gZnJvbSB0aGUgY2FjaGUuXG4gICAgcHJvbWlzZSA9IG5ldyBSZXN0UXVlcnkodGhpcy5jb25maWcsIEF1dGgubWFzdGVyKHRoaXMuY29uZmlnKSwgJ19TZXNzaW9uJywge1xuICAgICAgdXNlcjoge1xuICAgICAgICBfX3R5cGU6ICdQb2ludGVyJyxcbiAgICAgICAgY2xhc3NOYW1lOiAnX1VzZXInLFxuICAgICAgICBvYmplY3RJZDogdGhpcy5vYmplY3RJZCgpLFxuICAgICAgfSxcbiAgICB9KVxuICAgICAgLmV4ZWN1dGUoKVxuICAgICAgLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICAgIHJlc3VsdHMucmVzdWx0cy5mb3JFYWNoKHNlc3Npb24gPT5cbiAgICAgICAgICB0aGlzLmNvbmZpZy5jYWNoZUNvbnRyb2xsZXIudXNlci5kZWwoc2Vzc2lvbi5zZXNzaW9uVG9rZW4pXG4gICAgICAgICk7XG4gICAgICB9KTtcbiAgfVxuXG4gIHJldHVybiBwcm9taXNlXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgLy8gVHJhbnNmb3JtIHRoZSBwYXNzd29yZFxuICAgICAgaWYgKHRoaXMuZGF0YS5wYXNzd29yZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIC8vIGlnbm9yZSBvbmx5IGlmIHVuZGVmaW5lZC4gc2hvdWxkIHByb2NlZWQgaWYgZW1wdHkgKCcnKVxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLnF1ZXJ5KSB7XG4gICAgICAgIHRoaXMuc3RvcmFnZVsnY2xlYXJTZXNzaW9ucyddID0gdHJ1ZTtcbiAgICAgICAgLy8gR2VuZXJhdGUgYSBuZXcgc2Vzc2lvbiBvbmx5IGlmIHRoZSB1c2VyIHJlcXVlc3RlZFxuICAgICAgICBpZiAoIXRoaXMuYXV0aC5pc01hc3Rlcikge1xuICAgICAgICAgIHRoaXMuc3RvcmFnZVsnZ2VuZXJhdGVOZXdTZXNzaW9uJ10gPSB0cnVlO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzLl92YWxpZGF0ZVBhc3N3b3JkUG9saWN5KCkudGhlbigoKSA9PiB7XG4gICAgICAgIHJldHVybiBwYXNzd29yZENyeXB0by5oYXNoKHRoaXMuZGF0YS5wYXNzd29yZCkudGhlbihoYXNoZWRQYXNzd29yZCA9PiB7XG4gICAgICAgICAgdGhpcy5kYXRhLl9oYXNoZWRfcGFzc3dvcmQgPSBoYXNoZWRQYXNzd29yZDtcbiAgICAgICAgICBkZWxldGUgdGhpcy5kYXRhLnBhc3N3b3JkO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuX3ZhbGlkYXRlVXNlck5hbWUoKTtcbiAgICB9KVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLl92YWxpZGF0ZUVtYWlsKCk7XG4gICAgfSk7XG59O1xuXG5SZXN0V3JpdGUucHJvdG90eXBlLl92YWxpZGF0ZVVzZXJOYW1lID0gZnVuY3Rpb24oKSB7XG4gIC8vIENoZWNrIGZvciB1c2VybmFtZSB1bmlxdWVuZXNzXG4gIGlmICghdGhpcy5kYXRhLnVzZXJuYW1lKSB7XG4gICAgaWYgKCF0aGlzLnF1ZXJ5KSB7XG4gICAgICB0aGlzLmRhdGEudXNlcm5hbWUgPSBjcnlwdG9VdGlscy5yYW5kb21TdHJpbmcoMjUpO1xuICAgICAgdGhpcy5yZXNwb25zZVNob3VsZEhhdmVVc2VybmFtZSA9IHRydWU7XG4gICAgfVxuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuICAvLyBXZSBuZWVkIHRvIGEgZmluZCB0byBjaGVjayBmb3IgZHVwbGljYXRlIHVzZXJuYW1lIGluIGNhc2UgdGhleSBhcmUgbWlzc2luZyB0aGUgdW5pcXVlIGluZGV4IG9uIHVzZXJuYW1lc1xuICAvLyBUT0RPOiBDaGVjayBpZiB0aGVyZSBpcyBhIHVuaXF1ZSBpbmRleCwgYW5kIGlmIHNvLCBza2lwIHRoaXMgcXVlcnkuXG4gIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZVxuICAgIC5maW5kKFxuICAgICAgdGhpcy5jbGFzc05hbWUsXG4gICAgICB7IHVzZXJuYW1lOiB0aGlzLmRhdGEudXNlcm5hbWUsIG9iamVjdElkOiB7ICRuZTogdGhpcy5vYmplY3RJZCgpIH0gfSxcbiAgICAgIHsgbGltaXQ6IDEgfVxuICAgIClcbiAgICAudGhlbihyZXN1bHRzID0+IHtcbiAgICAgIGlmIChyZXN1bHRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLlVTRVJOQU1FX1RBS0VOLFxuICAgICAgICAgICdBY2NvdW50IGFscmVhZHkgZXhpc3RzIGZvciB0aGlzIHVzZXJuYW1lLidcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9KTtcbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuX3ZhbGlkYXRlRW1haWwgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLmRhdGEuZW1haWwgfHwgdGhpcy5kYXRhLmVtYWlsLl9fb3AgPT09ICdEZWxldGUnKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG4gIC8vIFZhbGlkYXRlIGJhc2ljIGVtYWlsIGFkZHJlc3MgZm9ybWF0XG4gIGlmICghdGhpcy5kYXRhLmVtYWlsLm1hdGNoKC9eLitALiskLykpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QoXG4gICAgICBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfRU1BSUxfQUREUkVTUyxcbiAgICAgICAgJ0VtYWlsIGFkZHJlc3MgZm9ybWF0IGlzIGludmFsaWQuJ1xuICAgICAgKVxuICAgICk7XG4gIH1cbiAgLy8gU2FtZSBwcm9ibGVtIGZvciBlbWFpbCBhcyBhYm92ZSBmb3IgdXNlcm5hbWVcbiAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlXG4gICAgLmZpbmQoXG4gICAgICB0aGlzLmNsYXNzTmFtZSxcbiAgICAgIHsgZW1haWw6IHRoaXMuZGF0YS5lbWFpbCwgb2JqZWN0SWQ6IHsgJG5lOiB0aGlzLm9iamVjdElkKCkgfSB9LFxuICAgICAgeyBsaW1pdDogMSB9XG4gICAgKVxuICAgIC50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgaWYgKHJlc3VsdHMubGVuZ3RoID4gMCkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuRU1BSUxfVEFLRU4sXG4gICAgICAgICAgJ0FjY291bnQgYWxyZWFkeSBleGlzdHMgZm9yIHRoaXMgZW1haWwgYWRkcmVzcy4nXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBpZiAoXG4gICAgICAgICF0aGlzLmRhdGEuYXV0aERhdGEgfHxcbiAgICAgICAgIU9iamVjdC5rZXlzKHRoaXMuZGF0YS5hdXRoRGF0YSkubGVuZ3RoIHx8XG4gICAgICAgIChPYmplY3Qua2V5cyh0aGlzLmRhdGEuYXV0aERhdGEpLmxlbmd0aCA9PT0gMSAmJlxuICAgICAgICAgIE9iamVjdC5rZXlzKHRoaXMuZGF0YS5hdXRoRGF0YSlbMF0gPT09ICdhbm9ueW1vdXMnKVxuICAgICAgKSB7XG4gICAgICAgIC8vIFdlIHVwZGF0ZWQgdGhlIGVtYWlsLCBzZW5kIGEgbmV3IHZhbGlkYXRpb25cbiAgICAgICAgdGhpcy5zdG9yYWdlWydzZW5kVmVyaWZpY2F0aW9uRW1haWwnXSA9IHRydWU7XG4gICAgICAgIHRoaXMuY29uZmlnLnVzZXJDb250cm9sbGVyLnNldEVtYWlsVmVyaWZ5VG9rZW4odGhpcy5kYXRhKTtcbiAgICAgIH1cbiAgICB9KTtcbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuX3ZhbGlkYXRlUGFzc3dvcmRQb2xpY3kgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeSkgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICByZXR1cm4gdGhpcy5fdmFsaWRhdGVQYXNzd29yZFJlcXVpcmVtZW50cygpLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLl92YWxpZGF0ZVBhc3N3b3JkSGlzdG9yeSgpO1xuICB9KTtcbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuX3ZhbGlkYXRlUGFzc3dvcmRSZXF1aXJlbWVudHMgPSBmdW5jdGlvbigpIHtcbiAgLy8gY2hlY2sgaWYgdGhlIHBhc3N3b3JkIGNvbmZvcm1zIHRvIHRoZSBkZWZpbmVkIHBhc3N3b3JkIHBvbGljeSBpZiBjb25maWd1cmVkXG4gIC8vIElmIHdlIHNwZWNpZmllZCBhIGN1c3RvbSBlcnJvciBpbiBvdXIgY29uZmlndXJhdGlvbiB1c2UgaXQuXG4gIC8vIEV4YW1wbGU6IFwiUGFzc3dvcmRzIG11c3QgaW5jbHVkZSBhIENhcGl0YWwgTGV0dGVyLCBMb3dlcmNhc2UgTGV0dGVyLCBhbmQgYSBudW1iZXIuXCJcbiAgLy9cbiAgLy8gVGhpcyBpcyBlc3BlY2lhbGx5IHVzZWZ1bCBvbiB0aGUgZ2VuZXJpYyBcInBhc3N3b3JkIHJlc2V0XCIgcGFnZSxcbiAgLy8gYXMgaXQgYWxsb3dzIHRoZSBwcm9ncmFtbWVyIHRvIGNvbW11bmljYXRlIHNwZWNpZmljIHJlcXVpcmVtZW50cyBpbnN0ZWFkIG9mOlxuICAvLyBhLiBtYWtpbmcgdGhlIHVzZXIgZ3Vlc3Mgd2hhdHMgd3JvbmdcbiAgLy8gYi4gbWFraW5nIGEgY3VzdG9tIHBhc3N3b3JkIHJlc2V0IHBhZ2UgdGhhdCBzaG93cyB0aGUgcmVxdWlyZW1lbnRzXG4gIGNvbnN0IHBvbGljeUVycm9yID0gdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kudmFsaWRhdGlvbkVycm9yXG4gICAgPyB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS52YWxpZGF0aW9uRXJyb3JcbiAgICA6ICdQYXNzd29yZCBkb2VzIG5vdCBtZWV0IHRoZSBQYXNzd29yZCBQb2xpY3kgcmVxdWlyZW1lbnRzLic7XG4gIGNvbnN0IGNvbnRhaW5zVXNlcm5hbWVFcnJvciA9ICdQYXNzd29yZCBjYW5ub3QgY29udGFpbiB5b3VyIHVzZXJuYW1lLic7XG5cbiAgLy8gY2hlY2sgd2hldGhlciB0aGUgcGFzc3dvcmQgbWVldHMgdGhlIHBhc3N3b3JkIHN0cmVuZ3RoIHJlcXVpcmVtZW50c1xuICBpZiAoXG4gICAgKHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5LnBhdHRlcm5WYWxpZGF0b3IgJiZcbiAgICAgICF0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS5wYXR0ZXJuVmFsaWRhdG9yKHRoaXMuZGF0YS5wYXNzd29yZCkpIHx8XG4gICAgKHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5LnZhbGlkYXRvckNhbGxiYWNrICYmXG4gICAgICAhdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kudmFsaWRhdG9yQ2FsbGJhY2sodGhpcy5kYXRhLnBhc3N3b3JkKSlcbiAgKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVqZWN0KFxuICAgICAgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlZBTElEQVRJT05fRVJST1IsIHBvbGljeUVycm9yKVxuICAgICk7XG4gIH1cblxuICAvLyBjaGVjayB3aGV0aGVyIHBhc3N3b3JkIGNvbnRhaW4gdXNlcm5hbWVcbiAgaWYgKHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5LmRvTm90QWxsb3dVc2VybmFtZSA9PT0gdHJ1ZSkge1xuICAgIGlmICh0aGlzLmRhdGEudXNlcm5hbWUpIHtcbiAgICAgIC8vIHVzZXJuYW1lIGlzIG5vdCBwYXNzZWQgZHVyaW5nIHBhc3N3b3JkIHJlc2V0XG4gICAgICBpZiAodGhpcy5kYXRhLnBhc3N3b3JkLmluZGV4T2YodGhpcy5kYXRhLnVzZXJuYW1lKSA+PSAwKVxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QoXG4gICAgICAgICAgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlZBTElEQVRJT05fRVJST1IsIGNvbnRhaW5zVXNlcm5hbWVFcnJvcilcbiAgICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gcmV0cmlldmUgdGhlIFVzZXIgb2JqZWN0IHVzaW5nIG9iamVjdElkIGR1cmluZyBwYXNzd29yZCByZXNldFxuICAgICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlXG4gICAgICAgIC5maW5kKCdfVXNlcicsIHsgb2JqZWN0SWQ6IHRoaXMub2JqZWN0SWQoKSB9KVxuICAgICAgICAudGhlbihyZXN1bHRzID0+IHtcbiAgICAgICAgICBpZiAocmVzdWx0cy5sZW5ndGggIT0gMSkge1xuICAgICAgICAgICAgdGhyb3cgdW5kZWZpbmVkO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAodGhpcy5kYXRhLnBhc3N3b3JkLmluZGV4T2YocmVzdWx0c1swXS51c2VybmFtZSkgPj0gMClcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChcbiAgICAgICAgICAgICAgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICAgIFBhcnNlLkVycm9yLlZBTElEQVRJT05fRVJST1IsXG4gICAgICAgICAgICAgICAgY29udGFpbnNVc2VybmFtZUVycm9yXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICB9KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5fdmFsaWRhdGVQYXNzd29yZEhpc3RvcnkgPSBmdW5jdGlvbigpIHtcbiAgLy8gY2hlY2sgd2hldGhlciBwYXNzd29yZCBpcyByZXBlYXRpbmcgZnJvbSBzcGVjaWZpZWQgaGlzdG9yeVxuICBpZiAodGhpcy5xdWVyeSAmJiB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS5tYXhQYXNzd29yZEhpc3RvcnkpIHtcbiAgICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2VcbiAgICAgIC5maW5kKFxuICAgICAgICAnX1VzZXInLFxuICAgICAgICB7IG9iamVjdElkOiB0aGlzLm9iamVjdElkKCkgfSxcbiAgICAgICAgeyBrZXlzOiBbJ19wYXNzd29yZF9oaXN0b3J5JywgJ19oYXNoZWRfcGFzc3dvcmQnXSB9XG4gICAgICApXG4gICAgICAudGhlbihyZXN1bHRzID0+IHtcbiAgICAgICAgaWYgKHJlc3VsdHMubGVuZ3RoICE9IDEpIHtcbiAgICAgICAgICB0aHJvdyB1bmRlZmluZWQ7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgdXNlciA9IHJlc3VsdHNbMF07XG4gICAgICAgIGxldCBvbGRQYXNzd29yZHMgPSBbXTtcbiAgICAgICAgaWYgKHVzZXIuX3Bhc3N3b3JkX2hpc3RvcnkpXG4gICAgICAgICAgb2xkUGFzc3dvcmRzID0gXy50YWtlKFxuICAgICAgICAgICAgdXNlci5fcGFzc3dvcmRfaGlzdG9yeSxcbiAgICAgICAgICAgIHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5Lm1heFBhc3N3b3JkSGlzdG9yeSAtIDFcbiAgICAgICAgICApO1xuICAgICAgICBvbGRQYXNzd29yZHMucHVzaCh1c2VyLnBhc3N3b3JkKTtcbiAgICAgICAgY29uc3QgbmV3UGFzc3dvcmQgPSB0aGlzLmRhdGEucGFzc3dvcmQ7XG4gICAgICAgIC8vIGNvbXBhcmUgdGhlIG5ldyBwYXNzd29yZCBoYXNoIHdpdGggYWxsIG9sZCBwYXNzd29yZCBoYXNoZXNcbiAgICAgICAgY29uc3QgcHJvbWlzZXMgPSBvbGRQYXNzd29yZHMubWFwKGZ1bmN0aW9uKGhhc2gpIHtcbiAgICAgICAgICByZXR1cm4gcGFzc3dvcmRDcnlwdG8uY29tcGFyZShuZXdQYXNzd29yZCwgaGFzaCkudGhlbihyZXN1bHQgPT4ge1xuICAgICAgICAgICAgaWYgKHJlc3VsdClcbiAgICAgICAgICAgICAgLy8gcmVqZWN0IGlmIHRoZXJlIGlzIGEgbWF0Y2hcbiAgICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KCdSRVBFQVRfUEFTU1dPUkQnKTtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIHdhaXQgZm9yIGFsbCBjb21wYXJpc29ucyB0byBjb21wbGV0ZVxuICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwocHJvbWlzZXMpXG4gICAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLmNhdGNoKGVyciA9PiB7XG4gICAgICAgICAgICBpZiAoZXJyID09PSAnUkVQRUFUX1BBU1NXT1JEJylcbiAgICAgICAgICAgICAgLy8gYSBtYXRjaCB3YXMgZm91bmRcbiAgICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KFxuICAgICAgICAgICAgICAgIG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgICAgIFBhcnNlLkVycm9yLlZBTElEQVRJT05fRVJST1IsXG4gICAgICAgICAgICAgICAgICBgTmV3IHBhc3N3b3JkIHNob3VsZCBub3QgYmUgdGhlIHNhbWUgYXMgbGFzdCAke1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS5tYXhQYXNzd29yZEhpc3RvcnlcbiAgICAgICAgICAgICAgICAgIH0gcGFzc3dvcmRzLmBcbiAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgfVxuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG59O1xuXG5SZXN0V3JpdGUucHJvdG90eXBlLmNyZWF0ZVNlc3Npb25Ub2tlbklmTmVlZGVkID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLmNsYXNzTmFtZSAhPT0gJ19Vc2VyJykge1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodGhpcy5xdWVyeSkge1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoXG4gICAgIXRoaXMuc3RvcmFnZVsnYXV0aFByb3ZpZGVyJ10gJiYgLy8gc2lnbnVwIGNhbGwsIHdpdGhcbiAgICB0aGlzLmNvbmZpZy5wcmV2ZW50TG9naW5XaXRoVW52ZXJpZmllZEVtYWlsICYmIC8vIG5vIGxvZ2luIHdpdGhvdXQgdmVyaWZpY2F0aW9uXG4gICAgdGhpcy5jb25maWcudmVyaWZ5VXNlckVtYWlsc1xuICApIHtcbiAgICAvLyB2ZXJpZmljYXRpb24gaXMgb25cbiAgICByZXR1cm47IC8vIGRvIG5vdCBjcmVhdGUgdGhlIHNlc3Npb24gdG9rZW4gaW4gdGhhdCBjYXNlIVxuICB9XG4gIHJldHVybiB0aGlzLmNyZWF0ZVNlc3Npb25Ub2tlbigpO1xufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5jcmVhdGVTZXNzaW9uVG9rZW4gPSBmdW5jdGlvbigpIHtcbiAgLy8gY2xvdWQgaW5zdGFsbGF0aW9uSWQgZnJvbSBDbG91ZCBDb2RlLFxuICAvLyBuZXZlciBjcmVhdGUgc2Vzc2lvbiB0b2tlbnMgZnJvbSB0aGVyZS5cbiAgaWYgKHRoaXMuYXV0aC5pbnN0YWxsYXRpb25JZCAmJiB0aGlzLmF1dGguaW5zdGFsbGF0aW9uSWQgPT09ICdjbG91ZCcpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCB7IHNlc3Npb25EYXRhLCBjcmVhdGVTZXNzaW9uIH0gPSBBdXRoLmNyZWF0ZVNlc3Npb24odGhpcy5jb25maWcsIHtcbiAgICB1c2VySWQ6IHRoaXMub2JqZWN0SWQoKSxcbiAgICBjcmVhdGVkV2l0aDoge1xuICAgICAgYWN0aW9uOiB0aGlzLnN0b3JhZ2VbJ2F1dGhQcm92aWRlciddID8gJ2xvZ2luJyA6ICdzaWdudXAnLFxuICAgICAgYXV0aFByb3ZpZGVyOiB0aGlzLnN0b3JhZ2VbJ2F1dGhQcm92aWRlciddIHx8ICdwYXNzd29yZCcsXG4gICAgfSxcbiAgICBpbnN0YWxsYXRpb25JZDogdGhpcy5hdXRoLmluc3RhbGxhdGlvbklkLFxuICB9KTtcblxuICBpZiAodGhpcy5yZXNwb25zZSAmJiB0aGlzLnJlc3BvbnNlLnJlc3BvbnNlKSB7XG4gICAgdGhpcy5yZXNwb25zZS5yZXNwb25zZS5zZXNzaW9uVG9rZW4gPSBzZXNzaW9uRGF0YS5zZXNzaW9uVG9rZW47XG4gIH1cblxuICByZXR1cm4gY3JlYXRlU2Vzc2lvbigpO1xufTtcblxuLy8gRGVsZXRlIGVtYWlsIHJlc2V0IHRva2VucyBpZiB1c2VyIGlzIGNoYW5naW5nIHBhc3N3b3JkIG9yIGVtYWlsLlxuUmVzdFdyaXRlLnByb3RvdHlwZS5kZWxldGVFbWFpbFJlc2V0VG9rZW5JZk5lZWRlZCA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5jbGFzc05hbWUgIT09ICdfVXNlcicgfHwgdGhpcy5xdWVyeSA9PT0gbnVsbCkge1xuICAgIC8vIG51bGwgcXVlcnkgbWVhbnMgY3JlYXRlXG4gICAgcmV0dXJuO1xuICB9XG5cbiAgaWYgKCdwYXNzd29yZCcgaW4gdGhpcy5kYXRhIHx8ICdlbWFpbCcgaW4gdGhpcy5kYXRhKSB7XG4gICAgY29uc3QgYWRkT3BzID0ge1xuICAgICAgX3BlcmlzaGFibGVfdG9rZW46IHsgX19vcDogJ0RlbGV0ZScgfSxcbiAgICAgIF9wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQ6IHsgX19vcDogJ0RlbGV0ZScgfSxcbiAgICB9O1xuICAgIHRoaXMuZGF0YSA9IE9iamVjdC5hc3NpZ24odGhpcy5kYXRhLCBhZGRPcHMpO1xuICB9XG59O1xuXG5SZXN0V3JpdGUucHJvdG90eXBlLmRlc3Ryb3lEdXBsaWNhdGVkU2Vzc2lvbnMgPSBmdW5jdGlvbigpIHtcbiAgLy8gT25seSBmb3IgX1Nlc3Npb24sIGFuZCBhdCBjcmVhdGlvbiB0aW1lXG4gIGlmICh0aGlzLmNsYXNzTmFtZSAhPSAnX1Nlc3Npb24nIHx8IHRoaXMucXVlcnkpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gRGVzdHJveSB0aGUgc2Vzc2lvbnMgaW4gJ0JhY2tncm91bmQnXG4gIGNvbnN0IHsgdXNlciwgaW5zdGFsbGF0aW9uSWQsIHNlc3Npb25Ub2tlbiB9ID0gdGhpcy5kYXRhO1xuICBpZiAoIXVzZXIgfHwgIWluc3RhbGxhdGlvbklkKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghdXNlci5vYmplY3RJZCkge1xuICAgIHJldHVybjtcbiAgfVxuICB0aGlzLmNvbmZpZy5kYXRhYmFzZS5kZXN0cm95KCdfU2Vzc2lvbicsIHtcbiAgICB1c2VyLFxuICAgIGluc3RhbGxhdGlvbklkLFxuICAgIHNlc3Npb25Ub2tlbjogeyAkbmU6IHNlc3Npb25Ub2tlbiB9LFxuICB9KTtcbn07XG5cbi8vIEhhbmRsZXMgYW55IGZvbGxvd3VwIGxvZ2ljXG5SZXN0V3JpdGUucHJvdG90eXBlLmhhbmRsZUZvbGxvd3VwID0gZnVuY3Rpb24oKSB7XG4gIGlmIChcbiAgICB0aGlzLnN0b3JhZ2UgJiZcbiAgICB0aGlzLnN0b3JhZ2VbJ2NsZWFyU2Vzc2lvbnMnXSAmJlxuICAgIHRoaXMuY29uZmlnLnJldm9rZVNlc3Npb25PblBhc3N3b3JkUmVzZXRcbiAgKSB7XG4gICAgdmFyIHNlc3Npb25RdWVyeSA9IHtcbiAgICAgIHVzZXI6IHtcbiAgICAgICAgX190eXBlOiAnUG9pbnRlcicsXG4gICAgICAgIGNsYXNzTmFtZTogJ19Vc2VyJyxcbiAgICAgICAgb2JqZWN0SWQ6IHRoaXMub2JqZWN0SWQoKSxcbiAgICAgIH0sXG4gICAgfTtcbiAgICBkZWxldGUgdGhpcy5zdG9yYWdlWydjbGVhclNlc3Npb25zJ107XG4gICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlXG4gICAgICAuZGVzdHJveSgnX1Nlc3Npb24nLCBzZXNzaW9uUXVlcnkpXG4gICAgICAudGhlbih0aGlzLmhhbmRsZUZvbGxvd3VwLmJpbmQodGhpcykpO1xuICB9XG5cbiAgaWYgKHRoaXMuc3RvcmFnZSAmJiB0aGlzLnN0b3JhZ2VbJ2dlbmVyYXRlTmV3U2Vzc2lvbiddKSB7XG4gICAgZGVsZXRlIHRoaXMuc3RvcmFnZVsnZ2VuZXJhdGVOZXdTZXNzaW9uJ107XG4gICAgcmV0dXJuIHRoaXMuY3JlYXRlU2Vzc2lvblRva2VuKCkudGhlbih0aGlzLmhhbmRsZUZvbGxvd3VwLmJpbmQodGhpcykpO1xuICB9XG5cbiAgaWYgKHRoaXMuc3RvcmFnZSAmJiB0aGlzLnN0b3JhZ2VbJ3NlbmRWZXJpZmljYXRpb25FbWFpbCddKSB7XG4gICAgZGVsZXRlIHRoaXMuc3RvcmFnZVsnc2VuZFZlcmlmaWNhdGlvbkVtYWlsJ107XG4gICAgLy8gRmlyZSBhbmQgZm9yZ2V0IVxuICAgIHRoaXMuY29uZmlnLnVzZXJDb250cm9sbGVyLnNlbmRWZXJpZmljYXRpb25FbWFpbCh0aGlzLmRhdGEpO1xuICAgIHJldHVybiB0aGlzLmhhbmRsZUZvbGxvd3VwLmJpbmQodGhpcyk7XG4gIH1cbn07XG5cbi8vIEhhbmRsZXMgdGhlIF9TZXNzaW9uIGNsYXNzIHNwZWNpYWxuZXNzLlxuLy8gRG9lcyBub3RoaW5nIGlmIHRoaXMgaXNuJ3QgYW4gX1Nlc3Npb24gb2JqZWN0LlxuUmVzdFdyaXRlLnByb3RvdHlwZS5oYW5kbGVTZXNzaW9uID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLnJlc3BvbnNlIHx8IHRoaXMuY2xhc3NOYW1lICE9PSAnX1Nlc3Npb24nKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgaWYgKCF0aGlzLmF1dGgudXNlciAmJiAhdGhpcy5hdXRoLmlzTWFzdGVyKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9TRVNTSU9OX1RPS0VOLFxuICAgICAgJ1Nlc3Npb24gdG9rZW4gcmVxdWlyZWQuJ1xuICAgICk7XG4gIH1cblxuICAvLyBUT0RPOiBWZXJpZnkgcHJvcGVyIGVycm9yIHRvIHRocm93XG4gIGlmICh0aGlzLmRhdGEuQUNMKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSxcbiAgICAgICdDYW5ub3Qgc2V0ICcgKyAnQUNMIG9uIGEgU2Vzc2lvbi4nXG4gICAgKTtcbiAgfVxuXG4gIGlmICh0aGlzLnF1ZXJ5KSB7XG4gICAgaWYgKFxuICAgICAgdGhpcy5kYXRhLnVzZXIgJiZcbiAgICAgICF0aGlzLmF1dGguaXNNYXN0ZXIgJiZcbiAgICAgIHRoaXMuZGF0YS51c2VyLm9iamVjdElkICE9IHRoaXMuYXV0aC51c2VyLmlkXG4gICAgKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmRhdGEuaW5zdGFsbGF0aW9uSWQpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuZGF0YS5zZXNzaW9uVG9rZW4pIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FKTtcbiAgICB9XG4gIH1cblxuICBpZiAoIXRoaXMucXVlcnkgJiYgIXRoaXMuYXV0aC5pc01hc3Rlcikge1xuICAgIGNvbnN0IGFkZGl0aW9uYWxTZXNzaW9uRGF0YSA9IHt9O1xuICAgIGZvciAodmFyIGtleSBpbiB0aGlzLmRhdGEpIHtcbiAgICAgIGlmIChrZXkgPT09ICdvYmplY3RJZCcgfHwga2V5ID09PSAndXNlcicpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBhZGRpdGlvbmFsU2Vzc2lvbkRhdGFba2V5XSA9IHRoaXMuZGF0YVtrZXldO1xuICAgIH1cblxuICAgIGNvbnN0IHsgc2Vzc2lvbkRhdGEsIGNyZWF0ZVNlc3Npb24gfSA9IEF1dGguY3JlYXRlU2Vzc2lvbih0aGlzLmNvbmZpZywge1xuICAgICAgdXNlcklkOiB0aGlzLmF1dGgudXNlci5pZCxcbiAgICAgIGNyZWF0ZWRXaXRoOiB7XG4gICAgICAgIGFjdGlvbjogJ2NyZWF0ZScsXG4gICAgICB9LFxuICAgICAgYWRkaXRpb25hbFNlc3Npb25EYXRhLFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGNyZWF0ZVNlc3Npb24oKS50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgaWYgKCFyZXN1bHRzLnJlc3BvbnNlKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlRFUk5BTF9TRVJWRVJfRVJST1IsXG4gICAgICAgICAgJ0Vycm9yIGNyZWF0aW5nIHNlc3Npb24uJ1xuICAgICAgICApO1xuICAgICAgfVxuICAgICAgc2Vzc2lvbkRhdGFbJ29iamVjdElkJ10gPSByZXN1bHRzLnJlc3BvbnNlWydvYmplY3RJZCddO1xuICAgICAgdGhpcy5yZXNwb25zZSA9IHtcbiAgICAgICAgc3RhdHVzOiAyMDEsXG4gICAgICAgIGxvY2F0aW9uOiByZXN1bHRzLmxvY2F0aW9uLFxuICAgICAgICByZXNwb25zZTogc2Vzc2lvbkRhdGEsXG4gICAgICB9O1xuICAgIH0pO1xuICB9XG59O1xuXG4vLyBIYW5kbGVzIHRoZSBfSW5zdGFsbGF0aW9uIGNsYXNzIHNwZWNpYWxuZXNzLlxuLy8gRG9lcyBub3RoaW5nIGlmIHRoaXMgaXNuJ3QgYW4gaW5zdGFsbGF0aW9uIG9iamVjdC5cbi8vIElmIGFuIGluc3RhbGxhdGlvbiBpcyBmb3VuZCwgdGhpcyBjYW4gbXV0YXRlIHRoaXMucXVlcnkgYW5kIHR1cm4gYSBjcmVhdGVcbi8vIGludG8gYW4gdXBkYXRlLlxuLy8gUmV0dXJucyBhIHByb21pc2UgZm9yIHdoZW4gd2UncmUgZG9uZSBpZiBpdCBjYW4ndCBmaW5pc2ggdGhpcyB0aWNrLlxuUmVzdFdyaXRlLnByb3RvdHlwZS5oYW5kbGVJbnN0YWxsYXRpb24gPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMucmVzcG9uc2UgfHwgdGhpcy5jbGFzc05hbWUgIT09ICdfSW5zdGFsbGF0aW9uJykge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmIChcbiAgICAhdGhpcy5xdWVyeSAmJlxuICAgICF0aGlzLmRhdGEuZGV2aWNlVG9rZW4gJiZcbiAgICAhdGhpcy5kYXRhLmluc3RhbGxhdGlvbklkICYmXG4gICAgIXRoaXMuYXV0aC5pbnN0YWxsYXRpb25JZFxuICApIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAxMzUsXG4gICAgICAnYXQgbGVhc3Qgb25lIElEIGZpZWxkIChkZXZpY2VUb2tlbiwgaW5zdGFsbGF0aW9uSWQpICcgK1xuICAgICAgICAnbXVzdCBiZSBzcGVjaWZpZWQgaW4gdGhpcyBvcGVyYXRpb24nXG4gICAgKTtcbiAgfVxuXG4gIC8vIElmIHRoZSBkZXZpY2UgdG9rZW4gaXMgNjQgY2hhcmFjdGVycyBsb25nLCB3ZSBhc3N1bWUgaXQgaXMgZm9yIGlPU1xuICAvLyBhbmQgbG93ZXJjYXNlIGl0LlxuICBpZiAodGhpcy5kYXRhLmRldmljZVRva2VuICYmIHRoaXMuZGF0YS5kZXZpY2VUb2tlbi5sZW5ndGggPT0gNjQpIHtcbiAgICB0aGlzLmRhdGEuZGV2aWNlVG9rZW4gPSB0aGlzLmRhdGEuZGV2aWNlVG9rZW4udG9Mb3dlckNhc2UoKTtcbiAgfVxuXG4gIC8vIFdlIGxvd2VyY2FzZSB0aGUgaW5zdGFsbGF0aW9uSWQgaWYgcHJlc2VudFxuICBpZiAodGhpcy5kYXRhLmluc3RhbGxhdGlvbklkKSB7XG4gICAgdGhpcy5kYXRhLmluc3RhbGxhdGlvbklkID0gdGhpcy5kYXRhLmluc3RhbGxhdGlvbklkLnRvTG93ZXJDYXNlKCk7XG4gIH1cblxuICBsZXQgaW5zdGFsbGF0aW9uSWQgPSB0aGlzLmRhdGEuaW5zdGFsbGF0aW9uSWQ7XG5cbiAgLy8gSWYgZGF0YS5pbnN0YWxsYXRpb25JZCBpcyBub3Qgc2V0IGFuZCB3ZSdyZSBub3QgbWFzdGVyLCB3ZSBjYW4gbG9va3VwIGluIGF1dGhcbiAgaWYgKCFpbnN0YWxsYXRpb25JZCAmJiAhdGhpcy5hdXRoLmlzTWFzdGVyKSB7XG4gICAgaW5zdGFsbGF0aW9uSWQgPSB0aGlzLmF1dGguaW5zdGFsbGF0aW9uSWQ7XG4gIH1cblxuICBpZiAoaW5zdGFsbGF0aW9uSWQpIHtcbiAgICBpbnN0YWxsYXRpb25JZCA9IGluc3RhbGxhdGlvbklkLnRvTG93ZXJDYXNlKCk7XG4gIH1cblxuICAvLyBVcGRhdGluZyBfSW5zdGFsbGF0aW9uIGJ1dCBub3QgdXBkYXRpbmcgYW55dGhpbmcgY3JpdGljYWxcbiAgaWYgKFxuICAgIHRoaXMucXVlcnkgJiZcbiAgICAhdGhpcy5kYXRhLmRldmljZVRva2VuICYmXG4gICAgIWluc3RhbGxhdGlvbklkICYmXG4gICAgIXRoaXMuZGF0YS5kZXZpY2VUeXBlXG4gICkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHZhciBwcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG5cbiAgdmFyIGlkTWF0Y2g7IC8vIFdpbGwgYmUgYSBtYXRjaCBvbiBlaXRoZXIgb2JqZWN0SWQgb3IgaW5zdGFsbGF0aW9uSWRcbiAgdmFyIG9iamVjdElkTWF0Y2g7XG4gIHZhciBpbnN0YWxsYXRpb25JZE1hdGNoO1xuICB2YXIgZGV2aWNlVG9rZW5NYXRjaGVzID0gW107XG5cbiAgLy8gSW5zdGVhZCBvZiBpc3N1aW5nIDMgcmVhZHMsIGxldCdzIGRvIGl0IHdpdGggb25lIE9SLlxuICBjb25zdCBvclF1ZXJpZXMgPSBbXTtcbiAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5xdWVyeS5vYmplY3RJZCkge1xuICAgIG9yUXVlcmllcy5wdXNoKHtcbiAgICAgIG9iamVjdElkOiB0aGlzLnF1ZXJ5Lm9iamVjdElkLFxuICAgIH0pO1xuICB9XG4gIGlmIChpbnN0YWxsYXRpb25JZCkge1xuICAgIG9yUXVlcmllcy5wdXNoKHtcbiAgICAgIGluc3RhbGxhdGlvbklkOiBpbnN0YWxsYXRpb25JZCxcbiAgICB9KTtcbiAgfVxuICBpZiAodGhpcy5kYXRhLmRldmljZVRva2VuKSB7XG4gICAgb3JRdWVyaWVzLnB1c2goeyBkZXZpY2VUb2tlbjogdGhpcy5kYXRhLmRldmljZVRva2VuIH0pO1xuICB9XG5cbiAgaWYgKG9yUXVlcmllcy5sZW5ndGggPT0gMCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHByb21pc2UgPSBwcm9taXNlXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlLmZpbmQoXG4gICAgICAgICdfSW5zdGFsbGF0aW9uJyxcbiAgICAgICAge1xuICAgICAgICAgICRvcjogb3JRdWVyaWVzLFxuICAgICAgICB9LFxuICAgICAgICB7fVxuICAgICAgKTtcbiAgICB9KVxuICAgIC50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgcmVzdWx0cy5mb3JFYWNoKHJlc3VsdCA9PiB7XG4gICAgICAgIGlmIChcbiAgICAgICAgICB0aGlzLnF1ZXJ5ICYmXG4gICAgICAgICAgdGhpcy5xdWVyeS5vYmplY3RJZCAmJlxuICAgICAgICAgIHJlc3VsdC5vYmplY3RJZCA9PSB0aGlzLnF1ZXJ5Lm9iamVjdElkXG4gICAgICAgICkge1xuICAgICAgICAgIG9iamVjdElkTWF0Y2ggPSByZXN1bHQ7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlc3VsdC5pbnN0YWxsYXRpb25JZCA9PSBpbnN0YWxsYXRpb25JZCkge1xuICAgICAgICAgIGluc3RhbGxhdGlvbklkTWF0Y2ggPSByZXN1bHQ7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlc3VsdC5kZXZpY2VUb2tlbiA9PSB0aGlzLmRhdGEuZGV2aWNlVG9rZW4pIHtcbiAgICAgICAgICBkZXZpY2VUb2tlbk1hdGNoZXMucHVzaChyZXN1bHQpO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgLy8gU2FuaXR5IGNoZWNrcyB3aGVuIHJ1bm5pbmcgYSBxdWVyeVxuICAgICAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5xdWVyeS5vYmplY3RJZCkge1xuICAgICAgICBpZiAoIW9iamVjdElkTWF0Y2gpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5ELFxuICAgICAgICAgICAgJ09iamVjdCBub3QgZm91bmQgZm9yIHVwZGF0ZS4nXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoXG4gICAgICAgICAgdGhpcy5kYXRhLmluc3RhbGxhdGlvbklkICYmXG4gICAgICAgICAgb2JqZWN0SWRNYXRjaC5pbnN0YWxsYXRpb25JZCAmJlxuICAgICAgICAgIHRoaXMuZGF0YS5pbnN0YWxsYXRpb25JZCAhPT0gb2JqZWN0SWRNYXRjaC5pbnN0YWxsYXRpb25JZFxuICAgICAgICApIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAxMzYsXG4gICAgICAgICAgICAnaW5zdGFsbGF0aW9uSWQgbWF5IG5vdCBiZSBjaGFuZ2VkIGluIHRoaXMgJyArICdvcGVyYXRpb24nXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoXG4gICAgICAgICAgdGhpcy5kYXRhLmRldmljZVRva2VuICYmXG4gICAgICAgICAgb2JqZWN0SWRNYXRjaC5kZXZpY2VUb2tlbiAmJlxuICAgICAgICAgIHRoaXMuZGF0YS5kZXZpY2VUb2tlbiAhPT0gb2JqZWN0SWRNYXRjaC5kZXZpY2VUb2tlbiAmJlxuICAgICAgICAgICF0aGlzLmRhdGEuaW5zdGFsbGF0aW9uSWQgJiZcbiAgICAgICAgICAhb2JqZWN0SWRNYXRjaC5pbnN0YWxsYXRpb25JZFxuICAgICAgICApIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAxMzYsXG4gICAgICAgICAgICAnZGV2aWNlVG9rZW4gbWF5IG5vdCBiZSBjaGFuZ2VkIGluIHRoaXMgJyArICdvcGVyYXRpb24nXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoXG4gICAgICAgICAgdGhpcy5kYXRhLmRldmljZVR5cGUgJiZcbiAgICAgICAgICB0aGlzLmRhdGEuZGV2aWNlVHlwZSAmJlxuICAgICAgICAgIHRoaXMuZGF0YS5kZXZpY2VUeXBlICE9PSBvYmplY3RJZE1hdGNoLmRldmljZVR5cGVcbiAgICAgICAgKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgMTM2LFxuICAgICAgICAgICAgJ2RldmljZVR5cGUgbWF5IG5vdCBiZSBjaGFuZ2VkIGluIHRoaXMgJyArICdvcGVyYXRpb24nXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5xdWVyeSAmJiB0aGlzLnF1ZXJ5Lm9iamVjdElkICYmIG9iamVjdElkTWF0Y2gpIHtcbiAgICAgICAgaWRNYXRjaCA9IG9iamVjdElkTWF0Y2g7XG4gICAgICB9XG5cbiAgICAgIGlmIChpbnN0YWxsYXRpb25JZCAmJiBpbnN0YWxsYXRpb25JZE1hdGNoKSB7XG4gICAgICAgIGlkTWF0Y2ggPSBpbnN0YWxsYXRpb25JZE1hdGNoO1xuICAgICAgfVxuICAgICAgLy8gbmVlZCB0byBzcGVjaWZ5IGRldmljZVR5cGUgb25seSBpZiBpdCdzIG5ld1xuICAgICAgaWYgKCF0aGlzLnF1ZXJ5ICYmICF0aGlzLmRhdGEuZGV2aWNlVHlwZSAmJiAhaWRNYXRjaCkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgMTM1LFxuICAgICAgICAgICdkZXZpY2VUeXBlIG11c3QgYmUgc3BlY2lmaWVkIGluIHRoaXMgb3BlcmF0aW9uJ1xuICAgICAgICApO1xuICAgICAgfVxuICAgIH0pXG4gICAgLnRoZW4oKCkgPT4ge1xuICAgICAgaWYgKCFpZE1hdGNoKSB7XG4gICAgICAgIGlmICghZGV2aWNlVG9rZW5NYXRjaGVzLmxlbmd0aCkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfSBlbHNlIGlmIChcbiAgICAgICAgICBkZXZpY2VUb2tlbk1hdGNoZXMubGVuZ3RoID09IDEgJiZcbiAgICAgICAgICAoIWRldmljZVRva2VuTWF0Y2hlc1swXVsnaW5zdGFsbGF0aW9uSWQnXSB8fCAhaW5zdGFsbGF0aW9uSWQpXG4gICAgICAgICkge1xuICAgICAgICAgIC8vIFNpbmdsZSBtYXRjaCBvbiBkZXZpY2UgdG9rZW4gYnV0IG5vbmUgb24gaW5zdGFsbGF0aW9uSWQsIGFuZCBlaXRoZXJcbiAgICAgICAgICAvLyB0aGUgcGFzc2VkIG9iamVjdCBvciB0aGUgbWF0Y2ggaXMgbWlzc2luZyBhbiBpbnN0YWxsYXRpb25JZCwgc28gd2VcbiAgICAgICAgICAvLyBjYW4ganVzdCByZXR1cm4gdGhlIG1hdGNoLlxuICAgICAgICAgIHJldHVybiBkZXZpY2VUb2tlbk1hdGNoZXNbMF1bJ29iamVjdElkJ107XG4gICAgICAgIH0gZWxzZSBpZiAoIXRoaXMuZGF0YS5pbnN0YWxsYXRpb25JZCkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIDEzMixcbiAgICAgICAgICAgICdNdXN0IHNwZWNpZnkgaW5zdGFsbGF0aW9uSWQgd2hlbiBkZXZpY2VUb2tlbiAnICtcbiAgICAgICAgICAgICAgJ21hdGNoZXMgbXVsdGlwbGUgSW5zdGFsbGF0aW9uIG9iamVjdHMnXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBNdWx0aXBsZSBkZXZpY2UgdG9rZW4gbWF0Y2hlcyBhbmQgd2Ugc3BlY2lmaWVkIGFuIGluc3RhbGxhdGlvbiBJRCxcbiAgICAgICAgICAvLyBvciBhIHNpbmdsZSBtYXRjaCB3aGVyZSBib3RoIHRoZSBwYXNzZWQgYW5kIG1hdGNoaW5nIG9iamVjdHMgaGF2ZVxuICAgICAgICAgIC8vIGFuIGluc3RhbGxhdGlvbiBJRC4gVHJ5IGNsZWFuaW5nIG91dCBvbGQgaW5zdGFsbGF0aW9ucyB0aGF0IG1hdGNoXG4gICAgICAgICAgLy8gdGhlIGRldmljZVRva2VuLCBhbmQgcmV0dXJuIG5pbCB0byBzaWduYWwgdGhhdCBhIG5ldyBvYmplY3Qgc2hvdWxkXG4gICAgICAgICAgLy8gYmUgY3JlYXRlZC5cbiAgICAgICAgICB2YXIgZGVsUXVlcnkgPSB7XG4gICAgICAgICAgICBkZXZpY2VUb2tlbjogdGhpcy5kYXRhLmRldmljZVRva2VuLFxuICAgICAgICAgICAgaW5zdGFsbGF0aW9uSWQ6IHtcbiAgICAgICAgICAgICAgJG5lOiBpbnN0YWxsYXRpb25JZCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfTtcbiAgICAgICAgICBpZiAodGhpcy5kYXRhLmFwcElkZW50aWZpZXIpIHtcbiAgICAgICAgICAgIGRlbFF1ZXJ5WydhcHBJZGVudGlmaWVyJ10gPSB0aGlzLmRhdGEuYXBwSWRlbnRpZmllcjtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpcy5jb25maWcuZGF0YWJhc2UuZGVzdHJveSgnX0luc3RhbGxhdGlvbicsIGRlbFF1ZXJ5KS5jYXRjaChlcnIgPT4ge1xuICAgICAgICAgICAgaWYgKGVyci5jb2RlID09IFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQpIHtcbiAgICAgICAgICAgICAgLy8gbm8gZGVsZXRpb25zIHdlcmUgbWFkZS4gQ2FuIGJlIGlnbm9yZWQuXG4gICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIHJldGhyb3cgdGhlIGVycm9yXG4gICAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAoXG4gICAgICAgICAgZGV2aWNlVG9rZW5NYXRjaGVzLmxlbmd0aCA9PSAxICYmXG4gICAgICAgICAgIWRldmljZVRva2VuTWF0Y2hlc1swXVsnaW5zdGFsbGF0aW9uSWQnXVxuICAgICAgICApIHtcbiAgICAgICAgICAvLyBFeGFjdGx5IG9uZSBkZXZpY2UgdG9rZW4gbWF0Y2ggYW5kIGl0IGRvZXNuJ3QgaGF2ZSBhbiBpbnN0YWxsYXRpb25cbiAgICAgICAgICAvLyBJRC4gVGhpcyBpcyB0aGUgb25lIGNhc2Ugd2hlcmUgd2Ugd2FudCB0byBtZXJnZSB3aXRoIHRoZSBleGlzdGluZ1xuICAgICAgICAgIC8vIG9iamVjdC5cbiAgICAgICAgICBjb25zdCBkZWxRdWVyeSA9IHsgb2JqZWN0SWQ6IGlkTWF0Y2gub2JqZWN0SWQgfTtcbiAgICAgICAgICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2VcbiAgICAgICAgICAgIC5kZXN0cm95KCdfSW5zdGFsbGF0aW9uJywgZGVsUXVlcnkpXG4gICAgICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgIHJldHVybiBkZXZpY2VUb2tlbk1hdGNoZXNbMF1bJ29iamVjdElkJ107XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLmNhdGNoKGVyciA9PiB7XG4gICAgICAgICAgICAgIGlmIChlcnIuY29kZSA9PSBQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5EKSB7XG4gICAgICAgICAgICAgICAgLy8gbm8gZGVsZXRpb25zIHdlcmUgbWFkZS4gQ2FuIGJlIGlnbm9yZWRcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgLy8gcmV0aHJvdyB0aGUgZXJyb3JcbiAgICAgICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaWYgKFxuICAgICAgICAgICAgdGhpcy5kYXRhLmRldmljZVRva2VuICYmXG4gICAgICAgICAgICBpZE1hdGNoLmRldmljZVRva2VuICE9IHRoaXMuZGF0YS5kZXZpY2VUb2tlblxuICAgICAgICAgICkge1xuICAgICAgICAgICAgLy8gV2UncmUgc2V0dGluZyB0aGUgZGV2aWNlIHRva2VuIG9uIGFuIGV4aXN0aW5nIGluc3RhbGxhdGlvbiwgc29cbiAgICAgICAgICAgIC8vIHdlIHNob3VsZCB0cnkgY2xlYW5pbmcgb3V0IG9sZCBpbnN0YWxsYXRpb25zIHRoYXQgbWF0Y2ggdGhpc1xuICAgICAgICAgICAgLy8gZGV2aWNlIHRva2VuLlxuICAgICAgICAgICAgY29uc3QgZGVsUXVlcnkgPSB7XG4gICAgICAgICAgICAgIGRldmljZVRva2VuOiB0aGlzLmRhdGEuZGV2aWNlVG9rZW4sXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgLy8gV2UgaGF2ZSBhIHVuaXF1ZSBpbnN0YWxsIElkLCB1c2UgdGhhdCB0byBwcmVzZXJ2ZVxuICAgICAgICAgICAgLy8gdGhlIGludGVyZXN0aW5nIGluc3RhbGxhdGlvblxuICAgICAgICAgICAgaWYgKHRoaXMuZGF0YS5pbnN0YWxsYXRpb25JZCkge1xuICAgICAgICAgICAgICBkZWxRdWVyeVsnaW5zdGFsbGF0aW9uSWQnXSA9IHtcbiAgICAgICAgICAgICAgICAkbmU6IHRoaXMuZGF0YS5pbnN0YWxsYXRpb25JZCxcbiAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoXG4gICAgICAgICAgICAgIGlkTWF0Y2gub2JqZWN0SWQgJiZcbiAgICAgICAgICAgICAgdGhpcy5kYXRhLm9iamVjdElkICYmXG4gICAgICAgICAgICAgIGlkTWF0Y2gub2JqZWN0SWQgPT0gdGhpcy5kYXRhLm9iamVjdElkXG4gICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgLy8gd2UgcGFzc2VkIGFuIG9iamVjdElkLCBwcmVzZXJ2ZSB0aGF0IGluc3RhbGF0aW9uXG4gICAgICAgICAgICAgIGRlbFF1ZXJ5WydvYmplY3RJZCddID0ge1xuICAgICAgICAgICAgICAgICRuZTogaWRNYXRjaC5vYmplY3RJZCxcbiAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIC8vIFdoYXQgdG8gZG8gaGVyZT8gY2FuJ3QgcmVhbGx5IGNsZWFuIHVwIGV2ZXJ5dGhpbmcuLi5cbiAgICAgICAgICAgICAgcmV0dXJuIGlkTWF0Y2gub2JqZWN0SWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodGhpcy5kYXRhLmFwcElkZW50aWZpZXIpIHtcbiAgICAgICAgICAgICAgZGVsUXVlcnlbJ2FwcElkZW50aWZpZXInXSA9IHRoaXMuZGF0YS5hcHBJZGVudGlmaWVyO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5jb25maWcuZGF0YWJhc2VcbiAgICAgICAgICAgICAgLmRlc3Ryb3koJ19JbnN0YWxsYXRpb24nLCBkZWxRdWVyeSlcbiAgICAgICAgICAgICAgLmNhdGNoKGVyciA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKGVyci5jb2RlID09IFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQpIHtcbiAgICAgICAgICAgICAgICAgIC8vIG5vIGRlbGV0aW9ucyB3ZXJlIG1hZGUuIENhbiBiZSBpZ25vcmVkLlxuICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAvLyByZXRocm93IHRoZSBlcnJvclxuICAgICAgICAgICAgICAgIHRocm93IGVycjtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIEluIG5vbi1tZXJnZSBzY2VuYXJpb3MsIGp1c3QgcmV0dXJuIHRoZSBpbnN0YWxsYXRpb24gbWF0Y2ggaWRcbiAgICAgICAgICByZXR1cm4gaWRNYXRjaC5vYmplY3RJZDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pXG4gICAgLnRoZW4ob2JqSWQgPT4ge1xuICAgICAgaWYgKG9iaklkKSB7XG4gICAgICAgIHRoaXMucXVlcnkgPSB7IG9iamVjdElkOiBvYmpJZCB9O1xuICAgICAgICBkZWxldGUgdGhpcy5kYXRhLm9iamVjdElkO1xuICAgICAgICBkZWxldGUgdGhpcy5kYXRhLmNyZWF0ZWRBdDtcbiAgICAgIH1cbiAgICAgIC8vIFRPRE86IFZhbGlkYXRlIG9wcyAoYWRkL3JlbW92ZSBvbiBjaGFubmVscywgJGluYyBvbiBiYWRnZSwgZXRjLilcbiAgICB9KTtcbiAgcmV0dXJuIHByb21pc2U7XG59O1xuXG4vLyBJZiB3ZSBzaG9ydC1jaXJjdXRlZCB0aGUgb2JqZWN0IHJlc3BvbnNlIC0gdGhlbiB3ZSBuZWVkIHRvIG1ha2Ugc3VyZSB3ZSBleHBhbmQgYWxsIHRoZSBmaWxlcyxcbi8vIHNpbmNlIHRoaXMgbWlnaHQgbm90IGhhdmUgYSBxdWVyeSwgbWVhbmluZyBpdCB3b24ndCByZXR1cm4gdGhlIGZ1bGwgcmVzdWx0IGJhY2suXG4vLyBUT0RPOiAobmx1dHNlbmtvKSBUaGlzIHNob3VsZCBkaWUgd2hlbiB3ZSBtb3ZlIHRvIHBlci1jbGFzcyBiYXNlZCBjb250cm9sbGVycyBvbiBfU2Vzc2lvbi9fVXNlclxuUmVzdFdyaXRlLnByb3RvdHlwZS5leHBhbmRGaWxlc0ZvckV4aXN0aW5nT2JqZWN0cyA9IGZ1bmN0aW9uKCkge1xuICAvLyBDaGVjayB3aGV0aGVyIHdlIGhhdmUgYSBzaG9ydC1jaXJjdWl0ZWQgcmVzcG9uc2UgLSBvbmx5IHRoZW4gcnVuIGV4cGFuc2lvbi5cbiAgaWYgKHRoaXMucmVzcG9uc2UgJiYgdGhpcy5yZXNwb25zZS5yZXNwb25zZSkge1xuICAgIHRoaXMuY29uZmlnLmZpbGVzQ29udHJvbGxlci5leHBhbmRGaWxlc0luT2JqZWN0KFxuICAgICAgdGhpcy5jb25maWcsXG4gICAgICB0aGlzLnJlc3BvbnNlLnJlc3BvbnNlXG4gICAgKTtcbiAgfVxufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5ydW5EYXRhYmFzZU9wZXJhdGlvbiA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5yZXNwb25zZSkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmICh0aGlzLmNsYXNzTmFtZSA9PT0gJ19Sb2xlJykge1xuICAgIHRoaXMuY29uZmlnLmNhY2hlQ29udHJvbGxlci5yb2xlLmNsZWFyKCk7XG4gIH1cblxuICBpZiAoXG4gICAgdGhpcy5jbGFzc05hbWUgPT09ICdfVXNlcicgJiZcbiAgICB0aGlzLnF1ZXJ5ICYmXG4gICAgdGhpcy5hdXRoLmlzVW5hdXRoZW50aWNhdGVkKClcbiAgKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgUGFyc2UuRXJyb3IuU0VTU0lPTl9NSVNTSU5HLFxuICAgICAgYENhbm5vdCBtb2RpZnkgdXNlciAke3RoaXMucXVlcnkub2JqZWN0SWR9LmBcbiAgICApO1xuICB9XG5cbiAgaWYgKHRoaXMuY2xhc3NOYW1lID09PSAnX1Byb2R1Y3QnICYmIHRoaXMuZGF0YS5kb3dubG9hZCkge1xuICAgIHRoaXMuZGF0YS5kb3dubG9hZE5hbWUgPSB0aGlzLmRhdGEuZG93bmxvYWQubmFtZTtcbiAgfVxuXG4gIC8vIFRPRE86IEFkZCBiZXR0ZXIgZGV0ZWN0aW9uIGZvciBBQ0wsIGVuc3VyaW5nIGEgdXNlciBjYW4ndCBiZSBsb2NrZWQgZnJvbVxuICAvLyAgICAgICB0aGVpciBvd24gdXNlciByZWNvcmQuXG4gIGlmICh0aGlzLmRhdGEuQUNMICYmIHRoaXMuZGF0YS5BQ0xbJyp1bnJlc29sdmVkJ10pIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9BQ0wsICdJbnZhbGlkIEFDTC4nKTtcbiAgfVxuXG4gIGlmICh0aGlzLnF1ZXJ5KSB7XG4gICAgLy8gRm9yY2UgdGhlIHVzZXIgdG8gbm90IGxvY2tvdXRcbiAgICAvLyBNYXRjaGVkIHdpdGggcGFyc2UuY29tXG4gICAgaWYgKFxuICAgICAgdGhpcy5jbGFzc05hbWUgPT09ICdfVXNlcicgJiZcbiAgICAgIHRoaXMuZGF0YS5BQ0wgJiZcbiAgICAgIHRoaXMuYXV0aC5pc01hc3RlciAhPT0gdHJ1ZVxuICAgICkge1xuICAgICAgdGhpcy5kYXRhLkFDTFt0aGlzLnF1ZXJ5Lm9iamVjdElkXSA9IHsgcmVhZDogdHJ1ZSwgd3JpdGU6IHRydWUgfTtcbiAgICB9XG4gICAgLy8gdXBkYXRlIHBhc3N3b3JkIHRpbWVzdGFtcCBpZiB1c2VyIHBhc3N3b3JkIGlzIGJlaW5nIGNoYW5nZWRcbiAgICBpZiAoXG4gICAgICB0aGlzLmNsYXNzTmFtZSA9PT0gJ19Vc2VyJyAmJlxuICAgICAgdGhpcy5kYXRhLl9oYXNoZWRfcGFzc3dvcmQgJiZcbiAgICAgIHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5ICYmXG4gICAgICB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS5tYXhQYXNzd29yZEFnZVxuICAgICkge1xuICAgICAgdGhpcy5kYXRhLl9wYXNzd29yZF9jaGFuZ2VkX2F0ID0gUGFyc2UuX2VuY29kZShuZXcgRGF0ZSgpKTtcbiAgICB9XG4gICAgLy8gSWdub3JlIGNyZWF0ZWRBdCB3aGVuIHVwZGF0ZVxuICAgIGRlbGV0ZSB0aGlzLmRhdGEuY3JlYXRlZEF0O1xuXG4gICAgbGV0IGRlZmVyID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgLy8gaWYgcGFzc3dvcmQgaGlzdG9yeSBpcyBlbmFibGVkIHRoZW4gc2F2ZSB0aGUgY3VycmVudCBwYXNzd29yZCB0byBoaXN0b3J5XG4gICAgaWYgKFxuICAgICAgdGhpcy5jbGFzc05hbWUgPT09ICdfVXNlcicgJiZcbiAgICAgIHRoaXMuZGF0YS5faGFzaGVkX3Bhc3N3b3JkICYmXG4gICAgICB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeSAmJlxuICAgICAgdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRIaXN0b3J5XG4gICAgKSB7XG4gICAgICBkZWZlciA9IHRoaXMuY29uZmlnLmRhdGFiYXNlXG4gICAgICAgIC5maW5kKFxuICAgICAgICAgICdfVXNlcicsXG4gICAgICAgICAgeyBvYmplY3RJZDogdGhpcy5vYmplY3RJZCgpIH0sXG4gICAgICAgICAgeyBrZXlzOiBbJ19wYXNzd29yZF9oaXN0b3J5JywgJ19oYXNoZWRfcGFzc3dvcmQnXSB9XG4gICAgICAgIClcbiAgICAgICAgLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICAgICAgaWYgKHJlc3VsdHMubGVuZ3RoICE9IDEpIHtcbiAgICAgICAgICAgIHRocm93IHVuZGVmaW5lZDtcbiAgICAgICAgICB9XG4gICAgICAgICAgY29uc3QgdXNlciA9IHJlc3VsdHNbMF07XG4gICAgICAgICAgbGV0IG9sZFBhc3N3b3JkcyA9IFtdO1xuICAgICAgICAgIGlmICh1c2VyLl9wYXNzd29yZF9oaXN0b3J5KSB7XG4gICAgICAgICAgICBvbGRQYXNzd29yZHMgPSBfLnRha2UoXG4gICAgICAgICAgICAgIHVzZXIuX3Bhc3N3b3JkX2hpc3RvcnksXG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5Lm1heFBhc3N3b3JkSGlzdG9yeVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy9uLTEgcGFzc3dvcmRzIGdvIGludG8gaGlzdG9yeSBpbmNsdWRpbmcgbGFzdCBwYXNzd29yZFxuICAgICAgICAgIHdoaWxlIChcbiAgICAgICAgICAgIG9sZFBhc3N3b3Jkcy5sZW5ndGggPlxuICAgICAgICAgICAgTWF0aC5tYXgoMCwgdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRIaXN0b3J5IC0gMilcbiAgICAgICAgICApIHtcbiAgICAgICAgICAgIG9sZFBhc3N3b3Jkcy5zaGlmdCgpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBvbGRQYXNzd29yZHMucHVzaCh1c2VyLnBhc3N3b3JkKTtcbiAgICAgICAgICB0aGlzLmRhdGEuX3Bhc3N3b3JkX2hpc3RvcnkgPSBvbGRQYXNzd29yZHM7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBkZWZlci50aGVuKCgpID0+IHtcbiAgICAgIC8vIFJ1biBhbiB1cGRhdGVcbiAgICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZVxuICAgICAgICAudXBkYXRlKHRoaXMuY2xhc3NOYW1lLCB0aGlzLnF1ZXJ5LCB0aGlzLmRhdGEsIHRoaXMucnVuT3B0aW9ucylcbiAgICAgICAgLnRoZW4ocmVzcG9uc2UgPT4ge1xuICAgICAgICAgIHJlc3BvbnNlLnVwZGF0ZWRBdCA9IHRoaXMudXBkYXRlZEF0O1xuICAgICAgICAgIHRoaXMuX3VwZGF0ZVJlc3BvbnNlV2l0aERhdGEocmVzcG9uc2UsIHRoaXMuZGF0YSk7XG4gICAgICAgICAgdGhpcy5yZXNwb25zZSA9IHsgcmVzcG9uc2UgfTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgLy8gU2V0IHRoZSBkZWZhdWx0IEFDTCBhbmQgcGFzc3dvcmQgdGltZXN0YW1wIGZvciB0aGUgbmV3IF9Vc2VyXG4gICAgaWYgKHRoaXMuY2xhc3NOYW1lID09PSAnX1VzZXInKSB7XG4gICAgICB2YXIgQUNMID0gdGhpcy5kYXRhLkFDTDtcbiAgICAgIC8vIGRlZmF1bHQgcHVibGljIHIvdyBBQ0xcbiAgICAgIGlmICghQUNMKSB7XG4gICAgICAgIEFDTCA9IHt9O1xuICAgICAgICBBQ0xbJyonXSA9IHsgcmVhZDogdHJ1ZSwgd3JpdGU6IGZhbHNlIH07XG4gICAgICB9XG4gICAgICAvLyBtYWtlIHN1cmUgdGhlIHVzZXIgaXMgbm90IGxvY2tlZCBkb3duXG4gICAgICBBQ0xbdGhpcy5kYXRhLm9iamVjdElkXSA9IHsgcmVhZDogdHJ1ZSwgd3JpdGU6IHRydWUgfTtcbiAgICAgIHRoaXMuZGF0YS5BQ0wgPSBBQ0w7XG4gICAgICAvLyBwYXNzd29yZCB0aW1lc3RhbXAgdG8gYmUgdXNlZCB3aGVuIHBhc3N3b3JkIGV4cGlyeSBwb2xpY3kgaXMgZW5mb3JjZWRcbiAgICAgIGlmIChcbiAgICAgICAgdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kgJiZcbiAgICAgICAgdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRBZ2VcbiAgICAgICkge1xuICAgICAgICB0aGlzLmRhdGEuX3Bhc3N3b3JkX2NoYW5nZWRfYXQgPSBQYXJzZS5fZW5jb2RlKG5ldyBEYXRlKCkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFJ1biBhIGNyZWF0ZVxuICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZVxuICAgICAgLmNyZWF0ZSh0aGlzLmNsYXNzTmFtZSwgdGhpcy5kYXRhLCB0aGlzLnJ1bk9wdGlvbnMpXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoXG4gICAgICAgICAgdGhpcy5jbGFzc05hbWUgIT09ICdfVXNlcicgfHxcbiAgICAgICAgICBlcnJvci5jb2RlICE9PSBQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUVcbiAgICAgICAgKSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBRdWljayBjaGVjaywgaWYgd2Ugd2VyZSBhYmxlIHRvIGluZmVyIHRoZSBkdXBsaWNhdGVkIGZpZWxkIG5hbWVcbiAgICAgICAgaWYgKFxuICAgICAgICAgIGVycm9yICYmXG4gICAgICAgICAgZXJyb3IudXNlckluZm8gJiZcbiAgICAgICAgICBlcnJvci51c2VySW5mby5kdXBsaWNhdGVkX2ZpZWxkID09PSAndXNlcm5hbWUnXG4gICAgICAgICkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLlVTRVJOQU1FX1RBS0VOLFxuICAgICAgICAgICAgJ0FjY291bnQgYWxyZWFkeSBleGlzdHMgZm9yIHRoaXMgdXNlcm5hbWUuJ1xuICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoXG4gICAgICAgICAgZXJyb3IgJiZcbiAgICAgICAgICBlcnJvci51c2VySW5mbyAmJlxuICAgICAgICAgIGVycm9yLnVzZXJJbmZvLmR1cGxpY2F0ZWRfZmllbGQgPT09ICdlbWFpbCdcbiAgICAgICAgKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuRU1BSUxfVEFLRU4sXG4gICAgICAgICAgICAnQWNjb3VudCBhbHJlYWR5IGV4aXN0cyBmb3IgdGhpcyBlbWFpbCBhZGRyZXNzLidcbiAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gSWYgdGhpcyB3YXMgYSBmYWlsZWQgdXNlciBjcmVhdGlvbiBkdWUgdG8gdXNlcm5hbWUgb3IgZW1haWwgYWxyZWFkeSB0YWtlbiwgd2UgbmVlZCB0b1xuICAgICAgICAvLyBjaGVjayB3aGV0aGVyIGl0IHdhcyB1c2VybmFtZSBvciBlbWFpbCBhbmQgcmV0dXJuIHRoZSBhcHByb3ByaWF0ZSBlcnJvci5cbiAgICAgICAgLy8gRmFsbGJhY2sgdG8gdGhlIG9yaWdpbmFsIG1ldGhvZFxuICAgICAgICAvLyBUT0RPOiBTZWUgaWYgd2UgY2FuIGxhdGVyIGRvIHRoaXMgd2l0aG91dCBhZGRpdGlvbmFsIHF1ZXJpZXMgYnkgdXNpbmcgbmFtZWQgaW5kZXhlcy5cbiAgICAgICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlXG4gICAgICAgICAgLmZpbmQoXG4gICAgICAgICAgICB0aGlzLmNsYXNzTmFtZSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgdXNlcm5hbWU6IHRoaXMuZGF0YS51c2VybmFtZSxcbiAgICAgICAgICAgICAgb2JqZWN0SWQ6IHsgJG5lOiB0aGlzLm9iamVjdElkKCkgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7IGxpbWl0OiAxIH1cbiAgICAgICAgICApXG4gICAgICAgICAgLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICAgICAgICBpZiAocmVzdWx0cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgICBQYXJzZS5FcnJvci5VU0VSTkFNRV9UQUtFTixcbiAgICAgICAgICAgICAgICAnQWNjb3VudCBhbHJlYWR5IGV4aXN0cyBmb3IgdGhpcyB1c2VybmFtZS4nXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UuZmluZChcbiAgICAgICAgICAgICAgdGhpcy5jbGFzc05hbWUsXG4gICAgICAgICAgICAgIHsgZW1haWw6IHRoaXMuZGF0YS5lbWFpbCwgb2JqZWN0SWQ6IHsgJG5lOiB0aGlzLm9iamVjdElkKCkgfSB9LFxuICAgICAgICAgICAgICB7IGxpbWl0OiAxIH1cbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAudGhlbihyZXN1bHRzID0+IHtcbiAgICAgICAgICAgIGlmIChyZXN1bHRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICAgIFBhcnNlLkVycm9yLkVNQUlMX1RBS0VOLFxuICAgICAgICAgICAgICAgICdBY2NvdW50IGFscmVhZHkgZXhpc3RzIGZvciB0aGlzIGVtYWlsIGFkZHJlc3MuJ1xuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICBQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUUsXG4gICAgICAgICAgICAgICdBIGR1cGxpY2F0ZSB2YWx1ZSBmb3IgYSBmaWVsZCB3aXRoIHVuaXF1ZSB2YWx1ZXMgd2FzIHByb3ZpZGVkJ1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9KTtcbiAgICAgIH0pXG4gICAgICAudGhlbihyZXNwb25zZSA9PiB7XG4gICAgICAgIHJlc3BvbnNlLm9iamVjdElkID0gdGhpcy5kYXRhLm9iamVjdElkO1xuICAgICAgICByZXNwb25zZS5jcmVhdGVkQXQgPSB0aGlzLmRhdGEuY3JlYXRlZEF0O1xuXG4gICAgICAgIGlmICh0aGlzLnJlc3BvbnNlU2hvdWxkSGF2ZVVzZXJuYW1lKSB7XG4gICAgICAgICAgcmVzcG9uc2UudXNlcm5hbWUgPSB0aGlzLmRhdGEudXNlcm5hbWU7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fdXBkYXRlUmVzcG9uc2VXaXRoRGF0YShyZXNwb25zZSwgdGhpcy5kYXRhKTtcbiAgICAgICAgdGhpcy5yZXNwb25zZSA9IHtcbiAgICAgICAgICBzdGF0dXM6IDIwMSxcbiAgICAgICAgICByZXNwb25zZSxcbiAgICAgICAgICBsb2NhdGlvbjogdGhpcy5sb2NhdGlvbigpLFxuICAgICAgICB9O1xuICAgICAgfSk7XG4gIH1cbn07XG5cbi8vIFJldHVybnMgbm90aGluZyAtIGRvZXNuJ3Qgd2FpdCBmb3IgdGhlIHRyaWdnZXIuXG5SZXN0V3JpdGUucHJvdG90eXBlLnJ1bkFmdGVyU2F2ZVRyaWdnZXIgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLnJlc3BvbnNlIHx8ICF0aGlzLnJlc3BvbnNlLnJlc3BvbnNlKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gQXZvaWQgZG9pbmcgYW55IHNldHVwIGZvciB0cmlnZ2VycyBpZiB0aGVyZSBpcyBubyAnYWZ0ZXJTYXZlJyB0cmlnZ2VyIGZvciB0aGlzIGNsYXNzLlxuICBjb25zdCBoYXNBZnRlclNhdmVIb29rID0gdHJpZ2dlcnMudHJpZ2dlckV4aXN0cyhcbiAgICB0aGlzLmNsYXNzTmFtZSxcbiAgICB0cmlnZ2Vycy5UeXBlcy5hZnRlclNhdmUsXG4gICAgdGhpcy5jb25maWcuYXBwbGljYXRpb25JZFxuICApO1xuICBjb25zdCBoYXNMaXZlUXVlcnkgPSB0aGlzLmNvbmZpZy5saXZlUXVlcnlDb250cm9sbGVyLmhhc0xpdmVRdWVyeShcbiAgICB0aGlzLmNsYXNzTmFtZVxuICApO1xuICBpZiAoIWhhc0FmdGVyU2F2ZUhvb2sgJiYgIWhhc0xpdmVRdWVyeSkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIHZhciBleHRyYURhdGEgPSB7IGNsYXNzTmFtZTogdGhpcy5jbGFzc05hbWUgfTtcbiAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5xdWVyeS5vYmplY3RJZCkge1xuICAgIGV4dHJhRGF0YS5vYmplY3RJZCA9IHRoaXMucXVlcnkub2JqZWN0SWQ7XG4gIH1cblxuICAvLyBCdWlsZCB0aGUgb3JpZ2luYWwgb2JqZWN0LCB3ZSBvbmx5IGRvIHRoaXMgZm9yIGEgdXBkYXRlIHdyaXRlLlxuICBsZXQgb3JpZ2luYWxPYmplY3Q7XG4gIGlmICh0aGlzLnF1ZXJ5ICYmIHRoaXMucXVlcnkub2JqZWN0SWQpIHtcbiAgICBvcmlnaW5hbE9iamVjdCA9IHRyaWdnZXJzLmluZmxhdGUoZXh0cmFEYXRhLCB0aGlzLm9yaWdpbmFsRGF0YSk7XG4gIH1cblxuICAvLyBCdWlsZCB0aGUgaW5mbGF0ZWQgb2JqZWN0LCBkaWZmZXJlbnQgZnJvbSBiZWZvcmVTYXZlLCBvcmlnaW5hbERhdGEgaXMgbm90IGVtcHR5XG4gIC8vIHNpbmNlIGRldmVsb3BlcnMgY2FuIGNoYW5nZSBkYXRhIGluIHRoZSBiZWZvcmVTYXZlLlxuICBjb25zdCB1cGRhdGVkT2JqZWN0ID0gdGhpcy5idWlsZFVwZGF0ZWRPYmplY3QoZXh0cmFEYXRhKTtcbiAgdXBkYXRlZE9iamVjdC5faGFuZGxlU2F2ZVJlc3BvbnNlKFxuICAgIHRoaXMucmVzcG9uc2UucmVzcG9uc2UsXG4gICAgdGhpcy5yZXNwb25zZS5zdGF0dXMgfHwgMjAwXG4gICk7XG5cbiAgdGhpcy5jb25maWcuZGF0YWJhc2UubG9hZFNjaGVtYSgpLnRoZW4oc2NoZW1hQ29udHJvbGxlciA9PiB7XG4gICAgLy8gTm90aWZpeSBMaXZlUXVlcnlTZXJ2ZXIgaWYgcG9zc2libGVcbiAgICBjb25zdCBwZXJtcyA9IHNjaGVtYUNvbnRyb2xsZXIuZ2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zKFxuICAgICAgdXBkYXRlZE9iamVjdC5jbGFzc05hbWVcbiAgICApO1xuICAgIHRoaXMuY29uZmlnLmxpdmVRdWVyeUNvbnRyb2xsZXIub25BZnRlclNhdmUoXG4gICAgICB1cGRhdGVkT2JqZWN0LmNsYXNzTmFtZSxcbiAgICAgIHVwZGF0ZWRPYmplY3QsXG4gICAgICBvcmlnaW5hbE9iamVjdCxcbiAgICAgIHBlcm1zXG4gICAgKTtcbiAgfSk7XG5cbiAgLy8gUnVuIGFmdGVyU2F2ZSB0cmlnZ2VyXG4gIHJldHVybiB0cmlnZ2Vyc1xuICAgIC5tYXliZVJ1blRyaWdnZXIoXG4gICAgICB0cmlnZ2Vycy5UeXBlcy5hZnRlclNhdmUsXG4gICAgICB0aGlzLmF1dGgsXG4gICAgICB1cGRhdGVkT2JqZWN0LFxuICAgICAgb3JpZ2luYWxPYmplY3QsXG4gICAgICB0aGlzLmNvbmZpZyxcbiAgICAgIHRoaXMuY29udGV4dFxuICAgIClcbiAgICAuY2F0Y2goZnVuY3Rpb24oZXJyKSB7XG4gICAgICBsb2dnZXIud2FybignYWZ0ZXJTYXZlIGNhdWdodCBhbiBlcnJvcicsIGVycik7XG4gICAgfSk7XG59O1xuXG4vLyBBIGhlbHBlciB0byBmaWd1cmUgb3V0IHdoYXQgbG9jYXRpb24gdGhpcyBvcGVyYXRpb24gaGFwcGVucyBhdC5cblJlc3RXcml0ZS5wcm90b3R5cGUubG9jYXRpb24gPSBmdW5jdGlvbigpIHtcbiAgdmFyIG1pZGRsZSA9XG4gICAgdGhpcy5jbGFzc05hbWUgPT09ICdfVXNlcicgPyAnL3VzZXJzLycgOiAnL2NsYXNzZXMvJyArIHRoaXMuY2xhc3NOYW1lICsgJy8nO1xuICByZXR1cm4gdGhpcy5jb25maWcubW91bnQgKyBtaWRkbGUgKyB0aGlzLmRhdGEub2JqZWN0SWQ7XG59O1xuXG4vLyBBIGhlbHBlciB0byBnZXQgdGhlIG9iamVjdCBpZCBmb3IgdGhpcyBvcGVyYXRpb24uXG4vLyBCZWNhdXNlIGl0IGNvdWxkIGJlIGVpdGhlciBvbiB0aGUgcXVlcnkgb3Igb24gdGhlIGRhdGFcblJlc3RXcml0ZS5wcm90b3R5cGUub2JqZWN0SWQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuZGF0YS5vYmplY3RJZCB8fCB0aGlzLnF1ZXJ5Lm9iamVjdElkO1xufTtcblxuLy8gUmV0dXJucyBhIGNvcHkgb2YgdGhlIGRhdGEgYW5kIGRlbGV0ZSBiYWQga2V5cyAoX2F1dGhfZGF0YSwgX2hhc2hlZF9wYXNzd29yZC4uLilcblJlc3RXcml0ZS5wcm90b3R5cGUuc2FuaXRpemVkRGF0YSA9IGZ1bmN0aW9uKCkge1xuICBjb25zdCBkYXRhID0gT2JqZWN0LmtleXModGhpcy5kYXRhKS5yZWR1Y2UoKGRhdGEsIGtleSkgPT4ge1xuICAgIC8vIFJlZ2V4cCBjb21lcyBmcm9tIFBhcnNlLk9iamVjdC5wcm90b3R5cGUudmFsaWRhdGVcbiAgICBpZiAoIS9eW0EtWmEtel1bMC05QS1aYS16X10qJC8udGVzdChrZXkpKSB7XG4gICAgICBkZWxldGUgZGF0YVtrZXldO1xuICAgIH1cbiAgICByZXR1cm4gZGF0YTtcbiAgfSwgZGVlcGNvcHkodGhpcy5kYXRhKSk7XG4gIHJldHVybiBQYXJzZS5fZGVjb2RlKHVuZGVmaW5lZCwgZGF0YSk7XG59O1xuXG4vLyBSZXR1cm5zIGFuIHVwZGF0ZWQgY29weSBvZiB0aGUgb2JqZWN0XG5SZXN0V3JpdGUucHJvdG90eXBlLmJ1aWxkVXBkYXRlZE9iamVjdCA9IGZ1bmN0aW9uKGV4dHJhRGF0YSkge1xuICBjb25zdCB1cGRhdGVkT2JqZWN0ID0gdHJpZ2dlcnMuaW5mbGF0ZShleHRyYURhdGEsIHRoaXMub3JpZ2luYWxEYXRhKTtcbiAgT2JqZWN0LmtleXModGhpcy5kYXRhKS5yZWR1Y2UoZnVuY3Rpb24oZGF0YSwga2V5KSB7XG4gICAgaWYgKGtleS5pbmRleE9mKCcuJykgPiAwKSB7XG4gICAgICAvLyBzdWJkb2N1bWVudCBrZXkgd2l0aCBkb3Qgbm90YXRpb24gKCd4LnknOnYgPT4gJ3gnOnsneSc6dn0pXG4gICAgICBjb25zdCBzcGxpdHRlZEtleSA9IGtleS5zcGxpdCgnLicpO1xuICAgICAgY29uc3QgcGFyZW50UHJvcCA9IHNwbGl0dGVkS2V5WzBdO1xuICAgICAgbGV0IHBhcmVudFZhbCA9IHVwZGF0ZWRPYmplY3QuZ2V0KHBhcmVudFByb3ApO1xuICAgICAgaWYgKHR5cGVvZiBwYXJlbnRWYWwgIT09ICdvYmplY3QnKSB7XG4gICAgICAgIHBhcmVudFZhbCA9IHt9O1xuICAgICAgfVxuICAgICAgcGFyZW50VmFsW3NwbGl0dGVkS2V5WzFdXSA9IGRhdGFba2V5XTtcbiAgICAgIHVwZGF0ZWRPYmplY3Quc2V0KHBhcmVudFByb3AsIHBhcmVudFZhbCk7XG4gICAgICBkZWxldGUgZGF0YVtrZXldO1xuICAgIH1cbiAgICByZXR1cm4gZGF0YTtcbiAgfSwgZGVlcGNvcHkodGhpcy5kYXRhKSk7XG5cbiAgdXBkYXRlZE9iamVjdC5zZXQodGhpcy5zYW5pdGl6ZWREYXRhKCkpO1xuICByZXR1cm4gdXBkYXRlZE9iamVjdDtcbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuY2xlYW5Vc2VyQXV0aERhdGEgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMucmVzcG9uc2UgJiYgdGhpcy5yZXNwb25zZS5yZXNwb25zZSAmJiB0aGlzLmNsYXNzTmFtZSA9PT0gJ19Vc2VyJykge1xuICAgIGNvbnN0IHVzZXIgPSB0aGlzLnJlc3BvbnNlLnJlc3BvbnNlO1xuICAgIGlmICh1c2VyLmF1dGhEYXRhKSB7XG4gICAgICBPYmplY3Qua2V5cyh1c2VyLmF1dGhEYXRhKS5mb3JFYWNoKHByb3ZpZGVyID0+IHtcbiAgICAgICAgaWYgKHVzZXIuYXV0aERhdGFbcHJvdmlkZXJdID09PSBudWxsKSB7XG4gICAgICAgICAgZGVsZXRlIHVzZXIuYXV0aERhdGFbcHJvdmlkZXJdO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGlmIChPYmplY3Qua2V5cyh1c2VyLmF1dGhEYXRhKS5sZW5ndGggPT0gMCkge1xuICAgICAgICBkZWxldGUgdXNlci5hdXRoRGF0YTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuX3VwZGF0ZVJlc3BvbnNlV2l0aERhdGEgPSBmdW5jdGlvbihyZXNwb25zZSwgZGF0YSkge1xuICBpZiAoXy5pc0VtcHR5KHRoaXMuc3RvcmFnZS5maWVsZHNDaGFuZ2VkQnlUcmlnZ2VyKSkge1xuICAgIHJldHVybiByZXNwb25zZTtcbiAgfVxuICBjb25zdCBjbGllbnRTdXBwb3J0c0RlbGV0ZSA9IENsaWVudFNESy5zdXBwb3J0c0ZvcndhcmREZWxldGUodGhpcy5jbGllbnRTREspO1xuICB0aGlzLnN0b3JhZ2UuZmllbGRzQ2hhbmdlZEJ5VHJpZ2dlci5mb3JFYWNoKGZpZWxkTmFtZSA9PiB7XG4gICAgY29uc3QgZGF0YVZhbHVlID0gZGF0YVtmaWVsZE5hbWVdO1xuXG4gICAgaWYgKCFyZXNwb25zZS5oYXNPd25Qcm9wZXJ0eShmaWVsZE5hbWUpKSB7XG4gICAgICByZXNwb25zZVtmaWVsZE5hbWVdID0gZGF0YVZhbHVlO1xuICAgIH1cblxuICAgIC8vIFN0cmlwcyBvcGVyYXRpb25zIGZyb20gcmVzcG9uc2VzXG4gICAgaWYgKHJlc3BvbnNlW2ZpZWxkTmFtZV0gJiYgcmVzcG9uc2VbZmllbGROYW1lXS5fX29wKSB7XG4gICAgICBkZWxldGUgcmVzcG9uc2VbZmllbGROYW1lXTtcbiAgICAgIGlmIChjbGllbnRTdXBwb3J0c0RlbGV0ZSAmJiBkYXRhVmFsdWUuX19vcCA9PSAnRGVsZXRlJykge1xuICAgICAgICByZXNwb25zZVtmaWVsZE5hbWVdID0gZGF0YVZhbHVlO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG4gIHJldHVybiByZXNwb25zZTtcbn07XG5cbmV4cG9ydCBkZWZhdWx0IFJlc3RXcml0ZTtcbm1vZHVsZS5leHBvcnRzID0gUmVzdFdyaXRlO1xuIl19