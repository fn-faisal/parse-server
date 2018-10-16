'use strict';

// An object that encapsulates everything we need to run a 'find'
// operation, encoded in the REST API format.

var SchemaController = require('./Controllers/SchemaController');
var Parse = require('parse/node').Parse;
const triggers = require('./triggers');

const AlwaysSelectedKeys = ['objectId', 'createdAt', 'updatedAt'];
// restOptions can include:
//   skip
//   limit
//   order
//   count
//   include
//   keys
//   redirectClassNameForKey
function RestQuery(config, auth, className, restWhere = {}, restOptions = {}, clientSDK) {

  this.config = config;
  this.auth = auth;
  this.className = className;
  this.restWhere = restWhere;
  this.restOptions = restOptions;
  this.clientSDK = clientSDK;
  this.response = null;
  this.findOptions = {};
  this.isWrite = false;

  if (!this.auth.isMaster) {
    if (this.className == '_Session') {
      if (!this.auth.user) {
        throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Invalid session token');
      }
      this.restWhere = {
        '$and': [this.restWhere, {
          'user': {
            __type: 'Pointer',
            className: '_User',
            objectId: this.auth.user.id
          }
        }]
      };
    }
  }

  this.doCount = false;
  this.includeAll = false;

  // The format for this.include is not the same as the format for the
  // include option - it's the paths we should include, in order,
  // stored as arrays, taking into account that we need to include foo
  // before including foo.bar. Also it should dedupe.
  // For example, passing an arg of include=foo.bar,foo.baz could lead to
  // this.include = [['foo'], ['foo', 'baz'], ['foo', 'bar']]
  this.include = [];

  // If we have keys, we probably want to force some includes (n-1 level)
  // See issue: https://github.com/parse-community/parse-server/issues/3185
  if (restOptions.hasOwnProperty('keys')) {
    const keysForInclude = restOptions.keys.split(',').filter(key => {
      // At least 2 components
      return key.split(".").length > 1;
    }).map(key => {
      // Slice the last component (a.b.c -> a.b)
      // Otherwise we'll include one level too much.
      return key.slice(0, key.lastIndexOf("."));
    }).join(',');

    // Concat the possibly present include string with the one from the keys
    // Dedup / sorting is handle in 'include' case.
    if (keysForInclude.length > 0) {
      if (!restOptions.include || restOptions.include.length == 0) {
        restOptions.include = keysForInclude;
      } else {
        restOptions.include += "," + keysForInclude;
      }
    }
  }

  for (var option in restOptions) {
    switch (option) {
      case 'keys':
        {
          const keys = restOptions.keys.split(',').concat(AlwaysSelectedKeys);
          this.keys = Array.from(new Set(keys));
          break;
        }
      case 'count':
        this.doCount = true;
        break;
      case 'includeAll':
        this.includeAll = true;
        break;
      case 'distinct':
      case 'pipeline':
      case 'skip':
      case 'limit':
      case 'readPreference':
        this.findOptions[option] = restOptions[option];
        break;
      case 'order':
        var fields = restOptions.order.split(',');
        this.findOptions.sort = fields.reduce((sortMap, field) => {
          field = field.trim();
          if (field === '$score') {
            sortMap.score = { $meta: 'textScore' };
          } else if (field[0] == '-') {
            sortMap[field.slice(1)] = -1;
          } else {
            sortMap[field] = 1;
          }
          return sortMap;
        }, {});
        break;
      case 'include':
        {
          const paths = restOptions.include.split(',');
          // Load the existing includes (from keys)
          const pathSet = paths.reduce((memo, path) => {
            // Split each paths on . (a.b.c -> [a,b,c])
            // reduce to create all paths
            // ([a,b,c] -> {a: true, 'a.b': true, 'a.b.c': true})
            return path.split('.').reduce((memo, path, index, parts) => {
              memo[parts.slice(0, index + 1).join('.')] = true;
              return memo;
            }, memo);
          }, {});

          this.include = Object.keys(pathSet).map(s => {
            return s.split('.');
          }).sort((a, b) => {
            return a.length - b.length; // Sort by number of components
          });
          break;
        }
      case 'redirectClassNameForKey':
        this.redirectKey = restOptions.redirectClassNameForKey;
        this.redirectClassName = null;
        break;
      case 'includeReadPreference':
      case 'subqueryReadPreference':
        break;
      default:
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad option: ' + option);
    }
  }
}

// A convenient method to perform all the steps of processing a query
// in order.
// Returns a promise for the response - an object with optional keys
// 'results' and 'count'.
// TODO: consolidate the replaceX functions
RestQuery.prototype.execute = function (executeOptions) {
  return Promise.resolve().then(() => {
    return this.buildRestWhere();
  }).then(() => {
    return this.handleIncludeAll();
  }).then(() => {
    return this.runFind(executeOptions);
  }).then(() => {
    return this.runCount();
  }).then(() => {
    return this.handleInclude();
  }).then(() => {
    return this.runAfterFindTrigger();
  }).then(() => {
    return this.response;
  });
};

RestQuery.prototype.buildRestWhere = function () {
  return Promise.resolve().then(() => {
    return this.getUserAndRoleACL();
  }).then(() => {
    return this.redirectClassNameForKey();
  }).then(() => {
    return this.validateClientClassCreation();
  }).then(() => {
    return this.replaceSelect();
  }).then(() => {
    return this.replaceDontSelect();
  }).then(() => {
    return this.replaceInQuery();
  }).then(() => {
    return this.replaceNotInQuery();
  }).then(() => {
    return this.replaceEquality();
  });
};

// Marks the query for a write attempt, so we read the proper ACL (write instead of read)
RestQuery.prototype.forWrite = function () {
  this.isWrite = true;
  return this;
};

// Uses the Auth object to get the list of roles, adds the user id
RestQuery.prototype.getUserAndRoleACL = function () {
  if (this.auth.isMaster) {
    return Promise.resolve();
  }

  this.findOptions.acl = ['*'];

  if (this.auth.user) {
    return this.auth.getUserRoles().then(roles => {
      this.findOptions.acl = this.findOptions.acl.concat(roles, [this.auth.user.id]);
      return;
    });
  } else {
    return Promise.resolve();
  }
};

// Changes the className if redirectClassNameForKey is set.
// Returns a promise.
RestQuery.prototype.redirectClassNameForKey = function () {
  if (!this.redirectKey) {
    return Promise.resolve();
  }

  // We need to change the class name based on the schema
  return this.config.database.redirectClassNameForKey(this.className, this.redirectKey).then(newClassName => {
    this.className = newClassName;
    this.redirectClassName = newClassName;
  });
};

// Validates this operation against the allowClientClassCreation config.
RestQuery.prototype.validateClientClassCreation = function () {
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

function transformInQuery(inQueryObject, className, results) {
  var values = [];
  for (var result of results) {
    values.push({
      __type: 'Pointer',
      className: className,
      objectId: result.objectId
    });
  }
  delete inQueryObject['$inQuery'];
  if (Array.isArray(inQueryObject['$in'])) {
    inQueryObject['$in'] = inQueryObject['$in'].concat(values);
  } else {
    inQueryObject['$in'] = values;
  }
}

// Replaces a $inQuery clause by running the subquery, if there is an
// $inQuery clause.
// The $inQuery clause turns into an $in with values that are just
// pointers to the objects returned in the subquery.
RestQuery.prototype.replaceInQuery = function () {
  var inQueryObject = findObjectWithKey(this.restWhere, '$inQuery');
  if (!inQueryObject) {
    return;
  }

  // The inQuery value must have precisely two keys - where and className
  var inQueryValue = inQueryObject['$inQuery'];
  if (!inQueryValue.where || !inQueryValue.className) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'improper usage of $inQuery');
  }

  const additionalOptions = {
    redirectClassNameForKey: inQueryValue.redirectClassNameForKey,
    keys: 'objectId'
  };

  if (this.restOptions.subqueryReadPreference) {
    additionalOptions.readPreference = this.restOptions.subqueryReadPreference;
    additionalOptions.subqueryReadPreference = this.restOptions.subqueryReadPreference;
  }

  var subquery = new RestQuery(this.config, this.auth, inQueryValue.className, inQueryValue.where, additionalOptions);
  return subquery.execute().then(response => {
    transformInQuery(inQueryObject, subquery.className, response.results);
    // Recurse to repeat
    return this.replaceInQuery();
  });
};

function transformNotInQuery(notInQueryObject, className, results) {
  var values = [];
  for (var result of results) {
    values.push({
      __type: 'Pointer',
      className: className,
      objectId: result.objectId
    });
  }
  delete notInQueryObject['$notInQuery'];
  if (Array.isArray(notInQueryObject['$nin'])) {
    notInQueryObject['$nin'] = notInQueryObject['$nin'].concat(values);
  } else {
    notInQueryObject['$nin'] = values;
  }
}

// Replaces a $notInQuery clause by running the subquery, if there is an
// $notInQuery clause.
// The $notInQuery clause turns into a $nin with values that are just
// pointers to the objects returned in the subquery.
RestQuery.prototype.replaceNotInQuery = function () {
  var notInQueryObject = findObjectWithKey(this.restWhere, '$notInQuery');
  if (!notInQueryObject) {
    return;
  }

  // The notInQuery value must have precisely two keys - where and className
  var notInQueryValue = notInQueryObject['$notInQuery'];
  if (!notInQueryValue.where || !notInQueryValue.className) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'improper usage of $notInQuery');
  }

  const additionalOptions = {
    redirectClassNameForKey: notInQueryValue.redirectClassNameForKey,
    keys: 'objectId'
  };

  if (this.restOptions.subqueryReadPreference) {
    additionalOptions.readPreference = this.restOptions.subqueryReadPreference;
    additionalOptions.subqueryReadPreference = this.restOptions.subqueryReadPreference;
  }

  var subquery = new RestQuery(this.config, this.auth, notInQueryValue.className, notInQueryValue.where, additionalOptions);
  return subquery.execute().then(response => {
    transformNotInQuery(notInQueryObject, subquery.className, response.results);
    // Recurse to repeat
    return this.replaceNotInQuery();
  });
};

const transformSelect = (selectObject, key, objects) => {
  var values = [];
  for (var result of objects) {
    values.push(key.split('.').reduce((o, i) => o[i], result));
  }
  delete selectObject['$select'];
  if (Array.isArray(selectObject['$in'])) {
    selectObject['$in'] = selectObject['$in'].concat(values);
  } else {
    selectObject['$in'] = values;
  }
};

// Replaces a $select clause by running the subquery, if there is a
// $select clause.
// The $select clause turns into an $in with values selected out of
// the subquery.
// Returns a possible-promise.
RestQuery.prototype.replaceSelect = function () {
  var selectObject = findObjectWithKey(this.restWhere, '$select');
  if (!selectObject) {
    return;
  }

  // The select value must have precisely two keys - query and key
  var selectValue = selectObject['$select'];
  // iOS SDK don't send where if not set, let it pass
  if (!selectValue.query || !selectValue.key || typeof selectValue.query !== 'object' || !selectValue.query.className || Object.keys(selectValue).length !== 2) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'improper usage of $select');
  }

  const additionalOptions = {
    redirectClassNameForKey: selectValue.query.redirectClassNameForKey,
    keys: selectValue.key
  };

  if (this.restOptions.subqueryReadPreference) {
    additionalOptions.readPreference = this.restOptions.subqueryReadPreference;
    additionalOptions.subqueryReadPreference = this.restOptions.subqueryReadPreference;
  }

  var subquery = new RestQuery(this.config, this.auth, selectValue.query.className, selectValue.query.where, additionalOptions);
  return subquery.execute().then(response => {
    transformSelect(selectObject, selectValue.key, response.results);
    // Keep replacing $select clauses
    return this.replaceSelect();
  });
};

const transformDontSelect = (dontSelectObject, key, objects) => {
  var values = [];
  for (var result of objects) {
    values.push(key.split('.').reduce((o, i) => o[i], result));
  }
  delete dontSelectObject['$dontSelect'];
  if (Array.isArray(dontSelectObject['$nin'])) {
    dontSelectObject['$nin'] = dontSelectObject['$nin'].concat(values);
  } else {
    dontSelectObject['$nin'] = values;
  }
};

// Replaces a $dontSelect clause by running the subquery, if there is a
// $dontSelect clause.
// The $dontSelect clause turns into an $nin with values selected out of
// the subquery.
// Returns a possible-promise.
RestQuery.prototype.replaceDontSelect = function () {
  var dontSelectObject = findObjectWithKey(this.restWhere, '$dontSelect');
  if (!dontSelectObject) {
    return;
  }

  // The dontSelect value must have precisely two keys - query and key
  var dontSelectValue = dontSelectObject['$dontSelect'];
  if (!dontSelectValue.query || !dontSelectValue.key || typeof dontSelectValue.query !== 'object' || !dontSelectValue.query.className || Object.keys(dontSelectValue).length !== 2) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'improper usage of $dontSelect');
  }
  const additionalOptions = {
    redirectClassNameForKey: dontSelectValue.query.redirectClassNameForKey,
    keys: dontSelectValue.key
  };

  if (this.restOptions.subqueryReadPreference) {
    additionalOptions.readPreference = this.restOptions.subqueryReadPreference;
    additionalOptions.subqueryReadPreference = this.restOptions.subqueryReadPreference;
  }

  var subquery = new RestQuery(this.config, this.auth, dontSelectValue.query.className, dontSelectValue.query.where, additionalOptions);
  return subquery.execute().then(response => {
    transformDontSelect(dontSelectObject, dontSelectValue.key, response.results);
    // Keep replacing $dontSelect clauses
    return this.replaceDontSelect();
  });
};

const cleanResultOfSensitiveUserInfo = function (result, auth, config) {
  delete result.password;

  if (auth.isMaster || auth.user && auth.user.id === result.objectId) {
    return;
  }

  for (const field of config.userSensitiveFields) {
    delete result[field];
  }
};

const cleanResultAuthData = function (result) {
  if (result.authData) {
    Object.keys(result.authData).forEach(provider => {
      if (result.authData[provider] === null) {
        delete result.authData[provider];
      }
    });

    if (Object.keys(result.authData).length == 0) {
      delete result.authData;
    }
  }
};

const replaceEqualityConstraint = constraint => {
  if (typeof constraint !== 'object') {
    return constraint;
  }
  const equalToObject = {};
  let hasDirectConstraint = false;
  let hasOperatorConstraint = false;
  for (const key in constraint) {
    if (key.indexOf('$') !== 0) {
      hasDirectConstraint = true;
      equalToObject[key] = constraint[key];
    } else {
      hasOperatorConstraint = true;
    }
  }
  if (hasDirectConstraint && hasOperatorConstraint) {
    constraint['$eq'] = equalToObject;
    Object.keys(equalToObject).forEach(key => {
      delete constraint[key];
    });
  }
  return constraint;
};

RestQuery.prototype.replaceEquality = function () {
  if (typeof this.restWhere !== 'object') {
    return;
  }
  for (const key in this.restWhere) {
    this.restWhere[key] = replaceEqualityConstraint(this.restWhere[key]);
  }
};

// Returns a promise for whether it was successful.
// Populates this.response with an object that only has 'results'.
RestQuery.prototype.runFind = function (options = {}) {
  if (this.findOptions.limit === 0) {
    this.response = { results: [] };
    return Promise.resolve();
  }
  const findOptions = Object.assign({}, this.findOptions);
  if (this.keys) {
    findOptions.keys = this.keys.map(key => {
      return key.split('.')[0];
    });
  }
  if (options.op) {
    findOptions.op = options.op;
  }
  if (this.isWrite) {
    findOptions.isWrite = true;
  }
  return this.config.database.find(this.className, this.restWhere, findOptions).then(results => {
    if (this.className === '_User') {
      for (var result of results) {
        cleanResultOfSensitiveUserInfo(result, this.auth, this.config);
        cleanResultAuthData(result);
      }
    }

    this.config.filesController.expandFilesInObject(this.config, results);

    if (this.redirectClassName) {
      for (var r of results) {
        r.className = this.redirectClassName;
      }
    }
    this.response = { results: results };
  });
};

// Returns a promise for whether it was successful.
// Populates this.response.count with the count
RestQuery.prototype.runCount = function () {
  if (!this.doCount) {
    return;
  }
  this.findOptions.count = true;
  delete this.findOptions.skip;
  delete this.findOptions.limit;
  return this.config.database.find(this.className, this.restWhere, this.findOptions).then(c => {
    this.response.count = c;
  });
};

// Augments this.response with all pointers on an object
RestQuery.prototype.handleIncludeAll = function () {
  if (!this.includeAll) {
    return;
  }
  return this.config.database.loadSchema().then(schemaController => schemaController.getOneSchema(this.className)).then(schema => {
    const includeFields = [];
    const keyFields = [];
    for (const field in schema.fields) {
      if (schema.fields[field].type && schema.fields[field].type === 'Pointer') {
        includeFields.push([field]);
        keyFields.push(field);
      }
    }
    // Add fields to include, keys, remove dups
    this.include = [...new Set([...this.include, ...includeFields])];
    // if this.keys not set, then all keys are already included
    if (this.keys) {
      this.keys = [...new Set([...this.keys, ...keyFields])];
    }
  });
};

// Augments this.response with data at the paths provided in this.include.
RestQuery.prototype.handleInclude = function () {
  if (this.include.length == 0) {
    return;
  }

  var pathResponse = includePath(this.config, this.auth, this.response, this.include[0], this.restOptions);
  if (pathResponse.then) {
    return pathResponse.then(newResponse => {
      this.response = newResponse;
      this.include = this.include.slice(1);
      return this.handleInclude();
    });
  } else if (this.include.length > 0) {
    this.include = this.include.slice(1);
    return this.handleInclude();
  }

  return pathResponse;
};

//Returns a promise of a processed set of results
RestQuery.prototype.runAfterFindTrigger = function () {
  if (!this.response) {
    return;
  }
  // Avoid doing any setup for triggers if there is no 'afterFind' trigger for this class.
  const hasAfterFindHook = triggers.triggerExists(this.className, triggers.Types.afterFind, this.config.applicationId);
  if (!hasAfterFindHook) {
    return Promise.resolve();
  }
  // Skip Aggregate and Distinct Queries
  if (this.findOptions.pipeline || this.findOptions.distinct) {
    return Promise.resolve();
  }
  // Run afterFind trigger and set the new results
  return triggers.maybeRunAfterFindTrigger(triggers.Types.afterFind, this.auth, this.className, this.response.results, this.config).then(results => {
    // Ensure we properly set the className back
    if (this.redirectClassName) {
      this.response.results = results.map(object => {
        if (object instanceof Parse.Object) {
          object = object.toJSON();
        }
        object.className = this.redirectClassName;
        return object;
      });
    } else {
      this.response.results = results;
    }
  });
};

// Adds included values to the response.
// Path is a list of field names.
// Returns a promise for an augmented response.
function includePath(config, auth, response, path, restOptions = {}) {
  var pointers = findPointers(response.results, path);
  if (pointers.length == 0) {
    return response;
  }
  const pointersHash = {};
  for (var pointer of pointers) {
    if (!pointer) {
      continue;
    }
    const className = pointer.className;
    // only include the good pointers
    if (className) {
      pointersHash[className] = pointersHash[className] || new Set();
      pointersHash[className].add(pointer.objectId);
    }
  }
  const includeRestOptions = {};
  if (restOptions.keys) {
    const keys = new Set(restOptions.keys.split(','));
    const keySet = Array.from(keys).reduce((set, key) => {
      const keyPath = key.split('.');
      let i = 0;
      for (i; i < path.length; i++) {
        if (path[i] != keyPath[i]) {
          return set;
        }
      }
      if (i < keyPath.length) {
        set.add(keyPath[i]);
      }
      return set;
    }, new Set());
    if (keySet.size > 0) {
      includeRestOptions.keys = Array.from(keySet).join(',');
    }
  }

  if (restOptions.includeReadPreference) {
    includeRestOptions.readPreference = restOptions.includeReadPreference;
    includeRestOptions.includeReadPreference = restOptions.includeReadPreference;
  }

  const queryPromises = Object.keys(pointersHash).map(className => {
    const objectIds = Array.from(pointersHash[className]);
    let where;
    if (objectIds.length === 1) {
      where = { 'objectId': objectIds[0] };
    } else {
      where = { 'objectId': { '$in': objectIds } };
    }
    var query = new RestQuery(config, auth, className, where, includeRestOptions);
    return query.execute({ op: 'get' }).then(results => {
      results.className = className;
      return Promise.resolve(results);
    });
  });

  // Get the objects for all these object ids
  return Promise.all(queryPromises).then(responses => {
    var replace = responses.reduce((replace, includeResponse) => {
      for (var obj of includeResponse.results) {
        obj.__type = 'Object';
        obj.className = includeResponse.className;

        if (obj.className == "_User" && !auth.isMaster) {
          delete obj.sessionToken;
          delete obj.authData;
        }
        replace[obj.objectId] = obj;
      }
      return replace;
    }, {});

    var resp = {
      results: replacePointers(response.results, path, replace)
    };
    if (response.count) {
      resp.count = response.count;
    }
    return resp;
  });
}

// Object may be a list of REST-format object to find pointers in, or
// it may be a single object.
// If the path yields things that aren't pointers, this throws an error.
// Path is a list of fields to search into.
// Returns a list of pointers in REST format.
function findPointers(object, path) {
  if (object instanceof Array) {
    var answer = [];
    for (var x of object) {
      answer = answer.concat(findPointers(x, path));
    }
    return answer;
  }

  if (typeof object !== 'object' || !object) {
    return [];
  }

  if (path.length == 0) {
    if (object === null || object.__type == 'Pointer') {
      return [object];
    }
    return [];
  }

  var subobject = object[path[0]];
  if (!subobject) {
    return [];
  }
  return findPointers(subobject, path.slice(1));
}

// Object may be a list of REST-format objects to replace pointers
// in, or it may be a single object.
// Path is a list of fields to search into.
// replace is a map from object id -> object.
// Returns something analogous to object, but with the appropriate
// pointers inflated.
function replacePointers(object, path, replace) {
  if (object instanceof Array) {
    return object.map(obj => replacePointers(obj, path, replace)).filter(obj => typeof obj !== 'undefined');
  }

  if (typeof object !== 'object' || !object) {
    return object;
  }

  if (path.length === 0) {
    if (object && object.__type === 'Pointer') {
      return replace[object.objectId];
    }
    return object;
  }

  var subobject = object[path[0]];
  if (!subobject) {
    return object;
  }
  var newsub = replacePointers(subobject, path.slice(1), replace);
  var answer = {};
  for (var key in object) {
    if (key == path[0]) {
      answer[key] = newsub;
    } else {
      answer[key] = object[key];
    }
  }
  return answer;
}

// Finds a subobject that has the given key, if there is one.
// Returns undefined otherwise.
function findObjectWithKey(root, key) {
  if (typeof root !== 'object') {
    return;
  }
  if (root instanceof Array) {
    for (var item of root) {
      const answer = findObjectWithKey(item, key);
      if (answer) {
        return answer;
      }
    }
  }
  if (root && root[key]) {
    return root;
  }
  for (var subkey in root) {
    const answer = findObjectWithKey(root[subkey], key);
    if (answer) {
      return answer;
    }
  }
}

module.exports = RestQuery;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9SZXN0UXVlcnkuanMiXSwibmFtZXMiOlsiU2NoZW1hQ29udHJvbGxlciIsInJlcXVpcmUiLCJQYXJzZSIsInRyaWdnZXJzIiwiQWx3YXlzU2VsZWN0ZWRLZXlzIiwiUmVzdFF1ZXJ5IiwiY29uZmlnIiwiYXV0aCIsImNsYXNzTmFtZSIsInJlc3RXaGVyZSIsInJlc3RPcHRpb25zIiwiY2xpZW50U0RLIiwicmVzcG9uc2UiLCJmaW5kT3B0aW9ucyIsImlzV3JpdGUiLCJpc01hc3RlciIsInVzZXIiLCJFcnJvciIsIklOVkFMSURfU0VTU0lPTl9UT0tFTiIsIl9fdHlwZSIsIm9iamVjdElkIiwiaWQiLCJkb0NvdW50IiwiaW5jbHVkZUFsbCIsImluY2x1ZGUiLCJoYXNPd25Qcm9wZXJ0eSIsImtleXNGb3JJbmNsdWRlIiwia2V5cyIsInNwbGl0IiwiZmlsdGVyIiwia2V5IiwibGVuZ3RoIiwibWFwIiwic2xpY2UiLCJsYXN0SW5kZXhPZiIsImpvaW4iLCJvcHRpb24iLCJjb25jYXQiLCJBcnJheSIsImZyb20iLCJTZXQiLCJmaWVsZHMiLCJvcmRlciIsInNvcnQiLCJyZWR1Y2UiLCJzb3J0TWFwIiwiZmllbGQiLCJ0cmltIiwic2NvcmUiLCIkbWV0YSIsInBhdGhzIiwicGF0aFNldCIsIm1lbW8iLCJwYXRoIiwiaW5kZXgiLCJwYXJ0cyIsIk9iamVjdCIsInMiLCJhIiwiYiIsInJlZGlyZWN0S2V5IiwicmVkaXJlY3RDbGFzc05hbWVGb3JLZXkiLCJyZWRpcmVjdENsYXNzTmFtZSIsIklOVkFMSURfSlNPTiIsInByb3RvdHlwZSIsImV4ZWN1dGUiLCJleGVjdXRlT3B0aW9ucyIsIlByb21pc2UiLCJyZXNvbHZlIiwidGhlbiIsImJ1aWxkUmVzdFdoZXJlIiwiaGFuZGxlSW5jbHVkZUFsbCIsInJ1bkZpbmQiLCJydW5Db3VudCIsImhhbmRsZUluY2x1ZGUiLCJydW5BZnRlckZpbmRUcmlnZ2VyIiwiZ2V0VXNlckFuZFJvbGVBQ0wiLCJ2YWxpZGF0ZUNsaWVudENsYXNzQ3JlYXRpb24iLCJyZXBsYWNlU2VsZWN0IiwicmVwbGFjZURvbnRTZWxlY3QiLCJyZXBsYWNlSW5RdWVyeSIsInJlcGxhY2VOb3RJblF1ZXJ5IiwicmVwbGFjZUVxdWFsaXR5IiwiZm9yV3JpdGUiLCJhY2wiLCJnZXRVc2VyUm9sZXMiLCJyb2xlcyIsImRhdGFiYXNlIiwibmV3Q2xhc3NOYW1lIiwiYWxsb3dDbGllbnRDbGFzc0NyZWF0aW9uIiwic3lzdGVtQ2xhc3NlcyIsImluZGV4T2YiLCJsb2FkU2NoZW1hIiwic2NoZW1hQ29udHJvbGxlciIsImhhc0NsYXNzIiwiT1BFUkFUSU9OX0ZPUkJJRERFTiIsInRyYW5zZm9ybUluUXVlcnkiLCJpblF1ZXJ5T2JqZWN0IiwicmVzdWx0cyIsInZhbHVlcyIsInJlc3VsdCIsInB1c2giLCJpc0FycmF5IiwiZmluZE9iamVjdFdpdGhLZXkiLCJpblF1ZXJ5VmFsdWUiLCJ3aGVyZSIsIklOVkFMSURfUVVFUlkiLCJhZGRpdGlvbmFsT3B0aW9ucyIsInN1YnF1ZXJ5UmVhZFByZWZlcmVuY2UiLCJyZWFkUHJlZmVyZW5jZSIsInN1YnF1ZXJ5IiwidHJhbnNmb3JtTm90SW5RdWVyeSIsIm5vdEluUXVlcnlPYmplY3QiLCJub3RJblF1ZXJ5VmFsdWUiLCJ0cmFuc2Zvcm1TZWxlY3QiLCJzZWxlY3RPYmplY3QiLCJvYmplY3RzIiwibyIsImkiLCJzZWxlY3RWYWx1ZSIsInF1ZXJ5IiwidHJhbnNmb3JtRG9udFNlbGVjdCIsImRvbnRTZWxlY3RPYmplY3QiLCJkb250U2VsZWN0VmFsdWUiLCJjbGVhblJlc3VsdE9mU2Vuc2l0aXZlVXNlckluZm8iLCJwYXNzd29yZCIsInVzZXJTZW5zaXRpdmVGaWVsZHMiLCJjbGVhblJlc3VsdEF1dGhEYXRhIiwiYXV0aERhdGEiLCJmb3JFYWNoIiwicHJvdmlkZXIiLCJyZXBsYWNlRXF1YWxpdHlDb25zdHJhaW50IiwiY29uc3RyYWludCIsImVxdWFsVG9PYmplY3QiLCJoYXNEaXJlY3RDb25zdHJhaW50IiwiaGFzT3BlcmF0b3JDb25zdHJhaW50Iiwib3B0aW9ucyIsImxpbWl0IiwiYXNzaWduIiwib3AiLCJmaW5kIiwiZmlsZXNDb250cm9sbGVyIiwiZXhwYW5kRmlsZXNJbk9iamVjdCIsInIiLCJjb3VudCIsInNraXAiLCJjIiwiZ2V0T25lU2NoZW1hIiwic2NoZW1hIiwiaW5jbHVkZUZpZWxkcyIsImtleUZpZWxkcyIsInR5cGUiLCJwYXRoUmVzcG9uc2UiLCJpbmNsdWRlUGF0aCIsIm5ld1Jlc3BvbnNlIiwiaGFzQWZ0ZXJGaW5kSG9vayIsInRyaWdnZXJFeGlzdHMiLCJUeXBlcyIsImFmdGVyRmluZCIsImFwcGxpY2F0aW9uSWQiLCJwaXBlbGluZSIsImRpc3RpbmN0IiwibWF5YmVSdW5BZnRlckZpbmRUcmlnZ2VyIiwib2JqZWN0IiwidG9KU09OIiwicG9pbnRlcnMiLCJmaW5kUG9pbnRlcnMiLCJwb2ludGVyc0hhc2giLCJwb2ludGVyIiwiYWRkIiwiaW5jbHVkZVJlc3RPcHRpb25zIiwia2V5U2V0Iiwic2V0Iiwia2V5UGF0aCIsInNpemUiLCJpbmNsdWRlUmVhZFByZWZlcmVuY2UiLCJxdWVyeVByb21pc2VzIiwib2JqZWN0SWRzIiwiYWxsIiwicmVzcG9uc2VzIiwicmVwbGFjZSIsImluY2x1ZGVSZXNwb25zZSIsIm9iaiIsInNlc3Npb25Ub2tlbiIsInJlc3AiLCJyZXBsYWNlUG9pbnRlcnMiLCJhbnN3ZXIiLCJ4Iiwic3Vib2JqZWN0IiwibmV3c3ViIiwicm9vdCIsIml0ZW0iLCJzdWJrZXkiLCJtb2R1bGUiLCJleHBvcnRzIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7O0FBRUEsSUFBSUEsbUJBQW1CQyxRQUFRLGdDQUFSLENBQXZCO0FBQ0EsSUFBSUMsUUFBUUQsUUFBUSxZQUFSLEVBQXNCQyxLQUFsQztBQUNBLE1BQU1DLFdBQVdGLFFBQVEsWUFBUixDQUFqQjs7QUFFQSxNQUFNRyxxQkFBcUIsQ0FBQyxVQUFELEVBQWEsV0FBYixFQUEwQixXQUExQixDQUEzQjtBQUNBO0FBQ0E7QUFD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QUNyQixXQUFPZ0ssSUFBUDtBQUNEO0FBQ0QsT0FBSyxJQUFJRSxNQUFULElBQW1CRixJQUFuQixFQUF5QjtBQUN2QixVQUFNSixTQUFTbkYsa0JBQWtCdUYsS0FBS0UsTUFBTCxDQUFsQixFQUFnQ2xLLEdBQWhDLENBQWY7QUFDQSxRQUFJNEosTUFBSixFQUFZO0FBQ1YsYUFBT0EsTUFBUDtBQUNEO0FBQ0Y7QUFDRjs7QUFFRE8sT0FBT0MsT0FBUCxHQUFpQjdMLFNBQWpCIiwiZmlsZSI6IlJlc3RRdWVyeS5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEFuIG9iamVjdCB0aGF0IGVuY2Fwc3VsYXRlcyBldmVyeXRoaW5nIHdlIG5lZWQgdG8gcnVuIGEgJ2ZpbmQnXG4vLyBvcGVyYXRpb24sIGVuY29kZWQgaW4gdGhlIFJFU1QgQVBJIGZvcm1hdC5cblxudmFyIFNjaGVtYUNvbnRyb2xsZXIgPSByZXF1aXJlKCcuL0NvbnRyb2xsZXJzL1NjaGVtYUNvbnRyb2xsZXInKTtcbnZhciBQYXJzZSA9IHJlcXVpcmUoJ3BhcnNlL25vZGUnKS5QYXJzZTtcbmNvbnN0IHRyaWdnZXJzID0gcmVxdWlyZSgnLi90cmlnZ2VycycpO1xuXG5jb25zdCBBbHdheXNTZWxlY3RlZEtleXMgPSBbJ29iamVjdElkJywgJ2NyZWF0ZWRBdCcsICd1cGRhdGVkQXQnXTtcbi8vIHJlc3RPcHRpb25zIGNhbiBpbmNsdWRlOlxuLy8gICBza2lwXG4vLyAgIGxpbWl0XG4vLyAgIG9yZGVyXG4vLyAgIGNvdW50XG4vLyAgIGluY2x1ZGVcbi8vICAga2V5c1xuLy8gICByZWRpcmVjdENsYXNzTmFtZUZvcktleVxuZnVuY3Rpb24gUmVzdFF1ZXJ5KGNvbmZpZywgYXV0aCwgY2xhc3NOYW1lLCByZXN0V2hlcmUgPSB7fSwgcmVzdE9wdGlvbnMgPSB7fSwgY2xpZW50U0RLKSB7XG5cbiAgdGhpcy5jb25maWcgPSBjb25maWc7XG4gIHRoaXMuYXV0aCA9IGF1dGg7XG4gIHRoaXMuY2xhc3NOYW1lID0gY2xhc3NOYW1lO1xuICB0aGlzLnJlc3RXaGVyZSA9IHJlc3RXaGVyZTtcbiAgdGhpcy5yZXN0T3B0aW9ucyA9IHJlc3RPcHRpb25zO1xuICB0aGlzLmNsaWVudFNESyA9IGNsaWVudFNESztcbiAgdGhpcy5yZXNwb25zZSA9IG51bGw7XG4gIHRoaXMuZmluZE9wdGlvbnMgPSB7fTtcbiAgdGhpcy5pc1dyaXRlID0gZmFsc2U7XG5cbiAgaWYgKCF0aGlzLmF1dGguaXNNYXN0ZXIpIHtcbiAgICBpZiAodGhpcy5jbGFzc05hbWUgPT0gJ19TZXNzaW9uJykge1xuICAgICAgaWYgKCF0aGlzLmF1dGgudXNlcikge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9TRVNTSU9OX1RPS0VOLFxuICAgICAgICAgICdJbnZhbGlkIHNlc3Npb24gdG9rZW4nKTtcbiAgICAgIH1cbiAgICAgIHRoaXMucmVzdFdoZXJlID0ge1xuICAgICAgICAnJGFuZCc6IFt0aGlzLnJlc3RXaGVyZSwge1xuICAgICAgICAgICd1c2VyJzoge1xuICAgICAgICAgICAgX190eXBlOiAnUG9pbnRlcicsXG4gICAgICAgICAgICBjbGFzc05hbWU6ICdfVXNlcicsXG4gICAgICAgICAgICBvYmplY3RJZDogdGhpcy5hdXRoLnVzZXIuaWRcbiAgICAgICAgICB9XG4gICAgICAgIH1dXG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIHRoaXMuZG9Db3VudCA9IGZhbHNlO1xuICB0aGlzLmluY2x1ZGVBbGwgPSBmYWxzZTtcblxuICAvLyBUaGUgZm9ybWF0IGZvciB0aGlzLmluY2x1ZGUgaXMgbm90IHRoZSBzYW1lIGFzIHRoZSBmb3JtYXQgZm9yIHRoZVxuICAvLyBpbmNsdWRlIG9wdGlvbiAtIGl0J3MgdGhlIHBhdGhzIHdlIHNob3VsZCBpbmNsdWRlLCBpbiBvcmRlcixcbiAgLy8gc3RvcmVkIGFzIGFycmF5cywgdGFraW5nIGludG8gYWNjb3VudCB0aGF0IHdlIG5lZWQgdG8gaW5jbHVkZSBmb29cbiAgLy8gYmVmb3JlIGluY2x1ZGluZyBmb28uYmFyLiBBbHNvIGl0IHNob3VsZCBkZWR1cGUuXG4gIC8vIEZvciBleGFtcGxlLCBwYXNzaW5nIGFuIGFyZyBvZiBpbmNsdWRlPWZvby5iYXIsZm9vLmJheiBjb3VsZCBsZWFkIHRvXG4gIC8vIHRoaXMuaW5jbHVkZSA9IFtbJ2ZvbyddLCBbJ2ZvbycsICdiYXonXSwgWydmb28nLCAnYmFyJ11dXG4gIHRoaXMuaW5jbHVkZSA9IFtdO1xuXG4gIC8vIElmIHdlIGhhdmUga2V5cywgd2UgcHJvYmFibHkgd2FudCB0byBmb3JjZSBzb21lIGluY2x1ZGVzIChuLTEgbGV2ZWwpXG4gIC8vIFNlZSBpc3N1ZTogaHR0cHM6Ly9naXRodWIuY29tL3BhcnNlLWNvbW11bml0eS9wYXJzZS1zZXJ2ZXIvaXNzdWVzLzMxODVcbiAgaWYgKHJlc3RPcHRpb25zLmhhc093blByb3BlcnR5KCdrZXlzJykpIHtcbiAgICBjb25zdCBrZXlzRm9ySW5jbHVkZSA9IHJlc3RPcHRpb25zLmtleXMuc3BsaXQoJywnKS5maWx0ZXIoKGtleSkgPT4ge1xuICAgICAgLy8gQXQgbGVhc3QgMiBjb21wb25lbnRzXG4gICAgICByZXR1cm4ga2V5LnNwbGl0KFwiLlwiKS5sZW5ndGggPiAxO1xuICAgIH0pLm1hcCgoa2V5KSA9PiB7XG4gICAgICAvLyBTbGljZSB0aGUgbGFzdCBjb21wb25lbnQgKGEuYi5jIC0+IGEuYilcbiAgICAgIC8vIE90aGVyd2lzZSB3ZSdsbCBpbmNsdWRlIG9uZSBsZXZlbCB0b28gbXVjaC5cbiAgICAgIHJldHVybiBrZXkuc2xpY2UoMCwga2V5Lmxhc3RJbmRleE9mKFwiLlwiKSk7XG4gICAgfSkuam9pbignLCcpO1xuXG4gICAgLy8gQ29uY2F0IHRoZSBwb3NzaWJseSBwcmVzZW50IGluY2x1ZGUgc3RyaW5nIHdpdGggdGhlIG9uZSBmcm9tIHRoZSBrZXlzXG4gICAgLy8gRGVkdXAgLyBzb3J0aW5nIGlzIGhhbmRsZSBpbiAnaW5jbHVkZScgY2FzZS5cbiAgICBpZiAoa2V5c0ZvckluY2x1ZGUubGVuZ3RoID4gMCkge1xuICAgICAgaWYgKCFyZXN0T3B0aW9ucy5pbmNsdWRlIHx8IHJlc3RPcHRpb25zLmluY2x1ZGUubGVuZ3RoID09IDApIHtcbiAgICAgICAgcmVzdE9wdGlvbnMuaW5jbHVkZSA9IGtleXNGb3JJbmNsdWRlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmVzdE9wdGlvbnMuaW5jbHVkZSArPSBcIixcIiArIGtleXNGb3JJbmNsdWRlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGZvciAodmFyIG9wdGlvbiBpbiByZXN0T3B0aW9ucykge1xuICAgIHN3aXRjaChvcHRpb24pIHtcbiAgICBjYXNlICdrZXlzJzoge1xuICAgICAgY29uc3Qga2V5cyA9IHJlc3RPcHRpb25zLmtleXMuc3BsaXQoJywnKS5jb25jYXQoQWx3YXlzU2VsZWN0ZWRLZXlzKTtcbiAgICAgIHRoaXMua2V5cyA9IEFycmF5LmZyb20obmV3IFNldChrZXlzKSk7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY2FzZSAnY291bnQnOlxuICAgICAgdGhpcy5kb0NvdW50ID0gdHJ1ZTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ2luY2x1ZGVBbGwnOlxuICAgICAgdGhpcy5pbmNsdWRlQWxsID0gdHJ1ZTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ2Rpc3RpbmN0JzpcbiAgICBjYXNlICdwaXBlbGluZSc6XG4gICAgY2FzZSAnc2tpcCc6XG4gICAgY2FzZSAnbGltaXQnOlxuICAgIGNhc2UgJ3JlYWRQcmVmZXJlbmNlJzpcbiAgICAgIHRoaXMuZmluZE9wdGlvbnNbb3B0aW9uXSA9IHJlc3RPcHRpb25zW29wdGlvbl07XG4gICAgICBicmVhaztcbiAgICBjYXNlICdvcmRlcic6XG4gICAgICB2YXIgZmllbGRzID0gcmVzdE9wdGlvbnMub3JkZXIuc3BsaXQoJywnKTtcbiAgICAgIHRoaXMuZmluZE9wdGlvbnMuc29ydCA9IGZpZWxkcy5yZWR1Y2UoKHNvcnRNYXAsIGZpZWxkKSA9PiB7XG4gICAgICAgIGZpZWxkID0gZmllbGQudHJpbSgpO1xuICAgICAgICBpZiAoZmllbGQgPT09ICckc2NvcmUnKSB7XG4gICAgICAgICAgc29ydE1hcC5zY29yZSA9IHskbWV0YTogJ3RleHRTY29yZSd9O1xuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkWzBdID09ICctJykge1xuICAgICAgICAgIHNvcnRNYXBbZmllbGQuc2xpY2UoMSldID0gLTE7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgc29ydE1hcFtmaWVsZF0gPSAxO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBzb3J0TWFwO1xuICAgICAgfSwge30pO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnaW5jbHVkZSc6IHtcbiAgICAgIGNvbnN0IHBhdGhzID0gcmVzdE9wdGlvbnMuaW5jbHVkZS5zcGxpdCgnLCcpO1xuICAgICAgLy8gTG9hZCB0aGUgZXhpc3RpbmcgaW5jbHVkZXMgKGZyb20ga2V5cylcbiAgICAgIGNvbnN0IHBhdGhTZXQgPSBwYXRocy5yZWR1Y2UoKG1lbW8sIHBhdGgpID0+IHtcbiAgICAgICAgLy8gU3BsaXQgZWFjaCBwYXRocyBvbiAuIChhLmIuYyAtPiBbYSxiLGNdKVxuICAgICAgICAvLyByZWR1Y2UgdG8gY3JlYXRlIGFsbCBwYXRoc1xuICAgICAgICAvLyAoW2EsYixjXSAtPiB7YTogdHJ1ZSwgJ2EuYic6IHRydWUsICdhLmIuYyc6IHRydWV9KVxuICAgICAgICByZXR1cm4gcGF0aC5zcGxpdCgnLicpLnJlZHVjZSgobWVtbywgcGF0aCwgaW5kZXgsIHBhcnRzKSA9PiB7XG4gICAgICAgICAgbWVtb1twYXJ0cy5zbGljZSgwLCBpbmRleCArIDEpLmpvaW4oJy4nKV0gPSB0cnVlO1xuICAgICAgICAgIHJldHVybiBtZW1vO1xuICAgICAgICB9LCBtZW1vKTtcbiAgICAgIH0sIHt9KTtcblxuICAgICAgdGhpcy5pbmNsdWRlID0gT2JqZWN0LmtleXMocGF0aFNldCkubWFwKChzKSA9PiB7XG4gICAgICAgIHJldHVybiBzLnNwbGl0KCcuJyk7XG4gICAgICB9KS5zb3J0KChhLCBiKSA9PiB7XG4gICAgICAgIHJldHVybiBhLmxlbmd0aCAtIGIubGVuZ3RoOyAvLyBTb3J0IGJ5IG51bWJlciBvZiBjb21wb25lbnRzXG4gICAgICB9KTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBjYXNlICdyZWRpcmVjdENsYXNzTmFtZUZvcktleSc6XG4gICAgICB0aGlzLnJlZGlyZWN0S2V5ID0gcmVzdE9wdGlvbnMucmVkaXJlY3RDbGFzc05hbWVGb3JLZXk7XG4gICAgICB0aGlzLnJlZGlyZWN0Q2xhc3NOYW1lID0gbnVsbDtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ2luY2x1ZGVSZWFkUHJlZmVyZW5jZSc6XG4gICAgY2FzZSAnc3VicXVlcnlSZWFkUHJlZmVyZW5jZSc6XG4gICAgICBicmVhaztcbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgJ2JhZCBvcHRpb246ICcgKyBvcHRpb24pO1xuICAgIH1cbiAgfVxufVxuXG4vLyBBIGNvbnZlbmllbnQgbWV0aG9kIHRvIHBlcmZvcm0gYWxsIHRoZSBzdGVwcyBvZiBwcm9jZXNzaW5nIGEgcXVlcnlcbi8vIGluIG9yZGVyLlxuLy8gUmV0dXJucyBhIHByb21pc2UgZm9yIHRoZSByZXNwb25zZSAtIGFuIG9iamVjdCB3aXRoIG9wdGlvbmFsIGtleXNcbi8vICdyZXN1bHRzJyBhbmQgJ2NvdW50Jy5cbi8vIFRPRE86IGNvbnNvbGlkYXRlIHRoZSByZXBsYWNlWCBmdW5jdGlvbnNcblJlc3RRdWVyeS5wcm90b3R5cGUuZXhlY3V0ZSA9IGZ1bmN0aW9uKGV4ZWN1dGVPcHRpb25zKSB7XG4gIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5idWlsZFJlc3RXaGVyZSgpO1xuICB9KS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5oYW5kbGVJbmNsdWRlQWxsKCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLnJ1bkZpbmQoZXhlY3V0ZU9wdGlvbnMpO1xuICB9KS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5ydW5Db3VudCgpO1xuICB9KS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5oYW5kbGVJbmNsdWRlKCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLnJ1bkFmdGVyRmluZFRyaWdnZXIoKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMucmVzcG9uc2U7XG4gIH0pO1xufTtcblxuUmVzdFF1ZXJ5LnByb3RvdHlwZS5idWlsZFJlc3RXaGVyZSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0VXNlckFuZFJvbGVBQ0woKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMucmVkaXJlY3RDbGFzc05hbWVGb3JLZXkoKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMudmFsaWRhdGVDbGllbnRDbGFzc0NyZWF0aW9uKCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLnJlcGxhY2VTZWxlY3QoKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMucmVwbGFjZURvbnRTZWxlY3QoKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMucmVwbGFjZUluUXVlcnkoKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMucmVwbGFjZU5vdEluUXVlcnkoKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMucmVwbGFjZUVxdWFsaXR5KCk7XG4gIH0pO1xufVxuXG4vLyBNYXJrcyB0aGUgcXVlcnkgZm9yIGEgd3JpdGUgYXR0ZW1wdCwgc28gd2UgcmVhZCB0aGUgcHJvcGVyIEFDTCAod3JpdGUgaW5zdGVhZCBvZiByZWFkKVxuUmVzdFF1ZXJ5LnByb3RvdHlwZS5mb3JXcml0ZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmlzV3JpdGUgPSB0cnVlO1xuICByZXR1cm4gdGhpcztcbn1cblxuLy8gVXNlcyB0aGUgQXV0aCBvYmplY3QgdG8gZ2V0IHRoZSBsaXN0IG9mIHJvbGVzLCBhZGRzIHRoZSB1c2VyIGlkXG5SZXN0UXVlcnkucHJvdG90eXBlLmdldFVzZXJBbmRSb2xlQUNMID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLmF1dGguaXNNYXN0ZXIpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICB0aGlzLmZpbmRPcHRpb25zLmFjbCA9IFsnKiddO1xuXG4gIGlmICh0aGlzLmF1dGgudXNlcikge1xuICAgIHJldHVybiB0aGlzLmF1dGguZ2V0VXNlclJvbGVzKCkudGhlbigocm9sZXMpID0+IHtcbiAgICAgIHRoaXMuZmluZE9wdGlvbnMuYWNsID0gdGhpcy5maW5kT3B0aW9ucy5hY2wuY29uY2F0KHJvbGVzLCBbdGhpcy5hdXRoLnVzZXIuaWRdKTtcbiAgICAgIHJldHVybjtcbiAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cbn07XG5cbi8vIENoYW5nZXMgdGhlIGNsYXNzTmFtZSBpZiByZWRpcmVjdENsYXNzTmFtZUZvcktleSBpcyBzZXQuXG4vLyBSZXR1cm5zIGEgcHJvbWlzZS5cblJlc3RRdWVyeS5wcm90b3R5cGUucmVkaXJlY3RDbGFzc05hbWVGb3JLZXkgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLnJlZGlyZWN0S2V5KSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgLy8gV2UgbmVlZCB0byBjaGFuZ2UgdGhlIGNsYXNzIG5hbWUgYmFzZWQgb24gdGhlIHNjaGVtYVxuICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UucmVkaXJlY3RDbGFzc05hbWVGb3JLZXkodGhpcy5jbGFzc05hbWUsIHRoaXMucmVkaXJlY3RLZXkpXG4gICAgLnRoZW4oKG5ld0NsYXNzTmFtZSkgPT4ge1xuICAgICAgdGhpcy5jbGFzc05hbWUgPSBuZXdDbGFzc05hbWU7XG4gICAgICB0aGlzLnJlZGlyZWN0Q2xhc3NOYW1lID0gbmV3Q2xhc3NOYW1lO1xuICAgIH0pO1xufTtcblxuLy8gVmFsaWRhdGVzIHRoaXMgb3BlcmF0aW9uIGFnYWluc3QgdGhlIGFsbG93Q2xpZW50Q2xhc3NDcmVhdGlvbiBjb25maWcuXG5SZXN0UXVlcnkucHJvdG90eXBlLnZhbGlkYXRlQ2xpZW50Q2xhc3NDcmVhdGlvbiA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5jb25maWcuYWxsb3dDbGllbnRDbGFzc0NyZWF0aW9uID09PSBmYWxzZSAmJiAhdGhpcy5hdXRoLmlzTWFzdGVyXG4gICAgICAmJiBTY2hlbWFDb250cm9sbGVyLnN5c3RlbUNsYXNzZXMuaW5kZXhPZih0aGlzLmNsYXNzTmFtZSkgPT09IC0xKSB7XG4gICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlLmxvYWRTY2hlbWEoKVxuICAgICAgLnRoZW4oc2NoZW1hQ29udHJvbGxlciA9PiBzY2hlbWFDb250cm9sbGVyLmhhc0NsYXNzKHRoaXMuY2xhc3NOYW1lKSlcbiAgICAgIC50aGVuKGhhc0NsYXNzID0+IHtcbiAgICAgICAgaWYgKGhhc0NsYXNzICE9PSB0cnVlKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9QRVJBVElPTl9GT1JCSURERU4sXG4gICAgICAgICAgICAnVGhpcyB1c2VyIGlzIG5vdCBhbGxvd2VkIHRvIGFjY2VzcyAnICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ25vbi1leGlzdGVudCBjbGFzczogJyArIHRoaXMuY2xhc3NOYW1lKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG59O1xuXG5mdW5jdGlvbiB0cmFuc2Zvcm1JblF1ZXJ5KGluUXVlcnlPYmplY3QsIGNsYXNzTmFtZSwgcmVzdWx0cykge1xuICB2YXIgdmFsdWVzID0gW107XG4gIGZvciAodmFyIHJlc3VsdCBvZiByZXN1bHRzKSB7XG4gICAgdmFsdWVzLnB1c2goe1xuICAgICAgX190eXBlOiAnUG9pbnRlcicsXG4gICAgICBjbGFzc05hbWU6IGNsYXNzTmFtZSxcbiAgICAgIG9iamVjdElkOiByZXN1bHQub2JqZWN0SWRcbiAgICB9KTtcbiAgfVxuICBkZWxldGUgaW5RdWVyeU9iamVjdFsnJGluUXVlcnknXTtcbiAgaWYgKEFycmF5LmlzQXJyYXkoaW5RdWVyeU9iamVjdFsnJGluJ10pKSB7XG4gICAgaW5RdWVyeU9iamVjdFsnJGluJ10gPSBpblF1ZXJ5T2JqZWN0WyckaW4nXS5jb25jYXQodmFsdWVzKTtcbiAgfSBlbHNlIHtcbiAgICBpblF1ZXJ5T2JqZWN0WyckaW4nXSA9IHZhbHVlcztcbiAgfVxufVxuXG4vLyBSZXBsYWNlcyBhICRpblF1ZXJ5IGNsYXVzZSBieSBydW5uaW5nIHRoZSBzdWJxdWVyeSwgaWYgdGhlcmUgaXMgYW5cbi8vICRpblF1ZXJ5IGNsYXVzZS5cbi8vIFRoZSAkaW5RdWVyeSBjbGF1c2UgdHVybnMgaW50byBhbiAkaW4gd2l0aCB2YWx1ZXMgdGhhdCBhcmUganVzdFxuLy8gcG9pbnRlcnMgdG8gdGhlIG9iamVjdHMgcmV0dXJuZWQgaW4gdGhlIHN1YnF1ZXJ5LlxuUmVzdFF1ZXJ5LnByb3RvdHlwZS5yZXBsYWNlSW5RdWVyeSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgaW5RdWVyeU9iamVjdCA9IGZpbmRPYmplY3RXaXRoS2V5KHRoaXMucmVzdFdoZXJlLCAnJGluUXVlcnknKTtcbiAgaWYgKCFpblF1ZXJ5T2JqZWN0KSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gVGhlIGluUXVlcnkgdmFsdWUgbXVzdCBoYXZlIHByZWNpc2VseSB0d28ga2V5cyAtIHdoZXJlIGFuZCBjbGFzc05hbWVcbiAgdmFyIGluUXVlcnlWYWx1ZSA9IGluUXVlcnlPYmplY3RbJyRpblF1ZXJ5J107XG4gIGlmICghaW5RdWVyeVZhbHVlLndoZXJlIHx8ICFpblF1ZXJ5VmFsdWUuY2xhc3NOYW1lKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksXG4gICAgICAnaW1wcm9wZXIgdXNhZ2Ugb2YgJGluUXVlcnknKTtcbiAgfVxuXG4gIGNvbnN0IGFkZGl0aW9uYWxPcHRpb25zID0ge1xuICAgIHJlZGlyZWN0Q2xhc3NOYW1lRm9yS2V5OiBpblF1ZXJ5VmFsdWUucmVkaXJlY3RDbGFzc05hbWVGb3JLZXksXG4gICAga2V5czogJ29iamVjdElkJ1xuICB9O1xuXG4gIGlmICh0aGlzLnJlc3RPcHRpb25zLnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2UpIHtcbiAgICBhZGRpdGlvbmFsT3B0aW9ucy5yZWFkUHJlZmVyZW5jZSA9IHRoaXMucmVzdE9wdGlvbnMuc3VicXVlcnlSZWFkUHJlZmVyZW5jZTtcbiAgICBhZGRpdGlvbmFsT3B0aW9ucy5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlID0gdGhpcy5yZXN0T3B0aW9ucy5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlO1xuICB9XG5cbiAgdmFyIHN1YnF1ZXJ5ID0gbmV3IFJlc3RRdWVyeShcbiAgICB0aGlzLmNvbmZpZywgdGhpcy5hdXRoLCBpblF1ZXJ5VmFsdWUuY2xhc3NOYW1lLFxuICAgIGluUXVlcnlWYWx1ZS53aGVyZSwgYWRkaXRpb25hbE9wdGlvbnMpO1xuICByZXR1cm4gc3VicXVlcnkuZXhlY3V0ZSgpLnRoZW4oKHJlc3BvbnNlKSA9PiB7XG4gICAgdHJhbnNmb3JtSW5RdWVyeShpblF1ZXJ5T2JqZWN0LCBzdWJxdWVyeS5jbGFzc05hbWUsIHJlc3BvbnNlLnJlc3VsdHMpO1xuICAgIC8vIFJlY3Vyc2UgdG8gcmVwZWF0XG4gICAgcmV0dXJuIHRoaXMucmVwbGFjZUluUXVlcnkoKTtcbiAgfSk7XG59O1xuXG5mdW5jdGlvbiB0cmFuc2Zvcm1Ob3RJblF1ZXJ5KG5vdEluUXVlcnlPYmplY3QsIGNsYXNzTmFtZSwgcmVzdWx0cykge1xuICB2YXIgdmFsdWVzID0gW107XG4gIGZvciAodmFyIHJlc3VsdCBvZiByZXN1bHRzKSB7XG4gICAgdmFsdWVzLnB1c2goe1xuICAgICAgX190eXBlOiAnUG9pbnRlcicsXG4gICAgICBjbGFzc05hbWU6IGNsYXNzTmFtZSxcbiAgICAgIG9iamVjdElkOiByZXN1bHQub2JqZWN0SWRcbiAgICB9KTtcbiAgfVxuICBkZWxldGUgbm90SW5RdWVyeU9iamVjdFsnJG5vdEluUXVlcnknXTtcbiAgaWYgKEFycmF5LmlzQXJyYXkobm90SW5RdWVyeU9iamVjdFsnJG5pbiddKSkge1xuICAgIG5vdEluUXVlcnlPYmplY3RbJyRuaW4nXSA9IG5vdEluUXVlcnlPYmplY3RbJyRuaW4nXS5jb25jYXQodmFsdWVzKTtcbiAgfSBlbHNlIHtcbiAgICBub3RJblF1ZXJ5T2JqZWN0WyckbmluJ10gPSB2YWx1ZXM7XG4gIH1cbn1cblxuLy8gUmVwbGFjZXMgYSAkbm90SW5RdWVyeSBjbGF1c2UgYnkgcnVubmluZyB0aGUgc3VicXVlcnksIGlmIHRoZXJlIGlzIGFuXG4vLyAkbm90SW5RdWVyeSBjbGF1c2UuXG4vLyBUaGUgJG5vdEluUXVlcnkgY2xhdXNlIHR1cm5zIGludG8gYSAkbmluIHdpdGggdmFsdWVzIHRoYXQgYXJlIGp1c3Rcbi8vIHBvaW50ZXJzIHRvIHRoZSBvYmplY3RzIHJldHVybmVkIGluIHRoZSBzdWJxdWVyeS5cblJlc3RRdWVyeS5wcm90b3R5cGUucmVwbGFjZU5vdEluUXVlcnkgPSBmdW5jdGlvbigpIHtcbiAgdmFyIG5vdEluUXVlcnlPYmplY3QgPSBmaW5kT2JqZWN0V2l0aEtleSh0aGlzLnJlc3RXaGVyZSwgJyRub3RJblF1ZXJ5Jyk7XG4gIGlmICghbm90SW5RdWVyeU9iamVjdCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIFRoZSBub3RJblF1ZXJ5IHZhbHVlIG11c3QgaGF2ZSBwcmVjaXNlbHkgdHdvIGtleXMgLSB3aGVyZSBhbmQgY2xhc3NOYW1lXG4gIHZhciBub3RJblF1ZXJ5VmFsdWUgPSBub3RJblF1ZXJ5T2JqZWN0Wyckbm90SW5RdWVyeSddO1xuICBpZiAoIW5vdEluUXVlcnlWYWx1ZS53aGVyZSB8fCAhbm90SW5RdWVyeVZhbHVlLmNsYXNzTmFtZSkge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLFxuICAgICAgJ2ltcHJvcGVyIHVzYWdlIG9mICRub3RJblF1ZXJ5Jyk7XG4gIH1cblxuICBjb25zdCBhZGRpdGlvbmFsT3B0aW9ucyA9IHtcbiAgICByZWRpcmVjdENsYXNzTmFtZUZvcktleTogbm90SW5RdWVyeVZhbHVlLnJlZGlyZWN0Q2xhc3NOYW1lRm9yS2V5LFxuICAgIGtleXM6ICdvYmplY3RJZCdcbiAgfTtcblxuICBpZiAodGhpcy5yZXN0T3B0aW9ucy5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlKSB7XG4gICAgYWRkaXRpb25hbE9wdGlvbnMucmVhZFByZWZlcmVuY2UgPSB0aGlzLnJlc3RPcHRpb25zLnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2U7XG4gICAgYWRkaXRpb25hbE9wdGlvbnMuc3VicXVlcnlSZWFkUHJlZmVyZW5jZSA9IHRoaXMucmVzdE9wdGlvbnMuc3VicXVlcnlSZWFkUHJlZmVyZW5jZTtcbiAgfVxuXG4gIHZhciBzdWJxdWVyeSA9IG5ldyBSZXN0UXVlcnkoXG4gICAgdGhpcy5jb25maWcsIHRoaXMuYXV0aCwgbm90SW5RdWVyeVZhbHVlLmNsYXNzTmFtZSxcbiAgICBub3RJblF1ZXJ5VmFsdWUud2hlcmUsIGFkZGl0aW9uYWxPcHRpb25zKTtcbiAgcmV0dXJuIHN1YnF1ZXJ5LmV4ZWN1dGUoKS50aGVuKChyZXNwb25zZSkgPT4ge1xuICAgIHRyYW5zZm9ybU5vdEluUXVlcnkobm90SW5RdWVyeU9iamVjdCwgc3VicXVlcnkuY2xhc3NOYW1lLCByZXNwb25zZS5yZXN1bHRzKTtcbiAgICAvLyBSZWN1cnNlIHRvIHJlcGVhdFxuICAgIHJldHVybiB0aGlzLnJlcGxhY2VOb3RJblF1ZXJ5KCk7XG4gIH0pO1xufTtcblxuY29uc3QgdHJhbnNmb3JtU2VsZWN0ID0gKHNlbGVjdE9iamVjdCwga2V5ICxvYmplY3RzKSA9PiB7XG4gIHZhciB2YWx1ZXMgPSBbXTtcbiAgZm9yICh2YXIgcmVzdWx0IG9mIG9iamVjdHMpIHtcbiAgICB2YWx1ZXMucHVzaChrZXkuc3BsaXQoJy4nKS5yZWR1Y2UoKG8saSk9Pm9baV0sIHJlc3VsdCkpO1xuICB9XG4gIGRlbGV0ZSBzZWxlY3RPYmplY3RbJyRzZWxlY3QnXTtcbiAgaWYgKEFycmF5LmlzQXJyYXkoc2VsZWN0T2JqZWN0WyckaW4nXSkpIHtcbiAgICBzZWxlY3RPYmplY3RbJyRpbiddID0gc2VsZWN0T2JqZWN0WyckaW4nXS5jb25jYXQodmFsdWVzKTtcbiAgfSBlbHNlIHtcbiAgICBzZWxlY3RPYmplY3RbJyRpbiddID0gdmFsdWVzO1xuICB9XG59XG5cbi8vIFJlcGxhY2VzIGEgJHNlbGVjdCBjbGF1c2UgYnkgcnVubmluZyB0aGUgc3VicXVlcnksIGlmIHRoZXJlIGlzIGFcbi8vICRzZWxlY3QgY2xhdXNlLlxuLy8gVGhlICRzZWxlY3QgY2xhdXNlIHR1cm5zIGludG8gYW4gJGluIHdpdGggdmFsdWVzIHNlbGVjdGVkIG91dCBvZlxuLy8gdGhlIHN1YnF1ZXJ5LlxuLy8gUmV0dXJucyBhIHBvc3NpYmxlLXByb21pc2UuXG5SZXN0UXVlcnkucHJvdG90eXBlLnJlcGxhY2VTZWxlY3QgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHNlbGVjdE9iamVjdCA9IGZpbmRPYmplY3RXaXRoS2V5KHRoaXMucmVzdFdoZXJlLCAnJHNlbGVjdCcpO1xuICBpZiAoIXNlbGVjdE9iamVjdCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIFRoZSBzZWxlY3QgdmFsdWUgbXVzdCBoYXZlIHByZWNpc2VseSB0d28ga2V5cyAtIHF1ZXJ5IGFuZCBrZXlcbiAgdmFyIHNlbGVjdFZhbHVlID0gc2VsZWN0T2JqZWN0Wyckc2VsZWN0J107XG4gIC8vIGlPUyBTREsgZG9uJ3Qgc2VuZCB3aGVyZSBpZiBub3Qgc2V0LCBsZXQgaXQgcGFzc1xuICBpZiAoIXNlbGVjdFZhbHVlLnF1ZXJ5IHx8XG4gICAgICAhc2VsZWN0VmFsdWUua2V5IHx8XG4gICAgICB0eXBlb2Ygc2VsZWN0VmFsdWUucXVlcnkgIT09ICdvYmplY3QnIHx8XG4gICAgICAhc2VsZWN0VmFsdWUucXVlcnkuY2xhc3NOYW1lIHx8XG4gICAgICBPYmplY3Qua2V5cyhzZWxlY3RWYWx1ZSkubGVuZ3RoICE9PSAyKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksXG4gICAgICAnaW1wcm9wZXIgdXNhZ2Ugb2YgJHNlbGVjdCcpO1xuICB9XG5cbiAgY29uc3QgYWRkaXRpb25hbE9wdGlvbnMgPSB7XG4gICAgcmVkaXJlY3RDbGFzc05hbWVGb3JLZXk6IHNlbGVjdFZhbHVlLnF1ZXJ5LnJlZGlyZWN0Q2xhc3NOYW1lRm9yS2V5LFxuICAgIGtleXM6IHNlbGVjdFZhbHVlLmtleVxuICB9O1xuXG4gIGlmICh0aGlzLnJlc3RPcHRpb25zLnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2UpIHtcbiAgICBhZGRpdGlvbmFsT3B0aW9ucy5yZWFkUHJlZmVyZW5jZSA9IHRoaXMucmVzdE9wdGlvbnMuc3VicXVlcnlSZWFkUHJlZmVyZW5jZTtcbiAgICBhZGRpdGlvbmFsT3B0aW9ucy5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlID0gdGhpcy5yZXN0T3B0aW9ucy5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlO1xuICB9XG5cbiAgdmFyIHN1YnF1ZXJ5ID0gbmV3IFJlc3RRdWVyeShcbiAgICB0aGlzLmNvbmZpZywgdGhpcy5hdXRoLCBzZWxlY3RWYWx1ZS5xdWVyeS5jbGFzc05hbWUsXG4gICAgc2VsZWN0VmFsdWUucXVlcnkud2hlcmUsIGFkZGl0aW9uYWxPcHRpb25zKTtcbiAgcmV0dXJuIHN1YnF1ZXJ5LmV4ZWN1dGUoKS50aGVuKChyZXNwb25zZSkgPT4ge1xuICAgIHRyYW5zZm9ybVNlbGVjdChzZWxlY3RPYmplY3QsIHNlbGVjdFZhbHVlLmtleSwgcmVzcG9uc2UucmVzdWx0cyk7XG4gICAgLy8gS2VlcCByZXBsYWNpbmcgJHNlbGVjdCBjbGF1c2VzXG4gICAgcmV0dXJuIHRoaXMucmVwbGFjZVNlbGVjdCgpO1xuICB9KVxufTtcblxuY29uc3QgdHJhbnNmb3JtRG9udFNlbGVjdCA9IChkb250U2VsZWN0T2JqZWN0LCBrZXksIG9iamVjdHMpID0+IHtcbiAgdmFyIHZhbHVlcyA9IFtdO1xuICBmb3IgKHZhciByZXN1bHQgb2Ygb2JqZWN0cykge1xuICAgIHZhbHVlcy5wdXNoKGtleS5zcGxpdCgnLicpLnJlZHVjZSgobyxpKT0+b1tpXSwgcmVzdWx0KSk7XG4gIH1cbiAgZGVsZXRlIGRvbnRTZWxlY3RPYmplY3RbJyRkb250U2VsZWN0J107XG4gIGlmIChBcnJheS5pc0FycmF5KGRvbnRTZWxlY3RPYmplY3RbJyRuaW4nXSkpIHtcbiAgICBkb250U2VsZWN0T2JqZWN0WyckbmluJ10gPSBkb250U2VsZWN0T2JqZWN0WyckbmluJ10uY29uY2F0KHZhbHVlcyk7XG4gIH0gZWxzZSB7XG4gICAgZG9udFNlbGVjdE9iamVjdFsnJG5pbiddID0gdmFsdWVzO1xuICB9XG59XG5cbi8vIFJlcGxhY2VzIGEgJGRvbnRTZWxlY3QgY2xhdXNlIGJ5IHJ1bm5pbmcgdGhlIHN1YnF1ZXJ5LCBpZiB0aGVyZSBpcyBhXG4vLyAkZG9udFNlbGVjdCBjbGF1c2UuXG4vLyBUaGUgJGRvbnRTZWxlY3QgY2xhdXNlIHR1cm5zIGludG8gYW4gJG5pbiB3aXRoIHZhbHVlcyBzZWxlY3RlZCBvdXQgb2Zcbi8vIHRoZSBzdWJxdWVyeS5cbi8vIFJldHVybnMgYSBwb3NzaWJsZS1wcm9taXNlLlxuUmVzdFF1ZXJ5LnByb3RvdHlwZS5yZXBsYWNlRG9udFNlbGVjdCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgZG9udFNlbGVjdE9iamVjdCA9IGZpbmRPYmplY3RXaXRoS2V5KHRoaXMucmVzdFdoZXJlLCAnJGRvbnRTZWxlY3QnKTtcbiAgaWYgKCFkb250U2VsZWN0T2JqZWN0KSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gVGhlIGRvbnRTZWxlY3QgdmFsdWUgbXVzdCBoYXZlIHByZWNpc2VseSB0d28ga2V5cyAtIHF1ZXJ5IGFuZCBrZXlcbiAgdmFyIGRvbnRTZWxlY3RWYWx1ZSA9IGRvbnRTZWxlY3RPYmplY3RbJyRkb250U2VsZWN0J107XG4gIGlmICghZG9udFNlbGVjdFZhbHVlLnF1ZXJ5IHx8XG4gICAgICAhZG9udFNlbGVjdFZhbHVlLmtleSB8fFxuICAgICAgdHlwZW9mIGRvbnRTZWxlY3RWYWx1ZS5xdWVyeSAhPT0gJ29iamVjdCcgfHxcbiAgICAgICFkb250U2VsZWN0VmFsdWUucXVlcnkuY2xhc3NOYW1lIHx8XG4gICAgICBPYmplY3Qua2V5cyhkb250U2VsZWN0VmFsdWUpLmxlbmd0aCAhPT0gMikge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLFxuICAgICAgJ2ltcHJvcGVyIHVzYWdlIG9mICRkb250U2VsZWN0Jyk7XG4gIH1cbiAgY29uc3QgYWRkaXRpb25hbE9wdGlvbnMgPSB7XG4gICAgcmVkaXJlY3RDbGFzc05hbWVGb3JLZXk6IGRvbnRTZWxlY3RWYWx1ZS5xdWVyeS5yZWRpcmVjdENsYXNzTmFtZUZvcktleSxcbiAgICBrZXlzOiBkb250U2VsZWN0VmFsdWUua2V5XG4gIH07XG5cbiAgaWYgKHRoaXMucmVzdE9wdGlvbnMuc3VicXVlcnlSZWFkUHJlZmVyZW5jZSkge1xuICAgIGFkZGl0aW9uYWxPcHRpb25zLnJlYWRQcmVmZXJlbmNlID0gdGhpcy5yZXN0T3B0aW9ucy5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlO1xuICAgIGFkZGl0aW9uYWxPcHRpb25zLnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2UgPSB0aGlzLnJlc3RPcHRpb25zLnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2U7XG4gIH1cblxuICB2YXIgc3VicXVlcnkgPSBuZXcgUmVzdFF1ZXJ5KFxuICAgIHRoaXMuY29uZmlnLCB0aGlzLmF1dGgsIGRvbnRTZWxlY3RWYWx1ZS5xdWVyeS5jbGFzc05hbWUsXG4gICAgZG9udFNlbGVjdFZhbHVlLnF1ZXJ5LndoZXJlLCBhZGRpdGlvbmFsT3B0aW9ucyk7XG4gIHJldHVybiBzdWJxdWVyeS5leGVjdXRlKCkudGhlbigocmVzcG9uc2UpID0+IHtcbiAgICB0cmFuc2Zvcm1Eb250U2VsZWN0KGRvbnRTZWxlY3RPYmplY3QsIGRvbnRTZWxlY3RWYWx1ZS5rZXksIHJlc3BvbnNlLnJlc3VsdHMpO1xuICAgIC8vIEtlZXAgcmVwbGFjaW5nICRkb250U2VsZWN0IGNsYXVzZXNcbiAgICByZXR1cm4gdGhpcy5yZXBsYWNlRG9udFNlbGVjdCgpO1xuICB9KVxufTtcblxuY29uc3QgY2xlYW5SZXN1bHRPZlNlbnNpdGl2ZVVzZXJJbmZvID0gZnVuY3Rpb24gKHJlc3VsdCwgYXV0aCwgY29uZmlnKSB7XG4gIGRlbGV0ZSByZXN1bHQucGFzc3dvcmQ7XG5cbiAgaWYgKGF1dGguaXNNYXN0ZXIgfHwgKGF1dGgudXNlciAmJiBhdXRoLnVzZXIuaWQgPT09IHJlc3VsdC5vYmplY3RJZCkpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBmb3IgKGNvbnN0IGZpZWxkIG9mIGNvbmZpZy51c2VyU2Vuc2l0aXZlRmllbGRzKSB7XG4gICAgZGVsZXRlIHJlc3VsdFtmaWVsZF07XG4gIH1cbn07XG5cbmNvbnN0IGNsZWFuUmVzdWx0QXV0aERhdGEgPSBmdW5jdGlvbiAocmVzdWx0KSB7XG4gIGlmIChyZXN1bHQuYXV0aERhdGEpIHtcbiAgICBPYmplY3Qua2V5cyhyZXN1bHQuYXV0aERhdGEpLmZvckVhY2goKHByb3ZpZGVyKSA9PiB7XG4gICAgICBpZiAocmVzdWx0LmF1dGhEYXRhW3Byb3ZpZGVyXSA9PT0gbnVsbCkge1xuICAgICAgICBkZWxldGUgcmVzdWx0LmF1dGhEYXRhW3Byb3ZpZGVyXTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGlmIChPYmplY3Qua2V5cyhyZXN1bHQuYXV0aERhdGEpLmxlbmd0aCA9PSAwKSB7XG4gICAgICBkZWxldGUgcmVzdWx0LmF1dGhEYXRhO1xuICAgIH1cbiAgfVxufTtcblxuY29uc3QgcmVwbGFjZUVxdWFsaXR5Q29uc3RyYWludCA9IChjb25zdHJhaW50KSA9PiB7XG4gIGlmICh0eXBlb2YgY29uc3RyYWludCAhPT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm4gY29uc3RyYWludDtcbiAgfVxuICBjb25zdCBlcXVhbFRvT2JqZWN0ID0ge307XG4gIGxldCBoYXNEaXJlY3RDb25zdHJhaW50ID0gZmFsc2U7XG4gIGxldCBoYXNPcGVyYXRvckNvbnN0cmFpbnQgPSBmYWxzZTtcbiAgZm9yIChjb25zdCBrZXkgaW4gY29uc3RyYWludCkge1xuICAgIGlmIChrZXkuaW5kZXhPZignJCcpICE9PSAwKSB7XG4gICAgICBoYXNEaXJlY3RDb25zdHJhaW50ID0gdHJ1ZTtcbiAgICAgIGVxdWFsVG9PYmplY3Rba2V5XSA9IGNvbnN0cmFpbnRba2V5XTtcbiAgICB9IGVsc2Uge1xuICAgICAgaGFzT3BlcmF0b3JDb25zdHJhaW50ID0gdHJ1ZTtcbiAgICB9XG4gIH1cbiAgaWYgKGhhc0RpcmVjdENvbnN0cmFpbnQgJiYgaGFzT3BlcmF0b3JDb25zdHJhaW50KSB7XG4gICAgY29uc3RyYWludFsnJGVxJ10gPSBlcXVhbFRvT2JqZWN0O1xuICAgIE9iamVjdC5rZXlzKGVxdWFsVG9PYmplY3QpLmZvckVhY2goKGtleSkgPT4ge1xuICAgICAgZGVsZXRlIGNvbnN0cmFpbnRba2V5XTtcbiAgICB9KTtcbiAgfVxuICByZXR1cm4gY29uc3RyYWludDtcbn1cblxuUmVzdFF1ZXJ5LnByb3RvdHlwZS5yZXBsYWNlRXF1YWxpdHkgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHR5cGVvZiB0aGlzLnJlc3RXaGVyZSAhPT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgZm9yIChjb25zdCBrZXkgaW4gdGhpcy5yZXN0V2hlcmUpIHtcbiAgICB0aGlzLnJlc3RXaGVyZVtrZXldID0gcmVwbGFjZUVxdWFsaXR5Q29uc3RyYWludCh0aGlzLnJlc3RXaGVyZVtrZXldKTtcbiAgfVxufVxuXG4vLyBSZXR1cm5zIGEgcHJvbWlzZSBmb3Igd2hldGhlciBpdCB3YXMgc3VjY2Vzc2Z1bC5cbi8vIFBvcHVsYXRlcyB0aGlzLnJlc3BvbnNlIHdpdGggYW4gb2JqZWN0IHRoYXQgb25seSBoYXMgJ3Jlc3VsdHMnLlxuUmVzdFF1ZXJ5LnByb3RvdHlwZS5ydW5GaW5kID0gZnVuY3Rpb24ob3B0aW9ucyA9IHt9KSB7XG4gIGlmICh0aGlzLmZpbmRPcHRpb25zLmxpbWl0ID09PSAwKSB7XG4gICAgdGhpcy5yZXNwb25zZSA9IHtyZXN1bHRzOiBbXX07XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG4gIGNvbnN0IGZpbmRPcHRpb25zID0gT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5maW5kT3B0aW9ucyk7XG4gIGlmICh0aGlzLmtleXMpIHtcbiAgICBmaW5kT3B0aW9ucy5rZXlzID0gdGhpcy5rZXlzLm1hcCgoa2V5KSA9PiB7XG4gICAgICByZXR1cm4ga2V5LnNwbGl0KCcuJylbMF07XG4gICAgfSk7XG4gIH1cbiAgaWYgKG9wdGlvbnMub3ApIHtcbiAgICBmaW5kT3B0aW9ucy5vcCA9IG9wdGlvbnMub3A7XG4gIH1cbiAgaWYgKHRoaXMuaXNXcml0ZSkge1xuICAgIGZpbmRPcHRpb25zLmlzV3JpdGUgPSB0cnVlO1xuICB9XG4gIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZS5maW5kKHRoaXMuY2xhc3NOYW1lLCB0aGlzLnJlc3RXaGVyZSwgZmluZE9wdGlvbnMpXG4gICAgLnRoZW4oKHJlc3VsdHMpID0+IHtcbiAgICAgIGlmICh0aGlzLmNsYXNzTmFtZSA9PT0gJ19Vc2VyJykge1xuICAgICAgICBmb3IgKHZhciByZXN1bHQgb2YgcmVzdWx0cykge1xuICAgICAgICAgIGNsZWFuUmVzdWx0T2ZTZW5zaXRpdmVVc2VySW5mbyhyZXN1bHQsIHRoaXMuYXV0aCwgdGhpcy5jb25maWcpO1xuICAgICAgICAgIGNsZWFuUmVzdWx0QXV0aERhdGEocmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB0aGlzLmNvbmZpZy5maWxlc0NvbnRyb2xsZXIuZXhwYW5kRmlsZXNJbk9iamVjdCh0aGlzLmNvbmZpZywgcmVzdWx0cyk7XG5cbiAgICAgIGlmICh0aGlzLnJlZGlyZWN0Q2xhc3NOYW1lKSB7XG4gICAgICAgIGZvciAodmFyIHIgb2YgcmVzdWx0cykge1xuICAgICAgICAgIHIuY2xhc3NOYW1lID0gdGhpcy5yZWRpcmVjdENsYXNzTmFtZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5yZXNwb25zZSA9IHtyZXN1bHRzOiByZXN1bHRzfTtcbiAgICB9KTtcbn07XG5cbi8vIFJldHVybnMgYSBwcm9taXNlIGZvciB3aGV0aGVyIGl0IHdhcyBzdWNjZXNzZnVsLlxuLy8gUG9wdWxhdGVzIHRoaXMucmVzcG9uc2UuY291bnQgd2l0aCB0aGUgY291bnRcblJlc3RRdWVyeS5wcm90b3R5cGUucnVuQ291bnQgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLmRvQ291bnQpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgdGhpcy5maW5kT3B0aW9ucy5jb3VudCA9IHRydWU7XG4gIGRlbGV0ZSB0aGlzLmZpbmRPcHRpb25zLnNraXA7XG4gIGRlbGV0ZSB0aGlzLmZpbmRPcHRpb25zLmxpbWl0O1xuICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UuZmluZCh0aGlzLmNsYXNzTmFtZSwgdGhpcy5yZXN0V2hlcmUsIHRoaXMuZmluZE9wdGlvbnMpXG4gICAgLnRoZW4oKGMpID0+IHtcbiAgICAgIHRoaXMucmVzcG9uc2UuY291bnQgPSBjO1xuICAgIH0pO1xufTtcblxuLy8gQXVnbWVudHMgdGhpcy5yZXNwb25zZSB3aXRoIGFsbCBwb2ludGVycyBvbiBhbiBvYmplY3RcblJlc3RRdWVyeS5wcm90b3R5cGUuaGFuZGxlSW5jbHVkZUFsbCA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMuaW5jbHVkZUFsbCkge1xuICAgIHJldHVybjtcbiAgfVxuICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UubG9hZFNjaGVtYSgpXG4gICAgLnRoZW4oc2NoZW1hQ29udHJvbGxlciA9PiBzY2hlbWFDb250cm9sbGVyLmdldE9uZVNjaGVtYSh0aGlzLmNsYXNzTmFtZSkpXG4gICAgLnRoZW4oc2NoZW1hID0+IHtcbiAgICAgIGNvbnN0IGluY2x1ZGVGaWVsZHMgPSBbXTtcbiAgICAgIGNvbnN0IGtleUZpZWxkcyA9IFtdO1xuICAgICAgZm9yIChjb25zdCBmaWVsZCBpbiBzY2hlbWEuZmllbGRzKSB7XG4gICAgICAgIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkXS50eXBlICYmIHNjaGVtYS5maWVsZHNbZmllbGRdLnR5cGUgPT09ICdQb2ludGVyJykge1xuICAgICAgICAgIGluY2x1ZGVGaWVsZHMucHVzaChbZmllbGRdKTtcbiAgICAgICAgICBrZXlGaWVsZHMucHVzaChmaWVsZCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIEFkZCBmaWVsZHMgdG8gaW5jbHVkZSwga2V5cywgcmVtb3ZlIGR1cHNcbiAgICAgIHRoaXMuaW5jbHVkZSA9IFsuLi5uZXcgU2V0KFsuLi50aGlzLmluY2x1ZGUsIC4uLmluY2x1ZGVGaWVsZHNdKV07XG4gICAgICAvLyBpZiB0aGlzLmtleXMgbm90IHNldCwgdGhlbiBhbGwga2V5cyBhcmUgYWxyZWFkeSBpbmNsdWRlZFxuICAgICAgaWYgKHRoaXMua2V5cykge1xuICAgICAgICB0aGlzLmtleXMgPSBbLi4ubmV3IFNldChbLi4udGhpcy5rZXlzLCAuLi5rZXlGaWVsZHNdKV07XG4gICAgICB9XG4gICAgfSk7XG59O1xuXG4vLyBBdWdtZW50cyB0aGlzLnJlc3BvbnNlIHdpdGggZGF0YSBhdCB0aGUgcGF0aHMgcHJvdmlkZWQgaW4gdGhpcy5pbmNsdWRlLlxuUmVzdFF1ZXJ5LnByb3RvdHlwZS5oYW5kbGVJbmNsdWRlID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLmluY2x1ZGUubGVuZ3RoID09IDApIHtcbiAgICByZXR1cm47XG4gIH1cblxuICB2YXIgcGF0aFJlc3BvbnNlID0gaW5jbHVkZVBhdGgodGhpcy5jb25maWcsIHRoaXMuYXV0aCxcbiAgICB0aGlzLnJlc3BvbnNlLCB0aGlzLmluY2x1ZGVbMF0sIHRoaXMucmVzdE9wdGlvbnMpO1xuICBpZiAocGF0aFJlc3BvbnNlLnRoZW4pIHtcbiAgICByZXR1cm4gcGF0aFJlc3BvbnNlLnRoZW4oKG5ld1Jlc3BvbnNlKSA9PiB7XG4gICAgICB0aGlzLnJlc3BvbnNlID0gbmV3UmVzcG9uc2U7XG4gICAgICB0aGlzLmluY2x1ZGUgPSB0aGlzLmluY2x1ZGUuc2xpY2UoMSk7XG4gICAgICByZXR1cm4gdGhpcy5oYW5kbGVJbmNsdWRlKCk7XG4gICAgfSk7XG4gIH0gZWxzZSBpZiAodGhpcy5pbmNsdWRlLmxlbmd0aCA+IDApIHtcbiAgICB0aGlzLmluY2x1ZGUgPSB0aGlzLmluY2x1ZGUuc2xpY2UoMSk7XG4gICAgcmV0dXJuIHRoaXMuaGFuZGxlSW5jbHVkZSgpO1xuICB9XG5cbiAgcmV0dXJuIHBhdGhSZXNwb25zZTtcbn07XG5cbi8vUmV0dXJucyBhIHByb21pc2Ugb2YgYSBwcm9jZXNzZWQgc2V0IG9mIHJlc3VsdHNcblJlc3RRdWVyeS5wcm90b3R5cGUucnVuQWZ0ZXJGaW5kVHJpZ2dlciA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMucmVzcG9uc2UpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gQXZvaWQgZG9pbmcgYW55IHNldHVwIGZvciB0cmlnZ2VycyBpZiB0aGVyZSBpcyBubyAnYWZ0ZXJGaW5kJyB0cmlnZ2VyIGZvciB0aGlzIGNsYXNzLlxuICBjb25zdCBoYXNBZnRlckZpbmRIb29rID0gdHJpZ2dlcnMudHJpZ2dlckV4aXN0cyh0aGlzLmNsYXNzTmFtZSwgdHJpZ2dlcnMuVHlwZXMuYWZ0ZXJGaW5kLCB0aGlzLmNvbmZpZy5hcHBsaWNhdGlvbklkKTtcbiAgaWYgKCFoYXNBZnRlckZpbmRIb29rKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG4gIC8vIFNraXAgQWdncmVnYXRlIGFuZCBEaXN0aW5jdCBRdWVyaWVzXG4gIGlmICh0aGlzLmZpbmRPcHRpb25zLnBpcGVsaW5lIHx8IHRoaXMuZmluZE9wdGlvbnMuZGlzdGluY3QpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cbiAgLy8gUnVuIGFmdGVyRmluZCB0cmlnZ2VyIGFuZCBzZXQgdGhlIG5ldyByZXN1bHRzXG4gIHJldHVybiB0cmlnZ2Vycy5tYXliZVJ1bkFmdGVyRmluZFRyaWdnZXIodHJpZ2dlcnMuVHlwZXMuYWZ0ZXJGaW5kLCB0aGlzLmF1dGgsIHRoaXMuY2xhc3NOYW1lLHRoaXMucmVzcG9uc2UucmVzdWx0cywgdGhpcy5jb25maWcpLnRoZW4oKHJlc3VsdHMpID0+IHtcbiAgICAvLyBFbnN1cmUgd2UgcHJvcGVybHkgc2V0IHRoZSBjbGFzc05hbWUgYmFja1xuICAgIGlmICh0aGlzLnJlZGlyZWN0Q2xhc3NOYW1lKSB7XG4gICAgICB0aGlzLnJlc3BvbnNlLnJlc3VsdHMgPSByZXN1bHRzLm1hcCgob2JqZWN0KSA9PiB7XG4gICAgICAgIGlmIChvYmplY3QgaW5zdGFuY2VvZiBQYXJzZS5PYmplY3QpIHtcbiAgICAgICAgICBvYmplY3QgPSBvYmplY3QudG9KU09OKCk7XG4gICAgICAgIH1cbiAgICAgICAgb2JqZWN0LmNsYXNzTmFtZSA9IHRoaXMucmVkaXJlY3RDbGFzc05hbWU7XG4gICAgICAgIHJldHVybiBvYmplY3Q7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5yZXNwb25zZS5yZXN1bHRzID0gcmVzdWx0cztcbiAgICB9XG4gIH0pO1xufTtcblxuLy8gQWRkcyBpbmNsdWRlZCB2YWx1ZXMgdG8gdGhlIHJlc3BvbnNlLlxuLy8gUGF0aCBpcyBhIGxpc3Qgb2YgZmllbGQgbmFtZXMuXG4vLyBSZXR1cm5zIGEgcHJvbWlzZSBmb3IgYW4gYXVnbWVudGVkIHJlc3BvbnNlLlxuZnVuY3Rpb24gaW5jbHVkZVBhdGgoY29uZmlnLCBhdXRoLCByZXNwb25zZSwgcGF0aCwgcmVzdE9wdGlvbnMgPSB7fSkge1xuICB2YXIgcG9pbnRlcnMgPSBmaW5kUG9pbnRlcnMocmVzcG9uc2UucmVzdWx0cywgcGF0aCk7XG4gIGlmIChwb2ludGVycy5sZW5ndGggPT0gMCkge1xuICAgIHJldHVybiByZXNwb25zZTtcbiAgfVxuICBjb25zdCBwb2ludGVyc0hhc2ggPSB7fTtcbiAgZm9yICh2YXIgcG9pbnRlciBvZiBwb2ludGVycykge1xuICAgIGlmICghcG9pbnRlcikge1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGNsYXNzTmFtZSA9IHBvaW50ZXIuY2xhc3NOYW1lO1xuICAgIC8vIG9ubHkgaW5jbHVkZSB0aGUgZ29vZCBwb2ludGVyc1xuICAgIGlmIChjbGFzc05hbWUpIHtcbiAgICAgIHBvaW50ZXJzSGFzaFtjbGFzc05hbWVdID0gcG9pbnRlcnNIYXNoW2NsYXNzTmFtZV0gfHwgbmV3IFNldCgpO1xuICAgICAgcG9pbnRlcnNIYXNoW2NsYXNzTmFtZV0uYWRkKHBvaW50ZXIub2JqZWN0SWQpO1xuICAgIH1cbiAgfVxuICBjb25zdCBpbmNsdWRlUmVzdE9wdGlvbnMgPSB7fTtcbiAgaWYgKHJlc3RPcHRpb25zLmtleXMpIHtcbiAgICBjb25zdCBrZXlzID0gbmV3IFNldChyZXN0T3B0aW9ucy5rZXlzLnNwbGl0KCcsJykpO1xuICAgIGNvbnN0IGtleVNldCA9IEFycmF5LmZyb20oa2V5cykucmVkdWNlKChzZXQsIGtleSkgPT4ge1xuICAgICAgY29uc3Qga2V5UGF0aCA9IGtleS5zcGxpdCgnLicpO1xuICAgICAgbGV0IGkgPSAwO1xuICAgICAgZm9yIChpOyBpIDwgcGF0aC5sZW5ndGg7IGkrKykge1xuICAgICAgICBpZiAocGF0aFtpXSAhPSBrZXlQYXRoW2ldKSB7XG4gICAgICAgICAgcmV0dXJuIHNldDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKGkgPCBrZXlQYXRoLmxlbmd0aCkge1xuICAgICAgICBzZXQuYWRkKGtleVBhdGhbaV0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHNldDtcbiAgICB9LCBuZXcgU2V0KCkpO1xuICAgIGlmIChrZXlTZXQuc2l6ZSA+IDApIHtcbiAgICAgIGluY2x1ZGVSZXN0T3B0aW9ucy5rZXlzID0gQXJyYXkuZnJvbShrZXlTZXQpLmpvaW4oJywnKTtcbiAgICB9XG4gIH1cblxuICBpZiAocmVzdE9wdGlvbnMuaW5jbHVkZVJlYWRQcmVmZXJlbmNlKSB7XG4gICAgaW5jbHVkZVJlc3RPcHRpb25zLnJlYWRQcmVmZXJlbmNlID0gcmVzdE9wdGlvbnMuaW5jbHVkZVJlYWRQcmVmZXJlbmNlO1xuICAgIGluY2x1ZGVSZXN0T3B0aW9ucy5pbmNsdWRlUmVhZFByZWZlcmVuY2UgPSByZXN0T3B0aW9ucy5pbmNsdWRlUmVhZFByZWZlcmVuY2U7XG4gIH1cblxuICBjb25zdCBxdWVyeVByb21pc2VzID0gT2JqZWN0LmtleXMocG9pbnRlcnNIYXNoKS5tYXAoKGNsYXNzTmFtZSkgPT4ge1xuICAgIGNvbnN0IG9iamVjdElkcyA9IEFycmF5LmZyb20ocG9pbnRlcnNIYXNoW2NsYXNzTmFtZV0pO1xuICAgIGxldCB3aGVyZTtcbiAgICBpZiAob2JqZWN0SWRzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgd2hlcmUgPSB7J29iamVjdElkJzogb2JqZWN0SWRzWzBdfTtcbiAgICB9IGVsc2Uge1xuICAgICAgd2hlcmUgPSB7J29iamVjdElkJzogeyckaW4nOiBvYmplY3RJZHN9fTtcbiAgICB9XG4gICAgdmFyIHF1ZXJ5ID0gbmV3IFJlc3RRdWVyeShjb25maWcsIGF1dGgsIGNsYXNzTmFtZSwgd2hlcmUsIGluY2x1ZGVSZXN0T3B0aW9ucyk7XG4gICAgcmV0dXJuIHF1ZXJ5LmV4ZWN1dGUoe29wOiAnZ2V0J30pLnRoZW4oKHJlc3VsdHMpID0+IHtcbiAgICAgIHJlc3VsdHMuY2xhc3NOYW1lID0gY2xhc3NOYW1lO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShyZXN1bHRzKTtcbiAgICB9KVxuICB9KVxuXG4gIC8vIEdldCB0aGUgb2JqZWN0cyBmb3IgYWxsIHRoZXNlIG9iamVjdCBpZHNcbiAgcmV0dXJuIFByb21pc2UuYWxsKHF1ZXJ5UHJvbWlzZXMpLnRoZW4oKHJlc3BvbnNlcykgPT4ge1xuICAgIHZhciByZXBsYWNlID0gcmVzcG9uc2VzLnJlZHVjZSgocmVwbGFjZSwgaW5jbHVkZVJlc3BvbnNlKSA9PiB7XG4gICAgICBmb3IgKHZhciBvYmogb2YgaW5jbHVkZVJlc3BvbnNlLnJlc3VsdHMpIHtcbiAgICAgICAgb2JqLl9fdHlwZSA9ICdPYmplY3QnO1xuICAgICAgICBvYmouY2xhc3NOYW1lID0gaW5jbHVkZVJlc3BvbnNlLmNsYXNzTmFtZTtcblxuICAgICAgICBpZiAob2JqLmNsYXNzTmFtZSA9PSBcIl9Vc2VyXCIgJiYgIWF1dGguaXNNYXN0ZXIpIHtcbiAgICAgICAgICBkZWxldGUgb2JqLnNlc3Npb25Ub2tlbjtcbiAgICAgICAgICBkZWxldGUgb2JqLmF1dGhEYXRhO1xuICAgICAgICB9XG4gICAgICAgIHJlcGxhY2Vbb2JqLm9iamVjdElkXSA9IG9iajtcbiAgICAgIH1cbiAgICAgIHJldHVybiByZXBsYWNlO1xuICAgIH0sIHt9KVxuXG4gICAgdmFyIHJlc3AgPSB7XG4gICAgICByZXN1bHRzOiByZXBsYWNlUG9pbnRlcnMocmVzcG9uc2UucmVzdWx0cywgcGF0aCwgcmVwbGFjZSlcbiAgICB9O1xuICAgIGlmIChyZXNwb25zZS5jb3VudCkge1xuICAgICAgcmVzcC5jb3VudCA9IHJlc3BvbnNlLmNvdW50O1xuICAgIH1cbiAgICByZXR1cm4gcmVzcDtcbiAgfSk7XG59XG5cbi8vIE9iamVjdCBtYXkgYmUgYSBsaXN0IG9mIFJFU1QtZm9ybWF0IG9iamVjdCB0byBmaW5kIHBvaW50ZXJzIGluLCBvclxuLy8gaXQgbWF5IGJlIGEgc2luZ2xlIG9iamVjdC5cbi8vIElmIHRoZSBwYXRoIHlpZWxkcyB0aGluZ3MgdGhhdCBhcmVuJ3QgcG9pbnRlcnMsIHRoaXMgdGhyb3dzIGFuIGVycm9yLlxuLy8gUGF0aCBpcyBhIGxpc3Qgb2YgZmllbGRzIHRvIHNlYXJjaCBpbnRvLlxuLy8gUmV0dXJucyBhIGxpc3Qgb2YgcG9pbnRlcnMgaW4gUkVTVCBmb3JtYXQuXG5mdW5jdGlvbiBmaW5kUG9pbnRlcnMob2JqZWN0LCBwYXRoKSB7XG4gIGlmIChvYmplY3QgaW5zdGFuY2VvZiBBcnJheSkge1xuICAgIHZhciBhbnN3ZXIgPSBbXTtcbiAgICBmb3IgKHZhciB4IG9mIG9iamVjdCkge1xuICAgICAgYW5zd2VyID0gYW5zd2VyLmNvbmNhdChmaW5kUG9pbnRlcnMoeCwgcGF0aCkpO1xuICAgIH1cbiAgICByZXR1cm4gYW5zd2VyO1xuICB9XG5cbiAgaWYgKHR5cGVvZiBvYmplY3QgIT09ICdvYmplY3QnIHx8ICFvYmplY3QpIHtcbiAgICByZXR1cm4gW107XG4gIH1cblxuICBpZiAocGF0aC5sZW5ndGggPT0gMCkge1xuICAgIGlmIChvYmplY3QgPT09IG51bGwgfHwgb2JqZWN0Ll9fdHlwZSA9PSAnUG9pbnRlcicpIHtcbiAgICAgIHJldHVybiBbb2JqZWN0XTtcbiAgICB9XG4gICAgcmV0dXJuIFtdO1xuICB9XG5cbiAgdmFyIHN1Ym9iamVjdCA9IG9iamVjdFtwYXRoWzBdXTtcbiAgaWYgKCFzdWJvYmplY3QpIHtcbiAgICByZXR1cm4gW107XG4gIH1cbiAgcmV0dXJuIGZpbmRQb2ludGVycyhzdWJvYmplY3QsIHBhdGguc2xpY2UoMSkpO1xufVxuXG4vLyBPYmplY3QgbWF5IGJlIGEgbGlzdCBvZiBSRVNULWZvcm1hdCBvYmplY3RzIHRvIHJlcGxhY2UgcG9pbnRlcnNcbi8vIGluLCBvciBpdCBtYXkgYmUgYSBzaW5nbGUgb2JqZWN0LlxuLy8gUGF0aCBpcyBhIGxpc3Qgb2YgZmllbGRzIHRvIHNlYXJjaCBpbnRvLlxuLy8gcmVwbGFjZSBpcyBhIG1hcCBmcm9tIG9iamVjdCBpZCAtPiBvYmplY3QuXG4vLyBSZXR1cm5zIHNvbWV0aGluZyBhbmFsb2dvdXMgdG8gb2JqZWN0LCBidXQgd2l0aCB0aGUgYXBwcm9wcmlhdGVcbi8vIHBvaW50ZXJzIGluZmxhdGVkLlxuZnVuY3Rpb24gcmVwbGFjZVBvaW50ZXJzKG9iamVjdCwgcGF0aCwgcmVwbGFjZSkge1xuICBpZiAob2JqZWN0IGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICByZXR1cm4gb2JqZWN0Lm1hcCgob2JqKSA9PiByZXBsYWNlUG9pbnRlcnMob2JqLCBwYXRoLCByZXBsYWNlKSlcbiAgICAgIC5maWx0ZXIoKG9iaikgPT4gdHlwZW9mIG9iaiAhPT0gJ3VuZGVmaW5lZCcpO1xuICB9XG5cbiAgaWYgKHR5cGVvZiBvYmplY3QgIT09ICdvYmplY3QnIHx8ICFvYmplY3QpIHtcbiAgICByZXR1cm4gb2JqZWN0O1xuICB9XG5cbiAgaWYgKHBhdGgubGVuZ3RoID09PSAwKSB7XG4gICAgaWYgKG9iamVjdCAmJiBvYmplY3QuX190eXBlID09PSAnUG9pbnRlcicpIHtcbiAgICAgIHJldHVybiByZXBsYWNlW29iamVjdC5vYmplY3RJZF07XG4gICAgfVxuICAgIHJldHVybiBvYmplY3Q7XG4gIH1cblxuICB2YXIgc3Vib2JqZWN0ID0gb2JqZWN0W3BhdGhbMF1dO1xuICBpZiAoIXN1Ym9iamVjdCkge1xuICAgIHJldHVybiBvYmplY3Q7XG4gIH1cbiAgdmFyIG5ld3N1YiA9IHJlcGxhY2VQb2ludGVycyhzdWJvYmplY3QsIHBhdGguc2xpY2UoMSksIHJlcGxhY2UpO1xuICB2YXIgYW5zd2VyID0ge307XG4gIGZvciAodmFyIGtleSBpbiBvYmplY3QpIHtcbiAgICBpZiAoa2V5ID09IHBhdGhbMF0pIHtcbiAgICAgIGFuc3dlcltrZXldID0gbmV3c3ViO1xuICAgIH0gZWxzZSB7XG4gICAgICBhbnN3ZXJba2V5XSA9IG9iamVjdFtrZXldO1xuICAgIH1cbiAgfVxuICByZXR1cm4gYW5zd2VyO1xufVxuXG4vLyBGaW5kcyBhIHN1Ym9iamVjdCB0aGF0IGhhcyB0aGUgZ2l2ZW4ga2V5LCBpZiB0aGVyZSBpcyBvbmUuXG4vLyBSZXR1cm5zIHVuZGVmaW5lZCBvdGhlcndpc2UuXG5mdW5jdGlvbiBmaW5kT2JqZWN0V2l0aEtleShyb290LCBrZXkpIHtcbiAgaWYgKHR5cGVvZiByb290ICE9PSAnb2JqZWN0Jykge1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAocm9vdCBpbnN0YW5jZW9mIEFycmF5KSB7XG4gICAgZm9yICh2YXIgaXRlbSBvZiByb290KSB7XG4gICAgICBjb25zdCBhbnN3ZXIgPSBmaW5kT2JqZWN0V2l0aEtleShpdGVtLCBrZXkpO1xuICAgICAgaWYgKGFuc3dlcikge1xuICAgICAgICByZXR1cm4gYW5zd2VyO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICBpZiAocm9vdCAmJiByb290W2tleV0pIHtcbiAgICByZXR1cm4gcm9vdDtcbiAgfVxuICBmb3IgKHZhciBzdWJrZXkgaW4gcm9vdCkge1xuICAgIGNvbnN0IGFuc3dlciA9IGZpbmRPYmplY3RXaXRoS2V5KHJvb3Rbc3Via2V5XSwga2V5KTtcbiAgICBpZiAoYW5zd2VyKSB7XG4gICAgICByZXR1cm4gYW5zd2VyO1xuICAgIH1cbiAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IFJlc3RRdWVyeTtcbiJdfQ==