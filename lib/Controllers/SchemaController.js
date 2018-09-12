'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SchemaController = exports.VolatileClassesSchemas = exports.convertSchemaToAdapterSchema = exports.defaultColumns = exports.systemClasses = exports.buildMergedSchemaObject = exports.invalidClassNameMessage = exports.fieldNameIsValid = exports.classNameIsValid = exports.load = undefined;

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _StorageAdapter = require('../Adapters/Storage/StorageAdapter');

var _DatabaseController = require('./DatabaseController');

var _DatabaseController2 = _interopRequireDefault(_DatabaseController);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _objectWithoutProperties(obj, keys) { var target = {}; for (var i in obj) { if (keys.indexOf(i) >= 0) continue; if (!Object.prototype.hasOwnProperty.call(obj, i)) continue; target[i] = obj[i]; } return target; }

// This class handles schema validation, persistence, and modification.
//
// Each individual Schema object should be immutable. The helpers to
// do things with the Schema just return a new schema when the schema
// is changed.
//
// The canonical place to store this Schema is in the database itself,
// in a _SCHEMA collection. This is not the right way to do it for an
// open source framework, but it's backward compatible, so we're
// keeping it this way for now.
//
// In API-handling code, you should only use the Schema class via the
// DatabaseController. This will let us replace the schema logic for
// different databases.
// TODO: hide all schema logic inside the database adapter.
// -disable-next
const Parse = require('parse/node').Parse;


const defaultColumns = Object.freeze({
  // Contain the default columns for every parse object type (except _Join collection)
  _Default: {
    "objectId": { type: 'String' },
    "createdAt": { type: 'Date' },
    "updatedAt": { type: 'Date' },
    "ACL": { type: 'ACL' }
  },
  // The additional default columns for the _User collection (in addition to DefaultCols)
  _User: {
    "username": { type: 'String' },
    "password": { type: 'String' },
    "email": { type: 'String' },
    "emailVerified": { type: 'Boolean' },
    "authData": { type: 'Object' }
  },
  // The additional default columns for the _Installation collection (in addition to DefaultCols)
  _Installation: {
    "installationId": { type: 'String' },
    "deviceToken": { type: 'String' },
    "channels": { type: 'Array' },
    "deviceType": { type: 'String' },
    "pushType": { type: 'String' },
    "GCMSenderId": { type: 'String' },
    "timeZone": { type: 'String' },
    "localeIdentifier": { type: 'String' },
    "badge": { type: 'Number' },
    "appVersion": { type: 'String' },
    "appName": { type: 'String' },
    "appIdentifier": { type: 'String' },
    "parseVersion": { type: 'String' }
  },
  // The additional default columns for the _Role collection (in addition to DefaultCols)
  _Role: {
    "name": { type: 'String' },
    "users": { type: 'Relation', targetClass: '_User' },
    "roles": { type: 'Relation', targetClass: '_Role' }
  },
  // The additional default columns for the _Session collection (in addition to DefaultCols)
  _Session: {
    "restricted": { type: 'Boolean' },
    "user": { type: 'Pointer', targetClass: '_User' },
    "installationId": { type: 'String' },
    "sessionToken": { type: 'String' },
    "expiresAt": { type: 'Date' },
    "createdWith": { type: 'Object' }
  },
  _Product: {
    "productIdentifier": { type: 'String' },
    "download": { type: 'File' },
    "downloadName": { type: 'String' },
    "icon": { type: 'File' },
    "order": { type: 'Number' },
    "title": { type: 'String' },
    "subtitle": { type: 'String' }
  },
  _PushStatus: {
    "pushTime": { type: 'String' },
    "source": { type: 'String' }, // rest or webui
    "query": { type: 'String' }, // the stringified JSON query
    "payload": { type: 'String' }, // the stringified JSON payload,
    "title": { type: 'String' },
    "expiry": { type: 'Number' },
    "expiration_interval": { type: 'Number' },
    "status": { type: 'String' },
    "numSent": { type: 'Number' },
    "numFailed": { type: 'Number' },
    "pushHash": { type: 'String' },
    "errorMessage": { type: 'Object' },
    "sentPerType": { type: 'Object' },
    "failedPerType": { type: 'Object' },
    "sentPerUTCOffset": { type: 'Object' },
    "failedPerUTCOffset": { type: 'Object' },
    "count": { type: 'Number' // tracks # of batches queued and pending
    } },
  _JobStatus: {
    "jobName": { type: 'String' },
    "source": { type: 'String' },
    "status": { type: 'String' },
    "message": { type: 'String' },
    "params": { type: 'Object' }, // params received when calling the job
    "finishedAt": { type: 'Date' }
  },
  _JobSchedule: {
    "jobName": { type: 'String' },
    "description": { type: 'String' },
    "params": { type: 'String' },
    "startAfter": { type: 'String' },
    "daysOfWeek": { type: 'Array' },
    "timeOfDay": { type: 'String' },
    "lastRun": { type: 'Number' },
    "repeatMinutes": { type: 'Number' }
  },
  _Hooks: {
    "functionName": { type: 'String' },
    "className": { type: 'String' },
    "triggerName": { type: 'String' },
    "url": { type: 'String' }
  },
  _GlobalConfig: {
    "objectId": { type: 'String' },
    "params": { type: 'Object' }
  },
  _Audience: {
    "objectId": { type: 'String' },
    "name": { type: 'String' },
    "query": { type: 'String' }, //storing query as JSON string to prevent "Nested keys should not contain the '$' or '.' characters" error
    "lastUsed": { type: 'Date' },
    "timesUsed": { type: 'Number' }
  },
  _ExportProgress: {
    "objectId": { type: 'String' },
    "id": { type: 'String' },
    "masterKey": { type: 'String' },
    "applicationId": { type: 'String' }
  }
});

const requiredColumns = Object.freeze({
  _Product: ["productIdentifier", "icon", "order", "title", "subtitle"],
  _Role: ["name", "ACL"]
});

const systemClasses = Object.freeze(['_User', '_Installation', '_Role', '_Session', '_Product', '_PushStatus', '_JobStatus', '_JobSchedule', '_Audience', '_ExportProgress']);

const volatileClasses = Object.freeze(['_JobStatus', '_PushStatus', '_Hooks', '_GlobalConfig', '_JobSchedule', '_Audience', '_ExportProgress']);

// 10 alpha numberic chars + uppercase
const userIdRegex = /^[a-zA-Z0-9]{10}$/;
// Anything that start with role
const roleRegex = /^role:.*/;
// * permission
const publicRegex = /^\*$/;

const requireAuthenticationRegex = /^requiresAuthentication$/;

const permissionKeyRegex = Object.freeze([userIdRegex, roleRegex, publicRegex, requireAuthenticationRegex]);

function verifyPermissionKey(key) {
  const result = permissionKeyRegex.reduce((isGood, regEx) => {
    isGood = isGood || key.match(regEx) != null;
    return isGood;
  }, false);
  if (!result) {
    throw new Parse.Error(Parse.Error.INVALID_JSON, `'${key}' is not a valid key for class level permissions`);
  }
}

const CLPValidKeys = Object.freeze(['find', 'count', 'get', 'create', 'update', 'delete', 'addField', 'readUserFields', 'writeUserFields']);
function validateCLP(perms, fields) {
  if (!perms) {
    return;
  }
  Object.keys(perms).forEach(operation => {
    if (CLPValidKeys.indexOf(operation) == -1) {
      throw new Parse.Error(Parse.Error.INVALID_JSON, `${operation} is not a valid operation for class level permissions`);
    }
    if (!perms[operation]) {
      return;
    }

    if (operation === 'readUserFields' || operation === 'writeUserFields') {
      if (!Array.isArray(perms[operation])) {
        // -disable-next
        throw new Parse.Error(Parse.Error.INVALID_JSON, `'${perms[operation]}' is not a valid value for class level permissions ${operation}`);
      } else {
        perms[operation].forEach(key => {
          if (!fields[key] || fields[key].type != 'Pointer' || fields[key].targetClass != '_User') {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `'${key}' is not a valid column for class level pointer permissions ${operation}`);
          }
        });
      }
      return;
    }

    // -disable-next
    Object.keys(perms[operation]).forEach(key => {
      verifyPermissionKey(key);
      // -disable-next
      const perm = perms[operation][key];
      if (perm !== true) {
        // -disable-next
        throw new Parse.Error(Parse.Error.INVALID_JSON, `'${perm}' is not a valid value for class level permissions ${operation}:${key}:${perm}`);
      }
    });
  });
}
const joinClassRegex = /^_Join:[A-Za-z0-9_]+:[A-Za-z0-9_]+/;
const classAndFieldRegex = /^[A-Za-z][A-Za-z0-9_]*$/;
function classNameIsValid(className) {
  // Valid classes must:
  return (
    // Be one of _User, _Installation, _Role, _Session OR
    systemClasses.indexOf(className) > -1 ||
    // Be a join table OR
    joinClassRegex.test(className) ||
    // Include only alpha-numeric and underscores, and not start with an underscore or number
    fieldNameIsValid(className)
  );
}

// Valid fields must be alpha-numeric, and not start with an underscore or number
function fieldNameIsValid(fieldName) {
  return classAndFieldRegex.test(fieldName);
}

// Checks that it's not trying to clobber one of the default fields of the class.
function fieldNameIsValidForClass(fieldName, className) {
  if (!fieldNameIsValid(fieldName)) {
    return false;
  }
  if (defaultColumns._Default[fieldName]) {
    return false;
  }
  if (defaultColumns[className] && defaultColumns[className][fieldName]) {
    return false;
  }
  return true;
}

function invalidClassNameMessage(className) {
  return 'Invalid classname: ' + className + ', classnames can only have alphanumeric characters and _, and must start with an alpha character ';
}

const invalidJsonError = new Parse.Error(Parse.Error.INVALID_JSON, "invalid JSON");
const validNonRelationOrPointerTypes = ['Number', 'String', 'Boolean', 'Date', 'Object', 'Array', 'GeoPoint', 'File', 'Bytes', 'Polygon'];
// Returns an error suitable for throwing if the type is invalid
const fieldTypeIsInvalid = ({ type, targetClass }) => {
  if (['Pointer', 'Relation'].indexOf(type) >= 0) {
    if (!targetClass) {
      return new Parse.Error(135, `type ${type} needs a class name`);
    } else if (typeof targetClass !== 'string') {
      return invalidJsonError;
    } else if (!classNameIsValid(targetClass)) {
      return new Parse.Error(Parse.Error.INVALID_CLASS_NAME, invalidClassNameMessage(targetClass));
    } else {
      return undefined;
    }
  }
  if (typeof type !== 'string') {
    return invalidJsonError;
  }
  if (validNonRelationOrPointerTypes.indexOf(type) < 0) {
    return new Parse.Error(Parse.Error.INCORRECT_TYPE, `invalid field type: ${type}`);
  }
  return undefined;
};

const convertSchemaToAdapterSchema = schema => {
  schema = injectDefaultSchema(schema);
  delete schema.fields.ACL;
  schema.fields._rperm = { type: 'Array' };
  schema.fields._wperm = { type: 'Array' };

  if (schema.className === '_User') {
    delete schema.fields.password;
    schema.fields._hashed_password = { type: 'String' };
  }

  return schema;
};

const convertAdapterSchemaToParseSchema = (_ref) => {
  let schema = _objectWithoutProperties(_ref, []);

  delete schema.fields._rperm;
  delete schema.fields._wperm;

  schema.fields.ACL = { type: 'ACL' };

  if (schema.className === '_User') {
    delete schema.fields.authData; //Auth data is implicit
    delete schema.fields._hashed_password;
    schema.fields.password = { type: 'String' };
  }

  if (schema.indexes && Object.keys(schema.indexes).length === 0) {
    delete schema.indexes;
  }

  return schema;
};

const injectDefaultSchema = ({ className, fields, classLevelPermissions, indexes }) => {
  const defaultSchema = {
    className,
    fields: _extends({}, defaultColumns._Default, defaultColumns[className] || {}, fields),
    classLevelPermissions
  };
  if (indexes && Object.keys(indexes).length !== 0) {
    defaultSchema.indexes = indexes;
  }
  return defaultSchema;
};

const _HooksSchema = { className: "_Hooks", fields: defaultColumns._Hooks };
const _GlobalConfigSchema = { className: "_GlobalConfig", fields: defaultColumns._GlobalConfig };
const _PushStatusSchema = convertSchemaToAdapterSchema(injectDefaultSchema({
  className: "_PushStatus",
  fields: {},
  classLevelPermissions: {}
}));
const _JobStatusSchema = convertSchemaToAdapterSchema(injectDefaultSchema({
  className: "_JobStatus",
  fields: {},
  classLevelPermissions: {}
}));
const _JobScheduleSchema = convertSchemaToAdapterSchema(injectDefaultSchema({
  className: "_JobSchedule",
  fields: {},
  classLevelPermissions: {}
}));
const _AudienceSchema = convertSchemaToAdapterSchema(injectDefaultSchema({
  className: "_Audience",
  fields: defaultColumns._Audience,
  classLevelPermissions: {}
}));
const VolatileClassesSchemas = [_HooksSchema, _JobStatusSchema, _JobScheduleSchema, _PushStatusSchema, _GlobalConfigSchema, _AudienceSchema];

const dbTypeMatchesObjectType = (dbType, objectType) => {
  if (dbType.type !== objectType.type) return false;
  if (dbType.targetClass !== objectType.targetClass) return false;
  if (dbType === objectType.type) return true;
  if (dbType.type === objectType.type) return true;
  return false;
};

const typeToString = type => {
  if (typeof type === 'string') {
    return type;
  }
  if (type.targetClass) {
    return `${type.type}<${type.targetClass}>`;
  }
  return `${type.type}`;
};

// Stores the entire schema of the app in a weird hybrid format somewhere between
// the mongo format and the Parse format. Soon, this will all be Parse format.
class SchemaController {

  constructor(databaseAdapter, schemaCache) {
    this._dbAdapter = databaseAdapter;
    this._cache = schemaCache;
    // this.data[className][fieldName] tells you the type of that field, in mongo format
    this.data = {};
    // this.perms[className][operation] tells you the acl-style permissions
    this.perms = {};
    // this.indexes[className][operation] tells you the indexes
    this.indexes = {};
  }

  reloadData(options = { clearCache: false }) {
    let promise = Promise.resolve();
    if (options.clearCache) {
      promise = promise.then(() => {
        return this._cache.clear();
      });
    }
    if (this.reloadDataPromise && !options.clearCache) {
      return this.reloadDataPromise;
    }
    this.reloadDataPromise = promise.then(() => {
      return this.getAllClasses(options).then(allSchemas => {
        const data = {};
        const perms = {};
        const indexes = {};
        allSchemas.forEach(schema => {
          data[schema.className] = injectDefaultSchema(schema).fields;
          perms[schema.className] = schema.classLevelPermissions;
          indexes[schema.className] = schema.indexes;
        });

        // Inject the in-memory classes
        volatileClasses.forEach(className => {
          const schema = injectDefaultSchema({ className, fields: {}, classLevelPermissions: {} });
          data[className] = schema.fields;
          perms[className] = schema.classLevelPermissions;
          indexes[className] = schema.indexes;
        });
        this.data = data;
        this.perms = perms;
        this.indexes = indexes;
        delete this.reloadDataPromise;
      }, err => {
        this.data = {};
        this.perms = {};
        this.indexes = {};
        delete this.reloadDataPromise;
        throw err;
      });
    }).then(() => {});
    return this.reloadDataPromise;
  }

  getAllClasses(options = { clearCache: false }) {
    let promise = Promise.resolve();
    if (options.clearCache) {
      promise = this._cache.clear();
    }
    return promise.then(() => {
      return this._cache.getAllClasses();
    }).then(allClasses => {
      if (allClasses && allClasses.length && !options.clearCache) {
        return Promise.resolve(allClasses);
      }
      return this._dbAdapter.getAllClasses().then(allSchemas => allSchemas.map(injectDefaultSchema)).then(allSchemas => {
        return this._cache.setAllClasses(allSchemas).then(() => {
          return allSchemas;
        });
      });
    });
  }

  getOneSchema(className, allowVolatileClasses = false, options = { clearCache: false }) {
    let promise = Promise.resolve();
    if (options.clearCache) {
      promise = this._cache.clear();
    }
    return promise.then(() => {
      if (allowVolatileClasses && volatileClasses.indexOf(className) > -1) {
        return Promise.resolve({
          className,
          fields: this.data[className],
          classLevelPermissions: this.perms[className],
          indexes: this.indexes[className]
        });
      }
      return this._cache.getOneSchema(className).then(cached => {
        if (cached && !options.clearCache) {
          return Promise.resolve(cached);
        }
        return this._dbAdapter.getClass(className).then(injectDefaultSchema).then(result => {
          return this._cache.setOneSchema(className, result).then(() => {
            return result;
          });
        });
      });
    });
  }

  // Create a new class that includes the three default fields.
  // ACL is an implicit column that does not get an entry in the
  // _SCHEMAS database. Returns a promise that resolves with the
  // created schema, in mongo format.
  // on success, and rejects with an error on fail. Ensure you
  // have authorization (master key, or client class creation
  // enabled) before calling this function.
  addClassIfNotExists(className, fields = {}, classLevelPermissions, indexes = {}) {
    var validationError = this.validateNewClass(className, fields, classLevelPermissions);
    if (validationError) {
      return Promise.reject(validationError);
    }

    return this._dbAdapter.createClass(className, convertSchemaToAdapterSchema({ fields, classLevelPermissions, indexes, className })).then(convertAdapterSchemaToParseSchema).then(res => {
      return this._cache.clear().then(() => {
        return Promise.resolve(res);
      });
    }).catch(error => {
      if (error && error.code === Parse.Error.DUPLICATE_VALUE) {
        throw new Parse.Error(Parse.Error.INVALID_CLASS_NAME, `Class ${className} already exists.`);
      } else {
        throw error;
      }
    });
  }

  updateClass(className, submittedFields, classLevelPermissions, indexes, database) {
    return this.getOneSchema(className).then(schema => {
      const existingFields = schema.fields;
      Object.keys(submittedFields).forEach(name => {
        const field = submittedFields[name];
        if (existingFields[name] && field.__op !== 'Delete') {
          throw new Parse.Error(255, `Field ${name} exists, cannot update.`);
        }
        if (!existingFields[name] && field.__op === 'Delete') {
          throw new Parse.Error(255, `Field ${name} does not exist, cannot delete.`);
        }
      });

      delete existingFields._rperm;
      delete existingFields._wperm;
      const newSchema = buildMergedSchemaObject(existingFields, submittedFields);
      const defaultFields = defaultColumns[className] || defaultColumns._Default;
      const fullNewSchema = Object.assign({}, newSchema, defaultFields);
      const validationError = this.validateSchemaData(className, newSchema, classLevelPermissions, Object.keys(existingFields));
      if (validationError) {
        throw new Parse.Error(validationError.code, validationError.error);
      }

      // Finally we have checked to make sure the request is valid and we can start deleting fields.
      // Do all deletions first, then a single save to _SCHEMA collection to handle all additions.
      const deletedFields = [];
      const insertedFields = [];
      Object.keys(submittedFields).forEach(fieldName => {
        if (submittedFields[fieldName].__op === 'Delete') {
          deletedFields.push(fieldName);
        } else {
          insertedFields.push(fieldName);
        }
      });

      let deletePromise = Promise.resolve();
      if (deletedFields.length > 0) {
        deletePromise = this.deleteFields(deletedFields, className, database);
      }
      return deletePromise // Delete Everything
      .then(() => this.reloadData({ clearCache: true })) // Reload our Schema, so we have all the new values
      .then(() => {
        const promises = insertedFields.map(fieldName => {
          const type = submittedFields[fieldName];
          return this.enforceFieldExists(className, fieldName, type);
        });
        return Promise.all(promises);
      }).then(() => this.setPermissions(className, classLevelPermissions, newSchema)).then(() => this._dbAdapter.setIndexesWithSchemaFormat(className, indexes, schema.indexes, fullNewSchema)).then(() => this.reloadData({ clearCache: true }))
      //TODO: Move this logic into the database adapter
      .then(() => {
        const reloadedSchema = {
          className: className,
          fields: this.data[className],
          classLevelPermissions: this.perms[className]
        };
        if (this.indexes[className] && Object.keys(this.indexes[className]).length !== 0) {
          reloadedSchema.indexes = this.indexes[className];
        }
        return reloadedSchema;
      });
    }).catch(error => {
      if (error === undefined) {
        throw new Parse.Error(Parse.Error.INVALID_CLASS_NAME, `Class ${className} does not exist.`);
      } else {
        throw error;
      }
    });
  }

  // Returns a promise that resolves successfully to the new schema
  // object or fails with a reason.
  enforceClassExists(className) {
    if (this.data[className]) {
      return Promise.resolve(this);
    }
    // We don't have this class. Update the schema
    return this.addClassIfNotExists(className)
    // The schema update succeeded. Reload the schema
    .then(() => this.reloadData({ clearCache: true })).catch(() => {
      // The schema update failed. This can be okay - it might
      // have failed because there's a race condition and a different
      // client is making the exact same schema update that we want.
      // So just reload the schema.
      return this.reloadData({ clearCache: true });
    }).then(() => {
      // Ensure that the schema now validates
      if (this.data[className]) {
        return this;
      } else {
        throw new Parse.Error(Parse.Error.INVALID_JSON, `Failed to add ${className}`);
      }
    }).catch(() => {
      // The schema still doesn't validate. Give up
      throw new Parse.Error(Parse.Error.INVALID_JSON, 'schema class name does not revalidate');
    });
  }

  validateNewClass(className, fields = {}, classLevelPermissions) {
    if (this.data[className]) {
      throw new Parse.Error(Parse.Error.INVALID_CLASS_NAME, `Class ${className} already exists.`);
    }
    if (!classNameIsValid(className)) {
      return {
        code: Parse.Error.INVALID_CLASS_NAME,
        error: invalidClassNameMessage(className)
      };
    }
    return this.validateSchemaData(className, fields, classLevelPermissions, []);
  }

  validateSchemaData(className, fields, classLevelPermissions, existingFieldNames) {
    for (const fieldName in fields) {
      if (existingFieldNames.indexOf(fieldName) < 0) {
        if (!fieldNameIsValid(fieldName)) {
          return {
            code: Parse.Error.INVALID_KEY_NAME,
            error: 'invalid field name: ' + fieldName
          };
        }
        if (!fieldNameIsValidForClass(fieldName, className)) {
          return {
            code: 136,
            error: 'field ' + fieldName + ' cannot be added'
          };
        }
        const error = fieldTypeIsInvalid(fields[fieldName]);
        if (error) return { code: error.code, error: error.message };
      }
    }

    for (const fieldName in defaultColumns[className]) {
      fields[fieldName] = defaultColumns[className][fieldName];
    }

    const geoPoints = Object.keys(fields).filter(key => fields[key] && fields[key].type === 'GeoPoint');
    if (geoPoints.length > 1) {
      return {
        code: Parse.Error.INCORRECT_TYPE,
        error: 'currently, only one GeoPoint field may exist in an object. Adding ' + geoPoints[1] + ' when ' + geoPoints[0] + ' already exists.'
      };
    }
    validateCLP(classLevelPermissions, fields);
  }

  // Sets the Class-level permissions for a given className, which must exist.
  setPermissions(className, perms, newSchema) {
    if (typeof perms === 'undefined') {
      return Promise.resolve();
    }
    validateCLP(perms, newSchema);
    return this._dbAdapter.setClassLevelPermissions(className, perms);
  }

  // Returns a promise that resolves successfully to the new schema
  // object if the provided className-fieldName-type tuple is valid.
  // The className must already be validated.
  // If 'freeze' is true, refuse to update the schema for this field.
  enforceFieldExists(className, fieldName, type) {
    if (fieldName.indexOf(".") > 0) {
      // subdocument key (x.y) => ok if x is of type 'object'
      fieldName = fieldName.split(".")[0];
      type = 'Object';
    }
    if (!fieldNameIsValid(fieldName)) {
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, `Invalid field name: ${fieldName}.`);
    }

    // If someone tries to create a new field with null/undefined as the value, return;
    if (!type) {
      return Promise.resolve(this);
    }

    return this.reloadData().then(() => {
      const expectedType = this.getExpectedType(className, fieldName);
      if (typeof type === 'string') {
        type = { type };
      }

      if (expectedType) {
        if (!dbTypeMatchesObjectType(expectedType, type)) {
          throw new Parse.Error(Parse.Error.INCORRECT_TYPE, `schema mismatch for ${className}.${fieldName}; expected ${typeToString(expectedType)} but got ${typeToString(type)}`);
        }
        return this;
      }

      return this._dbAdapter.addFieldIfNotExists(className, fieldName, type).then(() => {
        // The update succeeded. Reload the schema
        return this.reloadData({ clearCache: true });
      }, error => {
        if (error.code == Parse.Error.INCORRECT_TYPE) {
          // Make sure that we throw errors when it is appropriate to do so.
          throw error;
        }
        // The update failed. This can be okay - it might have been a race
        // condition where another client updated the schema in the same
        // way that we wanted to. So, just reload the schema
        return this.reloadData({ clearCache: true });
      }).then(() => {
        // Ensure that the schema now validates
        const expectedType = this.getExpectedType(className, fieldName);
        if (typeof type === 'string') {
          type = { type };
        }
        if (!expectedType || !dbTypeMatchesObjectType(expectedType, type)) {
          throw new Parse.Error(Parse.Error.INVALID_JSON, `Could not add field ${fieldName}`);
        }
        // Remove the cached schema
        this._cache.clear();
        return this;
      });
    });
  }

  // maintain compatibility
  deleteField(fieldName, className, database) {
    return this.deleteFields([fieldName], className, database);
  }

  // Delete fields, and remove that data from all objects. This is intended
  // to remove unused fields, if other writers are writing objects that include
  // this field, the field may reappear. Returns a Promise that resolves with
  // no object on success, or rejects with { code, error } on failure.
  // Passing the database and prefix is necessary in order to drop relation collections
  // and remove fields from objects. Ideally the database would belong to
  // a database adapter and this function would close over it or access it via member.
  deleteFields(fieldNames, className, database) {
    if (!classNameIsValid(className)) {
      throw new Parse.Error(Parse.Error.INVALID_CLASS_NAME, invalidClassNameMessage(className));
    }

    fieldNames.forEach(fieldName => {
      if (!fieldNameIsValid(fieldName)) {
        throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, `invalid field name: ${fieldName}`);
      }
      //Don't allow deleting the default fields.
      if (!fieldNameIsValidForClass(fieldName, className)) {
        throw new Parse.Error(136, `field ${fieldName} cannot be changed`);
      }
    });

    return this.getOneSchema(className, false, { clearCache: true }).catch(error => {
      if (error === undefined) {
        throw new Parse.Error(Parse.Error.INVALID_CLASS_NAME, `Class ${className} does not exist.`);
      } else {
        throw error;
      }
    }).then(schema => {
      fieldNames.forEach(fieldName => {
        if (!schema.fields[fieldName]) {
          throw new Parse.Error(255, `Field ${fieldName} does not exist, cannot delete.`);
        }
      });

      const schemaFields = _extends({}, schema.fields);
      return database.adapter.deleteFields(className, schema, fieldNames).then(() => {
        return Promise.all(fieldNames.map(fieldName => {
          const field = schemaFields[fieldName];
          if (field && field.type === 'Relation') {
            //For relations, drop the _Join table
            return database.adapter.deleteClass(`_Join:${fieldName}:${className}`);
          }
          return Promise.resolve();
        }));
      });
    }).then(() => {
      this._cache.clear();
    });
  }

  // Validates an object provided in REST format.
  // Returns a promise that resolves to the new schema if this object is
  // valid.
  validateObject(className, object, query) {
    let geocount = 0;
    let promise = this.enforceClassExists(className);
    for (const fieldName in object) {
      if (object[fieldName] === undefined) {
        continue;
      }
      const expected = getType(object[fieldName]);
      if (expected === 'GeoPoint') {
        geocount++;
      }
      if (geocount > 1) {
        // Make sure all field validation operations run before we return.
        // If not - we are continuing to run logic, but already provided response from the server.
        return promise.then(() => {
          return Promise.reject(new Parse.Error(Parse.Error.INCORRECT_TYPE, 'there can only be one geopoint field in a class'));
        });
      }
      if (!expected) {
        continue;
      }
      if (fieldName === 'ACL') {
        // Every object has ACL implicitly.
        continue;
      }

      promise = promise.then(schema => schema.enforceFieldExists(className, fieldName, expected));
    }
    promise = thenValidateRequiredColumns(promise, className, object, query);
    return promise;
  }

  // Validates that all the properties are set for the object
  validateRequiredColumns(className, object, query) {
    const columns = requiredColumns[className];
    if (!columns || columns.length == 0) {
      return Promise.resolve(this);
    }

    const missingColumns = columns.filter(function (column) {
      if (query && query.objectId) {
        if (object[column] && typeof object[column] === "object") {
          // Trying to delete a required column
          return object[column].__op == 'Delete';
        }
        // Not trying to do anything there
        return false;
      }
      return !object[column];
    });

    if (missingColumns.length > 0) {
      throw new Parse.Error(Parse.Error.INCORRECT_TYPE, missingColumns[0] + ' is required.');
    }
    return Promise.resolve(this);
  }

  // Validates the base CLP for an operation
  testBaseCLP(className, aclGroup, operation) {
    if (!this.perms[className] || !this.perms[className][operation]) {
      return true;
    }
    const classPerms = this.perms[className];
    const perms = classPerms[operation];
    // Handle the public scenario quickly
    if (perms['*']) {
      return true;
    }
    // Check permissions against the aclGroup provided (array of userId/roles)
    if (aclGroup.some(acl => {
      return perms[acl] === true;
    })) {
      return true;
    }
    return false;
  }

  // Validates an operation passes class-level-permissions set in the schema
  validatePermission(className, aclGroup, operation) {

    if (this.testBaseCLP(className, aclGroup, operation)) {
      return Promise.resolve();
    }

    if (!this.perms[className] || !this.perms[className][operation]) {
      return true;
    }
    const classPerms = this.perms[className];
    const perms = classPerms[operation];

    // If only for authenticated users
    // make sure we have an aclGroup
    if (perms['requiresAuthentication']) {
      // If aclGroup has * (public)
      if (!aclGroup || aclGroup.length == 0) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Permission denied, user needs to be authenticated.');
      } else if (aclGroup.indexOf('*') > -1 && aclGroup.length == 1) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Permission denied, user needs to be authenticated.');
      }
      // requiresAuthentication passed, just move forward
      // probably would be wise at some point to rename to 'authenticatedUser'
      return Promise.resolve();
    }

    // No matching CLP, let's check the Pointer permissions
    // And handle those later
    const permissionField = ['get', 'find', 'count'].indexOf(operation) > -1 ? 'readUserFields' : 'writeUserFields';

    // Reject create when write lockdown
    if (permissionField == 'writeUserFields' && operation == 'create') {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, `Permission denied for action ${operation} on class ${className}.`);
    }

    // Process the readUserFields later
    if (Array.isArray(classPerms[permissionField]) && classPerms[permissionField].length > 0) {
      return Promise.resolve();
    }
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, `Permission denied for action ${operation} on class ${className}.`);
  }

  // Returns the expected type for a className+key combination
  // or undefined if the schema is not set
  getExpectedType(className, fieldName) {
    if (this.data && this.data[className]) {
      const expectedType = this.data[className][fieldName];
      return expectedType === 'map' ? 'Object' : expectedType;
    }
    return undefined;
  }

  // Checks if a given class is in the schema.
  hasClass(className) {
    return this.reloadData().then(() => !!this.data[className]);
  }
}

exports.default = SchemaController; // Returns a promise for a new Schema.

const load = (dbAdapter, schemaCache, options) => {
  const schema = new SchemaController(dbAdapter, schemaCache);
  return schema.reloadData(options).then(() => schema);
};

// Builds a new schema (in schema API response format) out of an
// existing mongo schema + a schemas API put request. This response
// does not include the default fields, as it is intended to be passed
// to mongoSchemaFromFieldsAndClassName. No validation is done here, it
// is done in mongoSchemaFromFieldsAndClassName.
function buildMergedSchemaObject(existingFields, putRequest) {
  const newSchema = {};
  // -disable-next
  const sysSchemaField = Object.keys(defaultColumns).indexOf(existingFields._id) === -1 ? [] : Object.keys(defaultColumns[existingFields._id]);
  for (const oldField in existingFields) {
    if (oldField !== '_id' && oldField !== 'ACL' && oldField !== 'updatedAt' && oldField !== 'createdAt' && oldField !== 'objectId') {
      if (sysSchemaField.length > 0 && sysSchemaField.indexOf(oldField) !== -1) {
        continue;
      }
      const fieldIsDeleted = putRequest[oldField] && putRequest[oldField].__op === 'Delete';
      if (!fieldIsDeleted) {
        newSchema[oldField] = existingFields[oldField];
      }
    }
  }
  for (const newField in putRequest) {
    if (newField !== 'objectId' && putRequest[newField].__op !== 'Delete') {
      if (sysSchemaField.length > 0 && sysSchemaField.indexOf(newField) !== -1) {
        continue;
      }
      newSchema[newField] = putRequest[newField];
    }
  }
  return newSchema;
}

// Given a schema promise, construct another schema promise that
// validates this field once the schema loads.
function thenValidateRequiredColumns(schemaPromise, className, object, query) {
  return schemaPromise.then(schema => {
    return schema.validateRequiredColumns(className, object, query);
  });
}

// Gets the type from a REST API formatted object, where 'type' is
// extended past javascript types to include the rest of the Parse
// type system.
// The output should be a valid schema value.
// TODO: ensure that this is compatible with the format used in Open DB
function getType(obj) {
  const type = typeof obj;
  switch (type) {
    case 'boolean':
      return 'Boolean';
    case 'string':
      return 'String';
    case 'number':
      return 'Number';
    case 'map':
    case 'object':
      if (!obj) {
        return undefined;
      }
      return getObjectType(obj);
    case 'function':
    case 'symbol':
    case 'undefined':
    default:
      throw 'bad obj: ' + obj;
  }
}

// This gets the type for non-JSON types like pointers and files, but
// also gets the appropriate type for $ operators.
// Returns null if the type is unknown.
function getObjectType(obj) {
  if (obj instanceof Array) {
    return 'Array';
  }
  if (obj.__type) {
    switch (obj.__type) {
      case 'Pointer':
        if (obj.className) {
          return {
            type: 'Pointer',
            targetClass: obj.className
          };
        }
        break;
      case 'Relation':
        if (obj.className) {
          return {
            type: 'Relation',
            targetClass: obj.className
          };
        }
        break;
      case 'File':
        if (obj.name) {
          return 'File';
        }
        break;
      case 'Date':
        if (obj.iso) {
          return 'Date';
        }
        break;
      case 'GeoPoint':
        if (obj.latitude != null && obj.longitude != null) {
          return 'GeoPoint';
        }
        break;
      case 'Bytes':
        if (obj.base64) {
          return 'Bytes';
        }
        break;
      case 'Polygon':
        if (obj.coordinates) {
          return 'Polygon';
        }
        break;
    }
    throw new Parse.Error(Parse.Error.INCORRECT_TYPE, "This is not a valid " + obj.__type);
  }
  if (obj['$ne']) {
    return getObjectType(obj['$ne']);
  }
  if (obj.__op) {
    switch (obj.__op) {
      case 'Increment':
        return 'Number';
      case 'Delete':
        return null;
      case 'Add':
      case 'AddUnique':
      case 'Remove':
        return 'Array';
      case 'AddRelation':
      case 'RemoveRelation':
        return {
          type: 'Relation',
          targetClass: obj.objects[0].className
        };
      case 'Batch':
        return getObjectType(obj.ops[0]);
      default:
        throw 'unexpected op: ' + obj.__op;
    }
  }
  return 'Object';
}

exports.load = load;
exports.classNameIsValid = classNameIsValid;
exports.fieldNameIsValid = fieldNameIsValid;
exports.invalidClassNameMessage = invalidClassNameMessage;
exports.buildMergedSchemaObject = buildMergedSchemaObject;
exports.systemClasses = systemClasses;
exports.defaultColumns = defaultColumns;
exports.convertSchemaToAdapterSchema = convertSchemaToAdapterSchema;
exports.VolatileClassesSchemas = VolatileClassesSchemas;
exports.SchemaController = SchemaController;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9TY2hlbWFDb250cm9sbGVyLmpzIl0sIm5hbWVzIjpbIlBhcnNlIiwicmVxdWlyZSIsImRlZmF1bHRDb2x1bW5zIiwiT2JqZWN0IiwiZnJlZXplIiwiX0RlZmF1bHQiLCJ0eXBlIiwiX1VzZXIiLCJfSW5zdGFsbGF0aW9uIiwiX1JvbGUiLCJ0YXJnZXRDbGFzcyIsIl9TZXNzaW9uIiwiX1Byb2R1Y3QiLCJfUHVzaFN0YXR1cyIsIl9Kb2JTdGF0dXMiLCJfSm9iU2NoZWR1bGUiLCJfSG9va3MiLCJfR2xvYmFsQ29uZmlnIiwiX0F1ZGllbmNlIiwiX0V4cG9ydFByb2dyZXNzIiwicmVxdWlyZWRDb2x1bW5zIiwic3lzdGVtQ2xhc3NlcyIsInZvbGF0aWxlQ2xhc3NlcyIsInVzZXJJZFJlZ2V4Iiwicm9sZVJlZ2V4IiwicHVibGljUmVnZXgiLCJyZXF1aXJlQXV0aGVudGljYXRpb25SZWdleCIsInBlcm1pc3Npb25LZXlSZWdleCIsInZlcmlmeVBlcm1pc3Npb25LZXkiLCJrZXkiLCJyZXN1bHQiLCJyZWR1Y2UiLCJpc0dvb2QiLCJyZWdFeCIsIm1hdGNoIiwiRXJyb3IiLCJJTlZBTElEX0pTT04iLCJDTFBWYWxpZEtleXMiLCJ2YWxpZGF0ZUNMUCIsInBlcm1zIiwiZmllbGRzIiwia2V5cyIsImZvckVhY2giLCJvcGVyYXRpb24iLCJpbmRleE9mIiwiQXJyYXkiLCJpc0FycmF5IiwicGVybSIsImpvaW5DbGFzc1JlZ2V4IiwiY2xhc3NBbmRGaWVsZFJlZ2V4IiwiY2xhc3NOYW1lSXNWYWxpZCIsImNsYXNzTmFtZSIsInRlc3QiLCJmaWVsZE5hbWVJc1ZhbGlkIiwiZmllbGROYW1lIiwiZmllbGROYW1lSXNWYWxpZEZvckNsYXNzIiwiaW52YWxpZENsYXNzTmFtZU1lc3NhZ2UiLCJpbnZhbGlkSnNvbkVycm9yIiwidmFsaWROb25SZWxhdGlvbk9yUG9pbnRlclR5cGVzIiwiZmllbGRUeXBlSXNJbnZhbGlkIiwiSU5WQUxJRF9DTEFTU19OQU1FIiwidW5kZWZpbmVkIiwiSU5DT1JSRUNUX1RZUEUiLCJjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hIiwic2NoZW1hIiwiaW5qZWN0RGVmYXVsdFNjaGVtYSIsIkFDTCIsIl9ycGVybSIsIl93cGVybSIsInBhc3N3b3JkIiwiX2hhc2hlZF9wYXNzd29yZCIsImNvbnZlcnRBZGFwdGVyU2NoZW1hVG9QYXJzZVNjaGVtYSIsImF1dGhEYXRhIiwiaW5kZXhlcyIsImxlbmd0aCIsImNsYXNzTGV2ZWxQZXJtaXNzaW9ucyIsImRlZmF1bHRTY2hlbWEiLCJfSG9va3NTY2hlbWEiLCJfR2xvYmFsQ29uZmlnU2NoZW1hIiwiX1B1c2hTdGF0dXNTY2hlbWEiLCJfSm9iU3RhdHVzU2NoZW1hIiwiX0pvYlNjaGVkdWxlU2NoZW1hIiwiX0F1ZGllbmNlU2NoZW1hIiwiVm9sYXRpbGVDbGFzc2VzU2NoZW1hcyIsImRiVHlwZU1hdGNoZXNPYmplY3RUeXBlIiwiZGJUeXBlIiwib2JqZWN0VHlwZSIsInR5cGVUb1N0cmluZyIsIlNjaGVtYUNvbnRyb2xsZXIiLCJjb25zdHJ1Y3RvciIsImRhdGFiYXNlQWRhcHRlciIsInNjaGVtYUNhY2hlIiwiX2RiQWRhcHRlciIsIl9jYWNoZSIsImRhdGEiLCJyZWxvYWREYXRhIiwib3B0aW9ucyIsImNsZWFyQ2FjaGUiLCJwcm9taXNlIiwiUHJvbWlzZSIsInJlc29sdmUiLCJ0aGVuIiwiY2xlYXIiLCJyZWxvYWREYXRhUHJvbWlzZSIsImdldEFsbENsYXNzZXMiLCJhbGxTY2hlbWFzIiwiZXJyIiwiYWxsQ2xhc3NlcyIsIm1hcCIsInNldEFsbENsYXNzZXMiLCJnZXRPbmVTY2hlbWEiLCJhbGxvd1ZvbGF0aWxlQ2xhc3NlcyIsImNhY2hlZCIsImdldENsYXNzIiwic2V0T25lU2NoZW1hIiwiYWRkQ2xhc3NJZk5vdEV4aXN0cyIsInZhbGlkYXRpb25FcnJvciIsInZhbGlkYXRlTmV3Q2xhc3MiLCJyZWplY3QiLCJjcmVhdGVDbGFzcyIsInJlcyIsImNhdGNoIiwiZXJyb3IiLCJjb2RlIiwiRFVQTElDQVRFX1ZBTFVFIiwidXBkYXRlQ2xhc3MiLCJzdWJtaXR0ZWRGaWVsZHMiLCJkYXRhYmFzZSIsImV4aXN0aW5nRmllbGRzIiwibmFtZSIsImZpZWxkIiwiX19vcCIsIm5ld1NjaGVtYSIsImJ1aWxkTWVyZ2VkU2NoZW1hT2JqZWN0IiwiZGVmYXVsdEZpZWxkcyIsImZ1bGxOZXdTY2hlbWEiLCJhc3NpZ24iLCJ2YWxpZGF0ZVNjaGVtYURhdGEiLCJkZWxldGVkRmllbGRzIiwiaW5zZXJ0ZWRGaWVsZHMiLCJwdXNoIiwiZGVsZXRlUHJvbWlzZSIsImRlbGV0ZUZpZWxkcyIsInByb21pc2VzIiwiZW5mb3JjZUZpZWxkRXhpc3RzIiwiYWxsIiwic2V0UGVybWlzc2lvbnMiLCJzZXRJbmRleGVzV2l0aFNjaGVtYUZvcm1hdCIsInJlbG9hZGVkU2NoZW1hIiwiZW5mb3JjZUNsYXNzRXhpc3RzIiwiZXhpc3RpbmdGaWVsZE5hbWVzIiwiSU5WQUxJRF9LRVlfTkFNRSIsIm1lc3NhZ2UiLCJnZW9Qb2ludHMiLCJmaWx0ZXIiLCJzZXRDbGFzc0xldmVsUGVybWlzc2lvbnMiLCJzcGxpdCIsImV4cGVjdGVkVHlwZSIsImdldEV4cGVjdGVkVHlwZSIsImFkZEZpZWxkSWZOb3RFeGlzdHMiLCJkZWxldGVGaWVsZCIsImZpZWxkTmFtZXMiLCJzY2hlbWFGaWVsZHMiLCJhZGFwdGVyIiwiZGVsZXRlQ2xhc3MiLCJ2YWxpZGF0ZU9iamVjdCIsIm9iamVjdCIsInF1ZXJ5IiwiZ2VvY291bnQiLCJleHBlY3RlZCIsImdldFR5cGUiLCJ0aGVuVmFsaWRhdGVSZXF1aXJlZENvbHVtbnMiLCJ2YWxpZGF0ZVJlcXVpcmVkQ29sdW1ucyIsImNvbHVtbnMiLCJtaXNzaW5nQ29sdW1ucyIsImNvbHVtbiIsIm9iamVjdElkIiwidGVzdEJhc2VDTFAiLCJhY2xHcm91cCIsImNsYXNzUGVybXMiLCJzb21lIiwiYWNsIiwidmFsaWRhdGVQZXJtaXNzaW9uIiwiT0JKRUNUX05PVF9GT1VORCIsInBlcm1pc3Npb25GaWVsZCIsIk9QRVJBVElPTl9GT1JCSURERU4iLCJoYXNDbGFzcyIsImxvYWQiLCJkYkFkYXB0ZXIiLCJwdXRSZXF1ZXN0Iiwic3lzU2NoZW1hRmllbGQiLCJfaWQiLCJvbGRGaWVsZCIsImZpZWxkSXNEZWxldGVkIiwibmV3RmllbGQiLCJzY2hlbWFQcm9taXNlIiwib2JqIiwiZ2V0T2JqZWN0VHlwZSIsIl9fdHlwZSIsImlzbyIsImxhdGl0dWRlIiwibG9uZ2l0dWRlIiwiYmFzZTY0IiwiY29vcmRpbmF0ZXMiLCJvYmplY3RzIiwib3BzIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFrQkE7O0FBQ0E7Ozs7Ozs7O0FBbEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsTUFBTUEsUUFBUUMsUUFBUSxZQUFSLEVBQXNCRCxLQUFwQzs7O0FBV0EsTUFBTUUsaUJBQTJDQyxPQUFPQyxNQUFQLENBQWM7QUFDN0Q7QUFDQUMsWUFBVTtBQUNSLGdCQUFhLEVBQUNDLE1BQUssUUFBTixFQURMO0FBRVIsaUJBQWEsRUFBQ0EsTUFBSyxNQUFOLEVBRkw7QUFHUixpQkFBYSxFQUFDQSxNQUFLLE1BQU4sRUFITDtBQUlSLFdBQWEsRUFBQ0EsTUFBSyxLQUFOO0FBSkwsR0FGbUQ7QUFRN0Q7QUFDQUMsU0FBTztBQUNMLGdCQUFpQixFQUFDRCxNQUFLLFFBQU4sRUFEWjtBQUVMLGdCQUFpQixFQUFDQSxNQUFLLFFBQU4sRUFGWjtBQUdMLGFBQWlCLEVBQUNBLE1BQUssUUFBTixFQUhaO0FBSUwscUJBQWlCLEVBQUNBLE1BQUssU0FBTixFQUpaO0FBS0wsZ0JBQWlCLEVBQUNBLE1BQUssUUFBTjtBQUxaLEdBVHNEO0FBZ0I3RDtBQUNBRSxpQkFBZTtBQUNiLHNCQUFvQixFQUFDRixNQUFLLFFBQU4sRUFEUDtBQUViLG1CQUFvQixFQUFDQSxNQUFLLFFBQU4sRUFGUDtBQUdiLGdCQUFvQixFQUFDQSxNQUFL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QUFSLEVBQWM7QUFDWixZQUFPaUUsSUFBSWpFLElBQVg7QUFDQSxXQUFLLFdBQUw7QUFDRSxlQUFPLFFBQVA7QUFDRixXQUFLLFFBQUw7QUFDRSxlQUFPLElBQVA7QUFDRixXQUFLLEtBQUw7QUFDQSxXQUFLLFdBQUw7QUFDQSxXQUFLLFFBQUw7QUFDRSxlQUFPLE9BQVA7QUFDRixXQUFLLGFBQUw7QUFDQSxXQUFLLGdCQUFMO0FBQ0UsZUFBTztBQUNMN0gsZ0JBQU0sVUFERDtBQUVMSSx1QkFBYTBMLElBQUlRLE9BQUosQ0FBWSxDQUFaLEVBQWV6SjtBQUZ2QixTQUFQO0FBSUYsV0FBSyxPQUFMO0FBQ0UsZUFBT2tKLGNBQWNELElBQUlTLEdBQUosQ0FBUSxDQUFSLENBQWQsQ0FBUDtBQUNGO0FBQ0UsY0FBTSxvQkFBb0JULElBQUlqRSxJQUE5QjtBQWxCRjtBQW9CRDtBQUNELFNBQU8sUUFBUDtBQUNEOztRQUdDd0QsSSxHQUFBQSxJO1FBQ0F6SSxnQixHQUFBQSxnQjtRQUNBRyxnQixHQUFBQSxnQjtRQUNBRyx1QixHQUFBQSx1QjtRQUNBNkUsdUIsR0FBQUEsdUI7UUFDQWhILGEsR0FBQUEsYTtRQUNBbkIsYyxHQUFBQSxjO1FBQ0E2RCw0QixHQUFBQSw0QjtRQUNBb0Isc0IsR0FBQUEsc0I7UUFDQUssZ0IsR0FBQUEsZ0IiLCJmaWxlIjoiU2NoZW1hQ29udHJvbGxlci5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEBmbG93XG4vLyBUaGlzIGNsYXNzIGhhbmRsZXMgc2NoZW1hIHZhbGlkYXRpb24sIHBlcnNpc3RlbmNlLCBhbmQgbW9kaWZpY2F0aW9uLlxuLy9cbi8vIEVhY2ggaW5kaXZpZHVhbCBTY2hlbWEgb2JqZWN0IHNob3VsZCBiZSBpbW11dGFibGUuIFRoZSBoZWxwZXJzIHRvXG4vLyBkbyB0aGluZ3Mgd2l0aCB0aGUgU2NoZW1hIGp1c3QgcmV0dXJuIGEgbmV3IHNjaGVtYSB3aGVuIHRoZSBzY2hlbWFcbi8vIGlzIGNoYW5nZWQuXG4vL1xuLy8gVGhlIGNhbm9uaWNhbCBwbGFjZSB0byBzdG9yZSB0aGlzIFNjaGVtYSBpcyBpbiB0aGUgZGF0YWJhc2UgaXRzZWxmLFxuLy8gaW4gYSBfU0NIRU1BIGNvbGxlY3Rpb24uIFRoaXMgaXMgbm90IHRoZSByaWdodCB3YXkgdG8gZG8gaXQgZm9yIGFuXG4vLyBvcGVuIHNvdXJjZSBmcmFtZXdvcmssIGJ1dCBpdCdzIGJhY2t3YXJkIGNvbXBhdGlibGUsIHNvIHdlJ3JlXG4vLyBrZWVwaW5nIGl0IHRoaXMgd2F5IGZvciBub3cuXG4vL1xuLy8gSW4gQVBJLWhhbmRsaW5nIGNvZGUsIHlvdSBzaG91bGQgb25seSB1c2UgdGhlIFNjaGVtYSBjbGFzcyB2aWEgdGhlXG4vLyBEYXRhYmFzZUNvbnRyb2xsZXIuIFRoaXMgd2lsbCBsZXQgdXMgcmVwbGFjZSB0aGUgc2NoZW1hIGxvZ2ljIGZvclxuLy8gZGlmZmVyZW50IGRhdGFiYXNlcy5cbi8vIFRPRE86IGhpZGUgYWxsIHNjaGVtYSBsb2dpYyBpbnNpZGUgdGhlIGRhdGFiYXNlIGFkYXB0ZXIuXG4vLyBAZmxvdy1kaXNhYmxlLW5leHRcbmNvbnN0IFBhcnNlID0gcmVxdWlyZSgncGFyc2Uvbm9kZScpLlBhcnNlO1xuaW1wb3J0IHsgU3RvcmFnZUFkYXB0ZXIgfSAgICAgZnJvbSAnLi4vQWRhcHRlcnMvU3RvcmFnZS9TdG9yYWdlQWRhcHRlcic7XG5pbXBvcnQgRGF0YWJhc2VDb250cm9sbGVyICAgICBmcm9tICcuL0RhdGFiYXNlQ29udHJvbGxlcic7XG5pbXBvcnQgdHlwZSB7XG4gIFNjaGVtYSxcbiAgU2NoZW1hRmllbGRzLFxuICBDbGFzc0xldmVsUGVybWlzc2lvbnMsXG4gIFNjaGVtYUZpZWxkLFxuICBMb2FkU2NoZW1hT3B0aW9ucyxcbn0gZnJvbSAnLi90eXBlcyc7XG5cbmNvbnN0IGRlZmF1bHRDb2x1bW5zOiB7W3N0cmluZ106IFNjaGVtYUZpZWxkc30gPSBPYmplY3QuZnJlZXplKHtcbiAgLy8gQ29udGFpbiB0aGUgZGVmYXVsdCBjb2x1bW5zIGZvciBldmVyeSBwYXJzZSBvYmplY3QgdHlwZSAoZXhjZXB0IF9Kb2luIGNvbGxlY3Rpb24pXG4gIF9EZWZhdWx0OiB7XG4gICAgXCJvYmplY3RJZFwiOiAge3R5cGU6J1N0cmluZyd9LFxuICAgIFwiY3JlYXRlZEF0XCI6IHt0eXBlOidEYXRlJ30sXG4gICAgXCJ1cGRhdGVkQXRcIjoge3R5cGU6J0RhdGUnfSxcbiAgICBcIkFDTFwiOiAgICAgICB7dHlwZTonQUNMJ30sXG4gIH0sXG4gIC8vIFRoZSBhZGRpdGlvbmFsIGRlZmF1bHQgY29sdW1ucyBmb3IgdGhlIF9Vc2VyIGNvbGxlY3Rpb24gKGluIGFkZGl0aW9uIHRvIERlZmF1bHRDb2xzKVxuICBfVXNlcjoge1xuICAgIFwidXNlcm5hbWVcIjogICAgICB7dHlwZTonU3RyaW5nJ30sXG4gICAgXCJwYXNzd29yZFwiOiAgICAgIHt0eXBlOidTdHJpbmcnfSxcbiAgICBcImVtYWlsXCI6ICAgICAgICAge3R5cGU6J1N0cmluZyd9LFxuICAgIFwiZW1haWxWZXJpZmllZFwiOiB7dHlwZTonQm9vbGVhbid9LFxuICAgIFwiYXV0aERhdGFcIjogICAgICB7dHlwZTonT2JqZWN0J31cbiAgfSxcbiAgLy8gVGhlIGFkZGl0aW9uYWwgZGVmYXVsdCBjb2x1bW5zIGZvciB0aGUgX0luc3RhbGxhdGlvbiBjb2xsZWN0aW9uIChpbiBhZGRpdGlvbiB0byBEZWZhdWx0Q29scylcbiAgX0luc3RhbGxhdGlvbjoge1xuICAgIFwiaW5zdGFsbGF0aW9uSWRcIjogICB7dHlwZTonU3RyaW5nJ30sXG4gICAgXCJkZXZpY2VUb2tlblwiOiAgICAgIHt0eXBlOidTdHJpbmcnfSxcbiAgICBcImNoYW5uZWxzXCI6ICAgICAgICAge3R5cGU6J0FycmF5J30sXG4gICAgXCJkZXZpY2VUeXBlXCI6ICAgICAgIHt0eXBlOidTdHJpbmcnfSxcbiAgICBcInB1c2hUeXBlXCI6ICAgICAgICAge3R5cGU6J1N0cmluZyd9LFxuICAgIFwiR0NNU2VuZGVySWRcIjogICAgICB7dHlwZTonU3RyaW5nJ30sXG4gICAgXCJ0aW1lWm9uZVwiOiAgICAgICAgIHt0eXBlOidTdHJpbmcnfSxcbiAgICBcImxvY2FsZUlkZW50aWZpZXJcIjoge3R5cGU6J1N0cmluZyd9LFxuICAgIFwiYmFkZ2VcIjogICAgICAgICAgICB7dHlwZTonTnVtYmVyJ30sXG4gICAgXCJhcHBWZXJzaW9uXCI6ICAgICAgIHt0eXBlOidTdHJpbmcnfSxcbiAgICBcImFwcE5hbWVcIjogICAgICAgICAge3R5cGU6J1N0cmluZyd9LFxuICAgIFwiYXBwSWRlbnRpZmllclwiOiAgICB7dHlwZTonU3RyaW5nJ30sXG4gICAgXCJwYXJzZVZlcnNpb25cIjogICAgIHt0eXBlOidTdHJpbmcnfSxcbiAgfSxcbiAgLy8gVGhlIGFkZGl0aW9uYWwgZGVmYXVsdCBjb2x1bW5zIGZvciB0aGUgX1JvbGUgY29sbGVjdGlvbiAoaW4gYWRkaXRpb24gdG8gRGVmYXVsdENvbHMpXG4gIF9Sb2xlOiB7XG4gICAgXCJuYW1lXCI6ICB7dHlwZTonU3RyaW5nJ30sXG4gICAgXCJ1c2Vyc1wiOiB7dHlwZTonUmVsYXRpb24nLCB0YXJnZXRDbGFzczonX1VzZXInfSxcbiAgICBcInJvbGVzXCI6IHt0eXBlOidSZWxhdGlvbicsIHRhcmdldENsYXNzOidfUm9sZSd9XG4gIH0sXG4gIC8vIFRoZSBhZGRpdGlvbmFsIGRlZmF1bHQgY29sdW1ucyBmb3IgdGhlIF9TZXNzaW9uIGNvbGxlY3Rpb24gKGluIGFkZGl0aW9uIHRvIERlZmF1bHRDb2xzKVxuICBfU2Vzc2lvbjoge1xuICAgIFwicmVzdHJpY3RlZFwiOiAgICAge3R5cGU6J0Jvb2xlYW4nfSxcbiAgICBcInVzZXJcIjogICAgICAgICAgIHt0eXBlOidQb2ludGVyJywgdGFyZ2V0Q2xhc3M6J19Vc2VyJ30sXG4gICAgXCJpbnN0YWxsYXRpb25JZFwiOiB7dHlwZTonU3RyaW5nJ30sXG4gICAgXCJzZXNzaW9uVG9rZW5cIjogICB7dHlwZTonU3RyaW5nJ30sXG4gICAgXCJleHBpcmVzQXRcIjogICAgICB7dHlwZTonRGF0ZSd9LFxuICAgIFwiY3JlYXRlZFdpdGhcIjogICAge3R5cGU6J09iamVjdCd9XG4gIH0sXG4gIF9Qcm9kdWN0OiB7XG4gICAgXCJwcm9kdWN0SWRlbnRpZmllclwiOiAge3R5cGU6J1N0cmluZyd9LFxuICAgIFwiZG93bmxvYWRcIjogICAgICAgICAgIHt0eXBlOidGaWxlJ30sXG4gICAgXCJkb3dubG9hZE5hbWVcIjogICAgICAge3R5cGU6J1N0cmluZyd9LFxuICAgIFwiaWNvblwiOiAgICAgICAgICAgICAgIHt0eXBlOidGaWxlJ30sXG4gICAgXCJvcmRlclwiOiAgICAgICAgICAgICAge3R5cGU6J051bWJlcid9LFxuICAgIFwidGl0bGVcIjogICAgICAgICAgICAgIHt0eXBlOidTdHJpbmcnfSxcbiAgICBcInN1YnRpdGxlXCI6ICAgICAgICAgICB7dHlwZTonU3RyaW5nJ30sXG4gIH0sXG4gIF9QdXNoU3RhdHVzOiB7XG4gICAgXCJwdXNoVGltZVwiOiAgICAgICAgICAgIHt0eXBlOidTdHJpbmcnfSxcbiAgICBcInNvdXJjZVwiOiAgICAgICAgICAgICAge3R5cGU6J1N0cmluZyd9LCAvLyByZXN0IG9yIHdlYnVpXG4gICAgXCJxdWVyeVwiOiAgICAgICAgICAgICAgIHt0eXBlOidTdHJpbmcnfSwgLy8gdGhlIHN0cmluZ2lmaWVkIEpTT04gcXVlcnlcbiAgICBcInBheWxvYWRcIjogICAgICAgICAgICAge3R5cGU6J1N0cmluZyd9LCAvLyB0aGUgc3RyaW5naWZpZWQgSlNPTiBwYXlsb2FkLFxuICAgIFwidGl0bGVcIjogICAgICAgICAgICAgICB7dHlwZTonU3RyaW5nJ30sXG4gICAgXCJleHBpcnlcIjogICAgICAgICAgICAgIHt0eXBlOidOdW1iZXInfSxcbiAgICBcImV4cGlyYXRpb25faW50ZXJ2YWxcIjoge3R5cGU6J051bWJlcid9LFxuICAgIFwic3RhdHVzXCI6ICAgICAgICAgICAgICB7dHlwZTonU3RyaW5nJ30sXG4gICAgXCJudW1TZW50XCI6ICAgICAgICAgICAgIHt0eXBlOidOdW1iZXInfSxcbiAgICBcIm51bUZhaWxlZFwiOiAgICAgICAgICAge3R5cGU6J051bWJlcid9LFxuICAgIFwicHVzaEhhc2hcIjogICAgICAgICAgICB7dHlwZTonU3RyaW5nJ30sXG4gICAgXCJlcnJvck1lc3NhZ2VcIjogICAgICAgIHt0eXBlOidPYmplY3QnfSxcbiAgICBcInNlbnRQZXJUeXBlXCI6ICAgICAgICAge3R5cGU6J09iamVjdCd9LFxuICAgIFwiZmFpbGVkUGVyVHlwZVwiOiAgICAgICB7dHlwZTonT2JqZWN0J30sXG4gICAgXCJzZW50UGVyVVRDT2Zmc2V0XCI6ICAgIHt0eXBlOidPYmplY3QnfSxcbiAgICBcImZhaWxlZFBlclVUQ09mZnNldFwiOiAge3R5cGU6J09iamVjdCd9LFxuICAgIFwiY291bnRcIjogICAgICAgICAgICAgICB7dHlwZTonTnVtYmVyJ30gLy8gdHJhY2tzICMgb2YgYmF0Y2hlcyBxdWV1ZWQgYW5kIHBlbmRpbmdcbiAgfSxcbiAgX0pvYlN0YXR1czoge1xuICAgIFwiam9iTmFtZVwiOiAgICB7dHlwZTogJ1N0cmluZyd9LFxuICAgIFwic291cmNlXCI6ICAgICB7dHlwZTogJ1N0cmluZyd9LFxuICAgIFwic3RhdHVzXCI6ICAgICB7dHlwZTogJ1N0cmluZyd9LFxuICAgIFwibWVzc2FnZVwiOiAgICB7dHlwZTogJ1N0cmluZyd9LFxuICAgIFwicGFyYW1zXCI6ICAgICB7dHlwZTogJ09iamVjdCd9LCAvLyBwYXJhbXMgcmVjZWl2ZWQgd2hlbiBjYWxsaW5nIHRoZSBqb2JcbiAgICBcImZpbmlzaGVkQXRcIjoge3R5cGU6ICdEYXRlJ31cbiAgfSxcbiAgX0pvYlNjaGVkdWxlOiB7XG4gICAgXCJqb2JOYW1lXCI6ICAgICAge3R5cGU6J1N0cmluZyd9LFxuICAgIFwiZGVzY3JpcHRpb25cIjogIHt0eXBlOidTdHJpbmcnfSxcbiAgICBcInBhcmFtc1wiOiAgICAgICB7dHlwZTonU3RyaW5nJ30sXG4gICAgXCJzdGFydEFmdGVyXCI6ICAge3R5cGU6J1N0cmluZyd9LFxuICAgIFwiZGF5c09mV2Vla1wiOiAgIHt0eXBlOidBcnJheSd9LFxuICAgIFwidGltZU9mRGF5XCI6ICAgIHt0eXBlOidTdHJpbmcnfSxcbiAgICBcImxhc3RSdW5cIjogICAgICB7dHlwZTonTnVtYmVyJ30sXG4gICAgXCJyZXBlYXRNaW51dGVzXCI6e3R5cGU6J051bWJlcid9XG4gIH0sXG4gIF9Ib29rczoge1xuICAgIFwiZnVuY3Rpb25OYW1lXCI6IHt0eXBlOidTdHJpbmcnfSxcbiAgICBcImNsYXNzTmFtZVwiOiAgICB7dHlwZTonU3RyaW5nJ30sXG4gICAgXCJ0cmlnZ2VyTmFtZVwiOiAge3R5cGU6J1N0cmluZyd9LFxuICAgIFwidXJsXCI6ICAgICAgICAgIHt0eXBlOidTdHJpbmcnfVxuICB9LFxuICBfR2xvYmFsQ29uZmlnOiB7XG4gICAgXCJvYmplY3RJZFwiOiB7dHlwZTogJ1N0cmluZyd9LFxuICAgIFwicGFyYW1zXCI6ICAge3R5cGU6ICdPYmplY3QnfVxuICB9LFxuICBfQXVkaWVuY2U6IHtcbiAgICBcIm9iamVjdElkXCI6ICB7dHlwZTonU3RyaW5nJ30sXG4gICAgXCJuYW1lXCI6ICAgICAge3R5cGU6J1N0cmluZyd9LFxuICAgIFwicXVlcnlcIjogICAgIHt0eXBlOidTdHJpbmcnfSwgLy9zdG9yaW5nIHF1ZXJ5IGFzIEpTT04gc3RyaW5nIHRvIHByZXZlbnQgXCJOZXN0ZWQga2V5cyBzaG91bGQgbm90IGNvbnRhaW4gdGhlICckJyBvciAnLicgY2hhcmFjdGVyc1wiIGVycm9yXG4gICAgXCJsYXN0VXNlZFwiOiAge3R5cGU6J0RhdGUnfSxcbiAgICBcInRpbWVzVXNlZFwiOiB7dHlwZTonTnVtYmVyJ31cbiAgfSxcbiAgX0V4cG9ydFByb2dyZXNzOiB7XG4gICAgXCJvYmplY3RJZFwiOiAgICAgIHt0eXBlOidTdHJpbmcnfSxcbiAgICBcImlkXCI6ICAgICAgICAgICAge3R5cGU6J1N0cmluZyd9LFxuICAgIFwibWFzdGVyS2V5XCI6ICAgICB7dHlwZTonU3RyaW5nJ30sXG4gICAgXCJhcHBsaWNhdGlvbklkXCI6IHt0eXBlOidTdHJpbmcnfVxuICB9XG59KTtcblxuY29uc3QgcmVxdWlyZWRDb2x1bW5zID0gT2JqZWN0LmZyZWV6ZSh7XG4gIF9Qcm9kdWN0OiBbXCJwcm9kdWN0SWRlbnRpZmllclwiLCBcImljb25cIiwgXCJvcmRlclwiLCBcInRpdGxlXCIsIFwic3VidGl0bGVcIl0sXG4gIF9Sb2xlOiBbXCJuYW1lXCIsIFwiQUNMXCJdXG59KTtcblxuY29uc3Qgc3lzdGVtQ2xhc3NlcyA9IE9iamVjdC5mcmVlemUoWydfVXNlcicsICdfSW5zdGFsbGF0aW9uJywgJ19Sb2xlJywgJ19TZXNzaW9uJywgJ19Qcm9kdWN0JywgJ19QdXNoU3RhdHVzJywgJ19Kb2JTdGF0dXMnLCAnX0pvYlNjaGVkdWxlJywgJ19BdWRpZW5jZScsICAnX0V4cG9ydFByb2dyZXNzJyBdKTtcblxuY29uc3Qgdm9sYXRpbGVDbGFzc2VzID0gT2JqZWN0LmZyZWV6ZShbJ19Kb2JTdGF0dXMnLCAnX1B1c2hTdGF0dXMnLCAnX0hvb2tzJywgJ19HbG9iYWxDb25maWcnLCAnX0pvYlNjaGVkdWxlJywgJ19BdWRpZW5jZScsICdfRXhwb3J0UHJvZ3Jlc3MnXSk7XG5cbi8vIDEwIGFscGhhIG51bWJlcmljIGNoYXJzICsgdXBwZXJjYXNlXG5jb25zdCB1c2VySWRSZWdleCA9IC9eW2EtekEtWjAtOV17MTB9JC87XG4vLyBBbnl0aGluZyB0aGF0IHN0YXJ0IHdpdGggcm9sZVxuY29uc3Qgcm9sZVJlZ2V4ID0gL15yb2xlOi4qLztcbi8vICogcGVybWlzc2lvblxuY29uc3QgcHVibGljUmVnZXggPSAvXlxcKiQvXG5cbmNvbnN0IHJlcXVpcmVBdXRoZW50aWNhdGlvblJlZ2V4ID0gL15yZXF1aXJlc0F1dGhlbnRpY2F0aW9uJC9cblxuY29uc3QgcGVybWlzc2lvbktleVJlZ2V4ID0gT2JqZWN0LmZyZWV6ZShbdXNlcklkUmVnZXgsIHJvbGVSZWdleCwgcHVibGljUmVnZXgsIHJlcXVpcmVBdXRoZW50aWNhdGlvblJlZ2V4XSk7XG5cbmZ1bmN0aW9uIHZlcmlmeVBlcm1pc3Npb25LZXkoa2V5KSB7XG4gIGNvbnN0IHJlc3VsdCA9IHBlcm1pc3Npb25LZXlSZWdleC5yZWR1Y2UoKGlzR29vZCwgcmVnRXgpID0+IHtcbiAgICBpc0dvb2QgPSBpc0dvb2QgfHwga2V5Lm1hdGNoKHJlZ0V4KSAhPSBudWxsO1xuICAgIHJldHVybiBpc0dvb2Q7XG4gIH0sIGZhbHNlKTtcbiAgaWYgKCFyZXN1bHQpIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCBgJyR7a2V5fScgaXMgbm90IGEgdmFsaWQga2V5IGZvciBjbGFzcyBsZXZlbCBwZXJtaXNzaW9uc2ApO1xuICB9XG59XG5cbmNvbnN0IENMUFZhbGlkS2V5cyA9IE9iamVjdC5mcmVlemUoWydmaW5kJywgJ2NvdW50JywgJ2dldCcsICdjcmVhdGUnLCAndXBkYXRlJywgJ2RlbGV0ZScsICdhZGRGaWVsZCcsICdyZWFkVXNlckZpZWxkcycsICd3cml0ZVVzZXJGaWVsZHMnXSk7XG5mdW5jdGlvbiB2YWxpZGF0ZUNMUChwZXJtczogQ2xhc3NMZXZlbFBlcm1pc3Npb25zLCBmaWVsZHM6IFNjaGVtYUZpZWxkcykge1xuICBpZiAoIXBlcm1zKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIE9iamVjdC5rZXlzKHBlcm1zKS5mb3JFYWNoKChvcGVyYXRpb24pID0+IHtcbiAgICBpZiAoQ0xQVmFsaWRLZXlzLmluZGV4T2Yob3BlcmF0aW9uKSA9PSAtMSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgYCR7b3BlcmF0aW9ufSBpcyBub3QgYSB2YWxpZCBvcGVyYXRpb24gZm9yIGNsYXNzIGxldmVsIHBlcm1pc3Npb25zYCk7XG4gICAgfVxuICAgIGlmICghcGVybXNbb3BlcmF0aW9uXSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChvcGVyYXRpb24gPT09ICdyZWFkVXNlckZpZWxkcycgfHwgb3BlcmF0aW9uID09PSAnd3JpdGVVc2VyRmllbGRzJykge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHBlcm1zW29wZXJhdGlvbl0pKSB7XG4gICAgICAgIC8vIEBmbG93LWRpc2FibGUtbmV4dFxuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCBgJyR7cGVybXNbb3BlcmF0aW9uXX0nIGlzIG5vdCBhIHZhbGlkIHZhbHVlIGZvciBjbGFzcyBsZXZlbCBwZXJtaXNzaW9ucyAke29wZXJhdGlvbn1gKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBlcm1zW29wZXJhdGlvbl0uZm9yRWFjaCgoa2V5KSA9PiB7XG4gICAgICAgICAgaWYgKCFmaWVsZHNba2V5XSB8fCBmaWVsZHNba2V5XS50eXBlICE9ICdQb2ludGVyJyB8fCBmaWVsZHNba2V5XS50YXJnZXRDbGFzcyAhPSAnX1VzZXInKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCBgJyR7a2V5fScgaXMgbm90IGEgdmFsaWQgY29sdW1uIGZvciBjbGFzcyBsZXZlbCBwb2ludGVyIHBlcm1pc3Npb25zICR7b3BlcmF0aW9ufWApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG4gICAgT2JqZWN0LmtleXMocGVybXNbb3BlcmF0aW9uXSkuZm9yRWFjaCgoa2V5KSA9PiB7XG4gICAgICB2ZXJpZnlQZXJtaXNzaW9uS2V5KGtleSk7XG4gICAgICAvLyBAZmxvdy1kaXNhYmxlLW5leHRcbiAgICAgIGNvbnN0IHBlcm0gPSBwZXJtc1tvcGVyYXRpb25dW2tleV07XG4gICAgICBpZiAocGVybSAhPT0gdHJ1ZSkge1xuICAgICAgICAvLyBAZmxvdy1kaXNhYmxlLW5leHRcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgYCcke3Blcm19JyBpcyBub3QgYSB2YWxpZCB2YWx1ZSBmb3IgY2xhc3MgbGV2ZWwgcGVybWlzc2lvbnMgJHtvcGVyYXRpb259OiR7a2V5fToke3Blcm19YCk7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xufVxuY29uc3Qgam9pbkNsYXNzUmVnZXggPSAvXl9Kb2luOltBLVphLXowLTlfXSs6W0EtWmEtejAtOV9dKy87XG5jb25zdCBjbGFzc0FuZEZpZWxkUmVnZXggPSAvXltBLVphLXpdW0EtWmEtejAtOV9dKiQvO1xuZnVuY3Rpb24gY2xhc3NOYW1lSXNWYWxpZChjbGFzc05hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAvLyBWYWxpZCBjbGFzc2VzIG11c3Q6XG4gIHJldHVybiAoXG4gICAgLy8gQmUgb25lIG9mIF9Vc2VyLCBfSW5zdGFsbGF0aW9uLCBfUm9sZSwgX1Nlc3Npb24gT1JcbiAgICBzeXN0ZW1DbGFzc2VzLmluZGV4T2YoY2xhc3NOYW1lKSA+IC0xIHx8XG4gICAgLy8gQmUgYSBqb2luIHRhYmxlIE9SXG4gICAgam9pbkNsYXNzUmVnZXgudGVzdChjbGFzc05hbWUpIHx8XG4gICAgLy8gSW5jbHVkZSBvbmx5IGFscGhhLW51bWVyaWMgYW5kIHVuZGVyc2NvcmVzLCBhbmQgbm90IHN0YXJ0IHdpdGggYW4gdW5kZXJzY29yZSBvciBudW1iZXJcbiAgICBmaWVsZE5hbWVJc1ZhbGlkKGNsYXNzTmFtZSlcbiAgKTtcbn1cblxuLy8gVmFsaWQgZmllbGRzIG11c3QgYmUgYWxwaGEtbnVtZXJpYywgYW5kIG5vdCBzdGFydCB3aXRoIGFuIHVuZGVyc2NvcmUgb3IgbnVtYmVyXG5mdW5jdGlvbiBmaWVsZE5hbWVJc1ZhbGlkKGZpZWxkTmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBjbGFzc0FuZEZpZWxkUmVnZXgudGVzdChmaWVsZE5hbWUpO1xufVxuXG4vLyBDaGVja3MgdGhhdCBpdCdzIG5vdCB0cnlpbmcgdG8gY2xvYmJlciBvbmUgb2YgdGhlIGRlZmF1bHQgZmllbGRzIG9mIHRoZSBjbGFzcy5cbmZ1bmN0aW9uIGZpZWxkTmFtZUlzVmFsaWRGb3JDbGFzcyhmaWVsZE5hbWU6IHN0cmluZywgY2xhc3NOYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgaWYgKCFmaWVsZE5hbWVJc1ZhbGlkKGZpZWxkTmFtZSkpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKGRlZmF1bHRDb2x1bW5zLl9EZWZhdWx0W2ZpZWxkTmFtZV0pIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKGRlZmF1bHRDb2x1bW5zW2NsYXNzTmFtZV0gJiYgZGVmYXVsdENvbHVtbnNbY2xhc3NOYW1lXVtmaWVsZE5hbWVdKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHJldHVybiB0cnVlO1xufVxuXG5mdW5jdGlvbiBpbnZhbGlkQ2xhc3NOYW1lTWVzc2FnZShjbGFzc05hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiAnSW52YWxpZCBjbGFzc25hbWU6ICcgKyBjbGFzc05hbWUgKyAnLCBjbGFzc25hbWVzIGNhbiBvbmx5IGhhdmUgYWxwaGFudW1lcmljIGNoYXJhY3RlcnMgYW5kIF8sIGFuZCBtdXN0IHN0YXJ0IHdpdGggYW4gYWxwaGEgY2hhcmFjdGVyICc7XG59XG5cbmNvbnN0IGludmFsaWRKc29uRXJyb3IgPSBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCBcImludmFsaWQgSlNPTlwiKTtcbmNvbnN0IHZhbGlkTm9uUmVsYXRpb25PclBvaW50ZXJUeXBlcyA9IFtcbiAgJ051bWJlcicsXG4gICdTdHJpbmcnLFxuICAnQm9vbGVhbicsXG4gICdEYXRlJyxcbiAgJ09iamVjdCcsXG4gICdBcnJheScsXG4gICdHZW9Qb2ludCcsXG4gICdGaWxlJyxcbiAgJ0J5dGVzJyxcbiAgJ1BvbHlnb24nXG5dO1xuLy8gUmV0dXJucyBhbiBlcnJvciBzdWl0YWJsZSBmb3IgdGhyb3dpbmcgaWYgdGhlIHR5cGUgaXMgaW52YWxpZFxuY29uc3QgZmllbGRUeXBlSXNJbnZhbGlkID0gKHsgdHlwZSwgdGFyZ2V0Q2xhc3MgfSkgPT4ge1xuICBpZiAoWydQb2ludGVyJywgJ1JlbGF0aW9uJ10uaW5kZXhPZih0eXBlKSA+PSAwKSB7XG4gICAgaWYgKCF0YXJnZXRDbGFzcykge1xuICAgICAgcmV0dXJuIG5ldyBQYXJzZS5FcnJvcigxMzUsIGB0eXBlICR7dHlwZX0gbmVlZHMgYSBjbGFzcyBuYW1lYCk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgdGFyZ2V0Q2xhc3MgIT09ICdzdHJpbmcnKSB7XG4gICAgICByZXR1cm4gaW52YWxpZEpzb25FcnJvcjtcbiAgICB9IGVsc2UgaWYgKCFjbGFzc05hbWVJc1ZhbGlkKHRhcmdldENsYXNzKSkge1xuICAgICAgcmV0dXJuIG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0NMQVNTX05BTUUsIGludmFsaWRDbGFzc05hbWVNZXNzYWdlKHRhcmdldENsYXNzKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICB9XG4gIGlmICh0eXBlb2YgdHlwZSAhPT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gaW52YWxpZEpzb25FcnJvcjtcbiAgfVxuICBpZiAodmFsaWROb25SZWxhdGlvbk9yUG9pbnRlclR5cGVzLmluZGV4T2YodHlwZSkgPCAwKSB7XG4gICAgcmV0dXJuIG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTkNPUlJFQ1RfVFlQRSwgYGludmFsaWQgZmllbGQgdHlwZTogJHt0eXBlfWApO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbmNvbnN0IGNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEgPSAoc2NoZW1hOiBhbnkpID0+IHtcbiAgc2NoZW1hID0gaW5qZWN0RGVmYXVsdFNjaGVtYShzY2hlbWEpO1xuICBkZWxldGUgc2NoZW1hLmZpZWxkcy5BQ0w7XG4gIHNjaGVtYS5maWVsZHMuX3JwZXJtID0geyB0eXBlOiAnQXJyYXknIH07XG4gIHNjaGVtYS5maWVsZHMuX3dwZXJtID0geyB0eXBlOiAnQXJyYXknIH07XG5cbiAgaWYgKHNjaGVtYS5jbGFzc05hbWUgPT09ICdfVXNlcicpIHtcbiAgICBkZWxldGUgc2NoZW1hLmZpZWxkcy5wYXNzd29yZDtcbiAgICBzY2hlbWEuZmllbGRzLl9oYXNoZWRfcGFzc3dvcmQgPSB7IHR5cGU6ICdTdHJpbmcnIH07XG4gIH1cblxuICByZXR1cm4gc2NoZW1hO1xufVxuXG5jb25zdCBjb252ZXJ0QWRhcHRlclNjaGVtYVRvUGFyc2VTY2hlbWEgPSAoey4uLnNjaGVtYX0pID0+IHtcbiAgZGVsZXRlIHNjaGVtYS5maWVsZHMuX3JwZXJtO1xuICBkZWxldGUgc2NoZW1hLmZpZWxkcy5fd3Blcm07XG5cbiAgc2NoZW1hLmZpZWxkcy5BQ0wgPSB7IHR5cGU6ICdBQ0wnIH07XG5cbiAgaWYgKHNjaGVtYS5jbGFzc05hbWUgPT09ICdfVXNlcicpIHtcbiAgICBkZWxldGUgc2NoZW1hLmZpZWxkcy5hdXRoRGF0YTsgLy9BdXRoIGRhdGEgaXMgaW1wbGljaXRcbiAgICBkZWxldGUgc2NoZW1hLmZpZWxkcy5faGFzaGVkX3Bhc3N3b3JkO1xuICAgIHNjaGVtYS5maWVsZHMucGFzc3dvcmQgPSB7IHR5cGU6ICdTdHJpbmcnIH07XG4gIH1cblxuICBpZiAoc2NoZW1hLmluZGV4ZXMgJiYgT2JqZWN0LmtleXMoc2NoZW1hLmluZGV4ZXMpLmxlbmd0aCA9PT0gMCkge1xuICAgIGRlbGV0ZSBzY2hlbWEuaW5kZXhlcztcbiAgfVxuXG4gIHJldHVybiBzY2hlbWE7XG59XG5cbmNvbnN0IGluamVjdERlZmF1bHRTY2hlbWEgPSAoe2NsYXNzTmFtZSwgZmllbGRzLCBjbGFzc0xldmVsUGVybWlzc2lvbnMsIGluZGV4ZXN9OiBTY2hlbWEpID0+IHtcbiAgY29uc3QgZGVmYXVsdFNjaGVtYTogU2NoZW1hID0ge1xuICAgIGNsYXNzTmFtZSxcbiAgICBmaWVsZHM6IHtcbiAgICAgIC4uLmRlZmF1bHRDb2x1bW5zLl9EZWZhdWx0LFxuICAgICAgLi4uKGRlZmF1bHRDb2x1bW5zW2NsYXNzTmFtZV0gfHwge30pLFxuICAgICAgLi4uZmllbGRzLFxuICAgIH0sXG4gICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zLFxuICB9O1xuICBpZiAoaW5kZXhlcyAmJiBPYmplY3Qua2V5cyhpbmRleGVzKS5sZW5ndGggIT09IDApIHtcbiAgICBkZWZhdWx0U2NoZW1hLmluZGV4ZXMgPSBpbmRleGVzO1xuICB9XG4gIHJldHVybiBkZWZhdWx0U2NoZW1hO1xufTtcblxuY29uc3QgX0hvb2tzU2NoZW1hID0gIHtjbGFzc05hbWU6IFwiX0hvb2tzXCIsIGZpZWxkczogZGVmYXVsdENvbHVtbnMuX0hvb2tzfTtcbmNvbnN0IF9HbG9iYWxDb25maWdTY2hlbWEgPSB7IGNsYXNzTmFtZTogXCJfR2xvYmFsQ29uZmlnXCIsIGZpZWxkczogZGVmYXVsdENvbHVtbnMuX0dsb2JhbENvbmZpZyB9XG5jb25zdCBfUHVzaFN0YXR1c1NjaGVtYSA9IGNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEoaW5qZWN0RGVmYXVsdFNjaGVtYSh7XG4gIGNsYXNzTmFtZTogXCJfUHVzaFN0YXR1c1wiLFxuICBmaWVsZHM6IHt9LFxuICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IHt9XG59KSk7XG5jb25zdCBfSm9iU3RhdHVzU2NoZW1hID0gY29udmVydFNjaGVtYVRvQWRhcHRlclNjaGVtYShpbmplY3REZWZhdWx0U2NoZW1hKHtcbiAgY2xhc3NOYW1lOiBcIl9Kb2JTdGF0dXNcIixcbiAgZmllbGRzOiB7fSxcbiAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiB7fVxufSkpO1xuY29uc3QgX0pvYlNjaGVkdWxlU2NoZW1hID0gY29udmVydFNjaGVtYVRvQWRhcHRlclNjaGVtYShpbmplY3REZWZhdWx0U2NoZW1hKHtcbiAgY2xhc3NOYW1lOiBcIl9Kb2JTY2hlZHVsZVwiLFxuICBmaWVsZHM6IHt9LFxuICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IHt9XG59KSk7XG5jb25zdCBfQXVkaWVuY2VTY2hlbWEgPSBjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hKGluamVjdERlZmF1bHRTY2hlbWEoe1xuICBjbGFzc05hbWU6IFwiX0F1ZGllbmNlXCIsXG4gIGZpZWxkczogZGVmYXVsdENvbHVtbnMuX0F1ZGllbmNlLFxuICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IHt9XG59KSk7XG5jb25zdCBWb2xhdGlsZUNsYXNzZXNTY2hlbWFzID0gW19Ib29rc1NjaGVtYSwgX0pvYlN0YXR1c1NjaGVtYSwgX0pvYlNjaGVkdWxlU2NoZW1hLCBfUHVzaFN0YXR1c1NjaGVtYSwgX0dsb2JhbENvbmZpZ1NjaGVtYSwgX0F1ZGllbmNlU2NoZW1hXTtcblxuY29uc3QgZGJUeXBlTWF0Y2hlc09iamVjdFR5cGUgPSAoZGJUeXBlOiBTY2hlbWFGaWVsZCB8IHN0cmluZywgb2JqZWN0VHlwZTogU2NoZW1hRmllbGQpID0+IHtcbiAgaWYgKGRiVHlwZS50eXBlICE9PSBvYmplY3RUeXBlLnR5cGUpIHJldHVybiBmYWxzZTtcbiAgaWYgKGRiVHlwZS50YXJnZXRDbGFzcyAhPT0gb2JqZWN0VHlwZS50YXJnZXRDbGFzcykgcmV0dXJuIGZhbHNlO1xuICBpZiAoZGJUeXBlID09PSBvYmplY3RUeXBlLnR5cGUpIHJldHVybiB0cnVlO1xuICBpZiAoZGJUeXBlLnR5cGUgPT09IG9iamVjdFR5cGUudHlwZSkgcmV0dXJuIHRydWU7XG4gIHJldHVybiBmYWxzZTtcbn1cblxuY29uc3QgdHlwZVRvU3RyaW5nID0gKHR5cGU6IFNjaGVtYUZpZWxkIHwgc3RyaW5nKTogc3RyaW5nID0+IHtcbiAgaWYgKHR5cGVvZiB0eXBlID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiB0eXBlO1xuICB9XG4gIGlmICh0eXBlLnRhcmdldENsYXNzKSB7XG4gICAgcmV0dXJuIGAke3R5cGUudHlwZX08JHt0eXBlLnRhcmdldENsYXNzfT5gO1xuICB9XG4gIHJldHVybiBgJHt0eXBlLnR5cGV9YDtcbn1cblxuLy8gU3RvcmVzIHRoZSBlbnRpcmUgc2NoZW1hIG9mIHRoZSBhcHAgaW4gYSB3ZWlyZCBoeWJyaWQgZm9ybWF0IHNvbWV3aGVyZSBiZXR3ZWVuXG4vLyB0aGUgbW9uZ28gZm9ybWF0IGFuZCB0aGUgUGFyc2UgZm9ybWF0LiBTb29uLCB0aGlzIHdpbGwgYWxsIGJlIFBhcnNlIGZvcm1hdC5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFNjaGVtYUNvbnRyb2xsZXIge1xuICBfZGJBZGFwdGVyOiBTdG9yYWdlQWRhcHRlcjtcbiAgZGF0YTogYW55O1xuICBwZXJtczogYW55O1xuICBpbmRleGVzOiBhbnk7XG4gIF9jYWNoZTogYW55O1xuICByZWxvYWREYXRhUHJvbWlzZTogUHJvbWlzZTxhbnk+O1xuXG4gIGNvbnN0cnVjdG9yKGRhdGFiYXNlQWRhcHRlcjogU3RvcmFnZUFkYXB0ZXIsIHNjaGVtYUNhY2hlOiBhbnkpIHtcbiAgICB0aGlzLl9kYkFkYXB0ZXIgPSBkYXRhYmFzZUFkYXB0ZXI7XG4gICAgdGhpcy5fY2FjaGUgPSBzY2hlbWFDYWNoZTtcbiAgICAvLyB0aGlzLmRhdGFbY2xhc3NOYW1lXVtmaWVsZE5hbWVdIHRlbGxzIHlvdSB0aGUgdHlwZSBvZiB0aGF0IGZpZWxkLCBpbiBtb25nbyBmb3JtYXRcbiAgICB0aGlzLmRhdGEgPSB7fTtcbiAgICAvLyB0aGlzLnBlcm1zW2NsYXNzTmFtZV1bb3BlcmF0aW9uXSB0ZWxscyB5b3UgdGhlIGFjbC1zdHlsZSBwZXJtaXNzaW9uc1xuICAgIHRoaXMucGVybXMgPSB7fTtcbiAgICAvLyB0aGlzLmluZGV4ZXNbY2xhc3NOYW1lXVtvcGVyYXRpb25dIHRlbGxzIHlvdSB0aGUgaW5kZXhlc1xuICAgIHRoaXMuaW5kZXhlcyA9IHt9O1xuICB9XG5cbiAgcmVsb2FkRGF0YShvcHRpb25zOiBMb2FkU2NoZW1hT3B0aW9ucyA9IHtjbGVhckNhY2hlOiBmYWxzZX0pOiBQcm9taXNlPGFueT4ge1xuICAgIGxldCBwcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgaWYgKG9wdGlvbnMuY2xlYXJDYWNoZSkge1xuICAgICAgcHJvbWlzZSA9IHByb21pc2UudGhlbigoKSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLl9jYWNoZS5jbGVhcigpO1xuICAgICAgfSk7XG4gICAgfVxuICAgIGlmICh0aGlzLnJlbG9hZERhdGFQcm9taXNlICYmICFvcHRpb25zLmNsZWFyQ2FjaGUpIHtcbiAgICAgIHJldHVybiB0aGlzLnJlbG9hZERhdGFQcm9taXNlO1xuICAgIH1cbiAgICB0aGlzLnJlbG9hZERhdGFQcm9taXNlID0gcHJvbWlzZS50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmdldEFsbENsYXNzZXMob3B0aW9ucykudGhlbigoYWxsU2NoZW1hcykgPT4ge1xuICAgICAgICBjb25zdCBkYXRhID0ge307XG4gICAgICAgIGNvbnN0IHBlcm1zID0ge307XG4gICAgICAgIGNvbnN0IGluZGV4ZXMgPSB7fTtcbiAgICAgICAgYWxsU2NoZW1hcy5mb3JFYWNoKHNjaGVtYSA9PiB7XG4gICAgICAgICAgZGF0YVtzY2hlbWEuY2xhc3NOYW1lXSA9IGluamVjdERlZmF1bHRTY2hlbWEoc2NoZW1hKS5maWVsZHM7XG4gICAgICAgICAgcGVybXNbc2NoZW1hLmNsYXNzTmFtZV0gPSBzY2hlbWEuY2xhc3NMZXZlbFBlcm1pc3Npb25zO1xuICAgICAgICAgIGluZGV4ZXNbc2NoZW1hLmNsYXNzTmFtZV0gPSBzY2hlbWEuaW5kZXhlcztcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gSW5qZWN0IHRoZSBpbi1tZW1vcnkgY2xhc3Nlc1xuICAgICAgICB2b2xhdGlsZUNsYXNzZXMuZm9yRWFjaChjbGFzc05hbWUgPT4ge1xuICAgICAgICAgIGNvbnN0IHNjaGVtYSA9IGluamVjdERlZmF1bHRTY2hlbWEoeyBjbGFzc05hbWUsIGZpZWxkczoge30sIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczoge30gfSk7XG4gICAgICAgICAgZGF0YVtjbGFzc05hbWVdID0gc2NoZW1hLmZpZWxkcztcbiAgICAgICAgICBwZXJtc1tjbGFzc05hbWVdID0gc2NoZW1hLmNsYXNzTGV2ZWxQZXJtaXNzaW9ucztcbiAgICAgICAgICBpbmRleGVzW2NsYXNzTmFtZV0gPSBzY2hlbWEuaW5kZXhlcztcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMuZGF0YSA9IGRhdGE7XG4gICAgICAgIHRoaXMucGVybXMgPSBwZXJtcztcbiAgICAgICAgdGhpcy5pbmRleGVzID0gaW5kZXhlcztcbiAgICAgICAgZGVsZXRlIHRoaXMucmVsb2FkRGF0YVByb21pc2U7XG4gICAgICB9LCAoZXJyKSA9PiB7XG4gICAgICAgIHRoaXMuZGF0YSA9IHt9O1xuICAgICAgICB0aGlzLnBlcm1zID0ge307XG4gICAgICAgIHRoaXMuaW5kZXhlcyA9IHt9O1xuICAgICAgICBkZWxldGUgdGhpcy5yZWxvYWREYXRhUHJvbWlzZTtcbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfSlcbiAgICB9KS50aGVuKCgpID0+IHt9KTtcbiAgICByZXR1cm4gdGhpcy5yZWxvYWREYXRhUHJvbWlzZTtcbiAgfVxuXG4gIGdldEFsbENsYXNzZXMob3B0aW9uczogTG9hZFNjaGVtYU9wdGlvbnMgPSB7Y2xlYXJDYWNoZTogZmFsc2V9KTogUHJvbWlzZTxBcnJheTxTY2hlbWE+PiB7XG4gICAgbGV0IHByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKTtcbiAgICBpZiAob3B0aW9ucy5jbGVhckNhY2hlKSB7XG4gICAgICBwcm9taXNlID0gdGhpcy5fY2FjaGUuY2xlYXIoKTtcbiAgICB9XG4gICAgcmV0dXJuIHByb21pc2UudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5fY2FjaGUuZ2V0QWxsQ2xhc3NlcygpXG4gICAgfSkudGhlbigoYWxsQ2xhc3NlcykgPT4ge1xuICAgICAgaWYgKGFsbENsYXNzZXMgJiYgYWxsQ2xhc3Nlcy5sZW5ndGggJiYgIW9wdGlvbnMuY2xlYXJDYWNoZSkge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGFsbENsYXNzZXMpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXMuX2RiQWRhcHRlci5nZXRBbGxDbGFzc2VzKClcbiAgICAgICAgLnRoZW4oYWxsU2NoZW1hcyA9PiBhbGxTY2hlbWFzLm1hcChpbmplY3REZWZhdWx0U2NoZW1hKSlcbiAgICAgICAgLnRoZW4oYWxsU2NoZW1hcyA9PiB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMuX2NhY2hlLnNldEFsbENsYXNzZXMoYWxsU2NoZW1hcykudGhlbigoKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gYWxsU2NoZW1hcztcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSlcbiAgICB9KTtcbiAgfVxuXG4gIGdldE9uZVNjaGVtYShjbGFzc05hbWU6IHN0cmluZywgYWxsb3dWb2xhdGlsZUNsYXNzZXM6IGJvb2xlYW4gPSBmYWxzZSwgb3B0aW9uczogTG9hZFNjaGVtYU9wdGlvbnMgPSB7Y2xlYXJDYWNoZTogZmFsc2V9KTogUHJvbWlzZTxTY2hlbWE+IHtcbiAgICBsZXQgcHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xuICAgIGlmIChvcHRpb25zLmNsZWFyQ2FjaGUpIHtcbiAgICAgIHByb21pc2UgPSB0aGlzLl9jYWNoZS5jbGVhcigpO1xuICAgIH1cbiAgICByZXR1cm4gcHJvbWlzZS50aGVuKCgpID0+IHtcbiAgICAgIGlmIChhbGxvd1ZvbGF0aWxlQ2xhc3NlcyAmJiB2b2xhdGlsZUNsYXNzZXMuaW5kZXhPZihjbGFzc05hbWUpID4gLTEpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7XG4gICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgIGZpZWxkczogdGhpcy5kYXRhW2NsYXNzTmFtZV0sXG4gICAgICAgICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiB0aGlzLnBlcm1zW2NsYXNzTmFtZV0sXG4gICAgICAgICAgaW5kZXhlczogdGhpcy5pbmRleGVzW2NsYXNzTmFtZV1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gdGhpcy5fY2FjaGUuZ2V0T25lU2NoZW1hKGNsYXNzTmFtZSkudGhlbigoY2FjaGVkKSA9PiB7XG4gICAgICAgIGlmIChjYWNoZWQgJiYgIW9wdGlvbnMuY2xlYXJDYWNoZSkge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoY2FjaGVkKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5fZGJBZGFwdGVyLmdldENsYXNzKGNsYXNzTmFtZSlcbiAgICAgICAgICAudGhlbihpbmplY3REZWZhdWx0U2NoZW1hKVxuICAgICAgICAgIC50aGVuKChyZXN1bHQpID0+IHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9jYWNoZS5zZXRPbmVTY2hlbWEoY2xhc3NOYW1lLCByZXN1bHQpLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gQ3JlYXRlIGEgbmV3IGNsYXNzIHRoYXQgaW5jbHVkZXMgdGhlIHRocmVlIGRlZmF1bHQgZmllbGRzLlxuICAvLyBBQ0wgaXMgYW4gaW1wbGljaXQgY29sdW1uIHRoYXQgZG9lcyBub3QgZ2V0IGFuIGVudHJ5IGluIHRoZVxuICAvLyBfU0NIRU1BUyBkYXRhYmFzZS4gUmV0dXJucyBhIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aXRoIHRoZVxuICAvLyBjcmVhdGVkIHNjaGVtYSwgaW4gbW9uZ28gZm9ybWF0LlxuICAvLyBvbiBzdWNjZXNzLCBhbmQgcmVqZWN0cyB3aXRoIGFuIGVycm9yIG9uIGZhaWwuIEVuc3VyZSB5b3VcbiAgLy8gaGF2ZSBhdXRob3JpemF0aW9uIChtYXN0ZXIga2V5LCBvciBjbGllbnQgY2xhc3MgY3JlYXRpb25cbiAgLy8gZW5hYmxlZCkgYmVmb3JlIGNhbGxpbmcgdGhpcyBmdW5jdGlvbi5cbiAgYWRkQ2xhc3NJZk5vdEV4aXN0cyhjbGFzc05hbWU6IHN0cmluZywgZmllbGRzOiBTY2hlbWFGaWVsZHMgPSB7fSwgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiBhbnksIGluZGV4ZXM6IGFueSA9IHt9KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdmFyIHZhbGlkYXRpb25FcnJvciA9IHRoaXMudmFsaWRhdGVOZXdDbGFzcyhjbGFzc05hbWUsIGZpZWxkcywgY2xhc3NMZXZlbFBlcm1pc3Npb25zKTtcbiAgICBpZiAodmFsaWRhdGlvbkVycm9yKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QodmFsaWRhdGlvbkVycm9yKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fZGJBZGFwdGVyLmNyZWF0ZUNsYXNzKGNsYXNzTmFtZSwgY29udmVydFNjaGVtYVRvQWRhcHRlclNjaGVtYSh7IGZpZWxkcywgY2xhc3NMZXZlbFBlcm1pc3Npb25zLCBpbmRleGVzLCBjbGFzc05hbWUgfSkpXG4gICAgICAudGhlbihjb252ZXJ0QWRhcHRlclNjaGVtYVRvUGFyc2VTY2hlbWEpXG4gICAgICAudGhlbigocmVzKSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLl9jYWNoZS5jbGVhcigpLnRoZW4oKCkgPT4ge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUocmVzKTtcbiAgICAgICAgfSk7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKGVycm9yICYmIGVycm9yLmNvZGUgPT09IFBhcnNlLkVycm9yLkRVUExJQ0FURV9WQUxVRSkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0NMQVNTX05BTUUsIGBDbGFzcyAke2NsYXNzTmFtZX0gYWxyZWFkeSBleGlzdHMuYCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9XG5cbiAgdXBkYXRlQ2xhc3MoY2xhc3NOYW1lOiBzdHJpbmcsIHN1Ym1pdHRlZEZpZWxkczogU2NoZW1hRmllbGRzLCBjbGFzc0xldmVsUGVybWlzc2lvbnM6IGFueSwgaW5kZXhlczogYW55LCBkYXRhYmFzZTogRGF0YWJhc2VDb250cm9sbGVyKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0T25lU2NoZW1hKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKHNjaGVtYSA9PiB7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nRmllbGRzID0gc2NoZW1hLmZpZWxkcztcbiAgICAgICAgT2JqZWN0LmtleXMoc3VibWl0dGVkRmllbGRzKS5mb3JFYWNoKG5hbWUgPT4ge1xuICAgICAgICAgIGNvbnN0IGZpZWxkID0gc3VibWl0dGVkRmllbGRzW25hbWVdO1xuICAgICAgICAgIGlmIChleGlzdGluZ0ZpZWxkc1tuYW1lXSAmJiBmaWVsZC5fX29wICE9PSAnRGVsZXRlJykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDI1NSwgYEZpZWxkICR7bmFtZX0gZXhpc3RzLCBjYW5ub3QgdXBkYXRlLmApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoIWV4aXN0aW5nRmllbGRzW25hbWVdICYmIGZpZWxkLl9fb3AgPT09ICdEZWxldGUnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoMjU1LCBgRmllbGQgJHtuYW1lfSBkb2VzIG5vdCBleGlzdCwgY2Fubm90IGRlbGV0ZS5gKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGRlbGV0ZSBleGlzdGluZ0ZpZWxkcy5fcnBlcm07XG4gICAgICAgIGRlbGV0ZSBleGlzdGluZ0ZpZWxkcy5fd3Blcm07XG4gICAgICAgIGNvbnN0IG5ld1NjaGVtYSA9IGJ1aWxkTWVyZ2VkU2NoZW1hT2JqZWN0KGV4aXN0aW5nRmllbGRzLCBzdWJtaXR0ZWRGaWVsZHMpO1xuICAgICAgICBjb25zdCBkZWZhdWx0RmllbGRzID0gZGVmYXVsdENvbHVtbnNbY2xhc3NOYW1lXSB8fCBkZWZhdWx0Q29sdW1ucy5fRGVmYXVsdDtcbiAgICAgICAgY29uc3QgZnVsbE5ld1NjaGVtYSA9IE9iamVjdC5hc3NpZ24oe30sIG5ld1NjaGVtYSwgZGVmYXVsdEZpZWxkcyk7XG4gICAgICAgIGNvbnN0IHZhbGlkYXRpb25FcnJvciA9IHRoaXMudmFsaWRhdGVTY2hlbWFEYXRhKGNsYXNzTmFtZSwgbmV3U2NoZW1hLCBjbGFzc0xldmVsUGVybWlzc2lvbnMsIE9iamVjdC5rZXlzKGV4aXN0aW5nRmllbGRzKSk7XG4gICAgICAgIGlmICh2YWxpZGF0aW9uRXJyb3IpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IodmFsaWRhdGlvbkVycm9yLmNvZGUsIHZhbGlkYXRpb25FcnJvci5lcnJvcik7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGaW5hbGx5IHdlIGhhdmUgY2hlY2tlZCB0byBtYWtlIHN1cmUgdGhlIHJlcXVlc3QgaXMgdmFsaWQgYW5kIHdlIGNhbiBzdGFydCBkZWxldGluZyBmaWVsZHMuXG4gICAgICAgIC8vIERvIGFsbCBkZWxldGlvbnMgZmlyc3QsIHRoZW4gYSBzaW5nbGUgc2F2ZSB0byBfU0NIRU1BIGNvbGxlY3Rpb24gdG8gaGFuZGxlIGFsbCBhZGRpdGlvbnMuXG4gICAgICAgIGNvbnN0IGRlbGV0ZWRGaWVsZHM6IHN0cmluZ1tdID0gW107XG4gICAgICAgIGNvbnN0IGluc2VydGVkRmllbGRzID0gW107XG4gICAgICAgIE9iamVjdC5rZXlzKHN1Ym1pdHRlZEZpZWxkcykuZm9yRWFjaChmaWVsZE5hbWUgPT4ge1xuICAgICAgICAgIGlmIChzdWJtaXR0ZWRGaWVsZHNbZmllbGROYW1lXS5fX29wID09PSAnRGVsZXRlJykge1xuICAgICAgICAgICAgZGVsZXRlZEZpZWxkcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGluc2VydGVkRmllbGRzLnB1c2goZmllbGROYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGxldCBkZWxldGVQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgIGlmIChkZWxldGVkRmllbGRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBkZWxldGVQcm9taXNlID0gdGhpcy5kZWxldGVGaWVsZHMoZGVsZXRlZEZpZWxkcywgY2xhc3NOYW1lLCBkYXRhYmFzZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGRlbGV0ZVByb21pc2UgLy8gRGVsZXRlIEV2ZXJ5dGhpbmdcbiAgICAgICAgICAudGhlbigoKSA9PiB0aGlzLnJlbG9hZERhdGEoeyBjbGVhckNhY2hlOiB0cnVlIH0pKSAvLyBSZWxvYWQgb3VyIFNjaGVtYSwgc28gd2UgaGF2ZSBhbGwgdGhlIG5ldyB2YWx1ZXNcbiAgICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBwcm9taXNlcyA9IGluc2VydGVkRmllbGRzLm1hcChmaWVsZE5hbWUgPT4ge1xuICAgICAgICAgICAgICBjb25zdCB0eXBlID0gc3VibWl0dGVkRmllbGRzW2ZpZWxkTmFtZV07XG4gICAgICAgICAgICAgIHJldHVybiB0aGlzLmVuZm9yY2VGaWVsZEV4aXN0cyhjbGFzc05hbWUsIGZpZWxkTmFtZSwgdHlwZSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLmFsbChwcm9taXNlcyk7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAudGhlbigoKSA9PiB0aGlzLnNldFBlcm1pc3Npb25zKGNsYXNzTmFtZSwgY2xhc3NMZXZlbFBlcm1pc3Npb25zLCBuZXdTY2hlbWEpKVxuICAgICAgICAgIC50aGVuKCgpID0+IHRoaXMuX2RiQWRhcHRlci5zZXRJbmRleGVzV2l0aFNjaGVtYUZvcm1hdChjbGFzc05hbWUsIGluZGV4ZXMsIHNjaGVtYS5pbmRleGVzLCBmdWxsTmV3U2NoZW1hKSlcbiAgICAgICAgICAudGhlbigoKSA9PiB0aGlzLnJlbG9hZERhdGEoeyBjbGVhckNhY2hlOiB0cnVlIH0pKVxuICAgICAgICAvL1RPRE86IE1vdmUgdGhpcyBsb2dpYyBpbnRvIHRoZSBkYXRhYmFzZSBhZGFwdGVyXG4gICAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgcmVsb2FkZWRTY2hlbWE6IFNjaGVtYSA9IHtcbiAgICAgICAgICAgICAgY2xhc3NOYW1lOiBjbGFzc05hbWUsXG4gICAgICAgICAgICAgIGZpZWxkczogdGhpcy5kYXRhW2NsYXNzTmFtZV0sXG4gICAgICAgICAgICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczogdGhpcy5wZXJtc1tjbGFzc05hbWVdLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGlmICh0aGlzLmluZGV4ZXNbY2xhc3NOYW1lXSAmJiBPYmplY3Qua2V5cyh0aGlzLmluZGV4ZXNbY2xhc3NOYW1lXSkubGVuZ3RoICE9PSAwKSB7XG4gICAgICAgICAgICAgIHJlbG9hZGVkU2NoZW1hLmluZGV4ZXMgPSB0aGlzLmluZGV4ZXNbY2xhc3NOYW1lXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiByZWxvYWRlZFNjaGVtYTtcbiAgICAgICAgICB9KTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0NMQVNTX05BTUUsIGBDbGFzcyAke2NsYXNzTmFtZX0gZG9lcyBub3QgZXhpc3QuYCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gIH1cblxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHN1Y2Nlc3NmdWxseSB0byB0aGUgbmV3IHNjaGVtYVxuICAvLyBvYmplY3Qgb3IgZmFpbHMgd2l0aCBhIHJlYXNvbi5cbiAgZW5mb3JjZUNsYXNzRXhpc3RzKGNsYXNzTmFtZTogc3RyaW5nKTogUHJvbWlzZTxTY2hlbWFDb250cm9sbGVyPiB7XG4gICAgaWYgKHRoaXMuZGF0YVtjbGFzc05hbWVdKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMpO1xuICAgIH1cbiAgICAvLyBXZSBkb24ndCBoYXZlIHRoaXMgY2xhc3MuIFVwZGF0ZSB0aGUgc2NoZW1hXG4gICAgcmV0dXJuIHRoaXMuYWRkQ2xhc3NJZk5vdEV4aXN0cyhjbGFzc05hbWUpXG4gICAgLy8gVGhlIHNjaGVtYSB1cGRhdGUgc3VjY2VlZGVkLiBSZWxvYWQgdGhlIHNjaGVtYVxuICAgICAgLnRoZW4oKCkgPT4gdGhpcy5yZWxvYWREYXRhKHsgY2xlYXJDYWNoZTogdHJ1ZSB9KSlcbiAgICAgIC5jYXRjaCgoKSA9PiB7XG4gICAgICAvLyBUaGUgc2NoZW1hIHVwZGF0ZSBmYWlsZWQuIFRoaXMgY2FuIGJlIG9rYXkgLSBpdCBtaWdodFxuICAgICAgLy8gaGF2ZSBmYWlsZWQgYmVjYXVzZSB0aGVyZSdzIGEgcmFjZSBjb25kaXRpb24gYW5kIGEgZGlmZmVyZW50XG4gICAgICAvLyBjbGllbnQgaXMgbWFraW5nIHRoZSBleGFjdCBzYW1lIHNjaGVtYSB1cGRhdGUgdGhhdCB3ZSB3YW50LlxuICAgICAgLy8gU28ganVzdCByZWxvYWQgdGhlIHNjaGVtYS5cbiAgICAgICAgcmV0dXJuIHRoaXMucmVsb2FkRGF0YSh7IGNsZWFyQ2FjaGU6IHRydWUgfSk7XG4gICAgICB9KVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgLy8gRW5zdXJlIHRoYXQgdGhlIHNjaGVtYSBub3cgdmFsaWRhdGVzXG4gICAgICAgIGlmICh0aGlzLmRhdGFbY2xhc3NOYW1lXSkge1xuICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sIGBGYWlsZWQgdG8gYWRkICR7Y2xhc3NOYW1lfWApO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgLmNhdGNoKCgpID0+IHtcbiAgICAgIC8vIFRoZSBzY2hlbWEgc3RpbGwgZG9lc24ndCB2YWxpZGF0ZS4gR2l2ZSB1cFxuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCAnc2NoZW1hIGNsYXNzIG5hbWUgZG9lcyBub3QgcmV2YWxpZGF0ZScpO1xuICAgICAgfSk7XG4gIH1cblxuICB2YWxpZGF0ZU5ld0NsYXNzKGNsYXNzTmFtZTogc3RyaW5nLCBmaWVsZHM6IFNjaGVtYUZpZWxkcyA9IHt9LCBjbGFzc0xldmVsUGVybWlzc2lvbnM6IGFueSk6IGFueSB7XG4gICAgaWYgKHRoaXMuZGF0YVtjbGFzc05hbWVdKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9DTEFTU19OQU1FLCBgQ2xhc3MgJHtjbGFzc05hbWV9IGFscmVhZHkgZXhpc3RzLmApO1xuICAgIH1cbiAgICBpZiAoIWNsYXNzTmFtZUlzVmFsaWQoY2xhc3NOYW1lKSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29kZTogUGFyc2UuRXJyb3IuSU5WQUxJRF9DTEFTU19OQU1FLFxuICAgICAgICBlcnJvcjogaW52YWxpZENsYXNzTmFtZU1lc3NhZ2UoY2xhc3NOYW1lKSxcbiAgICAgIH07XG4gICAgfVxuICAgIHJldHVybiB0aGlzLnZhbGlkYXRlU2NoZW1hRGF0YShjbGFzc05hbWUsIGZpZWxkcywgY2xhc3NMZXZlbFBlcm1pc3Npb25zLCBbXSk7XG4gIH1cblxuICB2YWxpZGF0ZVNjaGVtYURhdGEoY2xhc3NOYW1lOiBzdHJpbmcsIGZpZWxkczogU2NoZW1hRmllbGRzLCBjbGFzc0xldmVsUGVybWlzc2lvbnM6IENsYXNzTGV2ZWxQZXJtaXNzaW9ucywgZXhpc3RpbmdGaWVsZE5hbWVzOiBBcnJheTxzdHJpbmc+KSB7XG4gICAgZm9yIChjb25zdCBmaWVsZE5hbWUgaW4gZmllbGRzKSB7XG4gICAgICBpZiAoZXhpc3RpbmdGaWVsZE5hbWVzLmluZGV4T2YoZmllbGROYW1lKSA8IDApIHtcbiAgICAgICAgaWYgKCFmaWVsZE5hbWVJc1ZhbGlkKGZpZWxkTmFtZSkpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgY29kZTogUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSxcbiAgICAgICAgICAgIGVycm9yOiAnaW52YWxpZCBmaWVsZCBuYW1lOiAnICsgZmllbGROYW1lLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFmaWVsZE5hbWVJc1ZhbGlkRm9yQ2xhc3MoZmllbGROYW1lLCBjbGFzc05hbWUpKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGNvZGU6IDEzNixcbiAgICAgICAgICAgIGVycm9yOiAnZmllbGQgJyArIGZpZWxkTmFtZSArICcgY2Fubm90IGJlIGFkZGVkJyxcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGVycm9yID0gZmllbGRUeXBlSXNJbnZhbGlkKGZpZWxkc1tmaWVsZE5hbWVdKTtcbiAgICAgICAgaWYgKGVycm9yKSByZXR1cm4geyBjb2RlOiBlcnJvci5jb2RlLCBlcnJvcjogZXJyb3IubWVzc2FnZSB9O1xuICAgICAgfVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZmllbGROYW1lIGluIGRlZmF1bHRDb2x1bW5zW2NsYXNzTmFtZV0pIHtcbiAgICAgIGZpZWxkc1tmaWVsZE5hbWVdID0gZGVmYXVsdENvbHVtbnNbY2xhc3NOYW1lXVtmaWVsZE5hbWVdO1xuICAgIH1cblxuICAgIGNvbnN0IGdlb1BvaW50cyA9IE9iamVjdC5rZXlzKGZpZWxkcykuZmlsdGVyKGtleSA9PiBmaWVsZHNba2V5XSAmJiBmaWVsZHNba2V5XS50eXBlID09PSAnR2VvUG9pbnQnKTtcbiAgICBpZiAoZ2VvUG9pbnRzLmxlbmd0aCA+IDEpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvZGU6IFBhcnNlLkVycm9yLklOQ09SUkVDVF9UWVBFLFxuICAgICAgICBlcnJvcjogJ2N1cnJlbnRseSwgb25seSBvbmUgR2VvUG9pbnQgZmllbGQgbWF5IGV4aXN0IGluIGFuIG9iamVjdC4gQWRkaW5nICcgKyBnZW9Qb2ludHNbMV0gKyAnIHdoZW4gJyArIGdlb1BvaW50c1swXSArICcgYWxyZWFkeSBleGlzdHMuJyxcbiAgICAgIH07XG4gICAgfVxuICAgIHZhbGlkYXRlQ0xQKGNsYXNzTGV2ZWxQZXJtaXNzaW9ucywgZmllbGRzKTtcbiAgfVxuXG4gIC8vIFNldHMgdGhlIENsYXNzLWxldmVsIHBlcm1pc3Npb25zIGZvciBhIGdpdmVuIGNsYXNzTmFtZSwgd2hpY2ggbXVzdCBleGlzdC5cbiAgc2V0UGVybWlzc2lvbnMoY2xhc3NOYW1lOiBzdHJpbmcsIHBlcm1zOiBhbnksIG5ld1NjaGVtYTogU2NoZW1hRmllbGRzKSB7XG4gICAgaWYgKHR5cGVvZiBwZXJtcyA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG4gICAgdmFsaWRhdGVDTFAocGVybXMsIG5ld1NjaGVtYSk7XG4gICAgcmV0dXJuIHRoaXMuX2RiQWRhcHRlci5zZXRDbGFzc0xldmVsUGVybWlzc2lvbnMoY2xhc3NOYW1lLCBwZXJtcyk7XG4gIH1cblxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHN1Y2Nlc3NmdWxseSB0byB0aGUgbmV3IHNjaGVtYVxuICAvLyBvYmplY3QgaWYgdGhlIHByb3ZpZGVkIGNsYXNzTmFtZS1maWVsZE5hbWUtdHlwZSB0dXBsZSBpcyB2YWxpZC5cbiAgLy8gVGhlIGNsYXNzTmFtZSBtdXN0IGFscmVhZHkgYmUgdmFsaWRhdGVkLlxuICAvLyBJZiAnZnJlZXplJyBpcyB0cnVlLCByZWZ1c2UgdG8gdXBkYXRlIHRoZSBzY2hlbWEgZm9yIHRoaXMgZmllbGQuXG4gIGVuZm9yY2VGaWVsZEV4aXN0cyhjbGFzc05hbWU6IHN0cmluZywgZmllbGROYW1lOiBzdHJpbmcsIHR5cGU6IHN0cmluZyB8IFNjaGVtYUZpZWxkKSB7XG4gICAgaWYgKGZpZWxkTmFtZS5pbmRleE9mKFwiLlwiKSA+IDApIHtcbiAgICAgIC8vIHN1YmRvY3VtZW50IGtleSAoeC55KSA9PiBvayBpZiB4IGlzIG9mIHR5cGUgJ29iamVjdCdcbiAgICAgIGZpZWxkTmFtZSA9IGZpZWxkTmFtZS5zcGxpdChcIi5cIilbIDAgXTtcbiAgICAgIHR5cGUgPSAnT2JqZWN0JztcbiAgICB9XG4gICAgaWYgKCFmaWVsZE5hbWVJc1ZhbGlkKGZpZWxkTmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLCBgSW52YWxpZCBmaWVsZCBuYW1lOiAke2ZpZWxkTmFtZX0uYCk7XG4gICAgfVxuXG4gICAgLy8gSWYgc29tZW9uZSB0cmllcyB0byBjcmVhdGUgYSBuZXcgZmllbGQgd2l0aCBudWxsL3VuZGVmaW5lZCBhcyB0aGUgdmFsdWUsIHJldHVybjtcbiAgICBpZiAoIXR5cGUpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMucmVsb2FkRGF0YSgpLnRoZW4oKCkgPT4ge1xuICAgICAgY29uc3QgZXhwZWN0ZWRUeXBlID0gdGhpcy5nZXRFeHBlY3RlZFR5cGUoY2xhc3NOYW1lLCBmaWVsZE5hbWUpO1xuICAgICAgaWYgKHR5cGVvZiB0eXBlID09PSAnc3RyaW5nJykge1xuICAgICAgICB0eXBlID0geyB0eXBlIH07XG4gICAgICB9XG5cbiAgICAgIGlmIChleHBlY3RlZFR5cGUpIHtcbiAgICAgICAgaWYgKCFkYlR5cGVNYXRjaGVzT2JqZWN0VHlwZShleHBlY3RlZFR5cGUsIHR5cGUpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5DT1JSRUNUX1RZUEUsXG4gICAgICAgICAgICBgc2NoZW1hIG1pc21hdGNoIGZvciAke2NsYXNzTmFtZX0uJHtmaWVsZE5hbWV9OyBleHBlY3RlZCAke3R5cGVUb1N0cmluZyhleHBlY3RlZFR5cGUpfSBidXQgZ290ICR7dHlwZVRvU3RyaW5nKHR5cGUpfWBcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGhpcy5fZGJBZGFwdGVyLmFkZEZpZWxkSWZOb3RFeGlzdHMoY2xhc3NOYW1lLCBmaWVsZE5hbWUsIHR5cGUpLnRoZW4oKCkgPT4ge1xuICAgICAgICAvLyBUaGUgdXBkYXRlIHN1Y2NlZWRlZC4gUmVsb2FkIHRoZSBzY2hlbWFcbiAgICAgICAgcmV0dXJuIHRoaXMucmVsb2FkRGF0YSh7IGNsZWFyQ2FjaGU6IHRydWUgfSk7XG4gICAgICB9LCAoZXJyb3IpID0+IHtcbiAgICAgICAgaWYgKGVycm9yLmNvZGUgPT0gUGFyc2UuRXJyb3IuSU5DT1JSRUNUX1RZUEUpIHtcbiAgICAgICAgICAvLyBNYWtlIHN1cmUgdGhhdCB3ZSB0aHJvdyBlcnJvcnMgd2hlbiBpdCBpcyBhcHByb3ByaWF0ZSB0byBkbyBzby5cbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgICAvLyBUaGUgdXBkYXRlIGZhaWxlZC4gVGhpcyBjYW4gYmUgb2theSAtIGl0IG1pZ2h0IGhhdmUgYmVlbiBhIHJhY2VcbiAgICAgICAgLy8gY29uZGl0aW9uIHdoZXJlIGFub3RoZXIgY2xpZW50IHVwZGF0ZWQgdGhlIHNjaGVtYSBpbiB0aGUgc2FtZVxuICAgICAgICAvLyB3YXkgdGhhdCB3ZSB3YW50ZWQgdG8uIFNvLCBqdXN0IHJlbG9hZCB0aGUgc2NoZW1hXG4gICAgICAgIHJldHVybiB0aGlzLnJlbG9hZERhdGEoeyBjbGVhckNhY2hlOiB0cnVlIH0pO1xuICAgICAgfSkudGhlbigoKSA9PiB7XG4gICAgICAgIC8vIEVuc3VyZSB0aGF0IHRoZSBzY2hlbWEgbm93IHZhbGlkYXRlc1xuICAgICAgICBjb25zdCBleHBlY3RlZFR5cGUgPSB0aGlzLmdldEV4cGVjdGVkVHlwZShjbGFzc05hbWUsIGZpZWxkTmFtZSk7XG4gICAgICAgIGlmICh0eXBlb2YgdHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICB0eXBlID0geyB0eXBlIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFleHBlY3RlZFR5cGUgfHwgIWRiVHlwZU1hdGNoZXNPYmplY3RUeXBlKGV4cGVjdGVkVHlwZSwgdHlwZSkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCBgQ291bGQgbm90IGFkZCBmaWVsZCAke2ZpZWxkTmFtZX1gKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBSZW1vdmUgdGhlIGNhY2hlZCBzY2hlbWFcbiAgICAgICAgdGhpcy5fY2FjaGUuY2xlYXIoKTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIG1haW50YWluIGNvbXBhdGliaWxpdHlcbiAgZGVsZXRlRmllbGQoZmllbGROYW1lOiBzdHJpbmcsIGNsYXNzTmFtZTogc3RyaW5nLCBkYXRhYmFzZTogRGF0YWJhc2VDb250cm9sbGVyKSB7XG4gICAgcmV0dXJuIHRoaXMuZGVsZXRlRmllbGRzKFtmaWVsZE5hbWVdLCBjbGFzc05hbWUsIGRhdGFiYXNlKTtcbiAgfVxuXG4gIC8vIERlbGV0ZSBmaWVsZHMsIGFuZCByZW1vdmUgdGhhdCBkYXRhIGZyb20gYWxsIG9iamVjdHMuIFRoaXMgaXMgaW50ZW5kZWRcbiAgLy8gdG8gcmVtb3ZlIHVudXNlZCBmaWVsZHMsIGlmIG90aGVyIHdyaXRlcnMgYXJlIHdyaXRpbmcgb2JqZWN0cyB0aGF0IGluY2x1ZGVcbiAgLy8gdGhpcyBmaWVsZCwgdGhlIGZpZWxkIG1heSByZWFwcGVhci4gUmV0dXJucyBhIFByb21pc2UgdGhhdCByZXNvbHZlcyB3aXRoXG4gIC8vIG5vIG9iamVjdCBvbiBzdWNjZXNzLCBvciByZWplY3RzIHdpdGggeyBjb2RlLCBlcnJvciB9IG9uIGZhaWx1cmUuXG4gIC8vIFBhc3NpbmcgdGhlIGRhdGFiYXNlIGFuZCBwcmVmaXggaXMgbmVjZXNzYXJ5IGluIG9yZGVyIHRvIGRyb3AgcmVsYXRpb24gY29sbGVjdGlvbnNcbiAgLy8gYW5kIHJlbW92ZSBmaWVsZHMgZnJvbSBvYmplY3RzLiBJZGVhbGx5IHRoZSBkYXRhYmFzZSB3b3VsZCBiZWxvbmcgdG9cbiAgLy8gYSBkYXRhYmFzZSBhZGFwdGVyIGFuZCB0aGlzIGZ1bmN0aW9uIHdvdWxkIGNsb3NlIG92ZXIgaXQgb3IgYWNjZXNzIGl0IHZpYSBtZW1iZXIuXG4gIGRlbGV0ZUZpZWxkcyhmaWVsZE5hbWVzOiBBcnJheTxzdHJpbmc+LCBjbGFzc05hbWU6IHN0cmluZywgZGF0YWJhc2U6IERhdGFiYXNlQ29udHJvbGxlcikge1xuICAgIGlmICghY2xhc3NOYW1lSXNWYWxpZChjbGFzc05hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9DTEFTU19OQU1FLCBpbnZhbGlkQ2xhc3NOYW1lTWVzc2FnZShjbGFzc05hbWUpKTtcbiAgICB9XG5cbiAgICBmaWVsZE5hbWVzLmZvckVhY2goZmllbGROYW1lID0+IHtcbiAgICAgIGlmICghZmllbGROYW1lSXNWYWxpZChmaWVsZE5hbWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLCBgaW52YWxpZCBmaWVsZCBuYW1lOiAke2ZpZWxkTmFtZX1gKTtcbiAgICAgIH1cbiAgICAgIC8vRG9uJ3QgYWxsb3cgZGVsZXRpbmcgdGhlIGRlZmF1bHQgZmllbGRzLlxuICAgICAgaWYgKCFmaWVsZE5hbWVJc1ZhbGlkRm9yQ2xhc3MoZmllbGROYW1lLCBjbGFzc05hbWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcigxMzYsIGBmaWVsZCAke2ZpZWxkTmFtZX0gY2Fubm90IGJlIGNoYW5nZWRgKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiB0aGlzLmdldE9uZVNjaGVtYShjbGFzc05hbWUsIGZhbHNlLCB7Y2xlYXJDYWNoZTogdHJ1ZX0pXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0NMQVNTX05BTUUsIGBDbGFzcyAke2NsYXNzTmFtZX0gZG9lcyBub3QgZXhpc3QuYCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAudGhlbihzY2hlbWEgPT4ge1xuICAgICAgICBmaWVsZE5hbWVzLmZvckVhY2goZmllbGROYW1lID0+IHtcbiAgICAgICAgICBpZiAoIXNjaGVtYS5maWVsZHNbZmllbGROYW1lXSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDI1NSwgYEZpZWxkICR7ZmllbGROYW1lfSBkb2VzIG5vdCBleGlzdCwgY2Fubm90IGRlbGV0ZS5gKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHNjaGVtYUZpZWxkcyA9IHsgLi4uc2NoZW1hLmZpZWxkcyB9O1xuICAgICAgICByZXR1cm4gZGF0YWJhc2UuYWRhcHRlci5kZWxldGVGaWVsZHMoY2xhc3NOYW1lLCBzY2hlbWEsIGZpZWxkTmFtZXMpXG4gICAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKGZpZWxkTmFtZXMubWFwKGZpZWxkTmFtZSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IGZpZWxkID0gc2NoZW1hRmllbGRzW2ZpZWxkTmFtZV07XG4gICAgICAgICAgICAgIGlmIChmaWVsZCAmJiBmaWVsZC50eXBlID09PSAnUmVsYXRpb24nKSB7XG4gICAgICAgICAgICAgIC8vRm9yIHJlbGF0aW9ucywgZHJvcCB0aGUgX0pvaW4gdGFibGVcbiAgICAgICAgICAgICAgICByZXR1cm4gZGF0YWJhc2UuYWRhcHRlci5kZWxldGVDbGFzcyhgX0pvaW46JHtmaWVsZE5hbWV9OiR7Y2xhc3NOYW1lfWApO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICB9KTtcbiAgICAgIH0pLnRoZW4oKCkgPT4ge1xuICAgICAgICB0aGlzLl9jYWNoZS5jbGVhcigpO1xuICAgICAgfSk7XG4gIH1cblxuICAvLyBWYWxpZGF0ZXMgYW4gb2JqZWN0IHByb3ZpZGVkIGluIFJFU1QgZm9ybWF0LlxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSBuZXcgc2NoZW1hIGlmIHRoaXMgb2JqZWN0IGlzXG4gIC8vIHZhbGlkLlxuICB2YWxpZGF0ZU9iamVjdChjbGFzc05hbWU6IHN0cmluZywgb2JqZWN0OiBhbnksIHF1ZXJ5OiBhbnkpIHtcbiAgICBsZXQgZ2VvY291bnQgPSAwO1xuICAgIGxldCBwcm9taXNlID0gdGhpcy5lbmZvcmNlQ2xhc3NFeGlzdHMoY2xhc3NOYW1lKTtcbiAgICBmb3IgKGNvbnN0IGZpZWxkTmFtZSBpbiBvYmplY3QpIHtcbiAgICAgIGlmIChvYmplY3RbZmllbGROYW1lXSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgZXhwZWN0ZWQgPSBnZXRUeXBlKG9iamVjdFtmaWVsZE5hbWVdKTtcbiAgICAgIGlmIChleHBlY3RlZCA9PT0gJ0dlb1BvaW50Jykge1xuICAgICAgICBnZW9jb3VudCsrO1xuICAgICAgfVxuICAgICAgaWYgKGdlb2NvdW50ID4gMSkge1xuICAgICAgICAvLyBNYWtlIHN1cmUgYWxsIGZpZWxkIHZhbGlkYXRpb24gb3BlcmF0aW9ucyBydW4gYmVmb3JlIHdlIHJldHVybi5cbiAgICAgICAgLy8gSWYgbm90IC0gd2UgYXJlIGNvbnRpbnVpbmcgdG8gcnVuIGxvZ2ljLCBidXQgYWxyZWFkeSBwcm92aWRlZCByZXNwb25zZSBmcm9tIHRoZSBzZXJ2ZXIuXG4gICAgICAgIHJldHVybiBwcm9taXNlLnRoZW4oKCkgPT4ge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5DT1JSRUNUX1RZUEUsXG4gICAgICAgICAgICAndGhlcmUgY2FuIG9ubHkgYmUgb25lIGdlb3BvaW50IGZpZWxkIGluIGEgY2xhc3MnKSk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgaWYgKCFleHBlY3RlZCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChmaWVsZE5hbWUgPT09ICdBQ0wnKSB7XG4gICAgICAgIC8vIEV2ZXJ5IG9iamVjdCBoYXMgQUNMIGltcGxpY2l0bHkuXG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBwcm9taXNlID0gcHJvbWlzZS50aGVuKHNjaGVtYSA9PiBzY2hlbWEuZW5mb3JjZUZpZWxkRXhpc3RzKGNsYXNzTmFtZSwgZmllbGROYW1lLCBleHBlY3RlZCkpO1xuICAgIH1cbiAgICBwcm9taXNlID0gdGhlblZhbGlkYXRlUmVxdWlyZWRDb2x1bW5zKHByb21pc2UsIGNsYXNzTmFtZSwgb2JqZWN0LCBxdWVyeSk7XG4gICAgcmV0dXJuIHByb21pc2U7XG4gIH1cblxuICAvLyBWYWxpZGF0ZXMgdGhhdCBhbGwgdGhlIHByb3BlcnRpZXMgYXJlIHNldCBmb3IgdGhlIG9iamVjdFxuICB2YWxpZGF0ZVJlcXVpcmVkQ29sdW1ucyhjbGFzc05hbWU6IHN0cmluZywgb2JqZWN0OiBhbnksIHF1ZXJ5OiBhbnkpIHtcbiAgICBjb25zdCBjb2x1bW5zID0gcmVxdWlyZWRDb2x1bW5zW2NsYXNzTmFtZV07XG4gICAgaWYgKCFjb2x1bW5zIHx8IGNvbHVtbnMubGVuZ3RoID09IDApIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcyk7XG4gICAgfVxuXG4gICAgY29uc3QgbWlzc2luZ0NvbHVtbnMgPSBjb2x1bW5zLmZpbHRlcihmdW5jdGlvbihjb2x1bW4pe1xuICAgICAgaWYgKHF1ZXJ5ICYmIHF1ZXJ5Lm9iamVjdElkKSB7XG4gICAgICAgIGlmIChvYmplY3RbY29sdW1uXSAmJiB0eXBlb2Ygb2JqZWN0W2NvbHVtbl0gPT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgICAvLyBUcnlpbmcgdG8gZGVsZXRlIGEgcmVxdWlyZWQgY29sdW1uXG4gICAgICAgICAgcmV0dXJuIG9iamVjdFtjb2x1bW5dLl9fb3AgPT0gJ0RlbGV0ZSc7XG4gICAgICAgIH1cbiAgICAgICAgLy8gTm90IHRyeWluZyB0byBkbyBhbnl0aGluZyB0aGVyZVxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICByZXR1cm4gIW9iamVjdFtjb2x1bW5dXG4gICAgfSk7XG5cbiAgICBpZiAobWlzc2luZ0NvbHVtbnMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTkNPUlJFQ1RfVFlQRSxcbiAgICAgICAgbWlzc2luZ0NvbHVtbnNbMF0gKyAnIGlzIHJlcXVpcmVkLicpO1xuICAgIH1cbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMpO1xuICB9XG5cbiAgLy8gVmFsaWRhdGVzIHRoZSBiYXNlIENMUCBmb3IgYW4gb3BlcmF0aW9uXG4gIHRlc3RCYXNlQ0xQKGNsYXNzTmFtZTogc3RyaW5nLCBhY2xHcm91cDogc3RyaW5nW10sIG9wZXJhdGlvbjogc3RyaW5nKSB7XG4gICAgaWYgKCF0aGlzLnBlcm1zW2NsYXNzTmFtZV0gfHwgIXRoaXMucGVybXNbY2xhc3NOYW1lXVtvcGVyYXRpb25dKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgY29uc3QgY2xhc3NQZXJtcyA9IHRoaXMucGVybXNbY2xhc3NOYW1lXTtcbiAgICBjb25zdCBwZXJtcyA9IGNsYXNzUGVybXNbb3BlcmF0aW9uXTtcbiAgICAvLyBIYW5kbGUgdGhlIHB1YmxpYyBzY2VuYXJpbyBxdWlja2x5XG4gICAgaWYgKHBlcm1zWycqJ10pIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICAvLyBDaGVjayBwZXJtaXNzaW9ucyBhZ2FpbnN0IHRoZSBhY2xHcm91cCBwcm92aWRlZCAoYXJyYXkgb2YgdXNlcklkL3JvbGVzKVxuICAgIGlmIChhY2xHcm91cC5zb21lKGFjbCA9PiB7IHJldHVybiBwZXJtc1thY2xdID09PSB0cnVlIH0pKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLy8gVmFsaWRhdGVzIGFuIG9wZXJhdGlvbiBwYXNzZXMgY2xhc3MtbGV2ZWwtcGVybWlzc2lvbnMgc2V0IGluIHRoZSBzY2hlbWFcbiAgdmFsaWRhdGVQZXJtaXNzaW9uKGNsYXNzTmFtZTogc3RyaW5nLCBhY2xHcm91cDogc3RyaW5nW10sIG9wZXJhdGlvbjogc3RyaW5nKSB7XG5cbiAgICBpZiAodGhpcy50ZXN0QmFzZUNMUChjbGFzc05hbWUsIGFjbEdyb3VwLCBvcGVyYXRpb24pKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLnBlcm1zW2NsYXNzTmFtZV0gfHwgIXRoaXMucGVybXNbY2xhc3NOYW1lXVtvcGVyYXRpb25dKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgY29uc3QgY2xhc3NQZXJtcyA9IHRoaXMucGVybXNbY2xhc3NOYW1lXTtcbiAgICBjb25zdCBwZXJtcyA9IGNsYXNzUGVybXNbb3BlcmF0aW9uXTtcblxuICAgIC8vIElmIG9ubHkgZm9yIGF1dGhlbnRpY2F0ZWQgdXNlcnNcbiAgICAvLyBtYWtlIHN1cmUgd2UgaGF2ZSBhbiBhY2xHcm91cFxuICAgIGlmIChwZXJtc1sncmVxdWlyZXNBdXRoZW50aWNhdGlvbiddKSB7XG4gICAgICAvLyBJZiBhY2xHcm91cCBoYXMgKiAocHVibGljKVxuICAgICAgaWYgKCFhY2xHcm91cCB8fCBhY2xHcm91cC5sZW5ndGggPT0gMCkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCxcbiAgICAgICAgICAnUGVybWlzc2lvbiBkZW5pZWQsIHVzZXIgbmVlZHMgdG8gYmUgYXV0aGVudGljYXRlZC4nKTtcbiAgICAgIH0gZWxzZSBpZiAoYWNsR3JvdXAuaW5kZXhPZignKicpID4gLTEgJiYgYWNsR3JvdXAubGVuZ3RoID09IDEpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsXG4gICAgICAgICAgJ1Blcm1pc3Npb24gZGVuaWVkLCB1c2VyIG5lZWRzIHRvIGJlIGF1dGhlbnRpY2F0ZWQuJyk7XG4gICAgICB9XG4gICAgICAvLyByZXF1aXJlc0F1dGhlbnRpY2F0aW9uIHBhc3NlZCwganVzdCBtb3ZlIGZvcndhcmRcbiAgICAgIC8vIHByb2JhYmx5IHdvdWxkIGJlIHdpc2UgYXQgc29tZSBwb2ludCB0byByZW5hbWUgdG8gJ2F1dGhlbnRpY2F0ZWRVc2VyJ1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cblxuICAgIC8vIE5vIG1hdGNoaW5nIENMUCwgbGV0J3MgY2hlY2sgdGhlIFBvaW50ZXIgcGVybWlzc2lvbnNcbiAgICAvLyBBbmQgaGFuZGxlIHRob3NlIGxhdGVyXG4gICAgY29uc3QgcGVybWlzc2lvbkZpZWxkID0gWydnZXQnLCAnZmluZCcsICdjb3VudCddLmluZGV4T2Yob3BlcmF0aW9uKSA+IC0xID8gJ3JlYWRVc2VyRmllbGRzJyA6ICd3cml0ZVVzZXJGaWVsZHMnO1xuXG4gICAgLy8gUmVqZWN0IGNyZWF0ZSB3aGVuIHdyaXRlIGxvY2tkb3duXG4gICAgaWYgKHBlcm1pc3Npb25GaWVsZCA9PSAnd3JpdGVVc2VyRmllbGRzJyAmJiBvcGVyYXRpb24gPT0gJ2NyZWF0ZScpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PUEVSQVRJT05fRk9SQklEREVOLFxuICAgICAgICBgUGVybWlzc2lvbiBkZW5pZWQgZm9yIGFjdGlvbiAke29wZXJhdGlvbn0gb24gY2xhc3MgJHtjbGFzc05hbWV9LmApO1xuICAgIH1cblxuICAgIC8vIFByb2Nlc3MgdGhlIHJlYWRVc2VyRmllbGRzIGxhdGVyXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoY2xhc3NQZXJtc1twZXJtaXNzaW9uRmllbGRdKSAmJiBjbGFzc1Blcm1zW3Blcm1pc3Npb25GaWVsZF0ubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTixcbiAgICAgIGBQZXJtaXNzaW9uIGRlbmllZCBmb3IgYWN0aW9uICR7b3BlcmF0aW9ufSBvbiBjbGFzcyAke2NsYXNzTmFtZX0uYCk7XG4gIH1cblxuICAvLyBSZXR1cm5zIHRoZSBleHBlY3RlZCB0eXBlIGZvciBhIGNsYXNzTmFtZStrZXkgY29tYmluYXRpb25cbiAgLy8gb3IgdW5kZWZpbmVkIGlmIHRoZSBzY2hlbWEgaXMgbm90IHNldFxuICBnZXRFeHBlY3RlZFR5cGUoY2xhc3NOYW1lOiBzdHJpbmcsIGZpZWxkTmFtZTogc3RyaW5nKTogPyhTY2hlbWFGaWVsZCB8IHN0cmluZykge1xuICAgIGlmICh0aGlzLmRhdGEgJiYgdGhpcy5kYXRhW2NsYXNzTmFtZV0pIHtcbiAgICAgIGNvbnN0IGV4cGVjdGVkVHlwZSA9IHRoaXMuZGF0YVtjbGFzc05hbWVdW2ZpZWxkTmFtZV1cbiAgICAgIHJldHVybiBleHBlY3RlZFR5cGUgPT09ICdtYXAnID8gJ09iamVjdCcgOiBleHBlY3RlZFR5cGU7XG4gICAgfVxuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICAvLyBDaGVja3MgaWYgYSBnaXZlbiBjbGFzcyBpcyBpbiB0aGUgc2NoZW1hLlxuICBoYXNDbGFzcyhjbGFzc05hbWU6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLnJlbG9hZERhdGEoKS50aGVuKCgpID0+ICEhKHRoaXMuZGF0YVtjbGFzc05hbWVdKSk7XG4gIH1cbn1cblxuLy8gUmV0dXJucyBhIHByb21pc2UgZm9yIGEgbmV3IFNjaGVtYS5cbmNvbnN0IGxvYWQgPSAoZGJBZGFwdGVyOiBTdG9yYWdlQWRhcHRlciwgc2NoZW1hQ2FjaGU6IGFueSwgb3B0aW9uczogYW55KTogUHJvbWlzZTxTY2hlbWFDb250cm9sbGVyPiA9PiB7XG4gIGNvbnN0IHNjaGVtYSA9IG5ldyBTY2hlbWFDb250cm9sbGVyKGRiQWRhcHRlciwgc2NoZW1hQ2FjaGUpO1xuICByZXR1cm4gc2NoZW1hLnJlbG9hZERhdGEob3B0aW9ucykudGhlbigoKSA9PiBzY2hlbWEpO1xufVxuXG4vLyBCdWlsZHMgYSBuZXcgc2NoZW1hIChpbiBzY2hlbWEgQVBJIHJlc3BvbnNlIGZvcm1hdCkgb3V0IG9mIGFuXG4vLyBleGlzdGluZyBtb25nbyBzY2hlbWEgKyBhIHNjaGVtYXMgQVBJIHB1dCByZXF1ZXN0LiBUaGlzIHJlc3BvbnNlXG4vLyBkb2VzIG5vdCBpbmNsdWRlIHRoZSBkZWZhdWx0IGZpZWxkcywgYXMgaXQgaXMgaW50ZW5kZWQgdG8gYmUgcGFzc2VkXG4vLyB0byBtb25nb1NjaGVtYUZyb21GaWVsZHNBbmRDbGFzc05hbWUuIE5vIHZhbGlkYXRpb24gaXMgZG9uZSBoZXJlLCBpdFxuLy8gaXMgZG9uZSBpbiBtb25nb1NjaGVtYUZyb21GaWVsZHNBbmRDbGFzc05hbWUuXG5mdW5jdGlvbiBidWlsZE1lcmdlZFNjaGVtYU9iamVjdChleGlzdGluZ0ZpZWxkczogU2NoZW1hRmllbGRzLCBwdXRSZXF1ZXN0OiBhbnkpOiBTY2hlbWFGaWVsZHMge1xuICBjb25zdCBuZXdTY2hlbWEgPSB7fTtcbiAgLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG4gIGNvbnN0IHN5c1NjaGVtYUZpZWxkID0gT2JqZWN0LmtleXMoZGVmYXVsdENvbHVtbnMpLmluZGV4T2YoZXhpc3RpbmdGaWVsZHMuX2lkKSA9PT0gLTEgPyBbXSA6IE9iamVjdC5rZXlzKGRlZmF1bHRDb2x1bW5zW2V4aXN0aW5nRmllbGRzLl9pZF0pO1xuICBmb3IgKGNvbnN0IG9sZEZpZWxkIGluIGV4aXN0aW5nRmllbGRzKSB7XG4gICAgaWYgKG9sZEZpZWxkICE9PSAnX2lkJyAmJiBvbGRGaWVsZCAhPT0gJ0FDTCcgJiYgIG9sZEZpZWxkICE9PSAndXBkYXRlZEF0JyAmJiBvbGRGaWVsZCAhPT0gJ2NyZWF0ZWRBdCcgJiYgb2xkRmllbGQgIT09ICdvYmplY3RJZCcpIHtcbiAgICAgIGlmIChzeXNTY2hlbWFGaWVsZC5sZW5ndGggPiAwICYmIHN5c1NjaGVtYUZpZWxkLmluZGV4T2Yob2xkRmllbGQpICE9PSAtMSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGZpZWxkSXNEZWxldGVkID0gcHV0UmVxdWVzdFtvbGRGaWVsZF0gJiYgcHV0UmVxdWVzdFtvbGRGaWVsZF0uX19vcCA9PT0gJ0RlbGV0ZSdcbiAgICAgIGlmICghZmllbGRJc0RlbGV0ZWQpIHtcbiAgICAgICAgbmV3U2NoZW1hW29sZEZpZWxkXSA9IGV4aXN0aW5nRmllbGRzW29sZEZpZWxkXTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgZm9yIChjb25zdCBuZXdGaWVsZCBpbiBwdXRSZXF1ZXN0KSB7XG4gICAgaWYgKG5ld0ZpZWxkICE9PSAnb2JqZWN0SWQnICYmIHB1dFJlcXVlc3RbbmV3RmllbGRdLl9fb3AgIT09ICdEZWxldGUnKSB7XG4gICAgICBpZiAoc3lzU2NoZW1hRmllbGQubGVuZ3RoID4gMCAmJiBzeXNTY2hlbWFGaWVsZC5pbmRleE9mKG5ld0ZpZWxkKSAhPT0gLTEpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBuZXdTY2hlbWFbbmV3RmllbGRdID0gcHV0UmVxdWVzdFtuZXdGaWVsZF07XG4gICAgfVxuICB9XG4gIHJldHVybiBuZXdTY2hlbWE7XG59XG5cbi8vIEdpdmVuIGEgc2NoZW1hIHByb21pc2UsIGNvbnN0cnVjdCBhbm90aGVyIHNjaGVtYSBwcm9taXNlIHRoYXRcbi8vIHZhbGlkYXRlcyB0aGlzIGZpZWxkIG9uY2UgdGhlIHNjaGVtYSBsb2Fkcy5cbmZ1bmN0aW9uIHRoZW5WYWxpZGF0ZVJlcXVpcmVkQ29sdW1ucyhzY2hlbWFQcm9taXNlLCBjbGFzc05hbWUsIG9iamVjdCwgcXVlcnkpIHtcbiAgcmV0dXJuIHNjaGVtYVByb21pc2UudGhlbigoc2NoZW1hKSA9PiB7XG4gICAgcmV0dXJuIHNjaGVtYS52YWxpZGF0ZVJlcXVpcmVkQ29sdW1ucyhjbGFzc05hbWUsIG9iamVjdCwgcXVlcnkpO1xuICB9KTtcbn1cblxuLy8gR2V0cyB0aGUgdHlwZSBmcm9tIGEgUkVTVCBBUEkgZm9ybWF0dGVkIG9iamVjdCwgd2hlcmUgJ3R5cGUnIGlzXG4vLyBleHRlbmRlZCBwYXN0IGphdmFzY3JpcHQgdHlwZXMgdG8gaW5jbHVkZSB0aGUgcmVzdCBvZiB0aGUgUGFyc2Vcbi8vIHR5cGUgc3lzdGVtLlxuLy8gVGhlIG91dHB1dCBzaG91bGQgYmUgYSB2YWxpZCBzY2hlbWEgdmFsdWUuXG4vLyBUT0RPOiBlbnN1cmUgdGhhdCB0aGlzIGlzIGNvbXBhdGlibGUgd2l0aCB0aGUgZm9ybWF0IHVzZWQgaW4gT3BlbiBEQlxuZnVuY3Rpb24gZ2V0VHlwZShvYmo6IGFueSk6ID8oU2NoZW1hRmllbGQgfCBzdHJpbmcpIHtcbiAgY29uc3QgdHlwZSA9IHR5cGVvZiBvYmo7XG4gIHN3aXRjaCh0eXBlKSB7XG4gIGNhc2UgJ2Jvb2xlYW4nOlxuICAgIHJldHVybiAnQm9vbGVhbic7XG4gIGNhc2UgJ3N0cmluZyc6XG4gICAgcmV0dXJuICdTdHJpbmcnO1xuICBjYXNlICdudW1iZXInOlxuICAgIHJldHVybiAnTnVtYmVyJztcbiAgY2FzZSAnbWFwJzpcbiAgY2FzZSAnb2JqZWN0JzpcbiAgICBpZiAoIW9iaikge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgcmV0dXJuIGdldE9iamVjdFR5cGUob2JqKTtcbiAgY2FzZSAnZnVuY3Rpb24nOlxuICBjYXNlICdzeW1ib2wnOlxuICBjYXNlICd1bmRlZmluZWQnOlxuICBkZWZhdWx0OlxuICAgIHRocm93ICdiYWQgb2JqOiAnICsgb2JqO1xuICB9XG59XG5cbi8vIFRoaXMgZ2V0cyB0aGUgdHlwZSBmb3Igbm9uLUpTT04gdHlwZXMgbGlrZSBwb2ludGVycyBhbmQgZmlsZXMsIGJ1dFxuLy8gYWxzbyBnZXRzIHRoZSBhcHByb3ByaWF0ZSB0eXBlIGZvciAkIG9wZXJhdG9ycy5cbi8vIFJldHVybnMgbnVsbCBpZiB0aGUgdHlwZSBpcyB1bmtub3duLlxuZnVuY3Rpb24gZ2V0T2JqZWN0VHlwZShvYmopOiA/KFNjaGVtYUZpZWxkIHwgc3RyaW5nKSB7XG4gIGlmIChvYmogaW5zdGFuY2VvZiBBcnJheSkge1xuICAgIHJldHVybiAnQXJyYXknO1xuICB9XG4gIGlmIChvYmouX190eXBlKXtcbiAgICBzd2l0Y2gob2JqLl9fdHlwZSkge1xuICAgIGNhc2UgJ1BvaW50ZXInIDpcbiAgICAgIGlmKG9iai5jbGFzc05hbWUpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICB0eXBlOiAnUG9pbnRlcicsXG4gICAgICAgICAgdGFyZ2V0Q2xhc3M6IG9iai5jbGFzc05hbWVcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnUmVsYXRpb24nIDpcbiAgICAgIGlmKG9iai5jbGFzc05hbWUpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICB0eXBlOiAnUmVsYXRpb24nLFxuICAgICAgICAgIHRhcmdldENsYXNzOiBvYmouY2xhc3NOYW1lXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ0ZpbGUnIDpcbiAgICAgIGlmKG9iai5uYW1lKSB7XG4gICAgICAgIHJldHVybiAnRmlsZSc7XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICBjYXNlICdEYXRlJyA6XG4gICAgICBpZihvYmouaXNvKSB7XG4gICAgICAgIHJldHVybiAnRGF0ZSc7XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICBjYXNlICdHZW9Qb2ludCcgOlxuICAgICAgaWYob2JqLmxhdGl0dWRlICE9IG51bGwgJiYgb2JqLmxvbmdpdHVkZSAhPSBudWxsKSB7XG4gICAgICAgIHJldHVybiAnR2VvUG9pbnQnO1xuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnQnl0ZXMnIDpcbiAgICAgIGlmKG9iai5iYXNlNjQpIHtcbiAgICAgICAgcmV0dXJuICdCeXRlcyc7XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICBjYXNlICdQb2x5Z29uJyA6XG4gICAgICBpZihvYmouY29vcmRpbmF0ZXMpIHtcbiAgICAgICAgcmV0dXJuICdQb2x5Z29uJztcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5DT1JSRUNUX1RZUEUsIFwiVGhpcyBpcyBub3QgYSB2YWxpZCBcIiArIG9iai5fX3R5cGUpO1xuICB9XG4gIGlmIChvYmpbJyRuZSddKSB7XG4gICAgcmV0dXJuIGdldE9iamVjdFR5cGUob2JqWyckbmUnXSk7XG4gIH1cbiAgaWYgKG9iai5fX29wKSB7XG4gICAgc3dpdGNoKG9iai5fX29wKSB7XG4gICAgY2FzZSAnSW5jcmVtZW50JzpcbiAgICAgIHJldHVybiAnTnVtYmVyJztcbiAgICBjYXNlICdEZWxldGUnOlxuICAgICAgcmV0dXJuIG51bGw7XG4gICAgY2FzZSAnQWRkJzpcbiAgICBjYXNlICdBZGRVbmlxdWUnOlxuICAgIGNhc2UgJ1JlbW92ZSc6XG4gICAgICByZXR1cm4gJ0FycmF5JztcbiAgICBjYXNlICdBZGRSZWxhdGlvbic6XG4gICAgY2FzZSAnUmVtb3ZlUmVsYXRpb24nOlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgdHlwZTogJ1JlbGF0aW9uJyxcbiAgICAgICAgdGFyZ2V0Q2xhc3M6IG9iai5vYmplY3RzWzBdLmNsYXNzTmFtZVxuICAgICAgfVxuICAgIGNhc2UgJ0JhdGNoJzpcbiAgICAgIHJldHVybiBnZXRPYmplY3RUeXBlKG9iai5vcHNbMF0pO1xuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyAndW5leHBlY3RlZCBvcDogJyArIG9iai5fX29wO1xuICAgIH1cbiAgfVxuICByZXR1cm4gJ09iamVjdCc7XG59XG5cbmV4cG9ydCB7XG4gIGxvYWQsXG4gIGNsYXNzTmFtZUlzVmFsaWQsXG4gIGZpZWxkTmFtZUlzVmFsaWQsXG4gIGludmFsaWRDbGFzc05hbWVNZXNzYWdlLFxuICBidWlsZE1lcmdlZFNjaGVtYU9iamVjdCxcbiAgc3lzdGVtQ2xhc3NlcyxcbiAgZGVmYXVsdENvbHVtbnMsXG4gIGNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEsXG4gIFZvbGF0aWxlQ2xhc3Nlc1NjaGVtYXMsXG4gIFNjaGVtYUNvbnRyb2xsZXIsXG59O1xuIl19