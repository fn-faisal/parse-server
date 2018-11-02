"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.classNameIsValid = classNameIsValid;
exports.fieldNameIsValid = fieldNameIsValid;
exports.invalidClassNameMessage = invalidClassNameMessage;
exports.buildMergedSchemaObject = buildMergedSchemaObject;
exports.VolatileClassesSchemas = exports.convertSchemaToAdapterSchema = exports.defaultColumns = exports.systemClasses = exports.load = exports.SchemaController = exports.default = void 0;

var _StorageAdapter = require("../Adapters/Storage/StorageAdapter");

var _DatabaseController = _interopRequireDefault(require("./DatabaseController"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; var ownKeys = Object.keys(source); if (typeof Object.getOwnPropertySymbols === 'function') { ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function (sym) { return Object.getOwnPropertyDescriptor(source, sym).enumerable; })); } ownKeys.forEach(function (key) { _defineProperty(target, key, source[key]); }); } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

function _extends() { _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }

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
    objectId: {
      type: 'String'
    },
    createdAt: {
      type: 'Date'
    },
    updatedAt: {
      type: 'Date'
    },
    ACL: {
      type: 'ACL'
    }
  },
  // The additional default columns for the _User collection (in addition to DefaultCols)
  _User: {
    username: {
      type: 'String'
    },
    password: {
      type: 'String'
    },
    email: {
      type: 'String'
    },
    emailVerified: {
      type: 'Boolean'
    },
    authData: {
      type: 'Object'
    }
  },
  // The additional default columns for the _Installation collection (in addition to DefaultCols)
  _Installation: {
    installationId: {
      type: 'String'
    },
    deviceToken: {
      type: 'String'
    },
    channels: {
      type: 'Array'
    },
    deviceType: {
      type: 'String'
    },
    pushType: {
      type: 'String'
    },
    GCMSenderId: {
      type: 'String'
    },
    timeZone: {
      type: 'String'
    },
    localeIdentifier: {
      type: 'String'
    },
    badge: {
      type: 'Number'
    },
    appVersion: {
      type: 'String'
    },
    appName: {
      type: 'String'
    },
    appIdentifier: {
      type: 'String'
    },
    parseVersion: {
      type: 'String'
    }
  },
  // The additional default columns for the _Role collection (in addition to DefaultCols)
  _Role: {
    name: {
      type: 'String'
    },
    users: {
      type: 'Relation',
      targetClass: '_User'
    },
    roles: {
      type: 'Relation',
      targetClass: '_Role'
    }
  },
  // The additional default columns for the _Session collection (in addition to DefaultCols)
  _Session: {
    restricted: {
      type: 'Boolean'
    },
    user: {
      type: 'Pointer',
      targetClass: '_User'
    },
    installationId: {
      type: 'String'
    },
    sessionToken: {
      type: 'String'
    },
    expiresAt: {
      type: 'Date'
    },
    createdWith: {
      type: 'Object'
    }
  },
  _Product: {
    productIdentifier: {
      type: 'String'
    },
    download: {
      type: 'File'
    },
    downloadName: {
      type: 'String'
    },
    icon: {
      type: 'File'
    },
    order: {
      type: 'Number'
    },
    title: {
      type: 'String'
    },
    subtitle: {
      type: 'String'
    }
  },
  _PushStatus: {
    pushTime: {
      type: 'String'
    },
    source: {
      type: 'String'
    },
    // rest or webui
    query: {
      type: 'String'
    },
    // the stringified JSON query
    payload: {
      type: 'String'
    },
    // the stringified JSON payload,
    title: {
      type: 'String'
    },
    expiry: {
      type: 'Number'
    },
    expiration_interval: {
      type: 'Number'
    },
    status: {
      type: 'String'
    },
    numSent: {
      type: 'Number'
    },
    numFailed: {
      type: 'Number'
    },
    pushHash: {
      type: 'String'
    },
    errorMessage: {
      type: 'Object'
    },
    sentPerType: {
      type: 'Object'
    },
    failedPerType: {
      type: 'Object'
    },
    sentPerUTCOffset: {
      type: 'Object'
    },
    failedPerUTCOffset: {
      type: 'Object'
    },
    count: {
      type: 'Number'
    } // tracks # of batches queued and pending

  },
  _JobStatus: {
    jobName: {
      type: 'String'
    },
    source: {
      type: 'String'
    },
    status: {
      type: 'String'
    },
    message: {
      type: 'String'
    },
    params: {
      type: 'Object'
    },
    // params received when calling the job
    finishedAt: {
      type: 'Date'
    }
  },
  _JobSchedule: {
    jobName: {
      type: 'String'
    },
    description: {
      type: 'String'
    },
    params: {
      type: 'String'
    },
    startAfter: {
      type: 'String'
    },
    daysOfWeek: {
      type: 'Array'
    },
    timeOfDay: {
      type: 'String'
    },
    lastRun: {
      type: 'Number'
    },
    repeatMinutes: {
      type: 'Number'
    }
  },
  _Hooks: {
    functionName: {
      type: 'String'
    },
    className: {
      type: 'String'
    },
    triggerName: {
      type: 'String'
    },
    url: {
      type: 'String'
    }
  },
  _GlobalConfig: {
    objectId: {
      type: 'String'
    },
    params: {
      type: 'Object'
    }
  },
  _Audience: {
    objectId: {
      type: 'String'
    },
    name: {
      type: 'String'
    },
    query: {
      type: 'String'
    },
    //storing query as JSON string to prevent "Nested keys should not contain the '$' or '.' characters" error
    lastUsed: {
      type: 'Date'
    },
    timesUsed: {
      type: 'Number'
    }
  }
});
exports.defaultColumns = defaultColumns;
const requiredColumns = Object.freeze({
  _Product: ['productIdentifier', 'icon', 'order', 'title', 'subtitle'],
  _Role: ['name', 'ACL']
});
const systemClasses = Object.freeze(['_User', '_Installation', '_Role', '_Session', '_Product', '_PushStatus', '_JobStatus', '_JobSchedule', '_Audience', '_ExportProgress']);
exports.systemClasses = systemClasses;
const volatileClasses = Object.freeze(['_JobStatus', '_PushStatus', '_Hooks', '_GlobalConfig', '_JobSchedule', '_Audience']); // 10 alpha numberic chars + uppercase

const userIdRegex = /^[a-zA-Z0-9]{10}$/; // Anything that start with role

const roleRegex = /^role:.*/; // * permission

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
    } // -disable-next


    Object.keys(perms[operation]).forEach(key => {
      verifyPermissionKey(key); // -disable-next

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
  return (// Be one of _User, _Installation, _Role, _Session OR
    systemClasses.indexOf(className) > -1 || // Be a join table OR
    joinClassRegex.test(className) || // Include only alpha-numeric and underscores, and not start with an underscore or number
    fieldNameIsValid(className)
  );
} // Valid fields must be alpha-numeric, and not start with an underscore or number


function fieldNameIsValid(fieldName) {
  return classAndFieldRegex.test(fieldName);
} // Checks that it's not trying to clobber one of the default fields of the class.


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

const invalidJsonError = new Parse.Error(Parse.Error.INVALID_JSON, 'invalid JSON');
const validNonRelationOrPointerTypes = ['Number', 'String', 'Boolean', 'Date', 'Object', 'Array', 'GeoPoint', 'File', 'Bytes', 'Polygon']; // Returns an error suitable for throwing if the type is invalid

const fieldTypeIsInvalid = ({
  type,
  targetClass
}) => {
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
  schema.fields._rperm = {
    type: 'Array'
  };
  schema.fields._wperm = {
    type: 'Array'
  };

  if (schema.className === '_User') {
    delete schema.fields.password;
    schema.fields._hashed_password = {
      type: 'String'
    };
  }

  return schema;
};

exports.convertSchemaToAdapterSchema = convertSchemaToAdapterSchema;

const convertAdapterSchemaToParseSchema = (_ref) => {
  let schema = _extends({}, _ref);

  delete schema.fields._rperm;
  delete schema.fields._wperm;
  schema.fields.ACL = {
    type: 'ACL'
  };

  if (schema.className === '_User') {
    delete schema.fields.authData; //Auth data is implicit

    delete schema.fields._hashed_password;
    schema.fields.password = {
      type: 'String'
    };
  }

  if (schema.indexes && Object.keys(schema.indexes).length === 0) {
    delete schema.indexes;
  }

  return schema;
};

class SchemaData {
  constructor(allSchemas = []) {
    this.__data = {};
    allSchemas.forEach(schema => {
      Object.defineProperty(this, schema.className, {
        get: () => {
          if (!this.__data[schema.className]) {
            const data = {};
            data.fields = injectDefaultSchema(schema).fields;
            data.classLevelPermissions = schema.classLevelPermissions;
            data.indexes = schema.indexes;
            this.__data[schema.className] = data;
          }

          return this.__data[schema.className];
        }
      });
    }); // Inject the in-memory classes

    volatileClasses.forEach(className => {
      Object.defineProperty(this, className, {
        get: () => {
          if (!this.__data[className]) {
            const schema = injectDefaultSchema({
              className,
              fields: {},
              classLevelPermissions: {}
            });
            const data = {};
            data.fields = schema.fields;
            data.classLevelPermissions = schema.classLevelPermissions;
            data.indexes = schema.indexes;
            this.__data[className] = data;
          }

          return this.__data[className];
        }
      });
    });
  }

}

const injectDefaultSchema = ({
  className,
  fields,
  classLevelPermissions,
  indexes
}) => {
  const defaultSchema = {
    className,
    fields: _objectSpread({}, defaultColumns._Default, defaultColumns[className] || {}, fields),
    classLevelPermissions
  };

  if (indexes && Object.keys(indexes).length !== 0) {
    defaultSchema.indexes = indexes;
  }

  return defaultSchema;
};

const _HooksSchema = {
  className: '_Hooks',
  fields: defaultColumns._Hooks
};
const _GlobalConfigSchema = {
  className: '_GlobalConfig',
  fields: defaultColumns._GlobalConfig
};

const _PushStatusSchema = convertSchemaToAdapterSchema(injectDefaultSchema({
  className: '_PushStatus',
  fields: {},
  classLevelPermissions: {}
}));

const _JobStatusSchema = convertSchemaToAdapterSchema(injectDefaultSchema({
  className: '_JobStatus',
  fields: {},
  classLevelPermissions: {}
}));

const _JobScheduleSchema = convertSchemaToAdapterSchema(injectDefaultSchema({
  className: '_JobSchedule',
  fields: {},
  classLevelPermissions: {}
}));

const _AudienceSchema = convertSchemaToAdapterSchema(injectDefaultSchema({
  className: '_Audience',
  fields: defaultColumns._Audience,
  classLevelPermissions: {}
}));

const VolatileClassesSchemas = [_HooksSchema, _JobStatusSchema, _JobScheduleSchema, _PushStatusSchema, _GlobalConfigSchema, _AudienceSchema];
exports.VolatileClassesSchemas = VolatileClassesSchemas;

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
}; // Stores the entire schema of the app in a weird hybrid format somewhere between
// the mongo format and the Parse format. Soon, this will all be Parse format.


class SchemaController {
  constructor(databaseAdapter, schemaCache) {
    this._dbAdapter = databaseAdapter;
    this._cache = schemaCache;
    this.schemaData = new SchemaData();
  }

  reloadData(options = {
    clearCache: false
  }) {
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
        this.schemaData = new SchemaData(allSchemas);
        delete this.reloadDataPromise;
      }, err => {
        this.schemaData = new SchemaData();
        delete this.reloadDataPromise;
        throw err;
      });
    }).then(() => {});
    return this.reloadDataPromise;
  }

  getAllClasses(options = {
    clearCache: false
  }) {
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

  getOneSchema(className, allowVolatileClasses = false, options = {
    clearCache: false
  }) {
    let promise = Promise.resolve();

    if (options.clearCache) {
      promise = this._cache.clear();
    }

    return promise.then(() => {
      if (allowVolatileClasses && volatileClasses.indexOf(className) > -1) {
        const data = this.schemaData[className];
        return Promise.resolve({
          className,
          fields: data.fields,
          classLevelPermissions: data.classLevelPermissions,
          indexes: data.indexes
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
  } // Create a new class that includes the three default fields.
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

    return this._dbAdapter.createClass(className, convertSchemaToAdapterSchema({
      fields,
      classLevelPermissions,
      indexes,
      className
    })).then(convertAdapterSchemaToParseSchema).then(res => {
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
      } // Finally we have checked to make sure the request is valid and we can start deleting fields.
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
      .then(() => this.reloadData({
        clearCache: true
      })) // Reload our Schema, so we have all the new values
      .then(() => {
        const promises = insertedFields.map(fieldName => {
          const type = submittedFields[fieldName];
          return this.enforceFieldExists(className, fieldName, type);
        });
        return Promise.all(promises);
      }).then(() => this.setPermissions(className, classLevelPermissions, newSchema)).then(() => this._dbAdapter.setIndexesWithSchemaFormat(className, indexes, schema.indexes, fullNewSchema)).then(() => this.reloadData({
        clearCache: true
      })) //TODO: Move this logic into the database adapter
      .then(() => {
        const schema = this.schemaData[className];
        const reloadedSchema = {
          className: className,
          fields: schema.fields,
          classLevelPermissions: schema.classLevelPermissions
        };

        if (schema.indexes && Object.keys(schema.indexes).length !== 0) {
          reloadedSchema.indexes = schema.indexes;
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
  } // Returns a promise that resolves successfully to the new schema
  // object or fails with a reason.


  enforceClassExists(className) {
    if (this.schemaData[className]) {
      return Promise.resolve(this);
    } // We don't have this class. Update the schema


    return this.addClassIfNotExists(className) // The schema update succeeded. Reload the schema
    .then(() => this.reloadData({
      clearCache: true
    })).catch(() => {
      // The schema update failed. This can be okay - it might
      // have failed because there's a race condition and a different
      // client is making the exact same schema update that we want.
      // So just reload the schema.
      return this.reloadData({
        clearCache: true
      });
    }).then(() => {
      // Ensure that the schema now validates
      if (this.schemaData[className]) {
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
    if (this.schemaData[className]) {
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
        if (error) return {
          code: error.code,
          error: error.message
        };
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
  } // Sets the Class-level permissions for a given className, which must exist.


  setPermissions(className, perms, newSchema) {
    if (typeof perms === 'undefined') {
      return Promise.resolve();
    }

    validateCLP(perms, newSchema);
    return this._dbAdapter.setClassLevelPermissions(className, perms);
  } // Returns a promise that resolves successfully to the new schema
  // object if the provided className-fieldName-type tuple is valid.
  // The className must already be validated.
  // If 'freeze' is true, refuse to update the schema for this field.


  enforceFieldExists(className, fieldName, type) {
    if (fieldName.indexOf('.') > 0) {
      // subdocument key (x.y) => ok if x is of type 'object'
      fieldName = fieldName.split('.')[0];
      type = 'Object';
    }

    if (!fieldNameIsValid(fieldName)) {
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, `Invalid field name: ${fieldName}.`);
    } // If someone tries to create a new field with null/undefined as the value, return;


    if (!type) {
      return Promise.resolve(this);
    }

    return this.reloadData().then(() => {
      const expectedType = this.getExpectedType(className, fieldName);

      if (typeof type === 'string') {
        type = {
          type
        };
      }

      if (expectedType) {
        if (!dbTypeMatchesObjectType(expectedType, type)) {
          throw new Parse.Error(Parse.Error.INCORRECT_TYPE, `schema mismatch for ${className}.${fieldName}; expected ${typeToString(expectedType)} but got ${typeToString(type)}`);
        }

        return this;
      }

      return this._dbAdapter.addFieldIfNotExists(className, fieldName, type).then(() => {
        // The update succeeded. Reload the schema
        return this.reloadData({
          clearCache: true
        });
      }, error => {
        if (error.code == Parse.Error.INCORRECT_TYPE) {
          // Make sure that we throw errors when it is appropriate to do so.
          throw error;
        } // The update failed. This can be okay - it might have been a race
        // condition where another client updated the schema in the same
        // way that we wanted to. So, just reload the schema


        return this.reloadData({
          clearCache: true
        });
      }).then(() => {
        // Ensure that the schema now validates
        const expectedType = this.getExpectedType(className, fieldName);

        if (typeof type === 'string') {
          type = {
            type
          };
        }

        if (!expectedType || !dbTypeMatchesObjectType(expectedType, type)) {
          throw new Parse.Error(Parse.Error.INVALID_JSON, `Could not add field ${fieldName}`);
        } // Remove the cached schema


        this._cache.clear();

        return this;
      });
    });
  } // maintain compatibility


  deleteField(fieldName, className, database) {
    return this.deleteFields([fieldName], className, database);
  } // Delete fields, and remove that data from all objects. This is intended
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
      } //Don't allow deleting the default fields.


      if (!fieldNameIsValidForClass(fieldName, className)) {
        throw new Parse.Error(136, `field ${fieldName} cannot be changed`);
      }
    });
    return this.getOneSchema(className, false, {
      clearCache: true
    }).catch(error => {
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

      const schemaFields = _objectSpread({}, schema.fields);

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
  } // Validates an object provided in REST format.
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
  } // Validates that all the properties are set for the object


  validateRequiredColumns(className, object, query) {
    const columns = requiredColumns[className];

    if (!columns || columns.length == 0) {
      return Promise.resolve(this);
    }

    const missingColumns = columns.filter(function (column) {
      if (query && query.objectId) {
        if (object[column] && typeof object[column] === 'object') {
          // Trying to delete a required column
          return object[column].__op == 'Delete';
        } // Not trying to do anything there


        return false;
      }

      return !object[column];
    });

    if (missingColumns.length > 0) {
      throw new Parse.Error(Parse.Error.INCORRECT_TYPE, missingColumns[0] + ' is required.');
    }

    return Promise.resolve(this);
  }

  testPermissionsForClassName(className, aclGroup, operation) {
    return SchemaController.testPermissions(this.getClassLevelPermissions(className), aclGroup, operation);
  } // Tests that the class level permission let pass the operation for a given aclGroup


  static testPermissions(classPermissions, aclGroup, operation) {
    if (!classPermissions || !classPermissions[operation]) {
      return true;
    }

    const perms = classPermissions[operation];

    if (perms['*']) {
      return true;
    } // Check permissions against the aclGroup provided (array of userId/roles)


    if (aclGroup.some(acl => {
      return perms[acl] === true;
    })) {
      return true;
    }

    return false;
  } // Validates an operation passes class-level-permissions set in the schema


  static validatePermission(classPermissions, className, aclGroup, operation) {
    if (SchemaController.testPermissions(classPermissions, aclGroup, operation)) {
      return Promise.resolve();
    }

    if (!classPermissions || !classPermissions[operation]) {
      return true;
    }

    const perms = classPermissions[operation]; // If only for authenticated users
    // make sure we have an aclGroup

    if (perms['requiresAuthentication']) {
      // If aclGroup has * (public)
      if (!aclGroup || aclGroup.length == 0) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Permission denied, user needs to be authenticated.');
      } else if (aclGroup.indexOf('*') > -1 && aclGroup.length == 1) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Permission denied, user needs to be authenticated.');
      } // requiresAuthentication passed, just move forward
      // probably would be wise at some point to rename to 'authenticatedUser'


      return Promise.resolve();
    } // No matching CLP, let's check the Pointer permissions
    // And handle those later


    const permissionField = ['get', 'find', 'count'].indexOf(operation) > -1 ? 'readUserFields' : 'writeUserFields'; // Reject create when write lockdown

    if (permissionField == 'writeUserFields' && operation == 'create') {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, `Permission denied for action ${operation} on class ${className}.`);
    } // Process the readUserFields later


    if (Array.isArray(classPermissions[permissionField]) && classPermissions[permissionField].length > 0) {
      return Promise.resolve();
    }

    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, `Permission denied for action ${operation} on class ${className}.`);
  } // Validates an operation passes class-level-permissions set in the schema


  validatePermission(className, aclGroup, operation) {
    return SchemaController.validatePermission(this.getClassLevelPermissions(className), className, aclGroup, operation);
  }

  getClassLevelPermissions(className) {
    return this.schemaData[className] && this.schemaData[className].classLevelPermissions;
  } // Returns the expected type for a className+key combination
  // or undefined if the schema is not set


  getExpectedType(className, fieldName) {
    if (this.schemaData[className]) {
      const expectedType = this.schemaData[className].fields[fieldName];
      return expectedType === 'map' ? 'Object' : expectedType;
    }

    return undefined;
  } // Checks if a given class is in the schema.


  hasClass(className) {
    return this.reloadData().then(() => !!this.schemaData[className]);
  }

} // Returns a promise for a new Schema.


exports.SchemaController = exports.default = SchemaController;

const load = (dbAdapter, schemaCache, options) => {
  const schema = new SchemaController(dbAdapter, schemaCache);
  return schema.reloadData(options).then(() => schema);
}; // Builds a new schema (in schema API response format) out of an
// existing mongo schema + a schemas API put request. This response
// does not include the default fields, as it is intended to be passed
// to mongoSchemaFromFieldsAndClassName. No validation is done here, it
// is done in mongoSchemaFromFieldsAndClassName.


exports.load = load;

function buildMergedSchemaObject(existingFields, putRequest) {
  const newSchema = {}; // -disable-next

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
} // Given a schema promise, construct another schema promise that
// validates this field once the schema loads.


function thenValidateRequiredColumns(schemaPromise, className, object, query) {
  return schemaPromise.then(schema => {
    return schema.validateRequiredColumns(className, object, query);
  });
} // Gets the type from a REST API formatted object, where 'type' is
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
} // This gets the type for non-JSON types like pointers and files, but
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

    throw new Parse.Error(Parse.Error.INCORRECT_TYPE, 'This is not a valid ' + obj.__type);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9TY2hlbWFDb250cm9sbGVyLmpzIl0sIm5hbWVzIjpbIlBhcnNlIiwicmVxdWlyZSIsImRlZmF1bHRDb2x1bW5zIiwiT2JqZWN0IiwiZnJlZXplIiwiX0RlZmF1bHQiLCJvYmplY3RJZCIsInR5cGUiLCJjcmVhdGVkQXQiLCJ1cGRhdGVkQXQiLCJBQ0wiLCJfVXNlciIsInVzZXJuYW1lIiwicGFzc3dvcmQiLCJlbWFpbCIsImVtYWlsVmVyaWZpZWQiLCJhdXRoRGF0YSIsIl9JbnN0YWxsYXRpb24iLCJpbnN0YWxsYXRpb25JZCIsImRldmljZVRva2VuIiwiY2hhbm5lbHMiLCJkZXZpY2VUeXBlIiwicHVzaFR5cGUiLCJHQ01TZW5kZXJJZCIsInRpbWVab25lIiwibG9jYWxlSWRlbnRpZmllciIsImJhZGdlIiwiYXBwVmVyc2lvbiIsImFwcE5hbWUiLCJhcHBJZGVudGlmaWVyIiwicGFyc2VWZXJzaW9uIiwiX1JvbGUiLCJuYW1lIiwidXNlcnMiLCJ0YXJnZXRDbGFzcyIsInJvbGVzIiwiX1Nlc3Npb24iLCJyZXN0cmljdGVkIiwidXNlciIsInNlc3Npb25Ub2tlbiIsImV4cGlyZXNBdCIsImNyZWF0ZWRXaXRoIiwiX1Byb2R1Y3QiLCJwcm9kdWN0SWRlbnRpZmllciIsImRvd25sb2FkIiwiZG93bmxvYWROYW1lIiwiaWNvbiIsIm9yZGVyIiwidGl0bGUiLCJzdWJ0aXRsZSIsIl9QdXNoU3RhdHVzIiwicHVzaFRpbWUiLCJzb3VyY2UiLCJxdWVyeSIsInBheWxvYWQiLCJleHBpcnkiLCJleHBpcmF0aW9uX2ludGVydmFsIiwic3RhdHVzIiwibnVtU2VudCIsIm51bUZhaWxlZCIsInB1c2hIYXNoIiwiZXJyb3JNZXNzYWdlIiwic2VudFBlclR5cGUiLCJmYWlsZWRQZXJUeXBlIiwic2VudFBlclVUQ09mZnNldCIsImZhaWxlZFBlclVUQ09mZnNldCIsImNvdW50IiwiX0pvYlN0YXR1cyIsImpvYk5hbWUiLCJtZXNzYWdlIiwicGFyYW1zIiwiZmluaXNoZWRBdCIsIl9Kb2JTY2hlZHVsZSIsImRlc2NyaXB0aW9uIiwic3RhcnRBZnRlciIsImRheXNPZldlZWsiLCJ0aW1lT2ZEYXkiLCJsYXN0UnVuIiwicmVwZWF0TWludXRlcyIsIl9Ib29rcyIsImZ1bmN0aW9uTmFtZSIsImNsYXNzTmFtZSIsInRyaWdnZXJOYW1lIiwidXJsIiwiX0dsb2JhbENvbmZpZyIsIl9BdWRpZW5jZSIsImxhc3RVc2VkIiwidGltZXNVc2VkIiwicmVxdWlyZWRDb2x1bW5zIiwic3lzdGVtQ2xhc3NlcyIsInZvbGF0aWxlQ2xhc3NlcyIsInVzZXJJZFJlZ2V4Iiwicm9sZVJlZ2V4IiwicHVibGljUmVnZXgiLCJyZXF1aXJlQXV0aGVudGljYXRpb25SZWdleCIsInBlcm1pc3Npb25LZXlSZWdleCIsInZlcmlmeVBlcm1pc3Npb25LZXkiLCJrZXkiLCJyZXN1bHQiLCJyZWR1Y2UiLCJpc0dvb2QiLCJyZWdFeCIsIm1hdGNoIiwiRXJyb3IiLCJJTlZBTElEX0pTT04iLCJDTFBWYWxpZEtleXMiLCJ2YWxpZGF0ZUNMUCIsInBlcm1zIiwiZmllbGRzIiwia2V5cyIsImZvckVhY2giLCJvcGVyYXRpb24iLCJpbmRleE9mIiwiQXJyYXkiLCJpc0FycmF5IiwicGVybSIsImpvaW5DbGFzc1JlZ2V4IiwiY2xhc3NBbmRGaWVsZFJlZ2V4IiwiY2xhc3NOYW1lSXNWYWxpZCIsInRlc3QiLCJmaWVsZE5hbWVJc1ZhbGlkIiwiZmllbGROYW1lIiwiZmllbGROYW1lSXNWYWxpZEZvckNsYXNzIiwiaW52YWxpZENsYXNzTmFtZU1lc3NhZ2UiLCJpbnZhbGlkSnNvbkVycm9yIiwidmFsaWROb25SZWxhdGlvbk9yUG9pbnRlclR5cGVzIiwiZmllbGRUeXBlSXNJbnZhbGlkIiwiSU5WQUxJRF9DTEFTU19OQU1FIiwidW5kZWZpbmVkIiwiSU5DT1JSRUNUX1RZUEUiLCJjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hIiwic2NoZW1hIiwiaW5qZWN0RGVmYXVsdFNjaGVtYSIsIl9ycGVybSIsIl93cGVybSIsIl9oYXNoZWRfcGFzc3dvcmQiLCJjb252ZXJ0QWRhcHRlclNjaGVtYVRvUGFyc2VTY2hlbWEiLCJpbmRleGVzIiwibGVuZ3RoIiwiU2NoZW1hRGF0YSIsImNvbnN0cnVjdG9yIiwiYWxsU2NoZW1hcyIsIl9fZGF0YSIsImRlZmluZVByb3BlcnR5IiwiZ2V0IiwiZGF0YSIsImNsYXNzTGV2ZWxQZXJtaXNzaW9ucyIsImRlZmF1bHRTY2hlbWEiLCJfSG9va3NTY2hlbWEiLCJfR2xvYmFsQ29uZmlnU2NoZW1hIiwiX1B1c2hTdGF0dXNTY2hlbWEiLCJfSm9iU3RhdHVzU2NoZW1hIiwiX0pvYlNjaGVkdWxlU2NoZW1hIiwiX0F1ZGllbmNlU2NoZW1hIiwiVm9sYXRpbGVDbGFzc2VzU2NoZW1hcyIsImRiVHlwZU1hdGNoZXNPYmplY3RUeXBlIiwiZGJUeXBlIiwib2JqZWN0VHlwZSIsInR5cGVUb1N0cmluZyIsIlNjaGVtYUNvbnRyb2xsZXIiLCJkYXRhYmFzZUFkYXB0ZXIiLCJzY2hlbWFDYWNoZSIsIl9kYkFkYXB0ZXIiLCJfY2FjaGUiLCJzY2hlbWFEYXRhIiwicmVsb2FkRGF0YSIsIm9wdGlvbnMiLCJjbGVhckNhY2hlIiwicHJvbWlzZSIsIlByb21pc2UiLCJyZXNvbHZlIiwidGhlbiIsImNsZWFyIiwicmVsb2FkRGF0YVByb21pc2UiLCJnZXRBbGxDbGFzc2VzIiwiZXJyIiwiYWxsQ2xhc3NlcyIsIm1hcCIsInNldEFsbENsYXNzZXMiLCJnZXRPbmVTY2hlbWEiLCJhbGxvd1ZvbGF0aWxlQ2xhc3NlcyIsImNhY2hlZCIsImdldENsYXNzIiwic2V0T25lU2NoZW1hIiwiYWRkQ2xhc3NJZk5vdEV4aXN0cyIsInZhbGlkYXRpb25FcnJvciIsInZhbGlkYXRlTmV3Q2xhc3MiLCJyZWplY3QiLCJjcmVhdGVDbGFzcyIsInJlcyIsImNhdGNoIiwiZXJyb3IiLCJjb2RlIiwiRFVQTElDQVRFX1ZBTFVFIiwidXBkYXRlQ2xhc3MiLCJzdWJtaXR0ZWRGaWVsZHMiLCJkYXRhYmFzZSIsImV4aXN0aW5nRmllbGRzIiwiZmllbGQiLCJfX29wIiwibmV3U2NoZW1hIiwiYnVpbGRNZXJnZWRTY2hlbWFPYmplY3QiLCJkZWZhdWx0RmllbGRzIiwiZnVsbE5ld1NjaGVtYSIsImFzc2lnbiIsInZhbGlkYXRlU2NoZW1hRGF0YSIsImRlbGV0ZWRGaWVsZHMiLCJpbnNlcnRlZEZpZWxkcyIsInB1c2giLCJkZWxldGVQcm9taXNlIiwiZGVsZXRlRmllbGRzIiwicHJvbWlzZXMiLCJlbmZvcmNlRmllbGRFeGlzdHMiLCJhbGwiLCJzZXRQZXJtaXNzaW9ucyIsInNldEluZGV4ZXNXaXRoU2NoZW1hRm9ybWF0IiwicmVsb2FkZWRTY2hlbWEiLCJlbmZvcmNlQ2xhc3NFeGlzdHMiLCJleGlzdGluZ0ZpZWxkTmFtZXMiLCJJTlZBTElEX0tFWV9OQU1FIiwiZ2VvUG9pbnRzIiwiZmlsdGVyIiwic2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zIiwic3BsaXQiLCJleHBlY3RlZFR5cGUiLCJnZXRFeHBlY3RlZFR5cGUiLCJhZGRGaWVsZElmTm90RXhpc3RzIiwiZGVsZXRlRmllbGQiLCJmaWVsZE5hbWVzIiwic2NoZW1hRmllbGRzIiwiYWRhcHRlciIsImRlbGV0ZUNsYXNzIiwidmFsaWRhdGVPYmplY3QiLCJvYmplY3QiLCJnZW9jb3VudCIsImV4cGVjdGVkIiwiZ2V0VHlwZSIsInRoZW5WYWxpZGF0ZVJlcXVpcmVkQ29sdW1ucyIsInZhbGlkYXRlUmVxdWlyZWRDb2x1bW5zIiwiY29sdW1ucyIsIm1pc3NpbmdDb2x1bW5zIiwiY29sdW1uIiwidGVzdFBlcm1pc3Npb25zRm9yQ2xhc3NOYW1lIiwiYWNsR3JvdXAiLCJ0ZXN0UGVybWlzc2lvbnMiLCJnZXRDbGFzc0xldmVsUGVybWlzc2lvbnMiLCJjbGFzc1Blcm1pc3Npb25zIiwic29tZSIsImFjbCIsInZhbGlkYXRlUGVybWlzc2lvbiIsIk9CSkVDVF9OT1RfRk9VTkQiLCJwZXJtaXNzaW9uRmllbGQiLCJPUEVSQVRJT05fRk9SQklEREVOIiwiaGFzQ2xhc3MiLCJsb2FkIiwiZGJBZGFwdGVyIiwicHV0UmVxdWVzdCIsInN5c1NjaGVtYUZpZWxkIiwiX2lkIiwib2xkRmllbGQiLCJmaWVsZElzRGVsZXRlZCIsIm5ld0ZpZWxkIiwic2NoZW1hUHJvbWlzZSIsIm9iaiIsImdldE9iamVjdFR5cGUiLCJfX3R5cGUiLCJpc28iLCJsYXRpdHVkZSIsImxvbmdpdHVkZSIsImJhc2U2NCIsImNvb3JkaW5hdGVzIiwib2JqZWN0cyIsIm9wcyJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7QUFrQkE7O0FBQ0E7Ozs7Ozs7Ozs7QUFsQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxNQUFNQSxLQUFLLEdBQUdDLE9BQU8sQ0FBQyxZQUFELENBQVAsQ0FBc0JELEtBQXBDOztBQVdBLE1BQU1FLGNBQTBDLEdBQUdDLE1BQU0sQ0FBQ0MsTUFBUCxDQUFjO0FBQy9EO0FBQ0FDLEVBQUFBLFFBQVEsRUFBRTtBQUNSQyxJQUFBQSxRQUFRLEVBQUU7QUFBRUMsTUFBQUEsSUFBSSxFQUFFO0FBQVIsS0FERjtBQUVSQyxJQUFBQSxTQUFTLEVBQUU7QUFBRUQsTUFBQUEsSUFBSSxFQUFFO0FBQVIsS0FGSDtBQUdSRSxJQUFBQSxTQUFTLEVBQUU7QUFBRUYsTUFBQUEsSUFBSSxFQUFFO0FBQVIsS0FISDtBQUlSRyxJQUFBQSxHQUFHLEVBQUU7QUFBRUgsTUFBQUEsSUFBSSxFQUFFO0FBQVI7QUFKRyxHQUZxRDtBQVEvRDtBQUNBSSxFQUFBQSxLQUFLLEVBQUU7QUFDTEMsSUFBQUEsUUFBUSxFQUFFO0FBQUVMLE1BQUFBLElBQUksRUFBRTtBQUFSLEtBREw7QUFFTE0sSUFBQUEsUUFBUSxFQUFFO0FBQUVOLE1BQUFBLElBQUksRUFBRTtBQUFSLEtBRkw7QUFHTE8sSUFBQUEsS0FBSyxFQUFFO0FBQUVQLE1BQUFBLElBQUksRUFBRTtBQUFSLEtBSEY7QUFJTFEsSUFBQUEsYUFBYSxF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QVA7QUFDRDs7QUFDRDtBQXpDSjs7QUEyQ0EsVUFBTSxJQUFJOVEsS0FBSyxDQUFDdUcsS0FBVixDQUNKdkcsS0FBSyxDQUFDdUcsS0FBTixDQUFZMEIsY0FEUixFQUVKLHlCQUF5QnNJLEdBQUcsQ0FBQ0UsTUFGekIsQ0FBTjtBQUlEOztBQUNELE1BQUlGLEdBQUcsQ0FBQyxLQUFELENBQVAsRUFBZ0I7QUFDZCxXQUFPQyxhQUFhLENBQUNELEdBQUcsQ0FBQyxLQUFELENBQUosQ0FBcEI7QUFDRDs7QUFDRCxNQUFJQSxHQUFHLENBQUNoRSxJQUFSLEVBQWM7QUFDWixZQUFRZ0UsR0FBRyxDQUFDaEUsSUFBWjtBQUNFLFdBQUssV0FBTDtBQUNFLGVBQU8sUUFBUDs7QUFDRixXQUFLLFFBQUw7QUFDRSxlQUFPLElBQVA7O0FBQ0YsV0FBSyxLQUFMO0FBQ0EsV0FBSyxXQUFMO0FBQ0EsV0FBSyxRQUFMO0FBQ0UsZUFBTyxPQUFQOztBQUNGLFdBQUssYUFBTDtBQUNBLFdBQUssZ0JBQUw7QUFDRSxlQUFPO0FBQ0xoTSxVQUFBQSxJQUFJLEVBQUUsVUFERDtBQUVMMkIsVUFBQUEsV0FBVyxFQUFFcU8sR0FBRyxDQUFDUSxPQUFKLENBQVksQ0FBWixFQUFlOUw7QUFGdkIsU0FBUDs7QUFJRixXQUFLLE9BQUw7QUFDRSxlQUFPdUwsYUFBYSxDQUFDRCxHQUFHLENBQUNTLEdBQUosQ0FBUSxDQUFSLENBQUQsQ0FBcEI7O0FBQ0Y7QUFDRSxjQUFNLG9CQUFvQlQsR0FBRyxDQUFDaEUsSUFBOUI7QUFsQko7QUFvQkQ7O0FBQ0QsU0FBTyxRQUFQO0FBQ0QiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAZmxvd1xuLy8gVGhpcyBjbGFzcyBoYW5kbGVzIHNjaGVtYSB2YWxpZGF0aW9uLCBwZXJzaXN0ZW5jZSwgYW5kIG1vZGlmaWNhdGlvbi5cbi8vXG4vLyBFYWNoIGluZGl2aWR1YWwgU2NoZW1hIG9iamVjdCBzaG91bGQgYmUgaW1tdXRhYmxlLiBUaGUgaGVscGVycyB0b1xuLy8gZG8gdGhpbmdzIHdpdGggdGhlIFNjaGVtYSBqdXN0IHJldHVybiBhIG5ldyBzY2hlbWEgd2hlbiB0aGUgc2NoZW1hXG4vLyBpcyBjaGFuZ2VkLlxuLy9cbi8vIFRoZSBjYW5vbmljYWwgcGxhY2UgdG8gc3RvcmUgdGhpcyBTY2hlbWEgaXMgaW4gdGhlIGRhdGFiYXNlIGl0c2VsZixcbi8vIGluIGEgX1NDSEVNQSBjb2xsZWN0aW9uLiBUaGlzIGlzIG5vdCB0aGUgcmlnaHQgd2F5IHRvIGRvIGl0IGZvciBhblxuLy8gb3BlbiBzb3VyY2UgZnJhbWV3b3JrLCBidXQgaXQncyBiYWNrd2FyZCBjb21wYXRpYmxlLCBzbyB3ZSdyZVxuLy8ga2VlcGluZyBpdCB0aGlzIHdheSBmb3Igbm93LlxuLy9cbi8vIEluIEFQSS1oYW5kbGluZyBjb2RlLCB5b3Ugc2hvdWxkIG9ubHkgdXNlIHRoZSBTY2hlbWEgY2xhc3MgdmlhIHRoZVxuLy8gRGF0YWJhc2VDb250cm9sbGVyLiBUaGlzIHdpbGwgbGV0IHVzIHJlcGxhY2UgdGhlIHNjaGVtYSBsb2dpYyBmb3Jcbi8vIGRpZmZlcmVudCBkYXRhYmFzZXMuXG4vLyBUT0RPOiBoaWRlIGFsbCBzY2hlbWEgbG9naWMgaW5zaWRlIHRoZSBkYXRhYmFzZSBhZGFwdGVyLlxuLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG5jb25zdCBQYXJzZSA9IHJlcXVpcmUoJ3BhcnNlL25vZGUnKS5QYXJzZTtcbmltcG9ydCB7IFN0b3JhZ2VBZGFwdGVyIH0gZnJvbSAnLi4vQWRhcHRlcnMvU3RvcmFnZS9TdG9yYWdlQWRhcHRlcic7XG5pbXBvcnQgRGF0YWJhc2VDb250cm9sbGVyIGZyb20gJy4vRGF0YWJhc2VDb250cm9sbGVyJztcbmltcG9ydCB0eXBlIHtcbiAgU2NoZW1hLFxuICBTY2hlbWFGaWVsZHMsXG4gIENsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgU2NoZW1hRmllbGQsXG4gIExvYWRTY2hlbWFPcHRpb25zLFxufSBmcm9tICcuL3R5cGVzJztcblxuY29uc3QgZGVmYXVsdENvbHVtbnM6IHsgW3N0cmluZ106IFNjaGVtYUZpZWxkcyB9ID0gT2JqZWN0LmZyZWV6ZSh7XG4gIC8vIENvbnRhaW4gdGhlIGRlZmF1bHQgY29sdW1ucyBmb3IgZXZlcnkgcGFyc2Ugb2JqZWN0IHR5cGUgKGV4Y2VwdCBfSm9pbiBjb2xsZWN0aW9uKVxuICBfRGVmYXVsdDoge1xuICAgIG9iamVjdElkOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgY3JlYXRlZEF0OiB7IHR5cGU6ICdEYXRlJyB9LFxuICAgIHVwZGF0ZWRBdDogeyB0eXBlOiAnRGF0ZScgfSxcbiAgICBBQ0w6IHsgdHlwZTogJ0FDTCcgfSxcbiAgfSxcbiAgLy8gVGhlIGFkZGl0aW9uYWwgZGVmYXVsdCBjb2x1bW5zIGZvciB0aGUgX1VzZXIgY29sbGVjdGlvbiAoaW4gYWRkaXRpb24gdG8gRGVmYXVsdENvbHMpXG4gIF9Vc2VyOiB7XG4gICAgdXNlcm5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBwYXNzd29yZDogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGVtYWlsOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgZW1haWxWZXJpZmllZDogeyB0eXBlOiAnQm9vbGVhbicgfSxcbiAgICBhdXRoRGF0YTogeyB0eXBlOiAnT2JqZWN0JyB9LFxuICB9LFxuICAvLyBUaGUgYWRkaXRpb25hbCBkZWZhdWx0IGNvbHVtbnMgZm9yIHRoZSBfSW5zdGFsbGF0aW9uIGNvbGxlY3Rpb24gKGluIGFkZGl0aW9uIHRvIERlZmF1bHRDb2xzKVxuICBfSW5zdGFsbGF0aW9uOiB7XG4gICAgaW5zdGFsbGF0aW9uSWQ6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBkZXZpY2VUb2tlbjogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGNoYW5uZWxzOiB7IHR5cGU6ICdBcnJheScgfSxcbiAgICBkZXZpY2VUeXBlOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgcHVzaFR5cGU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBHQ01TZW5kZXJJZDogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHRpbWVab25lOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgbG9jYWxlSWRlbnRpZmllcjogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGJhZGdlOiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gICAgYXBwVmVyc2lvbjogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGFwcE5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBhcHBJZGVudGlmaWVyOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgcGFyc2VWZXJzaW9uOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gIH0sXG4gIC8vIFRoZSBhZGRpdGlvbmFsIGRlZmF1bHQgY29sdW1ucyBmb3IgdGhlIF9Sb2xlIGNvbGxlY3Rpb24gKGluIGFkZGl0aW9uIHRvIERlZmF1bHRDb2xzKVxuICBfUm9sZToge1xuICAgIG5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICB1c2VyczogeyB0eXBlOiAnUmVsYXRpb24nLCB0YXJnZXRDbGFzczogJ19Vc2VyJyB9LFxuICAgIHJvbGVzOiB7IHR5cGU6ICdSZWxhdGlvbicsIHRhcmdldENsYXNzOiAnX1JvbGUnIH0sXG4gIH0sXG4gIC8vIFRoZSBhZGRpdGlvbmFsIGRlZmF1bHQgY29sdW1ucyBmb3IgdGhlIF9TZXNzaW9uIGNvbGxlY3Rpb24gKGluIGFkZGl0aW9uIHRvIERlZmF1bHRDb2xzKVxuICBfU2Vzc2lvbjoge1xuICAgIHJlc3RyaWN0ZWQ6IHsgdHlwZTogJ0Jvb2xlYW4nIH0sXG4gICAgdXNlcjogeyB0eXBlOiAnUG9pbnRlcicsIHRhcmdldENsYXNzOiAnX1VzZXInIH0sXG4gICAgaW5zdGFsbGF0aW9uSWQ6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBzZXNzaW9uVG9rZW46IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBleHBpcmVzQXQ6IHsgdHlwZTogJ0RhdGUnIH0sXG4gICAgY3JlYXRlZFdpdGg6IHsgdHlwZTogJ09iamVjdCcgfSxcbiAgfSxcbiAgX1Byb2R1Y3Q6IHtcbiAgICBwcm9kdWN0SWRlbnRpZmllcjogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGRvd25sb2FkOiB7IHR5cGU6ICdGaWxlJyB9LFxuICAgIGRvd25sb2FkTmFtZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGljb246IHsgdHlwZTogJ0ZpbGUnIH0sXG4gICAgb3JkZXI6IHsgdHlwZTogJ051bWJlcicgfSxcbiAgICB0aXRsZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHN1YnRpdGxlOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gIH0sXG4gIF9QdXNoU3RhdHVzOiB7XG4gICAgcHVzaFRpbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBzb3VyY2U6IHsgdHlwZTogJ1N0cmluZycgfSwgLy8gcmVzdCBvciB3ZWJ1aVxuICAgIHF1ZXJ5OiB7IHR5cGU6ICdTdHJpbmcnIH0sIC8vIHRoZSBzdHJpbmdpZmllZCBKU09OIHF1ZXJ5XG4gICAgcGF5bG9hZDogeyB0eXBlOiAnU3RyaW5nJyB9LCAvLyB0aGUgc3RyaW5naWZpZWQgSlNPTiBwYXlsb2FkLFxuICAgIHRpdGxlOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgZXhwaXJ5OiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gICAgZXhwaXJhdGlvbl9pbnRlcnZhbDogeyB0eXBlOiAnTnVtYmVyJyB9LFxuICAgIHN0YXR1czogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIG51bVNlbnQ6IHsgdHlwZTogJ051bWJlcicgfSxcbiAgICBudW1GYWlsZWQ6IHsgdHlwZTogJ051bWJlcicgfSxcbiAgICBwdXNoSGFzaDogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGVycm9yTWVzc2FnZTogeyB0eXBlOiAnT2JqZWN0JyB9LFxuICAgIHNlbnRQZXJUeXBlOiB7IHR5cGU6ICdPYmplY3QnIH0sXG4gICAgZmFpbGVkUGVyVHlwZTogeyB0eXBlOiAnT2JqZWN0JyB9LFxuICAgIHNlbnRQZXJVVENPZmZzZXQ6IHsgdHlwZTogJ09iamVjdCcgfSxcbiAgICBmYWlsZWRQZXJVVENPZmZzZXQ6IHsgdHlwZTogJ09iamVjdCcgfSxcbiAgICBjb3VudDogeyB0eXBlOiAnTnVtYmVyJyB9LCAvLyB0cmFja3MgIyBvZiBiYXRjaGVzIHF1ZXVlZCBhbmQgcGVuZGluZ1xuICB9LFxuICBfSm9iU3RhdHVzOiB7XG4gICAgam9iTmFtZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHNvdXJjZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHN0YXR1czogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIG1lc3NhZ2U6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBwYXJhbXM6IHsgdHlwZTogJ09iamVjdCcgfSwgLy8gcGFyYW1zIHJlY2VpdmVkIHdoZW4gY2FsbGluZyB0aGUgam9iXG4gICAgZmluaXNoZWRBdDogeyB0eXBlOiAnRGF0ZScgfSxcbiAgfSxcbiAgX0pvYlNjaGVkdWxlOiB7XG4gICAgam9iTmFtZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGRlc2NyaXB0aW9uOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgcGFyYW1zOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgc3RhcnRBZnRlcjogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGRheXNPZldlZWs6IHsgdHlwZTogJ0FycmF5JyB9LFxuICAgIHRpbWVPZkRheTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGxhc3RSdW46IHsgdHlwZTogJ051bWJlcicgfSxcbiAgICByZXBlYXRNaW51dGVzOiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gIH0sXG4gIF9Ib29rczoge1xuICAgIGZ1bmN0aW9uTmFtZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGNsYXNzTmFtZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHRyaWdnZXJOYW1lOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgdXJsOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gIH0sXG4gIF9HbG9iYWxDb25maWc6IHtcbiAgICBvYmplY3RJZDogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHBhcmFtczogeyB0eXBlOiAnT2JqZWN0JyB9LFxuICB9LFxuICBfQXVkaWVuY2U6IHtcbiAgICBvYmplY3RJZDogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIG5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBxdWVyeTogeyB0eXBlOiAnU3RyaW5nJyB9LCAvL3N0b3JpbmcgcXVlcnkgYXMgSlNPTiBzdHJpbmcgdG8gcHJldmVudCBcIk5lc3RlZCBrZXlzIHNob3VsZCBub3QgY29udGFpbiB0aGUgJyQnIG9yICcuJyBjaGFyYWN0ZXJzXCIgZXJyb3JcbiAgICBsYXN0VXNlZDogeyB0eXBlOiAnRGF0ZScgfSxcbiAgICB0aW1lc1VzZWQ6IHsgdHlwZTogJ051bWJlcicgfSxcbiAgfSxcbn0pO1xuXG5jb25zdCByZXF1aXJlZENvbHVtbnMgPSBPYmplY3QuZnJlZXplKHtcbiAgX1Byb2R1Y3Q6IFsncHJvZHVjdElkZW50aWZpZXInLCAnaWNvbicsICdvcmRlcicsICd0aXRsZScsICdzdWJ0aXRsZSddLFxuICBfUm9sZTogWyduYW1lJywgJ0FDTCddLFxufSk7XG5cbmNvbnN0IHN5c3RlbUNsYXNzZXMgPSBPYmplY3QuZnJlZXplKFtcbiAgJ19Vc2VyJyxcbiAgJ19JbnN0YWxsYXRpb24nLFxuICAnX1JvbGUnLFxuICAnX1Nlc3Npb24nLFxuICAnX1Byb2R1Y3QnLFxuICAnX1B1c2hTdGF0dXMnLFxuICAnX0pvYlN0YXR1cycsXG4gICdfSm9iU2NoZWR1bGUnLFxuICAnX0F1ZGllbmNlJyxcbiAgJ19FeHBvcnRQcm9ncmVzcycsXG5dKTtcblxuY29uc3Qgdm9sYXRpbGVDbGFzc2VzID0gT2JqZWN0LmZyZWV6ZShbXG4gICdfSm9iU3RhdHVzJyxcbiAgJ19QdXNoU3RhdHVzJyxcbiAgJ19Ib29rcycsXG4gICdfR2xvYmFsQ29uZmlnJyxcbiAgJ19Kb2JTY2hlZHVsZScsXG4gICdfQXVkaWVuY2UnLFxuXSk7XG5cbi8vIDEwIGFscGhhIG51bWJlcmljIGNoYXJzICsgdXBwZXJjYXNlXG5jb25zdCB1c2VySWRSZWdleCA9IC9eW2EtekEtWjAtOV17MTB9JC87XG4vLyBBbnl0aGluZyB0aGF0IHN0YXJ0IHdpdGggcm9sZVxuY29uc3Qgcm9sZVJlZ2V4ID0gL15yb2xlOi4qLztcbi8vICogcGVybWlzc2lvblxuY29uc3QgcHVibGljUmVnZXggPSAvXlxcKiQvO1xuXG5jb25zdCByZXF1aXJlQXV0aGVudGljYXRpb25SZWdleCA9IC9ecmVxdWlyZXNBdXRoZW50aWNhdGlvbiQvO1xuXG5jb25zdCBwZXJtaXNzaW9uS2V5UmVnZXggPSBPYmplY3QuZnJlZXplKFtcbiAgdXNlcklkUmVnZXgsXG4gIHJvbGVSZWdleCxcbiAgcHVibGljUmVnZXgsXG4gIHJlcXVpcmVBdXRoZW50aWNhdGlvblJlZ2V4LFxuXSk7XG5cbmZ1bmN0aW9uIHZlcmlmeVBlcm1pc3Npb25LZXkoa2V5KSB7XG4gIGNvbnN0IHJlc3VsdCA9IHBlcm1pc3Npb25LZXlSZWdleC5yZWR1Y2UoKGlzR29vZCwgcmVnRXgpID0+IHtcbiAgICBpc0dvb2QgPSBpc0dvb2QgfHwga2V5Lm1hdGNoKHJlZ0V4KSAhPSBudWxsO1xuICAgIHJldHVybiBpc0dvb2Q7XG4gIH0sIGZhbHNlKTtcbiAgaWYgKCFyZXN1bHQpIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICBgJyR7a2V5fScgaXMgbm90IGEgdmFsaWQga2V5IGZvciBjbGFzcyBsZXZlbCBwZXJtaXNzaW9uc2BcbiAgICApO1xuICB9XG59XG5cbmNvbnN0IENMUFZhbGlkS2V5cyA9IE9iamVjdC5mcmVlemUoW1xuICAnZmluZCcsXG4gICdjb3VudCcsXG4gICdnZXQnLFxuICAnY3JlYXRlJyxcbiAgJ3VwZGF0ZScsXG4gICdkZWxldGUnLFxuICAnYWRkRmllbGQnLFxuICAncmVhZFVzZXJGaWVsZHMnLFxuICAnd3JpdGVVc2VyRmllbGRzJyxcbl0pO1xuZnVuY3Rpb24gdmFsaWRhdGVDTFAocGVybXM6IENsYXNzTGV2ZWxQZXJtaXNzaW9ucywgZmllbGRzOiBTY2hlbWFGaWVsZHMpIHtcbiAgaWYgKCFwZXJtcykge1xuICAgIHJldHVybjtcbiAgfVxuICBPYmplY3Qua2V5cyhwZXJtcykuZm9yRWFjaChvcGVyYXRpb24gPT4ge1xuICAgIGlmIChDTFBWYWxpZEtleXMuaW5kZXhPZihvcGVyYXRpb24pID09IC0xKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgYCR7b3BlcmF0aW9ufSBpcyBub3QgYSB2YWxpZCBvcGVyYXRpb24gZm9yIGNsYXNzIGxldmVsIHBlcm1pc3Npb25zYFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKCFwZXJtc1tvcGVyYXRpb25dKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKG9wZXJhdGlvbiA9PT0gJ3JlYWRVc2VyRmllbGRzJyB8fCBvcGVyYXRpb24gPT09ICd3cml0ZVVzZXJGaWVsZHMnKSB7XG4gICAgICBpZiAoIUFycmF5LmlzQXJyYXkocGVybXNbb3BlcmF0aW9uXSkpIHtcbiAgICAgICAgLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgYCcke1xuICAgICAgICAgICAgcGVybXNbb3BlcmF0aW9uXVxuICAgICAgICAgIH0nIGlzIG5vdCBhIHZhbGlkIHZhbHVlIGZvciBjbGFzcyBsZXZlbCBwZXJtaXNzaW9ucyAke29wZXJhdGlvbn1gXG4gICAgICAgICk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwZXJtc1tvcGVyYXRpb25dLmZvckVhY2goa2V5ID0+IHtcbiAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAhZmllbGRzW2tleV0gfHxcbiAgICAgICAgICAgIGZpZWxkc1trZXldLnR5cGUgIT0gJ1BvaW50ZXInIHx8XG4gICAgICAgICAgICBmaWVsZHNba2V5XS50YXJnZXRDbGFzcyAhPSAnX1VzZXInXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICAgYCcke2tleX0nIGlzIG5vdCBhIHZhbGlkIGNvbHVtbiBmb3IgY2xhc3MgbGV2ZWwgcG9pbnRlciBwZXJtaXNzaW9ucyAke29wZXJhdGlvbn1gXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG4gICAgT2JqZWN0LmtleXMocGVybXNbb3BlcmF0aW9uXSkuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgdmVyaWZ5UGVybWlzc2lvbktleShrZXkpO1xuICAgICAgLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG4gICAgICBjb25zdCBwZXJtID0gcGVybXNbb3BlcmF0aW9uXVtrZXldO1xuICAgICAgaWYgKHBlcm0gIT09IHRydWUpIHtcbiAgICAgICAgLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgYCcke3Blcm19JyBpcyBub3QgYSB2YWxpZCB2YWx1ZSBmb3IgY2xhc3MgbGV2ZWwgcGVybWlzc2lvbnMgJHtvcGVyYXRpb259OiR7a2V5fToke3Blcm19YFxuICAgICAgICApO1xuICAgICAgfVxuICAgIH0pO1xuICB9KTtcbn1cbmNvbnN0IGpvaW5DbGFzc1JlZ2V4ID0gL15fSm9pbjpbQS1aYS16MC05X10rOltBLVphLXowLTlfXSsvO1xuY29uc3QgY2xhc3NBbmRGaWVsZFJlZ2V4ID0gL15bQS1aYS16XVtBLVphLXowLTlfXSokLztcbmZ1bmN0aW9uIGNsYXNzTmFtZUlzVmFsaWQoY2xhc3NOYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgLy8gVmFsaWQgY2xhc3NlcyBtdXN0OlxuICByZXR1cm4gKFxuICAgIC8vIEJlIG9uZSBvZiBfVXNlciwgX0luc3RhbGxhdGlvbiwgX1JvbGUsIF9TZXNzaW9uIE9SXG4gICAgc3lzdGVtQ2xhc3Nlcy5pbmRleE9mKGNsYXNzTmFtZSkgPiAtMSB8fFxuICAgIC8vIEJlIGEgam9pbiB0YWJsZSBPUlxuICAgIGpvaW5DbGFzc1JlZ2V4LnRlc3QoY2xhc3NOYW1lKSB8fFxuICAgIC8vIEluY2x1ZGUgb25seSBhbHBoYS1udW1lcmljIGFuZCB1bmRlcnNjb3JlcywgYW5kIG5vdCBzdGFydCB3aXRoIGFuIHVuZGVyc2NvcmUgb3IgbnVtYmVyXG4gICAgZmllbGROYW1lSXNWYWxpZChjbGFzc05hbWUpXG4gICk7XG59XG5cbi8vIFZhbGlkIGZpZWxkcyBtdXN0IGJlIGFscGhhLW51bWVyaWMsIGFuZCBub3Qgc3RhcnQgd2l0aCBhbiB1bmRlcnNjb3JlIG9yIG51bWJlclxuZnVuY3Rpb24gZmllbGROYW1lSXNWYWxpZChmaWVsZE5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gY2xhc3NBbmRGaWVsZFJlZ2V4LnRlc3QoZmllbGROYW1lKTtcbn1cblxuLy8gQ2hlY2tzIHRoYXQgaXQncyBub3QgdHJ5aW5nIHRvIGNsb2JiZXIgb25lIG9mIHRoZSBkZWZhdWx0IGZpZWxkcyBvZiB0aGUgY2xhc3MuXG5mdW5jdGlvbiBmaWVsZE5hbWVJc1ZhbGlkRm9yQ2xhc3MoXG4gIGZpZWxkTmFtZTogc3RyaW5nLFxuICBjbGFzc05hbWU6IHN0cmluZ1xuKTogYm9vbGVhbiB7XG4gIGlmICghZmllbGROYW1lSXNWYWxpZChmaWVsZE5hbWUpKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmIChkZWZhdWx0Q29sdW1ucy5fRGVmYXVsdFtmaWVsZE5hbWVdKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmIChkZWZhdWx0Q29sdW1uc1tjbGFzc05hbWVdICYmIGRlZmF1bHRDb2x1bW5zW2NsYXNzTmFtZV1bZmllbGROYW1lXSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cblxuZnVuY3Rpb24gaW52YWxpZENsYXNzTmFtZU1lc3NhZ2UoY2xhc3NOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gKFxuICAgICdJbnZhbGlkIGNsYXNzbmFtZTogJyArXG4gICAgY2xhc3NOYW1lICtcbiAgICAnLCBjbGFzc25hbWVzIGNhbiBvbmx5IGhhdmUgYWxwaGFudW1lcmljIGNoYXJhY3RlcnMgYW5kIF8sIGFuZCBtdXN0IHN0YXJ0IHdpdGggYW4gYWxwaGEgY2hhcmFjdGVyICdcbiAgKTtcbn1cblxuY29uc3QgaW52YWxpZEpzb25FcnJvciA9IG5ldyBQYXJzZS5FcnJvcihcbiAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAnaW52YWxpZCBKU09OJ1xuKTtcbmNvbnN0IHZhbGlkTm9uUmVsYXRpb25PclBvaW50ZXJUeXBlcyA9IFtcbiAgJ051bWJlcicsXG4gICdTdHJpbmcnLFxuICAnQm9vbGVhbicsXG4gICdEYXRlJyxcbiAgJ09iamVjdCcsXG4gICdBcnJheScsXG4gICdHZW9Qb2ludCcsXG4gICdGaWxlJyxcbiAgJ0J5dGVzJyxcbiAgJ1BvbHlnb24nLFxuXTtcbi8vIFJldHVybnMgYW4gZXJyb3Igc3VpdGFibGUgZm9yIHRocm93aW5nIGlmIHRoZSB0eXBlIGlzIGludmFsaWRcbmNvbnN0IGZpZWxkVHlwZUlzSW52YWxpZCA9ICh7IHR5cGUsIHRhcmdldENsYXNzIH0pID0+IHtcbiAgaWYgKFsnUG9pbnRlcicsICdSZWxhdGlvbiddLmluZGV4T2YodHlwZSkgPj0gMCkge1xuICAgIGlmICghdGFyZ2V0Q2xhc3MpIHtcbiAgICAgIHJldHVybiBuZXcgUGFyc2UuRXJyb3IoMTM1LCBgdHlwZSAke3R5cGV9IG5lZWRzIGEgY2xhc3MgbmFtZWApO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIHRhcmdldENsYXNzICE9PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuIGludmFsaWRKc29uRXJyb3I7XG4gICAgfSBlbHNlIGlmICghY2xhc3NOYW1lSXNWYWxpZCh0YXJnZXRDbGFzcykpIHtcbiAgICAgIHJldHVybiBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfQ0xBU1NfTkFNRSxcbiAgICAgICAgaW52YWxpZENsYXNzTmFtZU1lc3NhZ2UodGFyZ2V0Q2xhc3MpXG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgfVxuICBpZiAodHlwZW9mIHR5cGUgIT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIGludmFsaWRKc29uRXJyb3I7XG4gIH1cbiAgaWYgKHZhbGlkTm9uUmVsYXRpb25PclBvaW50ZXJUeXBlcy5pbmRleE9mKHR5cGUpIDwgMCkge1xuICAgIHJldHVybiBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICBQYXJzZS5FcnJvci5JTkNPUlJFQ1RfVFlQRSxcbiAgICAgIGBpbnZhbGlkIGZpZWxkIHR5cGU6ICR7dHlwZX1gXG4gICAgKTtcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufTtcblxuY29uc3QgY29udmVydFNjaGVtYVRvQWRhcHRlclNjaGVtYSA9IChzY2hlbWE6IGFueSkgPT4ge1xuICBzY2hlbWEgPSBpbmplY3REZWZhdWx0U2NoZW1hKHNjaGVtYSk7XG4gIGRlbGV0ZSBzY2hlbWEuZmllbGRzLkFDTDtcbiAgc2NoZW1hLmZpZWxkcy5fcnBlcm0gPSB7IHR5cGU6ICdBcnJheScgfTtcbiAgc2NoZW1hLmZpZWxkcy5fd3Blcm0gPSB7IHR5cGU6ICdBcnJheScgfTtcblxuICBpZiAoc2NoZW1hLmNsYXNzTmFtZSA9PT0gJ19Vc2VyJykge1xuICAgIGRlbGV0ZSBzY2hlbWEuZmllbGRzLnBhc3N3b3JkO1xuICAgIHNjaGVtYS5maWVsZHMuX2hhc2hlZF9wYXNzd29yZCA9IHsgdHlwZTogJ1N0cmluZycgfTtcbiAgfVxuXG4gIHJldHVybiBzY2hlbWE7XG59O1xuXG5jb25zdCBjb252ZXJ0QWRhcHRlclNjaGVtYVRvUGFyc2VTY2hlbWEgPSAoeyAuLi5zY2hlbWEgfSkgPT4ge1xuICBkZWxldGUgc2NoZW1hLmZpZWxkcy5fcnBlcm07XG4gIGRlbGV0ZSBzY2hlbWEuZmllbGRzLl93cGVybTtcblxuICBzY2hlbWEuZmllbGRzLkFDTCA9IHsgdHlwZTogJ0FDTCcgfTtcblxuICBpZiAoc2NoZW1hLmNsYXNzTmFtZSA9PT0gJ19Vc2VyJykge1xuICAgIGRlbGV0ZSBzY2hlbWEuZmllbGRzLmF1dGhEYXRhOyAvL0F1dGggZGF0YSBpcyBpbXBsaWNpdFxuICAgIGRlbGV0ZSBzY2hlbWEuZmllbGRzLl9oYXNoZWRfcGFzc3dvcmQ7XG4gICAgc2NoZW1hLmZpZWxkcy5wYXNzd29yZCA9IHsgdHlwZTogJ1N0cmluZycgfTtcbiAgfVxuXG4gIGlmIChzY2hlbWEuaW5kZXhlcyAmJiBPYmplY3Qua2V5cyhzY2hlbWEuaW5kZXhlcykubGVuZ3RoID09PSAwKSB7XG4gICAgZGVsZXRlIHNjaGVtYS5pbmRleGVzO1xuICB9XG5cbiAgcmV0dXJuIHNjaGVtYTtcbn07XG5cbmNsYXNzIFNjaGVtYURhdGEge1xuICBfX2RhdGE6IGFueTtcbiAgY29uc3RydWN0b3IoYWxsU2NoZW1hcyA9IFtdKSB7XG4gICAgdGhpcy5fX2RhdGEgPSB7fTtcbiAgICBhbGxTY2hlbWFzLmZvckVhY2goc2NoZW1hID0+IHtcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0aGlzLCBzY2hlbWEuY2xhc3NOYW1lLCB7XG4gICAgICAgIGdldDogKCkgPT4ge1xuICAgICAgICAgIGlmICghdGhpcy5fX2RhdGFbc2NoZW1hLmNsYXNzTmFtZV0pIHtcbiAgICAgICAgICAgIGNvbnN0IGRhdGEgPSB7fTtcbiAgICAgICAgICAgIGRhdGEuZmllbGRzID0gaW5qZWN0RGVmYXVsdFNjaGVtYShzY2hlbWEpLmZpZWxkcztcbiAgICAgICAgICAgIGRhdGEuY2xhc3NMZXZlbFBlcm1pc3Npb25zID0gc2NoZW1hLmNsYXNzTGV2ZWxQZXJtaXNzaW9ucztcbiAgICAgICAgICAgIGRhdGEuaW5kZXhlcyA9IHNjaGVtYS5pbmRleGVzO1xuICAgICAgICAgICAgdGhpcy5fX2RhdGFbc2NoZW1hLmNsYXNzTmFtZV0gPSBkYXRhO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gdGhpcy5fX2RhdGFbc2NoZW1hLmNsYXNzTmFtZV07XG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIEluamVjdCB0aGUgaW4tbWVtb3J5IGNsYXNzZXNcbiAgICB2b2xhdGlsZUNsYXNzZXMuZm9yRWFjaChjbGFzc05hbWUgPT4ge1xuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRoaXMsIGNsYXNzTmFtZSwge1xuICAgICAgICBnZXQ6ICgpID0+IHtcbiAgICAgICAgICBpZiAoIXRoaXMuX19kYXRhW2NsYXNzTmFtZV0pIHtcbiAgICAgICAgICAgIGNvbnN0IHNjaGVtYSA9IGluamVjdERlZmF1bHRTY2hlbWEoe1xuICAgICAgICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgICAgICAgIGZpZWxkczoge30sXG4gICAgICAgICAgICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczoge30sXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGNvbnN0IGRhdGEgPSB7fTtcbiAgICAgICAgICAgIGRhdGEuZmllbGRzID0gc2NoZW1hLmZpZWxkcztcbiAgICAgICAgICAgIGRhdGEuY2xhc3NMZXZlbFBlcm1pc3Npb25zID0gc2NoZW1hLmNsYXNzTGV2ZWxQZXJtaXNzaW9ucztcbiAgICAgICAgICAgIGRhdGEuaW5kZXhlcyA9IHNjaGVtYS5pbmRleGVzO1xuICAgICAgICAgICAgdGhpcy5fX2RhdGFbY2xhc3NOYW1lXSA9IGRhdGE7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiB0aGlzLl9fZGF0YVtjbGFzc05hbWVdO1xuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbn1cblxuY29uc3QgaW5qZWN0RGVmYXVsdFNjaGVtYSA9ICh7XG4gIGNsYXNzTmFtZSxcbiAgZmllbGRzLFxuICBjbGFzc0xldmVsUGVybWlzc2lvbnMsXG4gIGluZGV4ZXMsXG59OiBTY2hlbWEpID0+IHtcbiAgY29uc3QgZGVmYXVsdFNjaGVtYTogU2NoZW1hID0ge1xuICAgIGNsYXNzTmFtZSxcbiAgICBmaWVsZHM6IHtcbiAgICAgIC4uLmRlZmF1bHRDb2x1bW5zLl9EZWZhdWx0LFxuICAgICAgLi4uKGRlZmF1bHRDb2x1bW5zW2NsYXNzTmFtZV0gfHwge30pLFxuICAgICAgLi4uZmllbGRzLFxuICAgIH0sXG4gICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zLFxuICB9O1xuICBpZiAoaW5kZXhlcyAmJiBPYmplY3Qua2V5cyhpbmRleGVzKS5sZW5ndGggIT09IDApIHtcbiAgICBkZWZhdWx0U2NoZW1hLmluZGV4ZXMgPSBpbmRleGVzO1xuICB9XG4gIHJldHVybiBkZWZhdWx0U2NoZW1hO1xufTtcblxuY29uc3QgX0hvb2tzU2NoZW1hID0geyBjbGFzc05hbWU6ICdfSG9va3MnLCBmaWVsZHM6IGRlZmF1bHRDb2x1bW5zLl9Ib29rcyB9O1xuY29uc3QgX0dsb2JhbENvbmZpZ1NjaGVtYSA9IHtcbiAgY2xhc3NOYW1lOiAnX0dsb2JhbENvbmZpZycsXG4gIGZpZWxkczogZGVmYXVsdENvbHVtbnMuX0dsb2JhbENvbmZpZyxcbn07XG5jb25zdCBfUHVzaFN0YXR1c1NjaGVtYSA9IGNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEoXG4gIGluamVjdERlZmF1bHRTY2hlbWEoe1xuICAgIGNsYXNzTmFtZTogJ19QdXNoU3RhdHVzJyxcbiAgICBmaWVsZHM6IHt9LFxuICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczoge30sXG4gIH0pXG4pO1xuY29uc3QgX0pvYlN0YXR1c1NjaGVtYSA9IGNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEoXG4gIGluamVjdERlZmF1bHRTY2hlbWEoe1xuICAgIGNsYXNzTmFtZTogJ19Kb2JTdGF0dXMnLFxuICAgIGZpZWxkczoge30sXG4gICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiB7fSxcbiAgfSlcbik7XG5jb25zdCBfSm9iU2NoZWR1bGVTY2hlbWEgPSBjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hKFxuICBpbmplY3REZWZhdWx0U2NoZW1hKHtcbiAgICBjbGFzc05hbWU6ICdfSm9iU2NoZWR1bGUnLFxuICAgIGZpZWxkczoge30sXG4gICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiB7fSxcbiAgfSlcbik7XG5jb25zdCBfQXVkaWVuY2VTY2hlbWEgPSBjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hKFxuICBpbmplY3REZWZhdWx0U2NoZW1hKHtcbiAgICBjbGFzc05hbWU6ICdfQXVkaWVuY2UnLFxuICAgIGZpZWxkczogZGVmYXVsdENvbHVtbnMuX0F1ZGllbmNlLFxuICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczoge30sXG4gIH0pXG4pO1xuY29uc3QgVm9sYXRpbGVDbGFzc2VzU2NoZW1hcyA9IFtcbiAgX0hvb2tzU2NoZW1hLFxuICBfSm9iU3RhdHVzU2NoZW1hLFxuICBfSm9iU2NoZWR1bGVTY2hlbWEsXG4gIF9QdXNoU3RhdHVzU2NoZW1hLFxuICBfR2xvYmFsQ29uZmlnU2NoZW1hLFxuICBfQXVkaWVuY2VTY2hlbWEsXG5dO1xuXG5jb25zdCBkYlR5cGVNYXRjaGVzT2JqZWN0VHlwZSA9IChcbiAgZGJUeXBlOiBTY2hlbWFGaWVsZCB8IHN0cmluZyxcbiAgb2JqZWN0VHlwZTogU2NoZW1hRmllbGRcbikgPT4ge1xuICBpZiAoZGJUeXBlLnR5cGUgIT09IG9iamVjdFR5cGUudHlwZSkgcmV0dXJuIGZhbHNlO1xuICBpZiAoZGJUeXBlLnRhcmdldENsYXNzICE9PSBvYmplY3RUeXBlLnRhcmdldENsYXNzKSByZXR1cm4gZmFsc2U7XG4gIGlmIChkYlR5cGUgPT09IG9iamVjdFR5cGUudHlwZSkgcmV0dXJuIHRydWU7XG4gIGlmIChkYlR5cGUudHlwZSA9PT0gb2JqZWN0VHlwZS50eXBlKSByZXR1cm4gdHJ1ZTtcbiAgcmV0dXJuIGZhbHNlO1xufTtcblxuY29uc3QgdHlwZVRvU3RyaW5nID0gKHR5cGU6IFNjaGVtYUZpZWxkIHwgc3RyaW5nKTogc3RyaW5nID0+IHtcbiAgaWYgKHR5cGVvZiB0eXBlID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiB0eXBlO1xuICB9XG4gIGlmICh0eXBlLnRhcmdldENsYXNzKSB7XG4gICAgcmV0dXJuIGAke3R5cGUudHlwZX08JHt0eXBlLnRhcmdldENsYXNzfT5gO1xuICB9XG4gIHJldHVybiBgJHt0eXBlLnR5cGV9YDtcbn07XG5cbi8vIFN0b3JlcyB0aGUgZW50aXJlIHNjaGVtYSBvZiB0aGUgYXBwIGluIGEgd2VpcmQgaHlicmlkIGZvcm1hdCBzb21ld2hlcmUgYmV0d2VlblxuLy8gdGhlIG1vbmdvIGZvcm1hdCBhbmQgdGhlIFBhcnNlIGZvcm1hdC4gU29vbiwgdGhpcyB3aWxsIGFsbCBiZSBQYXJzZSBmb3JtYXQuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTY2hlbWFDb250cm9sbGVyIHtcbiAgX2RiQWRhcHRlcjogU3RvcmFnZUFkYXB0ZXI7XG4gIHNjaGVtYURhdGE6IHsgW3N0cmluZ106IFNjaGVtYSB9O1xuICBfY2FjaGU6IGFueTtcbiAgcmVsb2FkRGF0YVByb21pc2U6IFByb21pc2U8YW55PjtcblxuICBjb25zdHJ1Y3RvcihkYXRhYmFzZUFkYXB0ZXI6IFN0b3JhZ2VBZGFwdGVyLCBzY2hlbWFDYWNoZTogYW55KSB7XG4gICAgdGhpcy5fZGJBZGFwdGVyID0gZGF0YWJhc2VBZGFwdGVyO1xuICAgIHRoaXMuX2NhY2hlID0gc2NoZW1hQ2FjaGU7XG4gICAgdGhpcy5zY2hlbWFEYXRhID0gbmV3IFNjaGVtYURhdGEoKTtcbiAgfVxuXG4gIHJlbG9hZERhdGEob3B0aW9uczogTG9hZFNjaGVtYU9wdGlvbnMgPSB7IGNsZWFyQ2FjaGU6IGZhbHNlIH0pOiBQcm9taXNlPGFueT4ge1xuICAgIGxldCBwcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgaWYgKG9wdGlvbnMuY2xlYXJDYWNoZSkge1xuICAgICAgcHJvbWlzZSA9IHByb21pc2UudGhlbigoKSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLl9jYWNoZS5jbGVhcigpO1xuICAgICAgfSk7XG4gICAgfVxuICAgIGlmICh0aGlzLnJlbG9hZERhdGFQcm9taXNlICYmICFvcHRpb25zLmNsZWFyQ2FjaGUpIHtcbiAgICAgIHJldHVybiB0aGlzLnJlbG9hZERhdGFQcm9taXNlO1xuICAgIH1cbiAgICB0aGlzLnJlbG9hZERhdGFQcm9taXNlID0gcHJvbWlzZVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRBbGxDbGFzc2VzKG9wdGlvbnMpLnRoZW4oXG4gICAgICAgICAgYWxsU2NoZW1hcyA9PiB7XG4gICAgICAgICAgICB0aGlzLnNjaGVtYURhdGEgPSBuZXcgU2NoZW1hRGF0YShhbGxTY2hlbWFzKTtcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnJlbG9hZERhdGFQcm9taXNlO1xuICAgICAgICAgIH0sXG4gICAgICAgICAgZXJyID0+IHtcbiAgICAgICAgICAgIHRoaXMuc2NoZW1hRGF0YSA9IG5ldyBTY2hlbWFEYXRhKCk7XG4gICAgICAgICAgICBkZWxldGUgdGhpcy5yZWxvYWREYXRhUHJvbWlzZTtcbiAgICAgICAgICAgIHRocm93IGVycjtcbiAgICAgICAgICB9XG4gICAgICAgICk7XG4gICAgICB9KVxuICAgICAgLnRoZW4oKCkgPT4ge30pO1xuICAgIHJldHVybiB0aGlzLnJlbG9hZERhdGFQcm9taXNlO1xuICB9XG5cbiAgZ2V0QWxsQ2xhc3NlcyhcbiAgICBvcHRpb25zOiBMb2FkU2NoZW1hT3B0aW9ucyA9IHsgY2xlYXJDYWNoZTogZmFsc2UgfVxuICApOiBQcm9taXNlPEFycmF5PFNjaGVtYT4+IHtcbiAgICBsZXQgcHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xuICAgIGlmIChvcHRpb25zLmNsZWFyQ2FjaGUpIHtcbiAgICAgIHByb21pc2UgPSB0aGlzLl9jYWNoZS5jbGVhcigpO1xuICAgIH1cbiAgICByZXR1cm4gcHJvbWlzZVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5fY2FjaGUuZ2V0QWxsQ2xhc3NlcygpO1xuICAgICAgfSlcbiAgICAgIC50aGVuKGFsbENsYXNzZXMgPT4ge1xuICAgICAgICBpZiAoYWxsQ2xhc3NlcyAmJiBhbGxDbGFzc2VzLmxlbmd0aCAmJiAhb3B0aW9ucy5jbGVhckNhY2hlKSB7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShhbGxDbGFzc2VzKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5fZGJBZGFwdGVyXG4gICAgICAgICAgLmdldEFsbENsYXNzZXMoKVxuICAgICAgICAgIC50aGVuKGFsbFNjaGVtYXMgPT4gYWxsU2NoZW1hcy5tYXAoaW5qZWN0RGVmYXVsdFNjaGVtYSkpXG4gICAgICAgICAgLnRoZW4oYWxsU2NoZW1hcyA9PiB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fY2FjaGUuc2V0QWxsQ2xhc3NlcyhhbGxTY2hlbWFzKS50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgcmV0dXJuIGFsbFNjaGVtYXM7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcbiAgICAgIH0pO1xuICB9XG5cbiAgZ2V0T25lU2NoZW1hKFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIGFsbG93Vm9sYXRpbGVDbGFzc2VzOiBib29sZWFuID0gZmFsc2UsXG4gICAgb3B0aW9uczogTG9hZFNjaGVtYU9wdGlvbnMgPSB7IGNsZWFyQ2FjaGU6IGZhbHNlIH1cbiAgKTogUHJvbWlzZTxTY2hlbWE+IHtcbiAgICBsZXQgcHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xuICAgIGlmIChvcHRpb25zLmNsZWFyQ2FjaGUpIHtcbiAgICAgIHByb21pc2UgPSB0aGlzLl9jYWNoZS5jbGVhcigpO1xuICAgIH1cbiAgICByZXR1cm4gcHJvbWlzZS50aGVuKCgpID0+IHtcbiAgICAgIGlmIChhbGxvd1ZvbGF0aWxlQ2xhc3NlcyAmJiB2b2xhdGlsZUNsYXNzZXMuaW5kZXhPZihjbGFzc05hbWUpID4gLTEpIHtcbiAgICAgICAgY29uc3QgZGF0YSA9IHRoaXMuc2NoZW1hRGF0YVtjbGFzc05hbWVdO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHtcbiAgICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgICAgZmllbGRzOiBkYXRhLmZpZWxkcyxcbiAgICAgICAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IGRhdGEuY2xhc3NMZXZlbFBlcm1pc3Npb25zLFxuICAgICAgICAgIGluZGV4ZXM6IGRhdGEuaW5kZXhlcyxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gdGhpcy5fY2FjaGUuZ2V0T25lU2NoZW1hKGNsYXNzTmFtZSkudGhlbihjYWNoZWQgPT4ge1xuICAgICAgICBpZiAoY2FjaGVkICYmICFvcHRpb25zLmNsZWFyQ2FjaGUpIHtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGNhY2hlZCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX2RiQWRhcHRlclxuICAgICAgICAgIC5nZXRDbGFzcyhjbGFzc05hbWUpXG4gICAgICAgICAgLnRoZW4oaW5qZWN0RGVmYXVsdFNjaGVtYSlcbiAgICAgICAgICAudGhlbihyZXN1bHQgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2NhY2hlLnNldE9uZVNjaGVtYShjbGFzc05hbWUsIHJlc3VsdCkudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gQ3JlYXRlIGEgbmV3IGNsYXNzIHRoYXQgaW5jbHVkZXMgdGhlIHRocmVlIGRlZmF1bHQgZmllbGRzLlxuICAvLyBBQ0wgaXMgYW4gaW1wbGljaXQgY29sdW1uIHRoYXQgZG9lcyBub3QgZ2V0IGFuIGVudHJ5IGluIHRoZVxuICAvLyBfU0NIRU1BUyBkYXRhYmFzZS4gUmV0dXJucyBhIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aXRoIHRoZVxuICAvLyBjcmVhdGVkIHNjaGVtYSwgaW4gbW9uZ28gZm9ybWF0LlxuICAvLyBvbiBzdWNjZXNzLCBhbmQgcmVqZWN0cyB3aXRoIGFuIGVycm9yIG9uIGZhaWwuIEVuc3VyZSB5b3VcbiAgLy8gaGF2ZSBhdXRob3JpemF0aW9uIChtYXN0ZXIga2V5LCBvciBjbGllbnQgY2xhc3MgY3JlYXRpb25cbiAgLy8gZW5hYmxlZCkgYmVmb3JlIGNhbGxpbmcgdGhpcyBmdW5jdGlvbi5cbiAgYWRkQ2xhc3NJZk5vdEV4aXN0cyhcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBmaWVsZHM6IFNjaGVtYUZpZWxkcyA9IHt9LFxuICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczogYW55LFxuICAgIGluZGV4ZXM6IGFueSA9IHt9XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIHZhciB2YWxpZGF0aW9uRXJyb3IgPSB0aGlzLnZhbGlkYXRlTmV3Q2xhc3MoXG4gICAgICBjbGFzc05hbWUsXG4gICAgICBmaWVsZHMsXG4gICAgICBjbGFzc0xldmVsUGVybWlzc2lvbnNcbiAgICApO1xuICAgIGlmICh2YWxpZGF0aW9uRXJyb3IpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdCh2YWxpZGF0aW9uRXJyb3IpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9kYkFkYXB0ZXJcbiAgICAgIC5jcmVhdGVDbGFzcyhcbiAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICBjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hKHtcbiAgICAgICAgICBmaWVsZHMsXG4gICAgICAgICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zLFxuICAgICAgICAgIGluZGV4ZXMsXG4gICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICB9KVxuICAgICAgKVxuICAgICAgLnRoZW4oY29udmVydEFkYXB0ZXJTY2hlbWFUb1BhcnNlU2NoZW1hKVxuICAgICAgLnRoZW4ocmVzID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2NhY2hlLmNsZWFyKCkudGhlbigoKSA9PiB7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShyZXMpO1xuICAgICAgICB9KTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IgJiYgZXJyb3IuY29kZSA9PT0gUGFyc2UuRXJyb3IuRFVQTElDQVRFX1ZBTFVFKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9DTEFTU19OQU1FLFxuICAgICAgICAgICAgYENsYXNzICR7Y2xhc3NOYW1lfSBhbHJlYWR5IGV4aXN0cy5gXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gIH1cblxuICB1cGRhdGVDbGFzcyhcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBzdWJtaXR0ZWRGaWVsZHM6IFNjaGVtYUZpZWxkcyxcbiAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IGFueSxcbiAgICBpbmRleGVzOiBhbnksXG4gICAgZGF0YWJhc2U6IERhdGFiYXNlQ29udHJvbGxlclxuICApIHtcbiAgICByZXR1cm4gdGhpcy5nZXRPbmVTY2hlbWEoY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oc2NoZW1hID0+IHtcbiAgICAgICAgY29uc3QgZXhpc3RpbmdGaWVsZHMgPSBzY2hlbWEuZmllbGRzO1xuICAgICAgICBPYmplY3Qua2V5cyhzdWJtaXR0ZWRGaWVsZHMpLmZvckVhY2gobmFtZSA9PiB7XG4gICAgICAgICAgY29uc3QgZmllbGQgPSBzdWJtaXR0ZWRGaWVsZHNbbmFtZV07XG4gICAgICAgICAgaWYgKGV4aXN0aW5nRmllbGRzW25hbWVdICYmIGZpZWxkLl9fb3AgIT09ICdEZWxldGUnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoMjU1LCBgRmllbGQgJHtuYW1lfSBleGlzdHMsIGNhbm5vdCB1cGRhdGUuYCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICghZXhpc3RpbmdGaWVsZHNbbmFtZV0gJiYgZmllbGQuX19vcCA9PT0gJ0RlbGV0ZScpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgMjU1LFxuICAgICAgICAgICAgICBgRmllbGQgJHtuYW1lfSBkb2VzIG5vdCBleGlzdCwgY2Fubm90IGRlbGV0ZS5gXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgZGVsZXRlIGV4aXN0aW5nRmllbGRzLl9ycGVybTtcbiAgICAgICAgZGVsZXRlIGV4aXN0aW5nRmllbGRzLl93cGVybTtcbiAgICAgICAgY29uc3QgbmV3U2NoZW1hID0gYnVpbGRNZXJnZWRTY2hlbWFPYmplY3QoXG4gICAgICAgICAgZXhpc3RpbmdGaWVsZHMsXG4gICAgICAgICAgc3VibWl0dGVkRmllbGRzXG4gICAgICAgICk7XG4gICAgICAgIGNvbnN0IGRlZmF1bHRGaWVsZHMgPVxuICAgICAgICAgIGRlZmF1bHRDb2x1bW5zW2NsYXNzTmFtZV0gfHwgZGVmYXVsdENvbHVtbnMuX0RlZmF1bHQ7XG4gICAgICAgIGNvbnN0IGZ1bGxOZXdTY2hlbWEgPSBPYmplY3QuYXNzaWduKHt9LCBuZXdTY2hlbWEsIGRlZmF1bHRGaWVsZHMpO1xuICAgICAgICBjb25zdCB2YWxpZGF0aW9uRXJyb3IgPSB0aGlzLnZhbGlkYXRlU2NoZW1hRGF0YShcbiAgICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgICAgbmV3U2NoZW1hLFxuICAgICAgICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgICAgICAgICBPYmplY3Qua2V5cyhleGlzdGluZ0ZpZWxkcylcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKHZhbGlkYXRpb25FcnJvcikge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcih2YWxpZGF0aW9uRXJyb3IuY29kZSwgdmFsaWRhdGlvbkVycm9yLmVycm9yKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEZpbmFsbHkgd2UgaGF2ZSBjaGVja2VkIHRvIG1ha2Ugc3VyZSB0aGUgcmVxdWVzdCBpcyB2YWxpZCBhbmQgd2UgY2FuIHN0YXJ0IGRlbGV0aW5nIGZpZWxkcy5cbiAgICAgICAgLy8gRG8gYWxsIGRlbGV0aW9ucyBmaXJzdCwgdGhlbiBhIHNpbmdsZSBzYXZlIHRvIF9TQ0hFTUEgY29sbGVjdGlvbiB0byBoYW5kbGUgYWxsIGFkZGl0aW9ucy5cbiAgICAgICAgY29uc3QgZGVsZXRlZEZpZWxkczogc3RyaW5nW10gPSBbXTtcbiAgICAgICAgY29uc3QgaW5zZXJ0ZWRGaWVsZHMgPSBbXTtcbiAgICAgICAgT2JqZWN0LmtleXMoc3VibWl0dGVkRmllbGRzKS5mb3JFYWNoKGZpZWxkTmFtZSA9PiB7XG4gICAgICAgICAgaWYgKHN1Ym1pdHRlZEZpZWxkc1tmaWVsZE5hbWVdLl9fb3AgPT09ICdEZWxldGUnKSB7XG4gICAgICAgICAgICBkZWxldGVkRmllbGRzLnB1c2goZmllbGROYW1lKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaW5zZXJ0ZWRGaWVsZHMucHVzaChmaWVsZE5hbWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgbGV0IGRlbGV0ZVByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgaWYgKGRlbGV0ZWRGaWVsZHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGRlbGV0ZVByb21pc2UgPSB0aGlzLmRlbGV0ZUZpZWxkcyhkZWxldGVkRmllbGRzLCBjbGFzc05hbWUsIGRhdGFiYXNlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gKFxuICAgICAgICAgIGRlbGV0ZVByb21pc2UgLy8gRGVsZXRlIEV2ZXJ5dGhpbmdcbiAgICAgICAgICAgIC50aGVuKCgpID0+IHRoaXMucmVsb2FkRGF0YSh7IGNsZWFyQ2FjaGU6IHRydWUgfSkpIC8vIFJlbG9hZCBvdXIgU2NoZW1hLCBzbyB3ZSBoYXZlIGFsbCB0aGUgbmV3IHZhbHVlc1xuICAgICAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgICBjb25zdCBwcm9taXNlcyA9IGluc2VydGVkRmllbGRzLm1hcChmaWVsZE5hbWUgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHR5cGUgPSBzdWJtaXR0ZWRGaWVsZHNbZmllbGROYW1lXTtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5lbmZvcmNlRmllbGRFeGlzdHMoY2xhc3NOYW1lLCBmaWVsZE5hbWUsIHR5cGUpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKHByb21pc2VzKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAudGhlbigoKSA9PlxuICAgICAgICAgICAgICB0aGlzLnNldFBlcm1pc3Npb25zKGNsYXNzTmFtZSwgY2xhc3NMZXZlbFBlcm1pc3Npb25zLCBuZXdTY2hlbWEpXG4gICAgICAgICAgICApXG4gICAgICAgICAgICAudGhlbigoKSA9PlxuICAgICAgICAgICAgICB0aGlzLl9kYkFkYXB0ZXIuc2V0SW5kZXhlc1dpdGhTY2hlbWFGb3JtYXQoXG4gICAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICAgIGluZGV4ZXMsXG4gICAgICAgICAgICAgICAgc2NoZW1hLmluZGV4ZXMsXG4gICAgICAgICAgICAgICAgZnVsbE5ld1NjaGVtYVxuICAgICAgICAgICAgICApXG4gICAgICAgICAgICApXG4gICAgICAgICAgICAudGhlbigoKSA9PiB0aGlzLnJlbG9hZERhdGEoeyBjbGVhckNhY2hlOiB0cnVlIH0pKVxuICAgICAgICAgICAgLy9UT0RPOiBNb3ZlIHRoaXMgbG9naWMgaW50byB0aGUgZGF0YWJhc2UgYWRhcHRlclxuICAgICAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLnNjaGVtYURhdGFbY2xhc3NOYW1lXTtcbiAgICAgICAgICAgICAgY29uc3QgcmVsb2FkZWRTY2hlbWE6IFNjaGVtYSA9IHtcbiAgICAgICAgICAgICAgICBjbGFzc05hbWU6IGNsYXNzTmFtZSxcbiAgICAgICAgICAgICAgICBmaWVsZHM6IHNjaGVtYS5maWVsZHMsXG4gICAgICAgICAgICAgICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiBzY2hlbWEuY2xhc3NMZXZlbFBlcm1pc3Npb25zLFxuICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICBpZiAoc2NoZW1hLmluZGV4ZXMgJiYgT2JqZWN0LmtleXMoc2NoZW1hLmluZGV4ZXMpLmxlbmd0aCAhPT0gMCkge1xuICAgICAgICAgICAgICAgIHJlbG9hZGVkU2NoZW1hLmluZGV4ZXMgPSBzY2hlbWEuaW5kZXhlcztcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICByZXR1cm4gcmVsb2FkZWRTY2hlbWE7XG4gICAgICAgICAgICB9KVxuICAgICAgICApO1xuICAgICAgfSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChlcnJvciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9DTEFTU19OQU1FLFxuICAgICAgICAgICAgYENsYXNzICR7Y2xhc3NOYW1lfSBkb2VzIG5vdCBleGlzdC5gXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gIH1cblxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHN1Y2Nlc3NmdWxseSB0byB0aGUgbmV3IHNjaGVtYVxuICAvLyBvYmplY3Qgb3IgZmFpbHMgd2l0aCBhIHJlYXNvbi5cbiAgZW5mb3JjZUNsYXNzRXhpc3RzKGNsYXNzTmFtZTogc3RyaW5nKTogUHJvbWlzZTxTY2hlbWFDb250cm9sbGVyPiB7XG4gICAgaWYgKHRoaXMuc2NoZW1hRGF0YVtjbGFzc05hbWVdKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMpO1xuICAgIH1cbiAgICAvLyBXZSBkb24ndCBoYXZlIHRoaXMgY2xhc3MuIFVwZGF0ZSB0aGUgc2NoZW1hXG4gICAgcmV0dXJuIChcbiAgICAgIHRoaXMuYWRkQ2xhc3NJZk5vdEV4aXN0cyhjbGFzc05hbWUpXG4gICAgICAgIC8vIFRoZSBzY2hlbWEgdXBkYXRlIHN1Y2NlZWRlZC4gUmVsb2FkIHRoZSBzY2hlbWFcbiAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5yZWxvYWREYXRhKHsgY2xlYXJDYWNoZTogdHJ1ZSB9KSlcbiAgICAgICAgLmNhdGNoKCgpID0+IHtcbiAgICAgICAgICAvLyBUaGUgc2NoZW1hIHVwZGF0ZSBmYWlsZWQuIFRoaXMgY2FuIGJlIG9rYXkgLSBpdCBtaWdodFxuICAgICAgICAgIC8vIGhhdmUgZmFpbGVkIGJlY2F1c2UgdGhlcmUncyBhIHJhY2UgY29uZGl0aW9uIGFuZCBhIGRpZmZlcmVudFxuICAgICAgICAgIC8vIGNsaWVudCBpcyBtYWtpbmcgdGhlIGV4YWN0IHNhbWUgc2NoZW1hIHVwZGF0ZSB0aGF0IHdlIHdhbnQuXG4gICAgICAgICAgLy8gU28ganVzdCByZWxvYWQgdGhlIHNjaGVtYS5cbiAgICAgICAgICByZXR1cm4gdGhpcy5yZWxvYWREYXRhKHsgY2xlYXJDYWNoZTogdHJ1ZSB9KTtcbiAgICAgICAgfSlcbiAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgIC8vIEVuc3VyZSB0aGF0IHRoZSBzY2hlbWEgbm93IHZhbGlkYXRlc1xuICAgICAgICAgIGlmICh0aGlzLnNjaGVtYURhdGFbY2xhc3NOYW1lXSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgICBgRmFpbGVkIHRvIGFkZCAke2NsYXNzTmFtZX1gXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICAgICAgLmNhdGNoKCgpID0+IHtcbiAgICAgICAgICAvLyBUaGUgc2NoZW1hIHN0aWxsIGRvZXNuJ3QgdmFsaWRhdGUuIEdpdmUgdXBcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgICAnc2NoZW1hIGNsYXNzIG5hbWUgZG9lcyBub3QgcmV2YWxpZGF0ZSdcbiAgICAgICAgICApO1xuICAgICAgICB9KVxuICAgICk7XG4gIH1cblxuICB2YWxpZGF0ZU5ld0NsYXNzKFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIGZpZWxkczogU2NoZW1hRmllbGRzID0ge30sXG4gICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiBhbnlcbiAgKTogYW55IHtcbiAgICBpZiAodGhpcy5zY2hlbWFEYXRhW2NsYXNzTmFtZV0pIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9DTEFTU19OQU1FLFxuICAgICAgICBgQ2xhc3MgJHtjbGFzc05hbWV9IGFscmVhZHkgZXhpc3RzLmBcbiAgICAgICk7XG4gICAgfVxuICAgIGlmICghY2xhc3NOYW1lSXNWYWxpZChjbGFzc05hbWUpKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBjb2RlOiBQYXJzZS5FcnJvci5JTlZBTElEX0NMQVNTX05BTUUsXG4gICAgICAgIGVycm9yOiBpbnZhbGlkQ2xhc3NOYW1lTWVzc2FnZShjbGFzc05hbWUpLFxuICAgICAgfTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMudmFsaWRhdGVTY2hlbWFEYXRhKFxuICAgICAgY2xhc3NOYW1lLFxuICAgICAgZmllbGRzLFxuICAgICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zLFxuICAgICAgW11cbiAgICApO1xuICB9XG5cbiAgdmFsaWRhdGVTY2hlbWFEYXRhKFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIGZpZWxkczogU2NoZW1hRmllbGRzLFxuICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczogQ2xhc3NMZXZlbFBlcm1pc3Npb25zLFxuICAgIGV4aXN0aW5nRmllbGROYW1lczogQXJyYXk8c3RyaW5nPlxuICApIHtcbiAgICBmb3IgKGNvbnN0IGZpZWxkTmFtZSBpbiBmaWVsZHMpIHtcbiAgICAgIGlmIChleGlzdGluZ0ZpZWxkTmFtZXMuaW5kZXhPZihmaWVsZE5hbWUpIDwgMCkge1xuICAgICAgICBpZiAoIWZpZWxkTmFtZUlzVmFsaWQoZmllbGROYW1lKSkge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBjb2RlOiBQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLFxuICAgICAgICAgICAgZXJyb3I6ICdpbnZhbGlkIGZpZWxkIG5hbWU6ICcgKyBmaWVsZE5hbWUsXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWZpZWxkTmFtZUlzVmFsaWRGb3JDbGFzcyhmaWVsZE5hbWUsIGNsYXNzTmFtZSkpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgY29kZTogMTM2LFxuICAgICAgICAgICAgZXJyb3I6ICdmaWVsZCAnICsgZmllbGROYW1lICsgJyBjYW5ub3QgYmUgYWRkZWQnLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgZXJyb3IgPSBmaWVsZFR5cGVJc0ludmFsaWQoZmllbGRzW2ZpZWxkTmFtZV0pO1xuICAgICAgICBpZiAoZXJyb3IpIHJldHVybiB7IGNvZGU6IGVycm9yLmNvZGUsIGVycm9yOiBlcnJvci5tZXNzYWdlIH07XG4gICAgICB9XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBmaWVsZE5hbWUgaW4gZGVmYXVsdENvbHVtbnNbY2xhc3NOYW1lXSkge1xuICAgICAgZmllbGRzW2ZpZWxkTmFtZV0gPSBkZWZhdWx0Q29sdW1uc1tjbGFzc05hbWVdW2ZpZWxkTmFtZV07XG4gICAgfVxuXG4gICAgY29uc3QgZ2VvUG9pbnRzID0gT2JqZWN0LmtleXMoZmllbGRzKS5maWx0ZXIoXG4gICAgICBrZXkgPT4gZmllbGRzW2tleV0gJiYgZmllbGRzW2tleV0udHlwZSA9PT0gJ0dlb1BvaW50J1xuICAgICk7XG4gICAgaWYgKGdlb1BvaW50cy5sZW5ndGggPiAxKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBjb2RlOiBQYXJzZS5FcnJvci5JTkNPUlJFQ1RfVFlQRSxcbiAgICAgICAgZXJyb3I6XG4gICAgICAgICAgJ2N1cnJlbnRseSwgb25seSBvbmUgR2VvUG9pbnQgZmllbGQgbWF5IGV4aXN0IGluIGFuIG9iamVjdC4gQWRkaW5nICcgK1xuICAgICAgICAgIGdlb1BvaW50c1sxXSArXG4gICAgICAgICAgJyB3aGVuICcgK1xuICAgICAgICAgIGdlb1BvaW50c1swXSArXG4gICAgICAgICAgJyBhbHJlYWR5IGV4aXN0cy4nLFxuICAgICAgfTtcbiAgICB9XG4gICAgdmFsaWRhdGVDTFAoY2xhc3NMZXZlbFBlcm1pc3Npb25zLCBmaWVsZHMpO1xuICB9XG5cbiAgLy8gU2V0cyB0aGUgQ2xhc3MtbGV2ZWwgcGVybWlzc2lvbnMgZm9yIGEgZ2l2ZW4gY2xhc3NOYW1lLCB3aGljaCBtdXN0IGV4aXN0LlxuICBzZXRQZXJtaXNzaW9ucyhjbGFzc05hbWU6IHN0cmluZywgcGVybXM6IGFueSwgbmV3U2NoZW1hOiBTY2hlbWFGaWVsZHMpIHtcbiAgICBpZiAodHlwZW9mIHBlcm1zID09PSAndW5kZWZpbmVkJykge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cbiAgICB2YWxpZGF0ZUNMUChwZXJtcywgbmV3U2NoZW1hKTtcbiAgICByZXR1cm4gdGhpcy5fZGJBZGFwdGVyLnNldENsYXNzTGV2ZWxQZXJtaXNzaW9ucyhjbGFzc05hbWUsIHBlcm1zKTtcbiAgfVxuXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgc3VjY2Vzc2Z1bGx5IHRvIHRoZSBuZXcgc2NoZW1hXG4gIC8vIG9iamVjdCBpZiB0aGUgcHJvdmlkZWQgY2xhc3NOYW1lLWZpZWxkTmFtZS10eXBlIHR1cGxlIGlzIHZhbGlkLlxuICAvLyBUaGUgY2xhc3NOYW1lIG11c3QgYWxyZWFkeSBiZSB2YWxpZGF0ZWQuXG4gIC8vIElmICdmcmVlemUnIGlzIHRydWUsIHJlZnVzZSB0byB1cGRhdGUgdGhlIHNjaGVtYSBmb3IgdGhpcyBmaWVsZC5cbiAgZW5mb3JjZUZpZWxkRXhpc3RzKFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIGZpZWxkTmFtZTogc3RyaW5nLFxuICAgIHR5cGU6IHN0cmluZyB8IFNjaGVtYUZpZWxkXG4gICkge1xuICAgIGlmIChmaWVsZE5hbWUuaW5kZXhPZignLicpID4gMCkge1xuICAgICAgLy8gc3ViZG9jdW1lbnQga2V5ICh4LnkpID0+IG9rIGlmIHggaXMgb2YgdHlwZSAnb2JqZWN0J1xuICAgICAgZmllbGROYW1lID0gZmllbGROYW1lLnNwbGl0KCcuJylbMF07XG4gICAgICB0eXBlID0gJ09iamVjdCc7XG4gICAgfVxuICAgIGlmICghZmllbGROYW1lSXNWYWxpZChmaWVsZE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUsXG4gICAgICAgIGBJbnZhbGlkIGZpZWxkIG5hbWU6ICR7ZmllbGROYW1lfS5gXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIElmIHNvbWVvbmUgdHJpZXMgdG8gY3JlYXRlIGEgbmV3IGZpZWxkIHdpdGggbnVsbC91bmRlZmluZWQgYXMgdGhlIHZhbHVlLCByZXR1cm47XG4gICAgaWYgKCF0eXBlKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnJlbG9hZERhdGEoKS50aGVuKCgpID0+IHtcbiAgICAgIGNvbnN0IGV4cGVjdGVkVHlwZSA9IHRoaXMuZ2V0RXhwZWN0ZWRUeXBlKGNsYXNzTmFtZSwgZmllbGROYW1lKTtcbiAgICAgIGlmICh0eXBlb2YgdHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgdHlwZSA9IHsgdHlwZSB9O1xuICAgICAgfVxuXG4gICAgICBpZiAoZXhwZWN0ZWRUeXBlKSB7XG4gICAgICAgIGlmICghZGJUeXBlTWF0Y2hlc09iamVjdFR5cGUoZXhwZWN0ZWRUeXBlLCB0eXBlKSkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOQ09SUkVDVF9UWVBFLFxuICAgICAgICAgICAgYHNjaGVtYSBtaXNtYXRjaCBmb3IgJHtjbGFzc05hbWV9LiR7ZmllbGROYW1lfTsgZXhwZWN0ZWQgJHt0eXBlVG9TdHJpbmcoXG4gICAgICAgICAgICAgIGV4cGVjdGVkVHlwZVxuICAgICAgICAgICAgKX0gYnV0IGdvdCAke3R5cGVUb1N0cmluZyh0eXBlKX1gXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRoaXMuX2RiQWRhcHRlclxuICAgICAgICAuYWRkRmllbGRJZk5vdEV4aXN0cyhjbGFzc05hbWUsIGZpZWxkTmFtZSwgdHlwZSlcbiAgICAgICAgLnRoZW4oXG4gICAgICAgICAgKCkgPT4ge1xuICAgICAgICAgICAgLy8gVGhlIHVwZGF0ZSBzdWNjZWVkZWQuIFJlbG9hZCB0aGUgc2NoZW1hXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5yZWxvYWREYXRhKHsgY2xlYXJDYWNoZTogdHJ1ZSB9KTtcbiAgICAgICAgICB9LFxuICAgICAgICAgIGVycm9yID0+IHtcbiAgICAgICAgICAgIGlmIChlcnJvci5jb2RlID09IFBhcnNlLkVycm9yLklOQ09SUkVDVF9UWVBFKSB7XG4gICAgICAgICAgICAgIC8vIE1ha2Ugc3VyZSB0aGF0IHdlIHRocm93IGVycm9ycyB3aGVuIGl0IGlzIGFwcHJvcHJpYXRlIHRvIGRvIHNvLlxuICAgICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIFRoZSB1cGRhdGUgZmFpbGVkLiBUaGlzIGNhbiBiZSBva2F5IC0gaXQgbWlnaHQgaGF2ZSBiZWVuIGEgcmFjZVxuICAgICAgICAgICAgLy8gY29uZGl0aW9uIHdoZXJlIGFub3RoZXIgY2xpZW50IHVwZGF0ZWQgdGhlIHNjaGVtYSBpbiB0aGUgc2FtZVxuICAgICAgICAgICAgLy8gd2F5IHRoYXQgd2Ugd2FudGVkIHRvLiBTbywganVzdCByZWxvYWQgdGhlIHNjaGVtYVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVsb2FkRGF0YSh7IGNsZWFyQ2FjaGU6IHRydWUgfSk7XG4gICAgICAgICAgfVxuICAgICAgICApXG4gICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAvLyBFbnN1cmUgdGhhdCB0aGUgc2NoZW1hIG5vdyB2YWxpZGF0ZXNcbiAgICAgICAgICBjb25zdCBleHBlY3RlZFR5cGUgPSB0aGlzLmdldEV4cGVjdGVkVHlwZShjbGFzc05hbWUsIGZpZWxkTmFtZSk7XG4gICAgICAgICAgaWYgKHR5cGVvZiB0eXBlID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgdHlwZSA9IHsgdHlwZSB9O1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoIWV4cGVjdGVkVHlwZSB8fCAhZGJUeXBlTWF0Y2hlc09iamVjdFR5cGUoZXhwZWN0ZWRUeXBlLCB0eXBlKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgICAgIGBDb3VsZCBub3QgYWRkIGZpZWxkICR7ZmllbGROYW1lfWBcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIFJlbW92ZSB0aGUgY2FjaGVkIHNjaGVtYVxuICAgICAgICAgIHRoaXMuX2NhY2hlLmNsZWFyKCk7XG4gICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gbWFpbnRhaW4gY29tcGF0aWJpbGl0eVxuICBkZWxldGVGaWVsZChcbiAgICBmaWVsZE5hbWU6IHN0cmluZyxcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBkYXRhYmFzZTogRGF0YWJhc2VDb250cm9sbGVyXG4gICkge1xuICAgIHJldHVybiB0aGlzLmRlbGV0ZUZpZWxkcyhbZmllbGROYW1lXSwgY2xhc3NOYW1lLCBkYXRhYmFzZSk7XG4gIH1cblxuICAvLyBEZWxldGUgZmllbGRzLCBhbmQgcmVtb3ZlIHRoYXQgZGF0YSBmcm9tIGFsbCBvYmplY3RzLiBUaGlzIGlzIGludGVuZGVkXG4gIC8vIHRvIHJlbW92ZSB1bnVzZWQgZmllbGRzLCBpZiBvdGhlciB3cml0ZXJzIGFyZSB3cml0aW5nIG9iamVjdHMgdGhhdCBpbmNsdWRlXG4gIC8vIHRoaXMgZmllbGQsIHRoZSBmaWVsZCBtYXkgcmVhcHBlYXIuIFJldHVybnMgYSBQcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2l0aFxuICAvLyBubyBvYmplY3Qgb24gc3VjY2Vzcywgb3IgcmVqZWN0cyB3aXRoIHsgY29kZSwgZXJyb3IgfSBvbiBmYWlsdXJlLlxuICAvLyBQYXNzaW5nIHRoZSBkYXRhYmFzZSBhbmQgcHJlZml4IGlzIG5lY2Vzc2FyeSBpbiBvcmRlciB0byBkcm9wIHJlbGF0aW9uIGNvbGxlY3Rpb25zXG4gIC8vIGFuZCByZW1vdmUgZmllbGRzIGZyb20gb2JqZWN0cy4gSWRlYWxseSB0aGUgZGF0YWJhc2Ugd291bGQgYmVsb25nIHRvXG4gIC8vIGEgZGF0YWJhc2UgYWRhcHRlciBhbmQgdGhpcyBmdW5jdGlvbiB3b3VsZCBjbG9zZSBvdmVyIGl0IG9yIGFjY2VzcyBpdCB2aWEgbWVtYmVyLlxuICBkZWxldGVGaWVsZHMoXG4gICAgZmllbGROYW1lczogQXJyYXk8c3RyaW5nPixcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBkYXRhYmFzZTogRGF0YWJhc2VDb250cm9sbGVyXG4gICkge1xuICAgIGlmICghY2xhc3NOYW1lSXNWYWxpZChjbGFzc05hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfQ0xBU1NfTkFNRSxcbiAgICAgICAgaW52YWxpZENsYXNzTmFtZU1lc3NhZ2UoY2xhc3NOYW1lKVxuICAgICAgKTtcbiAgICB9XG5cbiAgICBmaWVsZE5hbWVzLmZvckVhY2goZmllbGROYW1lID0+IHtcbiAgICAgIGlmICghZmllbGROYW1lSXNWYWxpZChmaWVsZE5hbWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLFxuICAgICAgICAgIGBpbnZhbGlkIGZpZWxkIG5hbWU6ICR7ZmllbGROYW1lfWBcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIC8vRG9uJ3QgYWxsb3cgZGVsZXRpbmcgdGhlIGRlZmF1bHQgZmllbGRzLlxuICAgICAgaWYgKCFmaWVsZE5hbWVJc1ZhbGlkRm9yQ2xhc3MoZmllbGROYW1lLCBjbGFzc05hbWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcigxMzYsIGBmaWVsZCAke2ZpZWxkTmFtZX0gY2Fubm90IGJlIGNoYW5nZWRgKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiB0aGlzLmdldE9uZVNjaGVtYShjbGFzc05hbWUsIGZhbHNlLCB7IGNsZWFyQ2FjaGU6IHRydWUgfSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChlcnJvciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9DTEFTU19OQU1FLFxuICAgICAgICAgICAgYENsYXNzICR7Y2xhc3NOYW1lfSBkb2VzIG5vdCBleGlzdC5gXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC50aGVuKHNjaGVtYSA9PiB7XG4gICAgICAgIGZpZWxkTmFtZXMuZm9yRWFjaChmaWVsZE5hbWUgPT4ge1xuICAgICAgICAgIGlmICghc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgIDI1NSxcbiAgICAgICAgICAgICAgYEZpZWxkICR7ZmllbGROYW1lfSBkb2VzIG5vdCBleGlzdCwgY2Fubm90IGRlbGV0ZS5gXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3Qgc2NoZW1hRmllbGRzID0geyAuLi5zY2hlbWEuZmllbGRzIH07XG4gICAgICAgIHJldHVybiBkYXRhYmFzZS5hZGFwdGVyXG4gICAgICAgICAgLmRlbGV0ZUZpZWxkcyhjbGFzc05hbWUsIHNjaGVtYSwgZmllbGROYW1lcylcbiAgICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwoXG4gICAgICAgICAgICAgIGZpZWxkTmFtZXMubWFwKGZpZWxkTmFtZSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgZmllbGQgPSBzY2hlbWFGaWVsZHNbZmllbGROYW1lXTtcbiAgICAgICAgICAgICAgICBpZiAoZmllbGQgJiYgZmllbGQudHlwZSA9PT0gJ1JlbGF0aW9uJykge1xuICAgICAgICAgICAgICAgICAgLy9Gb3IgcmVsYXRpb25zLCBkcm9wIHRoZSBfSm9pbiB0YWJsZVxuICAgICAgICAgICAgICAgICAgcmV0dXJuIGRhdGFiYXNlLmFkYXB0ZXIuZGVsZXRlQ2xhc3MoXG4gICAgICAgICAgICAgICAgICAgIGBfSm9pbjoke2ZpZWxkTmFtZX06JHtjbGFzc05hbWV9YFxuICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9KTtcbiAgICAgIH0pXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIHRoaXMuX2NhY2hlLmNsZWFyKCk7XG4gICAgICB9KTtcbiAgfVxuXG4gIC8vIFZhbGlkYXRlcyBhbiBvYmplY3QgcHJvdmlkZWQgaW4gUkVTVCBmb3JtYXQuXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gdGhlIG5ldyBzY2hlbWEgaWYgdGhpcyBvYmplY3QgaXNcbiAgLy8gdmFsaWQuXG4gIHZhbGlkYXRlT2JqZWN0KGNsYXNzTmFtZTogc3RyaW5nLCBvYmplY3Q6IGFueSwgcXVlcnk6IGFueSkge1xuICAgIGxldCBnZW9jb3VudCA9IDA7XG4gICAgbGV0IHByb21pc2UgPSB0aGlzLmVuZm9yY2VDbGFzc0V4aXN0cyhjbGFzc05hbWUpO1xuICAgIGZvciAoY29uc3QgZmllbGROYW1lIGluIG9iamVjdCkge1xuICAgICAgaWYgKG9iamVjdFtmaWVsZE5hbWVdID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBleHBlY3RlZCA9IGdldFR5cGUob2JqZWN0W2ZpZWxkTmFtZV0pO1xuICAgICAgaWYgKGV4cGVjdGVkID09PSAnR2VvUG9pbnQnKSB7XG4gICAgICAgIGdlb2NvdW50Kys7XG4gICAgICB9XG4gICAgICBpZiAoZ2VvY291bnQgPiAxKSB7XG4gICAgICAgIC8vIE1ha2Ugc3VyZSBhbGwgZmllbGQgdmFsaWRhdGlvbiBvcGVyYXRpb25zIHJ1biBiZWZvcmUgd2UgcmV0dXJuLlxuICAgICAgICAvLyBJZiBub3QgLSB3ZSBhcmUgY29udGludWluZyB0byBydW4gbG9naWMsIGJ1dCBhbHJlYWR5IHByb3ZpZGVkIHJlc3BvbnNlIGZyb20gdGhlIHNlcnZlci5cbiAgICAgICAgcmV0dXJuIHByb21pc2UudGhlbigoKSA9PiB7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KFxuICAgICAgICAgICAgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICBQYXJzZS5FcnJvci5JTkNPUlJFQ1RfVFlQRSxcbiAgICAgICAgICAgICAgJ3RoZXJlIGNhbiBvbmx5IGJlIG9uZSBnZW9wb2ludCBmaWVsZCBpbiBhIGNsYXNzJ1xuICAgICAgICAgICAgKVxuICAgICAgICAgICk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgaWYgKCFleHBlY3RlZCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChmaWVsZE5hbWUgPT09ICdBQ0wnKSB7XG4gICAgICAgIC8vIEV2ZXJ5IG9iamVjdCBoYXMgQUNMIGltcGxpY2l0bHkuXG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBwcm9taXNlID0gcHJvbWlzZS50aGVuKHNjaGVtYSA9PlxuICAgICAgICBzY2hlbWEuZW5mb3JjZUZpZWxkRXhpc3RzKGNsYXNzTmFtZSwgZmllbGROYW1lLCBleHBlY3RlZClcbiAgICAgICk7XG4gICAgfVxuICAgIHByb21pc2UgPSB0aGVuVmFsaWRhdGVSZXF1aXJlZENvbHVtbnMocHJvbWlzZSwgY2xhc3NOYW1lLCBvYmplY3QsIHF1ZXJ5KTtcbiAgICByZXR1cm4gcHJvbWlzZTtcbiAgfVxuXG4gIC8vIFZhbGlkYXRlcyB0aGF0IGFsbCB0aGUgcHJvcGVydGllcyBhcmUgc2V0IGZvciB0aGUgb2JqZWN0XG4gIHZhbGlkYXRlUmVxdWlyZWRDb2x1bW5zKGNsYXNzTmFtZTogc3RyaW5nLCBvYmplY3Q6IGFueSwgcXVlcnk6IGFueSkge1xuICAgIGNvbnN0IGNvbHVtbnMgPSByZXF1aXJlZENvbHVtbnNbY2xhc3NOYW1lXTtcbiAgICBpZiAoIWNvbHVtbnMgfHwgY29sdW1ucy5sZW5ndGggPT0gMCkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzKTtcbiAgICB9XG5cbiAgICBjb25zdCBtaXNzaW5nQ29sdW1ucyA9IGNvbHVtbnMuZmlsdGVyKGZ1bmN0aW9uKGNvbHVtbikge1xuICAgICAgaWYgKHF1ZXJ5ICYmIHF1ZXJ5Lm9iamVjdElkKSB7XG4gICAgICAgIGlmIChvYmplY3RbY29sdW1uXSAmJiB0eXBlb2Ygb2JqZWN0W2NvbHVtbl0gPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgLy8gVHJ5aW5nIHRvIGRlbGV0ZSBhIHJlcXVpcmVkIGNvbHVtblxuICAgICAgICAgIHJldHVybiBvYmplY3RbY29sdW1uXS5fX29wID09ICdEZWxldGUnO1xuICAgICAgICB9XG4gICAgICAgIC8vIE5vdCB0cnlpbmcgdG8gZG8gYW55dGhpbmcgdGhlcmVcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgcmV0dXJuICFvYmplY3RbY29sdW1uXTtcbiAgICB9KTtcblxuICAgIGlmIChtaXNzaW5nQ29sdW1ucy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLklOQ09SUkVDVF9UWVBFLFxuICAgICAgICBtaXNzaW5nQ29sdW1uc1swXSArICcgaXMgcmVxdWlyZWQuJ1xuICAgICAgKTtcbiAgICB9XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzKTtcbiAgfVxuXG4gIHRlc3RQZXJtaXNzaW9uc0ZvckNsYXNzTmFtZShcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBhY2xHcm91cDogc3RyaW5nW10sXG4gICAgb3BlcmF0aW9uOiBzdHJpbmdcbiAgKSB7XG4gICAgcmV0dXJuIFNjaGVtYUNvbnRyb2xsZXIudGVzdFBlcm1pc3Npb25zKFxuICAgICAgdGhpcy5nZXRDbGFzc0xldmVsUGVybWlzc2lvbnMoY2xhc3NOYW1lKSxcbiAgICAgIGFjbEdyb3VwLFxuICAgICAgb3BlcmF0aW9uXG4gICAgKTtcbiAgfVxuXG4gIC8vIFRlc3RzIHRoYXQgdGhlIGNsYXNzIGxldmVsIHBlcm1pc3Npb24gbGV0IHBhc3MgdGhlIG9wZXJhdGlvbiBmb3IgYSBnaXZlbiBhY2xHcm91cFxuICBzdGF0aWMgdGVzdFBlcm1pc3Npb25zKFxuICAgIGNsYXNzUGVybWlzc2lvbnM6ID9hbnksXG4gICAgYWNsR3JvdXA6IHN0cmluZ1tdLFxuICAgIG9wZXJhdGlvbjogc3RyaW5nXG4gICk6IGJvb2xlYW4ge1xuICAgIGlmICghY2xhc3NQZXJtaXNzaW9ucyB8fCAhY2xhc3NQZXJtaXNzaW9uc1tvcGVyYXRpb25dKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgY29uc3QgcGVybXMgPSBjbGFzc1Blcm1pc3Npb25zW29wZXJhdGlvbl07XG4gICAgaWYgKHBlcm1zWycqJ10pIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICAvLyBDaGVjayBwZXJtaXNzaW9ucyBhZ2FpbnN0IHRoZSBhY2xHcm91cCBwcm92aWRlZCAoYXJyYXkgb2YgdXNlcklkL3JvbGVzKVxuICAgIGlmIChcbiAgICAgIGFjbEdyb3VwLnNvbWUoYWNsID0+IHtcbiAgICAgICAgcmV0dXJuIHBlcm1zW2FjbF0gPT09IHRydWU7XG4gICAgICB9KVxuICAgICkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8vIFZhbGlkYXRlcyBhbiBvcGVyYXRpb24gcGFzc2VzIGNsYXNzLWxldmVsLXBlcm1pc3Npb25zIHNldCBpbiB0aGUgc2NoZW1hXG4gIHN0YXRpYyB2YWxpZGF0ZVBlcm1pc3Npb24oXG4gICAgY2xhc3NQZXJtaXNzaW9uczogP2FueSxcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBhY2xHcm91cDogc3RyaW5nW10sXG4gICAgb3BlcmF0aW9uOiBzdHJpbmdcbiAgKSB7XG4gICAgaWYgKFxuICAgICAgU2NoZW1hQ29udHJvbGxlci50ZXN0UGVybWlzc2lvbnMoY2xhc3NQZXJtaXNzaW9ucywgYWNsR3JvdXAsIG9wZXJhdGlvbilcbiAgICApIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG5cbiAgICBpZiAoIWNsYXNzUGVybWlzc2lvbnMgfHwgIWNsYXNzUGVybWlzc2lvbnNbb3BlcmF0aW9uXSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIGNvbnN0IHBlcm1zID0gY2xhc3NQZXJtaXNzaW9uc1tvcGVyYXRpb25dO1xuICAgIC8vIElmIG9ubHkgZm9yIGF1dGhlbnRpY2F0ZWQgdXNlcnNcbiAgICAvLyBtYWtlIHN1cmUgd2UgaGF2ZSBhbiBhY2xHcm91cFxuICAgIGlmIChwZXJtc1sncmVxdWlyZXNBdXRoZW50aWNhdGlvbiddKSB7XG4gICAgICAvLyBJZiBhY2xHcm91cCBoYXMgKiAocHVibGljKVxuICAgICAgaWYgKCFhY2xHcm91cCB8fCBhY2xHcm91cC5sZW5ndGggPT0gMCkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCxcbiAgICAgICAgICAnUGVybWlzc2lvbiBkZW5pZWQsIHVzZXIgbmVlZHMgdG8gYmUgYXV0aGVudGljYXRlZC4nXG4gICAgICAgICk7XG4gICAgICB9IGVsc2UgaWYgKGFjbEdyb3VwLmluZGV4T2YoJyonKSA+IC0xICYmIGFjbEdyb3VwLmxlbmd0aCA9PSAxKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5ELFxuICAgICAgICAgICdQZXJtaXNzaW9uIGRlbmllZCwgdXNlciBuZWVkcyB0byBiZSBhdXRoZW50aWNhdGVkLidcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIC8vIHJlcXVpcmVzQXV0aGVudGljYXRpb24gcGFzc2VkLCBqdXN0IG1vdmUgZm9yd2FyZFxuICAgICAgLy8gcHJvYmFibHkgd291bGQgYmUgd2lzZSBhdCBzb21lIHBvaW50IHRvIHJlbmFtZSB0byAnYXV0aGVudGljYXRlZFVzZXInXG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuXG4gICAgLy8gTm8gbWF0Y2hpbmcgQ0xQLCBsZXQncyBjaGVjayB0aGUgUG9pbnRlciBwZXJtaXNzaW9uc1xuICAgIC8vIEFuZCBoYW5kbGUgdGhvc2UgbGF0ZXJcbiAgICBjb25zdCBwZXJtaXNzaW9uRmllbGQgPVxuICAgICAgWydnZXQnLCAnZmluZCcsICdjb3VudCddLmluZGV4T2Yob3BlcmF0aW9uKSA+IC0xXG4gICAgICAgID8gJ3JlYWRVc2VyRmllbGRzJ1xuICAgICAgICA6ICd3cml0ZVVzZXJGaWVsZHMnO1xuXG4gICAgLy8gUmVqZWN0IGNyZWF0ZSB3aGVuIHdyaXRlIGxvY2tkb3duXG4gICAgaWYgKHBlcm1pc3Npb25GaWVsZCA9PSAnd3JpdGVVc2VyRmllbGRzJyAmJiBvcGVyYXRpb24gPT0gJ2NyZWF0ZScpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTixcbiAgICAgICAgYFBlcm1pc3Npb24gZGVuaWVkIGZvciBhY3Rpb24gJHtvcGVyYXRpb259IG9uIGNsYXNzICR7Y2xhc3NOYW1lfS5gXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIFByb2Nlc3MgdGhlIHJlYWRVc2VyRmllbGRzIGxhdGVyXG4gICAgaWYgKFxuICAgICAgQXJyYXkuaXNBcnJheShjbGFzc1Blcm1pc3Npb25zW3Blcm1pc3Npb25GaWVsZF0pICYmXG4gICAgICBjbGFzc1Blcm1pc3Npb25zW3Blcm1pc3Npb25GaWVsZF0ubGVuZ3RoID4gMFxuICAgICkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICBQYXJzZS5FcnJvci5PUEVSQVRJT05fRk9SQklEREVOLFxuICAgICAgYFBlcm1pc3Npb24gZGVuaWVkIGZvciBhY3Rpb24gJHtvcGVyYXRpb259IG9uIGNsYXNzICR7Y2xhc3NOYW1lfS5gXG4gICAgKTtcbiAgfVxuXG4gIC8vIFZhbGlkYXRlcyBhbiBvcGVyYXRpb24gcGFzc2VzIGNsYXNzLWxldmVsLXBlcm1pc3Npb25zIHNldCBpbiB0aGUgc2NoZW1hXG4gIHZhbGlkYXRlUGVybWlzc2lvbihjbGFzc05hbWU6IHN0cmluZywgYWNsR3JvdXA6IHN0cmluZ1tdLCBvcGVyYXRpb246IHN0cmluZykge1xuICAgIHJldHVybiBTY2hlbWFDb250cm9sbGVyLnZhbGlkYXRlUGVybWlzc2lvbihcbiAgICAgIHRoaXMuZ2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zKGNsYXNzTmFtZSksXG4gICAgICBjbGFzc05hbWUsXG4gICAgICBhY2xHcm91cCxcbiAgICAgIG9wZXJhdGlvblxuICAgICk7XG4gIH1cblxuICBnZXRDbGFzc0xldmVsUGVybWlzc2lvbnMoY2xhc3NOYW1lOiBzdHJpbmcpOiBhbnkge1xuICAgIHJldHVybiAoXG4gICAgICB0aGlzLnNjaGVtYURhdGFbY2xhc3NOYW1lXSAmJlxuICAgICAgdGhpcy5zY2hlbWFEYXRhW2NsYXNzTmFtZV0uY2xhc3NMZXZlbFBlcm1pc3Npb25zXG4gICAgKTtcbiAgfVxuXG4gIC8vIFJldHVybnMgdGhlIGV4cGVjdGVkIHR5cGUgZm9yIGEgY2xhc3NOYW1lK2tleSBjb21iaW5hdGlvblxuICAvLyBvciB1bmRlZmluZWQgaWYgdGhlIHNjaGVtYSBpcyBub3Qgc2V0XG4gIGdldEV4cGVjdGVkVHlwZShcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBmaWVsZE5hbWU6IHN0cmluZ1xuICApOiA/KFNjaGVtYUZpZWxkIHwgc3RyaW5nKSB7XG4gICAgaWYgKHRoaXMuc2NoZW1hRGF0YVtjbGFzc05hbWVdKSB7XG4gICAgICBjb25zdCBleHBlY3RlZFR5cGUgPSB0aGlzLnNjaGVtYURhdGFbY2xhc3NOYW1lXS5maWVsZHNbZmllbGROYW1lXTtcbiAgICAgIHJldHVybiBleHBlY3RlZFR5cGUgPT09ICdtYXAnID8gJ09iamVjdCcgOiBleHBlY3RlZFR5cGU7XG4gICAgfVxuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICAvLyBDaGVja3MgaWYgYSBnaXZlbiBjbGFzcyBpcyBpbiB0aGUgc2NoZW1hLlxuICBoYXNDbGFzcyhjbGFzc05hbWU6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLnJlbG9hZERhdGEoKS50aGVuKCgpID0+ICEhdGhpcy5zY2hlbWFEYXRhW2NsYXNzTmFtZV0pO1xuICB9XG59XG5cbi8vIFJldHVybnMgYSBwcm9taXNlIGZvciBhIG5ldyBTY2hlbWEuXG5jb25zdCBsb2FkID0gKFxuICBkYkFkYXB0ZXI6IFN0b3JhZ2VBZGFwdGVyLFxuICBzY2hlbWFDYWNoZTogYW55LFxuICBvcHRpb25zOiBhbnlcbik6IFByb21pc2U8U2NoZW1hQ29udHJvbGxlcj4gPT4ge1xuICBjb25zdCBzY2hlbWEgPSBuZXcgU2NoZW1hQ29udHJvbGxlcihkYkFkYXB0ZXIsIHNjaGVtYUNhY2hlKTtcbiAgcmV0dXJuIHNjaGVtYS5yZWxvYWREYXRhKG9wdGlvbnMpLnRoZW4oKCkgPT4gc2NoZW1hKTtcbn07XG5cbi8vIEJ1aWxkcyBhIG5ldyBzY2hlbWEgKGluIHNjaGVtYSBBUEkgcmVzcG9uc2UgZm9ybWF0KSBvdXQgb2YgYW5cbi8vIGV4aXN0aW5nIG1vbmdvIHNjaGVtYSArIGEgc2NoZW1hcyBBUEkgcHV0IHJlcXVlc3QuIFRoaXMgcmVzcG9uc2Vcbi8vIGRvZXMgbm90IGluY2x1ZGUgdGhlIGRlZmF1bHQgZmllbGRzLCBhcyBpdCBpcyBpbnRlbmRlZCB0byBiZSBwYXNzZWRcbi8vIHRvIG1vbmdvU2NoZW1hRnJvbUZpZWxkc0FuZENsYXNzTmFtZS4gTm8gdmFsaWRhdGlvbiBpcyBkb25lIGhlcmUsIGl0XG4vLyBpcyBkb25lIGluIG1vbmdvU2NoZW1hRnJvbUZpZWxkc0FuZENsYXNzTmFtZS5cbmZ1bmN0aW9uIGJ1aWxkTWVyZ2VkU2NoZW1hT2JqZWN0KFxuICBleGlzdGluZ0ZpZWxkczogU2NoZW1hRmllbGRzLFxuICBwdXRSZXF1ZXN0OiBhbnlcbik6IFNjaGVtYUZpZWxkcyB7XG4gIGNvbnN0IG5ld1NjaGVtYSA9IHt9O1xuICAvLyBAZmxvdy1kaXNhYmxlLW5leHRcbiAgY29uc3Qgc3lzU2NoZW1hRmllbGQgPVxuICAgIE9iamVjdC5rZXlzKGRlZmF1bHRDb2x1bW5zKS5pbmRleE9mKGV4aXN0aW5nRmllbGRzLl9pZCkgPT09IC0xXG4gICAgICA/IFtdXG4gICAgICA6IE9iamVjdC5rZXlzKGRlZmF1bHRDb2x1bW5zW2V4aXN0aW5nRmllbGRzLl9pZF0pO1xuICBmb3IgKGNvbnN0IG9sZEZpZWxkIGluIGV4aXN0aW5nRmllbGRzKSB7XG4gICAgaWYgKFxuICAgICAgb2xkRmllbGQgIT09ICdfaWQnICYmXG4gICAgICBvbGRGaWVsZCAhPT0gJ0FDTCcgJiZcbiAgICAgIG9sZEZpZWxkICE9PSAndXBkYXRlZEF0JyAmJlxuICAgICAgb2xkRmllbGQgIT09ICdjcmVhdGVkQXQnICYmXG4gICAgICBvbGRGaWVsZCAhPT0gJ29iamVjdElkJ1xuICAgICkge1xuICAgICAgaWYgKFxuICAgICAgICBzeXNTY2hlbWFGaWVsZC5sZW5ndGggPiAwICYmXG4gICAgICAgIHN5c1NjaGVtYUZpZWxkLmluZGV4T2Yob2xkRmllbGQpICE9PSAtMVxuICAgICAgKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgZmllbGRJc0RlbGV0ZWQgPVxuICAgICAgICBwdXRSZXF1ZXN0W29sZEZpZWxkXSAmJiBwdXRSZXF1ZXN0W29sZEZpZWxkXS5fX29wID09PSAnRGVsZXRlJztcbiAgICAgIGlmICghZmllbGRJc0RlbGV0ZWQpIHtcbiAgICAgICAgbmV3U2NoZW1hW29sZEZpZWxkXSA9IGV4aXN0aW5nRmllbGRzW29sZEZpZWxkXTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgZm9yIChjb25zdCBuZXdGaWVsZCBpbiBwdXRSZXF1ZXN0KSB7XG4gICAgaWYgKG5ld0ZpZWxkICE9PSAnb2JqZWN0SWQnICYmIHB1dFJlcXVlc3RbbmV3RmllbGRdLl9fb3AgIT09ICdEZWxldGUnKSB7XG4gICAgICBpZiAoXG4gICAgICAgIHN5c1NjaGVtYUZpZWxkLmxlbmd0aCA+IDAgJiZcbiAgICAgICAgc3lzU2NoZW1hRmllbGQuaW5kZXhPZihuZXdGaWVsZCkgIT09IC0xXG4gICAgICApIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBuZXdTY2hlbWFbbmV3RmllbGRdID0gcHV0UmVxdWVzdFtuZXdGaWVsZF07XG4gICAgfVxuICB9XG4gIHJldHVybiBuZXdTY2hlbWE7XG59XG5cbi8vIEdpdmVuIGEgc2NoZW1hIHByb21pc2UsIGNvbnN0cnVjdCBhbm90aGVyIHNjaGVtYSBwcm9taXNlIHRoYXRcbi8vIHZhbGlkYXRlcyB0aGlzIGZpZWxkIG9uY2UgdGhlIHNjaGVtYSBsb2Fkcy5cbmZ1bmN0aW9uIHRoZW5WYWxpZGF0ZVJlcXVpcmVkQ29sdW1ucyhzY2hlbWFQcm9taXNlLCBjbGFzc05hbWUsIG9iamVjdCwgcXVlcnkpIHtcbiAgcmV0dXJuIHNjaGVtYVByb21pc2UudGhlbihzY2hlbWEgPT4ge1xuICAgIHJldHVybiBzY2hlbWEudmFsaWRhdGVSZXF1aXJlZENvbHVtbnMoY2xhc3NOYW1lLCBvYmplY3QsIHF1ZXJ5KTtcbiAgfSk7XG59XG5cbi8vIEdldHMgdGhlIHR5cGUgZnJvbSBhIFJFU1QgQVBJIGZvcm1hdHRlZCBvYmplY3QsIHdoZXJlICd0eXBlJyBpc1xuLy8gZXh0ZW5kZWQgcGFzdCBqYXZhc2NyaXB0IHR5cGVzIHRvIGluY2x1ZGUgdGhlIHJlc3Qgb2YgdGhlIFBhcnNlXG4vLyB0eXBlIHN5c3RlbS5cbi8vIFRoZSBvdXRwdXQgc2hvdWxkIGJlIGEgdmFsaWQgc2NoZW1hIHZhbHVlLlxuLy8gVE9ETzogZW5zdXJlIHRoYXQgdGhpcyBpcyBjb21wYXRpYmxlIHdpdGggdGhlIGZvcm1hdCB1c2VkIGluIE9wZW4gREJcbmZ1bmN0aW9uIGdldFR5cGUob2JqOiBhbnkpOiA/KFNjaGVtYUZpZWxkIHwgc3RyaW5nKSB7XG4gIGNvbnN0IHR5cGUgPSB0eXBlb2Ygb2JqO1xuICBzd2l0Y2ggKHR5cGUpIHtcbiAgICBjYXNlICdib29sZWFuJzpcbiAgICAgIHJldHVybiAnQm9vbGVhbic7XG4gICAgY2FzZSAnc3RyaW5nJzpcbiAgICAgIHJldHVybiAnU3RyaW5nJztcbiAgICBjYXNlICdudW1iZXInOlxuICAgICAgcmV0dXJuICdOdW1iZXInO1xuICAgIGNhc2UgJ21hcCc6XG4gICAgY2FzZSAnb2JqZWN0JzpcbiAgICAgIGlmICghb2JqKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG4gICAgICByZXR1cm4gZ2V0T2JqZWN0VHlwZShvYmopO1xuICAgIGNhc2UgJ2Z1bmN0aW9uJzpcbiAgICBjYXNlICdzeW1ib2wnOlxuICAgIGNhc2UgJ3VuZGVmaW5lZCc6XG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93ICdiYWQgb2JqOiAnICsgb2JqO1xuICB9XG59XG5cbi8vIFRoaXMgZ2V0cyB0aGUgdHlwZSBmb3Igbm9uLUpTT04gdHlwZXMgbGlrZSBwb2ludGVycyBhbmQgZmlsZXMsIGJ1dFxuLy8gYWxzbyBnZXRzIHRoZSBhcHByb3ByaWF0ZSB0eXBlIGZvciAkIG9wZXJhdG9ycy5cbi8vIFJldHVybnMgbnVsbCBpZiB0aGUgdHlwZSBpcyB1bmtub3duLlxuZnVuY3Rpb24gZ2V0T2JqZWN0VHlwZShvYmopOiA/KFNjaGVtYUZpZWxkIHwgc3RyaW5nKSB7XG4gIGlmIChvYmogaW5zdGFuY2VvZiBBcnJheSkge1xuICAgIHJldHVybiAnQXJyYXknO1xuICB9XG4gIGlmIChvYmouX190eXBlKSB7XG4gICAgc3dpdGNoIChvYmouX190eXBlKSB7XG4gICAgICBjYXNlICdQb2ludGVyJzpcbiAgICAgICAgaWYgKG9iai5jbGFzc05hbWUpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdHlwZTogJ1BvaW50ZXInLFxuICAgICAgICAgICAgdGFyZ2V0Q2xhc3M6IG9iai5jbGFzc05hbWUsXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ1JlbGF0aW9uJzpcbiAgICAgICAgaWYgKG9iai5jbGFzc05hbWUpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdHlwZTogJ1JlbGF0aW9uJyxcbiAgICAgICAgICAgIHRhcmdldENsYXNzOiBvYmouY2xhc3NOYW1lLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdGaWxlJzpcbiAgICAgICAgaWYgKG9iai5uYW1lKSB7XG4gICAgICAgICAgcmV0dXJuICdGaWxlJztcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ0RhdGUnOlxuICAgICAgICBpZiAob2JqLmlzbykge1xuICAgICAgICAgIHJldHVybiAnRGF0ZSc7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdHZW9Qb2ludCc6XG4gICAgICAgIGlmIChvYmoubGF0aXR1ZGUgIT0gbnVsbCAmJiBvYmoubG9uZ2l0dWRlICE9IG51bGwpIHtcbiAgICAgICAgICByZXR1cm4gJ0dlb1BvaW50JztcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ0J5dGVzJzpcbiAgICAgICAgaWYgKG9iai5iYXNlNjQpIHtcbiAgICAgICAgICByZXR1cm4gJ0J5dGVzJztcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ1BvbHlnb24nOlxuICAgICAgICBpZiAob2JqLmNvb3JkaW5hdGVzKSB7XG4gICAgICAgICAgcmV0dXJuICdQb2x5Z29uJztcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICB9XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgUGFyc2UuRXJyb3IuSU5DT1JSRUNUX1RZUEUsXG4gICAgICAnVGhpcyBpcyBub3QgYSB2YWxpZCAnICsgb2JqLl9fdHlwZVxuICAgICk7XG4gIH1cbiAgaWYgKG9ialsnJG5lJ10pIHtcbiAgICByZXR1cm4gZ2V0T2JqZWN0VHlwZShvYmpbJyRuZSddKTtcbiAgfVxuICBpZiAob2JqLl9fb3ApIHtcbiAgICBzd2l0Y2ggKG9iai5fX29wKSB7XG4gICAgICBjYXNlICdJbmNyZW1lbnQnOlxuICAgICAgICByZXR1cm4gJ051bWJlcic7XG4gICAgICBjYXNlICdEZWxldGUnOlxuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIGNhc2UgJ0FkZCc6XG4gICAgICBjYXNlICdBZGRVbmlxdWUnOlxuICAgICAgY2FzZSAnUmVtb3ZlJzpcbiAgICAgICAgcmV0dXJuICdBcnJheSc7XG4gICAgICBjYXNlICdBZGRSZWxhdGlvbic6XG4gICAgICBjYXNlICdSZW1vdmVSZWxhdGlvbic6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgdHlwZTogJ1JlbGF0aW9uJyxcbiAgICAgICAgICB0YXJnZXRDbGFzczogb2JqLm9iamVjdHNbMF0uY2xhc3NOYW1lLFxuICAgICAgICB9O1xuICAgICAgY2FzZSAnQmF0Y2gnOlxuICAgICAgICByZXR1cm4gZ2V0T2JqZWN0VHlwZShvYmoub3BzWzBdKTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93ICd1bmV4cGVjdGVkIG9wOiAnICsgb2JqLl9fb3A7XG4gICAgfVxuICB9XG4gIHJldHVybiAnT2JqZWN0Jztcbn1cblxuZXhwb3J0IHtcbiAgbG9hZCxcbiAgY2xhc3NOYW1lSXNWYWxpZCxcbiAgZmllbGROYW1lSXNWYWxpZCxcbiAgaW52YWxpZENsYXNzTmFtZU1lc3NhZ2UsXG4gIGJ1aWxkTWVyZ2VkU2NoZW1hT2JqZWN0LFxuICBzeXN0ZW1DbGFzc2VzLFxuICBkZWZhdWx0Q29sdW1ucyxcbiAgY29udmVydFNjaGVtYVRvQWRhcHRlclNjaGVtYSxcbiAgVm9sYXRpbGVDbGFzc2VzU2NoZW1hcyxcbiAgU2NoZW1hQ29udHJvbGxlcixcbn07XG4iXX0=