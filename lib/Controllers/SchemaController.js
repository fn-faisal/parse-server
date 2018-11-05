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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9TY2hlbWFDb250cm9sbGVyLmpzIl0sIm5hbWVzIjpbIlBhcnNlIiwicmVxdWlyZSIsImRlZmF1bHRDb2x1bW5zIiwiT2JqZWN0IiwiZnJlZXplIiwiX0RlZmF1bHQiLCJvYmplY3RJZCIsInR5cGUiLCJjcmVhdGVkQXQiLCJ1cGRhdGVkQXQiLCJBQ0wiLCJfVXNlciIsInVzZXJuYW1lIiwicGFzc3dvcmQiLCJlbWFpbCIsImVtYWlsVmVyaWZpZWQiLCJhdXRoRGF0YSIsIl9JbnN0YWxsYXRpb24iLCJpbnN0YWxsYXRpb25JZCIsImRldmljZVRva2VuIiwiY2hhbm5lbHMiLCJkZXZpY2VUeXBlIiwicHVzaFR5cGUiLCJHQ01TZW5kZXJJZCIsInRpbWVab25lIiwibG9jYWxlSWRlbnRpZmllciIsImJhZGdlIiwiYXBwVmVyc2lvbiIsImFwcE5hbWUiLCJhcHBJZGVudGlmaWVyIiwicGFyc2VWZXJzaW9uIiwiX1JvbGUiLCJuYW1lIiwidXNlcnMiLCJ0YXJnZXRDbGFzcyIsInJvbGVzIiwiX1Nlc3Npb24iLCJyZXN0cmljdGVkIiwidXNlciIsInNlc3Npb25Ub2tlbiIsImV4cGlyZXNBdCIsImNyZWF0ZWRXaXRoIiwiX1Byb2R1Y3QiLCJwcm9kdWN0SWRlbnRpZmllciIsImRvd25sb2FkIiwiZG93bmxvYWROYW1lIiwiaWNvbiIsIm9yZGVyIiwidGl0bGUiLCJzdWJ0aXRsZSIsIl9QdXNoU3RhdHVzIiwicHVzaFRpbWUiLCJzb3VyY2UiLCJxdWVyeSIsInBheWxvYWQiLCJleHBpcnkiLCJleHBpcmF0aW9uX2ludGVydmFsIiwic3RhdHVzIiwibnVtU2VudCIsIm51bUZhaWxlZCIsInB1c2hIYXNoIiwiZXJyb3JNZXNzYWdlIiwic2VudFBlclR5cGUiLCJmYWlsZWRQZXJUeXBlIiwic2VudFBlclVUQ09mZnNldCIsImZhaWxlZFBlclVUQ09mZnNldCIsImNvdW50IiwiX0pvYlN0YXR1cyIsImpvYk5hbWUiLCJtZXNzYWdlIiwicGFyYW1zIiwiZmluaXNoZWRBdCIsIl9Kb2JTY2hlZHVsZSIsImRlc2NyaXB0aW9uIiwic3RhcnRBZnRlciIsImRheXNPZldlZWsiLCJ0aW1lT2ZEYXkiLCJsYXN0UnVuIiwicmVwZWF0TWludXRlcyIsIl9Ib29rcyIsImZ1bmN0aW9uTmFtZSIsImNsYXNzTmFtZSIsInRyaWdnZXJOYW1lIiwidXJsIiwiX0dsb2JhbENvbmZpZyIsIl9BdWRpZW5jZSIsImxhc3RVc2VkIiwidGltZXNVc2VkIiwicmVxdWlyZWRDb2x1bW5zIiwic3lzdGVtQ2xhc3NlcyIsInZvbGF0aWxlQ2xhc3NlcyIsInVzZXJJZFJlZ2V4Iiwicm9sZVJlZ2V4IiwicHVibGljUmVnZXgiLCJyZXF1aXJlQXV0aGVudGljYXRpb25SZWdleCIsInBlcm1pc3Npb25LZXlSZWdleCIsInZlcmlmeVBlcm1pc3Npb25LZXkiLCJrZXkiLCJyZXN1bHQiLCJyZWR1Y2UiLCJpc0dvb2QiLCJyZWdFeCIsIm1hdGNoIiwiRXJyb3IiLCJJTlZBTElEX0pTT04iLCJDTFBWYWxpZEtleXMiLCJ2YWxpZGF0ZUNMUCIsInBlcm1zIiwiZmllbGRzIiwia2V5cyIsImZvckVhY2giLCJvcGVyYXRpb24iLCJpbmRleE9mIiwiQXJyYXkiLCJpc0FycmF5IiwicGVybSIsImpvaW5DbGFzc1JlZ2V4IiwiY2xhc3NBbmRGaWVsZFJlZ2V4IiwiY2xhc3NOYW1lSXNWYWxpZCIsInRlc3QiLCJmaWVsZE5hbWVJc1ZhbGlkIiwiZmllbGROYW1lIiwiZmllbGROYW1lSXNWYWxpZEZvckNsYXNzIiwiaW52YWxpZENsYXNzTmFtZU1lc3NhZ2UiLCJpbnZhbGlkSnNvbkVycm9yIiwidmFsaWROb25SZWxhdGlvbk9yUG9pbnRlclR5cGVzIiwiZmllbGRUeXBlSXNJbnZhbGlkIiwiSU5WQUxJRF9DTEFTU19OQU1FIiwidW5kZWZpbmVkIiwiSU5DT1JSRUNUX1RZUEUiLCJjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hIiwic2NoZW1hIiwiaW5qZWN0RGVmYXVsdFNjaGVtYSIsIl9ycGVybSIsIl93cGVybSIsIl9oYXNoZWRfcGFzc3dvcmQiLCJjb252ZXJ0QWRhcHRlclNjaGVtYVRvUGFyc2VTY2hlbWEiLCJpbmRleGVzIiwibGVuZ3RoIiwiU2NoZW1hRGF0YSIsImNvbnN0cnVjdG9yIiwiYWxsU2NoZW1hcyIsIl9fZGF0YSIsImRlZmluZVByb3BlcnR5IiwiZ2V0IiwiZGF0YSIsImNsYXNzTGV2ZWxQZXJtaXNzaW9ucyIsImRlZmF1bHRTY2hlbWEiLCJfSG9va3NTY2hlbWEiLCJfR2xvYmFsQ29uZmlnU2NoZW1hIiwiX1B1c2hTdGF0dXNTY2hlbWEiLCJfSm9iU3RhdHVzU2NoZW1hIiwiX0pvYlNjaGVkdWxlU2NoZW1hIiwiX0F1ZGllbmNlU2NoZW1hIiwiVm9sYXRpbGVDbGFzc2VzU2NoZW1hcyIsImRiVHlwZU1hdGNoZXNPYmplY3RUeXBlIiwiZGJUeXBlIiwib2JqZWN0VHlwZSIsInR5cGVUb1N0cmluZyIsIlNjaGVtYUNvbnRyb2xsZXIiLCJkYXRhYmFzZUFkYXB0ZXIiLCJzY2hlbWFDYWNoZSIsIl9kYkFkYXB0ZXIiLCJfY2FjaGUiLCJzY2hlbWFEYXRhIiwicmVsb2FkRGF0YSIsIm9wdGlvbnMiLCJjbGVhckNhY2hlIiwicHJvbWlzZSIsIlByb21pc2UiLCJyZXNvbHZlIiwidGhlbiIsImNsZWFyIiwicmVsb2FkRGF0YVByb21pc2UiLCJnZXRBbGxDbGFzc2VzIiwiZXJyIiwiYWxsQ2xhc3NlcyIsIm1hcCIsInNldEFsbENsYXNzZXMiLCJnZXRPbmVTY2hlbWEiLCJhbGxvd1ZvbGF0aWxlQ2xhc3NlcyIsImNhY2hlZCIsImdldENsYXNzIiwic2V0T25lU2NoZW1hIiwiYWRkQ2xhc3NJZk5vdEV4aXN0cyIsInZhbGlkYXRpb25FcnJvciIsInZhbGlkYXRlTmV3Q2xhc3MiLCJyZWplY3QiLCJjcmVhdGVDbGFzcyIsInJlcyIsImNhdGNoIiwiZXJyb3IiLCJjb2RlIiwiRFVQTElDQVRFX1ZBTFVFIiwidXBkYXRlQ2xhc3MiLCJzdWJtaXR0ZWRGaWVsZHMiLCJkYXRhYmFzZSIsImV4aXN0aW5nRmllbGRzIiwiZmllbGQiLCJfX29wIiwibmV3U2NoZW1hIiwiYnVpbGRNZXJnZWRTY2hlbWFPYmplY3QiLCJkZWZhdWx0RmllbGRzIiwiZnVsbE5ld1NjaGVtYSIsImFzc2lnbiIsInZhbGlkYXRlU2NoZW1hRGF0YSIsImRlbGV0ZWRGaWVsZHMiLCJpbnNlcnRlZEZpZWxkcyIsInB1c2giLCJkZWxldGVQcm9taXNlIiwiZGVsZXRlRmllbGRzIiwicHJvbWlzZXMiLCJlbmZvcmNlRmllbGRFeGlzdHMiLCJhbGwiLCJzZXRQZXJtaXNzaW9ucyIsInNldEluZGV4ZXNXaXRoU2NoZW1hRm9ybWF0IiwicmVsb2FkZWRTY2hlbWEiLCJlbmZvcmNlQ2xhc3NFeGlzdHMiLCJleGlzdGluZ0ZpZWxkTmFtZXMiLCJJTlZBTElEX0tFWV9OQU1FIiwiZ2VvUG9pbnRzIiwiZmlsdGVyIiwic2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zIiwic3BsaXQiLCJleHBlY3RlZFR5cGUiLCJnZXRFeHBlY3RlZFR5cGUiLCJhZGRGaWVsZElmTm90RXhpc3RzIiwiZGVsZXRlRmllbGQiLCJmaWVsZE5hbWVzIiwic2NoZW1hRmllbGRzIiwiYWRhcHRlciIsImRlbGV0ZUNsYXNzIiwidmFsaWRhdGVPYmplY3QiLCJvYmplY3QiLCJnZW9jb3VudCIsImV4cGVjdGVkIiwiZ2V0VHlwZSIsInRoZW5WYWxpZGF0ZVJlcXVpcmVkQ29sdW1ucyIsInZhbGlkYXRlUmVxdWlyZWRDb2x1bW5zIiwiY29sdW1ucyIsIm1pc3NpbmdDb2x1bW5zIiwiY29sdW1uIiwidGVzdFBlcm1pc3Npb25zRm9yQ2xhc3NOYW1lIiwiYWNsR3JvdXAiLCJ0ZXN0UGVybWlzc2lvbnMiLCJnZXRDbGFzc0xldmVsUGVybWlzc2lvbnMiLCJjbGFzc1Blcm1pc3Npb25zIiwic29tZSIsImFjbCIsInZhbGlkYXRlUGVybWlzc2lvbiIsIk9CSkVDVF9OT1RfRk9VTkQiLCJwZXJtaXNzaW9uRmllbGQiLCJPUEVSQVRJT05fRk9SQklEREVOIiwiaGFzQ2xhc3MiLCJsb2FkIiwiZGJBZGFwdGVyIiwicHV0UmVxdWVzdCIsInN5c1NjaGVtYUZpZWxkIiwiX2lkIiwib2xkRmllbGQiLCJmaWVsZElzRGVsZXRlZCIsIm5ld0ZpZWxkIiwic2NoZW1hUHJvbWlzZSIsIm9iaiIsImdldE9iamVjdFR5cGUiLCJfX3R5cGUiLCJpc28iLCJsYXRpdHVkZSIsImxvbmdpdHVkZSIsImJhc2U2NCIsImNvb3JkaW5hdGVzIiwib2JqZWN0cyIsIm9wcyJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7QUFrQkE7O0FBQ0E7Ozs7Ozs7Ozs7QUFsQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxNQUFNQSxLQUFLLEdBQUdDLE9BQU8sQ0FBQyxZQUFELENBQVAsQ0FBc0JELEtBQXBDOztBQVdBLE1BQU1FLGNBQTBDLEdBQUdDLE1BQU0sQ0FBQ0MsTUFBUCxDQUFjO0FBQy9EO0FBQ0FDLEVBQUFBLFFBQVEsRUFBRTtBQUNSQyxJQUFBQSxRQUFRLEVBQUU7QUFBRUMsTUFBQUEsSUFBSSxFQUFFO0FBQVIsS0FERjtBQUVSQyxJQUFBQSxTQUFTLEVBQUU7QUFBRUQsTUFBQUEsSUFBSSxFQUFFO0FBQVIsS0FGSDtBQUdSRSxJQUFBQSxTQUFTLEVBQUU7QUFBRUYsTUFBQUEsSUFBSSxFQUFFO0FBQVIsS0FISDtBQUlSRyxJQUFBQSxHQUFHLEVBQUU7QUFBRUgsTUFBQUEsSUFBSSxFQUFFO0FBQVI7QUFKRyxHQUZxRDtBQVEvRDtBQUNBSSxFQUFBQSxLQUFLLEVBQUU7QUFDTEMsSUFBQUEsUUFBUSxFQUFFO0FBQUVMLE1BQUFBLElBQUksRUFBRTtBQUFSLEtBREw7QUFFTE0sSUFBQUEsUUFBUSxFQUFFO0FBQUVOLE1BQUFBLElBQUksRUFBRTtBQUFSLEtBRkw7QUFHTE8sSUFBQUEsS0FBSyxFQUFFO0FBQUVQLE1BQUFBLElBQUksRUFBRTtBQUFSLEtBSEY7QUFJTFEsSUFBQUEsYUFBYSxF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QUNuQixpQkFBTyxTQUFQO0FBQ0Q7O0FBQ0Q7QUF6Q0o7O0FBMkNBLFVBQU0sSUFBSTlRLEtBQUssQ0FBQ3VHLEtBQVYsQ0FDSnZHLEtBQUssQ0FBQ3VHLEtBQU4sQ0FBWTBCLGNBRFIsRUFFSix5QkFBeUJzSSxHQUFHLENBQUNFLE1BRnpCLENBQU47QUFJRDs7QUFDRCxNQUFJRixHQUFHLENBQUMsS0FBRCxDQUFQLEVBQWdCO0FBQ2QsV0FBT0MsYUFBYSxDQUFDRCxHQUFHLENBQUMsS0FBRCxDQUFKLENBQXBCO0FBQ0Q7O0FBQ0QsTUFBSUEsR0FBRyxDQUFDaEUsSUFBUixFQUFjO0FBQ1osWUFBUWdFLEdBQUcsQ0FBQ2hFLElBQVo7QUFDRSxXQUFLLFdBQUw7QUFDRSxlQUFPLFFBQVA7O0FBQ0YsV0FBSyxRQUFMO0FBQ0UsZUFBTyxJQUFQOztBQUNGLFdBQUssS0FBTDtBQUNBLFdBQUssV0FBTDtBQUNBLFdBQUssUUFBTDtBQUNFLGVBQU8sT0FBUDs7QUFDRixXQUFLLGFBQUw7QUFDQSxXQUFLLGdCQUFMO0FBQ0UsZUFBTztBQUNMaE0sVUFBQUEsSUFBSSxFQUFFLFVBREQ7QUFFTDJCLFVBQUFBLFdBQVcsRUFBRXFPLEdBQUcsQ0FBQ1EsT0FBSixDQUFZLENBQVosRUFBZTlMO0FBRnZCLFNBQVA7O0FBSUYsV0FBSyxPQUFMO0FBQ0UsZUFBT3VMLGFBQWEsQ0FBQ0QsR0FBRyxDQUFDUyxHQUFKLENBQVEsQ0FBUixDQUFELENBQXBCOztBQUNGO0FBQ0UsY0FBTSxvQkFBb0JULEdBQUcsQ0FBQ2hFLElBQTlCO0FBbEJKO0FBb0JEOztBQUNELFNBQU8sUUFBUDtBQUNEIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQGZsb3dcbi8vIFRoaXMgY2xhc3MgaGFuZGxlcyBzY2hlbWEgdmFsaWRhdGlvbiwgcGVyc2lzdGVuY2UsIGFuZCBtb2RpZmljYXRpb24uXG4vL1xuLy8gRWFjaCBpbmRpdmlkdWFsIFNjaGVtYSBvYmplY3Qgc2hvdWxkIGJlIGltbXV0YWJsZS4gVGhlIGhlbHBlcnMgdG9cbi8vIGRvIHRoaW5ncyB3aXRoIHRoZSBTY2hlbWEganVzdCByZXR1cm4gYSBuZXcgc2NoZW1hIHdoZW4gdGhlIHNjaGVtYVxuLy8gaXMgY2hhbmdlZC5cbi8vXG4vLyBUaGUgY2Fub25pY2FsIHBsYWNlIHRvIHN0b3JlIHRoaXMgU2NoZW1hIGlzIGluIHRoZSBkYXRhYmFzZSBpdHNlbGYsXG4vLyBpbiBhIF9TQ0hFTUEgY29sbGVjdGlvbi4gVGhpcyBpcyBub3QgdGhlIHJpZ2h0IHdheSB0byBkbyBpdCBmb3IgYW5cbi8vIG9wZW4gc291cmNlIGZyYW1ld29yaywgYnV0IGl0J3MgYmFja3dhcmQgY29tcGF0aWJsZSwgc28gd2UncmVcbi8vIGtlZXBpbmcgaXQgdGhpcyB3YXkgZm9yIG5vdy5cbi8vXG4vLyBJbiBBUEktaGFuZGxpbmcgY29kZSwgeW91IHNob3VsZCBvbmx5IHVzZSB0aGUgU2NoZW1hIGNsYXNzIHZpYSB0aGVcbi8vIERhdGFiYXNlQ29udHJvbGxlci4gVGhpcyB3aWxsIGxldCB1cyByZXBsYWNlIHRoZSBzY2hlbWEgbG9naWMgZm9yXG4vLyBkaWZmZXJlbnQgZGF0YWJhc2VzLlxuLy8gVE9ETzogaGlkZSBhbGwgc2NoZW1hIGxvZ2ljIGluc2lkZSB0aGUgZGF0YWJhc2UgYWRhcHRlci5cbi8vIEBmbG93LWRpc2FibGUtbmV4dFxuY29uc3QgUGFyc2UgPSByZXF1aXJlKCdwYXJzZS9ub2RlJykuUGFyc2U7XG5pbXBvcnQgeyBTdG9yYWdlQWRhcHRlciB9IGZyb20gJy4uL0FkYXB0ZXJzL1N0b3JhZ2UvU3RvcmFnZUFkYXB0ZXInO1xuaW1wb3J0IERhdGFiYXNlQ29udHJvbGxlciBmcm9tICcuL0RhdGFiYXNlQ29udHJvbGxlcic7XG5pbXBvcnQgdHlwZSB7XG4gIFNjaGVtYSxcbiAgU2NoZW1hRmllbGRzLFxuICBDbGFzc0xldmVsUGVybWlzc2lvbnMsXG4gIFNjaGVtYUZpZWxkLFxuICBMb2FkU2NoZW1hT3B0aW9ucyxcbn0gZnJvbSAnLi90eXBlcyc7XG5cbmNvbnN0IGRlZmF1bHRDb2x1bW5zOiB7IFtzdHJpbmddOiBTY2hlbWFGaWVsZHMgfSA9IE9iamVjdC5mcmVlemUoe1xuICAvLyBDb250YWluIHRoZSBkZWZhdWx0IGNvbHVtbnMgZm9yIGV2ZXJ5IHBhcnNlIG9iamVjdCB0eXBlIChleGNlcHQgX0pvaW4gY29sbGVjdGlvbilcbiAgX0RlZmF1bHQ6IHtcbiAgICBvYmplY3RJZDogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGNyZWF0ZWRBdDogeyB0eXBlOiAnRGF0ZScgfSxcbiAgICB1cGRhdGVkQXQ6IHsgdHlwZTogJ0RhdGUnIH0sXG4gICAgQUNMOiB7IHR5cGU6ICdBQ0wnIH0sXG4gIH0sXG4gIC8vIFRoZSBhZGRpdGlvbmFsIGRlZmF1bHQgY29sdW1ucyBmb3IgdGhlIF9Vc2VyIGNvbGxlY3Rpb24gKGluIGFkZGl0aW9uIHRvIERlZmF1bHRDb2xzKVxuICBfVXNlcjoge1xuICAgIHVzZXJuYW1lOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgcGFzc3dvcmQ6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBlbWFpbDogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGVtYWlsVmVyaWZpZWQ6IHsgdHlwZTogJ0Jvb2xlYW4nIH0sXG4gICAgYXV0aERhdGE6IHsgdHlwZTogJ09iamVjdCcgfSxcbiAgfSxcbiAgLy8gVGhlIGFkZGl0aW9uYWwgZGVmYXVsdCBjb2x1bW5zIGZvciB0aGUgX0luc3RhbGxhdGlvbiBjb2xsZWN0aW9uIChpbiBhZGRpdGlvbiB0byBEZWZhdWx0Q29scylcbiAgX0luc3RhbGxhdGlvbjoge1xuICAgIGluc3RhbGxhdGlvbklkOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgZGV2aWNlVG9rZW46IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBjaGFubmVsczogeyB0eXBlOiAnQXJyYXknIH0sXG4gICAgZGV2aWNlVHlwZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHB1c2hUeXBlOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgR0NNU2VuZGVySWQ6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICB0aW1lWm9uZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGxvY2FsZUlkZW50aWZpZXI6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBiYWRnZTogeyB0eXBlOiAnTnVtYmVyJyB9LFxuICAgIGFwcFZlcnNpb246IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBhcHBOYW1lOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgYXBwSWRlbnRpZmllcjogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHBhcnNlVmVyc2lvbjogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICB9LFxuICAvLyBUaGUgYWRkaXRpb25hbCBkZWZhdWx0IGNvbHVtbnMgZm9yIHRoZSBfUm9sZSBjb2xsZWN0aW9uIChpbiBhZGRpdGlvbiB0byBEZWZhdWx0Q29scylcbiAgX1JvbGU6IHtcbiAgICBuYW1lOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgdXNlcnM6IHsgdHlwZTogJ1JlbGF0aW9uJywgdGFyZ2V0Q2xhc3M6ICdfVXNlcicgfSxcbiAgICByb2xlczogeyB0eXBlOiAnUmVsYXRpb24nLCB0YXJnZXRDbGFzczogJ19Sb2xlJyB9LFxuICB9LFxuICAvLyBUaGUgYWRkaXRpb25hbCBkZWZhdWx0IGNvbHVtbnMgZm9yIHRoZSBfU2Vzc2lvbiBjb2xsZWN0aW9uIChpbiBhZGRpdGlvbiB0byBEZWZhdWx0Q29scylcbiAgX1Nlc3Npb246IHtcbiAgICByZXN0cmljdGVkOiB7IHR5cGU6ICdCb29sZWFuJyB9LFxuICAgIHVzZXI6IHsgdHlwZTogJ1BvaW50ZXInLCB0YXJnZXRDbGFzczogJ19Vc2VyJyB9LFxuICAgIGluc3RhbGxhdGlvbklkOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgc2Vzc2lvblRva2VuOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgZXhwaXJlc0F0OiB7IHR5cGU6ICdEYXRlJyB9LFxuICAgIGNyZWF0ZWRXaXRoOiB7IHR5cGU6ICdPYmplY3QnIH0sXG4gIH0sXG4gIF9Qcm9kdWN0OiB7XG4gICAgcHJvZHVjdElkZW50aWZpZXI6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBkb3dubG9hZDogeyB0eXBlOiAnRmlsZScgfSxcbiAgICBkb3dubG9hZE5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBpY29uOiB7IHR5cGU6ICdGaWxlJyB9LFxuICAgIG9yZGVyOiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gICAgdGl0bGU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBzdWJ0aXRsZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICB9LFxuICBfUHVzaFN0YXR1czoge1xuICAgIHB1c2hUaW1lOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgc291cmNlOiB7IHR5cGU6ICdTdHJpbmcnIH0sIC8vIHJlc3Qgb3Igd2VidWlcbiAgICBxdWVyeTogeyB0eXBlOiAnU3RyaW5nJyB9LCAvLyB0aGUgc3RyaW5naWZpZWQgSlNPTiBxdWVyeVxuICAgIHBheWxvYWQ6IHsgdHlwZTogJ1N0cmluZycgfSwgLy8gdGhlIHN0cmluZ2lmaWVkIEpTT04gcGF5bG9hZCxcbiAgICB0aXRsZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIGV4cGlyeTogeyB0eXBlOiAnTnVtYmVyJyB9LFxuICAgIGV4cGlyYXRpb25faW50ZXJ2YWw6IHsgdHlwZTogJ051bWJlcicgfSxcbiAgICBzdGF0dXM6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBudW1TZW50OiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gICAgbnVtRmFpbGVkOiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gICAgcHVzaEhhc2g6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBlcnJvck1lc3NhZ2U6IHsgdHlwZTogJ09iamVjdCcgfSxcbiAgICBzZW50UGVyVHlwZTogeyB0eXBlOiAnT2JqZWN0JyB9LFxuICAgIGZhaWxlZFBlclR5cGU6IHsgdHlwZTogJ09iamVjdCcgfSxcbiAgICBzZW50UGVyVVRDT2Zmc2V0OiB7IHR5cGU6ICdPYmplY3QnIH0sXG4gICAgZmFpbGVkUGVyVVRDT2Zmc2V0OiB7IHR5cGU6ICdPYmplY3QnIH0sXG4gICAgY291bnQ6IHsgdHlwZTogJ051bWJlcicgfSwgLy8gdHJhY2tzICMgb2YgYmF0Y2hlcyBxdWV1ZWQgYW5kIHBlbmRpbmdcbiAgfSxcbiAgX0pvYlN0YXR1czoge1xuICAgIGpvYk5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBzb3VyY2U6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBzdGF0dXM6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBtZXNzYWdlOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgcGFyYW1zOiB7IHR5cGU6ICdPYmplY3QnIH0sIC8vIHBhcmFtcyByZWNlaXZlZCB3aGVuIGNhbGxpbmcgdGhlIGpvYlxuICAgIGZpbmlzaGVkQXQ6IHsgdHlwZTogJ0RhdGUnIH0sXG4gIH0sXG4gIF9Kb2JTY2hlZHVsZToge1xuICAgIGpvYk5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBkZXNjcmlwdGlvbjogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHBhcmFtczogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHN0YXJ0QWZ0ZXI6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBkYXlzT2ZXZWVrOiB7IHR5cGU6ICdBcnJheScgfSxcbiAgICB0aW1lT2ZEYXk6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBsYXN0UnVuOiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gICAgcmVwZWF0TWludXRlczogeyB0eXBlOiAnTnVtYmVyJyB9LFxuICB9LFxuICBfSG9va3M6IHtcbiAgICBmdW5jdGlvbk5hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBjbGFzc05hbWU6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICB0cmlnZ2VyTmFtZTogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICAgIHVybDogeyB0eXBlOiAnU3RyaW5nJyB9LFxuICB9LFxuICBfR2xvYmFsQ29uZmlnOiB7XG4gICAgb2JqZWN0SWQ6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBwYXJhbXM6IHsgdHlwZTogJ09iamVjdCcgfSxcbiAgfSxcbiAgX0F1ZGllbmNlOiB7XG4gICAgb2JqZWN0SWQ6IHsgdHlwZTogJ1N0cmluZycgfSxcbiAgICBuYW1lOiB7IHR5cGU6ICdTdHJpbmcnIH0sXG4gICAgcXVlcnk6IHsgdHlwZTogJ1N0cmluZycgfSwgLy9zdG9yaW5nIHF1ZXJ5IGFzIEpTT04gc3RyaW5nIHRvIHByZXZlbnQgXCJOZXN0ZWQga2V5cyBzaG91bGQgbm90IGNvbnRhaW4gdGhlICckJyBvciAnLicgY2hhcmFjdGVyc1wiIGVycm9yXG4gICAgbGFzdFVzZWQ6IHsgdHlwZTogJ0RhdGUnIH0sXG4gICAgdGltZXNVc2VkOiB7IHR5cGU6ICdOdW1iZXInIH0sXG4gIH0sXG59KTtcblxuY29uc3QgcmVxdWlyZWRDb2x1bW5zID0gT2JqZWN0LmZyZWV6ZSh7XG4gIF9Qcm9kdWN0OiBbJ3Byb2R1Y3RJZGVudGlmaWVyJywgJ2ljb24nLCAnb3JkZXInLCAndGl0bGUnLCAnc3VidGl0bGUnXSxcbiAgX1JvbGU6IFsnbmFtZScsICdBQ0wnXSxcbn0pO1xuXG5jb25zdCBzeXN0ZW1DbGFzc2VzID0gT2JqZWN0LmZyZWV6ZShbXG4gICdfVXNlcicsXG4gICdfSW5zdGFsbGF0aW9uJyxcbiAgJ19Sb2xlJyxcbiAgJ19TZXNzaW9uJyxcbiAgJ19Qcm9kdWN0JyxcbiAgJ19QdXNoU3RhdHVzJyxcbiAgJ19Kb2JTdGF0dXMnLFxuICAnX0pvYlNjaGVkdWxlJyxcbiAgJ19BdWRpZW5jZScsXG4gICdfRXhwb3J0UHJvZ3Jlc3MnLFxuXSk7XG5cbmNvbnN0IHZvbGF0aWxlQ2xhc3NlcyA9IE9iamVjdC5mcmVlemUoW1xuICAnX0pvYlN0YXR1cycsXG4gICdfUHVzaFN0YXR1cycsXG4gICdfSG9va3MnLFxuICAnX0dsb2JhbENvbmZpZycsXG4gICdfSm9iU2NoZWR1bGUnLFxuICAnX0F1ZGllbmNlJyxcbiAgJ19FeHBvcnRQcm9ncmVzcycsXG5dKTtcblxuLy8gMTAgYWxwaGEgbnVtYmVyaWMgY2hhcnMgKyB1cHBlcmNhc2VcbmNvbnN0IHVzZXJJZFJlZ2V4ID0gL15bYS16QS1aMC05XXsxMH0kLztcbi8vIEFueXRoaW5nIHRoYXQgc3RhcnQgd2l0aCByb2xlXG5jb25zdCByb2xlUmVnZXggPSAvXnJvbGU6LiovO1xuLy8gKiBwZXJtaXNzaW9uXG5jb25zdCBwdWJsaWNSZWdleCA9IC9eXFwqJC87XG5cbmNvbnN0IHJlcXVpcmVBdXRoZW50aWNhdGlvblJlZ2V4ID0gL15yZXF1aXJlc0F1dGhlbnRpY2F0aW9uJC87XG5cbmNvbnN0IHBlcm1pc3Npb25LZXlSZWdleCA9IE9iamVjdC5mcmVlemUoW1xuICB1c2VySWRSZWdleCxcbiAgcm9sZVJlZ2V4LFxuICBwdWJsaWNSZWdleCxcbiAgcmVxdWlyZUF1dGhlbnRpY2F0aW9uUmVnZXgsXG5dKTtcblxuZnVuY3Rpb24gdmVyaWZ5UGVybWlzc2lvbktleShrZXkpIHtcbiAgY29uc3QgcmVzdWx0ID0gcGVybWlzc2lvbktleVJlZ2V4LnJlZHVjZSgoaXNHb29kLCByZWdFeCkgPT4ge1xuICAgIGlzR29vZCA9IGlzR29vZCB8fCBrZXkubWF0Y2gocmVnRXgpICE9IG51bGw7XG4gICAgcmV0dXJuIGlzR29vZDtcbiAgfSwgZmFsc2UpO1xuICBpZiAoIXJlc3VsdCkge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgIGAnJHtrZXl9JyBpcyBub3QgYSB2YWxpZCBrZXkgZm9yIGNsYXNzIGxldmVsIHBlcm1pc3Npb25zYFxuICAgICk7XG4gIH1cbn1cblxuY29uc3QgQ0xQVmFsaWRLZXlzID0gT2JqZWN0LmZyZWV6ZShbXG4gICdmaW5kJyxcbiAgJ2NvdW50JyxcbiAgJ2dldCcsXG4gICdjcmVhdGUnLFxuICAndXBkYXRlJyxcbiAgJ2RlbGV0ZScsXG4gICdhZGRGaWVsZCcsXG4gICdyZWFkVXNlckZpZWxkcycsXG4gICd3cml0ZVVzZXJGaWVsZHMnLFxuXSk7XG5mdW5jdGlvbiB2YWxpZGF0ZUNMUChwZXJtczogQ2xhc3NMZXZlbFBlcm1pc3Npb25zLCBmaWVsZHM6IFNjaGVtYUZpZWxkcykge1xuICBpZiAoIXBlcm1zKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIE9iamVjdC5rZXlzKHBlcm1zKS5mb3JFYWNoKG9wZXJhdGlvbiA9PiB7XG4gICAgaWYgKENMUFZhbGlkS2V5cy5pbmRleE9mKG9wZXJhdGlvbikgPT0gLTEpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICBgJHtvcGVyYXRpb259IGlzIG5vdCBhIHZhbGlkIG9wZXJhdGlvbiBmb3IgY2xhc3MgbGV2ZWwgcGVybWlzc2lvbnNgXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoIXBlcm1zW29wZXJhdGlvbl0pIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAob3BlcmF0aW9uID09PSAncmVhZFVzZXJGaWVsZHMnIHx8IG9wZXJhdGlvbiA9PT0gJ3dyaXRlVXNlckZpZWxkcycpIHtcbiAgICAgIGlmICghQXJyYXkuaXNBcnJheShwZXJtc1tvcGVyYXRpb25dKSkge1xuICAgICAgICAvLyBAZmxvdy1kaXNhYmxlLW5leHRcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICBgJyR7XG4gICAgICAgICAgICBwZXJtc1tvcGVyYXRpb25dXG4gICAgICAgICAgfScgaXMgbm90IGEgdmFsaWQgdmFsdWUgZm9yIGNsYXNzIGxldmVsIHBlcm1pc3Npb25zICR7b3BlcmF0aW9ufWBcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBlcm1zW29wZXJhdGlvbl0uZm9yRWFjaChrZXkgPT4ge1xuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICFmaWVsZHNba2V5XSB8fFxuICAgICAgICAgICAgZmllbGRzW2tleV0udHlwZSAhPSAnUG9pbnRlcicgfHxcbiAgICAgICAgICAgIGZpZWxkc1trZXldLnRhcmdldENsYXNzICE9ICdfVXNlcidcbiAgICAgICAgICApIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgICBgJyR7a2V5fScgaXMgbm90IGEgdmFsaWQgY29sdW1uIGZvciBjbGFzcyBsZXZlbCBwb2ludGVyIHBlcm1pc3Npb25zICR7b3BlcmF0aW9ufWBcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBAZmxvdy1kaXNhYmxlLW5leHRcbiAgICBPYmplY3Qua2V5cyhwZXJtc1tvcGVyYXRpb25dKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICB2ZXJpZnlQZXJtaXNzaW9uS2V5KGtleSk7XG4gICAgICAvLyBAZmxvdy1kaXNhYmxlLW5leHRcbiAgICAgIGNvbnN0IHBlcm0gPSBwZXJtc1tvcGVyYXRpb25dW2tleV07XG4gICAgICBpZiAocGVybSAhPT0gdHJ1ZSkge1xuICAgICAgICAvLyBAZmxvdy1kaXNhYmxlLW5leHRcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICBgJyR7cGVybX0nIGlzIG5vdCBhIHZhbGlkIHZhbHVlIGZvciBjbGFzcyBsZXZlbCBwZXJtaXNzaW9ucyAke29wZXJhdGlvbn06JHtrZXl9OiR7cGVybX1gXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xufVxuY29uc3Qgam9pbkNsYXNzUmVnZXggPSAvXl9Kb2luOltBLVphLXowLTlfXSs6W0EtWmEtejAtOV9dKy87XG5jb25zdCBjbGFzc0FuZEZpZWxkUmVnZXggPSAvXltBLVphLXpdW0EtWmEtejAtOV9dKiQvO1xuZnVuY3Rpb24gY2xhc3NOYW1lSXNWYWxpZChjbGFzc05hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAvLyBWYWxpZCBjbGFzc2VzIG11c3Q6XG4gIHJldHVybiAoXG4gICAgLy8gQmUgb25lIG9mIF9Vc2VyLCBfSW5zdGFsbGF0aW9uLCBfUm9sZSwgX1Nlc3Npb24gT1JcbiAgICBzeXN0ZW1DbGFzc2VzLmluZGV4T2YoY2xhc3NOYW1lKSA+IC0xIHx8XG4gICAgLy8gQmUgYSBqb2luIHRhYmxlIE9SXG4gICAgam9pbkNsYXNzUmVnZXgudGVzdChjbGFzc05hbWUpIHx8XG4gICAgLy8gSW5jbHVkZSBvbmx5IGFscGhhLW51bWVyaWMgYW5kIHVuZGVyc2NvcmVzLCBhbmQgbm90IHN0YXJ0IHdpdGggYW4gdW5kZXJzY29yZSBvciBudW1iZXJcbiAgICBmaWVsZE5hbWVJc1ZhbGlkKGNsYXNzTmFtZSlcbiAgKTtcbn1cblxuLy8gVmFsaWQgZmllbGRzIG11c3QgYmUgYWxwaGEtbnVtZXJpYywgYW5kIG5vdCBzdGFydCB3aXRoIGFuIHVuZGVyc2NvcmUgb3IgbnVtYmVyXG5mdW5jdGlvbiBmaWVsZE5hbWVJc1ZhbGlkKGZpZWxkTmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBjbGFzc0FuZEZpZWxkUmVnZXgudGVzdChmaWVsZE5hbWUpO1xufVxuXG4vLyBDaGVja3MgdGhhdCBpdCdzIG5vdCB0cnlpbmcgdG8gY2xvYmJlciBvbmUgb2YgdGhlIGRlZmF1bHQgZmllbGRzIG9mIHRoZSBjbGFzcy5cbmZ1bmN0aW9uIGZpZWxkTmFtZUlzVmFsaWRGb3JDbGFzcyhcbiAgZmllbGROYW1lOiBzdHJpbmcsXG4gIGNsYXNzTmFtZTogc3RyaW5nXG4pOiBib29sZWFuIHtcbiAgaWYgKCFmaWVsZE5hbWVJc1ZhbGlkKGZpZWxkTmFtZSkpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKGRlZmF1bHRDb2x1bW5zLl9EZWZhdWx0W2ZpZWxkTmFtZV0pIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKGRlZmF1bHRDb2x1bW5zW2NsYXNzTmFtZV0gJiYgZGVmYXVsdENvbHVtbnNbY2xhc3NOYW1lXVtmaWVsZE5hbWVdKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHJldHVybiB0cnVlO1xufVxuXG5mdW5jdGlvbiBpbnZhbGlkQ2xhc3NOYW1lTWVzc2FnZShjbGFzc05hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiAoXG4gICAgJ0ludmFsaWQgY2xhc3NuYW1lOiAnICtcbiAgICBjbGFzc05hbWUgK1xuICAgICcsIGNsYXNzbmFtZXMgY2FuIG9ubHkgaGF2ZSBhbHBoYW51bWVyaWMgY2hhcmFjdGVycyBhbmQgXywgYW5kIG11c3Qgc3RhcnQgd2l0aCBhbiBhbHBoYSBjaGFyYWN0ZXIgJ1xuICApO1xufVxuXG5jb25zdCBpbnZhbGlkSnNvbkVycm9yID0gbmV3IFBhcnNlLkVycm9yKFxuICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICdpbnZhbGlkIEpTT04nXG4pO1xuY29uc3QgdmFsaWROb25SZWxhdGlvbk9yUG9pbnRlclR5cGVzID0gW1xuICAnTnVtYmVyJyxcbiAgJ1N0cmluZycsXG4gICdCb29sZWFuJyxcbiAgJ0RhdGUnLFxuICAnT2JqZWN0JyxcbiAgJ0FycmF5JyxcbiAgJ0dlb1BvaW50JyxcbiAgJ0ZpbGUnLFxuICAnQnl0ZXMnLFxuICAnUG9seWdvbicsXG5dO1xuLy8gUmV0dXJucyBhbiBlcnJvciBzdWl0YWJsZSBmb3IgdGhyb3dpbmcgaWYgdGhlIHR5cGUgaXMgaW52YWxpZFxuY29uc3QgZmllbGRUeXBlSXNJbnZhbGlkID0gKHsgdHlwZSwgdGFyZ2V0Q2xhc3MgfSkgPT4ge1xuICBpZiAoWydQb2ludGVyJywgJ1JlbGF0aW9uJ10uaW5kZXhPZih0eXBlKSA+PSAwKSB7XG4gICAgaWYgKCF0YXJnZXRDbGFzcykge1xuICAgICAgcmV0dXJuIG5ldyBQYXJzZS5FcnJvcigxMzUsIGB0eXBlICR7dHlwZX0gbmVlZHMgYSBjbGFzcyBuYW1lYCk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgdGFyZ2V0Q2xhc3MgIT09ICdzdHJpbmcnKSB7XG4gICAgICByZXR1cm4gaW52YWxpZEpzb25FcnJvcjtcbiAgICB9IGVsc2UgaWYgKCFjbGFzc05hbWVJc1ZhbGlkKHRhcmdldENsYXNzKSkge1xuICAgICAgcmV0dXJuIG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9DTEFTU19OQU1FLFxuICAgICAgICBpbnZhbGlkQ2xhc3NOYW1lTWVzc2FnZSh0YXJnZXRDbGFzcylcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICB9XG4gIGlmICh0eXBlb2YgdHlwZSAhPT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gaW52YWxpZEpzb25FcnJvcjtcbiAgfVxuICBpZiAodmFsaWROb25SZWxhdGlvbk9yUG9pbnRlclR5cGVzLmluZGV4T2YodHlwZSkgPCAwKSB7XG4gICAgcmV0dXJuIG5ldyBQYXJzZS5FcnJvcihcbiAgICAgIFBhcnNlLkVycm9yLklOQ09SUkVDVF9UWVBFLFxuICAgICAgYGludmFsaWQgZmllbGQgdHlwZTogJHt0eXBlfWBcbiAgICApO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59O1xuXG5jb25zdCBjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hID0gKHNjaGVtYTogYW55KSA9PiB7XG4gIHNjaGVtYSA9IGluamVjdERlZmF1bHRTY2hlbWEoc2NoZW1hKTtcbiAgZGVsZXRlIHNjaGVtYS5maWVsZHMuQUNMO1xuICBzY2hlbWEuZmllbGRzLl9ycGVybSA9IHsgdHlwZTogJ0FycmF5JyB9O1xuICBzY2hlbWEuZmllbGRzLl93cGVybSA9IHsgdHlwZTogJ0FycmF5JyB9O1xuXG4gIGlmIChzY2hlbWEuY2xhc3NOYW1lID09PSAnX1VzZXInKSB7XG4gICAgZGVsZXRlIHNjaGVtYS5maWVsZHMucGFzc3dvcmQ7XG4gICAgc2NoZW1hLmZpZWxkcy5faGFzaGVkX3Bhc3N3b3JkID0geyB0eXBlOiAnU3RyaW5nJyB9O1xuICB9XG5cbiAgcmV0dXJuIHNjaGVtYTtcbn07XG5cbmNvbnN0IGNvbnZlcnRBZGFwdGVyU2NoZW1hVG9QYXJzZVNjaGVtYSA9ICh7IC4uLnNjaGVtYSB9KSA9PiB7XG4gIGRlbGV0ZSBzY2hlbWEuZmllbGRzLl9ycGVybTtcbiAgZGVsZXRlIHNjaGVtYS5maWVsZHMuX3dwZXJtO1xuXG4gIHNjaGVtYS5maWVsZHMuQUNMID0geyB0eXBlOiAnQUNMJyB9O1xuXG4gIGlmIChzY2hlbWEuY2xhc3NOYW1lID09PSAnX1VzZXInKSB7XG4gICAgZGVsZXRlIHNjaGVtYS5maWVsZHMuYXV0aERhdGE7IC8vQXV0aCBkYXRhIGlzIGltcGxpY2l0XG4gICAgZGVsZXRlIHNjaGVtYS5maWVsZHMuX2hhc2hlZF9wYXNzd29yZDtcbiAgICBzY2hlbWEuZmllbGRzLnBhc3N3b3JkID0geyB0eXBlOiAnU3RyaW5nJyB9O1xuICB9XG5cbiAgaWYgKHNjaGVtYS5pbmRleGVzICYmIE9iamVjdC5rZXlzKHNjaGVtYS5pbmRleGVzKS5sZW5ndGggPT09IDApIHtcbiAgICBkZWxldGUgc2NoZW1hLmluZGV4ZXM7XG4gIH1cblxuICByZXR1cm4gc2NoZW1hO1xufTtcblxuY2xhc3MgU2NoZW1hRGF0YSB7XG4gIF9fZGF0YTogYW55O1xuICBjb25zdHJ1Y3RvcihhbGxTY2hlbWFzID0gW10pIHtcbiAgICB0aGlzLl9fZGF0YSA9IHt9O1xuICAgIGFsbFNjaGVtYXMuZm9yRWFjaChzY2hlbWEgPT4ge1xuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRoaXMsIHNjaGVtYS5jbGFzc05hbWUsIHtcbiAgICAgICAgZ2V0OiAoKSA9PiB7XG4gICAgICAgICAgaWYgKCF0aGlzLl9fZGF0YVtzY2hlbWEuY2xhc3NOYW1lXSkge1xuICAgICAgICAgICAgY29uc3QgZGF0YSA9IHt9O1xuICAgICAgICAgICAgZGF0YS5maWVsZHMgPSBpbmplY3REZWZhdWx0U2NoZW1hKHNjaGVtYSkuZmllbGRzO1xuICAgICAgICAgICAgZGF0YS5jbGFzc0xldmVsUGVybWlzc2lvbnMgPSBzY2hlbWEuY2xhc3NMZXZlbFBlcm1pc3Npb25zO1xuICAgICAgICAgICAgZGF0YS5pbmRleGVzID0gc2NoZW1hLmluZGV4ZXM7XG4gICAgICAgICAgICB0aGlzLl9fZGF0YVtzY2hlbWEuY2xhc3NOYW1lXSA9IGRhdGE7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiB0aGlzLl9fZGF0YVtzY2hlbWEuY2xhc3NOYW1lXTtcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gSW5qZWN0IHRoZSBpbi1tZW1vcnkgY2xhc3Nlc1xuICAgIHZvbGF0aWxlQ2xhc3Nlcy5mb3JFYWNoKGNsYXNzTmFtZSA9PiB7XG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgY2xhc3NOYW1lLCB7XG4gICAgICAgIGdldDogKCkgPT4ge1xuICAgICAgICAgIGlmICghdGhpcy5fX2RhdGFbY2xhc3NOYW1lXSkge1xuICAgICAgICAgICAgY29uc3Qgc2NoZW1hID0gaW5qZWN0RGVmYXVsdFNjaGVtYSh7XG4gICAgICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICAgICAgZmllbGRzOiB7fSxcbiAgICAgICAgICAgICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiB7fSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgY29uc3QgZGF0YSA9IHt9O1xuICAgICAgICAgICAgZGF0YS5maWVsZHMgPSBzY2hlbWEuZmllbGRzO1xuICAgICAgICAgICAgZGF0YS5jbGFzc0xldmVsUGVybWlzc2lvbnMgPSBzY2hlbWEuY2xhc3NMZXZlbFBlcm1pc3Npb25zO1xuICAgICAgICAgICAgZGF0YS5pbmRleGVzID0gc2NoZW1hLmluZGV4ZXM7XG4gICAgICAgICAgICB0aGlzLl9fZGF0YVtjbGFzc05hbWVdID0gZGF0YTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHRoaXMuX19kYXRhW2NsYXNzTmFtZV07XG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxufVxuXG5jb25zdCBpbmplY3REZWZhdWx0U2NoZW1hID0gKHtcbiAgY2xhc3NOYW1lLFxuICBmaWVsZHMsXG4gIGNsYXNzTGV2ZWxQZXJtaXNzaW9ucyxcbiAgaW5kZXhlcyxcbn06IFNjaGVtYSkgPT4ge1xuICBjb25zdCBkZWZhdWx0U2NoZW1hOiBTY2hlbWEgPSB7XG4gICAgY2xhc3NOYW1lLFxuICAgIGZpZWxkczoge1xuICAgICAgLi4uZGVmYXVsdENvbHVtbnMuX0RlZmF1bHQsXG4gICAgICAuLi4oZGVmYXVsdENvbHVtbnNbY2xhc3NOYW1lXSB8fCB7fSksXG4gICAgICAuLi5maWVsZHMsXG4gICAgfSxcbiAgICBjbGFzc0xldmVsUGVybWlzc2lvbnMsXG4gIH07XG4gIGlmIChpbmRleGVzICYmIE9iamVjdC5rZXlzKGluZGV4ZXMpLmxlbmd0aCAhPT0gMCkge1xuICAgIGRlZmF1bHRTY2hlbWEuaW5kZXhlcyA9IGluZGV4ZXM7XG4gIH1cbiAgcmV0dXJuIGRlZmF1bHRTY2hlbWE7XG59O1xuXG5jb25zdCBfSG9va3NTY2hlbWEgPSB7IGNsYXNzTmFtZTogJ19Ib29rcycsIGZpZWxkczogZGVmYXVsdENvbHVtbnMuX0hvb2tzIH07XG5jb25zdCBfR2xvYmFsQ29uZmlnU2NoZW1hID0ge1xuICBjbGFzc05hbWU6ICdfR2xvYmFsQ29uZmlnJyxcbiAgZmllbGRzOiBkZWZhdWx0Q29sdW1ucy5fR2xvYmFsQ29uZmlnLFxufTtcbmNvbnN0IF9QdXNoU3RhdHVzU2NoZW1hID0gY29udmVydFNjaGVtYVRvQWRhcHRlclNjaGVtYShcbiAgaW5qZWN0RGVmYXVsdFNjaGVtYSh7XG4gICAgY2xhc3NOYW1lOiAnX1B1c2hTdGF0dXMnLFxuICAgIGZpZWxkczoge30sXG4gICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiB7fSxcbiAgfSlcbik7XG5jb25zdCBfSm9iU3RhdHVzU2NoZW1hID0gY29udmVydFNjaGVtYVRvQWRhcHRlclNjaGVtYShcbiAgaW5qZWN0RGVmYXVsdFNjaGVtYSh7XG4gICAgY2xhc3NOYW1lOiAnX0pvYlN0YXR1cycsXG4gICAgZmllbGRzOiB7fSxcbiAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IHt9LFxuICB9KVxuKTtcbmNvbnN0IF9Kb2JTY2hlZHVsZVNjaGVtYSA9IGNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEoXG4gIGluamVjdERlZmF1bHRTY2hlbWEoe1xuICAgIGNsYXNzTmFtZTogJ19Kb2JTY2hlZHVsZScsXG4gICAgZmllbGRzOiB7fSxcbiAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IHt9LFxuICB9KVxuKTtcbmNvbnN0IF9BdWRpZW5jZVNjaGVtYSA9IGNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEoXG4gIGluamVjdERlZmF1bHRTY2hlbWEoe1xuICAgIGNsYXNzTmFtZTogJ19BdWRpZW5jZScsXG4gICAgZmllbGRzOiBkZWZhdWx0Q29sdW1ucy5fQXVkaWVuY2UsXG4gICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiB7fSxcbiAgfSlcbik7XG5jb25zdCBWb2xhdGlsZUNsYXNzZXNTY2hlbWFzID0gW1xuICBfSG9va3NTY2hlbWEsXG4gIF9Kb2JTdGF0dXNTY2hlbWEsXG4gIF9Kb2JTY2hlZHVsZVNjaGVtYSxcbiAgX1B1c2hTdGF0dXNTY2hlbWEsXG4gIF9HbG9iYWxDb25maWdTY2hlbWEsXG4gIF9BdWRpZW5jZVNjaGVtYSxcbl07XG5cbmNvbnN0IGRiVHlwZU1hdGNoZXNPYmplY3RUeXBlID0gKFxuICBkYlR5cGU6IFNjaGVtYUZpZWxkIHwgc3RyaW5nLFxuICBvYmplY3RUeXBlOiBTY2hlbWFGaWVsZFxuKSA9PiB7XG4gIGlmIChkYlR5cGUudHlwZSAhPT0gb2JqZWN0VHlwZS50eXBlKSByZXR1cm4gZmFsc2U7XG4gIGlmIChkYlR5cGUudGFyZ2V0Q2xhc3MgIT09IG9iamVjdFR5cGUudGFyZ2V0Q2xhc3MpIHJldHVybiBmYWxzZTtcbiAgaWYgKGRiVHlwZSA9PT0gb2JqZWN0VHlwZS50eXBlKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKGRiVHlwZS50eXBlID09PSBvYmplY3RUeXBlLnR5cGUpIHJldHVybiB0cnVlO1xuICByZXR1cm4gZmFsc2U7XG59O1xuXG5jb25zdCB0eXBlVG9TdHJpbmcgPSAodHlwZTogU2NoZW1hRmllbGQgfCBzdHJpbmcpOiBzdHJpbmcgPT4ge1xuICBpZiAodHlwZW9mIHR5cGUgPT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIHR5cGU7XG4gIH1cbiAgaWYgKHR5cGUudGFyZ2V0Q2xhc3MpIHtcbiAgICByZXR1cm4gYCR7dHlwZS50eXBlfTwke3R5cGUudGFyZ2V0Q2xhc3N9PmA7XG4gIH1cbiAgcmV0dXJuIGAke3R5cGUudHlwZX1gO1xufTtcblxuLy8gU3RvcmVzIHRoZSBlbnRpcmUgc2NoZW1hIG9mIHRoZSBhcHAgaW4gYSB3ZWlyZCBoeWJyaWQgZm9ybWF0IHNvbWV3aGVyZSBiZXR3ZWVuXG4vLyB0aGUgbW9uZ28gZm9ybWF0IGFuZCB0aGUgUGFyc2UgZm9ybWF0LiBTb29uLCB0aGlzIHdpbGwgYWxsIGJlIFBhcnNlIGZvcm1hdC5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFNjaGVtYUNvbnRyb2xsZXIge1xuICBfZGJBZGFwdGVyOiBTdG9yYWdlQWRhcHRlcjtcbiAgc2NoZW1hRGF0YTogeyBbc3RyaW5nXTogU2NoZW1hIH07XG4gIF9jYWNoZTogYW55O1xuICByZWxvYWREYXRhUHJvbWlzZTogUHJvbWlzZTxhbnk+O1xuXG4gIGNvbnN0cnVjdG9yKGRhdGFiYXNlQWRhcHRlcjogU3RvcmFnZUFkYXB0ZXIsIHNjaGVtYUNhY2hlOiBhbnkpIHtcbiAgICB0aGlzLl9kYkFkYXB0ZXIgPSBkYXRhYmFzZUFkYXB0ZXI7XG4gICAgdGhpcy5fY2FjaGUgPSBzY2hlbWFDYWNoZTtcbiAgICB0aGlzLnNjaGVtYURhdGEgPSBuZXcgU2NoZW1hRGF0YSgpO1xuICB9XG5cbiAgcmVsb2FkRGF0YShvcHRpb25zOiBMb2FkU2NoZW1hT3B0aW9ucyA9IHsgY2xlYXJDYWNoZTogZmFsc2UgfSk6IFByb21pc2U8YW55PiB7XG4gICAgbGV0IHByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKTtcbiAgICBpZiAob3B0aW9ucy5jbGVhckNhY2hlKSB7XG4gICAgICBwcm9taXNlID0gcHJvbWlzZS50aGVuKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2NhY2hlLmNsZWFyKCk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgaWYgKHRoaXMucmVsb2FkRGF0YVByb21pc2UgJiYgIW9wdGlvbnMuY2xlYXJDYWNoZSkge1xuICAgICAgcmV0dXJuIHRoaXMucmVsb2FkRGF0YVByb21pc2U7XG4gICAgfVxuICAgIHRoaXMucmVsb2FkRGF0YVByb21pc2UgPSBwcm9taXNlXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldEFsbENsYXNzZXMob3B0aW9ucykudGhlbihcbiAgICAgICAgICBhbGxTY2hlbWFzID0+IHtcbiAgICAgICAgICAgIHRoaXMuc2NoZW1hRGF0YSA9IG5ldyBTY2hlbWFEYXRhKGFsbFNjaGVtYXMpO1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMucmVsb2FkRGF0YVByb21pc2U7XG4gICAgICAgICAgfSxcbiAgICAgICAgICBlcnIgPT4ge1xuICAgICAgICAgICAgdGhpcy5zY2hlbWFEYXRhID0gbmV3IFNjaGVtYURhdGEoKTtcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnJlbG9hZERhdGFQcm9taXNlO1xuICAgICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICAgIH1cbiAgICAgICAgKTtcbiAgICAgIH0pXG4gICAgICAudGhlbigoKSA9PiB7fSk7XG4gICAgcmV0dXJuIHRoaXMucmVsb2FkRGF0YVByb21pc2U7XG4gIH1cblxuICBnZXRBbGxDbGFzc2VzKFxuICAgIG9wdGlvbnM6IExvYWRTY2hlbWFPcHRpb25zID0geyBjbGVhckNhY2hlOiBmYWxzZSB9XG4gICk6IFByb21pc2U8QXJyYXk8U2NoZW1hPj4ge1xuICAgIGxldCBwcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgaWYgKG9wdGlvbnMuY2xlYXJDYWNoZSkge1xuICAgICAgcHJvbWlzZSA9IHRoaXMuX2NhY2hlLmNsZWFyKCk7XG4gICAgfVxuICAgIHJldHVybiBwcm9taXNlXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLl9jYWNoZS5nZXRBbGxDbGFzc2VzKCk7XG4gICAgICB9KVxuICAgICAgLnRoZW4oYWxsQ2xhc3NlcyA9PiB7XG4gICAgICAgIGlmIChhbGxDbGFzc2VzICYmIGFsbENsYXNzZXMubGVuZ3RoICYmICFvcHRpb25zLmNsZWFyQ2FjaGUpIHtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGFsbENsYXNzZXMpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9kYkFkYXB0ZXJcbiAgICAgICAgICAuZ2V0QWxsQ2xhc3NlcygpXG4gICAgICAgICAgLnRoZW4oYWxsU2NoZW1hcyA9PiBhbGxTY2hlbWFzLm1hcChpbmplY3REZWZhdWx0U2NoZW1hKSlcbiAgICAgICAgICAudGhlbihhbGxTY2hlbWFzID0+IHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9jYWNoZS5zZXRBbGxDbGFzc2VzKGFsbFNjaGVtYXMpLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgICByZXR1cm4gYWxsU2NoZW1hcztcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cblxuICBnZXRPbmVTY2hlbWEoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgYWxsb3dWb2xhdGlsZUNsYXNzZXM6IGJvb2xlYW4gPSBmYWxzZSxcbiAgICBvcHRpb25zOiBMb2FkU2NoZW1hT3B0aW9ucyA9IHsgY2xlYXJDYWNoZTogZmFsc2UgfVxuICApOiBQcm9taXNlPFNjaGVtYT4ge1xuICAgIGxldCBwcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgaWYgKG9wdGlvbnMuY2xlYXJDYWNoZSkge1xuICAgICAgcHJvbWlzZSA9IHRoaXMuX2NhY2hlLmNsZWFyKCk7XG4gICAgfVxuICAgIHJldHVybiBwcm9taXNlLnRoZW4oKCkgPT4ge1xuICAgICAgaWYgKGFsbG93Vm9sYXRpbGVDbGFzc2VzICYmIHZvbGF0aWxlQ2xhc3Nlcy5pbmRleE9mKGNsYXNzTmFtZSkgPiAtMSkge1xuICAgICAgICBjb25zdCBkYXRhID0gdGhpcy5zY2hlbWFEYXRhW2NsYXNzTmFtZV07XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe1xuICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICBmaWVsZHM6IGRhdGEuZmllbGRzLFxuICAgICAgICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczogZGF0YS5jbGFzc0xldmVsUGVybWlzc2lvbnMsXG4gICAgICAgICAgaW5kZXhlczogZGF0YS5pbmRleGVzLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0aGlzLl9jYWNoZS5nZXRPbmVTY2hlbWEoY2xhc3NOYW1lKS50aGVuKGNhY2hlZCA9PiB7XG4gICAgICAgIGlmIChjYWNoZWQgJiYgIW9wdGlvbnMuY2xlYXJDYWNoZSkge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoY2FjaGVkKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5fZGJBZGFwdGVyXG4gICAgICAgICAgLmdldENsYXNzKGNsYXNzTmFtZSlcbiAgICAgICAgICAudGhlbihpbmplY3REZWZhdWx0U2NoZW1hKVxuICAgICAgICAgIC50aGVuKHJlc3VsdCA9PiB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fY2FjaGUuc2V0T25lU2NoZW1hKGNsYXNzTmFtZSwgcmVzdWx0KS50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBDcmVhdGUgYSBuZXcgY2xhc3MgdGhhdCBpbmNsdWRlcyB0aGUgdGhyZWUgZGVmYXVsdCBmaWVsZHMuXG4gIC8vIEFDTCBpcyBhbiBpbXBsaWNpdCBjb2x1bW4gdGhhdCBkb2VzIG5vdCBnZXQgYW4gZW50cnkgaW4gdGhlXG4gIC8vIF9TQ0hFTUFTIGRhdGFiYXNlLiBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdpdGggdGhlXG4gIC8vIGNyZWF0ZWQgc2NoZW1hLCBpbiBtb25nbyBmb3JtYXQuXG4gIC8vIG9uIHN1Y2Nlc3MsIGFuZCByZWplY3RzIHdpdGggYW4gZXJyb3Igb24gZmFpbC4gRW5zdXJlIHlvdVxuICAvLyBoYXZlIGF1dGhvcml6YXRpb24gKG1hc3RlciBrZXksIG9yIGNsaWVudCBjbGFzcyBjcmVhdGlvblxuICAvLyBlbmFibGVkKSBiZWZvcmUgY2FsbGluZyB0aGlzIGZ1bmN0aW9uLlxuICBhZGRDbGFzc0lmTm90RXhpc3RzKFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIGZpZWxkczogU2NoZW1hRmllbGRzID0ge30sXG4gICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiBhbnksXG4gICAgaW5kZXhlczogYW55ID0ge31cbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdmFyIHZhbGlkYXRpb25FcnJvciA9IHRoaXMudmFsaWRhdGVOZXdDbGFzcyhcbiAgICAgIGNsYXNzTmFtZSxcbiAgICAgIGZpZWxkcyxcbiAgICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uc1xuICAgICk7XG4gICAgaWYgKHZhbGlkYXRpb25FcnJvcikge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KHZhbGlkYXRpb25FcnJvcik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2RiQWRhcHRlclxuICAgICAgLmNyZWF0ZUNsYXNzKFxuICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgIGNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEoe1xuICAgICAgICAgIGZpZWxkcyxcbiAgICAgICAgICBjbGFzc0xldmVsUGVybWlzc2lvbnMsXG4gICAgICAgICAgaW5kZXhlcyxcbiAgICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgIH0pXG4gICAgICApXG4gICAgICAudGhlbihjb252ZXJ0QWRhcHRlclNjaGVtYVRvUGFyc2VTY2hlbWEpXG4gICAgICAudGhlbihyZXMgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5fY2FjaGUuY2xlYXIoKS50aGVuKCgpID0+IHtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHJlcyk7XG4gICAgICAgIH0pO1xuICAgICAgfSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChlcnJvciAmJiBlcnJvci5jb2RlID09PSBQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUUpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0NMQVNTX05BTUUsXG4gICAgICAgICAgICBgQ2xhc3MgJHtjbGFzc05hbWV9IGFscmVhZHkgZXhpc3RzLmBcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgfVxuXG4gIHVwZGF0ZUNsYXNzKFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIHN1Ym1pdHRlZEZpZWxkczogU2NoZW1hRmllbGRzLFxuICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczogYW55LFxuICAgIGluZGV4ZXM6IGFueSxcbiAgICBkYXRhYmFzZTogRGF0YWJhc2VDb250cm9sbGVyXG4gICkge1xuICAgIHJldHVybiB0aGlzLmdldE9uZVNjaGVtYShjbGFzc05hbWUpXG4gICAgICAudGhlbihzY2hlbWEgPT4ge1xuICAgICAgICBjb25zdCBleGlzdGluZ0ZpZWxkcyA9IHNjaGVtYS5maWVsZHM7XG4gICAgICAgIE9iamVjdC5rZXlzKHN1Ym1pdHRlZEZpZWxkcykuZm9yRWFjaChuYW1lID0+IHtcbiAgICAgICAgICBjb25zdCBmaWVsZCA9IHN1Ym1pdHRlZEZpZWxkc1tuYW1lXTtcbiAgICAgICAgICBpZiAoZXhpc3RpbmdGaWVsZHNbbmFtZV0gJiYgZmllbGQuX19vcCAhPT0gJ0RlbGV0ZScpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcigyNTUsIGBGaWVsZCAke25hbWV9IGV4aXN0cywgY2Fubm90IHVwZGF0ZS5gKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKCFleGlzdGluZ0ZpZWxkc1tuYW1lXSAmJiBmaWVsZC5fX29wID09PSAnRGVsZXRlJykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICAyNTUsXG4gICAgICAgICAgICAgIGBGaWVsZCAke25hbWV9IGRvZXMgbm90IGV4aXN0LCBjYW5ub3QgZGVsZXRlLmBcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBkZWxldGUgZXhpc3RpbmdGaWVsZHMuX3JwZXJtO1xuICAgICAgICBkZWxldGUgZXhpc3RpbmdGaWVsZHMuX3dwZXJtO1xuICAgICAgICBjb25zdCBuZXdTY2hlbWEgPSBidWlsZE1lcmdlZFNjaGVtYU9iamVjdChcbiAgICAgICAgICBleGlzdGluZ0ZpZWxkcyxcbiAgICAgICAgICBzdWJtaXR0ZWRGaWVsZHNcbiAgICAgICAgKTtcbiAgICAgICAgY29uc3QgZGVmYXVsdEZpZWxkcyA9XG4gICAgICAgICAgZGVmYXVsdENvbHVtbnNbY2xhc3NOYW1lXSB8fCBkZWZhdWx0Q29sdW1ucy5fRGVmYXVsdDtcbiAgICAgICAgY29uc3QgZnVsbE5ld1NjaGVtYSA9IE9iamVjdC5hc3NpZ24oe30sIG5ld1NjaGVtYSwgZGVmYXVsdEZpZWxkcyk7XG4gICAgICAgIGNvbnN0IHZhbGlkYXRpb25FcnJvciA9IHRoaXMudmFsaWRhdGVTY2hlbWFEYXRhKFxuICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICBuZXdTY2hlbWEsXG4gICAgICAgICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zLFxuICAgICAgICAgIE9iamVjdC5rZXlzKGV4aXN0aW5nRmllbGRzKVxuICAgICAgICApO1xuICAgICAgICBpZiAodmFsaWRhdGlvbkVycm9yKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKHZhbGlkYXRpb25FcnJvci5jb2RlLCB2YWxpZGF0aW9uRXJyb3IuZXJyb3IpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRmluYWxseSB3ZSBoYXZlIGNoZWNrZWQgdG8gbWFrZSBzdXJlIHRoZSByZXF1ZXN0IGlzIHZhbGlkIGFuZCB3ZSBjYW4gc3RhcnQgZGVsZXRpbmcgZmllbGRzLlxuICAgICAgICAvLyBEbyBhbGwgZGVsZXRpb25zIGZpcnN0LCB0aGVuIGEgc2luZ2xlIHNhdmUgdG8gX1NDSEVNQSBjb2xsZWN0aW9uIHRvIGhhbmRsZSBhbGwgYWRkaXRpb25zLlxuICAgICAgICBjb25zdCBkZWxldGVkRmllbGRzOiBzdHJpbmdbXSA9IFtdO1xuICAgICAgICBjb25zdCBpbnNlcnRlZEZpZWxkcyA9IFtdO1xuICAgICAgICBPYmplY3Qua2V5cyhzdWJtaXR0ZWRGaWVsZHMpLmZvckVhY2goZmllbGROYW1lID0+IHtcbiAgICAgICAgICBpZiAoc3VibWl0dGVkRmllbGRzW2ZpZWxkTmFtZV0uX19vcCA9PT0gJ0RlbGV0ZScpIHtcbiAgICAgICAgICAgIGRlbGV0ZWRGaWVsZHMucHVzaChmaWVsZE5hbWUpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpbnNlcnRlZEZpZWxkcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBsZXQgZGVsZXRlUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICBpZiAoZGVsZXRlZEZpZWxkcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgZGVsZXRlUHJvbWlzZSA9IHRoaXMuZGVsZXRlRmllbGRzKGRlbGV0ZWRGaWVsZHMsIGNsYXNzTmFtZSwgZGF0YWJhc2UpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgZGVsZXRlUHJvbWlzZSAvLyBEZWxldGUgRXZlcnl0aGluZ1xuICAgICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5yZWxvYWREYXRhKHsgY2xlYXJDYWNoZTogdHJ1ZSB9KSkgLy8gUmVsb2FkIG91ciBTY2hlbWEsIHNvIHdlIGhhdmUgYWxsIHRoZSBuZXcgdmFsdWVzXG4gICAgICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHByb21pc2VzID0gaW5zZXJ0ZWRGaWVsZHMubWFwKGZpZWxkTmFtZSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgdHlwZSA9IHN1Ym1pdHRlZEZpZWxkc1tmaWVsZE5hbWVdO1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmVuZm9yY2VGaWVsZEV4aXN0cyhjbGFzc05hbWUsIGZpZWxkTmFtZSwgdHlwZSk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC50aGVuKCgpID0+XG4gICAgICAgICAgICAgIHRoaXMuc2V0UGVybWlzc2lvbnMoY2xhc3NOYW1lLCBjbGFzc0xldmVsUGVybWlzc2lvbnMsIG5ld1NjaGVtYSlcbiAgICAgICAgICAgIClcbiAgICAgICAgICAgIC50aGVuKCgpID0+XG4gICAgICAgICAgICAgIHRoaXMuX2RiQWRhcHRlci5zZXRJbmRleGVzV2l0aFNjaGVtYUZvcm1hdChcbiAgICAgICAgICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgICAgICAgICAgaW5kZXhlcyxcbiAgICAgICAgICAgICAgICBzY2hlbWEuaW5kZXhlcyxcbiAgICAgICAgICAgICAgICBmdWxsTmV3U2NoZW1hXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgIClcbiAgICAgICAgICAgIC50aGVuKCgpID0+IHRoaXMucmVsb2FkRGF0YSh7IGNsZWFyQ2FjaGU6IHRydWUgfSkpXG4gICAgICAgICAgICAvL1RPRE86IE1vdmUgdGhpcyBsb2dpYyBpbnRvIHRoZSBkYXRhYmFzZSBhZGFwdGVyXG4gICAgICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMuc2NoZW1hRGF0YVtjbGFzc05hbWVdO1xuICAgICAgICAgICAgICBjb25zdCByZWxvYWRlZFNjaGVtYTogU2NoZW1hID0ge1xuICAgICAgICAgICAgICAgIGNsYXNzTmFtZTogY2xhc3NOYW1lLFxuICAgICAgICAgICAgICAgIGZpZWxkczogc2NoZW1hLmZpZWxkcyxcbiAgICAgICAgICAgICAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IHNjaGVtYS5jbGFzc0xldmVsUGVybWlzc2lvbnMsXG4gICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgIGlmIChzY2hlbWEuaW5kZXhlcyAmJiBPYmplY3Qua2V5cyhzY2hlbWEuaW5kZXhlcykubGVuZ3RoICE9PSAwKSB7XG4gICAgICAgICAgICAgICAgcmVsb2FkZWRTY2hlbWEuaW5kZXhlcyA9IHNjaGVtYS5pbmRleGVzO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHJldHVybiByZWxvYWRlZFNjaGVtYTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICk7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKGVycm9yID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0NMQVNTX05BTUUsXG4gICAgICAgICAgICBgQ2xhc3MgJHtjbGFzc05hbWV9IGRvZXMgbm90IGV4aXN0LmBcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgfVxuXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgc3VjY2Vzc2Z1bGx5IHRvIHRoZSBuZXcgc2NoZW1hXG4gIC8vIG9iamVjdCBvciBmYWlscyB3aXRoIGEgcmVhc29uLlxuICBlbmZvcmNlQ2xhc3NFeGlzdHMoY2xhc3NOYW1lOiBzdHJpbmcpOiBQcm9taXNlPFNjaGVtYUNvbnRyb2xsZXI+IHtcbiAgICBpZiAodGhpcy5zY2hlbWFEYXRhW2NsYXNzTmFtZV0pIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcyk7XG4gICAgfVxuICAgIC8vIFdlIGRvbid0IGhhdmUgdGhpcyBjbGFzcy4gVXBkYXRlIHRoZSBzY2hlbWFcbiAgICByZXR1cm4gKFxuICAgICAgdGhpcy5hZGRDbGFzc0lmTm90RXhpc3RzKGNsYXNzTmFtZSlcbiAgICAgICAgLy8gVGhlIHNjaGVtYSB1cGRhdGUgc3VjY2VlZGVkLiBSZWxvYWQgdGhlIHNjaGVtYVxuICAgICAgICAudGhlbigoKSA9PiB0aGlzLnJlbG9hZERhdGEoeyBjbGVhckNhY2hlOiB0cnVlIH0pKVxuICAgICAgICAuY2F0Y2goKCkgPT4ge1xuICAgICAgICAgIC8vIFRoZSBzY2hlbWEgdXBkYXRlIGZhaWxlZC4gVGhpcyBjYW4gYmUgb2theSAtIGl0IG1pZ2h0XG4gICAgICAgICAgLy8gaGF2ZSBmYWlsZWQgYmVjYXVzZSB0aGVyZSdzIGEgcmFjZSBjb25kaXRpb24gYW5kIGEgZGlmZmVyZW50XG4gICAgICAgICAgLy8gY2xpZW50IGlzIG1ha2luZyB0aGUgZXhhY3Qgc2FtZSBzY2hlbWEgdXBkYXRlIHRoYXQgd2Ugd2FudC5cbiAgICAgICAgICAvLyBTbyBqdXN0IHJlbG9hZCB0aGUgc2NoZW1hLlxuICAgICAgICAgIHJldHVybiB0aGlzLnJlbG9hZERhdGEoeyBjbGVhckNhY2hlOiB0cnVlIH0pO1xuICAgICAgICB9KVxuICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgLy8gRW5zdXJlIHRoYXQgdGhlIHNjaGVtYSBub3cgdmFsaWRhdGVzXG4gICAgICAgICAgaWYgKHRoaXMuc2NoZW1hRGF0YVtjbGFzc05hbWVdKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgICAgIGBGYWlsZWQgdG8gYWRkICR7Y2xhc3NOYW1lfWBcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgICAuY2F0Y2goKCkgPT4ge1xuICAgICAgICAgIC8vIFRoZSBzY2hlbWEgc3RpbGwgZG9lc24ndCB2YWxpZGF0ZS4gR2l2ZSB1cFxuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICdzY2hlbWEgY2xhc3MgbmFtZSBkb2VzIG5vdCByZXZhbGlkYXRlJ1xuICAgICAgICAgICk7XG4gICAgICAgIH0pXG4gICAgKTtcbiAgfVxuXG4gIHZhbGlkYXRlTmV3Q2xhc3MoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgZmllbGRzOiBTY2hlbWFGaWVsZHMgPSB7fSxcbiAgICBjbGFzc0xldmVsUGVybWlzc2lvbnM6IGFueVxuICApOiBhbnkge1xuICAgIGlmICh0aGlzLnNjaGVtYURhdGFbY2xhc3NOYW1lXSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0NMQVNTX05BTUUsXG4gICAgICAgIGBDbGFzcyAke2NsYXNzTmFtZX0gYWxyZWFkeSBleGlzdHMuYFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKCFjbGFzc05hbWVJc1ZhbGlkKGNsYXNzTmFtZSkpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvZGU6IFBhcnNlLkVycm9yLklOVkFMSURfQ0xBU1NfTkFNRSxcbiAgICAgICAgZXJyb3I6IGludmFsaWRDbGFzc05hbWVNZXNzYWdlKGNsYXNzTmFtZSksXG4gICAgICB9O1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy52YWxpZGF0ZVNjaGVtYURhdGEoXG4gICAgICBjbGFzc05hbWUsXG4gICAgICBmaWVsZHMsXG4gICAgICBjbGFzc0xldmVsUGVybWlzc2lvbnMsXG4gICAgICBbXVxuICAgICk7XG4gIH1cblxuICB2YWxpZGF0ZVNjaGVtYURhdGEoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgZmllbGRzOiBTY2hlbWFGaWVsZHMsXG4gICAgY2xhc3NMZXZlbFBlcm1pc3Npb25zOiBDbGFzc0xldmVsUGVybWlzc2lvbnMsXG4gICAgZXhpc3RpbmdGaWVsZE5hbWVzOiBBcnJheTxzdHJpbmc+XG4gICkge1xuICAgIGZvciAoY29uc3QgZmllbGROYW1lIGluIGZpZWxkcykge1xuICAgICAgaWYgKGV4aXN0aW5nRmllbGROYW1lcy5pbmRleE9mKGZpZWxkTmFtZSkgPCAwKSB7XG4gICAgICAgIGlmICghZmllbGROYW1lSXNWYWxpZChmaWVsZE5hbWUpKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGNvZGU6IFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUsXG4gICAgICAgICAgICBlcnJvcjogJ2ludmFsaWQgZmllbGQgbmFtZTogJyArIGZpZWxkTmFtZSxcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIGlmICghZmllbGROYW1lSXNWYWxpZEZvckNsYXNzKGZpZWxkTmFtZSwgY2xhc3NOYW1lKSkge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBjb2RlOiAxMzYsXG4gICAgICAgICAgICBlcnJvcjogJ2ZpZWxkICcgKyBmaWVsZE5hbWUgKyAnIGNhbm5vdCBiZSBhZGRlZCcsXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBlcnJvciA9IGZpZWxkVHlwZUlzSW52YWxpZChmaWVsZHNbZmllbGROYW1lXSk7XG4gICAgICAgIGlmIChlcnJvcikgcmV0dXJuIHsgY29kZTogZXJyb3IuY29kZSwgZXJyb3I6IGVycm9yLm1lc3NhZ2UgfTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGZpZWxkTmFtZSBpbiBkZWZhdWx0Q29sdW1uc1tjbGFzc05hbWVdKSB7XG4gICAgICBmaWVsZHNbZmllbGROYW1lXSA9IGRlZmF1bHRDb2x1bW5zW2NsYXNzTmFtZV1bZmllbGROYW1lXTtcbiAgICB9XG5cbiAgICBjb25zdCBnZW9Qb2ludHMgPSBPYmplY3Qua2V5cyhmaWVsZHMpLmZpbHRlcihcbiAgICAgIGtleSA9PiBmaWVsZHNba2V5XSAmJiBmaWVsZHNba2V5XS50eXBlID09PSAnR2VvUG9pbnQnXG4gICAgKTtcbiAgICBpZiAoZ2VvUG9pbnRzLmxlbmd0aCA+IDEpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvZGU6IFBhcnNlLkVycm9yLklOQ09SUkVDVF9UWVBFLFxuICAgICAgICBlcnJvcjpcbiAgICAgICAgICAnY3VycmVudGx5LCBvbmx5IG9uZSBHZW9Qb2ludCBmaWVsZCBtYXkgZXhpc3QgaW4gYW4gb2JqZWN0LiBBZGRpbmcgJyArXG4gICAgICAgICAgZ2VvUG9pbnRzWzFdICtcbiAgICAgICAgICAnIHdoZW4gJyArXG4gICAgICAgICAgZ2VvUG9pbnRzWzBdICtcbiAgICAgICAgICAnIGFscmVhZHkgZXhpc3RzLicsXG4gICAgICB9O1xuICAgIH1cbiAgICB2YWxpZGF0ZUNMUChjbGFzc0xldmVsUGVybWlzc2lvbnMsIGZpZWxkcyk7XG4gIH1cblxuICAvLyBTZXRzIHRoZSBDbGFzcy1sZXZlbCBwZXJtaXNzaW9ucyBmb3IgYSBnaXZlbiBjbGFzc05hbWUsIHdoaWNoIG11c3QgZXhpc3QuXG4gIHNldFBlcm1pc3Npb25zKGNsYXNzTmFtZTogc3RyaW5nLCBwZXJtczogYW55LCBuZXdTY2hlbWE6IFNjaGVtYUZpZWxkcykge1xuICAgIGlmICh0eXBlb2YgcGVybXMgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuICAgIHZhbGlkYXRlQ0xQKHBlcm1zLCBuZXdTY2hlbWEpO1xuICAgIHJldHVybiB0aGlzLl9kYkFkYXB0ZXIuc2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zKGNsYXNzTmFtZSwgcGVybXMpO1xuICB9XG5cbiAgLy8gUmV0dXJucyBhIHByb21pc2UgdGhhdCByZXNvbHZlcyBzdWNjZXNzZnVsbHkgdG8gdGhlIG5ldyBzY2hlbWFcbiAgLy8gb2JqZWN0IGlmIHRoZSBwcm92aWRlZCBjbGFzc05hbWUtZmllbGROYW1lLXR5cGUgdHVwbGUgaXMgdmFsaWQuXG4gIC8vIFRoZSBjbGFzc05hbWUgbXVzdCBhbHJlYWR5IGJlIHZhbGlkYXRlZC5cbiAgLy8gSWYgJ2ZyZWV6ZScgaXMgdHJ1ZSwgcmVmdXNlIHRvIHVwZGF0ZSB0aGUgc2NoZW1hIGZvciB0aGlzIGZpZWxkLlxuICBlbmZvcmNlRmllbGRFeGlzdHMoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgZmllbGROYW1lOiBzdHJpbmcsXG4gICAgdHlwZTogc3RyaW5nIHwgU2NoZW1hRmllbGRcbiAgKSB7XG4gICAgaWYgKGZpZWxkTmFtZS5pbmRleE9mKCcuJykgPiAwKSB7XG4gICAgICAvLyBzdWJkb2N1bWVudCBrZXkgKHgueSkgPT4gb2sgaWYgeCBpcyBvZiB0eXBlICdvYmplY3QnXG4gICAgICBmaWVsZE5hbWUgPSBmaWVsZE5hbWUuc3BsaXQoJy4nKVswXTtcbiAgICAgIHR5cGUgPSAnT2JqZWN0JztcbiAgICB9XG4gICAgaWYgKCFmaWVsZE5hbWVJc1ZhbGlkKGZpZWxkTmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSxcbiAgICAgICAgYEludmFsaWQgZmllbGQgbmFtZTogJHtmaWVsZE5hbWV9LmBcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gSWYgc29tZW9uZSB0cmllcyB0byBjcmVhdGUgYSBuZXcgZmllbGQgd2l0aCBudWxsL3VuZGVmaW5lZCBhcyB0aGUgdmFsdWUsIHJldHVybjtcbiAgICBpZiAoIXR5cGUpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMucmVsb2FkRGF0YSgpLnRoZW4oKCkgPT4ge1xuICAgICAgY29uc3QgZXhwZWN0ZWRUeXBlID0gdGhpcy5nZXRFeHBlY3RlZFR5cGUoY2xhc3NOYW1lLCBmaWVsZE5hbWUpO1xuICAgICAgaWYgKHR5cGVvZiB0eXBlID09PSAnc3RyaW5nJykge1xuICAgICAgICB0eXBlID0geyB0eXBlIH07XG4gICAgICB9XG5cbiAgICAgIGlmIChleHBlY3RlZFR5cGUpIHtcbiAgICAgICAgaWYgKCFkYlR5cGVNYXRjaGVzT2JqZWN0VHlwZShleHBlY3RlZFR5cGUsIHR5cGUpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5DT1JSRUNUX1RZUEUsXG4gICAgICAgICAgICBgc2NoZW1hIG1pc21hdGNoIGZvciAke2NsYXNzTmFtZX0uJHtmaWVsZE5hbWV9OyBleHBlY3RlZCAke3R5cGVUb1N0cmluZyhcbiAgICAgICAgICAgICAgZXhwZWN0ZWRUeXBlXG4gICAgICAgICAgICApfSBidXQgZ290ICR7dHlwZVRvU3RyaW5nKHR5cGUpfWBcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGhpcy5fZGJBZGFwdGVyXG4gICAgICAgIC5hZGRGaWVsZElmTm90RXhpc3RzKGNsYXNzTmFtZSwgZmllbGROYW1lLCB0eXBlKVxuICAgICAgICAudGhlbihcbiAgICAgICAgICAoKSA9PiB7XG4gICAgICAgICAgICAvLyBUaGUgdXBkYXRlIHN1Y2NlZWRlZC4gUmVsb2FkIHRoZSBzY2hlbWFcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJlbG9hZERhdGEoeyBjbGVhckNhY2hlOiB0cnVlIH0pO1xuICAgICAgICAgIH0sXG4gICAgICAgICAgZXJyb3IgPT4ge1xuICAgICAgICAgICAgaWYgKGVycm9yLmNvZGUgPT0gUGFyc2UuRXJyb3IuSU5DT1JSRUNUX1RZUEUpIHtcbiAgICAgICAgICAgICAgLy8gTWFrZSBzdXJlIHRoYXQgd2UgdGhyb3cgZXJyb3JzIHdoZW4gaXQgaXMgYXBwcm9wcmlhdGUgdG8gZG8gc28uXG4gICAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gVGhlIHVwZGF0ZSBmYWlsZWQuIFRoaXMgY2FuIGJlIG9rYXkgLSBpdCBtaWdodCBoYXZlIGJlZW4gYSByYWNlXG4gICAgICAgICAgICAvLyBjb25kaXRpb24gd2hlcmUgYW5vdGhlciBjbGllbnQgdXBkYXRlZCB0aGUgc2NoZW1hIGluIHRoZSBzYW1lXG4gICAgICAgICAgICAvLyB3YXkgdGhhdCB3ZSB3YW50ZWQgdG8uIFNvLCBqdXN0IHJlbG9hZCB0aGUgc2NoZW1hXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5yZWxvYWREYXRhKHsgY2xlYXJDYWNoZTogdHJ1ZSB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIClcbiAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgIC8vIEVuc3VyZSB0aGF0IHRoZSBzY2hlbWEgbm93IHZhbGlkYXRlc1xuICAgICAgICAgIGNvbnN0IGV4cGVjdGVkVHlwZSA9IHRoaXMuZ2V0RXhwZWN0ZWRUeXBlKGNsYXNzTmFtZSwgZmllbGROYW1lKTtcbiAgICAgICAgICBpZiAodHlwZW9mIHR5cGUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICB0eXBlID0geyB0eXBlIH07XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICghZXhwZWN0ZWRUeXBlIHx8ICFkYlR5cGVNYXRjaGVzT2JqZWN0VHlwZShleHBlY3RlZFR5cGUsIHR5cGUpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICAgYENvdWxkIG5vdCBhZGQgZmllbGQgJHtmaWVsZE5hbWV9YFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gUmVtb3ZlIHRoZSBjYWNoZWQgc2NoZW1hXG4gICAgICAgICAgdGhpcy5fY2FjaGUuY2xlYXIoKTtcbiAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBtYWludGFpbiBjb21wYXRpYmlsaXR5XG4gIGRlbGV0ZUZpZWxkKFxuICAgIGZpZWxkTmFtZTogc3RyaW5nLFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIGRhdGFiYXNlOiBEYXRhYmFzZUNvbnRyb2xsZXJcbiAgKSB7XG4gICAgcmV0dXJuIHRoaXMuZGVsZXRlRmllbGRzKFtmaWVsZE5hbWVdLCBjbGFzc05hbWUsIGRhdGFiYXNlKTtcbiAgfVxuXG4gIC8vIERlbGV0ZSBmaWVsZHMsIGFuZCByZW1vdmUgdGhhdCBkYXRhIGZyb20gYWxsIG9iamVjdHMuIFRoaXMgaXMgaW50ZW5kZWRcbiAgLy8gdG8gcmVtb3ZlIHVudXNlZCBmaWVsZHMsIGlmIG90aGVyIHdyaXRlcnMgYXJlIHdyaXRpbmcgb2JqZWN0cyB0aGF0IGluY2x1ZGVcbiAgLy8gdGhpcyBmaWVsZCwgdGhlIGZpZWxkIG1heSByZWFwcGVhci4gUmV0dXJucyBhIFByb21pc2UgdGhhdCByZXNvbHZlcyB3aXRoXG4gIC8vIG5vIG9iamVjdCBvbiBzdWNjZXNzLCBvciByZWplY3RzIHdpdGggeyBjb2RlLCBlcnJvciB9IG9uIGZhaWx1cmUuXG4gIC8vIFBhc3NpbmcgdGhlIGRhdGFiYXNlIGFuZCBwcmVmaXggaXMgbmVjZXNzYXJ5IGluIG9yZGVyIHRvIGRyb3AgcmVsYXRpb24gY29sbGVjdGlvbnNcbiAgLy8gYW5kIHJlbW92ZSBmaWVsZHMgZnJvbSBvYmplY3RzLiBJZGVhbGx5IHRoZSBkYXRhYmFzZSB3b3VsZCBiZWxvbmcgdG9cbiAgLy8gYSBkYXRhYmFzZSBhZGFwdGVyIGFuZCB0aGlzIGZ1bmN0aW9uIHdvdWxkIGNsb3NlIG92ZXIgaXQgb3IgYWNjZXNzIGl0IHZpYSBtZW1iZXIuXG4gIGRlbGV0ZUZpZWxkcyhcbiAgICBmaWVsZE5hbWVzOiBBcnJheTxzdHJpbmc+LFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIGRhdGFiYXNlOiBEYXRhYmFzZUNvbnRyb2xsZXJcbiAgKSB7XG4gICAgaWYgKCFjbGFzc05hbWVJc1ZhbGlkKGNsYXNzTmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9DTEFTU19OQU1FLFxuICAgICAgICBpbnZhbGlkQ2xhc3NOYW1lTWVzc2FnZShjbGFzc05hbWUpXG4gICAgICApO1xuICAgIH1cblxuICAgIGZpZWxkTmFtZXMuZm9yRWFjaChmaWVsZE5hbWUgPT4ge1xuICAgICAgaWYgKCFmaWVsZE5hbWVJc1ZhbGlkKGZpZWxkTmFtZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUsXG4gICAgICAgICAgYGludmFsaWQgZmllbGQgbmFtZTogJHtmaWVsZE5hbWV9YFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgLy9Eb24ndCBhbGxvdyBkZWxldGluZyB0aGUgZGVmYXVsdCBmaWVsZHMuXG4gICAgICBpZiAoIWZpZWxkTmFtZUlzVmFsaWRGb3JDbGFzcyhmaWVsZE5hbWUsIGNsYXNzTmFtZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDEzNiwgYGZpZWxkICR7ZmllbGROYW1lfSBjYW5ub3QgYmUgY2hhbmdlZGApO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHRoaXMuZ2V0T25lU2NoZW1hKGNsYXNzTmFtZSwgZmFsc2UsIHsgY2xlYXJDYWNoZTogdHJ1ZSB9KVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKGVycm9yID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0NMQVNTX05BTUUsXG4gICAgICAgICAgICBgQ2xhc3MgJHtjbGFzc05hbWV9IGRvZXMgbm90IGV4aXN0LmBcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgLnRoZW4oc2NoZW1hID0+IHtcbiAgICAgICAgZmllbGROYW1lcy5mb3JFYWNoKGZpZWxkTmFtZSA9PiB7XG4gICAgICAgICAgaWYgKCFzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0pIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgMjU1LFxuICAgICAgICAgICAgICBgRmllbGQgJHtmaWVsZE5hbWV9IGRvZXMgbm90IGV4aXN0LCBjYW5ub3QgZGVsZXRlLmBcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBzY2hlbWFGaWVsZHMgPSB7IC4uLnNjaGVtYS5maWVsZHMgfTtcbiAgICAgICAgcmV0dXJuIGRhdGFiYXNlLmFkYXB0ZXJcbiAgICAgICAgICAuZGVsZXRlRmllbGRzKGNsYXNzTmFtZSwgc2NoZW1hLCBmaWVsZE5hbWVzKVxuICAgICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLmFsbChcbiAgICAgICAgICAgICAgZmllbGROYW1lcy5tYXAoZmllbGROYW1lID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBmaWVsZCA9IHNjaGVtYUZpZWxkc1tmaWVsZE5hbWVdO1xuICAgICAgICAgICAgICAgIGlmIChmaWVsZCAmJiBmaWVsZC50eXBlID09PSAnUmVsYXRpb24nKSB7XG4gICAgICAgICAgICAgICAgICAvL0ZvciByZWxhdGlvbnMsIGRyb3AgdGhlIF9Kb2luIHRhYmxlXG4gICAgICAgICAgICAgICAgICByZXR1cm4gZGF0YWJhc2UuYWRhcHRlci5kZWxldGVDbGFzcyhcbiAgICAgICAgICAgICAgICAgICAgYF9Kb2luOiR7ZmllbGROYW1lfToke2NsYXNzTmFtZX1gXG4gICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH0pO1xuICAgICAgfSlcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgdGhpcy5fY2FjaGUuY2xlYXIoKTtcbiAgICAgIH0pO1xuICB9XG5cbiAgLy8gVmFsaWRhdGVzIGFuIG9iamVjdCBwcm92aWRlZCBpbiBSRVNUIGZvcm1hdC5cbiAgLy8gUmV0dXJucyBhIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byB0aGUgbmV3IHNjaGVtYSBpZiB0aGlzIG9iamVjdCBpc1xuICAvLyB2YWxpZC5cbiAgdmFsaWRhdGVPYmplY3QoY2xhc3NOYW1lOiBzdHJpbmcsIG9iamVjdDogYW55LCBxdWVyeTogYW55KSB7XG4gICAgbGV0IGdlb2NvdW50ID0gMDtcbiAgICBsZXQgcHJvbWlzZSA9IHRoaXMuZW5mb3JjZUNsYXNzRXhpc3RzKGNsYXNzTmFtZSk7XG4gICAgZm9yIChjb25zdCBmaWVsZE5hbWUgaW4gb2JqZWN0KSB7XG4gICAgICBpZiAob2JqZWN0W2ZpZWxkTmFtZV0gPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGV4cGVjdGVkID0gZ2V0VHlwZShvYmplY3RbZmllbGROYW1lXSk7XG4gICAgICBpZiAoZXhwZWN0ZWQgPT09ICdHZW9Qb2ludCcpIHtcbiAgICAgICAgZ2VvY291bnQrKztcbiAgICAgIH1cbiAgICAgIGlmIChnZW9jb3VudCA+IDEpIHtcbiAgICAgICAgLy8gTWFrZSBzdXJlIGFsbCBmaWVsZCB2YWxpZGF0aW9uIG9wZXJhdGlvbnMgcnVuIGJlZm9yZSB3ZSByZXR1cm4uXG4gICAgICAgIC8vIElmIG5vdCAtIHdlIGFyZSBjb250aW51aW5nIHRvIHJ1biBsb2dpYywgYnV0IGFscmVhZHkgcHJvdmlkZWQgcmVzcG9uc2UgZnJvbSB0aGUgc2VydmVyLlxuICAgICAgICByZXR1cm4gcHJvbWlzZS50aGVuKCgpID0+IHtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QoXG4gICAgICAgICAgICBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOQ09SUkVDVF9UWVBFLFxuICAgICAgICAgICAgICAndGhlcmUgY2FuIG9ubHkgYmUgb25lIGdlb3BvaW50IGZpZWxkIGluIGEgY2xhc3MnXG4gICAgICAgICAgICApXG4gICAgICAgICAgKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICBpZiAoIWV4cGVjdGVkKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGZpZWxkTmFtZSA9PT0gJ0FDTCcpIHtcbiAgICAgICAgLy8gRXZlcnkgb2JqZWN0IGhhcyBBQ0wgaW1wbGljaXRseS5cbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIHByb21pc2UgPSBwcm9taXNlLnRoZW4oc2NoZW1hID0+XG4gICAgICAgIHNjaGVtYS5lbmZvcmNlRmllbGRFeGlzdHMoY2xhc3NOYW1lLCBmaWVsZE5hbWUsIGV4cGVjdGVkKVxuICAgICAgKTtcbiAgICB9XG4gICAgcHJvbWlzZSA9IHRoZW5WYWxpZGF0ZVJlcXVpcmVkQ29sdW1ucyhwcm9taXNlLCBjbGFzc05hbWUsIG9iamVjdCwgcXVlcnkpO1xuICAgIHJldHVybiBwcm9taXNlO1xuICB9XG5cbiAgLy8gVmFsaWRhdGVzIHRoYXQgYWxsIHRoZSBwcm9wZXJ0aWVzIGFyZSBzZXQgZm9yIHRoZSBvYmplY3RcbiAgdmFsaWRhdGVSZXF1aXJlZENvbHVtbnMoY2xhc3NOYW1lOiBzdHJpbmcsIG9iamVjdDogYW55LCBxdWVyeTogYW55KSB7XG4gICAgY29uc3QgY29sdW1ucyA9IHJlcXVpcmVkQ29sdW1uc1tjbGFzc05hbWVdO1xuICAgIGlmICghY29sdW1ucyB8fCBjb2x1bW5zLmxlbmd0aCA9PSAwKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMpO1xuICAgIH1cblxuICAgIGNvbnN0IG1pc3NpbmdDb2x1bW5zID0gY29sdW1ucy5maWx0ZXIoZnVuY3Rpb24oY29sdW1uKSB7XG4gICAgICBpZiAocXVlcnkgJiYgcXVlcnkub2JqZWN0SWQpIHtcbiAgICAgICAgaWYgKG9iamVjdFtjb2x1bW5dICYmIHR5cGVvZiBvYmplY3RbY29sdW1uXSA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAvLyBUcnlpbmcgdG8gZGVsZXRlIGEgcmVxdWlyZWQgY29sdW1uXG4gICAgICAgICAgcmV0dXJuIG9iamVjdFtjb2x1bW5dLl9fb3AgPT0gJ0RlbGV0ZSc7XG4gICAgICAgIH1cbiAgICAgICAgLy8gTm90IHRyeWluZyB0byBkbyBhbnl0aGluZyB0aGVyZVxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICByZXR1cm4gIW9iamVjdFtjb2x1bW5dO1xuICAgIH0pO1xuXG4gICAgaWYgKG1pc3NpbmdDb2x1bW5zLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuSU5DT1JSRUNUX1RZUEUsXG4gICAgICAgIG1pc3NpbmdDb2x1bW5zWzBdICsgJyBpcyByZXF1aXJlZC4nXG4gICAgICApO1xuICAgIH1cbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMpO1xuICB9XG5cbiAgdGVzdFBlcm1pc3Npb25zRm9yQ2xhc3NOYW1lKFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIGFjbEdyb3VwOiBzdHJpbmdbXSxcbiAgICBvcGVyYXRpb246IHN0cmluZ1xuICApIHtcbiAgICByZXR1cm4gU2NoZW1hQ29udHJvbGxlci50ZXN0UGVybWlzc2lvbnMoXG4gICAgICB0aGlzLmdldENsYXNzTGV2ZWxQZXJtaXNzaW9ucyhjbGFzc05hbWUpLFxuICAgICAgYWNsR3JvdXAsXG4gICAgICBvcGVyYXRpb25cbiAgICApO1xuICB9XG5cbiAgLy8gVGVzdHMgdGhhdCB0aGUgY2xhc3MgbGV2ZWwgcGVybWlzc2lvbiBsZXQgcGFzcyB0aGUgb3BlcmF0aW9uIGZvciBhIGdpdmVuIGFjbEdyb3VwXG4gIHN0YXRpYyB0ZXN0UGVybWlzc2lvbnMoXG4gICAgY2xhc3NQZXJtaXNzaW9uczogP2FueSxcbiAgICBhY2xHcm91cDogc3RyaW5nW10sXG4gICAgb3BlcmF0aW9uOiBzdHJpbmdcbiAgKTogYm9vbGVhbiB7XG4gICAgaWYgKCFjbGFzc1Blcm1pc3Npb25zIHx8ICFjbGFzc1Blcm1pc3Npb25zW29wZXJhdGlvbl0pIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICBjb25zdCBwZXJtcyA9IGNsYXNzUGVybWlzc2lvbnNbb3BlcmF0aW9uXTtcbiAgICBpZiAocGVybXNbJyonXSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIC8vIENoZWNrIHBlcm1pc3Npb25zIGFnYWluc3QgdGhlIGFjbEdyb3VwIHByb3ZpZGVkIChhcnJheSBvZiB1c2VySWQvcm9sZXMpXG4gICAgaWYgKFxuICAgICAgYWNsR3JvdXAuc29tZShhY2wgPT4ge1xuICAgICAgICByZXR1cm4gcGVybXNbYWNsXSA9PT0gdHJ1ZTtcbiAgICAgIH0pXG4gICAgKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLy8gVmFsaWRhdGVzIGFuIG9wZXJhdGlvbiBwYXNzZXMgY2xhc3MtbGV2ZWwtcGVybWlzc2lvbnMgc2V0IGluIHRoZSBzY2hlbWFcbiAgc3RhdGljIHZhbGlkYXRlUGVybWlzc2lvbihcbiAgICBjbGFzc1Blcm1pc3Npb25zOiA/YW55LFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIGFjbEdyb3VwOiBzdHJpbmdbXSxcbiAgICBvcGVyYXRpb246IHN0cmluZ1xuICApIHtcbiAgICBpZiAoXG4gICAgICBTY2hlbWFDb250cm9sbGVyLnRlc3RQZXJtaXNzaW9ucyhjbGFzc1Blcm1pc3Npb25zLCBhY2xHcm91cCwgb3BlcmF0aW9uKVxuICAgICkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cblxuICAgIGlmICghY2xhc3NQZXJtaXNzaW9ucyB8fCAhY2xhc3NQZXJtaXNzaW9uc1tvcGVyYXRpb25dKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgY29uc3QgcGVybXMgPSBjbGFzc1Blcm1pc3Npb25zW29wZXJhdGlvbl07XG4gICAgLy8gSWYgb25seSBmb3IgYXV0aGVudGljYXRlZCB1c2Vyc1xuICAgIC8vIG1ha2Ugc3VyZSB3ZSBoYXZlIGFuIGFjbEdyb3VwXG4gICAgaWYgKHBlcm1zWydyZXF1aXJlc0F1dGhlbnRpY2F0aW9uJ10pIHtcbiAgICAgIC8vIElmIGFjbEdyb3VwIGhhcyAqIChwdWJsaWMpXG4gICAgICBpZiAoIWFjbEdyb3VwIHx8IGFjbEdyb3VwLmxlbmd0aCA9PSAwKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5ELFxuICAgICAgICAgICdQZXJtaXNzaW9uIGRlbmllZCwgdXNlciBuZWVkcyB0byBiZSBhdXRoZW50aWNhdGVkLidcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSBpZiAoYWNsR3JvdXAuaW5kZXhPZignKicpID4gLTEgJiYgYWNsR3JvdXAubGVuZ3RoID09IDEpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsXG4gICAgICAgICAgJ1Blcm1pc3Npb24gZGVuaWVkLCB1c2VyIG5lZWRzIHRvIGJlIGF1dGhlbnRpY2F0ZWQuJ1xuICAgICAgICApO1xuICAgICAgfVxuICAgICAgLy8gcmVxdWlyZXNBdXRoZW50aWNhdGlvbiBwYXNzZWQsIGp1c3QgbW92ZSBmb3J3YXJkXG4gICAgICAvLyBwcm9iYWJseSB3b3VsZCBiZSB3aXNlIGF0IHNvbWUgcG9pbnQgdG8gcmVuYW1lIHRvICdhdXRoZW50aWNhdGVkVXNlcidcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG5cbiAgICAvLyBObyBtYXRjaGluZyBDTFAsIGxldCdzIGNoZWNrIHRoZSBQb2ludGVyIHBlcm1pc3Npb25zXG4gICAgLy8gQW5kIGhhbmRsZSB0aG9zZSBsYXRlclxuICAgIGNvbnN0IHBlcm1pc3Npb25GaWVsZCA9XG4gICAgICBbJ2dldCcsICdmaW5kJywgJ2NvdW50J10uaW5kZXhPZihvcGVyYXRpb24pID4gLTFcbiAgICAgICAgPyAncmVhZFVzZXJGaWVsZHMnXG4gICAgICAgIDogJ3dyaXRlVXNlckZpZWxkcyc7XG5cbiAgICAvLyBSZWplY3QgY3JlYXRlIHdoZW4gd3JpdGUgbG9ja2Rvd25cbiAgICBpZiAocGVybWlzc2lvbkZpZWxkID09ICd3cml0ZVVzZXJGaWVsZHMnICYmIG9wZXJhdGlvbiA9PSAnY3JlYXRlJykge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5PUEVSQVRJT05fRk9SQklEREVOLFxuICAgICAgICBgUGVybWlzc2lvbiBkZW5pZWQgZm9yIGFjdGlvbiAke29wZXJhdGlvbn0gb24gY2xhc3MgJHtjbGFzc05hbWV9LmBcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gUHJvY2VzcyB0aGUgcmVhZFVzZXJGaWVsZHMgbGF0ZXJcbiAgICBpZiAoXG4gICAgICBBcnJheS5pc0FycmF5KGNsYXNzUGVybWlzc2lvbnNbcGVybWlzc2lvbkZpZWxkXSkgJiZcbiAgICAgIGNsYXNzUGVybWlzc2lvbnNbcGVybWlzc2lvbkZpZWxkXS5sZW5ndGggPiAwXG4gICAgKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgIFBhcnNlLkVycm9yLk9QRVJBVElPTl9GT1JCSURERU4sXG4gICAgICBgUGVybWlzc2lvbiBkZW5pZWQgZm9yIGFjdGlvbiAke29wZXJhdGlvbn0gb24gY2xhc3MgJHtjbGFzc05hbWV9LmBcbiAgICApO1xuICB9XG5cbiAgLy8gVmFsaWRhdGVzIGFuIG9wZXJhdGlvbiBwYXNzZXMgY2xhc3MtbGV2ZWwtcGVybWlzc2lvbnMgc2V0IGluIHRoZSBzY2hlbWFcbiAgdmFsaWRhdGVQZXJtaXNzaW9uKGNsYXNzTmFtZTogc3RyaW5nLCBhY2xHcm91cDogc3RyaW5nW10sIG9wZXJhdGlvbjogc3RyaW5nKSB7XG4gICAgcmV0dXJuIFNjaGVtYUNvbnRyb2xsZXIudmFsaWRhdGVQZXJtaXNzaW9uKFxuICAgICAgdGhpcy5nZXRDbGFzc0xldmVsUGVybWlzc2lvbnMoY2xhc3NOYW1lKSxcbiAgICAgIGNsYXNzTmFtZSxcbiAgICAgIGFjbEdyb3VwLFxuICAgICAgb3BlcmF0aW9uXG4gICAgKTtcbiAgfVxuXG4gIGdldENsYXNzTGV2ZWxQZXJtaXNzaW9ucyhjbGFzc05hbWU6IHN0cmluZyk6IGFueSB7XG4gICAgcmV0dXJuIChcbiAgICAgIHRoaXMuc2NoZW1hRGF0YVtjbGFzc05hbWVdICYmXG4gICAgICB0aGlzLnNjaGVtYURhdGFbY2xhc3NOYW1lXS5jbGFzc0xldmVsUGVybWlzc2lvbnNcbiAgICApO1xuICB9XG5cbiAgLy8gUmV0dXJucyB0aGUgZXhwZWN0ZWQgdHlwZSBmb3IgYSBjbGFzc05hbWUra2V5IGNvbWJpbmF0aW9uXG4gIC8vIG9yIHVuZGVmaW5lZCBpZiB0aGUgc2NoZW1hIGlzIG5vdCBzZXRcbiAgZ2V0RXhwZWN0ZWRUeXBlKFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIGZpZWxkTmFtZTogc3RyaW5nXG4gICk6ID8oU2NoZW1hRmllbGQgfCBzdHJpbmcpIHtcbiAgICBpZiAodGhpcy5zY2hlbWFEYXRhW2NsYXNzTmFtZV0pIHtcbiAgICAgIGNvbnN0IGV4cGVjdGVkVHlwZSA9IHRoaXMuc2NoZW1hRGF0YVtjbGFzc05hbWVdLmZpZWxkc1tmaWVsZE5hbWVdO1xuICAgICAgcmV0dXJuIGV4cGVjdGVkVHlwZSA9PT0gJ21hcCcgPyAnT2JqZWN0JyA6IGV4cGVjdGVkVHlwZTtcbiAgICB9XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIC8vIENoZWNrcyBpZiBhIGdpdmVuIGNsYXNzIGlzIGluIHRoZSBzY2hlbWEuXG4gIGhhc0NsYXNzKGNsYXNzTmFtZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHRoaXMucmVsb2FkRGF0YSgpLnRoZW4oKCkgPT4gISF0aGlzLnNjaGVtYURhdGFbY2xhc3NOYW1lXSk7XG4gIH1cbn1cblxuLy8gUmV0dXJucyBhIHByb21pc2UgZm9yIGEgbmV3IFNjaGVtYS5cbmNvbnN0IGxvYWQgPSAoXG4gIGRiQWRhcHRlcjogU3RvcmFnZUFkYXB0ZXIsXG4gIHNjaGVtYUNhY2hlOiBhbnksXG4gIG9wdGlvbnM6IGFueVxuKTogUHJvbWlzZTxTY2hlbWFDb250cm9sbGVyPiA9PiB7XG4gIGNvbnN0IHNjaGVtYSA9IG5ldyBTY2hlbWFDb250cm9sbGVyKGRiQWRhcHRlciwgc2NoZW1hQ2FjaGUpO1xuICByZXR1cm4gc2NoZW1hLnJlbG9hZERhdGEob3B0aW9ucykudGhlbigoKSA9PiBzY2hlbWEpO1xufTtcblxuLy8gQnVpbGRzIGEgbmV3IHNjaGVtYSAoaW4gc2NoZW1hIEFQSSByZXNwb25zZSBmb3JtYXQpIG91dCBvZiBhblxuLy8gZXhpc3RpbmcgbW9uZ28gc2NoZW1hICsgYSBzY2hlbWFzIEFQSSBwdXQgcmVxdWVzdC4gVGhpcyByZXNwb25zZVxuLy8gZG9lcyBub3QgaW5jbHVkZSB0aGUgZGVmYXVsdCBmaWVsZHMsIGFzIGl0IGlzIGludGVuZGVkIHRvIGJlIHBhc3NlZFxuLy8gdG8gbW9uZ29TY2hlbWFGcm9tRmllbGRzQW5kQ2xhc3NOYW1lLiBObyB2YWxpZGF0aW9uIGlzIGRvbmUgaGVyZSwgaXRcbi8vIGlzIGRvbmUgaW4gbW9uZ29TY2hlbWFGcm9tRmllbGRzQW5kQ2xhc3NOYW1lLlxuZnVuY3Rpb24gYnVpbGRNZXJnZWRTY2hlbWFPYmplY3QoXG4gIGV4aXN0aW5nRmllbGRzOiBTY2hlbWFGaWVsZHMsXG4gIHB1dFJlcXVlc3Q6IGFueVxuKTogU2NoZW1hRmllbGRzIHtcbiAgY29uc3QgbmV3U2NoZW1hID0ge307XG4gIC8vIEBmbG93LWRpc2FibGUtbmV4dFxuICBjb25zdCBzeXNTY2hlbWFGaWVsZCA9XG4gICAgT2JqZWN0LmtleXMoZGVmYXVsdENvbHVtbnMpLmluZGV4T2YoZXhpc3RpbmdGaWVsZHMuX2lkKSA9PT0gLTFcbiAgICAgID8gW11cbiAgICAgIDogT2JqZWN0LmtleXMoZGVmYXVsdENvbHVtbnNbZXhpc3RpbmdGaWVsZHMuX2lkXSk7XG4gIGZvciAoY29uc3Qgb2xkRmllbGQgaW4gZXhpc3RpbmdGaWVsZHMpIHtcbiAgICBpZiAoXG4gICAgICBvbGRGaWVsZCAhPT0gJ19pZCcgJiZcbiAgICAgIG9sZEZpZWxkICE9PSAnQUNMJyAmJlxuICAgICAgb2xkRmllbGQgIT09ICd1cGRhdGVkQXQnICYmXG4gICAgICBvbGRGaWVsZCAhPT0gJ2NyZWF0ZWRBdCcgJiZcbiAgICAgIG9sZEZpZWxkICE9PSAnb2JqZWN0SWQnXG4gICAgKSB7XG4gICAgICBpZiAoXG4gICAgICAgIHN5c1NjaGVtYUZpZWxkLmxlbmd0aCA+IDAgJiZcbiAgICAgICAgc3lzU2NoZW1hRmllbGQuaW5kZXhPZihvbGRGaWVsZCkgIT09IC0xXG4gICAgICApIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBmaWVsZElzRGVsZXRlZCA9XG4gICAgICAgIHB1dFJlcXVlc3Rbb2xkRmllbGRdICYmIHB1dFJlcXVlc3Rbb2xkRmllbGRdLl9fb3AgPT09ICdEZWxldGUnO1xuICAgICAgaWYgKCFmaWVsZElzRGVsZXRlZCkge1xuICAgICAgICBuZXdTY2hlbWFbb2xkRmllbGRdID0gZXhpc3RpbmdGaWVsZHNbb2xkRmllbGRdO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICBmb3IgKGNvbnN0IG5ld0ZpZWxkIGluIHB1dFJlcXVlc3QpIHtcbiAgICBpZiAobmV3RmllbGQgIT09ICdvYmplY3RJZCcgJiYgcHV0UmVxdWVzdFtuZXdGaWVsZF0uX19vcCAhPT0gJ0RlbGV0ZScpIHtcbiAgICAgIGlmIChcbiAgICAgICAgc3lzU2NoZW1hRmllbGQubGVuZ3RoID4gMCAmJlxuICAgICAgICBzeXNTY2hlbWFGaWVsZC5pbmRleE9mKG5ld0ZpZWxkKSAhPT0gLTFcbiAgICAgICkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIG5ld1NjaGVtYVtuZXdGaWVsZF0gPSBwdXRSZXF1ZXN0W25ld0ZpZWxkXTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG5ld1NjaGVtYTtcbn1cblxuLy8gR2l2ZW4gYSBzY2hlbWEgcHJvbWlzZSwgY29uc3RydWN0IGFub3RoZXIgc2NoZW1hIHByb21pc2UgdGhhdFxuLy8gdmFsaWRhdGVzIHRoaXMgZmllbGQgb25jZSB0aGUgc2NoZW1hIGxvYWRzLlxuZnVuY3Rpb24gdGhlblZhbGlkYXRlUmVxdWlyZWRDb2x1bW5zKHNjaGVtYVByb21pc2UsIGNsYXNzTmFtZSwgb2JqZWN0LCBxdWVyeSkge1xuICByZXR1cm4gc2NoZW1hUHJvbWlzZS50aGVuKHNjaGVtYSA9PiB7XG4gICAgcmV0dXJuIHNjaGVtYS52YWxpZGF0ZVJlcXVpcmVkQ29sdW1ucyhjbGFzc05hbWUsIG9iamVjdCwgcXVlcnkpO1xuICB9KTtcbn1cblxuLy8gR2V0cyB0aGUgdHlwZSBmcm9tIGEgUkVTVCBBUEkgZm9ybWF0dGVkIG9iamVjdCwgd2hlcmUgJ3R5cGUnIGlzXG4vLyBleHRlbmRlZCBwYXN0IGphdmFzY3JpcHQgdHlwZXMgdG8gaW5jbHVkZSB0aGUgcmVzdCBvZiB0aGUgUGFyc2Vcbi8vIHR5cGUgc3lzdGVtLlxuLy8gVGhlIG91dHB1dCBzaG91bGQgYmUgYSB2YWxpZCBzY2hlbWEgdmFsdWUuXG4vLyBUT0RPOiBlbnN1cmUgdGhhdCB0aGlzIGlzIGNvbXBhdGlibGUgd2l0aCB0aGUgZm9ybWF0IHVzZWQgaW4gT3BlbiBEQlxuZnVuY3Rpb24gZ2V0VHlwZShvYmo6IGFueSk6ID8oU2NoZW1hRmllbGQgfCBzdHJpbmcpIHtcbiAgY29uc3QgdHlwZSA9IHR5cGVvZiBvYmo7XG4gIHN3aXRjaCAodHlwZSkge1xuICAgIGNhc2UgJ2Jvb2xlYW4nOlxuICAgICAgcmV0dXJuICdCb29sZWFuJztcbiAgICBjYXNlICdzdHJpbmcnOlxuICAgICAgcmV0dXJuICdTdHJpbmcnO1xuICAgIGNhc2UgJ251bWJlcic6XG4gICAgICByZXR1cm4gJ051bWJlcic7XG4gICAgY2FzZSAnbWFwJzpcbiAgICBjYXNlICdvYmplY3QnOlxuICAgICAgaWYgKCFvYmopIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cbiAgICAgIHJldHVybiBnZXRPYmplY3RUeXBlKG9iaik7XG4gICAgY2FzZSAnZnVuY3Rpb24nOlxuICAgIGNhc2UgJ3N5bWJvbCc6XG4gICAgY2FzZSAndW5kZWZpbmVkJzpcbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgJ2JhZCBvYmo6ICcgKyBvYmo7XG4gIH1cbn1cblxuLy8gVGhpcyBnZXRzIHRoZSB0eXBlIGZvciBub24tSlNPTiB0eXBlcyBsaWtlIHBvaW50ZXJzIGFuZCBmaWxlcywgYnV0XG4vLyBhbHNvIGdldHMgdGhlIGFwcHJvcHJpYXRlIHR5cGUgZm9yICQgb3BlcmF0b3JzLlxuLy8gUmV0dXJucyBudWxsIGlmIHRoZSB0eXBlIGlzIHVua25vd24uXG5mdW5jdGlvbiBnZXRPYmplY3RUeXBlKG9iaik6ID8oU2NoZW1hRmllbGQgfCBzdHJpbmcpIHtcbiAgaWYgKG9iaiBpbnN0YW5jZW9mIEFycmF5KSB7XG4gICAgcmV0dXJuICdBcnJheSc7XG4gIH1cbiAgaWYgKG9iai5fX3R5cGUpIHtcbiAgICBzd2l0Y2ggKG9iai5fX3R5cGUpIHtcbiAgICAgIGNhc2UgJ1BvaW50ZXInOlxuICAgICAgICBpZiAob2JqLmNsYXNzTmFtZSkge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0eXBlOiAnUG9pbnRlcicsXG4gICAgICAgICAgICB0YXJnZXRDbGFzczogb2JqLmNsYXNzTmFtZSxcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnUmVsYXRpb24nOlxuICAgICAgICBpZiAob2JqLmNsYXNzTmFtZSkge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0eXBlOiAnUmVsYXRpb24nLFxuICAgICAgICAgICAgdGFyZ2V0Q2xhc3M6IG9iai5jbGFzc05hbWUsXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ0ZpbGUnOlxuICAgICAgICBpZiAob2JqLm5hbWUpIHtcbiAgICAgICAgICByZXR1cm4gJ0ZpbGUnO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnRGF0ZSc6XG4gICAgICAgIGlmIChvYmouaXNvKSB7XG4gICAgICAgICAgcmV0dXJuICdEYXRlJztcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ0dlb1BvaW50JzpcbiAgICAgICAgaWYgKG9iai5sYXRpdHVkZSAhPSBudWxsICYmIG9iai5sb25naXR1ZGUgIT0gbnVsbCkge1xuICAgICAgICAgIHJldHVybiAnR2VvUG9pbnQnO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnQnl0ZXMnOlxuICAgICAgICBpZiAob2JqLmJhc2U2NCkge1xuICAgICAgICAgIHJldHVybiAnQnl0ZXMnO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnUG9seWdvbic6XG4gICAgICAgIGlmIChvYmouY29vcmRpbmF0ZXMpIHtcbiAgICAgICAgICByZXR1cm4gJ1BvbHlnb24nO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICBQYXJzZS5FcnJvci5JTkNPUlJFQ1RfVFlQRSxcbiAgICAgICdUaGlzIGlzIG5vdCBhIHZhbGlkICcgKyBvYmouX190eXBlXG4gICAgKTtcbiAgfVxuICBpZiAob2JqWyckbmUnXSkge1xuICAgIHJldHVybiBnZXRPYmplY3RUeXBlKG9ialsnJG5lJ10pO1xuICB9XG4gIGlmIChvYmouX19vcCkge1xuICAgIHN3aXRjaCAob2JqLl9fb3ApIHtcbiAgICAgIGNhc2UgJ0luY3JlbWVudCc6XG4gICAgICAgIHJldHVybiAnTnVtYmVyJztcbiAgICAgIGNhc2UgJ0RlbGV0ZSc6XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgY2FzZSAnQWRkJzpcbiAgICAgIGNhc2UgJ0FkZFVuaXF1ZSc6XG4gICAgICBjYXNlICdSZW1vdmUnOlxuICAgICAgICByZXR1cm4gJ0FycmF5JztcbiAgICAgIGNhc2UgJ0FkZFJlbGF0aW9uJzpcbiAgICAgIGNhc2UgJ1JlbW92ZVJlbGF0aW9uJzpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICB0eXBlOiAnUmVsYXRpb24nLFxuICAgICAgICAgIHRhcmdldENsYXNzOiBvYmoub2JqZWN0c1swXS5jbGFzc05hbWUsXG4gICAgICAgIH07XG4gICAgICBjYXNlICdCYXRjaCc6XG4gICAgICAgIHJldHVybiBnZXRPYmplY3RUeXBlKG9iai5vcHNbMF0pO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgJ3VuZXhwZWN0ZWQgb3A6ICcgKyBvYmouX19vcDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuICdPYmplY3QnO1xufVxuXG5leHBvcnQge1xuICBsb2FkLFxuICBjbGFzc05hbWVJc1ZhbGlkLFxuICBmaWVsZE5hbWVJc1ZhbGlkLFxuICBpbnZhbGlkQ2xhc3NOYW1lTWVzc2FnZSxcbiAgYnVpbGRNZXJnZWRTY2hlbWFPYmplY3QsXG4gIHN5c3RlbUNsYXNzZXMsXG4gIGRlZmF1bHRDb2x1bW5zLFxuICBjb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hLFxuICBWb2xhdGlsZUNsYXNzZXNTY2hlbWFzLFxuICBTY2hlbWFDb250cm9sbGVyLFxufTtcbiJdfQ==