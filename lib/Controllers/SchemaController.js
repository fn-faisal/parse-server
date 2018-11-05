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
  },
  _ExportProgress: {
    appId: {
      type: 'String'
    },
    masterKey: {
      type: 'String'
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
const volatileClasses = Object.freeze(['_JobStatus', '_PushStatus', '_Hooks', '_GlobalConfig', '_JobSchedule', '_Audience', '_ExportProgress']); // 10 alpha numberic chars + uppercase

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

const _ExportProgressSchema = convertSchemaToAdapterSchema(injectDefaultSchema({
  className: '_ExportProgress',
  fields: defaultColumns._ExportProgress,
  classLevelPermissions: {}
}));

const VolatileClassesSchemas = [_HooksSchema, _JobStatusSchema, _JobScheduleSchema, _PushStatusSchema, _GlobalConfigSchema, _AudienceSchema, _ExportProgressSchema];
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9TY2hlbWFDb250cm9sbGVyLmpzIl0sIm5hbWVzIjpbIlBhcnNlIiwicmVxdWlyZSIsImRlZmF1bHRDb2x1bW5zIiwiT2JqZWN0IiwiZnJlZXplIiwiX0RlZmF1bHQiLCJvYmplY3RJZCIsInR5cGUiLCJjcmVhdGVkQXQiLCJ1cGRhdGVkQXQiLCJBQ0wiLCJfVXNlciIsInVzZXJuYW1lIiwicGFzc3dvcmQiLCJlbWFpbCIsImVtYWlsVmVyaWZpZWQiLCJhdXRoRGF0YSIsIl9JbnN0YWxsYXRpb24iLCJpbnN0YWxsYXRpb25JZCIsImRldmljZVRva2VuIiwiY2hhbm5lbHMiLCJkZXZpY2VUeXBlIiwicHVzaFR5cGUiLCJHQ01TZW5kZXJJZCIsInRpbWVab25lIiwibG9jYWxlSWRlbnRpZmllciIsImJhZGdlIiwiYXBwVmVyc2lvbiIsImFwcE5hbWUiLCJhcHBJZGVudGlmaWVyIiwicGFyc2VWZXJzaW9uIiwiX1JvbGUiLCJuYW1lIiwidXNlcnMiLCJ0YXJnZXRDbGFzcyIsInJvbGVzIiwiX1Nlc3Npb24iLCJyZXN0cmljdGVkIiwidXNlciIsInNlc3Npb25Ub2tlbiIsImV4cGlyZXNBdCIsImNyZWF0ZWRXaXRoIiwiX1Byb2R1Y3QiLCJwcm9kdWN0SWRlbnRpZmllciIsImRvd25sb2FkIiwiZG93bmxvYWROYW1lIiwiaWNvbiIsIm9yZGVyIiwidGl0bGUiLCJzdWJ0aXRsZSIsIl9QdXNoU3RhdHVzIiwicHVzaFRpbWUiLCJzb3VyY2UiLCJxdWVyeSIsInBheWxvYWQiLCJleHBpcnkiLCJleHBpcmF0aW9uX2ludGVydmFsIiwic3RhdHVzIiwibnVtU2VudCIsIm51bUZhaWxlZCIsInB1c2hIYXNoIiwiZXJyb3JNZXNzYWdlIiwic2VudFBlclR5cGUiLCJmYWlsZWRQZXJUeXBlIiwic2VudFBlclVUQ09mZnNldCIsImZhaWxlZFBlclVUQ09mZnNldCIsImNvdW50IiwiX0pvYlN0YXR1cyIsImpvYk5hbWUiLCJtZXNzYWdlIiwicGFyYW1zIiwiZmluaXNoZWRBdCIsIl9Kb2JTY2hlZHVsZSIsImRlc2NyaXB0aW9uIiwic3RhcnRBZnRlciIsImRheXNPZldlZWsiLCJ0aW1lT2ZEYXkiLCJsYXN0UnVuIiwicmVwZWF0TWludXRlcyIsIl9Ib29rcyIsImZ1bmN0aW9uTmFtZSIsImNsYXNzTmFtZSIsInRyaWdnZXJOYW1lIiwidXJsIiwiX0dsb2JhbENvbmZpZyIsIl9BdWRpZW5jZSIsImxhc3RVc2VkIiwidGltZXNVc2VkIiwiX0V4cG9ydFByb2dyZXNzIiwiYXBwSWQiLCJtYXN0ZXJLZXkiLCJyZXF1aXJlZENvbHVtbnMiLCJzeXN0ZW1DbGFzc2VzIiwidm9sYXRpbGVDbGFzc2VzIiwidXNlcklkUmVnZXgiLCJyb2xlUmVnZXgiLCJwdWJsaWNSZWdleCIsInJlcXVpcmVBdXRoZW50aWNhdGlvblJlZ2V4IiwicGVybWlzc2lvbktleVJlZ2V4IiwidmVyaWZ5UGVybWlzc2lvbktleSIsImtleSIsInJlc3VsdCIsInJlZHVjZSIsImlzR29vZCIsInJlZ0V4IiwibWF0Y2giLCJFcnJvciIsIklOVkFMSURfSlNPTiIsIkNMUFZhbGlkS2V5cyIsInZhbGlkYXRlQ0xQIiwicGVybXMiLCJmaWVsZHMiLCJrZXlzIiwiZm9yRWFjaCIsIm9wZXJhdGlvbiIsImluZGV4T2YiLCJBcnJheSIsImlzQXJyYXkiLCJwZXJtIiwiam9pbkNsYXNzUmVnZXgiLCJjbGFzc0FuZEZpZWxkUmVnZXgiLCJjbGFzc05hbWVJc1ZhbGlkIiwidGVzdCIsImZpZWxkTmFtZUlzVmFsaWQiLCJmaWVsZE5hbWUiLCJmaWVsZE5hbWVJc1ZhbGlkRm9yQ2xhc3MiLCJpbnZhbGlkQ2xhc3NOYW1lTWVzc2FnZSIsImludmFsaWRKc29uRXJyb3IiLCJ2YWxpZE5vblJlbGF0aW9uT3JQb2ludGVyVHlwZXMiLCJmaWVsZFR5cGVJc0ludmFsaWQiLCJJTlZBTElEX0NMQVNTX05BTUUiLCJ1bmRlZmluZWQiLCJJTkNPUlJFQ1RfVFlQRSIsImNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEiLCJzY2hlbWEiLCJpbmplY3REZWZhdWx0U2NoZW1hIiwiX3JwZXJtIiwiX3dwZXJtIiwiX2hhc2hlZF9wYXNzd29yZCIsImNvbnZlcnRBZGFwdGVyU2NoZW1hVG9QYXJzZVNjaGVtYSIsImluZGV4ZXMiLCJsZW5ndGgiLCJTY2hlbWFEYXRhIiwiY29uc3RydWN0b3IiLCJhbGxTY2hlbWFzIiwiX19kYXRhIiwiZGVmaW5lUHJvcGVydHkiLCJnZXQiLCJkYXRhIiwiY2xhc3NMZXZlbFBlcm1pc3Npb25zIiwiZGVmYXVsdFNjaGVtYSIsIl9Ib29rc1NjaGVtYSIsIl9HbG9iYWxDb25maWdTY2hlbWEiLCJfUHVzaFN0YXR1c1NjaGVtYSIsIl9Kb2JTdGF0dXNTY2hlbWEiLCJfSm9iU2NoZWR1bGVTY2hlbWEiLCJfQXVkaWVuY2VTY2hlbWEiLCJfRXhwb3J0UHJvZ3Jlc3NTY2hlbWEiLCJWb2xhdGlsZUNsYXNzZXNTY2hlbWFzIiwiZGJUeXBlTWF0Y2hlc09iamVjdFR5cGUiLCJkYlR5cGUiLCJvYmplY3RUeXBlIiwidHlwZVRvU3RyaW5nIiwiU2NoZW1hQ29udHJvbGxlciIsImRhdGFiYXNlQWRhcHRlciIsInNjaGVtYUNhY2hlIiwiX2RiQWRhcHRlciIsIl9jYWNoZSIsInNjaGVtYURhdGEiLCJyZWxvYWREYXRhIiwib3B0aW9ucyIsImNsZWFyQ2FjaGUiLCJwcm9taXNlIiwiUHJvbWlzZSIsInJlc29sdmUiLCJ0aGVuIiwiY2xlYXIiLCJyZWxvYWREYXRhUHJvbWlzZSIsImdldEFsbENsYXNzZXMiLCJlcnIiLCJhbGxDbGFzc2VzIiwibWFwIiwic2V0QWxsQ2xhc3NlcyIsImdldE9uZVNjaGVtYSIsImFsbG93Vm9sYXRpbGVDbGFzc2VzIiwiY2FjaGVkIiwiZ2V0Q2xhc3MiLCJzZXRPbmVTY2hlbWEiLCJhZGRDbGFzc0lmTm90RXhpc3RzIiwidmFsaWRhdGlvbkVycm9yIiwidmFsaWRhdGVOZXdDbGFzcyIsInJlamVjdCIsImNyZWF0ZUNsYXNzIiwicmVzIiwiY2F0Y2giLCJlcnJvciIsImNvZGUiLCJEVVBMSUNBVEVfVkFMVUUiLCJ1cGRhdGVDbGFzcyIsInN1Ym1pdHRlZEZpZWxkcyIsImRhdGFiYXNlIiwiZXhpc3RpbmdGaWVsZHMiLCJmaWVsZCIsIl9fb3AiLCJuZXdTY2hlbWEiLCJidWlsZE1lcmdlZFNjaGVtYU9iamVjdCIsImRlZmF1bHRGaWVsZHMiLCJmdWxsTmV3U2NoZW1hIiwiYXNzaWduIiwidmFsaWRhdGVTY2hlbWFEYXRhIiwiZGVsZXRlZEZpZWxkcyIsImluc2VydGVkRmllbGRzIiwicHVzaCIsImRlbGV0ZVByb21pc2UiLCJkZWxldGVGaWVsZHMiLCJwcm9taXNlcyIsImVuZm9yY2VGaWVsZEV4aXN0cyIsImFsbCIsInNldFBlcm1pc3Npb25zIiwic2V0SW5kZXhlc1dpdGhTY2hlbWFGb3JtYXQiLCJyZWxvYWRlZFNjaGVtYSIsImVuZm9yY2VDbGFzc0V4aXN0cyIsImV4aXN0aW5nRmllbGROYW1lcyIsIklOVkFMSURfS0VZX05BTUUiLCJnZW9Qb2ludHMiLCJmaWx0ZXIiLCJzZXRDbGFzc0xldmVsUGVybWlzc2lvbnMiLCJzcGxpdCIsImV4cGVjdGVkVHlwZSIsImdldEV4cGVjdGVkVHlwZSIsImFkZEZpZWxkSWZOb3RFeGlzdHMiLCJkZWxldGVGaWVsZCIsImZpZWxkTmFtZXMiLCJzY2hlbWFGaWVsZHMiLCJhZGFwdGVyIiwiZGVsZXRlQ2xhc3MiLCJ2YWxpZGF0ZU9iamVjdCIsIm9iamVjdCIsImdlb2NvdW50IiwiZXhwZWN0ZWQiLCJnZXRUeXBlIiwidGhlblZhbGlkYXRlUmVxdWlyZWRDb2x1bW5zIiwidmFsaWRhdGVSZXF1aXJlZENvbHVtbnMiLCJjb2x1bW5zIiwibWlzc2luZ0NvbHVtbnMiLCJjb2x1bW4iLCJ0ZXN0UGVybWlzc2lvbnNGb3JDbGFzc05hbWUiLCJhY2xHcm91cCIsInRlc3RQZXJtaXNzaW9ucyIsImdldENsYXNzTGV2ZWxQZXJtaXNzaW9ucyIsImNsYXNzUGVybWlzc2lvbnMiLCJzb21lIiwiYWNsIiwidmFsaWRhdGVQZXJtaXNzaW9uIiwiT0JKRUNUX05PVF9GT1VORCIsInBlcm1pc3Npb25GaWVsZCIsIk9QRVJBVElPTl9GT1JCSURERU4iLCJoYXNDbGFzcyIsImxvYWQiLCJkYkFkYXB0ZXIiLCJwdXRSZXF1ZXN0Iiwic3lzU2NoZW1hRmllbGQiLCJfaWQiLCJvbGRGaWVsZCIsImZpZWxkSXNEZWxldGVkIiwibmV3RmllbGQiLCJzY2hlbWFQcm9taXNlIiwib2JqIiwiZ2V0T2JqZWN0VHlwZSIsIl9fdHlwZSIsImlzbyIsImxhdGl0dWRlIiwibG9uZ2l0dWRlIiwiYmFzZTY0IiwiY29vcmRpbmF0ZXMiLCJvYmplY3RzIiwib3BzIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7OztBQWtCQTs7QUFDQTs7Ozs7Ozs7OztBQWxCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLE1BQU1BLEtBQUssR0FBR0MsT0FBTyxDQUFDLFlBQUQsQ0FBUCxDQUFzQkQsS0FBcEM7O0FBV0EsTUFBTUUsY0FBMEMsR0FBR0MsTUFBTSxDQUFDQyxNQUFQLENBQWM7QUFDL0Q7QUFDQUMsRUFBQUEsUUFBUSxFQUFFO0FBQ1JDLElBQUFBLFFBQVEsRUFBRTtBQUFFQyxNQUFBQSxJQUFJLEVBQUU7QUFBUixLQURGO0FBRVJDLElBQUFBLFNBQVMsRUFBRTtBQUFFRCxNQUFBQSxJQUFJLEVBQUU7QUFBUixLQUZIO0FBR1JFLElBQUFBLFNBQVMsRUFBRTtBQUFFRixNQUFBQSxJQUFJLEVBQUU7QUFBUixLQUhIO0FBSVJHLElBQUFBLEdBQUcsRUFBRTtBQUFFSCxNQUFBQSxJQUFJLEVBQUU7QUFBUjtBQUpHLEdBRnFEO0FBUS9EO0FBQ0FJLEVBQUFBLEtBQUssRUFBRTtBQUNMQyxJQUFBQSxRQUFRLEVBQUU7QUFBRUwsTUFBQUEsSUFBSSxFQUFFO0FBQVIsS0FETDtBQUVMTSxJQUFBQSxRQUFRLEVBQUU7QUFBRU4sTUFBQUEsSUFBSSxFQUFFO0FBQVIsS0FGTDtBQUdMTyxJQUFB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VyxFQUFFeU8sR0FBRyxDQUFDUSxPQUFKLENBQVksQ0FBWixFQUFlbE07QUFGdkIsU0FBUDs7QUFJRixXQUFLLE9BQUw7QUFDRSxlQUFPMkwsYUFBYSxDQUFDRCxHQUFHLENBQUNTLEdBQUosQ0FBUSxDQUFSLENBQUQsQ0FBcEI7O0FBQ0Y7QUFDRSxjQUFNLG9CQUFvQlQsR0FBRyxDQUFDaEUsSUFBOUI7QUFsQko7QUFvQkQ7O0FBQ0QsU0FBTyxRQUFQO0FBQ0QiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAZmxvd1xuLy8gVGhpcyBjbGFzcyBoYW5kbGVzIHNjaGVtYSB2YWxpZGF0aW9uLCBwZXJzaXN0ZW5jZSwgYW5kIG1vZGlmaWNhdGlvbi5cbi8vXG4vLyBFYWNoIGluZGl2aWR1YWwgU2NoZW1hIG9iamVjdCBzaG91bGQgYmUgaW1tdXRhYmxlLiBUaGUgaGVscGVycyB0b1xuLy8gZG8gdGhpbmdzIHdpdGggdGhlIFNjaGVtYSBqdXN0IHJldHVybiBhIG5ldyBzY2hlbWEgd2hlbiB0aGUgc2NoZW1hXG4vLyBpcyBjaGFuZ2VkLlxuLy9cbi8vIFRoZSBjYW5vbmljYWwgcGxhY2UgdG8gc3RvcmUgdGhpcyBTY2hlbWEgaXMgaW4gdGhlIGRhdGFiYXNlIGl0c2VsZixcbi8vIGluIGEgX1NDSEVNQSBjb2xsZWN0aW9uLiBUaGlzIGlzIG5vdCB0aGUgcmlnaHQgd2F5IHRvIGRvIGl0IGZvciBhblxuLy8gb3BlbiBzb3VyY2UgZnJhbWV3b3JrLCBidXQgaXQncyBiYWNrd2FyZCBjb21wYXRpYmxlLCBzbyB3ZSdyZVxuLy8ga2VlcGluZyBpdCB0aGlzIHdheSBmb3Igbm93LlxuLy9cbi8vIEluIEFQSS1oYW5kbGluZyBjb2RlLCB5b3Ugc2hvdWxkIG9ubHkgdXNlIHRoZSBTY2hlbWEgY2xhc3MgdmlhIHRoZVxuLy8gRGF0YWJhc2VDb250cm9sbGVyLiBUaGlzIHdpbGwgbGV0IHVzIHJlcGxhY2UgdGhlIHNjaGVtYSBsb2dpYyBmb3Jcbi8vIGRpZmZlcmVudCBkYXRhYmFzZXMuXG4vLyBUT0RPOiBoaWRlIGFsbCBzY2hlbWEgbG9naWMgaW5zaWRlIHRoZSBkYXRhYmFzZSBhZGFwdGVyLlxuLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG5jb25zdCBQYXJzZSA9IHJlcXVpcmUoJ3BhcnNlL25vZGUnKS5QYXJzZTtcbmltcG9ydCB7IFN0b3JhZ2VBZGFwdGVyIH0gZnJvbSAnLi4vQWRhcHRlcnMvU3RvcmFnZS9TdG9yYWdlQWRhcHRlcic7XG5pbXBvcnQgRGF0YWJhc2VDb250cm9sbGVyIGZyb20gJy4vRGF0YWJhc2VDb250cm9sbGVyJztcbmltcG9ydCB0eXBlIHtcbiAgU2NoZW1hLFxuICBTY2hlbWFGaWVsZHMsXG4gIENsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgU2NoZW1hRmllbGQsXG4gIExvYWRTY2hlbWFPcHRpb25zLFxufSBmcm9tICcuL3R5cGVzJztcblxuY29uc3QgZGVmYXVsdENvbHVtbnM6IHsgW3N0cmluZ106IFNjaGVtYUZpZWxkcyB9ID0gT2JqZWN0LmZyZWV6ZSh7XG4gIC8vIENvbnRhaW4gdGhlIGRlZmF1bHQgY29sdW1ucyBmb3IgZXZlcnkgcGFyc2Ugb2JqZWN0IHR5cGUgKGV4Y2VwdCBfSm9pbiBjb2xsZWN0aW9uKVxuICBfRGVmYXVsdDoge1xuICAgIG9iamVjdElkOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgY3JlYXRlZEF0OiB7IHR5cGU6ICdEYXRlJyB9LFxuICAgIHVwZGF0ZWRBdDogeyB0eXBlOiAnRGF0ZScgfSxcbiAgICBBQ0w6IHsgdHlwZTogJ0FDTCcgfSxcbiAgfSxcbiAgLy8gVGhlIGFkZGl0aW9uYWwgZGVmYXVsdCBjb2x1bW5zIGZvciB0aGUgX1VzZXIgY29sbGVjdGlvbiAoaW4gYWRkaXRpb24gdG8gRGVmYXVsdENvbHMpXG4gIF9Vc2VyOiB7XG4gICAgdXNlcm5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBwYXNzd29yZDogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGVtYWlsOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgZW1haWxWZXJpZmllZDogeyB0eXBlOiAnQm9vbGVhbicgfSxcbiAgICBhdXRoRGF0YTogeyB0eXBlOiAnT2JqZWN0JyB9LFxuICB9LFxuICAvLyBUaGUgYWRkaXRpb25hbCBkZWZhdWx0IGNvbHVtbnMgZm9yIHRoZSBfSW5zdGFsbGF0aW9uIGNvbGxlY3Rpb24gKGluIGFkZGl0aW9uIHRvIERlZmF1bHRDb2xzKVxuICBfSW5zdGFsbGF0aW9uOiB7XG4gICAgaW5zdGFsbGF0aW9uSWQ6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBkZXZpY2VUb2tlbjogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGNoYW5uZWxzOiB7IHR5cGU6ICdBcnJheScgfSxcbiAgICBkZXZpY2VUeXBlOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgcHVzaFR5cGU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBHQ01TZW5kZXJJZDogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHRpbWVab25lOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgbG9jYWxlSWRlbnRpZmllcjogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGJhZGdlOiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gICAgYXBwVmVyc2lvbjogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGFwcE5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBhcHBJZGVudGlmaWVyOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgcGFyc2VWZXJzaW9uOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gIH0sXG4gIC8vIFRoZSBhZGRpdGlvbmFsIGRlZmF1bHQgY29sdW1ucyBmb3IgdGhlIF9Sb2xlIGNvbGxlY3Rpb24gKGluIGFkZGl0aW9uIHRvIERlZmF1bHRDb2xzKVxuICBfUm9sZToge1xuICAgIG5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICB1c2VyczogeyB0eXBlOiAnUmVsYXRpb24nLCB0YXJnZXRDbGFzczogJ19Vc2VyJyB9LFxuICAgIHJvbGVzOiB7IHR5cGU6ICdSZWxhdGlvbicsIHRhcmdldENsYXNzOiAnX1JvbGUnIH0sXG4gIH0sXG4gIC8vIFRoZSBhZGRpdGlvbmFsIGRlZmF1bHQgY29sdW1ucyBmb3IgdGhlIF9TZXNzaW9uIGNvbGxlY3Rpb24gKGluIGFkZGl0aW9uIHRvIERlZmF1bHRDb2xzKVxuICBfU2Vzc2lvbjoge1xuICAgIHJlc3RyaWN0ZWQ6IHsgdHlwZTogJ0Jvb2xlYW4nIH0sXG4gICAgdXNlcjogeyB0eXBlOiAnUG9pbnRlcicsIHRhcmdldENsYXNzOiAnX1VzZXInIH0sXG4gICAgaW5zdGFsbGF0aW9uSWQ6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBzZXNzaW9uVG9rZW46IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBleHBpcmVzQXQ6IHsgdHlwZTogJ0RhdGUnIH0sXG4gICAgY3JlYXRlZFdpdGg6IHsgdHlwZTogJ09iamVjdCcgfSxcbiAgfSxcbiAgX1Byb2R1Y3Q6IHtcbiAgICBwcm9kdWN0SWRlbnRpZmllcjogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGRvd25sb2FkOiB7IHR5cGU6ICdGaWxlJyB9LFxuICAgIGRvd25sb2FkTmFtZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGljb246IHsgdHlwZTogJ0ZpbGUnIH0sXG4gICAgb3JkZXI6IHsgdHlwZTogJ051bWJlcicgfSxcbiAgICB0aXRsZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHN1YnRpdGxlOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gIH0sXG4gIF9QdXNoU3RhdHVzOiB7XG4gICAgcHVzaFRpbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBzb3VyY2U6IHsgdHlwZTogJ1N0cmluZycgfSwgLy8gcmVzdCBvciB3ZWJ1aVxuICAgIHF1ZXJ5OiB7IHR5cGU6ICdTdHJpbmcnIH0sIC8vIHRoZSBzdHJpbmdpZmllZCBKU09OIHF1ZXJ5XG4gICAgcGF5bG9hZDogeyB0eXBlOiAnU3RyaW5nJyB9LCAvLyB0aGUgc3RyaW5naWZpZWQgSlNPTiBwYXlsb2FkLFxuICAgIHRpdGxlOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgZXhwaXJ5OiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gICAgZXhwaXJhdGlvbl9pbnRlcnZhbDogeyB0eXBlOiAnTnVtYmVyJyB9LFxuICAgIHN0YXR1czogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIG51bVNlbnQ6IHsgdHlwZTogJ051bWJlcicgfSxcbiAgICBudW1GYWlsZWQ6IHsgdHlwZTogJ051bWJlcicgfSxcbiAgICBwdXNoSGFzaDogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGVycm9yTWVzc2FnZTogeyB0eXBlOiAnT2JqZWN0JyB9LFxuICAgIHNlbnRQZXJUeXBlOiB7IHR5cGU6ICdPYmplY3QnIH0sXG4gICAgZmFpbGVkUGVyVHlwZTogeyB0eXBlOiAnT2JqZWN0JyB9LFxuICAgIHNlbnRQZXJVVENPZmZzZXQ6IHsgdHlwZTogJ09iamVjdCcgfSxcbiAgICBmYWlsZWRQZXJVVENPZmZzZXQ6IHsgdHlwZTogJ09iamVjdCcgfSxcbiAgICBjb3VudDogeyB0eXBlOiAnTnVtYmVyJyB9LCAvLyB0cmFja3MgIyBvZiBiYXRjaGVzIHF1ZXVlZCBhbmQgcGVuZGluZ1xuICB9LFxuICBfSm9iU3RhdHVzOiB7XG4gICAgam9iTmFtZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHNvdXJjZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHN0YXR1czogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIG1lc3NhZ2U6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBwYXJhbXM6IHsgdHlwZTogJ09iamVjdCcgfSwgLy8gcGFyYW1zIHJlY2VpdmVkIHdoZW4gY2FsbGluZyB0aGUgam9iXG4gICAgZmluaXNoZWRBdDogeyB0eXBlOiAnRGF0ZScgfSxcbiAgfSxcbiAgX0pvYlNjaGVkdWxlOiB7XG4gICAgam9iTmFtZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGRlc2NyaXB0aW9uOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgcGFyYW1zOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgc3RhcnRBZnRlcjogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGRheXNPZldlZWs6IHsgdHlwZTogJ0FycmF5JyB9LFxuICAgIHRpbWVPZkRheTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGxhc3RSdW46IHsgdHlwZTogJ051bWJlcicgfSxcbiAgICByZXBlYXRNaW51dGVzOiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gIH0sXG4gIF9Ib29rczoge1xuICAgIGZ1bmN0aW9uTmFtZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGNsYXNzTmFtZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHRyaWdnZXJOYW1lOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgdXJsOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gIH0sXG4gIF9HbG9iYWxDb25maWc6IHtcbiAgICBvYmplY3RJZDogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHBhcmFtczogeyB0eXBlOiAnT2JqZWN0JyB9LFxuICB9LFxuICBfQXVkaWVuY2U6IHtcbiAgICBvYmplY3RJZDogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIG5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBxdWVyeTogeyB0eXBlOiAnU3RyaW5nJyB9LCAvL3N0b3JpbmcgcXVlcnkgYXMgSlNPTiBzdHJpbmcgdG8gcHJldmVudCBcIk5lc3RlZCBrZXlzIHNob3VsZCBub3QgY29udGFpbiB0aGUgJyQnIG9yICcuJyBjaGFyYWN0ZXJzXCIgZXJyb3JcbiAgICBsYXN0VXNlZDogeyB0eXBlOiAnRGF0ZScgfSxcbiAgICB0aW1lc1VzZWQ6IHsgdHlwZTogJ051bWJlcicgfSxcbiAgfSxcbiAgX0V4cG9ydFByb2dyZXNzOiB7XG4gICAgYXBwSWQ6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBtYXN0ZXJLZXk6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgfSxcbn0pO1xuXG5jb25zdCByZXF1aXJlZENvbHVtbnMgPSBPYmplY3QuZnJlZXplKHtcbiAgX1Byb2R1Y3Q6IFsncHJvZHVjdElkZW50aWZpZXInLCAnaWNvbicsICdvcmRlcicsICd0aXRsZScsICdzdWJ0aXRsZSddLFxuICBfUm9sZTogWyduYW1lJywgJ0FDTCddLFxufSk7XG5cbmNvbnN0IHN5c3RlbUNsYXNzZXMgPSBPYmplY3QuZnJlZXplKFtcbiAgJ19Vc2VyJyxcbiAgJ19JbnN0YWxsYXRpb24nLFxuICAnX1JvbGUnLFxuICAnX1Nlc3Npb24nLFxuICAnX1Byb2R1Y3QnLFxuICAnX1B1c2hTdGF0dXMnLFxuICAnX0pvYlN0YXR1cycsXG4gICdfSm9iU2NoZWR1bGUnLFxuICAnX0F1ZGllbmNlJyxcbiAgJ19FeHBvcnRQcm9ncmVzcycsXG5dKTtcblxuY29uc3Qgdm9sYXRpbGVDbGFzc2VzID0gT2JqZWN0LmZyZWV6ZShbXG4gICdfSm9iU3RhdHVzJyxcbiAgJ19QdXNoU3RhdHVzJyxcbiAgJ19Ib29rcycsXG4gICdfR2xvYmFsQ29uZmlnJyxcbiAgJ19Kb2JTY2hlZHVsZScsXG4gICdfQXVkaWVuY2UnLFxuICAnX0V4cG9ydFByb2dyZXNzJyxcbl0pO1xuXG4vLyAxMCBhbHBoYSBudW1iZXJpYyBjaGFycyArIHVwcGVyY2FzZVxuY29uc3QgdXNlcklkUmVnZXggPSAvXlthLXpBLVowLTldezEwfSQvO1xuLy8gQW55dGhpbmcgdGhhdCBzdGFydCB3aXRoIHJvbGVcbmNvbnN0IHJvbGVSZWdleCA9IC9ecm9sZTouKi87XG4vLyAqIHBlcm1pc3Npb25cbmNvbnN0IHB1YmxpY1JlZ2V4ID0gL15cXCokLztcblxuY29uc3QgcmVxdWlyZUF1dGhlbnRpY2F0aW9uUmVnZXggPSAvXnJlcXVpcmVzQXV0aGVudGljYXRpb24kLztcblxuY29uc3QgcGVybWlzc2lvbktleVJlZ2V4ID0gT2JqZWN0LmZyZWV6ZShbXG4gIHVzZXJJZFJlZ2V4LFxuICByb2xlUmVnZXgsXG4gIHB1YmxpY1JlZ2V4LFxuICByZXF1aXJlQXV0aGVudGljYXRpb25SZWdleCxcbl0pO1xuXG5mdW5jdGlvbiB2ZXJpZnlQZXJtaXNzaW9uS2V5KGtleSkge1xuICBjb25zdCByZXN1bHQgPSBwZXJtaXNzaW9uS2V5UmVnZXgucmVkdWNlKChpc0dvb2QsIHJlZ0V4KSA9PiB7XG4gICAgaXNHb29kID0gaXNHb29kIHx8IGtleS5tYXRjaChyZWdFeCkgIT0gbnVsbDtcbiAgICByZXR1cm4gaXNHb29kO1xuICB9LCBmYWxzZSk7XG4gIGlmICghcmVzdWx0KSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgYCcke2tleX0nIGlzIG5vdCBhIHZhbGlkIGtleSBmb3IgY2xhc3MgbGV2ZWwgcGVybWlzc2lvbnNgXG4gICAgKTtcbiAgfVxufVxuXG5jb25zdCBDTFBWYWxpZEtleXMgPSBPYmplY3QuZnJlZXplKFtcbiAgJ2ZpbmQnLFxuICAnY291bnQnLFxuICAnZ2V0JyxcbiAgJ2NyZWF0ZScsXG4gICd1cGRhdGUnLFxuICAnZGVsZXRlJyxcbiAgJ2FkZEZpZWxkJyxcbiAgJ3JlYWRVc2VyRmllbGRzJyxcbiAgJ3dyaXRlVXNlckZpZWxkcycsXG5dKTtcbmZ1bmN0aW9uIHZhbGlkYXRlQ0xQKHBlcm1zOiBDbGFzc0xldmVsUGVybWlzc2lvbnMsIGZpZWxkczogU2NoZW1hRmllbGRzKSB7XG4gIGlmICghcGVybXMpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgT2JqZWN0LmtleXMocGVybXMpLmZvckVhY2gob3BlcmF0aW9uID0+IHtcbiAgICBpZiAoQ0xQVmFsaWRLZXlzLmluZGV4T2Yob3BlcmF0aW9uKSA9PSAtMSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgIGAke29wZXJhdGlvbn0gaXMgbm90IGEgdmFsaWQgb3BlcmF0aW9uIGZvciBjbGFzcyBsZXZlbCBwZXJtaXNzaW9uc2BcbiAgICAgICk7XG4gICAgfVxuICAgIGlmICghcGVybXNbb3BlcmF0aW9uXSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChvcGVyYXRpb24gPT09ICdyZWFkVXNlckZpZWxkcycgfHwgb3BlcmF0aW9uID09PSAnd3JpdGVVc2VyRmllbGRzJykge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHBlcm1zW29wZXJhdGlvbl0pKSB7XG4gICAgICAgIC8vIEBmbG93LWRpc2FibGUtbmV4dFxuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgIGAnJHtcbiAgICAgICAgICAgIHBlcm1zW29wZXJhdGlvbl1cbiAgICAgICAgICB9JyBpcyBub3QgYSB2YWxpZCB2YWx1ZSBmb3IgY2xhc3MgbGV2ZWwgcGVybWlzc2lvbnMgJHtvcGVyYXRpb259YFxuICAgICAgICApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcGVybXNbb3BlcmF0aW9uXS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgICAgaWYgKFxuICAgICAgICAgICAgIWZpZWxkc1trZXldIHx8XG4gICAgICAgICAgICBmaWVsZHNba2V5XS50eXBlICE9ICdQb2ludGVyJyB8fFxuICAgICAgICAgICAgZmllbGRzW2tleV0udGFyZ2V0Q2xhc3MgIT0gJ19Vc2VyJ1xuICAgICAgICAgICkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgICAgIGAnJHtrZXl9JyBpcyBub3QgYSB2YWxpZCBjb2x1bW4gZm9yIGNsYXNzIGxldmVsIHBvaW50ZXIgcGVybWlzc2lvbnMgJHtvcGVyYXRpb259YFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIEBmbG93LWRpc2FibGUtbmV4dFxuICAgIE9iamVjdC5rZXlzKHBlcm1zW29wZXJhdGlvbl0pLmZvckVhY2goa2V5ID0+IHtcbiAgICAgIHZlcmlmeVBlcm1pc3Npb25LZXkoa2V5KTtcbiAgICAgIC8vIEBmbG93LWRpc2FibGUtbmV4dFxuICAgICAgY29uc3QgcGVybSA9IHBlcm1zW29wZXJhdGlvbl1ba2V5XTtcbiAgICAgIGlmIChwZXJtICE9PSB0cnVlKSB7XG4gICAgICAgIC8vIEBmbG93LWRpc2FibGUtbmV4dFxuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgIGAnJHtwZXJtfScgaXMgbm90IGEgdmFsaWQgdmFsdWUgZm9yIGNsYXNzIGxldmVsIHBlcm1pc3Npb25zICR7b3BlcmF0aW9ufToke2tleX06JHtwZXJtfWBcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSk7XG59XG5jb25zdCBqb2luQ2xhc3NSZWdleCA9IC9eX0pvaW46W0EtWmEtejAtOV9dKzpbQS1aYS16MC05X10rLztcbmNvbnN0IGNsYXNzQW5kRmllbGRSZWdleCA9IC9eW0EtWmEtel1bQS1aYS16MC05X10qJC87XG5mdW5jdGlvbiBjbGFzc05hbWVJc1ZhbGlkKGNsYXNzTmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIC8vIFZhbGlkIGNsYXNzZXMgbXVzdDpcbiAgcmV0dXJuIChcbiAgICAvLyBCZSBvbmUgb2YgX1VzZXIsIF9JbnN0YWxsYXRpb24sIF9Sb2xlLCBfU2Vzc2lvbiBPUlxuICAgIHN5c3RlbUNsYXNzZXMuaW5kZXhPZihjbGFzc05hbWUpID4gLTEgfHxcbiAgICAvLyBCZSBhIGpvaW4gdGFibGUgT1JcbiAgICBqb2luQ2xhc3NSZWdleC50ZXN0KGNsYXNzTmFtZSkgfHxcbiAgICAvLyBJbmNsdWRlIG9ubHkgYWxwaGEtbnVtZXJpYyBhbmQgdW5kZXJzY29yZXMsIGFuZCBub3Qgc3RhcnQgd2l0aCBhbiB1bmRlcnNjb3JlIG9yIG51bWJlclxuICAgIGZpZWxkTmFtZUlzVmFsaWQoY2xhc3NOYW1lKVxuICApO1xufVxuXG4vLyBWYWxpZCBmaWVsZHMgbXVzdCBiZSBhbHBoYS1udW1lcmljLCBhbmQgbm90IHN0YXJ0IHdpdGggYW4gdW5kZXJzY29yZSBvciBudW1iZXJcbmZ1bmN0aW9uIGZpZWxkTmFtZUlzVmFsaWQoZmllbGROYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIGNsYXNzQW5kRmllbGRSZWdleC50ZXN0KGZpZWxkTmFtZSk7XG59XG5cbi8vIENoZWNrcyB0aGF0IGl0J3Mgbm90IHRyeWluZyB0byBjbG9iYmVyIG9uZSBvZiB0aGUgZGVmYXVsdCBmaWVsZHMgb2YgdGhlIGNsYXNzLlxuZnVuY3Rpb24gZmllbGROYW1lSXNWYWxpZEZvckNsYXNzKFxuICBmaWVsZE5hbWU6IHN0cmluZyxcbiAgY2xhc3NOYW1lOiBzdHJpbmdcbik6IGJvb2xlYW4ge1xuICBpZiAoIWZpZWxkTmFtZUlzVmFsaWQoZmllbGROYW1lKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAoZGVmYXVsdENvbHVtbnMuX0RlZmF1bHRbZmllbGROYW1lXSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAoZGVmYXVsdENvbHVtbnNbY2xhc3NOYW1lXSAmJiBkZWZhdWx0Q29sdW1uc1tjbGFzc05hbWVdW2ZpZWxkTmFtZV0pIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgcmV0dXJuIHRydWU7XG59XG5cbmZ1bmN0aW9uIGludmFsaWRDbGFzc05hbWVNZXNzYWdlKGNsYXNzTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIChcbiAgICAnSW52YWxpZCBjbGFzc25hbWU6ICcgK1xuICAgIGNsYXNzTmFtZSArXG4gICAgJywgY2xhc3NuYW1lcyBjYW4gb25seSBoYXZlIGFscGhhbnVtZXJpYyBjaGFyYWN0ZXJzIGFuZCBfLCBhbmQgbXVzdCBzdGFydCB3aXRoIGFuIGFscGhhIGNoYXJhY3RlciAnXG4gICk7XG59XG5cbmNvbnN0IGludmFsaWRKc29uRXJyb3IgPSBuZXcgUGFyc2UuRXJyb3IoXG4gIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgJ2ludmFsaWQgSlNPTidcbik7XG5jb25zdCB2YWxpZE5vblJlbGF0aW9uT3JQb2ludGVyVHlwZXMgPSBbXG4gICdOdW1iZXInLFxuICAnU3RyaW5nJyxcbiAgJ0Jvb2xlYW4nLFxuICAnRGF0ZScsXG4gICdPYmplY3QnLFxuICAnQXJyYXknLFxuICAnR2VvUG9pbnQnLFxuICAnRmlsZScsXG4gICdCeXRlcycsXG4gICdQb2x5Z29uJyxcbl07XG4vLyBSZXR1cm5zIGFuIGVycm9yIHN1aXRhYmxlIGZvciB0aHJvd2luZyBpZiB0aGUgdHlwZSBpcyBpbnZhbGlkXG5jb25zdCBmaWVsZFR5cGVJc0ludmFsaWQgPSAoeyB0eXBlLCB0YXJnZXRDbGFzcyB9KSA9PiB7XG4gIGlmIChbJ1BvaW50ZXInLCAnUmVsYXRpb24nXS5pbmRleE9mKHR5cGUpID49IDApIHtcbiAgICBpZiAoIXRhcmdldENsYXNzKSB7XG4gICAgICByZXR1cm4gbmV3IFBhcnNlLkVycm9yKDEzNSwgYHR5cGUgJHt0eXBlfSBuZWVkcyBhIGNsYXNzIG5hbWVgKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiB0YXJnZXRDbGFzcyAhPT0gJ3N0cmluZycpIHtcbiAgICAgIHJldHVybiBpbnZhbGlkSnNvbkVycm9yO1xuICAgIH0gZWxzZSBpZiAoIWNsYXNzTmFtZUlzVmFsaWQodGFyZ2V0Q2xhc3MpKSB7XG4gICAgICByZXR1cm4gbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0NMQVNTX05BTUUsXG4gICAgICAgIGludmFsaWRDbGFzc05hbWVNZXNzYWdlKHRhcmdldENsYXNzKVxuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gIH1cbiAgaWYgKHR5cGVvZiB0eXBlICE9PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBpbnZhbGlkSnNvbkVycm9yO1xuICB9XG4gIGlmICh2YWxpZE5vblJlbGF0aW9uT3JQb2ludGVyVHlwZXMuaW5kZXhPZih0eXBlKSA8IDApIHtcbiAgICByZXR1cm4gbmV3IFBhcnNlLkVycm9yKFxuICAgICAgUGFyc2UuRXJyb3IuSU5DT1JSRUNUX1RZUEUsXG4gICAgICBgaW52YWxpZCBmaWVsZCB0eXBlOiAke3R5cGV9YFxuICAgICk7XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn07XG5cbmNvbnN0IGNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEgPSAoc2NoZW1hOiBhbnkpID0+IHtcbiAgc2NoZW1hID0gaW5qZWN0RGVmYXVsdFNjaGVtYShzY2hlbWEpO1xuICBkZWxldGUgc2NoZW1hLmZpZWxkcy5BQ0w7XG4gIHNjaGVtYS5maWVsZHMuX3JwZXJtID0geyB0eXBlOiAnQXJyYXknIH07XG4gIHNjaGVtYS5maWVsZHMuX3dwZXJtID0geyB0eXBlOiAnQXJyYXknIH07XG5cbiAgaWYgKHNjaGVtYS5jbGFzc05hbWUgPT09ICdfVXNlcicpIHtcbiAgICBkZWxldGUgc2NoZW1hLmZpZWxkcy5wYXNzd29yZDtcbiAgICBzY2hlbWEuZmllbGRzLl9oYXNoZWRfcGFzc3dvcmQgPSB7IHR5cGU6ICdTdHJpbmcnIH07XG4gIH1cblxuICByZXR1cm4gc2NoZW1hO1xufTtcblxuY29uc3QgY29udmVydEFkYXB0ZXJTY2hlbWFUb1BhcnNlU2NoZW1hID0gKHsgLi4uc2NoZW1hIH0pID0+IHtcbiAgZGVsZXRlIHNjaGVtYS5maWVsZHMuX3JwZXJtO1xuICBkZWxldGUgc2NoZW1hLmZpZWxkcy5fd3Blcm07XG5cbiAgc2NoZW1hLmZpZWxkcy5BQ0wgPSB7IHR5cGU6ICdBQ0wnIH07XG5cbiAgaWYgKHNjaGVtYS5jbGFzc05hbWUgPT09ICdfVXNlcicpIHtcbiAgICBkZWxldGUgc2NoZW1hLmZpZWxkcy5hdXRoRGF0YTsgLy9BdXRoIGRhdGEgaXMgaW1wbGljaXRcbiAgICBkZWxldGUgc2NoZW1hLmZpZWxkcy5faGFzaGVkX3Bhc3N3b3JkO1xuICAgIHNjaGVtYS5maWVsZHMucGFzc3dvcmQgPSB7IHR5cGU6ICdTdHJpbmcnIH07XG4gIH1cblxuICBpZiAoc2NoZW1hLmluZGV4ZXMgJiYgT2JqZWN0LmtleXMoc2NoZW1hLmluZGV4ZXMpLmxlbmd0aCA9PT0gMCkge1xuICAgIGRlbGV0ZSBzY2hlbWEuaW5kZXhlcztcbiAgfVxuXG4gIHJldHVybiBzY2hlbWE7XG59O1xuXG5jbGFzcyBTY2hlbWFEYXRhIHtcbiAgX19kYXRhOiBhbnk7XG4gIGNvbnN0cnVjdG9yKGFsbFNjaGVtYXMgPSBbXSkge1xuICAgIHRoaXMuX19kYXRhID0ge307XG4gICAgYWxsU2NoZW1hcy5mb3JFYWNoKHNjaGVtYSA9PiB7XG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgc2NoZW1hLmNsYXNzTmFtZSwge1xuICAgICAgICBnZXQ6ICgpID0+IHtcbiAgICAgICAgICBpZiAoIXRoaXMuX19kYXRhW3NjaGVtYS5jbGFzc05hbWVdKSB7XG4gICAgICAgICAgICBjb25zdCBkYXRhID0ge307XG4gICAgICAgICAgICBkYXRhLmZpZWxkcyA9IGluamVjdERlZmF1bHRTY2hlbWEoc2NoZW1hKS5maWVsZHM7XG4gICAgICAgICAgICBkYXRhLmNsYXNzTGV2ZWxQZXJtaXNzaW9ucyA9IHNjaGVtYS5jbGFzc0xldmVsUGVybWlzc2lvbnM7XG4gICAgICAgICAgICBkYXRhLmluZGV4ZXMgPSBzY2hlbWEuaW5kZXhlcztcbiAgICAgICAgICAgIHRoaXMuX19kYXRhW3NjaGVtYS5jbGFzc05hbWVdID0gZGF0YTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHRoaXMuX19kYXRhW3NjaGVtYS5jbGFzc05hbWVdO1xuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBJbmplY3QgdGhlIGluLW1lbW9yeSBjbGFzc2VzXG4gICAgdm9sYXRpbGVDbGFzc2VzLmZvckVhY2goY2xhc3NOYW1lID0+IHtcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0aGlzLCBjbGFzc05hbWUsIHtcbiAgICAgICAgZ2V0OiAoKSA9PiB7XG4gICAgICAgICAgaWYgKCF0aGlzLl9fZGF0YVtjbGFzc05hbWVdKSB7XG4gICAgICAgICAgICBjb25zdCBzY2hlbWEgPSBpbmplY3REZWZhdWx0U2NoZW1hKHtcbiAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICBmaWVsZHM6IHt9LFxuICAgICAgICAgICAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IHt9LFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBjb25zdCBkYXRhID0ge307XG4gICAgICAgICAgICBkYXRhLmZpZWxkcyA9IHNjaGVtYS5maWVsZHM7XG4gICAgICAgICAgICBkYXRhLmNsYXNzTGV2ZWxQZXJtaXNzaW9ucyA9IHNjaGVtYS5jbGFzc0xldmVsUGVybWlzc2lvbnM7XG4gICAgICAgICAgICBkYXRhLmluZGV4ZXMgPSBzY2hlbWEuaW5kZXhlcztcbiAgICAgICAgICAgIHRoaXMuX19kYXRhW2NsYXNzTmFtZV0gPSBkYXRhO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gdGhpcy5fX2RhdGFbY2xhc3NOYW1lXTtcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG59XG5cbmNvbnN0IGluamVjdERlZmF1bHRTY2hlbWEgPSAoe1xuICBjbGFzc05hbWUsXG4gIGZpZWxkcyxcbiAgY2xhc3NMZXZlbFBlcm1pc3Npb25zLFxuICBpbmRleGVzLFxufTogU2NoZW1hKSA9PiB7XG4gIGNvbnN0IGRlZmF1bHRTY2hlbWE6IFNjaGVtYSA9IHtcbiAgICBjbGFzc05hbWUsXG4gICAgZmllbGRzOiB7XG4gICAgICAuLi5kZWZhdWx0Q29sdW1ucy5fRGVmYXVsdCxcbiAgICAgIC4uLihkZWZhdWx0Q29sdW1uc1tjbGFzc05hbWVdIHx8IHt9KSxcbiAgICAgIC4uLmZpZWxkcyxcbiAgICB9LFxuICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgfTtcbiAgaWYgKGluZGV4ZXMgJiYgT2JqZWN0LmtleXMoaW5kZXhlcykubGVuZ3RoICE9PSAwKSB7XG4gICAgZGVmYXVsdFNjaGVtYS5pbmRleGVzID0gaW5kZXhlcztcbiAgfVxuICByZXR1cm4gZGVmYXVsdFNjaGVtYTtcbn07XG5cbmNvbnN0IF9Ib29rc1NjaGVtYSA9IHsgY2xhc3NOYW1lOiAnX0hvb2tzJywgZmllbGRzOiBkZWZhdWx0Q29sdW1ucy5fSG9va3MgfTtcbmNvbnN0IF9HbG9iYWxDb25maWdTY2hlbWEgPSB7XG4gIGNsYXNzTmFtZTogJ19HbG9iYWxDb25maWcnLFxuICBmaWVsZHM6IGRlZmF1bHRDb2x1bW5zLl9HbG9iYWxDb25maWcsXG59O1xuY29uc3QgX1B1c2hTdGF0dXNTY2hlbWEgPSBjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hKFxuICBpbmplY3REZWZhdWx0U2NoZW1hKHtcbiAgICBjbGFzc05hbWU6ICdfUHVzaFN0YXR1cycsXG4gICAgZmllbGRzOiB7fSxcbiAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IHt9LFxuICB9KVxuKTtcbmNvbnN0IF9Kb2JTdGF0dXNTY2hlbWEgPSBjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hKFxuICBpbmplY3REZWZhdWx0U2NoZW1hKHtcbiAgICBjbGFzc05hbWU6ICdfSm9iU3RhdHVzJyxcbiAgICBmaWVsZHM6IHt9LFxuICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczoge30sXG4gIH0pXG4pO1xuY29uc3QgX0pvYlNjaGVkdWxlU2NoZW1hID0gY29udmVydFNjaGVtYVRvQWRhcHRlclNjaGVtYShcbiAgaW5qZWN0RGVmYXVsdFNjaGVtYSh7XG4gICAgY2xhc3NOYW1lOiAnX0pvYlNjaGVkdWxlJyxcbiAgICBmaWVsZHM6IHt9LFxuICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczoge30sXG4gIH0pXG4pO1xuY29uc3QgX0F1ZGllbmNlU2NoZW1hID0gY29udmVydFNjaGVtYVRvQWRhcHRlclNjaGVtYShcbiAgaW5qZWN0RGVmYXVsdFNjaGVtYSh7XG4gICAgY2xhc3NOYW1lOiAnX0F1ZGllbmNlJyxcbiAgICBmaWVsZHM6IGRlZmF1bHRDb2x1bW5zLl9BdWRpZW5jZSxcbiAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IHt9LFxuICB9KVxuKTtcbmNvbnN0IF9FeHBvcnRQcm9ncmVzc1NjaGVtYSA9IGNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEoXG4gIGluamVjdERlZmF1bHRTY2hlbWEoe1xuICAgIGNsYXNzTmFtZTogJ19FeHBvcnRQcm9ncmVzcycsXG4gICAgZmllbGRzOiBkZWZhdWx0Q29sdW1ucy5fRXhwb3J0UHJvZ3Jlc3MsXG4gICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiB7fSxcbiAgfSlcbik7XG5jb25zdCBWb2xhdGlsZUNsYXNzZXNTY2hlbWFzID0gW1xuICBfSG9va3NTY2hlbWEsXG4gIF9Kb2JTdGF0dXNTY2hlbWEsXG4gIF9Kb2JTY2hlZHVsZVNjaGVtYSxcbiAgX1B1c2hTdGF0dXNTY2hlbWEsXG4gIF9HbG9iYWxDb25maWdTY2hlbWEsXG4gIF9BdWRpZW5jZVNjaGVtYSxcbiAgX0V4cG9ydFByb2dyZXNzU2NoZW1hLFxuXTtcblxuY29uc3QgZGJUeXBlTWF0Y2hlc09iamVjdFR5cGUgPSAoXG4gIGRiVHlwZTogU2NoZW1hRmllbGQgfCBzdHJpbmcsXG4gIG9iamVjdFR5cGU6IFNjaGVtYUZpZWxkXG4pID0+IHtcbiAgaWYgKGRiVHlwZS50eXBlICE9PSBvYmplY3RUeXBlLnR5cGUpIHJldHVybiBmYWxzZTtcbiAgaWYgKGRiVHlwZS50YXJnZXRDbGFzcyAhPT0gb2JqZWN0VHlwZS50YXJnZXRDbGFzcykgcmV0dXJuIGZhbHNlO1xuICBpZiAoZGJUeXBlID09PSBvYmplY3RUeXBlLnR5cGUpIHJldHVybiB0cnVlO1xuICBpZiAoZGJUeXBlLnR5cGUgPT09IG9iamVjdFR5cGUudHlwZSkgcmV0dXJuIHRydWU7XG4gIHJldHVybiBmYWxzZTtcbn07XG5cbmNvbnN0IHR5cGVUb1N0cmluZyA9ICh0eXBlOiBTY2hlbWFGaWVsZCB8IHN0cmluZyk6IHN0cmluZyA9PiB7XG4gIGlmICh0eXBlb2YgdHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gdHlwZTtcbiAgfVxuICBpZiAodHlwZS50YXJnZXRDbGFzcykge1xuICAgIHJldHVybiBgJHt0eXBlLnR5cGV9PCR7dHlwZS50YXJnZXRDbGFzc30+YDtcbiAgfVxuICByZXR1cm4gYCR7dHlwZS50eXBlfWA7XG59O1xuXG4vLyBTdG9yZXMgdGhlIGVudGlyZSBzY2hlbWEgb2YgdGhlIGFwcCBpbiBhIHdlaXJkIGh5YnJpZCBmb3JtYXQgc29tZXdoZXJlIGJldHdlZW5cbi8vIHRoZSBtb25nbyBmb3JtYXQgYW5kIHRoZSBQYXJzZSBmb3JtYXQuIFNvb24sIHRoaXMgd2lsbCBhbGwgYmUgUGFyc2UgZm9ybWF0LlxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgU2NoZW1hQ29udHJvbGxlciB7XG4gIF9kYkFkYXB0ZXI6IFN0b3JhZ2VBZGFwdGVyO1xuICBzY2hlbWFEYXRhOiB7IFtzdHJpbmddOiBTY2hlbWEgfTtcbiAgX2NhY2hlOiBhbnk7XG4gIHJlbG9hZERhdGFQcm9taXNlOiBQcm9taXNlPGFueT47XG5cbiAgY29uc3RydWN0b3IoZGF0YWJhc2VBZGFwdGVyOiBTdG9yYWdlQWRhcHRlciwgc2NoZW1hQ2FjaGU6IGFueSkge1xuICAgIHRoaXMuX2RiQWRhcHRlciA9IGRhdGFiYXNlQWRhcHRlcjtcbiAgICB0aGlzLl9jYWNoZSA9IHNjaGVtYUNhY2hlO1xuICAgIHRoaXMuc2NoZW1hRGF0YSA9IG5ldyBTY2hlbWFEYXRhKCk7XG4gIH1cblxuICByZWxvYWREYXRhKG9wdGlvbnM6IExvYWRTY2hlbWFPcHRpb25zID0geyBjbGVhckNhY2hlOiBmYWxzZSB9KTogUHJvbWlzZTxhbnk+IHtcbiAgICBsZXQgcHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xuICAgIGlmIChvcHRpb25zLmNsZWFyQ2FjaGUpIHtcbiAgICAgIHByb21pc2UgPSBwcm9taXNlLnRoZW4oKCkgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5fY2FjaGUuY2xlYXIoKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICBpZiAodGhpcy5yZWxvYWREYXRhUHJvbWlzZSAmJiAhb3B0aW9ucy5jbGVhckNhY2hlKSB7XG4gICAgICByZXR1cm4gdGhpcy5yZWxvYWREYXRhUHJvbWlzZTtcbiAgICB9XG4gICAgdGhpcy5yZWxvYWREYXRhUHJvbWlzZSA9IHByb21pc2VcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0QWxsQ2xhc3NlcyhvcHRpb25zKS50aGVuKFxuICAgICAgICAgIGFsbFNjaGVtYXMgPT4ge1xuICAgICAgICAgICAgdGhpcy5zY2hlbWFEYXRhID0gbmV3IFNjaGVtYURhdGEoYWxsU2NoZW1hcyk7XG4gICAgICAgICAgICBkZWxldGUgdGhpcy5yZWxvYWREYXRhUHJvbWlzZTtcbiAgICAgICAgICB9LFxuICAgICAgICAgIGVyciA9PiB7XG4gICAgICAgICAgICB0aGlzLnNjaGVtYURhdGEgPSBuZXcgU2NoZW1hRGF0YSgpO1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMucmVsb2FkRGF0YVByb21pc2U7XG4gICAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgICAgfVxuICAgICAgICApO1xuICAgICAgfSlcbiAgICAgIC50aGVuKCgpID0+IHt9KTtcbiAgICByZXR1cm4gdGhpcy5yZWxvYWREYXRhUHJvbWlzZTtcbiAgfVxuXG4gIGdldEFsbENsYXNzZXMoXG4gICAgb3B0aW9uczogTG9hZFNjaGVtYU9wdGlvbnMgPSB7IGNsZWFyQ2FjaGU6IGZhbHNlIH1cbiAgKTogUHJvbWlzZTxBcnJheTxTY2hlbWE+PiB7XG4gICAgbGV0IHByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKTtcbiAgICBpZiAob3B0aW9ucy5jbGVhckNhY2hlKSB7XG4gICAgICBwcm9taXNlID0gdGhpcy5fY2FjaGUuY2xlYXIoKTtcbiAgICB9XG4gICAgcmV0dXJuIHByb21pc2VcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2NhY2hlLmdldEFsbENsYXNzZXMoKTtcbiAgICAgIH0pXG4gICAgICAudGhlbihhbGxDbGFzc2VzID0+IHtcbiAgICAgICAgaWYgKGFsbENsYXNzZXMgJiYgYWxsQ2xhc3Nlcy5sZW5ndGggJiYgIW9wdGlvbnMuY2xlYXJDYWNoZSkge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoYWxsQ2xhc3Nlcyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX2RiQWRhcHRlclxuICAgICAgICAgIC5nZXRBbGxDbGFzc2VzKClcbiAgICAgICAgICAudGhlbihhbGxTY2hlbWFzID0+IGFsbFNjaGVtYXMubWFwKGluamVjdERlZmF1bHRTY2hlbWEpKVxuICAgICAgICAgIC50aGVuKGFsbFNjaGVtYXMgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2NhY2hlLnNldEFsbENsYXNzZXMoYWxsU2NoZW1hcykudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgIHJldHVybiBhbGxTY2hlbWFzO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgfVxuXG4gIGdldE9uZVNjaGVtYShcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBhbGxvd1ZvbGF0aWxlQ2xhc3NlczogYm9vbGVhbiA9IGZhbHNlLFxuICAgIG9wdGlvbnM6IExvYWRTY2hlbWFPcHRpb25zID0geyBjbGVhckNhY2hlOiBmYWxzZSB9XG4gICk6IFByb21pc2U8U2NoZW1hPiB7XG4gICAgbGV0IHByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKTtcbiAgICBpZiAob3B0aW9ucy5jbGVhckNhY2hlKSB7XG4gICAgICBwcm9taXNlID0gdGhpcy5fY2FjaGUuY2xlYXIoKTtcbiAgICB9XG4gICAgcmV0dXJuIHByb21pc2UudGhlbigoKSA9PiB7XG4gICAgICBpZiAoYWxsb3dWb2xhdGlsZUNsYXNzZXMgJiYgdm9sYXRpbGVDbGFzc2VzLmluZGV4T2YoY2xhc3NOYW1lKSA+IC0xKSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSB0aGlzLnNjaGVtYURhdGFbY2xhc3NOYW1lXTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7XG4gICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgIGZpZWxkczogZGF0YS5maWVsZHMsXG4gICAgICAgICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiBkYXRhLmNsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgICAgICAgICBpbmRleGVzOiBkYXRhLmluZGV4ZXMsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXMuX2NhY2hlLmdldE9uZVNjaGVtYShjbGFzc05hbWUpLnRoZW4oY2FjaGVkID0+IHtcbiAgICAgICAgaWYgKGNhY2hlZCAmJiAhb3B0aW9ucy5jbGVhckNhY2hlKSB7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShjYWNoZWQpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9kYkFkYXB0ZXJcbiAgICAgICAgICAuZ2V0Q2xhc3MoY2xhc3NOYW1lKVxuICAgICAgICAgIC50aGVuKGluamVjdERlZmF1bHRTY2hlbWEpXG4gICAgICAgICAgLnRoZW4ocmVzdWx0ID0+IHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9jYWNoZS5zZXRPbmVTY2hlbWEoY2xhc3NOYW1lLCByZXN1bHQpLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIENyZWF0ZSBhIG5ldyBjbGFzcyB0aGF0IGluY2x1ZGVzIHRoZSB0aHJlZSBkZWZhdWx0IGZpZWxkcy5cbiAgLy8gQUNMIGlzIGFuIGltcGxpY2l0IGNvbHVtbiB0aGF0IGRvZXMgbm90IGdldCBhbiBlbnRyeSBpbiB0aGVcbiAgLy8gX1NDSEVNQVMgZGF0YWJhc2UuIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2l0aCB0aGVcbiAgLy8gY3JlYXRlZCBzY2hlbWEsIGluIG1vbmdvIGZvcm1hdC5cbiAgLy8gb24gc3VjY2VzcywgYW5kIHJlamVjdHMgd2l0aCBhbiBlcnJvciBvbiBmYWlsLiBFbnN1cmUgeW91XG4gIC8vIGhhdmUgYXV0aG9yaXphdGlvbiAobWFzdGVyIGtleSwgb3IgY2xpZW50IGNsYXNzIGNyZWF0aW9uXG4gIC8vIGVuYWJsZWQpIGJlZm9yZSBjYWxsaW5nIHRoaXMgZnVuY3Rpb24uXG4gIGFkZENsYXNzSWZOb3RFeGlzdHMoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgZmllbGRzOiBTY2hlbWFGaWVsZHMgPSB7fSxcbiAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IGFueSxcbiAgICBpbmRleGVzOiBhbnkgPSB7fVxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB2YXIgdmFsaWRhdGlvbkVycm9yID0gdGhpcy52YWxpZGF0ZU5ld0NsYXNzKFxuICAgICAgY2xhc3NOYW1lLFxuICAgICAgZmllbGRzLFxuICAgICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zXG4gICAgKTtcbiAgICBpZiAodmFsaWRhdGlvbkVycm9yKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QodmFsaWRhdGlvbkVycm9yKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fZGJBZGFwdGVyXG4gICAgICAuY3JlYXRlQ2xhc3MoXG4gICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgY29udmVydFNjaGVtYVRvQWRhcHRlclNjaGVtYSh7XG4gICAgICAgICAgZmllbGRzLFxuICAgICAgICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgICAgICAgICBpbmRleGVzLFxuICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgfSlcbiAgICAgIClcbiAgICAgIC50aGVuKGNvbnZlcnRBZGFwdGVyU2NoZW1hVG9QYXJzZVNjaGVtYSlcbiAgICAgIC50aGVuKHJlcyA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLl9jYWNoZS5jbGVhcigpLnRoZW4oKCkgPT4ge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUocmVzKTtcbiAgICAgICAgfSk7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKGVycm9yICYmIGVycm9yLmNvZGUgPT09IFBhcnNlLkVycm9yLkRVUExJQ0FURV9WQUxVRSkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfQ0xBU1NfTkFNRSxcbiAgICAgICAgICAgIGBDbGFzcyAke2NsYXNzTmFtZX0gYWxyZWFkeSBleGlzdHMuYFxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9XG5cbiAgdXBkYXRlQ2xhc3MoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgc3VibWl0dGVkRmllbGRzOiBTY2hlbWFGaWVsZHMsXG4gICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiBhbnksXG4gICAgaW5kZXhlczogYW55LFxuICAgIGRhdGFiYXNlOiBEYXRhYmFzZUNvbnRyb2xsZXJcbiAgKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0T25lU2NoZW1hKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKHNjaGVtYSA9PiB7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nRmllbGRzID0gc2NoZW1hLmZpZWxkcztcbiAgICAgICAgT2JqZWN0LmtleXMoc3VibWl0dGVkRmllbGRzKS5mb3JFYWNoKG5hbWUgPT4ge1xuICAgICAgICAgIGNvbnN0IGZpZWxkID0gc3VibWl0dGVkRmllbGRzW25hbWVdO1xuICAgICAgICAgIGlmIChleGlzdGluZ0ZpZWxkc1tuYW1lXSAmJiBmaWVsZC5fX29wICE9PSAnRGVsZXRlJykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDI1NSwgYEZpZWxkICR7bmFtZX0gZXhpc3RzLCBjYW5ub3QgdXBkYXRlLmApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoIWV4aXN0aW5nRmllbGRzW25hbWVdICYmIGZpZWxkLl9fb3AgPT09ICdEZWxldGUnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgIDI1NSxcbiAgICAgICAgICAgICAgYEZpZWxkICR7bmFtZX0gZG9lcyBub3QgZXhpc3QsIGNhbm5vdCBkZWxldGUuYFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGRlbGV0ZSBleGlzdGluZ0ZpZWxkcy5fcnBlcm07XG4gICAgICAgIGRlbGV0ZSBleGlzdGluZ0ZpZWxkcy5fd3Blcm07XG4gICAgICAgIGNvbnN0IG5ld1NjaGVtYSA9IGJ1aWxkTWVyZ2VkU2NoZW1hT2JqZWN0KFxuICAgICAgICAgIGV4aXN0aW5nRmllbGRzLFxuICAgICAgICAgIHN1Ym1pdHRlZEZpZWxkc1xuICAgICAgICApO1xuICAgICAgICBjb25zdCBkZWZhdWx0RmllbGRzID1cbiAgICAgICAgICBkZWZhdWx0Q29sdW1uc1tjbGFzc05hbWVdIHx8IGRlZmF1bHRDb2x1bW5zLl9EZWZhdWx0O1xuICAgICAgICBjb25zdCBmdWxsTmV3U2NoZW1hID0gT2JqZWN0LmFzc2lnbih7fSwgbmV3U2NoZW1hLCBkZWZhdWx0RmllbGRzKTtcbiAgICAgICAgY29uc3QgdmFsaWRhdGlvbkVycm9yID0gdGhpcy52YWxpZGF0ZVNjaGVtYURhdGEoXG4gICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgIG5ld1NjaGVtYSxcbiAgICAgICAgICBjbGFzc0xldmVsUGVybWlzc2lvbnMsXG4gICAgICAgICAgT2JqZWN0LmtleXMoZXhpc3RpbmdGaWVsZHMpXG4gICAgICAgICk7XG4gICAgICAgIGlmICh2YWxpZGF0aW9uRXJyb3IpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IodmFsaWRhdGlvbkVycm9yLmNvZGUsIHZhbGlkYXRpb25FcnJvci5lcnJvcik7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGaW5hbGx5IHdlIGhhdmUgY2hlY2tlZCB0byBtYWtlIHN1cmUgdGhlIHJlcXVlc3QgaXMgdmFsaWQgYW5kIHdlIGNhbiBzdGFydCBkZWxldGluZyBmaWVsZHMuXG4gICAgICAgIC8vIERvIGFsbCBkZWxldGlvbnMgZmlyc3QsIHRoZW4gYSBzaW5nbGUgc2F2ZSB0byBfU0NIRU1BIGNvbGxlY3Rpb24gdG8gaGFuZGxlIGFsbCBhZGRpdGlvbnMuXG4gICAgICAgIGNvbnN0IGRlbGV0ZWRGaWVsZHM6IHN0cmluZ1tdID0gW107XG4gICAgICAgIGNvbnN0IGluc2VydGVkRmllbGRzID0gW107XG4gICAgICAgIE9iamVjdC5rZXlzKHN1Ym1pdHRlZEZpZWxkcykuZm9yRWFjaChmaWVsZE5hbWUgPT4ge1xuICAgICAgICAgIGlmIChzdWJtaXR0ZWRGaWVsZHNbZmllbGROYW1lXS5fX29wID09PSAnRGVsZXRlJykge1xuICAgICAgICAgICAgZGVsZXRlZEZpZWxkcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGluc2VydGVkRmllbGRzLnB1c2goZmllbGROYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGxldCBkZWxldGVQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgIGlmIChkZWxldGVkRmllbGRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBkZWxldGVQcm9taXNlID0gdGhpcy5kZWxldGVGaWVsZHMoZGVsZXRlZEZpZWxkcywgY2xhc3NOYW1lLCBkYXRhYmFzZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICBkZWxldGVQcm9taXNlIC8vIERlbGV0ZSBFdmVyeXRoaW5nXG4gICAgICAgICAgICAudGhlbigoKSA9PiB0aGlzLnJlbG9hZERhdGEoeyBjbGVhckNhY2hlOiB0cnVlIH0pKSAvLyBSZWxvYWQgb3VyIFNjaGVtYSwgc28gd2UgaGF2ZSBhbGwgdGhlIG5ldyB2YWx1ZXNcbiAgICAgICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgcHJvbWlzZXMgPSBpbnNlcnRlZEZpZWxkcy5tYXAoZmllbGROYW1lID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCB0eXBlID0gc3VibWl0dGVkRmllbGRzW2ZpZWxkTmFtZV07XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZW5mb3JjZUZpZWxkRXhpc3RzKGNsYXNzTmFtZSwgZmllbGROYW1lLCB0eXBlKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIHJldHVybiBQcm9taXNlLmFsbChwcm9taXNlcyk7XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLnRoZW4oKCkgPT5cbiAgICAgICAgICAgICAgdGhpcy5zZXRQZXJtaXNzaW9ucyhjbGFzc05hbWUsIGNsYXNzTGV2ZWxQZXJtaXNzaW9ucywgbmV3U2NoZW1hKVxuICAgICAgICAgICAgKVxuICAgICAgICAgICAgLnRoZW4oKCkgPT5cbiAgICAgICAgICAgICAgdGhpcy5fZGJBZGFwdGVyLnNldEluZGV4ZXNXaXRoU2NoZW1hRm9ybWF0KFxuICAgICAgICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICAgICAgICBpbmRleGVzLFxuICAgICAgICAgICAgICAgIHNjaGVtYS5pbmRleGVzLFxuICAgICAgICAgICAgICAgIGZ1bGxOZXdTY2hlbWFcbiAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKVxuICAgICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5yZWxvYWREYXRhKHsgY2xlYXJDYWNoZTogdHJ1ZSB9KSlcbiAgICAgICAgICAgIC8vVE9ETzogTW92ZSB0aGlzIGxvZ2ljIGludG8gdGhlIGRhdGFiYXNlIGFkYXB0ZXJcbiAgICAgICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5zY2hlbWFEYXRhW2NsYXNzTmFtZV07XG4gICAgICAgICAgICAgIGNvbnN0IHJlbG9hZGVkU2NoZW1hOiBTY2hlbWEgPSB7XG4gICAgICAgICAgICAgICAgY2xhc3NOYW1lOiBjbGFzc05hbWUsXG4gICAgICAgICAgICAgICAgZmllbGRzOiBzY2hlbWEuZmllbGRzLFxuICAgICAgICAgICAgICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczogc2NoZW1hLmNsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgaWYgKHNjaGVtYS5pbmRleGVzICYmIE9iamVjdC5rZXlzKHNjaGVtYS5pbmRleGVzKS5sZW5ndGggIT09IDApIHtcbiAgICAgICAgICAgICAgICByZWxvYWRlZFNjaGVtYS5pbmRleGVzID0gc2NoZW1hLmluZGV4ZXM7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgcmV0dXJuIHJlbG9hZGVkU2NoZW1hO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgKTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfQ0xBU1NfTkFNRSxcbiAgICAgICAgICAgIGBDbGFzcyAke2NsYXNzTmFtZX0gZG9lcyBub3QgZXhpc3QuYFxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9XG5cbiAgLy8gUmV0dXJucyBhIHByb21pc2UgdGhhdCByZXNvbHZlcyBzdWNjZXNzZnVsbHkgdG8gdGhlIG5ldyBzY2hlbWFcbiAgLy8gb2JqZWN0IG9yIGZhaWxzIHdpdGggYSByZWFzb24uXG4gIGVuZm9yY2VDbGFzc0V4aXN0cyhjbGFzc05hbWU6IHN0cmluZyk6IFByb21pc2U8U2NoZW1hQ29udHJvbGxlcj4ge1xuICAgIGlmICh0aGlzLnNjaGVtYURhdGFbY2xhc3NOYW1lXSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzKTtcbiAgICB9XG4gICAgLy8gV2UgZG9uJ3QgaGF2ZSB0aGlzIGNsYXNzLiBVcGRhdGUgdGhlIHNjaGVtYVxuICAgIHJldHVybiAoXG4gICAgICB0aGlzLmFkZENsYXNzSWZOb3RFeGlzdHMoY2xhc3NOYW1lKVxuICAgICAgICAvLyBUaGUgc2NoZW1hIHVwZGF0ZSBzdWNjZWVkZWQuIFJlbG9hZCB0aGUgc2NoZW1hXG4gICAgICAgIC50aGVuKCgpID0+IHRoaXMucmVsb2FkRGF0YSh7IGNsZWFyQ2FjaGU6IHRydWUgfSkpXG4gICAgICAgIC5jYXRjaCgoKSA9PiB7XG4gICAgICAgICAgLy8gVGhlIHNjaGVtYSB1cGRhdGUgZmFpbGVkLiBUaGlzIGNhbiBiZSBva2F5IC0gaXQgbWlnaHRcbiAgICAgICAgICAvLyBoYXZlIGZhaWxlZCBiZWNhdXNlIHRoZXJlJ3MgYSByYWNlIGNvbmRpdGlvbiBhbmQgYSBkaWZmZXJlbnRcbiAgICAgICAgICAvLyBjbGllbnQgaXMgbWFraW5nIHRoZSBleGFjdCBzYW1lIHNjaGVtYSB1cGRhdGUgdGhhdCB3ZSB3YW50LlxuICAgICAgICAgIC8vIFNvIGp1c3QgcmVsb2FkIHRoZSBzY2hlbWEuXG4gICAgICAgICAgcmV0dXJuIHRoaXMucmVsb2FkRGF0YSh7IGNsZWFyQ2FjaGU6IHRydWUgfSk7XG4gICAgICAgIH0pXG4gICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAvLyBFbnN1cmUgdGhhdCB0aGUgc2NoZW1hIG5vdyB2YWxpZGF0ZXNcbiAgICAgICAgICBpZiAodGhpcy5zY2hlbWFEYXRhW2NsYXNzTmFtZV0pIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICAgYEZhaWxlZCB0byBhZGQgJHtjbGFzc05hbWV9YFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICAgIC5jYXRjaCgoKSA9PiB7XG4gICAgICAgICAgLy8gVGhlIHNjaGVtYSBzdGlsbCBkb2Vzbid0IHZhbGlkYXRlLiBHaXZlIHVwXG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgJ3NjaGVtYSBjbGFzcyBuYW1lIGRvZXMgbm90IHJldmFsaWRhdGUnXG4gICAgICAgICAgKTtcbiAgICAgICAgfSlcbiAgICApO1xuICB9XG5cbiAgdmFsaWRhdGVOZXdDbGFzcyhcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBmaWVsZHM6IFNjaGVtYUZpZWxkcyA9IHt9LFxuICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczogYW55XG4gICk6IGFueSB7XG4gICAgaWYgKHRoaXMuc2NoZW1hRGF0YVtjbGFzc05hbWVdKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfQ0xBU1NfTkFNRSxcbiAgICAgICAgYENsYXNzICR7Y2xhc3NOYW1lfSBhbHJlYWR5IGV4aXN0cy5gXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoIWNsYXNzTmFtZUlzVmFsaWQoY2xhc3NOYW1lKSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29kZTogUGFyc2UuRXJyb3IuSU5WQUxJRF9DTEFTU19OQU1FLFxuICAgICAgICBlcnJvcjogaW52YWxpZENsYXNzTmFtZU1lc3NhZ2UoY2xhc3NOYW1lKSxcbiAgICAgIH07XG4gICAgfVxuICAgIHJldHVybiB0aGlzLnZhbGlkYXRlU2NoZW1hRGF0YShcbiAgICAgIGNsYXNzTmFtZSxcbiAgICAgIGZpZWxkcyxcbiAgICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgICAgIFtdXG4gICAgKTtcbiAgfVxuXG4gIHZhbGlkYXRlU2NoZW1hRGF0YShcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBmaWVsZHM6IFNjaGVtYUZpZWxkcyxcbiAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IENsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgICBleGlzdGluZ0ZpZWxkTmFtZXM6IEFycmF5PHN0cmluZz5cbiAgKSB7XG4gICAgZm9yIChjb25zdCBmaWVsZE5hbWUgaW4gZmllbGRzKSB7XG4gICAgICBpZiAoZXhpc3RpbmdGaWVsZE5hbWVzLmluZGV4T2YoZmllbGROYW1lKSA8IDApIHtcbiAgICAgICAgaWYgKCFmaWVsZE5hbWVJc1ZhbGlkKGZpZWxkTmFtZSkpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgY29kZTogUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSxcbiAgICAgICAgICAgIGVycm9yOiAnaW52YWxpZCBmaWVsZCBuYW1lOiAnICsgZmllbGROYW1lLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFmaWVsZE5hbWVJc1ZhbGlkRm9yQ2xhc3MoZmllbGROYW1lLCBjbGFzc05hbWUpKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGNvZGU6IDEzNixcbiAgICAgICAgICAgIGVycm9yOiAnZmllbGQgJyArIGZpZWxkTmFtZSArICcgY2Fubm90IGJlIGFkZGVkJyxcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGVycm9yID0gZmllbGRUeXBlSXNJbnZhbGlkKGZpZWxkc1tmaWVsZE5hbWVdKTtcbiAgICAgICAgaWYgKGVycm9yKSByZXR1cm4geyBjb2RlOiBlcnJvci5jb2RlLCBlcnJvcjogZXJyb3IubWVzc2FnZSB9O1xuICAgICAgfVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZmllbGROYW1lIGluIGRlZmF1bHRDb2x1bW5zW2NsYXNzTmFtZV0pIHtcbiAgICAgIGZpZWxkc1tmaWVsZE5hbWVdID0gZGVmYXVsdENvbHVtbnNbY2xhc3NOYW1lXVtmaWVsZE5hbWVdO1xuICAgIH1cblxuICAgIGNvbnN0IGdlb1BvaW50cyA9IE9iamVjdC5rZXlzKGZpZWxkcykuZmlsdGVyKFxuICAgICAga2V5ID0+IGZpZWxkc1trZXldICYmIGZpZWxkc1trZXldLnR5cGUgPT09ICdHZW9Qb2ludCdcbiAgICApO1xuICAgIGlmIChnZW9Qb2ludHMubGVuZ3RoID4gMSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29kZTogUGFyc2UuRXJyb3IuSU5DT1JSRUNUX1RZUEUsXG4gICAgICAgIGVycm9yOlxuICAgICAgICAgICdjdXJyZW50bHksIG9ubHkgb25lIEdlb1BvaW50IGZpZWxkIG1heSBleGlzdCBpbiBhbiBvYmplY3QuIEFkZGluZyAnICtcbiAgICAgICAgICBnZW9Qb2ludHNbMV0gK1xuICAgICAgICAgICcgd2hlbiAnICtcbiAgICAgICAgICBnZW9Qb2ludHNbMF0gK1xuICAgICAgICAgICcgYWxyZWFkeSBleGlzdHMuJyxcbiAgICAgIH07XG4gICAgfVxuICAgIHZhbGlkYXRlQ0xQKGNsYXNzTGV2ZWxQZXJtaXNzaW9ucywgZmllbGRzKTtcbiAgfVxuXG4gIC8vIFNldHMgdGhlIENsYXNzLWxldmVsIHBlcm1pc3Npb25zIGZvciBhIGdpdmVuIGNsYXNzTmFtZSwgd2hpY2ggbXVzdCBleGlzdC5cbiAgc2V0UGVybWlzc2lvbnMoY2xhc3NOYW1lOiBzdHJpbmcsIHBlcm1zOiBhbnksIG5ld1NjaGVtYTogU2NoZW1hRmllbGRzKSB7XG4gICAgaWYgKHR5cGVvZiBwZXJtcyA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG4gICAgdmFsaWRhdGVDTFAocGVybXMsIG5ld1NjaGVtYSk7XG4gICAgcmV0dXJuIHRoaXMuX2RiQWRhcHRlci5zZXRDbGFzc0xldmVsUGVybWlzc2lvbnMoY2xhc3NOYW1lLCBwZXJtcyk7XG4gIH1cblxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHN1Y2Nlc3NmdWxseSB0byB0aGUgbmV3IHNjaGVtYVxuICAvLyBvYmplY3QgaWYgdGhlIHByb3ZpZGVkIGNsYXNzTmFtZS1maWVsZE5hbWUtdHlwZSB0dXBsZSBpcyB2YWxpZC5cbiAgLy8gVGhlIGNsYXNzTmFtZSBtdXN0IGFscmVhZHkgYmUgdmFsaWRhdGVkLlxuICAvLyBJZiAnZnJlZXplJyBpcyB0cnVlLCByZWZ1c2UgdG8gdXBkYXRlIHRoZSBzY2hlbWEgZm9yIHRoaXMgZmllbGQuXG4gIGVuZm9yY2VGaWVsZEV4aXN0cyhcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBmaWVsZE5hbWU6IHN0cmluZyxcbiAgICB0eXBlOiBzdHJpbmcgfCBTY2hlbWFGaWVsZFxuICApIHtcbiAgICBpZiAoZmllbGROYW1lLmluZGV4T2YoJy4nKSA+IDApIHtcbiAgICAgIC8vIHN1YmRvY3VtZW50IGtleSAoeC55KSA9PiBvayBpZiB4IGlzIG9mIHR5cGUgJ29iamVjdCdcbiAgICAgIGZpZWxkTmFtZSA9IGZpZWxkTmFtZS5zcGxpdCgnLicpWzBdO1xuICAgICAgdHlwZSA9ICdPYmplY3QnO1xuICAgIH1cbiAgICBpZiAoIWZpZWxkTmFtZUlzVmFsaWQoZmllbGROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLFxuICAgICAgICBgSW52YWxpZCBmaWVsZCBuYW1lOiAke2ZpZWxkTmFtZX0uYFxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBJZiBzb21lb25lIHRyaWVzIHRvIGNyZWF0ZSBhIG5ldyBmaWVsZCB3aXRoIG51bGwvdW5kZWZpbmVkIGFzIHRoZSB2YWx1ZSwgcmV0dXJuO1xuICAgIGlmICghdHlwZSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5yZWxvYWREYXRhKCkudGhlbigoKSA9PiB7XG4gICAgICBjb25zdCBleHBlY3RlZFR5cGUgPSB0aGlzLmdldEV4cGVjdGVkVHlwZShjbGFzc05hbWUsIGZpZWxkTmFtZSk7XG4gICAgICBpZiAodHlwZW9mIHR5cGUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHR5cGUgPSB7IHR5cGUgfTtcbiAgICAgIH1cblxuICAgICAgaWYgKGV4cGVjdGVkVHlwZSkge1xuICAgICAgICBpZiAoIWRiVHlwZU1hdGNoZXNPYmplY3RUeXBlKGV4cGVjdGVkVHlwZSwgdHlwZSkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5JTkNPUlJFQ1RfVFlQRSxcbiAgICAgICAgICAgIGBzY2hlbWEgbWlzbWF0Y2ggZm9yICR7Y2xhc3NOYW1lfS4ke2ZpZWxkTmFtZX07IGV4cGVjdGVkICR7dHlwZVRvU3RyaW5nKFxuICAgICAgICAgICAgICBleHBlY3RlZFR5cGVcbiAgICAgICAgICAgICl9IGJ1dCBnb3QgJHt0eXBlVG9TdHJpbmcodHlwZSl9YFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzLl9kYkFkYXB0ZXJcbiAgICAgICAgLmFkZEZpZWxkSWZOb3RFeGlzdHMoY2xhc3NOYW1lLCBmaWVsZE5hbWUsIHR5cGUpXG4gICAgICAgIC50aGVuKFxuICAgICAgICAgICgpID0+IHtcbiAgICAgICAgICAgIC8vIFRoZSB1cGRhdGUgc3VjY2VlZGVkLiBSZWxvYWQgdGhlIHNjaGVtYVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVsb2FkRGF0YSh7IGNsZWFyQ2FjaGU6IHRydWUgfSk7XG4gICAgICAgICAgfSxcbiAgICAgICAgICBlcnJvciA9PiB7XG4gICAgICAgICAgICBpZiAoZXJyb3IuY29kZSA9PSBQYXJzZS5FcnJvci5JTkNPUlJFQ1RfVFlQRSkge1xuICAgICAgICAgICAgICAvLyBNYWtlIHN1cmUgdGhhdCB3ZSB0aHJvdyBlcnJvcnMgd2hlbiBpdCBpcyBhcHByb3ByaWF0ZSB0byBkbyBzby5cbiAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBUaGUgdXBkYXRlIGZhaWxlZC4gVGhpcyBjYW4gYmUgb2theSAtIGl0IG1pZ2h0IGhhdmUgYmVlbiBhIHJhY2VcbiAgICAgICAgICAgIC8vIGNvbmRpdGlvbiB3aGVyZSBhbm90aGVyIGNsaWVudCB1cGRhdGVkIHRoZSBzY2hlbWEgaW4gdGhlIHNhbWVcbiAgICAgICAgICAgIC8vIHdheSB0aGF0IHdlIHdhbnRlZCB0by4gU28sIGp1c3QgcmVsb2FkIHRoZSBzY2hlbWFcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJlbG9hZERhdGEoeyBjbGVhckNhY2hlOiB0cnVlIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgKVxuICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgLy8gRW5zdXJlIHRoYXQgdGhlIHNjaGVtYSBub3cgdmFsaWRhdGVzXG4gICAgICAgICAgY29uc3QgZXhwZWN0ZWRUeXBlID0gdGhpcy5nZXRFeHBlY3RlZFR5cGUoY2xhc3NOYW1lLCBmaWVsZE5hbWUpO1xuICAgICAgICAgIGlmICh0eXBlb2YgdHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHR5cGUgPSB7IHR5cGUgfTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKCFleHBlY3RlZFR5cGUgfHwgIWRiVHlwZU1hdGNoZXNPYmplY3RUeXBlKGV4cGVjdGVkVHlwZSwgdHlwZSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgICBgQ291bGQgbm90IGFkZCBmaWVsZCAke2ZpZWxkTmFtZX1gXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBSZW1vdmUgdGhlIGNhY2hlZCBzY2hlbWFcbiAgICAgICAgICB0aGlzLl9jYWNoZS5jbGVhcigpO1xuICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIG1haW50YWluIGNvbXBhdGliaWxpdHlcbiAgZGVsZXRlRmllbGQoXG4gICAgZmllbGROYW1lOiBzdHJpbmcsXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgZGF0YWJhc2U6IERhdGFiYXNlQ29udHJvbGxlclxuICApIHtcbiAgICByZXR1cm4gdGhpcy5kZWxldGVGaWVsZHMoW2ZpZWxkTmFtZV0sIGNsYXNzTmFtZSwgZGF0YWJhc2UpO1xuICB9XG5cbiAgLy8gRGVsZXRlIGZpZWxkcywgYW5kIHJlbW92ZSB0aGF0IGRhdGEgZnJvbSBhbGwgb2JqZWN0cy4gVGhpcyBpcyBpbnRlbmRlZFxuICAvLyB0byByZW1vdmUgdW51c2VkIGZpZWxkcywgaWYgb3RoZXIgd3JpdGVycyBhcmUgd3JpdGluZyBvYmplY3RzIHRoYXQgaW5jbHVkZVxuICAvLyB0aGlzIGZpZWxkLCB0aGUgZmllbGQgbWF5IHJlYXBwZWFyLiBSZXR1cm5zIGEgUHJvbWlzZSB0aGF0IHJlc29sdmVzIHdpdGhcbiAgLy8gbm8gb2JqZWN0IG9uIHN1Y2Nlc3MsIG9yIHJlamVjdHMgd2l0aCB7IGNvZGUsIGVycm9yIH0gb24gZmFpbHVyZS5cbiAgLy8gUGFzc2luZyB0aGUgZGF0YWJhc2UgYW5kIHByZWZpeCBpcyBuZWNlc3NhcnkgaW4gb3JkZXIgdG8gZHJvcCByZWxhdGlvbiBjb2xsZWN0aW9uc1xuICAvLyBhbmQgcmVtb3ZlIGZpZWxkcyBmcm9tIG9iamVjdHMuIElkZWFsbHkgdGhlIGRhdGFiYXNlIHdvdWxkIGJlbG9uZyB0b1xuICAvLyBhIGRhdGFiYXNlIGFkYXB0ZXIgYW5kIHRoaXMgZnVuY3Rpb24gd291bGQgY2xvc2Ugb3ZlciBpdCBvciBhY2Nlc3MgaXQgdmlhIG1lbWJlci5cbiAgZGVsZXRlRmllbGRzKFxuICAgIGZpZWxkTmFtZXM6IEFycmF5PHN0cmluZz4sXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgZGF0YWJhc2U6IERhdGFiYXNlQ29udHJvbGxlclxuICApIHtcbiAgICBpZiAoIWNsYXNzTmFtZUlzVmFsaWQoY2xhc3NOYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0NMQVNTX05BTUUsXG4gICAgICAgIGludmFsaWRDbGFzc05hbWVNZXNzYWdlKGNsYXNzTmFtZSlcbiAgICAgICk7XG4gICAgfVxuXG4gICAgZmllbGROYW1lcy5mb3JFYWNoKGZpZWxkTmFtZSA9PiB7XG4gICAgICBpZiAoIWZpZWxkTmFtZUlzVmFsaWQoZmllbGROYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSxcbiAgICAgICAgICBgaW52YWxpZCBmaWVsZCBuYW1lOiAke2ZpZWxkTmFtZX1gXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICAvL0Rvbid0IGFsbG93IGRlbGV0aW5nIHRoZSBkZWZhdWx0IGZpZWxkcy5cbiAgICAgIGlmICghZmllbGROYW1lSXNWYWxpZEZvckNsYXNzKGZpZWxkTmFtZSwgY2xhc3NOYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoMTM2LCBgZmllbGQgJHtmaWVsZE5hbWV9IGNhbm5vdCBiZSBjaGFuZ2VkYCk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gdGhpcy5nZXRPbmVTY2hlbWEoY2xhc3NOYW1lLCBmYWxzZSwgeyBjbGVhckNhY2hlOiB0cnVlIH0pXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfQ0xBU1NfTkFNRSxcbiAgICAgICAgICAgIGBDbGFzcyAke2NsYXNzTmFtZX0gZG9lcyBub3QgZXhpc3QuYFxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAudGhlbihzY2hlbWEgPT4ge1xuICAgICAgICBmaWVsZE5hbWVzLmZvckVhY2goZmllbGROYW1lID0+IHtcbiAgICAgICAgICBpZiAoIXNjaGVtYS5maWVsZHNbZmllbGROYW1lXSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICAyNTUsXG4gICAgICAgICAgICAgIGBGaWVsZCAke2ZpZWxkTmFtZX0gZG9lcyBub3QgZXhpc3QsIGNhbm5vdCBkZWxldGUuYFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHNjaGVtYUZpZWxkcyA9IHsgLi4uc2NoZW1hLmZpZWxkcyB9O1xuICAgICAgICByZXR1cm4gZGF0YWJhc2UuYWRhcHRlclxuICAgICAgICAgIC5kZWxldGVGaWVsZHMoY2xhc3NOYW1lLCBzY2hlbWEsIGZpZWxkTmFtZXMpXG4gICAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKFxuICAgICAgICAgICAgICBmaWVsZE5hbWVzLm1hcChmaWVsZE5hbWUgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGZpZWxkID0gc2NoZW1hRmllbGRzW2ZpZWxkTmFtZV07XG4gICAgICAgICAgICAgICAgaWYgKGZpZWxkICYmIGZpZWxkLnR5cGUgPT09ICdSZWxhdGlvbicpIHtcbiAgICAgICAgICAgICAgICAgIC8vRm9yIHJlbGF0aW9ucywgZHJvcCB0aGUgX0pvaW4gdGFibGVcbiAgICAgICAgICAgICAgICAgIHJldHVybiBkYXRhYmFzZS5hZGFwdGVyLmRlbGV0ZUNsYXNzKFxuICAgICAgICAgICAgICAgICAgICBgX0pvaW46JHtmaWVsZE5hbWV9OiR7Y2xhc3NOYW1lfWBcbiAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSk7XG4gICAgICB9KVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICB0aGlzLl9jYWNoZS5jbGVhcigpO1xuICAgICAgfSk7XG4gIH1cblxuICAvLyBWYWxpZGF0ZXMgYW4gb2JqZWN0IHByb3ZpZGVkIGluIFJFU1QgZm9ybWF0LlxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSBuZXcgc2NoZW1hIGlmIHRoaXMgb2JqZWN0IGlzXG4gIC8vIHZhbGlkLlxuICB2YWxpZGF0ZU9iamVjdChjbGFzc05hbWU6IHN0cmluZywgb2JqZWN0OiBhbnksIHF1ZXJ5OiBhbnkpIHtcbiAgICBsZXQgZ2VvY291bnQgPSAwO1xuICAgIGxldCBwcm9taXNlID0gdGhpcy5lbmZvcmNlQ2xhc3NFeGlzdHMoY2xhc3NOYW1lKTtcbiAgICBmb3IgKGNvbnN0IGZpZWxkTmFtZSBpbiBvYmplY3QpIHtcbiAgICAgIGlmIChvYmplY3RbZmllbGROYW1lXSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgZXhwZWN0ZWQgPSBnZXRUeXBlKG9iamVjdFtmaWVsZE5hbWVdKTtcbiAgICAgIGlmIChleHBlY3RlZCA9PT0gJ0dlb1BvaW50Jykge1xuICAgICAgICBnZW9jb3VudCsrO1xuICAgICAgfVxuICAgICAgaWYgKGdlb2NvdW50ID4gMSkge1xuICAgICAgICAvLyBNYWtlIHN1cmUgYWxsIGZpZWxkIHZhbGlkYXRpb24gb3BlcmF0aW9ucyBydW4gYmVmb3JlIHdlIHJldHVybi5cbiAgICAgICAgLy8gSWYgbm90IC0gd2UgYXJlIGNvbnRpbnVpbmcgdG8gcnVuIGxvZ2ljLCBidXQgYWxyZWFkeSBwcm92aWRlZCByZXNwb25zZSBmcm9tIHRoZSBzZXJ2ZXIuXG4gICAgICAgIHJldHVybiBwcm9taXNlLnRoZW4oKCkgPT4ge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChcbiAgICAgICAgICAgIG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5DT1JSRUNUX1RZUEUsXG4gICAgICAgICAgICAgICd0aGVyZSBjYW4gb25seSBiZSBvbmUgZ2VvcG9pbnQgZmllbGQgaW4gYSBjbGFzcydcbiAgICAgICAgICAgIClcbiAgICAgICAgICApO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGlmICghZXhwZWN0ZWQpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoZmllbGROYW1lID09PSAnQUNMJykge1xuICAgICAgICAvLyBFdmVyeSBvYmplY3QgaGFzIEFDTCBpbXBsaWNpdGx5LlxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgcHJvbWlzZSA9IHByb21pc2UudGhlbihzY2hlbWEgPT5cbiAgICAgICAgc2NoZW1hLmVuZm9yY2VGaWVsZEV4aXN0cyhjbGFzc05hbWUsIGZpZWxkTmFtZSwgZXhwZWN0ZWQpXG4gICAgICApO1xuICAgIH1cbiAgICBwcm9taXNlID0gdGhlblZhbGlkYXRlUmVxdWlyZWRDb2x1bW5zKHByb21pc2UsIGNsYXNzTmFtZSwgb2JqZWN0LCBxdWVyeSk7XG4gICAgcmV0dXJuIHByb21pc2U7XG4gIH1cblxuICAvLyBWYWxpZGF0ZXMgdGhhdCBhbGwgdGhlIHByb3BlcnRpZXMgYXJlIHNldCBmb3IgdGhlIG9iamVjdFxuICB2YWxpZGF0ZVJlcXVpcmVkQ29sdW1ucyhjbGFzc05hbWU6IHN0cmluZywgb2JqZWN0OiBhbnksIHF1ZXJ5OiBhbnkpIHtcbiAgICBjb25zdCBjb2x1bW5zID0gcmVxdWlyZWRDb2x1bW5zW2NsYXNzTmFtZV07XG4gICAgaWYgKCFjb2x1bW5zIHx8IGNvbHVtbnMubGVuZ3RoID09IDApIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcyk7XG4gICAgfVxuXG4gICAgY29uc3QgbWlzc2luZ0NvbHVtbnMgPSBjb2x1bW5zLmZpbHRlcihmdW5jdGlvbihjb2x1bW4pIHtcbiAgICAgIGlmIChxdWVyeSAmJiBxdWVyeS5vYmplY3RJZCkge1xuICAgICAgICBpZiAob2JqZWN0W2NvbHVtbl0gJiYgdHlwZW9mIG9iamVjdFtjb2x1bW5dID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgIC8vIFRyeWluZyB0byBkZWxldGUgYSByZXF1aXJlZCBjb2x1bW5cbiAgICAgICAgICByZXR1cm4gb2JqZWN0W2NvbHVtbl0uX19vcCA9PSAnRGVsZXRlJztcbiAgICAgICAgfVxuICAgICAgICAvLyBOb3QgdHJ5aW5nIHRvIGRvIGFueXRoaW5nIHRoZXJlXG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICAgIHJldHVybiAhb2JqZWN0W2NvbHVtbl07XG4gICAgfSk7XG5cbiAgICBpZiAobWlzc2luZ0NvbHVtbnMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTkNPUlJFQ1RfVFlQRSxcbiAgICAgICAgbWlzc2luZ0NvbHVtbnNbMF0gKyAnIGlzIHJlcXVpcmVkLidcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcyk7XG4gIH1cblxuICB0ZXN0UGVybWlzc2lvbnNGb3JDbGFzc05hbWUoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgYWNsR3JvdXA6IHN0cmluZ1tdLFxuICAgIG9wZXJhdGlvbjogc3RyaW5nXG4gICkge1xuICAgIHJldHVybiBTY2hlbWFDb250cm9sbGVyLnRlc3RQZXJtaXNzaW9ucyhcbiAgICAgIHRoaXMuZ2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zKGNsYXNzTmFtZSksXG4gICAgICBhY2xHcm91cCxcbiAgICAgIG9wZXJhdGlvblxuICAgICk7XG4gIH1cblxuICAvLyBUZXN0cyB0aGF0IHRoZSBjbGFzcyBsZXZlbCBwZXJtaXNzaW9uIGxldCBwYXNzIHRoZSBvcGVyYXRpb24gZm9yIGEgZ2l2ZW4gYWNsR3JvdXBcbiAgc3RhdGljIHRlc3RQZXJtaXNzaW9ucyhcbiAgICBjbGFzc1Blcm1pc3Npb25zOiA/YW55LFxuICAgIGFjbEdyb3VwOiBzdHJpbmdbXSxcbiAgICBvcGVyYXRpb246IHN0cmluZ1xuICApOiBib29sZWFuIHtcbiAgICBpZiAoIWNsYXNzUGVybWlzc2lvbnMgfHwgIWNsYXNzUGVybWlzc2lvbnNbb3BlcmF0aW9uXSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIGNvbnN0IHBlcm1zID0gY2xhc3NQZXJtaXNzaW9uc1tvcGVyYXRpb25dO1xuICAgIGlmIChwZXJtc1snKiddKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgLy8gQ2hlY2sgcGVybWlzc2lvbnMgYWdhaW5zdCB0aGUgYWNsR3JvdXAgcHJvdmlkZWQgKGFycmF5IG9mIHVzZXJJZC9yb2xlcylcbiAgICBpZiAoXG4gICAgICBhY2xHcm91cC5zb21lKGFjbCA9PiB7XG4gICAgICAgIHJldHVybiBwZXJtc1thY2xdID09PSB0cnVlO1xuICAgICAgfSlcbiAgICApIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvLyBWYWxpZGF0ZXMgYW4gb3BlcmF0aW9uIHBhc3NlcyBjbGFzcy1sZXZlbC1wZXJtaXNzaW9ucyBzZXQgaW4gdGhlIHNjaGVtYVxuICBzdGF0aWMgdmFsaWRhdGVQZXJtaXNzaW9uKFxuICAgIGNsYXNzUGVybWlzc2lvbnM6ID9hbnksXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgYWNsR3JvdXA6IHN0cmluZ1tdLFxuICAgIG9wZXJhdGlvbjogc3RyaW5nXG4gICkge1xuICAgIGlmIChcbiAgICAgIFNjaGVtYUNvbnRyb2xsZXIudGVzdFBlcm1pc3Npb25zKGNsYXNzUGVybWlzc2lvbnMsIGFjbEdyb3VwLCBvcGVyYXRpb24pXG4gICAgKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuXG4gICAgaWYgKCFjbGFzc1Blcm1pc3Npb25zIHx8ICFjbGFzc1Blcm1pc3Npb25zW29wZXJhdGlvbl0pIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICBjb25zdCBwZXJtcyA9IGNsYXNzUGVybWlzc2lvbnNbb3BlcmF0aW9uXTtcbiAgICAvLyBJZiBvbmx5IGZvciBhdXRoZW50aWNhdGVkIHVzZXJzXG4gICAgLy8gbWFrZSBzdXJlIHdlIGhhdmUgYW4gYWNsR3JvdXBcbiAgICBpZiAocGVybXNbJ3JlcXVpcmVzQXV0aGVudGljYXRpb24nXSkge1xuICAgICAgLy8gSWYgYWNsR3JvdXAgaGFzICogKHB1YmxpYylcbiAgICAgIGlmICghYWNsR3JvdXAgfHwgYWNsR3JvdXAubGVuZ3RoID09IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsXG4gICAgICAgICAgJ1Blcm1pc3Npb24gZGVuaWVkLCB1c2VyIG5lZWRzIHRvIGJlIGF1dGhlbnRpY2F0ZWQuJ1xuICAgICAgICApO1xuICAgICAgfSBlbHNlIGlmIChhY2xHcm91cC5pbmRleE9mKCcqJykgPiAtMSAmJiBhY2xHcm91cC5sZW5ndGggPT0gMSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCxcbiAgICAgICAgICAnUGVybWlzc2lvbiBkZW5pZWQsIHVzZXIgbmVlZHMgdG8gYmUgYXV0aGVudGljYXRlZC4nXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICAvLyByZXF1aXJlc0F1dGhlbnRpY2F0aW9uIHBhc3NlZCwganVzdCBtb3ZlIGZvcndhcmRcbiAgICAgIC8vIHByb2JhYmx5IHdvdWxkIGJlIHdpc2UgYXQgc29tZSBwb2ludCB0byByZW5hbWUgdG8gJ2F1dGhlbnRpY2F0ZWRVc2VyJ1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cblxuICAgIC8vIE5vIG1hdGNoaW5nIENMUCwgbGV0J3MgY2hlY2sgdGhlIFBvaW50ZXIgcGVybWlzc2lvbnNcbiAgICAvLyBBbmQgaGFuZGxlIHRob3NlIGxhdGVyXG4gICAgY29uc3QgcGVybWlzc2lvbkZpZWxkID1cbiAgICAgIFsnZ2V0JywgJ2ZpbmQnLCAnY291bnQnXS5pbmRleE9mKG9wZXJhdGlvbikgPiAtMVxuICAgICAgICA/ICdyZWFkVXNlckZpZWxkcydcbiAgICAgICAgOiAnd3JpdGVVc2VyRmllbGRzJztcblxuICAgIC8vIFJlamVjdCBjcmVhdGUgd2hlbiB3cml0ZSBsb2NrZG93blxuICAgIGlmIChwZXJtaXNzaW9uRmllbGQgPT0gJ3dyaXRlVXNlckZpZWxkcycgJiYgb3BlcmF0aW9uID09ICdjcmVhdGUnKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLk9QRVJBVElPTl9GT1JCSURERU4sXG4gICAgICAgIGBQZXJtaXNzaW9uIGRlbmllZCBmb3IgYWN0aW9uICR7b3BlcmF0aW9ufSBvbiBjbGFzcyAke2NsYXNzTmFtZX0uYFxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBQcm9jZXNzIHRoZSByZWFkVXNlckZpZWxkcyBsYXRlclxuICAgIGlmIChcbiAgICAgIEFycmF5LmlzQXJyYXkoY2xhc3NQZXJtaXNzaW9uc1twZXJtaXNzaW9uRmllbGRdKSAmJlxuICAgICAgY2xhc3NQZXJtaXNzaW9uc1twZXJtaXNzaW9uRmllbGRdLmxlbmd0aCA+IDBcbiAgICApIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTixcbiAgICAgIGBQZXJtaXNzaW9uIGRlbmllZCBmb3IgYWN0aW9uICR7b3BlcmF0aW9ufSBvbiBjbGFzcyAke2NsYXNzTmFtZX0uYFxuICAgICk7XG4gIH1cblxuICAvLyBWYWxpZGF0ZXMgYW4gb3BlcmF0aW9uIHBhc3NlcyBjbGFzcy1sZXZlbC1wZXJtaXNzaW9ucyBzZXQgaW4gdGhlIHNjaGVtYVxuICB2YWxpZGF0ZVBlcm1pc3Npb24oY2xhc3NOYW1lOiBzdHJpbmcsIGFjbEdyb3VwOiBzdHJpbmdbXSwgb3BlcmF0aW9uOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gU2NoZW1hQ29udHJvbGxlci52YWxpZGF0ZVBlcm1pc3Npb24oXG4gICAgICB0aGlzLmdldENsYXNzTGV2ZWxQZXJtaXNzaW9ucyhjbGFzc05hbWUpLFxuICAgICAgY2xhc3NOYW1lLFxuICAgICAgYWNsR3JvdXAsXG4gICAgICBvcGVyYXRpb25cbiAgICApO1xuICB9XG5cbiAgZ2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zKGNsYXNzTmFtZTogc3RyaW5nKTogYW55IHtcbiAgICByZXR1cm4gKFxuICAgICAgdGhpcy5zY2hlbWFEYXRhW2NsYXNzTmFtZV0gJiZcbiAgICAgIHRoaXMuc2NoZW1hRGF0YVtjbGFzc05hbWVdLmNsYXNzTGV2ZWxQZXJtaXNzaW9uc1xuICAgICk7XG4gIH1cblxuICAvLyBSZXR1cm5zIHRoZSBleHBlY3RlZCB0eXBlIGZvciBhIGNsYXNzTmFtZStrZXkgY29tYmluYXRpb25cbiAgLy8gb3IgdW5kZWZpbmVkIGlmIHRoZSBzY2hlbWEgaXMgbm90IHNldFxuICBnZXRFeHBlY3RlZFR5cGUoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgZmllbGROYW1lOiBzdHJpbmdcbiAgKTogPyhTY2hlbWFGaWVsZCB8IHN0cmluZykge1xuICAgIGlmICh0aGlzLnNjaGVtYURhdGFbY2xhc3NOYW1lXSkge1xuICAgICAgY29uc3QgZXhwZWN0ZWRUeXBlID0gdGhpcy5zY2hlbWFEYXRhW2NsYXNzTmFtZV0uZmllbGRzW2ZpZWxkTmFtZV07XG4gICAgICByZXR1cm4gZXhwZWN0ZWRUeXBlID09PSAnbWFwJyA/ICdPYmplY3QnIDogZXhwZWN0ZWRUeXBlO1xuICAgIH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgLy8gQ2hlY2tzIGlmIGEgZ2l2ZW4gY2xhc3MgaXMgaW4gdGhlIHNjaGVtYS5cbiAgaGFzQ2xhc3MoY2xhc3NOYW1lOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5yZWxvYWREYXRhKCkudGhlbigoKSA9PiAhIXRoaXMuc2NoZW1hRGF0YVtjbGFzc05hbWVdKTtcbiAgfVxufVxuXG4vLyBSZXR1cm5zIGEgcHJvbWlzZSBmb3IgYSBuZXcgU2NoZW1hLlxuY29uc3QgbG9hZCA9IChcbiAgZGJBZGFwdGVyOiBTdG9yYWdlQWRhcHRlcixcbiAgc2NoZW1hQ2FjaGU6IGFueSxcbiAgb3B0aW9uczogYW55XG4pOiBQcm9taXNlPFNjaGVtYUNvbnRyb2xsZXI+ID0+IHtcbiAgY29uc3Qgc2NoZW1hID0gbmV3IFNjaGVtYUNvbnRyb2xsZXIoZGJBZGFwdGVyLCBzY2hlbWFDYWNoZSk7XG4gIHJldHVybiBzY2hlbWEucmVsb2FkRGF0YShvcHRpb25zKS50aGVuKCgpID0+IHNjaGVtYSk7XG59O1xuXG4vLyBCdWlsZHMgYSBuZXcgc2NoZW1hIChpbiBzY2hlbWEgQVBJIHJlc3BvbnNlIGZvcm1hdCkgb3V0IG9mIGFuXG4vLyBleGlzdGluZyBtb25nbyBzY2hlbWEgKyBhIHNjaGVtYXMgQVBJIHB1dCByZXF1ZXN0LiBUaGlzIHJlc3BvbnNlXG4vLyBkb2VzIG5vdCBpbmNsdWRlIHRoZSBkZWZhdWx0IGZpZWxkcywgYXMgaXQgaXMgaW50ZW5kZWQgdG8gYmUgcGFzc2VkXG4vLyB0byBtb25nb1NjaGVtYUZyb21GaWVsZHNBbmRDbGFzc05hbWUuIE5vIHZhbGlkYXRpb24gaXMgZG9uZSBoZXJlLCBpdFxuLy8gaXMgZG9uZSBpbiBtb25nb1NjaGVtYUZyb21GaWVsZHNBbmRDbGFzc05hbWUuXG5mdW5jdGlvbiBidWlsZE1lcmdlZFNjaGVtYU9iamVjdChcbiAgZXhpc3RpbmdGaWVsZHM6IFNjaGVtYUZpZWxkcyxcbiAgcHV0UmVxdWVzdDogYW55XG4pOiBTY2hlbWFGaWVsZHMge1xuICBjb25zdCBuZXdTY2hlbWEgPSB7fTtcbiAgLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG4gIGNvbnN0IHN5c1NjaGVtYUZpZWxkID1cbiAgICBPYmplY3Qua2V5cyhkZWZhdWx0Q29sdW1ucykuaW5kZXhPZihleGlzdGluZ0ZpZWxkcy5faWQpID09PSAtMVxuICAgICAgPyBbXVxuICAgICAgOiBPYmplY3Qua2V5cyhkZWZhdWx0Q29sdW1uc1tleGlzdGluZ0ZpZWxkcy5faWRdKTtcbiAgZm9yIChjb25zdCBvbGRGaWVsZCBpbiBleGlzdGluZ0ZpZWxkcykge1xuICAgIGlmIChcbiAgICAgIG9sZEZpZWxkICE9PSAnX2lkJyAmJlxuICAgICAgb2xkRmllbGQgIT09ICdBQ0wnICYmXG4gICAgICBvbGRGaWVsZCAhPT0gJ3VwZGF0ZWRBdCcgJiZcbiAgICAgIG9sZEZpZWxkICE9PSAnY3JlYXRlZEF0JyAmJlxuICAgICAgb2xkRmllbGQgIT09ICdvYmplY3RJZCdcbiAgICApIHtcbiAgICAgIGlmIChcbiAgICAgICAgc3lzU2NoZW1hRmllbGQubGVuZ3RoID4gMCAmJlxuICAgICAgICBzeXNTY2hlbWFGaWVsZC5pbmRleE9mKG9sZEZpZWxkKSAhPT0gLTFcbiAgICAgICkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGZpZWxkSXNEZWxldGVkID1cbiAgICAgICAgcHV0UmVxdWVzdFtvbGRGaWVsZF0gJiYgcHV0UmVxdWVzdFtvbGRGaWVsZF0uX19vcCA9PT0gJ0RlbGV0ZSc7XG4gICAgICBpZiAoIWZpZWxkSXNEZWxldGVkKSB7XG4gICAgICAgIG5ld1NjaGVtYVtvbGRGaWVsZF0gPSBleGlzdGluZ0ZpZWxkc1tvbGRGaWVsZF07XG4gICAgICB9XG4gICAgfVxuICB9XG4gIGZvciAoY29uc3QgbmV3RmllbGQgaW4gcHV0UmVxdWVzdCkge1xuICAgIGlmIChuZXdGaWVsZCAhPT0gJ29iamVjdElkJyAmJiBwdXRSZXF1ZXN0W25ld0ZpZWxkXS5fX29wICE9PSAnRGVsZXRlJykge1xuICAgICAgaWYgKFxuICAgICAgICBzeXNTY2hlbWFGaWVsZC5sZW5ndGggPiAwICYmXG4gICAgICAgIHN5c1NjaGVtYUZpZWxkLmluZGV4T2YobmV3RmllbGQpICE9PSAtMVxuICAgICAgKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgbmV3U2NoZW1hW25ld0ZpZWxkXSA9IHB1dFJlcXVlc3RbbmV3RmllbGRdO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbmV3U2NoZW1hO1xufVxuXG4vLyBHaXZlbiBhIHNjaGVtYSBwcm9taXNlLCBjb25zdHJ1Y3QgYW5vdGhlciBzY2hlbWEgcHJvbWlzZSB0aGF0XG4vLyB2YWxpZGF0ZXMgdGhpcyBmaWVsZCBvbmNlIHRoZSBzY2hlbWEgbG9hZHMuXG5mdW5jdGlvbiB0aGVuVmFsaWRhdGVSZXF1aXJlZENvbHVtbnMoc2NoZW1hUHJvbWlzZSwgY2xhc3NOYW1lLCBvYmplY3QsIHF1ZXJ5KSB7XG4gIHJldHVybiBzY2hlbWFQcm9taXNlLnRoZW4oc2NoZW1hID0+IHtcbiAgICByZXR1cm4gc2NoZW1hLnZhbGlkYXRlUmVxdWlyZWRDb2x1bW5zKGNsYXNzTmFtZSwgb2JqZWN0LCBxdWVyeSk7XG4gIH0pO1xufVxuXG4vLyBHZXRzIHRoZSB0eXBlIGZyb20gYSBSRVNUIEFQSSBmb3JtYXR0ZWQgb2JqZWN0LCB3aGVyZSAndHlwZScgaXNcbi8vIGV4dGVuZGVkIHBhc3QgamF2YXNjcmlwdCB0eXBlcyB0byBpbmNsdWRlIHRoZSByZXN0IG9mIHRoZSBQYXJzZVxuLy8gdHlwZSBzeXN0ZW0uXG4vLyBUaGUgb3V0cHV0IHNob3VsZCBiZSBhIHZhbGlkIHNjaGVtYSB2YWx1ZS5cbi8vIFRPRE86IGVuc3VyZSB0aGF0IHRoaXMgaXMgY29tcGF0aWJsZSB3aXRoIHRoZSBmb3JtYXQgdXNlZCBpbiBPcGVuIERCXG5mdW5jdGlvbiBnZXRUeXBlKG9iajogYW55KTogPyhTY2hlbWFGaWVsZCB8IHN0cmluZykge1xuICBjb25zdCB0eXBlID0gdHlwZW9mIG9iajtcbiAgc3dpdGNoICh0eXBlKSB7XG4gICAgY2FzZSAnYm9vbGVhbic6XG4gICAgICByZXR1cm4gJ0Jvb2xlYW4nO1xuICAgIGNhc2UgJ3N0cmluZyc6XG4gICAgICByZXR1cm4gJ1N0cmluZyc7XG4gICAgY2FzZSAnbnVtYmVyJzpcbiAgICAgIHJldHVybiAnTnVtYmVyJztcbiAgICBjYXNlICdtYXAnOlxuICAgIGNhc2UgJ29iamVjdCc6XG4gICAgICBpZiAoIW9iaikge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGdldE9iamVjdFR5cGUob2JqKTtcbiAgICBjYXNlICdmdW5jdGlvbic6XG4gICAgY2FzZSAnc3ltYm9sJzpcbiAgICBjYXNlICd1bmRlZmluZWQnOlxuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyAnYmFkIG9iajogJyArIG9iajtcbiAgfVxufVxuXG4vLyBUaGlzIGdldHMgdGhlIHR5cGUgZm9yIG5vbi1KU09OIHR5cGVzIGxpa2UgcG9pbnRlcnMgYW5kIGZpbGVzLCBidXRcbi8vIGFsc28gZ2V0cyB0aGUgYXBwcm9wcmlhdGUgdHlwZSBmb3IgJCBvcGVyYXRvcnMuXG4vLyBSZXR1cm5zIG51bGwgaWYgdGhlIHR5cGUgaXMgdW5rbm93bi5cbmZ1bmN0aW9uIGdldE9iamVjdFR5cGUob2JqKTogPyhTY2hlbWFGaWVsZCB8IHN0cmluZykge1xuICBpZiAob2JqIGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICByZXR1cm4gJ0FycmF5JztcbiAgfVxuICBpZiAob2JqLl9fdHlwZSkge1xuICAgIHN3aXRjaCAob2JqLl9fdHlwZSkge1xuICAgICAgY2FzZSAnUG9pbnRlcic6XG4gICAgICAgIGlmIChvYmouY2xhc3NOYW1lKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHR5cGU6ICdQb2ludGVyJyxcbiAgICAgICAgICAgIHRhcmdldENsYXNzOiBvYmouY2xhc3NOYW1lLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdSZWxhdGlvbic6XG4gICAgICAgIGlmIChvYmouY2xhc3NOYW1lKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHR5cGU6ICdSZWxhdGlvbicsXG4gICAgICAgICAgICB0YXJnZXRDbGFzczogb2JqLmNsYXNzTmFtZSxcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnRmlsZSc6XG4gICAgICAgIGlmIChvYmoubmFtZSkge1xuICAgICAgICAgIHJldHVybiAnRmlsZSc7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdEYXRlJzpcbiAgICAgICAgaWYgKG9iai5pc28pIHtcbiAgICAgICAgICByZXR1cm4gJ0RhdGUnO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnR2VvUG9pbnQnOlxuICAgICAgICBpZiAob2JqLmxhdGl0dWRlICE9IG51bGwgJiYgb2JqLmxvbmdpdHVkZSAhPSBudWxsKSB7XG4gICAgICAgICAgcmV0dXJuICdHZW9Qb2ludCc7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdCeXRlcyc6XG4gICAgICAgIGlmIChvYmouYmFzZTY0KSB7XG4gICAgICAgICAgcmV0dXJuICdCeXRlcyc7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdQb2x5Z29uJzpcbiAgICAgICAgaWYgKG9iai5jb29yZGluYXRlcykge1xuICAgICAgICAgIHJldHVybiAnUG9seWdvbic7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgIFBhcnNlLkVycm9yLklOQ09SUkVDVF9UWVBFLFxuICAgICAgJ1RoaXMgaXMgbm90IGEgdmFsaWQgJyArIG9iai5fX3R5cGVcbiAgICApO1xuICB9XG4gIGlmIChvYmpbJyRuZSddKSB7XG4gICAgcmV0dXJuIGdldE9iamVjdFR5cGUob2JqWyckbmUnXSk7XG4gIH1cbiAgaWYgKG9iai5fX29wKSB7XG4gICAgc3dpdGNoIChvYmouX19vcCkge1xuICAgICAgY2FzZSAnSW5jcmVtZW50JzpcbiAgICAgICAgcmV0dXJuICdOdW1iZXInO1xuICAgICAgY2FzZSAnRGVsZXRlJzpcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICBjYXNlICdBZGQnOlxuICAgICAgY2FzZSAnQWRkVW5pcXVlJzpcbiAgICAgIGNhc2UgJ1JlbW92ZSc6XG4gICAgICAgIHJldHVybiAnQXJyYXknO1xuICAgICAgY2FzZSAnQWRkUmVsYXRpb24nOlxuICAgICAgY2FzZSAnUmVtb3ZlUmVsYXRpb24nOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHR5cGU6ICdSZWxhdGlvbicsXG4gICAgICAgICAgdGFyZ2V0Q2xhc3M6IG9iai5vYmplY3RzWzBdLmNsYXNzTmFtZSxcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgJ0JhdGNoJzpcbiAgICAgICAgcmV0dXJuIGdldE9iamVjdFR5cGUob2JqLm9wc1swXSk7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyAndW5leHBlY3RlZCBvcDogJyArIG9iai5fX29wO1xuICAgIH1cbiAgfVxuICByZXR1cm4gJ09iamVjdCc7XG59XG5cbmV4cG9ydCB7XG4gIGxvYWQsXG4gIGNsYXNzTmFtZUlzVmFsaWQsXG4gIGZpZWxkTmFtZUlzVmFsaWQsXG4gIGludmFsaWRDbGFzc05hbWVNZXNzYWdlLFxuICBidWlsZE1lcmdlZFNjaGVtYU9iamVjdCxcbiAgc3lzdGVtQ2xhc3NlcyxcbiAgZGVmYXVsdENvbHVtbnMsXG4gIGNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEsXG4gIFZvbGF0aWxlQ2xhc3Nlc1NjaGVtYXMsXG4gIFNjaGVtYUNvbnRyb2xsZXIsXG59O1xuIl19