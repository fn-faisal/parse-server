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
    id: {
      type: 'String'
    },
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9TY2hlbWFDb250cm9sbGVyLmpzIl0sIm5hbWVzIjpbIlBhcnNlIiwicmVxdWlyZSIsImRlZmF1bHRDb2x1bW5zIiwiT2JqZWN0IiwiZnJlZXplIiwiX0RlZmF1bHQiLCJvYmplY3RJZCIsInR5cGUiLCJjcmVhdGVkQXQiLCJ1cGRhdGVkQXQiLCJBQ0wiLCJfVXNlciIsInVzZXJuYW1lIiwicGFzc3dvcmQiLCJlbWFpbCIsImVtYWlsVmVyaWZpZWQiLCJhdXRoRGF0YSIsIl9JbnN0YWxsYXRpb24iLCJpbnN0YWxsYXRpb25JZCIsImRldmljZVRva2VuIiwiY2hhbm5lbHMiLCJkZXZpY2VUeXBlIiwicHVzaFR5cGUiLCJHQ01TZW5kZXJJZCIsInRpbWVab25lIiwibG9jYWxlSWRlbnRpZmllciIsImJhZGdlIiwiYXBwVmVyc2lvbiIsImFwcE5hbWUiLCJhcHBJZGVudGlmaWVyIiwicGFyc2VWZXJzaW9uIiwiX1JvbGUiLCJuYW1lIiwidXNlcnMiLCJ0YXJnZXRDbGFzcyIsInJvbGVzIiwiX1Nlc3Npb24iLCJyZXN0cmljdGVkIiwidXNlciIsInNlc3Npb25Ub2tlbiIsImV4cGlyZXNBdCIsImNyZWF0ZWRXaXRoIiwiX1Byb2R1Y3QiLCJwcm9kdWN0SWRlbnRpZmllciIsImRvd25sb2FkIiwiZG93bmxvYWROYW1lIiwiaWNvbiIsIm9yZGVyIiwidGl0bGUiLCJzdWJ0aXRsZSIsIl9QdXNoU3RhdHVzIiwicHVzaFRpbWUiLCJzb3VyY2UiLCJxdWVyeSIsInBheWxvYWQiLCJleHBpcnkiLCJleHBpcmF0aW9uX2ludGVydmFsIiwic3RhdHVzIiwibnVtU2VudCIsIm51bUZhaWxlZCIsInB1c2hIYXNoIiwiZXJyb3JNZXNzYWdlIiwic2VudFBlclR5cGUiLCJmYWlsZWRQZXJUeXBlIiwic2VudFBlclVUQ09mZnNldCIsImZhaWxlZFBlclVUQ09mZnNldCIsImNvdW50IiwiX0pvYlN0YXR1cyIsImpvYk5hbWUiLCJtZXNzYWdlIiwicGFyYW1zIiwiZmluaXNoZWRBdCIsIl9Kb2JTY2hlZHVsZSIsImRlc2NyaXB0aW9uIiwic3RhcnRBZnRlciIsImRheXNPZldlZWsiLCJ0aW1lT2ZEYXkiLCJsYXN0UnVuIiwicmVwZWF0TWludXRlcyIsIl9Ib29rcyIsImZ1bmN0aW9uTmFtZSIsImNsYXNzTmFtZSIsInRyaWdnZXJOYW1lIiwidXJsIiwiX0dsb2JhbENvbmZpZyIsIl9BdWRpZW5jZSIsImxhc3RVc2VkIiwidGltZXNVc2VkIiwiX0V4cG9ydFByb2dyZXNzIiwiaWQiLCJhcHBJZCIsIm1hc3RlcktleSIsInJlcXVpcmVkQ29sdW1ucyIsInN5c3RlbUNsYXNzZXMiLCJ2b2xhdGlsZUNsYXNzZXMiLCJ1c2VySWRSZWdleCIsInJvbGVSZWdleCIsInB1YmxpY1JlZ2V4IiwicmVxdWlyZUF1dGhlbnRpY2F0aW9uUmVnZXgiLCJwZXJtaXNzaW9uS2V5UmVnZXgiLCJ2ZXJpZnlQZXJtaXNzaW9uS2V5Iiwia2V5IiwicmVzdWx0IiwicmVkdWNlIiwiaXNHb29kIiwicmVnRXgiLCJtYXRjaCIsIkVycm9yIiwiSU5WQUxJRF9KU09OIiwiQ0xQVmFsaWRLZXlzIiwidmFsaWRhdGVDTFAiLCJwZXJtcyIsImZpZWxkcyIsImtleXMiLCJmb3JFYWNoIiwib3BlcmF0aW9uIiwiaW5kZXhPZiIsIkFycmF5IiwiaXNBcnJheSIsInBlcm0iLCJqb2luQ2xhc3NSZWdleCIsImNsYXNzQW5kRmllbGRSZWdleCIsImNsYXNzTmFtZUlzVmFsaWQiLCJ0ZXN0IiwiZmllbGROYW1lSXNWYWxpZCIsImZpZWxkTmFtZSIsImZpZWxkTmFtZUlzVmFsaWRGb3JDbGFzcyIsImludmFsaWRDbGFzc05hbWVNZXNzYWdlIiwiaW52YWxpZEpzb25FcnJvciIsInZhbGlkTm9uUmVsYXRpb25PclBvaW50ZXJUeXBlcyIsImZpZWxkVHlwZUlzSW52YWxpZCIsIklOVkFMSURfQ0xBU1NfTkFNRSIsInVuZGVmaW5lZCIsIklOQ09SUkVDVF9UWVBFIiwiY29udmVydFNjaGVtYVRvQWRhcHRlclNjaGVtYSIsInNjaGVtYSIsImluamVjdERlZmF1bHRTY2hlbWEiLCJfcnBlcm0iLCJfd3Blcm0iLCJfaGFzaGVkX3Bhc3N3b3JkIiwiY29udmVydEFkYXB0ZXJTY2hlbWFUb1BhcnNlU2NoZW1hIiwiaW5kZXhlcyIsImxlbmd0aCIsIlNjaGVtYURhdGEiLCJjb25zdHJ1Y3RvciIsImFsbFNjaGVtYXMiLCJfX2RhdGEiLCJkZWZpbmVQcm9wZXJ0eSIsImdldCIsImRhdGEiLCJjbGFzc0xldmVsUGVybWlzc2lvbnMiLCJkZWZhdWx0U2NoZW1hIiwiX0hvb2tzU2NoZW1hIiwiX0dsb2JhbENvbmZpZ1NjaGVtYSIsIl9QdXNoU3RhdHVzU2NoZW1hIiwiX0pvYlN0YXR1c1NjaGVtYSIsIl9Kb2JTY2hlZHVsZVNjaGVtYSIsIl9BdWRpZW5jZVNjaGVtYSIsIl9FeHBvcnRQcm9ncmVzc1NjaGVtYSIsIlZvbGF0aWxlQ2xhc3Nlc1NjaGVtYXMiLCJkYlR5cGVNYXRjaGVzT2JqZWN0VHlwZSIsImRiVHlwZSIsIm9iamVjdFR5cGUiLCJ0eXBlVG9TdHJpbmciLCJTY2hlbWFDb250cm9sbGVyIiwiZGF0YWJhc2VBZGFwdGVyIiwic2NoZW1hQ2FjaGUiLCJfZGJBZGFwdGVyIiwiX2NhY2hlIiwic2NoZW1hRGF0YSIsInJlbG9hZERhdGEiLCJvcHRpb25zIiwiY2xlYXJDYWNoZSIsInByb21pc2UiLCJQcm9taXNlIiwicmVzb2x2ZSIsInRoZW4iLCJjbGVhciIsInJlbG9hZERhdGFQcm9taXNlIiwiZ2V0QWxsQ2xhc3NlcyIsImVyciIsImFsbENsYXNzZXMiLCJtYXAiLCJzZXRBbGxDbGFzc2VzIiwiZ2V0T25lU2NoZW1hIiwiYWxsb3dWb2xhdGlsZUNsYXNzZXMiLCJjYWNoZWQiLCJnZXRDbGFzcyIsInNldE9uZVNjaGVtYSIsImFkZENsYXNzSWZOb3RFeGlzdHMiLCJ2YWxpZGF0aW9uRXJyb3IiLCJ2YWxpZGF0ZU5ld0NsYXNzIiwicmVqZWN0IiwiY3JlYXRlQ2xhc3MiLCJyZXMiLCJjYXRjaCIsImVycm9yIiwiY29kZSIsIkRVUExJQ0FURV9WQUxVRSIsInVwZGF0ZUNsYXNzIiwic3VibWl0dGVkRmllbGRzIiwiZGF0YWJhc2UiLCJleGlzdGluZ0ZpZWxkcyIsImZpZWxkIiwiX19vcCIsIm5ld1NjaGVtYSIsImJ1aWxkTWVyZ2VkU2NoZW1hT2JqZWN0IiwiZGVmYXVsdEZpZWxkcyIsImZ1bGxOZXdTY2hlbWEiLCJhc3NpZ24iLCJ2YWxpZGF0ZVNjaGVtYURhdGEiLCJkZWxldGVkRmllbGRzIiwiaW5zZXJ0ZWRGaWVsZHMiLCJwdXNoIiwiZGVsZXRlUHJvbWlzZSIsImRlbGV0ZUZpZWxkcyIsInByb21pc2VzIiwiZW5mb3JjZUZpZWxkRXhpc3RzIiwiYWxsIiwic2V0UGVybWlzc2lvbnMiLCJzZXRJbmRleGVzV2l0aFNjaGVtYUZvcm1hdCIsInJlbG9hZGVkU2NoZW1hIiwiZW5mb3JjZUNsYXNzRXhpc3RzIiwiZXhpc3RpbmdGaWVsZE5hbWVzIiwiSU5WQUxJRF9LRVlfTkFNRSIsImdlb1BvaW50cyIsImZpbHRlciIsInNldENsYXNzTGV2ZWxQZXJtaXNzaW9ucyIsInNwbGl0IiwiZXhwZWN0ZWRUeXBlIiwiZ2V0RXhwZWN0ZWRUeXBlIiwiYWRkRmllbGRJZk5vdEV4aXN0cyIsImRlbGV0ZUZpZWxkIiwiZmllbGROYW1lcyIsInNjaGVtYUZpZWxkcyIsImFkYXB0ZXIiLCJkZWxldGVDbGFzcyIsInZhbGlkYXRlT2JqZWN0Iiwib2JqZWN0IiwiZ2VvY291bnQiLCJleHBlY3RlZCIsImdldFR5cGUiLCJ0aGVuVmFsaWRhdGVSZXF1aXJlZENvbHVtbnMiLCJ2YWxpZGF0ZVJlcXVpcmVkQ29sdW1ucyIsImNvbHVtbnMiLCJtaXNzaW5nQ29sdW1ucyIsImNvbHVtbiIsInRlc3RQZXJtaXNzaW9uc0ZvckNsYXNzTmFtZSIsImFjbEdyb3VwIiwidGVzdFBlcm1pc3Npb25zIiwiZ2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zIiwiY2xhc3NQZXJtaXNzaW9ucyIsInNvbWUiLCJhY2wiLCJ2YWxpZGF0ZVBlcm1pc3Npb24iLCJPQkpFQ1RfTk9UX0ZPVU5EIiwicGVybWlzc2lvbkZpZWxkIiwiT1BFUkFUSU9OX0ZPUkJJRERFTiIsImhhc0NsYXNzIiwibG9hZCIsImRiQWRhcHRlciIsInB1dFJlcXVlc3QiLCJzeXNTY2hlbWFGaWVsZCIsIl9pZCIsIm9sZEZpZWxkIiwiZmllbGRJc0RlbGV0ZWQiLCJuZXdGaWVsZCIsInNjaGVtYVByb21pc2UiLCJvYmoiLCJnZXRPYmplY3RUeXBlIiwiX190eXBlIiwiaXNvIiwibGF0aXR1ZGUiLCJsb25naXR1ZGUiLCJiYXNlNjQiLCJjb29yZGluYXRlcyIsIm9iamVjdHMiLCJvcHMiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7O0FBa0JBOztBQUNBOzs7Ozs7Ozs7O0FBbEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsTUFBTUEsS0FBSyxHQUFHQyxPQUFPLENBQUMsWUFBRCxDQUFQLENBQXNCRCxLQUFwQzs7QUFXQSxNQUFNRSxjQUEwQyxHQUFHQyxNQUFNLENBQUNDLE1BQVAsQ0FBYztBQUMvRDtBQUNBQyxFQUFBQSxRQUFRLEVBQUU7QUFDUkMsSUFBQUEsUUFBUSxFQUFFO0FBQUVDLE1BQUFBLElBQUksRUFBRTtBQUFSLEtBREY7QUFFUkMsSUFBQUEsU0FBUyxFQUFFO0FBQUVELE1BQUFBLElBQUksRUFBRTtBQUFSLEtBRkg7QUFHUkUsSUFBQUEsU0FBUyxFQUFFO0FBQUVGLE1BQUFBLElBQUksRUFBRTtBQUFSLEtBSEg7QUFJUkcsSUFBQUEsR0FBRyxFQUFFO0FBQUVILE1BQUFBLElBQUksRUFBRTtBQUFSO0FBSkcsR0FGcUQ7QUFRL0Q7QUFDQUksRUFBQUEsS0FBSyxFQUFFO0FBQ0xDLElBQUFBLFFBQVEsRUFBRTtBQUFFTCxNQUFBQSxJQUFJLEVBQUU7QUFBUixLQURMO0FBRUxNLElBQUFBLFFBQVEsRUFBRTtBQUFFTixNQUFBQSxJQUFJLEVBQUU7QUFBUixLQUZMO0FBR0xP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LGdCQUFMO0FBQ0UsZUFBTztBQUNMck0sVUFBQUEsSUFBSSxFQUFFLFVBREQ7QUFFTDJCLFVBQUFBLFdBQVcsRUFBRTBPLEdBQUcsQ0FBQ1EsT0FBSixDQUFZLENBQVosRUFBZW5NO0FBRnZCLFNBQVA7O0FBSUYsV0FBSyxPQUFMO0FBQ0UsZUFBTzRMLGFBQWEsQ0FBQ0QsR0FBRyxDQUFDUyxHQUFKLENBQVEsQ0FBUixDQUFELENBQXBCOztBQUNGO0FBQ0UsY0FBTSxvQkFBb0JULEdBQUcsQ0FBQ2hFLElBQTlCO0FBbEJKO0FBb0JEOztBQUNELFNBQU8sUUFBUDtBQUNEIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQGZsb3dcbi8vIFRoaXMgY2xhc3MgaGFuZGxlcyBzY2hlbWEgdmFsaWRhdGlvbiwgcGVyc2lzdGVuY2UsIGFuZCBtb2RpZmljYXRpb24uXG4vL1xuLy8gRWFjaCBpbmRpdmlkdWFsIFNjaGVtYSBvYmplY3Qgc2hvdWxkIGJlIGltbXV0YWJsZS4gVGhlIGhlbHBlcnMgdG9cbi8vIGRvIHRoaW5ncyB3aXRoIHRoZSBTY2hlbWEganVzdCByZXR1cm4gYSBuZXcgc2NoZW1hIHdoZW4gdGhlIHNjaGVtYVxuLy8gaXMgY2hhbmdlZC5cbi8vXG4vLyBUaGUgY2Fub25pY2FsIHBsYWNlIHRvIHN0b3JlIHRoaXMgU2NoZW1hIGlzIGluIHRoZSBkYXRhYmFzZSBpdHNlbGYsXG4vLyBpbiBhIF9TQ0hFTUEgY29sbGVjdGlvbi4gVGhpcyBpcyBub3QgdGhlIHJpZ2h0IHdheSB0byBkbyBpdCBmb3IgYW5cbi8vIG9wZW4gc291cmNlIGZyYW1ld29yaywgYnV0IGl0J3MgYmFja3dhcmQgY29tcGF0aWJsZSwgc28gd2UncmVcbi8vIGtlZXBpbmcgaXQgdGhpcyB3YXkgZm9yIG5vdy5cbi8vXG4vLyBJbiBBUEktaGFuZGxpbmcgY29kZSwgeW91IHNob3VsZCBvbmx5IHVzZSB0aGUgU2NoZW1hIGNsYXNzIHZpYSB0aGVcbi8vIERhdGFiYXNlQ29udHJvbGxlci4gVGhpcyB3aWxsIGxldCB1cyByZXBsYWNlIHRoZSBzY2hlbWEgbG9naWMgZm9yXG4vLyBkaWZmZXJlbnQgZGF0YWJhc2VzLlxuLy8gVE9ETzogaGlkZSBhbGwgc2NoZW1hIGxvZ2ljIGluc2lkZSB0aGUgZGF0YWJhc2UgYWRhcHRlci5cbi8vIEBmbG93LWRpc2FibGUtbmV4dFxuY29uc3QgUGFyc2UgPSByZXF1aXJlKCdwYXJzZS9ub2RlJykuUGFyc2U7XG5pbXBvcnQgeyBTdG9yYWdlQWRhcHRlciB9IGZyb20gJy4uL0FkYXB0ZXJzL1N0b3JhZ2UvU3RvcmFnZUFkYXB0ZXInO1xuaW1wb3J0IERhdGFiYXNlQ29udHJvbGxlciBmcm9tICcuL0RhdGFiYXNlQ29udHJvbGxlcic7XG5pbXBvcnQgdHlwZSB7XG4gIFNjaGVtYSxcbiAgU2NoZW1hRmllbGRzLFxuICBDbGFzc0xldmVsUGVybWlzc2lvbnMsXG4gIFNjaGVtYUZpZWxkLFxuICBMb2FkU2NoZW1hT3B0aW9ucyxcbn0gZnJvbSAnLi90eXBlcyc7XG5cbmNvbnN0IGRlZmF1bHRDb2x1bW5zOiB7IFtzdHJpbmddOiBTY2hlbWFGaWVsZHMgfSA9IE9iamVjdC5mcmVlemUoe1xuICAvLyBDb250YWluIHRoZSBkZWZhdWx0IGNvbHVtbnMgZm9yIGV2ZXJ5IHBhcnNlIG9iamVjdCB0eXBlIChleGNlcHQgX0pvaW4gY29sbGVjdGlvbilcbiAgX0RlZmF1bHQ6IHtcbiAgICBvYmplY3RJZDogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGNyZWF0ZWRBdDogeyB0eXBlOiAnRGF0ZScgfSxcbiAgICB1cGRhdGVkQXQ6IHsgdHlwZTogJ0RhdGUnIH0sXG4gICAgQUNMOiB7IHR5cGU6ICdBQ0wnIH0sXG4gIH0sXG4gIC8vIFRoZSBhZGRpdGlvbmFsIGRlZmF1bHQgY29sdW1ucyBmb3IgdGhlIF9Vc2VyIGNvbGxlY3Rpb24gKGluIGFkZGl0aW9uIHRvIERlZmF1bHRDb2xzKVxuICBfVXNlcjoge1xuICAgIHVzZXJuYW1lOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgcGFzc3dvcmQ6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBlbWFpbDogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGVtYWlsVmVyaWZpZWQ6IHsgdHlwZTogJ0Jvb2xlYW4nIH0sXG4gICAgYXV0aERhdGE6IHsgdHlwZTogJ09iamVjdCcgfSxcbiAgfSxcbiAgLy8gVGhlIGFkZGl0aW9uYWwgZGVmYXVsdCBjb2x1bW5zIGZvciB0aGUgX0luc3RhbGxhdGlvbiBjb2xsZWN0aW9uIChpbiBhZGRpdGlvbiB0byBEZWZhdWx0Q29scylcbiAgX0luc3RhbGxhdGlvbjoge1xuICAgIGluc3RhbGxhdGlvbklkOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgZGV2aWNlVG9rZW46IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBjaGFubmVsczogeyB0eXBlOiAnQXJyYXknIH0sXG4gICAgZGV2aWNlVHlwZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHB1c2hUeXBlOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgR0NNU2VuZGVySWQ6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICB0aW1lWm9uZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGxvY2FsZUlkZW50aWZpZXI6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBiYWRnZTogeyB0eXBlOiAnTnVtYmVyJyB9LFxuICAgIGFwcFZlcnNpb246IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBhcHBOYW1lOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgYXBwSWRlbnRpZmllcjogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHBhcnNlVmVyc2lvbjogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICB9LFxuICAvLyBUaGUgYWRkaXRpb25hbCBkZWZhdWx0IGNvbHVtbnMgZm9yIHRoZSBfUm9sZSBjb2xsZWN0aW9uIChpbiBhZGRpdGlvbiB0byBEZWZhdWx0Q29scylcbiAgX1JvbGU6IHtcbiAgICBuYW1lOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgdXNlcnM6IHsgdHlwZTogJ1JlbGF0aW9uJywgdGFyZ2V0Q2xhc3M6ICdfVXNlcicgfSxcbiAgICByb2xlczogeyB0eXBlOiAnUmVsYXRpb24nLCB0YXJnZXRDbGFzczogJ19Sb2xlJyB9LFxuICB9LFxuICAvLyBUaGUgYWRkaXRpb25hbCBkZWZhdWx0IGNvbHVtbnMgZm9yIHRoZSBfU2Vzc2lvbiBjb2xsZWN0aW9uIChpbiBhZGRpdGlvbiB0byBEZWZhdWx0Q29scylcbiAgX1Nlc3Npb246IHtcbiAgICByZXN0cmljdGVkOiB7IHR5cGU6ICdCb29sZWFuJyB9LFxuICAgIHVzZXI6IHsgdHlwZTogJ1BvaW50ZXInLCB0YXJnZXRDbGFzczogJ19Vc2VyJyB9LFxuICAgIGluc3RhbGxhdGlvbklkOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgc2Vzc2lvblRva2VuOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgZXhwaXJlc0F0OiB7IHR5cGU6ICdEYXRlJyB9LFxuICAgIGNyZWF0ZWRXaXRoOiB7IHR5cGU6ICdPYmplY3QnIH0sXG4gIH0sXG4gIF9Qcm9kdWN0OiB7XG4gICAgcHJvZHVjdElkZW50aWZpZXI6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBkb3dubG9hZDogeyB0eXBlOiAnRmlsZScgfSxcbiAgICBkb3dubG9hZE5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBpY29uOiB7IHR5cGU6ICdGaWxlJyB9LFxuICAgIG9yZGVyOiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gICAgdGl0bGU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBzdWJ0aXRsZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICB9LFxuICBfUHVzaFN0YXR1czoge1xuICAgIHB1c2hUaW1lOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgc291cmNlOiB7IHR5cGU6ICdTdHJpbmcnIH0sIC8vIHJlc3Qgb3Igd2VidWlcbiAgICBxdWVyeTogeyB0eXBlOiAnU3RyaW5nJyB9LCAvLyB0aGUgc3RyaW5naWZpZWQgSlNPTiBxdWVyeVxuICAgIHBheWxvYWQ6IHsgdHlwZTogJ1N0cmluZycgfSwgLy8gdGhlIHN0cmluZ2lmaWVkIEpTT04gcGF5bG9hZCxcbiAgICB0aXRsZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGV4cGlyeTogeyB0eXBlOiAnTnVtYmVyJyB9LFxuICAgIGV4cGlyYXRpb25faW50ZXJ2YWw6IHsgdHlwZTogJ051bWJlcicgfSxcbiAgICBzdGF0dXM6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBudW1TZW50OiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gICAgbnVtRmFpbGVkOiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gICAgcHVzaEhhc2g6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBlcnJvck1lc3NhZ2U6IHsgdHlwZTogJ09iamVjdCcgfSxcbiAgICBzZW50UGVyVHlwZTogeyB0eXBlOiAnT2JqZWN0JyB9LFxuICAgIGZhaWxlZFBlclR5cGU6IHsgdHlwZTogJ09iamVjdCcgfSxcbiAgICBzZW50UGVyVVRDT2Zmc2V0OiB7IHR5cGU6ICdPYmplY3QnIH0sXG4gICAgZmFpbGVkUGVyVVRDT2Zmc2V0OiB7IHR5cGU6ICdPYmplY3QnIH0sXG4gICAgY291bnQ6IHsgdHlwZTogJ051bWJlcicgfSwgLy8gdHJhY2tzICMgb2YgYmF0Y2hlcyBxdWV1ZWQgYW5kIHBlbmRpbmdcbiAgfSxcbiAgX0pvYlN0YXR1czoge1xuICAgIGpvYk5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBzb3VyY2U6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBzdGF0dXM6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBtZXNzYWdlOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgcGFyYW1zOiB7IHR5cGU6ICdPYmplY3QnIH0sIC8vIHBhcmFtcyByZWNlaXZlZCB3aGVuIGNhbGxpbmcgdGhlIGpvYlxuICAgIGZpbmlzaGVkQXQ6IHsgdHlwZTogJ0RhdGUnIH0sXG4gIH0sXG4gIF9Kb2JTY2hlZHVsZToge1xuICAgIGpvYk5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBkZXNjcmlwdGlvbjogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHBhcmFtczogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHN0YXJ0QWZ0ZXI6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBkYXlzT2ZXZWVrOiB7IHR5cGU6ICdBcnJheScgfSxcbiAgICB0aW1lT2ZEYXk6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBsYXN0UnVuOiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gICAgcmVwZWF0TWludXRlczogeyB0eXBlOiAnTnVtYmVyJyB9LFxuICB9LFxuICBfSG9va3M6IHtcbiAgICBmdW5jdGlvbk5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBjbGFzc05hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICB0cmlnZ2VyTmFtZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHVybDogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICB9LFxuICBfR2xvYmFsQ29uZmlnOiB7XG4gICAgb2JqZWN0SWQ6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBwYXJhbXM6IHsgdHlwZTogJ09iamVjdCcgfSxcbiAgfSxcbiAgX0F1ZGllbmNlOiB7XG4gICAgb2JqZWN0SWQ6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBuYW1lOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgcXVlcnk6IHsgdHlwZTogJ1N0cmluZycgfSwgLy9zdG9yaW5nIHF1ZXJ5IGFzIEpTT04gc3RyaW5nIHRvIHByZXZlbnQgXCJOZXN0ZWQga2V5cyBzaG91bGQgbm90IGNvbnRhaW4gdGhlICckJyBvciAnLicgY2hhcmFjdGVyc1wiIGVycm9yXG4gICAgbGFzdFVzZWQ6IHsgdHlwZTogJ0RhdGUnIH0sXG4gICAgdGltZXNVc2VkOiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gIH0sXG4gIF9FeHBvcnRQcm9ncmVzczoge1xuICAgIGlkOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgYXBwSWQ6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBtYXN0ZXJLZXk6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgfSxcbn0pO1xuXG5jb25zdCByZXF1aXJlZENvbHVtbnMgPSBPYmplY3QuZnJlZXplKHtcbiAgX1Byb2R1Y3Q6IFsncHJvZHVjdElkZW50aWZpZXInLCAnaWNvbicsICdvcmRlcicsICd0aXRsZScsICdzdWJ0aXRsZSddLFxuICBfUm9sZTogWyduYW1lJywgJ0FDTCddLFxufSk7XG5cbmNvbnN0IHN5c3RlbUNsYXNzZXMgPSBPYmplY3QuZnJlZXplKFtcbiAgJ19Vc2VyJyxcbiAgJ19JbnN0YWxsYXRpb24nLFxuICAnX1JvbGUnLFxuICAnX1Nlc3Npb24nLFxuICAnX1Byb2R1Y3QnLFxuICAnX1B1c2hTdGF0dXMnLFxuICAnX0pvYlN0YXR1cycsXG4gICdfSm9iU2NoZWR1bGUnLFxuICAnX0F1ZGllbmNlJyxcbiAgJ19FeHBvcnRQcm9ncmVzcycsXG5dKTtcblxuY29uc3Qgdm9sYXRpbGVDbGFzc2VzID0gT2JqZWN0LmZyZWV6ZShbXG4gICdfSm9iU3RhdHVzJyxcbiAgJ19QdXNoU3RhdHVzJyxcbiAgJ19Ib29rcycsXG4gICdfR2xvYmFsQ29uZmlnJyxcbiAgJ19Kb2JTY2hlZHVsZScsXG4gICdfQXVkaWVuY2UnLFxuICAnX0V4cG9ydFByb2dyZXNzJyxcbl0pO1xuXG4vLyAxMCBhbHBoYSBudW1iZXJpYyBjaGFycyArIHVwcGVyY2FzZVxuY29uc3QgdXNlcklkUmVnZXggPSAvXlthLXpBLVowLTldezEwfSQvO1xuLy8gQW55dGhpbmcgdGhhdCBzdGFydCB3aXRoIHJvbGVcbmNvbnN0IHJvbGVSZWdleCA9IC9ecm9sZTouKi87XG4vLyAqIHBlcm1pc3Npb25cbmNvbnN0IHB1YmxpY1JlZ2V4ID0gL15cXCokLztcblxuY29uc3QgcmVxdWlyZUF1dGhlbnRpY2F0aW9uUmVnZXggPSAvXnJlcXVpcmVzQXV0aGVudGljYXRpb24kLztcblxuY29uc3QgcGVybWlzc2lvbktleVJlZ2V4ID0gT2JqZWN0LmZyZWV6ZShbXG4gIHVzZXJJZFJlZ2V4LFxuICByb2xlUmVnZXgsXG4gIHB1YmxpY1JlZ2V4LFxuICByZXF1aXJlQXV0aGVudGljYXRpb25SZWdleCxcbl0pO1xuXG5mdW5jdGlvbiB2ZXJpZnlQZXJtaXNzaW9uS2V5KGtleSkge1xuICBjb25zdCByZXN1bHQgPSBwZXJtaXNzaW9uS2V5UmVnZXgucmVkdWNlKChpc0dvb2QsIHJlZ0V4KSA9PiB7XG4gICAgaXNHb29kID0gaXNHb29kIHx8IGtleS5tYXRjaChyZWdFeCkgIT0gbnVsbDtcbiAgICByZXR1cm4gaXNHb29kO1xuICB9LCBmYWxzZSk7XG4gIGlmICghcmVzdWx0KSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgYCcke2tleX0nIGlzIG5vdCBhIHZhbGlkIGtleSBmb3IgY2xhc3MgbGV2ZWwgcGVybWlzc2lvbnNgXG4gICAgKTtcbiAgfVxufVxuXG5jb25zdCBDTFBWYWxpZEtleXMgPSBPYmplY3QuZnJlZXplKFtcbiAgJ2ZpbmQnLFxuICAnY291bnQnLFxuICAnZ2V0JyxcbiAgJ2NyZWF0ZScsXG4gICd1cGRhdGUnLFxuICAnZGVsZXRlJyxcbiAgJ2FkZEZpZWxkJyxcbiAgJ3JlYWRVc2VyRmllbGRzJyxcbiAgJ3dyaXRlVXNlckZpZWxkcycsXG5dKTtcbmZ1bmN0aW9uIHZhbGlkYXRlQ0xQKHBlcm1zOiBDbGFzc0xldmVsUGVybWlzc2lvbnMsIGZpZWxkczogU2NoZW1hRmllbGRzKSB7XG4gIGlmICghcGVybXMpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgT2JqZWN0LmtleXMocGVybXMpLmZvckVhY2gob3BlcmF0aW9uID0+IHtcbiAgICBpZiAoQ0xQVmFsaWRLZXlzLmluZGV4T2Yob3BlcmF0aW9uKSA9PSAtMSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgIGAke29wZXJhdGlvbn0gaXMgbm90IGEgdmFsaWQgb3BlcmF0aW9uIGZvciBjbGFzcyBsZXZlbCBwZXJtaXNzaW9uc2BcbiAgICAgICk7XG4gICAgfVxuICAgIGlmICghcGVybXNbb3BlcmF0aW9uXSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChvcGVyYXRpb24gPT09ICdyZWFkVXNlckZpZWxkcycgfHwgb3BlcmF0aW9uID09PSAnd3JpdGVVc2VyRmllbGRzJykge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHBlcm1zW29wZXJhdGlvbl0pKSB7XG4gICAgICAgIC8vIEBmbG93LWRpc2FibGUtbmV4dFxuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgIGAnJHtcbiAgICAgICAgICAgIHBlcm1zW29wZXJhdGlvbl1cbiAgICAgICAgICB9JyBpcyBub3QgYSB2YWxpZCB2YWx1ZSBmb3IgY2xhc3MgbGV2ZWwgcGVybWlzc2lvbnMgJHtvcGVyYXRpb259YFxuICAgICAgICApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcGVybXNbb3BlcmF0aW9uXS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgICAgaWYgKFxuICAgICAgICAgICAgIWZpZWxkc1trZXldIHx8XG4gICAgICAgICAgICBmaWVsZHNba2V5XS50eXBlICE9ICdQb2ludGVyJyB8fFxuICAgICAgICAgICAgZmllbGRzW2tleV0udGFyZ2V0Q2xhc3MgIT0gJ19Vc2VyJ1xuICAgICAgICAgICkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgICAgIGAnJHtrZXl9JyBpcyBub3QgYSB2YWxpZCBjb2x1bW4gZm9yIGNsYXNzIGxldmVsIHBvaW50ZXIgcGVybWlzc2lvbnMgJHtvcGVyYXRpb259YFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIEBmbG93LWRpc2FibGUtbmV4dFxuICAgIE9iamVjdC5rZXlzKHBlcm1zW29wZXJhdGlvbl0pLmZvckVhY2goa2V5ID0+IHtcbiAgICAgIHZlcmlmeVBlcm1pc3Npb25LZXkoa2V5KTtcbiAgICAgIC8vIEBmbG93LWRpc2FibGUtbmV4dFxuICAgICAgY29uc3QgcGVybSA9IHBlcm1zW29wZXJhdGlvbl1ba2V5XTtcbiAgICAgIGlmIChwZXJtICE9PSB0cnVlKSB7XG4gICAgICAgIC8vIEBmbG93LWRpc2FibGUtbmV4dFxuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgIGAnJHtwZXJtfScgaXMgbm90IGEgdmFsaWQgdmFsdWUgZm9yIGNsYXNzIGxldmVsIHBlcm1pc3Npb25zICR7b3BlcmF0aW9ufToke2tleX06JHtwZXJtfWBcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSk7XG59XG5jb25zdCBqb2luQ2xhc3NSZWdleCA9IC9eX0pvaW46W0EtWmEtejAtOV9dKzpbQS1aYS16MC05X10rLztcbmNvbnN0IGNsYXNzQW5kRmllbGRSZWdleCA9IC9eW0EtWmEtel1bQS1aYS16MC05X10qJC87XG5mdW5jdGlvbiBjbGFzc05hbWVJc1ZhbGlkKGNsYXNzTmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIC8vIFZhbGlkIGNsYXNzZXMgbXVzdDpcbiAgcmV0dXJuIChcbiAgICAvLyBCZSBvbmUgb2YgX1VzZXIsIF9JbnN0YWxsYXRpb24sIF9Sb2xlLCBfU2Vzc2lvbiBPUlxuICAgIHN5c3RlbUNsYXNzZXMuaW5kZXhPZihjbGFzc05hbWUpID4gLTEgfHxcbiAgICAvLyBCZSBhIGpvaW4gdGFibGUgT1JcbiAgICBqb2luQ2xhc3NSZWdleC50ZXN0KGNsYXNzTmFtZSkgfHxcbiAgICAvLyBJbmNsdWRlIG9ubHkgYWxwaGEtbnVtZXJpYyBhbmQgdW5kZXJzY29yZXMsIGFuZCBub3Qgc3RhcnQgd2l0aCBhbiB1bmRlcnNjb3JlIG9yIG51bWJlclxuICAgIGZpZWxkTmFtZUlzVmFsaWQoY2xhc3NOYW1lKVxuICApO1xufVxuXG4vLyBWYWxpZCBmaWVsZHMgbXVzdCBiZSBhbHBoYS1udW1lcmljLCBhbmQgbm90IHN0YXJ0IHdpdGggYW4gdW5kZXJzY29yZSBvciBudW1iZXJcbmZ1bmN0aW9uIGZpZWxkTmFtZUlzVmFsaWQoZmllbGROYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIGNsYXNzQW5kRmllbGRSZWdleC50ZXN0KGZpZWxkTmFtZSk7XG59XG5cbi8vIENoZWNrcyB0aGF0IGl0J3Mgbm90IHRyeWluZyB0byBjbG9iYmVyIG9uZSBvZiB0aGUgZGVmYXVsdCBmaWVsZHMgb2YgdGhlIGNsYXNzLlxuZnVuY3Rpb24gZmllbGROYW1lSXNWYWxpZEZvckNsYXNzKFxuICBmaWVsZE5hbWU6IHN0cmluZyxcbiAgY2xhc3NOYW1lOiBzdHJpbmdcbik6IGJvb2xlYW4ge1xuICBpZiAoIWZpZWxkTmFtZUlzVmFsaWQoZmllbGROYW1lKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAoZGVmYXVsdENvbHVtbnMuX0RlZmF1bHRbZmllbGROYW1lXSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAoZGVmYXVsdENvbHVtbnNbY2xhc3NOYW1lXSAmJiBkZWZhdWx0Q29sdW1uc1tjbGFzc05hbWVdW2ZpZWxkTmFtZV0pIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgcmV0dXJuIHRydWU7XG59XG5cbmZ1bmN0aW9uIGludmFsaWRDbGFzc05hbWVNZXNzYWdlKGNsYXNzTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIChcbiAgICAnSW52YWxpZCBjbGFzc25hbWU6ICcgK1xuICAgIGNsYXNzTmFtZSArXG4gICAgJywgY2xhc3NuYW1lcyBjYW4gb25seSBoYXZlIGFscGhhbnVtZXJpYyBjaGFyYWN0ZXJzIGFuZCBfLCBhbmQgbXVzdCBzdGFydCB3aXRoIGFuIGFscGhhIGNoYXJhY3RlciAnXG4gICk7XG59XG5cbmNvbnN0IGludmFsaWRKc29uRXJyb3IgPSBuZXcgUGFyc2UuRXJyb3IoXG4gIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgJ2ludmFsaWQgSlNPTidcbik7XG5jb25zdCB2YWxpZE5vblJlbGF0aW9uT3JQb2ludGVyVHlwZXMgPSBbXG4gICdOdW1iZXInLFxuICAnU3RyaW5nJyxcbiAgJ0Jvb2xlYW4nLFxuICAnRGF0ZScsXG4gICdPYmplY3QnLFxuICAnQXJyYXknLFxuICAnR2VvUG9pbnQnLFxuICAnRmlsZScsXG4gICdCeXRlcycsXG4gICdQb2x5Z29uJyxcbl07XG4vLyBSZXR1cm5zIGFuIGVycm9yIHN1aXRhYmxlIGZvciB0aHJvd2luZyBpZiB0aGUgdHlwZSBpcyBpbnZhbGlkXG5jb25zdCBmaWVsZFR5cGVJc0ludmFsaWQgPSAoeyB0eXBlLCB0YXJnZXRDbGFzcyB9KSA9PiB7XG4gIGlmIChbJ1BvaW50ZXInLCAnUmVsYXRpb24nXS5pbmRleE9mKHR5cGUpID49IDApIHtcbiAgICBpZiAoIXRhcmdldENsYXNzKSB7XG4gICAgICByZXR1cm4gbmV3IFBhcnNlLkVycm9yKDEzNSwgYHR5cGUgJHt0eXBlfSBuZWVkcyBhIGNsYXNzIG5hbWVgKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiB0YXJnZXRDbGFzcyAhPT0gJ3N0cmluZycpIHtcbiAgICAgIHJldHVybiBpbnZhbGlkSnNvbkVycm9yO1xuICAgIH0gZWxzZSBpZiAoIWNsYXNzTmFtZUlzVmFsaWQodGFyZ2V0Q2xhc3MpKSB7XG4gICAgICByZXR1cm4gbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0NMQVNTX05BTUUsXG4gICAgICAgIGludmFsaWRDbGFzc05hbWVNZXNzYWdlKHRhcmdldENsYXNzKVxuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gIH1cbiAgaWYgKHR5cGVvZiB0eXBlICE9PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBpbnZhbGlkSnNvbkVycm9yO1xuICB9XG4gIGlmICh2YWxpZE5vblJlbGF0aW9uT3JQb2ludGVyVHlwZXMuaW5kZXhPZih0eXBlKSA8IDApIHtcbiAgICByZXR1cm4gbmV3IFBhcnNlLkVycm9yKFxuICAgICAgUGFyc2UuRXJyb3IuSU5DT1JSRUNUX1RZUEUsXG4gICAgICBgaW52YWxpZCBmaWVsZCB0eXBlOiAke3R5cGV9YFxuICAgICk7XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn07XG5cbmNvbnN0IGNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEgPSAoc2NoZW1hOiBhbnkpID0+IHtcbiAgc2NoZW1hID0gaW5qZWN0RGVmYXVsdFNjaGVtYShzY2hlbWEpO1xuICBkZWxldGUgc2NoZW1hLmZpZWxkcy5BQ0w7XG4gIHNjaGVtYS5maWVsZHMuX3JwZXJtID0geyB0eXBlOiAnQXJyYXknIH07XG4gIHNjaGVtYS5maWVsZHMuX3dwZXJtID0geyB0eXBlOiAnQXJyYXknIH07XG5cbiAgaWYgKHNjaGVtYS5jbGFzc05hbWUgPT09ICdfVXNlcicpIHtcbiAgICBkZWxldGUgc2NoZW1hLmZpZWxkcy5wYXNzd29yZDtcbiAgICBzY2hlbWEuZmllbGRzLl9oYXNoZWRfcGFzc3dvcmQgPSB7IHR5cGU6ICdTdHJpbmcnIH07XG4gIH1cblxuICByZXR1cm4gc2NoZW1hO1xufTtcblxuY29uc3QgY29udmVydEFkYXB0ZXJTY2hlbWFUb1BhcnNlU2NoZW1hID0gKHsgLi4uc2NoZW1hIH0pID0+IHtcbiAgZGVsZXRlIHNjaGVtYS5maWVsZHMuX3JwZXJtO1xuICBkZWxldGUgc2NoZW1hLmZpZWxkcy5fd3Blcm07XG5cbiAgc2NoZW1hLmZpZWxkcy5BQ0wgPSB7IHR5cGU6ICdBQ0wnIH07XG5cbiAgaWYgKHNjaGVtYS5jbGFzc05hbWUgPT09ICdfVXNlcicpIHtcbiAgICBkZWxldGUgc2NoZW1hLmZpZWxkcy5hdXRoRGF0YTsgLy9BdXRoIGRhdGEgaXMgaW1wbGljaXRcbiAgICBkZWxldGUgc2NoZW1hLmZpZWxkcy5faGFzaGVkX3Bhc3N3b3JkO1xuICAgIHNjaGVtYS5maWVsZHMucGFzc3dvcmQgPSB7IHR5cGU6ICdTdHJpbmcnIH07XG4gIH1cblxuICBpZiAoc2NoZW1hLmluZGV4ZXMgJiYgT2JqZWN0LmtleXMoc2NoZW1hLmluZGV4ZXMpLmxlbmd0aCA9PT0gMCkge1xuICAgIGRlbGV0ZSBzY2hlbWEuaW5kZXhlcztcbiAgfVxuXG4gIHJldHVybiBzY2hlbWE7XG59O1xuXG5jbGFzcyBTY2hlbWFEYXRhIHtcbiAgX19kYXRhOiBhbnk7XG4gIGNvbnN0cnVjdG9yKGFsbFNjaGVtYXMgPSBbXSkge1xuICAgIHRoaXMuX19kYXRhID0ge307XG4gICAgYWxsU2NoZW1hcy5mb3JFYWNoKHNjaGVtYSA9PiB7XG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgc2NoZW1hLmNsYXNzTmFtZSwge1xuICAgICAgICBnZXQ6ICgpID0+IHtcbiAgICAgICAgICBpZiAoIXRoaXMuX19kYXRhW3NjaGVtYS5jbGFzc05hbWVdKSB7XG4gICAgICAgICAgICBjb25zdCBkYXRhID0ge307XG4gICAgICAgICAgICBkYXRhLmZpZWxkcyA9IGluamVjdERlZmF1bHRTY2hlbWEoc2NoZW1hKS5maWVsZHM7XG4gICAgICAgICAgICBkYXRhLmNsYXNzTGV2ZWxQZXJtaXNzaW9ucyA9IHNjaGVtYS5jbGFzc0xldmVsUGVybWlzc2lvbnM7XG4gICAgICAgICAgICBkYXRhLmluZGV4ZXMgPSBzY2hlbWEuaW5kZXhlcztcbiAgICAgICAgICAgIHRoaXMuX19kYXRhW3NjaGVtYS5jbGFzc05hbWVdID0gZGF0YTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHRoaXMuX19kYXRhW3NjaGVtYS5jbGFzc05hbWVdO1xuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBJbmplY3QgdGhlIGluLW1lbW9yeSBjbGFzc2VzXG4gICAgdm9sYXRpbGVDbGFzc2VzLmZvckVhY2goY2xhc3NOYW1lID0+IHtcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0aGlzLCBjbGFzc05hbWUsIHtcbiAgICAgICAgZ2V0OiAoKSA9PiB7XG4gICAgICAgICAgaWYgKCF0aGlzLl9fZGF0YVtjbGFzc05hbWVdKSB7XG4gICAgICAgICAgICBjb25zdCBzY2hlbWEgPSBpbmplY3REZWZhdWx0U2NoZW1hKHtcbiAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICBmaWVsZHM6IHt9LFxuICAgICAgICAgICAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IHt9LFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBjb25zdCBkYXRhID0ge307XG4gICAgICAgICAgICBkYXRhLmZpZWxkcyA9IHNjaGVtYS5maWVsZHM7XG4gICAgICAgICAgICBkYXRhLmNsYXNzTGV2ZWxQZXJtaXNzaW9ucyA9IHNjaGVtYS5jbGFzc0xldmVsUGVybWlzc2lvbnM7XG4gICAgICAgICAgICBkYXRhLmluZGV4ZXMgPSBzY2hlbWEuaW5kZXhlcztcbiAgICAgICAgICAgIHRoaXMuX19kYXRhW2NsYXNzTmFtZV0gPSBkYXRhO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gdGhpcy5fX2RhdGFbY2xhc3NOYW1lXTtcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG59XG5cbmNvbnN0IGluamVjdERlZmF1bHRTY2hlbWEgPSAoe1xuICBjbGFzc05hbWUsXG4gIGZpZWxkcyxcbiAgY2xhc3NMZXZlbFBlcm1pc3Npb25zLFxuICBpbmRleGVzLFxufTogU2NoZW1hKSA9PiB7XG4gIGNvbnN0IGRlZmF1bHRTY2hlbWE6IFNjaGVtYSA9IHtcbiAgICBjbGFzc05hbWUsXG4gICAgZmllbGRzOiB7XG4gICAgICAuLi5kZWZhdWx0Q29sdW1ucy5fRGVmYXVsdCxcbiAgICAgIC4uLihkZWZhdWx0Q29sdW1uc1tjbGFzc05hbWVdIHx8IHt9KSxcbiAgICAgIC4uLmZpZWxkcyxcbiAgICB9LFxuICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgfTtcbiAgaWYgKGluZGV4ZXMgJiYgT2JqZWN0LmtleXMoaW5kZXhlcykubGVuZ3RoICE9PSAwKSB7XG4gICAgZGVmYXVsdFNjaGVtYS5pbmRleGVzID0gaW5kZXhlcztcbiAgfVxuICByZXR1cm4gZGVmYXVsdFNjaGVtYTtcbn07XG5cbmNvbnN0IF9Ib29rc1NjaGVtYSA9IHsgY2xhc3NOYW1lOiAnX0hvb2tzJywgZmllbGRzOiBkZWZhdWx0Q29sdW1ucy5fSG9va3MgfTtcbmNvbnN0IF9HbG9iYWxDb25maWdTY2hlbWEgPSB7XG4gIGNsYXNzTmFtZTogJ19HbG9iYWxDb25maWcnLFxuICBmaWVsZHM6IGRlZmF1bHRDb2x1bW5zLl9HbG9iYWxDb25maWcsXG59O1xuY29uc3QgX1B1c2hTdGF0dXNTY2hlbWEgPSBjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hKFxuICBpbmplY3REZWZhdWx0U2NoZW1hKHtcbiAgICBjbGFzc05hbWU6ICdfUHVzaFN0YXR1cycsXG4gICAgZmllbGRzOiB7fSxcbiAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IHt9LFxuICB9KVxuKTtcbmNvbnN0IF9Kb2JTdGF0dXNTY2hlbWEgPSBjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hKFxuICBpbmplY3REZWZhdWx0U2NoZW1hKHtcbiAgICBjbGFzc05hbWU6ICdfSm9iU3RhdHVzJyxcbiAgICBmaWVsZHM6IHt9LFxuICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczoge30sXG4gIH0pXG4pO1xuY29uc3QgX0pvYlNjaGVkdWxlU2NoZW1hID0gY29udmVydFNjaGVtYVRvQWRhcHRlclNjaGVtYShcbiAgaW5qZWN0RGVmYXVsdFNjaGVtYSh7XG4gICAgY2xhc3NOYW1lOiAnX0pvYlNjaGVkdWxlJyxcbiAgICBmaWVsZHM6IHt9LFxuICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczoge30sXG4gIH0pXG4pO1xuY29uc3QgX0F1ZGllbmNlU2NoZW1hID0gY29udmVydFNjaGVtYVRvQWRhcHRlclNjaGVtYShcbiAgaW5qZWN0RGVmYXVsdFNjaGVtYSh7XG4gICAgY2xhc3NOYW1lOiAnX0F1ZGllbmNlJyxcbiAgICBmaWVsZHM6IGRlZmF1bHRDb2x1bW5zLl9BdWRpZW5jZSxcbiAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IHt9LFxuICB9KVxuKTtcbmNvbnN0IF9FeHBvcnRQcm9ncmVzc1NjaGVtYSA9IGNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEoXG4gIGluamVjdERlZmF1bHRTY2hlbWEoe1xuICAgIGNsYXNzTmFtZTogJ19FeHBvcnRQcm9ncmVzcycsXG4gICAgZmllbGRzOiBkZWZhdWx0Q29sdW1ucy5fRXhwb3J0UHJvZ3Jlc3MsXG4gICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiB7fSxcbiAgfSlcbik7XG5jb25zdCBWb2xhdGlsZUNsYXNzZXNTY2hlbWFzID0gW1xuICBfSG9va3NTY2hlbWEsXG4gIF9Kb2JTdGF0dXNTY2hlbWEsXG4gIF9Kb2JTY2hlZHVsZVNjaGVtYSxcbiAgX1B1c2hTdGF0dXNTY2hlbWEsXG4gIF9HbG9iYWxDb25maWdTY2hlbWEsXG4gIF9BdWRpZW5jZVNjaGVtYSxcbiAgX0V4cG9ydFByb2dyZXNzU2NoZW1hLFxuXTtcblxuY29uc3QgZGJUeXBlTWF0Y2hlc09iamVjdFR5cGUgPSAoXG4gIGRiVHlwZTogU2NoZW1hRmllbGQgfCBzdHJpbmcsXG4gIG9iamVjdFR5cGU6IFNjaGVtYUZpZWxkXG4pID0+IHtcbiAgaWYgKGRiVHlwZS50eXBlICE9PSBvYmplY3RUeXBlLnR5cGUpIHJldHVybiBmYWxzZTtcbiAgaWYgKGRiVHlwZS50YXJnZXRDbGFzcyAhPT0gb2JqZWN0VHlwZS50YXJnZXRDbGFzcykgcmV0dXJuIGZhbHNlO1xuICBpZiAoZGJUeXBlID09PSBvYmplY3RUeXBlLnR5cGUpIHJldHVybiB0cnVlO1xuICBpZiAoZGJUeXBlLnR5cGUgPT09IG9iamVjdFR5cGUudHlwZSkgcmV0dXJuIHRydWU7XG4gIHJldHVybiBmYWxzZTtcbn07XG5cbmNvbnN0IHR5cGVUb1N0cmluZyA9ICh0eXBlOiBTY2hlbWFGaWVsZCB8IHN0cmluZyk6IHN0cmluZyA9PiB7XG4gIGlmICh0eXBlb2YgdHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gdHlwZTtcbiAgfVxuICBpZiAodHlwZS50YXJnZXRDbGFzcykge1xuICAgIHJldHVybiBgJHt0eXBlLnR5cGV9PCR7dHlwZS50YXJnZXRDbGFzc30+YDtcbiAgfVxuICByZXR1cm4gYCR7dHlwZS50eXBlfWA7XG59O1xuXG4vLyBTdG9yZXMgdGhlIGVudGlyZSBzY2hlbWEgb2YgdGhlIGFwcCBpbiBhIHdlaXJkIGh5YnJpZCBmb3JtYXQgc29tZXdoZXJlIGJldHdlZW5cbi8vIHRoZSBtb25nbyBmb3JtYXQgYW5kIHRoZSBQYXJzZSBmb3JtYXQuIFNvb24sIHRoaXMgd2lsbCBhbGwgYmUgUGFyc2UgZm9ybWF0LlxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgU2NoZW1hQ29udHJvbGxlciB7XG4gIF9kYkFkYXB0ZXI6IFN0b3JhZ2VBZGFwdGVyO1xuICBzY2hlbWFEYXRhOiB7IFtzdHJpbmddOiBTY2hlbWEgfTtcbiAgX2NhY2hlOiBhbnk7XG4gIHJlbG9hZERhdGFQcm9taXNlOiBQcm9taXNlPGFueT47XG5cbiAgY29uc3RydWN0b3IoZGF0YWJhc2VBZGFwdGVyOiBTdG9yYWdlQWRhcHRlciwgc2NoZW1hQ2FjaGU6IGFueSkge1xuICAgIHRoaXMuX2RiQWRhcHRlciA9IGRhdGFiYXNlQWRhcHRlcjtcbiAgICB0aGlzLl9jYWNoZSA9IHNjaGVtYUNhY2hlO1xuICAgIHRoaXMuc2NoZW1hRGF0YSA9IG5ldyBTY2hlbWFEYXRhKCk7XG4gIH1cblxuICByZWxvYWREYXRhKG9wdGlvbnM6IExvYWRTY2hlbWFPcHRpb25zID0geyBjbGVhckNhY2hlOiBmYWxzZSB9KTogUHJvbWlzZTxhbnk+IHtcbiAgICBsZXQgcHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xuICAgIGlmIChvcHRpb25zLmNsZWFyQ2FjaGUpIHtcbiAgICAgIHByb21pc2UgPSBwcm9taXNlLnRoZW4oKCkgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5fY2FjaGUuY2xlYXIoKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICBpZiAodGhpcy5yZWxvYWREYXRhUHJvbWlzZSAmJiAhb3B0aW9ucy5jbGVhckNhY2hlKSB7XG4gICAgICByZXR1cm4gdGhpcy5yZWxvYWREYXRhUHJvbWlzZTtcbiAgICB9XG4gICAgdGhpcy5yZWxvYWREYXRhUHJvbWlzZSA9IHByb21pc2VcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0QWxsQ2xhc3NlcyhvcHRpb25zKS50aGVuKFxuICAgICAgICAgIGFsbFNjaGVtYXMgPT4ge1xuICAgICAgICAgICAgdGhpcy5zY2hlbWFEYXRhID0gbmV3IFNjaGVtYURhdGEoYWxsU2NoZW1hcyk7XG4gICAgICAgICAgICBkZWxldGUgdGhpcy5yZWxvYWREYXRhUHJvbWlzZTtcbiAgICAgICAgICB9LFxuICAgICAgICAgIGVyciA9PiB7XG4gICAgICAgICAgICB0aGlzLnNjaGVtYURhdGEgPSBuZXcgU2NoZW1hRGF0YSgpO1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMucmVsb2FkRGF0YVByb21pc2U7XG4gICAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgICAgfVxuICAgICAgICApO1xuICAgICAgfSlcbiAgICAgIC50aGVuKCgpID0+IHt9KTtcbiAgICByZXR1cm4gdGhpcy5yZWxvYWREYXRhUHJvbWlzZTtcbiAgfVxuXG4gIGdldEFsbENsYXNzZXMoXG4gICAgb3B0aW9uczogTG9hZFNjaGVtYU9wdGlvbnMgPSB7IGNsZWFyQ2FjaGU6IGZhbHNlIH1cbiAgKTogUHJvbWlzZTxBcnJheTxTY2hlbWE+PiB7XG4gICAgbGV0IHByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKTtcbiAgICBpZiAob3B0aW9ucy5jbGVhckNhY2hlKSB7XG4gICAgICBwcm9taXNlID0gdGhpcy5fY2FjaGUuY2xlYXIoKTtcbiAgICB9XG4gICAgcmV0dXJuIHByb21pc2VcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2NhY2hlLmdldEFsbENsYXNzZXMoKTtcbiAgICAgIH0pXG4gICAgICAudGhlbihhbGxDbGFzc2VzID0+IHtcbiAgICAgICAgaWYgKGFsbENsYXNzZXMgJiYgYWxsQ2xhc3Nlcy5sZW5ndGggJiYgIW9wdGlvbnMuY2xlYXJDYWNoZSkge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoYWxsQ2xhc3Nlcyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX2RiQWRhcHRlclxuICAgICAgICAgIC5nZXRBbGxDbGFzc2VzKClcbiAgICAgICAgICAudGhlbihhbGxTY2hlbWFzID0+IGFsbFNjaGVtYXMubWFwKGluamVjdERlZmF1bHRTY2hlbWEpKVxuICAgICAgICAgIC50aGVuKGFsbFNjaGVtYXMgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2NhY2hlLnNldEFsbENsYXNzZXMoYWxsU2NoZW1hcykudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgIHJldHVybiBhbGxTY2hlbWFzO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgfVxuXG4gIGdldE9uZVNjaGVtYShcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBhbGxvd1ZvbGF0aWxlQ2xhc3NlczogYm9vbGVhbiA9IGZhbHNlLFxuICAgIG9wdGlvbnM6IExvYWRTY2hlbWFPcHRpb25zID0geyBjbGVhckNhY2hlOiBmYWxzZSB9XG4gICk6IFByb21pc2U8U2NoZW1hPiB7XG4gICAgbGV0IHByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKTtcbiAgICBpZiAob3B0aW9ucy5jbGVhckNhY2hlKSB7XG4gICAgICBwcm9taXNlID0gdGhpcy5fY2FjaGUuY2xlYXIoKTtcbiAgICB9XG4gICAgcmV0dXJuIHByb21pc2UudGhlbigoKSA9PiB7XG4gICAgICBpZiAoYWxsb3dWb2xhdGlsZUNsYXNzZXMgJiYgdm9sYXRpbGVDbGFzc2VzLmluZGV4T2YoY2xhc3NOYW1lKSA+IC0xKSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSB0aGlzLnNjaGVtYURhdGFbY2xhc3NOYW1lXTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7XG4gICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgIGZpZWxkczogZGF0YS5maWVsZHMsXG4gICAgICAgICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiBkYXRhLmNsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgICAgICAgICBpbmRleGVzOiBkYXRhLmluZGV4ZXMsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXMuX2NhY2hlLmdldE9uZVNjaGVtYShjbGFzc05hbWUpLnRoZW4oY2FjaGVkID0+IHtcbiAgICAgICAgaWYgKGNhY2hlZCAmJiAhb3B0aW9ucy5jbGVhckNhY2hlKSB7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShjYWNoZWQpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9kYkFkYXB0ZXJcbiAgICAgICAgICAuZ2V0Q2xhc3MoY2xhc3NOYW1lKVxuICAgICAgICAgIC50aGVuKGluamVjdERlZmF1bHRTY2hlbWEpXG4gICAgICAgICAgLnRoZW4ocmVzdWx0ID0+IHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9jYWNoZS5zZXRPbmVTY2hlbWEoY2xhc3NOYW1lLCByZXN1bHQpLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIENyZWF0ZSBhIG5ldyBjbGFzcyB0aGF0IGluY2x1ZGVzIHRoZSB0aHJlZSBkZWZhdWx0IGZpZWxkcy5cbiAgLy8gQUNMIGlzIGFuIGltcGxpY2l0IGNvbHVtbiB0aGF0IGRvZXMgbm90IGdldCBhbiBlbnRyeSBpbiB0aGVcbiAgLy8gX1NDSEVNQVMgZGF0YWJhc2UuIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2l0aCB0aGVcbiAgLy8gY3JlYXRlZCBzY2hlbWEsIGluIG1vbmdvIGZvcm1hdC5cbiAgLy8gb24gc3VjY2VzcywgYW5kIHJlamVjdHMgd2l0aCBhbiBlcnJvciBvbiBmYWlsLiBFbnN1cmUgeW91XG4gIC8vIGhhdmUgYXV0aG9yaXphdGlvbiAobWFzdGVyIGtleSwgb3IgY2xpZW50IGNsYXNzIGNyZWF0aW9uXG4gIC8vIGVuYWJsZWQpIGJlZm9yZSBjYWxsaW5nIHRoaXMgZnVuY3Rpb24uXG4gIGFkZENsYXNzSWZOb3RFeGlzdHMoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgZmllbGRzOiBTY2hlbWFGaWVsZHMgPSB7fSxcbiAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IGFueSxcbiAgICBpbmRleGVzOiBhbnkgPSB7fVxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB2YXIgdmFsaWRhdGlvbkVycm9yID0gdGhpcy52YWxpZGF0ZU5ld0NsYXNzKFxuICAgICAgY2xhc3NOYW1lLFxuICAgICAgZmllbGRzLFxuICAgICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zXG4gICAgKTtcbiAgICBpZiAodmFsaWRhdGlvbkVycm9yKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QodmFsaWRhdGlvbkVycm9yKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fZGJBZGFwdGVyXG4gICAgICAuY3JlYXRlQ2xhc3MoXG4gICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgY29udmVydFNjaGVtYVRvQWRhcHRlclNjaGVtYSh7XG4gICAgICAgICAgZmllbGRzLFxuICAgICAgICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgICAgICAgICBpbmRleGVzLFxuICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgfSlcbiAgICAgIClcbiAgICAgIC50aGVuKGNvbnZlcnRBZGFwdGVyU2NoZW1hVG9QYXJzZVNjaGVtYSlcbiAgICAgIC50aGVuKHJlcyA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLl9jYWNoZS5jbGVhcigpLnRoZW4oKCkgPT4ge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUocmVzKTtcbiAgICAgICAgfSk7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKGVycm9yICYmIGVycm9yLmNvZGUgPT09IFBhcnNlLkVycm9yLkRVUExJQ0FURV9WQUxVRSkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfQ0xBU1NfTkFNRSxcbiAgICAgICAgICAgIGBDbGFzcyAke2NsYXNzTmFtZX0gYWxyZWFkeSBleGlzdHMuYFxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9XG5cbiAgdXBkYXRlQ2xhc3MoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgc3VibWl0dGVkRmllbGRzOiBTY2hlbWFGaWVsZHMsXG4gICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiBhbnksXG4gICAgaW5kZXhlczogYW55LFxuICAgIGRhdGFiYXNlOiBEYXRhYmFzZUNvbnRyb2xsZXJcbiAgKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0T25lU2NoZW1hKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKHNjaGVtYSA9PiB7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nRmllbGRzID0gc2NoZW1hLmZpZWxkcztcbiAgICAgICAgT2JqZWN0LmtleXMoc3VibWl0dGVkRmllbGRzKS5mb3JFYWNoKG5hbWUgPT4ge1xuICAgICAgICAgIGNvbnN0IGZpZWxkID0gc3VibWl0dGVkRmllbGRzW25hbWVdO1xuICAgICAgICAgIGlmIChleGlzdGluZ0ZpZWxkc1tuYW1lXSAmJiBmaWVsZC5fX29wICE9PSAnRGVsZXRlJykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDI1NSwgYEZpZWxkICR7bmFtZX0gZXhpc3RzLCBjYW5ub3QgdXBkYXRlLmApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoIWV4aXN0aW5nRmllbGRzW25hbWVdICYmIGZpZWxkLl9fb3AgPT09ICdEZWxldGUnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgIDI1NSxcbiAgICAgICAgICAgICAgYEZpZWxkICR7bmFtZX0gZG9lcyBub3QgZXhpc3QsIGNhbm5vdCBkZWxldGUuYFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGRlbGV0ZSBleGlzdGluZ0ZpZWxkcy5fcnBlcm07XG4gICAgICAgIGRlbGV0ZSBleGlzdGluZ0ZpZWxkcy5fd3Blcm07XG4gICAgICAgIGNvbnN0IG5ld1NjaGVtYSA9IGJ1aWxkTWVyZ2VkU2NoZW1hT2JqZWN0KFxuICAgICAgICAgIGV4aXN0aW5nRmllbGRzLFxuICAgICAgICAgIHN1Ym1pdHRlZEZpZWxkc1xuICAgICAgICApO1xuICAgICAgICBjb25zdCBkZWZhdWx0RmllbGRzID1cbiAgICAgICAgICBkZWZhdWx0Q29sdW1uc1tjbGFzc05hbWVdIHx8IGRlZmF1bHRDb2x1bW5zLl9EZWZhdWx0O1xuICAgICAgICBjb25zdCBmdWxsTmV3U2NoZW1hID0gT2JqZWN0LmFzc2lnbih7fSwgbmV3U2NoZW1hLCBkZWZhdWx0RmllbGRzKTtcbiAgICAgICAgY29uc3QgdmFsaWRhdGlvbkVycm9yID0gdGhpcy52YWxpZGF0ZVNjaGVtYURhdGEoXG4gICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgIG5ld1NjaGVtYSxcbiAgICAgICAgICBjbGFzc0xldmVsUGVybWlzc2lvbnMsXG4gICAgICAgICAgT2JqZWN0LmtleXMoZXhpc3RpbmdGaWVsZHMpXG4gICAgICAgICk7XG4gICAgICAgIGlmICh2YWxpZGF0aW9uRXJyb3IpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IodmFsaWRhdGlvbkVycm9yLmNvZGUsIHZhbGlkYXRpb25FcnJvci5lcnJvcik7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGaW5hbGx5IHdlIGhhdmUgY2hlY2tlZCB0byBtYWtlIHN1cmUgdGhlIHJlcXVlc3QgaXMgdmFsaWQgYW5kIHdlIGNhbiBzdGFydCBkZWxldGluZyBmaWVsZHMuXG4gICAgICAgIC8vIERvIGFsbCBkZWxldGlvbnMgZmlyc3QsIHRoZW4gYSBzaW5nbGUgc2F2ZSB0byBfU0NIRU1BIGNvbGxlY3Rpb24gdG8gaGFuZGxlIGFsbCBhZGRpdGlvbnMuXG4gICAgICAgIGNvbnN0IGRlbGV0ZWRGaWVsZHM6IHN0cmluZ1tdID0gW107XG4gICAgICAgIGNvbnN0IGluc2VydGVkRmllbGRzID0gW107XG4gICAgICAgIE9iamVjdC5rZXlzKHN1Ym1pdHRlZEZpZWxkcykuZm9yRWFjaChmaWVsZE5hbWUgPT4ge1xuICAgICAgICAgIGlmIChzdWJtaXR0ZWRGaWVsZHNbZmllbGROYW1lXS5fX29wID09PSAnRGVsZXRlJykge1xuICAgICAgICAgICAgZGVsZXRlZEZpZWxkcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGluc2VydGVkRmllbGRzLnB1c2goZmllbGROYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGxldCBkZWxldGVQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgIGlmIChkZWxldGVkRmllbGRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBkZWxldGVQcm9taXNlID0gdGhpcy5kZWxldGVGaWVsZHMoZGVsZXRlZEZpZWxkcywgY2xhc3NOYW1lLCBkYXRhYmFzZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICBkZWxldGVQcm9taXNlIC8vIERlbGV0ZSBFdmVyeXRoaW5nXG4gICAgICAgICAgICAudGhlbigoKSA9PiB0aGlzLnJlbG9hZERhdGEoeyBjbGVhckNhY2hlOiB0cnVlIH0pKSAvLyBSZWxvYWQgb3VyIFNjaGVtYSwgc28gd2UgaGF2ZSBhbGwgdGhlIG5ldyB2YWx1ZXNcbiAgICAgICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgcHJvbWlzZXMgPSBpbnNlcnRlZEZpZWxkcy5tYXAoZmllbGROYW1lID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCB0eXBlID0gc3VibWl0dGVkRmllbGRzW2ZpZWxkTmFtZV07XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZW5mb3JjZUZpZWxkRXhpc3RzKGNsYXNzTmFtZSwgZmllbGROYW1lLCB0eXBlKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIHJldHVybiBQcm9taXNlLmFsbChwcm9taXNlcyk7XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLnRoZW4oKCkgPT5cbiAgICAgICAgICAgICAgdGhpcy5zZXRQZXJtaXNzaW9ucyhjbGFzc05hbWUsIGNsYXNzTGV2ZWxQZXJtaXNzaW9ucywgbmV3U2NoZW1hKVxuICAgICAgICAgICAgKVxuICAgICAgICAgICAgLnRoZW4oKCkgPT5cbiAgICAgICAgICAgICAgdGhpcy5fZGJBZGFwdGVyLnNldEluZGV4ZXNXaXRoU2NoZW1hRm9ybWF0KFxuICAgICAgICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICAgICAgICBpbmRleGVzLFxuICAgICAgICAgICAgICAgIHNjaGVtYS5pbmRleGVzLFxuICAgICAgICAgICAgICAgIGZ1bGxOZXdTY2hlbWFcbiAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKVxuICAgICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5yZWxvYWREYXRhKHsgY2xlYXJDYWNoZTogdHJ1ZSB9KSlcbiAgICAgICAgICAgIC8vVE9ETzogTW92ZSB0aGlzIGxvZ2ljIGludG8gdGhlIGRhdGFiYXNlIGFkYXB0ZXJcbiAgICAgICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5zY2hlbWFEYXRhW2NsYXNzTmFtZV07XG4gICAgICAgICAgICAgIGNvbnN0IHJlbG9hZGVkU2NoZW1hOiBTY2hlbWEgPSB7XG4gICAgICAgICAgICAgICAgY2xhc3NOYW1lOiBjbGFzc05hbWUsXG4gICAgICAgICAgICAgICAgZmllbGRzOiBzY2hlbWEuZmllbGRzLFxuICAgICAgICAgICAgICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczogc2NoZW1hLmNsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgaWYgKHNjaGVtYS5pbmRleGVzICYmIE9iamVjdC5rZXlzKHNjaGVtYS5pbmRleGVzKS5sZW5ndGggIT09IDApIHtcbiAgICAgICAgICAgICAgICByZWxvYWRlZFNjaGVtYS5pbmRleGVzID0gc2NoZW1hLmluZGV4ZXM7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgcmV0dXJuIHJlbG9hZGVkU2NoZW1hO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgKTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfQ0xBU1NfTkFNRSxcbiAgICAgICAgICAgIGBDbGFzcyAke2NsYXNzTmFtZX0gZG9lcyBub3QgZXhpc3QuYFxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9XG5cbiAgLy8gUmV0dXJucyBhIHByb21pc2UgdGhhdCByZXNvbHZlcyBzdWNjZXNzZnVsbHkgdG8gdGhlIG5ldyBzY2hlbWFcbiAgLy8gb2JqZWN0IG9yIGZhaWxzIHdpdGggYSByZWFzb24uXG4gIGVuZm9yY2VDbGFzc0V4aXN0cyhjbGFzc05hbWU6IHN0cmluZyk6IFByb21pc2U8U2NoZW1hQ29udHJvbGxlcj4ge1xuICAgIGlmICh0aGlzLnNjaGVtYURhdGFbY2xhc3NOYW1lXSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzKTtcbiAgICB9XG4gICAgLy8gV2UgZG9uJ3QgaGF2ZSB0aGlzIGNsYXNzLiBVcGRhdGUgdGhlIHNjaGVtYVxuICAgIHJldHVybiAoXG4gICAgICB0aGlzLmFkZENsYXNzSWZOb3RFeGlzdHMoY2xhc3NOYW1lKVxuICAgICAgICAvLyBUaGUgc2NoZW1hIHVwZGF0ZSBzdWNjZWVkZWQuIFJlbG9hZCB0aGUgc2NoZW1hXG4gICAgICAgIC50aGVuKCgpID0+IHRoaXMucmVsb2FkRGF0YSh7IGNsZWFyQ2FjaGU6IHRydWUgfSkpXG4gICAgICAgIC5jYXRjaCgoKSA9PiB7XG4gICAgICAgICAgLy8gVGhlIHNjaGVtYSB1cGRhdGUgZmFpbGVkLiBUaGlzIGNhbiBiZSBva2F5IC0gaXQgbWlnaHRcbiAgICAgICAgICAvLyBoYXZlIGZhaWxlZCBiZWNhdXNlIHRoZXJlJ3MgYSByYWNlIGNvbmRpdGlvbiBhbmQgYSBkaWZmZXJlbnRcbiAgICAgICAgICAvLyBjbGllbnQgaXMgbWFraW5nIHRoZSBleGFjdCBzYW1lIHNjaGVtYSB1cGRhdGUgdGhhdCB3ZSB3YW50LlxuICAgICAgICAgIC8vIFNvIGp1c3QgcmVsb2FkIHRoZSBzY2hlbWEuXG4gICAgICAgICAgcmV0dXJuIHRoaXMucmVsb2FkRGF0YSh7IGNsZWFyQ2FjaGU6IHRydWUgfSk7XG4gICAgICAgIH0pXG4gICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAvLyBFbnN1cmUgdGhhdCB0aGUgc2NoZW1hIG5vdyB2YWxpZGF0ZXNcbiAgICAgICAgICBpZiAodGhpcy5zY2hlbWFEYXRhW2NsYXNzTmFtZV0pIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICAgYEZhaWxlZCB0byBhZGQgJHtjbGFzc05hbWV9YFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICAgIC5jYXRjaCgoKSA9PiB7XG4gICAgICAgICAgLy8gVGhlIHNjaGVtYSBzdGlsbCBkb2Vzbid0IHZhbGlkYXRlLiBHaXZlIHVwXG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgJ3NjaGVtYSBjbGFzcyBuYW1lIGRvZXMgbm90IHJldmFsaWRhdGUnXG4gICAgICAgICAgKTtcbiAgICAgICAgfSlcbiAgICApO1xuICB9XG5cbiAgdmFsaWRhdGVOZXdDbGFzcyhcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBmaWVsZHM6IFNjaGVtYUZpZWxkcyA9IHt9LFxuICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczogYW55XG4gICk6IGFueSB7XG4gICAgaWYgKHRoaXMuc2NoZW1hRGF0YVtjbGFzc05hbWVdKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfQ0xBU1NfTkFNRSxcbiAgICAgICAgYENsYXNzICR7Y2xhc3NOYW1lfSBhbHJlYWR5IGV4aXN0cy5gXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoIWNsYXNzTmFtZUlzVmFsaWQoY2xhc3NOYW1lKSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29kZTogUGFyc2UuRXJyb3IuSU5WQUxJRF9DTEFTU19OQU1FLFxuICAgICAgICBlcnJvcjogaW52YWxpZENsYXNzTmFtZU1lc3NhZ2UoY2xhc3NOYW1lKSxcbiAgICAgIH07XG4gICAgfVxuICAgIHJldHVybiB0aGlzLnZhbGlkYXRlU2NoZW1hRGF0YShcbiAgICAgIGNsYXNzTmFtZSxcbiAgICAgIGZpZWxkcyxcbiAgICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgICAgIFtdXG4gICAgKTtcbiAgfVxuXG4gIHZhbGlkYXRlU2NoZW1hRGF0YShcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBmaWVsZHM6IFNjaGVtYUZpZWxkcyxcbiAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IENsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgICBleGlzdGluZ0ZpZWxkTmFtZXM6IEFycmF5PHN0cmluZz5cbiAgKSB7XG4gICAgZm9yIChjb25zdCBmaWVsZE5hbWUgaW4gZmllbGRzKSB7XG4gICAgICBpZiAoZXhpc3RpbmdGaWVsZE5hbWVzLmluZGV4T2YoZmllbGROYW1lKSA8IDApIHtcbiAgICAgICAgaWYgKCFmaWVsZE5hbWVJc1ZhbGlkKGZpZWxkTmFtZSkpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgY29kZTogUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSxcbiAgICAgICAgICAgIGVycm9yOiAnaW52YWxpZCBmaWVsZCBuYW1lOiAnICsgZmllbGROYW1lLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFmaWVsZE5hbWVJc1ZhbGlkRm9yQ2xhc3MoZmllbGROYW1lLCBjbGFzc05hbWUpKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGNvZGU6IDEzNixcbiAgICAgICAgICAgIGVycm9yOiAnZmllbGQgJyArIGZpZWxkTmFtZSArICcgY2Fubm90IGJlIGFkZGVkJyxcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGVycm9yID0gZmllbGRUeXBlSXNJbnZhbGlkKGZpZWxkc1tmaWVsZE5hbWVdKTtcbiAgICAgICAgaWYgKGVycm9yKSByZXR1cm4geyBjb2RlOiBlcnJvci5jb2RlLCBlcnJvcjogZXJyb3IubWVzc2FnZSB9O1xuICAgICAgfVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZmllbGROYW1lIGluIGRlZmF1bHRDb2x1bW5zW2NsYXNzTmFtZV0pIHtcbiAgICAgIGZpZWxkc1tmaWVsZE5hbWVdID0gZGVmYXVsdENvbHVtbnNbY2xhc3NOYW1lXVtmaWVsZE5hbWVdO1xuICAgIH1cblxuICAgIGNvbnN0IGdlb1BvaW50cyA9IE9iamVjdC5rZXlzKGZpZWxkcykuZmlsdGVyKFxuICAgICAga2V5ID0+IGZpZWxkc1trZXldICYmIGZpZWxkc1trZXldLnR5cGUgPT09ICdHZW9Qb2ludCdcbiAgICApO1xuICAgIGlmIChnZW9Qb2ludHMubGVuZ3RoID4gMSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29kZTogUGFyc2UuRXJyb3IuSU5DT1JSRUNUX1RZUEUsXG4gICAgICAgIGVycm9yOlxuICAgICAgICAgICdjdXJyZW50bHksIG9ubHkgb25lIEdlb1BvaW50IGZpZWxkIG1heSBleGlzdCBpbiBhbiBvYmplY3QuIEFkZGluZyAnICtcbiAgICAgICAgICBnZW9Qb2ludHNbMV0gK1xuICAgICAgICAgICcgd2hlbiAnICtcbiAgICAgICAgICBnZW9Qb2ludHNbMF0gK1xuICAgICAgICAgICcgYWxyZWFkeSBleGlzdHMuJyxcbiAgICAgIH07XG4gICAgfVxuICAgIHZhbGlkYXRlQ0xQKGNsYXNzTGV2ZWxQZXJtaXNzaW9ucywgZmllbGRzKTtcbiAgfVxuXG4gIC8vIFNldHMgdGhlIENsYXNzLWxldmVsIHBlcm1pc3Npb25zIGZvciBhIGdpdmVuIGNsYXNzTmFtZSwgd2hpY2ggbXVzdCBleGlzdC5cbiAgc2V0UGVybWlzc2lvbnMoY2xhc3NOYW1lOiBzdHJpbmcsIHBlcm1zOiBhbnksIG5ld1NjaGVtYTogU2NoZW1hRmllbGRzKSB7XG4gICAgaWYgKHR5cGVvZiBwZXJtcyA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG4gICAgdmFsaWRhdGVDTFAocGVybXMsIG5ld1NjaGVtYSk7XG4gICAgcmV0dXJuIHRoaXMuX2RiQWRhcHRlci5zZXRDbGFzc0xldmVsUGVybWlzc2lvbnMoY2xhc3NOYW1lLCBwZXJtcyk7XG4gIH1cblxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHN1Y2Nlc3NmdWxseSB0byB0aGUgbmV3IHNjaGVtYVxuICAvLyBvYmplY3QgaWYgdGhlIHByb3ZpZGVkIGNsYXNzTmFtZS1maWVsZE5hbWUtdHlwZSB0dXBsZSBpcyB2YWxpZC5cbiAgLy8gVGhlIGNsYXNzTmFtZSBtdXN0IGFscmVhZHkgYmUgdmFsaWRhdGVkLlxuICAvLyBJZiAnZnJlZXplJyBpcyB0cnVlLCByZWZ1c2UgdG8gdXBkYXRlIHRoZSBzY2hlbWEgZm9yIHRoaXMgZmllbGQuXG4gIGVuZm9yY2VGaWVsZEV4aXN0cyhcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBmaWVsZE5hbWU6IHN0cmluZyxcbiAgICB0eXBlOiBzdHJpbmcgfCBTY2hlbWFGaWVsZFxuICApIHtcbiAgICBpZiAoZmllbGROYW1lLmluZGV4T2YoJy4nKSA+IDApIHtcbiAgICAgIC8vIHN1YmRvY3VtZW50IGtleSAoeC55KSA9PiBvayBpZiB4IGlzIG9mIHR5cGUgJ29iamVjdCdcbiAgICAgIGZpZWxkTmFtZSA9IGZpZWxkTmFtZS5zcGxpdCgnLicpWzBdO1xuICAgICAgdHlwZSA9ICdPYmplY3QnO1xuICAgIH1cbiAgICBpZiAoIWZpZWxkTmFtZUlzVmFsaWQoZmllbGROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLFxuICAgICAgICBgSW52YWxpZCBmaWVsZCBuYW1lOiAke2ZpZWxkTmFtZX0uYFxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBJZiBzb21lb25lIHRyaWVzIHRvIGNyZWF0ZSBhIG5ldyBmaWVsZCB3aXRoIG51bGwvdW5kZWZpbmVkIGFzIHRoZSB2YWx1ZSwgcmV0dXJuO1xuICAgIGlmICghdHlwZSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5yZWxvYWREYXRhKCkudGhlbigoKSA9PiB7XG4gICAgICBjb25zdCBleHBlY3RlZFR5cGUgPSB0aGlzLmdldEV4cGVjdGVkVHlwZShjbGFzc05hbWUsIGZpZWxkTmFtZSk7XG4gICAgICBpZiAodHlwZW9mIHR5cGUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHR5cGUgPSB7IHR5cGUgfTtcbiAgICAgIH1cblxuICAgICAgaWYgKGV4cGVjdGVkVHlwZSkge1xuICAgICAgICBpZiAoIWRiVHlwZU1hdGNoZXNPYmplY3RUeXBlKGV4cGVjdGVkVHlwZSwgdHlwZSkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5JTkNPUlJFQ1RfVFlQRSxcbiAgICAgICAgICAgIGBzY2hlbWEgbWlzbWF0Y2ggZm9yICR7Y2xhc3NOYW1lfS4ke2ZpZWxkTmFtZX07IGV4cGVjdGVkICR7dHlwZVRvU3RyaW5nKFxuICAgICAgICAgICAgICBleHBlY3RlZFR5cGVcbiAgICAgICAgICAgICl9IGJ1dCBnb3QgJHt0eXBlVG9TdHJpbmcodHlwZSl9YFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzLl9kYkFkYXB0ZXJcbiAgICAgICAgLmFkZEZpZWxkSWZOb3RFeGlzdHMoY2xhc3NOYW1lLCBmaWVsZE5hbWUsIHR5cGUpXG4gICAgICAgIC50aGVuKFxuICAgICAgICAgICgpID0+IHtcbiAgICAgICAgICAgIC8vIFRoZSB1cGRhdGUgc3VjY2VlZGVkLiBSZWxvYWQgdGhlIHNjaGVtYVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVsb2FkRGF0YSh7IGNsZWFyQ2FjaGU6IHRydWUgfSk7XG4gICAgICAgICAgfSxcbiAgICAgICAgICBlcnJvciA9PiB7XG4gICAgICAgICAgICBpZiAoZXJyb3IuY29kZSA9PSBQYXJzZS5FcnJvci5JTkNPUlJFQ1RfVFlQRSkge1xuICAgICAgICAgICAgICAvLyBNYWtlIHN1cmUgdGhhdCB3ZSB0aHJvdyBlcnJvcnMgd2hlbiBpdCBpcyBhcHByb3ByaWF0ZSB0byBkbyBzby5cbiAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBUaGUgdXBkYXRlIGZhaWxlZC4gVGhpcyBjYW4gYmUgb2theSAtIGl0IG1pZ2h0IGhhdmUgYmVlbiBhIHJhY2VcbiAgICAgICAgICAgIC8vIGNvbmRpdGlvbiB3aGVyZSBhbm90aGVyIGNsaWVudCB1cGRhdGVkIHRoZSBzY2hlbWEgaW4gdGhlIHNhbWVcbiAgICAgICAgICAgIC8vIHdheSB0aGF0IHdlIHdhbnRlZCB0by4gU28sIGp1c3QgcmVsb2FkIHRoZSBzY2hlbWFcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJlbG9hZERhdGEoeyBjbGVhckNhY2hlOiB0cnVlIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgKVxuICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgLy8gRW5zdXJlIHRoYXQgdGhlIHNjaGVtYSBub3cgdmFsaWRhdGVzXG4gICAgICAgICAgY29uc3QgZXhwZWN0ZWRUeXBlID0gdGhpcy5nZXRFeHBlY3RlZFR5cGUoY2xhc3NOYW1lLCBmaWVsZE5hbWUpO1xuICAgICAgICAgIGlmICh0eXBlb2YgdHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHR5cGUgPSB7IHR5cGUgfTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKCFleHBlY3RlZFR5cGUgfHwgIWRiVHlwZU1hdGNoZXNPYmplY3RUeXBlKGV4cGVjdGVkVHlwZSwgdHlwZSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgICBgQ291bGQgbm90IGFkZCBmaWVsZCAke2ZpZWxkTmFtZX1gXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBSZW1vdmUgdGhlIGNhY2hlZCBzY2hlbWFcbiAgICAgICAgICB0aGlzLl9jYWNoZS5jbGVhcigpO1xuICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIG1haW50YWluIGNvbXBhdGliaWxpdHlcbiAgZGVsZXRlRmllbGQoXG4gICAgZmllbGROYW1lOiBzdHJpbmcsXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgZGF0YWJhc2U6IERhdGFiYXNlQ29udHJvbGxlclxuICApIHtcbiAgICByZXR1cm4gdGhpcy5kZWxldGVGaWVsZHMoW2ZpZWxkTmFtZV0sIGNsYXNzTmFtZSwgZGF0YWJhc2UpO1xuICB9XG5cbiAgLy8gRGVsZXRlIGZpZWxkcywgYW5kIHJlbW92ZSB0aGF0IGRhdGEgZnJvbSBhbGwgb2JqZWN0cy4gVGhpcyBpcyBpbnRlbmRlZFxuICAvLyB0byByZW1vdmUgdW51c2VkIGZpZWxkcywgaWYgb3RoZXIgd3JpdGVycyBhcmUgd3JpdGluZyBvYmplY3RzIHRoYXQgaW5jbHVkZVxuICAvLyB0aGlzIGZpZWxkLCB0aGUgZmllbGQgbWF5IHJlYXBwZWFyLiBSZXR1cm5zIGEgUHJvbWlzZSB0aGF0IHJlc29sdmVzIHdpdGhcbiAgLy8gbm8gb2JqZWN0IG9uIHN1Y2Nlc3MsIG9yIHJlamVjdHMgd2l0aCB7IGNvZGUsIGVycm9yIH0gb24gZmFpbHVyZS5cbiAgLy8gUGFzc2luZyB0aGUgZGF0YWJhc2UgYW5kIHByZWZpeCBpcyBuZWNlc3NhcnkgaW4gb3JkZXIgdG8gZHJvcCByZWxhdGlvbiBjb2xsZWN0aW9uc1xuICAvLyBhbmQgcmVtb3ZlIGZpZWxkcyBmcm9tIG9iamVjdHMuIElkZWFsbHkgdGhlIGRhdGFiYXNlIHdvdWxkIGJlbG9uZyB0b1xuICAvLyBhIGRhdGFiYXNlIGFkYXB0ZXIgYW5kIHRoaXMgZnVuY3Rpb24gd291bGQgY2xvc2Ugb3ZlciBpdCBvciBhY2Nlc3MgaXQgdmlhIG1lbWJlci5cbiAgZGVsZXRlRmllbGRzKFxuICAgIGZpZWxkTmFtZXM6IEFycmF5PHN0cmluZz4sXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgZGF0YWJhc2U6IERhdGFiYXNlQ29udHJvbGxlclxuICApIHtcbiAgICBpZiAoIWNsYXNzTmFtZUlzVmFsaWQoY2xhc3NOYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0NMQVNTX05BTUUsXG4gICAgICAgIGludmFsaWRDbGFzc05hbWVNZXNzYWdlKGNsYXNzTmFtZSlcbiAgICAgICk7XG4gICAgfVxuXG4gICAgZmllbGROYW1lcy5mb3JFYWNoKGZpZWxkTmFtZSA9PiB7XG4gICAgICBpZiAoIWZpZWxkTmFtZUlzVmFsaWQoZmllbGROYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSxcbiAgICAgICAgICBgaW52YWxpZCBmaWVsZCBuYW1lOiAke2ZpZWxkTmFtZX1gXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICAvL0Rvbid0IGFsbG93IGRlbGV0aW5nIHRoZSBkZWZhdWx0IGZpZWxkcy5cbiAgICAgIGlmICghZmllbGROYW1lSXNWYWxpZEZvckNsYXNzKGZpZWxkTmFtZSwgY2xhc3NOYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoMTM2LCBgZmllbGQgJHtmaWVsZE5hbWV9IGNhbm5vdCBiZSBjaGFuZ2VkYCk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gdGhpcy5nZXRPbmVTY2hlbWEoY2xhc3NOYW1lLCBmYWxzZSwgeyBjbGVhckNhY2hlOiB0cnVlIH0pXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfQ0xBU1NfTkFNRSxcbiAgICAgICAgICAgIGBDbGFzcyAke2NsYXNzTmFtZX0gZG9lcyBub3QgZXhpc3QuYFxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAudGhlbihzY2hlbWEgPT4ge1xuICAgICAgICBmaWVsZE5hbWVzLmZvckVhY2goZmllbGROYW1lID0+IHtcbiAgICAgICAgICBpZiAoIXNjaGVtYS5maWVsZHNbZmllbGROYW1lXSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICAyNTUsXG4gICAgICAgICAgICAgIGBGaWVsZCAke2ZpZWxkTmFtZX0gZG9lcyBub3QgZXhpc3QsIGNhbm5vdCBkZWxldGUuYFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHNjaGVtYUZpZWxkcyA9IHsgLi4uc2NoZW1hLmZpZWxkcyB9O1xuICAgICAgICByZXR1cm4gZGF0YWJhc2UuYWRhcHRlclxuICAgICAgICAgIC5kZWxldGVGaWVsZHMoY2xhc3NOYW1lLCBzY2hlbWEsIGZpZWxkTmFtZXMpXG4gICAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKFxuICAgICAgICAgICAgICBmaWVsZE5hbWVzLm1hcChmaWVsZE5hbWUgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGZpZWxkID0gc2NoZW1hRmllbGRzW2ZpZWxkTmFtZV07XG4gICAgICAgICAgICAgICAgaWYgKGZpZWxkICYmIGZpZWxkLnR5cGUgPT09ICdSZWxhdGlvbicpIHtcbiAgICAgICAgICAgICAgICAgIC8vRm9yIHJlbGF0aW9ucywgZHJvcCB0aGUgX0pvaW4gdGFibGVcbiAgICAgICAgICAgICAgICAgIHJldHVybiBkYXRhYmFzZS5hZGFwdGVyLmRlbGV0ZUNsYXNzKFxuICAgICAgICAgICAgICAgICAgICBgX0pvaW46JHtmaWVsZE5hbWV9OiR7Y2xhc3NOYW1lfWBcbiAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSk7XG4gICAgICB9KVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICB0aGlzLl9jYWNoZS5jbGVhcigpO1xuICAgICAgfSk7XG4gIH1cblxuICAvLyBWYWxpZGF0ZXMgYW4gb2JqZWN0IHByb3ZpZGVkIGluIFJFU1QgZm9ybWF0LlxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSBuZXcgc2NoZW1hIGlmIHRoaXMgb2JqZWN0IGlzXG4gIC8vIHZhbGlkLlxuICB2YWxpZGF0ZU9iamVjdChjbGFzc05hbWU6IHN0cmluZywgb2JqZWN0OiBhbnksIHF1ZXJ5OiBhbnkpIHtcbiAgICBsZXQgZ2VvY291bnQgPSAwO1xuICAgIGxldCBwcm9taXNlID0gdGhpcy5lbmZvcmNlQ2xhc3NFeGlzdHMoY2xhc3NOYW1lKTtcbiAgICBmb3IgKGNvbnN0IGZpZWxkTmFtZSBpbiBvYmplY3QpIHtcbiAgICAgIGlmIChvYmplY3RbZmllbGROYW1lXSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgZXhwZWN0ZWQgPSBnZXRUeXBlKG9iamVjdFtmaWVsZE5hbWVdKTtcbiAgICAgIGlmIChleHBlY3RlZCA9PT0gJ0dlb1BvaW50Jykge1xuICAgICAgICBnZW9jb3VudCsrO1xuICAgICAgfVxuICAgICAgaWYgKGdlb2NvdW50ID4gMSkge1xuICAgICAgICAvLyBNYWtlIHN1cmUgYWxsIGZpZWxkIHZhbGlkYXRpb24gb3BlcmF0aW9ucyBydW4gYmVmb3JlIHdlIHJldHVybi5cbiAgICAgICAgLy8gSWYgbm90IC0gd2UgYXJlIGNvbnRpbnVpbmcgdG8gcnVuIGxvZ2ljLCBidXQgYWxyZWFkeSBwcm92aWRlZCByZXNwb25zZSBmcm9tIHRoZSBzZXJ2ZXIuXG4gICAgICAgIHJldHVybiBwcm9taXNlLnRoZW4oKCkgPT4ge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChcbiAgICAgICAgICAgIG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5DT1JSRUNUX1RZUEUsXG4gICAgICAgICAgICAgICd0aGVyZSBjYW4gb25seSBiZSBvbmUgZ2VvcG9pbnQgZmllbGQgaW4gYSBjbGFzcydcbiAgICAgICAgICAgIClcbiAgICAgICAgICApO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGlmICghZXhwZWN0ZWQpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoZmllbGROYW1lID09PSAnQUNMJykge1xuICAgICAgICAvLyBFdmVyeSBvYmplY3QgaGFzIEFDTCBpbXBsaWNpdGx5LlxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgcHJvbWlzZSA9IHByb21pc2UudGhlbihzY2hlbWEgPT5cbiAgICAgICAgc2NoZW1hLmVuZm9yY2VGaWVsZEV4aXN0cyhjbGFzc05hbWUsIGZpZWxkTmFtZSwgZXhwZWN0ZWQpXG4gICAgICApO1xuICAgIH1cbiAgICBwcm9taXNlID0gdGhlblZhbGlkYXRlUmVxdWlyZWRDb2x1bW5zKHByb21pc2UsIGNsYXNzTmFtZSwgb2JqZWN0LCBxdWVyeSk7XG4gICAgcmV0dXJuIHByb21pc2U7XG4gIH1cblxuICAvLyBWYWxpZGF0ZXMgdGhhdCBhbGwgdGhlIHByb3BlcnRpZXMgYXJlIHNldCBmb3IgdGhlIG9iamVjdFxuICB2YWxpZGF0ZVJlcXVpcmVkQ29sdW1ucyhjbGFzc05hbWU6IHN0cmluZywgb2JqZWN0OiBhbnksIHF1ZXJ5OiBhbnkpIHtcbiAgICBjb25zdCBjb2x1bW5zID0gcmVxdWlyZWRDb2x1bW5zW2NsYXNzTmFtZV07XG4gICAgaWYgKCFjb2x1bW5zIHx8IGNvbHVtbnMubGVuZ3RoID09IDApIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcyk7XG4gICAgfVxuXG4gICAgY29uc3QgbWlzc2luZ0NvbHVtbnMgPSBjb2x1bW5zLmZpbHRlcihmdW5jdGlvbihjb2x1bW4pIHtcbiAgICAgIGlmIChxdWVyeSAmJiBxdWVyeS5vYmplY3RJZCkge1xuICAgICAgICBpZiAob2JqZWN0W2NvbHVtbl0gJiYgdHlwZW9mIG9iamVjdFtjb2x1bW5dID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgIC8vIFRyeWluZyB0byBkZWxldGUgYSByZXF1aXJlZCBjb2x1bW5cbiAgICAgICAgICByZXR1cm4gb2JqZWN0W2NvbHVtbl0uX19vcCA9PSAnRGVsZXRlJztcbiAgICAgICAgfVxuICAgICAgICAvLyBOb3QgdHJ5aW5nIHRvIGRvIGFueXRoaW5nIHRoZXJlXG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICAgIHJldHVybiAhb2JqZWN0W2NvbHVtbl07XG4gICAgfSk7XG5cbiAgICBpZiAobWlzc2luZ0NvbHVtbnMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTkNPUlJFQ1RfVFlQRSxcbiAgICAgICAgbWlzc2luZ0NvbHVtbnNbMF0gKyAnIGlzIHJlcXVpcmVkLidcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcyk7XG4gIH1cblxuICB0ZXN0UGVybWlzc2lvbnNGb3JDbGFzc05hbWUoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgYWNsR3JvdXA6IHN0cmluZ1tdLFxuICAgIG9wZXJhdGlvbjogc3RyaW5nXG4gICkge1xuICAgIHJldHVybiBTY2hlbWFDb250cm9sbGVyLnRlc3RQZXJtaXNzaW9ucyhcbiAgICAgIHRoaXMuZ2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zKGNsYXNzTmFtZSksXG4gICAgICBhY2xHcm91cCxcbiAgICAgIG9wZXJhdGlvblxuICAgICk7XG4gIH1cblxuICAvLyBUZXN0cyB0aGF0IHRoZSBjbGFzcyBsZXZlbCBwZXJtaXNzaW9uIGxldCBwYXNzIHRoZSBvcGVyYXRpb24gZm9yIGEgZ2l2ZW4gYWNsR3JvdXBcbiAgc3RhdGljIHRlc3RQZXJtaXNzaW9ucyhcbiAgICBjbGFzc1Blcm1pc3Npb25zOiA/YW55LFxuICAgIGFjbEdyb3VwOiBzdHJpbmdbXSxcbiAgICBvcGVyYXRpb246IHN0cmluZ1xuICApOiBib29sZWFuIHtcbiAgICBpZiAoIWNsYXNzUGVybWlzc2lvbnMgfHwgIWNsYXNzUGVybWlzc2lvbnNbb3BlcmF0aW9uXSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIGNvbnN0IHBlcm1zID0gY2xhc3NQZXJtaXNzaW9uc1tvcGVyYXRpb25dO1xuICAgIGlmIChwZXJtc1snKiddKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgLy8gQ2hlY2sgcGVybWlzc2lvbnMgYWdhaW5zdCB0aGUgYWNsR3JvdXAgcHJvdmlkZWQgKGFycmF5IG9mIHVzZXJJZC9yb2xlcylcbiAgICBpZiAoXG4gICAgICBhY2xHcm91cC5zb21lKGFjbCA9PiB7XG4gICAgICAgIHJldHVybiBwZXJtc1thY2xdID09PSB0cnVlO1xuICAgICAgfSlcbiAgICApIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvLyBWYWxpZGF0ZXMgYW4gb3BlcmF0aW9uIHBhc3NlcyBjbGFzcy1sZXZlbC1wZXJtaXNzaW9ucyBzZXQgaW4gdGhlIHNjaGVtYVxuICBzdGF0aWMgdmFsaWRhdGVQZXJtaXNzaW9uKFxuICAgIGNsYXNzUGVybWlzc2lvbnM6ID9hbnksXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgYWNsR3JvdXA6IHN0cmluZ1tdLFxuICAgIG9wZXJhdGlvbjogc3RyaW5nXG4gICkge1xuICAgIGlmIChcbiAgICAgIFNjaGVtYUNvbnRyb2xsZXIudGVzdFBlcm1pc3Npb25zKGNsYXNzUGVybWlzc2lvbnMsIGFjbEdyb3VwLCBvcGVyYXRpb24pXG4gICAgKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuXG4gICAgaWYgKCFjbGFzc1Blcm1pc3Npb25zIHx8ICFjbGFzc1Blcm1pc3Npb25zW29wZXJhdGlvbl0pIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICBjb25zdCBwZXJtcyA9IGNsYXNzUGVybWlzc2lvbnNbb3BlcmF0aW9uXTtcbiAgICAvLyBJZiBvbmx5IGZvciBhdXRoZW50aWNhdGVkIHVzZXJzXG4gICAgLy8gbWFrZSBzdXJlIHdlIGhhdmUgYW4gYWNsR3JvdXBcbiAgICBpZiAocGVybXNbJ3JlcXVpcmVzQXV0aGVudGljYXRpb24nXSkge1xuICAgICAgLy8gSWYgYWNsR3JvdXAgaGFzICogKHB1YmxpYylcbiAgICAgIGlmICghYWNsR3JvdXAgfHwgYWNsR3JvdXAubGVuZ3RoID09IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsXG4gICAgICAgICAgJ1Blcm1pc3Npb24gZGVuaWVkLCB1c2VyIG5lZWRzIHRvIGJlIGF1dGhlbnRpY2F0ZWQuJ1xuICAgICAgICApO1xuICAgICAgfSBlbHNlIGlmIChhY2xHcm91cC5pbmRleE9mKCcqJykgPiAtMSAmJiBhY2xHcm91cC5sZW5ndGggPT0gMSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCxcbiAgICAgICAgICAnUGVybWlzc2lvbiBkZW5pZWQsIHVzZXIgbmVlZHMgdG8gYmUgYXV0aGVudGljYXRlZC4nXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICAvLyByZXF1aXJlc0F1dGhlbnRpY2F0aW9uIHBhc3NlZCwganVzdCBtb3ZlIGZvcndhcmRcbiAgICAgIC8vIHByb2JhYmx5IHdvdWxkIGJlIHdpc2UgYXQgc29tZSBwb2ludCB0byByZW5hbWUgdG8gJ2F1dGhlbnRpY2F0ZWRVc2VyJ1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cblxuICAgIC8vIE5vIG1hdGNoaW5nIENMUCwgbGV0J3MgY2hlY2sgdGhlIFBvaW50ZXIgcGVybWlzc2lvbnNcbiAgICAvLyBBbmQgaGFuZGxlIHRob3NlIGxhdGVyXG4gICAgY29uc3QgcGVybWlzc2lvbkZpZWxkID1cbiAgICAgIFsnZ2V0JywgJ2ZpbmQnLCAnY291bnQnXS5pbmRleE9mKG9wZXJhdGlvbikgPiAtMVxuICAgICAgICA/ICdyZWFkVXNlckZpZWxkcydcbiAgICAgICAgOiAnd3JpdGVVc2VyRmllbGRzJztcblxuICAgIC8vIFJlamVjdCBjcmVhdGUgd2hlbiB3cml0ZSBsb2NrZG93blxuICAgIGlmIChwZXJtaXNzaW9uRmllbGQgPT0gJ3dyaXRlVXNlckZpZWxkcycgJiYgb3BlcmF0aW9uID09ICdjcmVhdGUnKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLk9QRVJBVElPTl9GT1JCSURERU4sXG4gICAgICAgIGBQZXJtaXNzaW9uIGRlbmllZCBmb3IgYWN0aW9uICR7b3BlcmF0aW9ufSBvbiBjbGFzcyAke2NsYXNzTmFtZX0uYFxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBQcm9jZXNzIHRoZSByZWFkVXNlckZpZWxkcyBsYXRlclxuICAgIGlmIChcbiAgICAgIEFycmF5LmlzQXJyYXkoY2xhc3NQZXJtaXNzaW9uc1twZXJtaXNzaW9uRmllbGRdKSAmJlxuICAgICAgY2xhc3NQZXJtaXNzaW9uc1twZXJtaXNzaW9uRmllbGRdLmxlbmd0aCA+IDBcbiAgICApIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTixcbiAgICAgIGBQZXJtaXNzaW9uIGRlbmllZCBmb3IgYWN0aW9uICR7b3BlcmF0aW9ufSBvbiBjbGFzcyAke2NsYXNzTmFtZX0uYFxuICAgICk7XG4gIH1cblxuICAvLyBWYWxpZGF0ZXMgYW4gb3BlcmF0aW9uIHBhc3NlcyBjbGFzcy1sZXZlbC1wZXJtaXNzaW9ucyBzZXQgaW4gdGhlIHNjaGVtYVxuICB2YWxpZGF0ZVBlcm1pc3Npb24oY2xhc3NOYW1lOiBzdHJpbmcsIGFjbEdyb3VwOiBzdHJpbmdbXSwgb3BlcmF0aW9uOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gU2NoZW1hQ29udHJvbGxlci52YWxpZGF0ZVBlcm1pc3Npb24oXG4gICAgICB0aGlzLmdldENsYXNzTGV2ZWxQZXJtaXNzaW9ucyhjbGFzc05hbWUpLFxuICAgICAgY2xhc3NOYW1lLFxuICAgICAgYWNsR3JvdXAsXG4gICAgICBvcGVyYXRpb25cbiAgICApO1xuICB9XG5cbiAgZ2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zKGNsYXNzTmFtZTogc3RyaW5nKTogYW55IHtcbiAgICByZXR1cm4gKFxuICAgICAgdGhpcy5zY2hlbWFEYXRhW2NsYXNzTmFtZV0gJiZcbiAgICAgIHRoaXMuc2NoZW1hRGF0YVtjbGFzc05hbWVdLmNsYXNzTGV2ZWxQZXJtaXNzaW9uc1xuICAgICk7XG4gIH1cblxuICAvLyBSZXR1cm5zIHRoZSBleHBlY3RlZCB0eXBlIGZvciBhIGNsYXNzTmFtZStrZXkgY29tYmluYXRpb25cbiAgLy8gb3IgdW5kZWZpbmVkIGlmIHRoZSBzY2hlbWEgaXMgbm90IHNldFxuICBnZXRFeHBlY3RlZFR5cGUoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgZmllbGROYW1lOiBzdHJpbmdcbiAgKTogPyhTY2hlbWFGaWVsZCB8IHN0cmluZykge1xuICAgIGlmICh0aGlzLnNjaGVtYURhdGFbY2xhc3NOYW1lXSkge1xuICAgICAgY29uc3QgZXhwZWN0ZWRUeXBlID0gdGhpcy5zY2hlbWFEYXRhW2NsYXNzTmFtZV0uZmllbGRzW2ZpZWxkTmFtZV07XG4gICAgICByZXR1cm4gZXhwZWN0ZWRUeXBlID09PSAnbWFwJyA/ICdPYmplY3QnIDogZXhwZWN0ZWRUeXBlO1xuICAgIH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgLy8gQ2hlY2tzIGlmIGEgZ2l2ZW4gY2xhc3MgaXMgaW4gdGhlIHNjaGVtYS5cbiAgaGFzQ2xhc3MoY2xhc3NOYW1lOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5yZWxvYWREYXRhKCkudGhlbigoKSA9PiAhIXRoaXMuc2NoZW1hRGF0YVtjbGFzc05hbWVdKTtcbiAgfVxufVxuXG4vLyBSZXR1cm5zIGEgcHJvbWlzZSBmb3IgYSBuZXcgU2NoZW1hLlxuY29uc3QgbG9hZCA9IChcbiAgZGJBZGFwdGVyOiBTdG9yYWdlQWRhcHRlcixcbiAgc2NoZW1hQ2FjaGU6IGFueSxcbiAgb3B0aW9uczogYW55XG4pOiBQcm9taXNlPFNjaGVtYUNvbnRyb2xsZXI+ID0+IHtcbiAgY29uc3Qgc2NoZW1hID0gbmV3IFNjaGVtYUNvbnRyb2xsZXIoZGJBZGFwdGVyLCBzY2hlbWFDYWNoZSk7XG4gIHJldHVybiBzY2hlbWEucmVsb2FkRGF0YShvcHRpb25zKS50aGVuKCgpID0+IHNjaGVtYSk7XG59O1xuXG4vLyBCdWlsZHMgYSBuZXcgc2NoZW1hIChpbiBzY2hlbWEgQVBJIHJlc3BvbnNlIGZvcm1hdCkgb3V0IG9mIGFuXG4vLyBleGlzdGluZyBtb25nbyBzY2hlbWEgKyBhIHNjaGVtYXMgQVBJIHB1dCByZXF1ZXN0LiBUaGlzIHJlc3BvbnNlXG4vLyBkb2VzIG5vdCBpbmNsdWRlIHRoZSBkZWZhdWx0IGZpZWxkcywgYXMgaXQgaXMgaW50ZW5kZWQgdG8gYmUgcGFzc2VkXG4vLyB0byBtb25nb1NjaGVtYUZyb21GaWVsZHNBbmRDbGFzc05hbWUuIE5vIHZhbGlkYXRpb24gaXMgZG9uZSBoZXJlLCBpdFxuLy8gaXMgZG9uZSBpbiBtb25nb1NjaGVtYUZyb21GaWVsZHNBbmRDbGFzc05hbWUuXG5mdW5jdGlvbiBidWlsZE1lcmdlZFNjaGVtYU9iamVjdChcbiAgZXhpc3RpbmdGaWVsZHM6IFNjaGVtYUZpZWxkcyxcbiAgcHV0UmVxdWVzdDogYW55XG4pOiBTY2hlbWFGaWVsZHMge1xuICBjb25zdCBuZXdTY2hlbWEgPSB7fTtcbiAgLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG4gIGNvbnN0IHN5c1NjaGVtYUZpZWxkID1cbiAgICBPYmplY3Qua2V5cyhkZWZhdWx0Q29sdW1ucykuaW5kZXhPZihleGlzdGluZ0ZpZWxkcy5faWQpID09PSAtMVxuICAgICAgPyBbXVxuICAgICAgOiBPYmplY3Qua2V5cyhkZWZhdWx0Q29sdW1uc1tleGlzdGluZ0ZpZWxkcy5faWRdKTtcbiAgZm9yIChjb25zdCBvbGRGaWVsZCBpbiBleGlzdGluZ0ZpZWxkcykge1xuICAgIGlmIChcbiAgICAgIG9sZEZpZWxkICE9PSAnX2lkJyAmJlxuICAgICAgb2xkRmllbGQgIT09ICdBQ0wnICYmXG4gICAgICBvbGRGaWVsZCAhPT0gJ3VwZGF0ZWRBdCcgJiZcbiAgICAgIG9sZEZpZWxkICE9PSAnY3JlYXRlZEF0JyAmJlxuICAgICAgb2xkRmllbGQgIT09ICdvYmplY3RJZCdcbiAgICApIHtcbiAgICAgIGlmIChcbiAgICAgICAgc3lzU2NoZW1hRmllbGQubGVuZ3RoID4gMCAmJlxuICAgICAgICBzeXNTY2hlbWFGaWVsZC5pbmRleE9mKG9sZEZpZWxkKSAhPT0gLTFcbiAgICAgICkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGZpZWxkSXNEZWxldGVkID1cbiAgICAgICAgcHV0UmVxdWVzdFtvbGRGaWVsZF0gJiYgcHV0UmVxdWVzdFtvbGRGaWVsZF0uX19vcCA9PT0gJ0RlbGV0ZSc7XG4gICAgICBpZiAoIWZpZWxkSXNEZWxldGVkKSB7XG4gICAgICAgIG5ld1NjaGVtYVtvbGRGaWVsZF0gPSBleGlzdGluZ0ZpZWxkc1tvbGRGaWVsZF07XG4gICAgICB9XG4gICAgfVxuICB9XG4gIGZvciAoY29uc3QgbmV3RmllbGQgaW4gcHV0UmVxdWVzdCkge1xuICAgIGlmIChuZXdGaWVsZCAhPT0gJ29iamVjdElkJyAmJiBwdXRSZXF1ZXN0W25ld0ZpZWxkXS5fX29wICE9PSAnRGVsZXRlJykge1xuICAgICAgaWYgKFxuICAgICAgICBzeXNTY2hlbWFGaWVsZC5sZW5ndGggPiAwICYmXG4gICAgICAgIHN5c1NjaGVtYUZpZWxkLmluZGV4T2YobmV3RmllbGQpICE9PSAtMVxuICAgICAgKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgbmV3U2NoZW1hW25ld0ZpZWxkXSA9IHB1dFJlcXVlc3RbbmV3RmllbGRdO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbmV3U2NoZW1hO1xufVxuXG4vLyBHaXZlbiBhIHNjaGVtYSBwcm9taXNlLCBjb25zdHJ1Y3QgYW5vdGhlciBzY2hlbWEgcHJvbWlzZSB0aGF0XG4vLyB2YWxpZGF0ZXMgdGhpcyBmaWVsZCBvbmNlIHRoZSBzY2hlbWEgbG9hZHMuXG5mdW5jdGlvbiB0aGVuVmFsaWRhdGVSZXF1aXJlZENvbHVtbnMoc2NoZW1hUHJvbWlzZSwgY2xhc3NOYW1lLCBvYmplY3QsIHF1ZXJ5KSB7XG4gIHJldHVybiBzY2hlbWFQcm9taXNlLnRoZW4oc2NoZW1hID0+IHtcbiAgICByZXR1cm4gc2NoZW1hLnZhbGlkYXRlUmVxdWlyZWRDb2x1bW5zKGNsYXNzTmFtZSwgb2JqZWN0LCBxdWVyeSk7XG4gIH0pO1xufVxuXG4vLyBHZXRzIHRoZSB0eXBlIGZyb20gYSBSRVNUIEFQSSBmb3JtYXR0ZWQgb2JqZWN0LCB3aGVyZSAndHlwZScgaXNcbi8vIGV4dGVuZGVkIHBhc3QgamF2YXNjcmlwdCB0eXBlcyB0byBpbmNsdWRlIHRoZSByZXN0IG9mIHRoZSBQYXJzZVxuLy8gdHlwZSBzeXN0ZW0uXG4vLyBUaGUgb3V0cHV0IHNob3VsZCBiZSBhIHZhbGlkIHNjaGVtYSB2YWx1ZS5cbi8vIFRPRE86IGVuc3VyZSB0aGF0IHRoaXMgaXMgY29tcGF0aWJsZSB3aXRoIHRoZSBmb3JtYXQgdXNlZCBpbiBPcGVuIERCXG5mdW5jdGlvbiBnZXRUeXBlKG9iajogYW55KTogPyhTY2hlbWFGaWVsZCB8IHN0cmluZykge1xuICBjb25zdCB0eXBlID0gdHlwZW9mIG9iajtcbiAgc3dpdGNoICh0eXBlKSB7XG4gICAgY2FzZSAnYm9vbGVhbic6XG4gICAgICByZXR1cm4gJ0Jvb2xlYW4nO1xuICAgIGNhc2UgJ3N0cmluZyc6XG4gICAgICByZXR1cm4gJ1N0cmluZyc7XG4gICAgY2FzZSAnbnVtYmVyJzpcbiAgICAgIHJldHVybiAnTnVtYmVyJztcbiAgICBjYXNlICdtYXAnOlxuICAgIGNhc2UgJ29iamVjdCc6XG4gICAgICBpZiAoIW9iaikge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGdldE9iamVjdFR5cGUob2JqKTtcbiAgICBjYXNlICdmdW5jdGlvbic6XG4gICAgY2FzZSAnc3ltYm9sJzpcbiAgICBjYXNlICd1bmRlZmluZWQnOlxuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyAnYmFkIG9iajogJyArIG9iajtcbiAgfVxufVxuXG4vLyBUaGlzIGdldHMgdGhlIHR5cGUgZm9yIG5vbi1KU09OIHR5cGVzIGxpa2UgcG9pbnRlcnMgYW5kIGZpbGVzLCBidXRcbi8vIGFsc28gZ2V0cyB0aGUgYXBwcm9wcmlhdGUgdHlwZSBmb3IgJCBvcGVyYXRvcnMuXG4vLyBSZXR1cm5zIG51bGwgaWYgdGhlIHR5cGUgaXMgdW5rbm93bi5cbmZ1bmN0aW9uIGdldE9iamVjdFR5cGUob2JqKTogPyhTY2hlbWFGaWVsZCB8IHN0cmluZykge1xuICBpZiAob2JqIGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICByZXR1cm4gJ0FycmF5JztcbiAgfVxuICBpZiAob2JqLl9fdHlwZSkge1xuICAgIHN3aXRjaCAob2JqLl9fdHlwZSkge1xuICAgICAgY2FzZSAnUG9pbnRlcic6XG4gICAgICAgIGlmIChvYmouY2xhc3NOYW1lKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHR5cGU6ICdQb2ludGVyJyxcbiAgICAgICAgICAgIHRhcmdldENsYXNzOiBvYmouY2xhc3NOYW1lLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdSZWxhdGlvbic6XG4gICAgICAgIGlmIChvYmouY2xhc3NOYW1lKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHR5cGU6ICdSZWxhdGlvbicsXG4gICAgICAgICAgICB0YXJnZXRDbGFzczogb2JqLmNsYXNzTmFtZSxcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnRmlsZSc6XG4gICAgICAgIGlmIChvYmoubmFtZSkge1xuICAgICAgICAgIHJldHVybiAnRmlsZSc7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdEYXRlJzpcbiAgICAgICAgaWYgKG9iai5pc28pIHtcbiAgICAgICAgICByZXR1cm4gJ0RhdGUnO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnR2VvUG9pbnQnOlxuICAgICAgICBpZiAob2JqLmxhdGl0dWRlICE9IG51bGwgJiYgb2JqLmxvbmdpdHVkZSAhPSBudWxsKSB7XG4gICAgICAgICAgcmV0dXJuICdHZW9Qb2ludCc7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdCeXRlcyc6XG4gICAgICAgIGlmIChvYmouYmFzZTY0KSB7XG4gICAgICAgICAgcmV0dXJuICdCeXRlcyc7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdQb2x5Z29uJzpcbiAgICAgICAgaWYgKG9iai5jb29yZGluYXRlcykge1xuICAgICAgICAgIHJldHVybiAnUG9seWdvbic7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgIFBhcnNlLkVycm9yLklOQ09SUkVDVF9UWVBFLFxuICAgICAgJ1RoaXMgaXMgbm90IGEgdmFsaWQgJyArIG9iai5fX3R5cGVcbiAgICApO1xuICB9XG4gIGlmIChvYmpbJyRuZSddKSB7XG4gICAgcmV0dXJuIGdldE9iamVjdFR5cGUob2JqWyckbmUnXSk7XG4gIH1cbiAgaWYgKG9iai5fX29wKSB7XG4gICAgc3dpdGNoIChvYmouX19vcCkge1xuICAgICAgY2FzZSAnSW5jcmVtZW50JzpcbiAgICAgICAgcmV0dXJuICdOdW1iZXInO1xuICAgICAgY2FzZSAnRGVsZXRlJzpcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICBjYXNlICdBZGQnOlxuICAgICAgY2FzZSAnQWRkVW5pcXVlJzpcbiAgICAgIGNhc2UgJ1JlbW92ZSc6XG4gICAgICAgIHJldHVybiAnQXJyYXknO1xuICAgICAgY2FzZSAnQWRkUmVsYXRpb24nOlxuICAgICAgY2FzZSAnUmVtb3ZlUmVsYXRpb24nOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHR5cGU6ICdSZWxhdGlvbicsXG4gICAgICAgICAgdGFyZ2V0Q2xhc3M6IG9iai5vYmplY3RzWzBdLmNsYXNzTmFtZSxcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgJ0JhdGNoJzpcbiAgICAgICAgcmV0dXJuIGdldE9iamVjdFR5cGUob2JqLm9wc1swXSk7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyAndW5leHBlY3RlZCBvcDogJyArIG9iai5fX29wO1xuICAgIH1cbiAgfVxuICByZXR1cm4gJ09iamVjdCc7XG59XG5cbmV4cG9ydCB7XG4gIGxvYWQsXG4gIGNsYXNzTmFtZUlzVmFsaWQsXG4gIGZpZWxkTmFtZUlzVmFsaWQsXG4gIGludmFsaWRDbGFzc05hbWVNZXNzYWdlLFxuICBidWlsZE1lcmdlZFNjaGVtYU9iamVjdCxcbiAgc3lzdGVtQ2xhc3NlcyxcbiAgZGVmYXVsdENvbHVtbnMsXG4gIGNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEsXG4gIFZvbGF0aWxlQ2xhc3Nlc1NjaGVtYXMsXG4gIFNjaGVtYUNvbnRyb2xsZXIsXG59O1xuIl19