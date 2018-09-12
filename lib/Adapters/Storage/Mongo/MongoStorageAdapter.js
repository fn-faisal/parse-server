'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MongoStorageAdapter = undefined;

var _MongoCollection = require('./MongoCollection');

var _MongoCollection2 = _interopRequireDefault(_MongoCollection);

var _MongoSchemaCollection = require('./MongoSchemaCollection');

var _MongoSchemaCollection2 = _interopRequireDefault(_MongoSchemaCollection);

var _StorageAdapter = require('../StorageAdapter');

var _mongodbUrl = require('../../../vendor/mongodbUrl');

var _MongoTransform = require('./MongoTransform');

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _defaults = require('../../../defaults');

var _defaults2 = _interopRequireDefault(_defaults);

var _logger = require('../../../logger');

var _logger2 = _interopRequireDefault(_logger);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _objectWithoutProperties(obj, keys) { var target = {}; for (var i in obj) { if (keys.indexOf(i) >= 0) continue; if (!Object.prototype.hasOwnProperty.call(obj, i)) continue; target[i] = obj[i]; } return target; }
// -disable-next

// -disable-next


// -disable-next
const mongodb = require('mongodb');
const MongoClient = mongodb.MongoClient;
const ReadPreference = mongodb.ReadPreference;

const MongoSchemaCollectionName = '_SCHEMA';

const storageAdapterAllCollections = mongoAdapter => {
  return mongoAdapter.connect().then(() => mongoAdapter.database.collections()).then(collections => {
    return collections.filter(collection => {
      if (collection.namespace.match(/\.system\./)) {
        return false;
      }
      // TODO: If you have one app with a collection prefix that happens to be a prefix of another
      // apps prefix, this will go very very badly. We should fix that somehow.
      return collection.collectionName.indexOf(mongoAdapter._collectionPrefix) == 0;
    });
  });
};

const convertParseSchemaToMongoSchema = (_ref) => {
  let schema = _objectWithoutProperties(_ref, []);

  delete schema.fields._rperm;
  delete schema.fields._wperm;

  if (schema.className === '_User') {
    // Legacy mongo adapter knows about the difference between password and _hashed_password.
    // Future database adapters will only know about _hashed_password.
    // Note: Parse Server will bring back password with injectDefaultSchema, so we don't need
    // to add _hashed_password back ever.
    delete schema.fields._hashed_password;
  }

  return schema;
};

// Returns { code, error } if invalid, or { result }, an object
// suitable for inserting into _SCHEMA collection, otherwise.
const mongoSchemaFromFieldsAndClassNameAndCLP = (fields, className, classLevelPermissions, indexes) => {
  const mongoObject = {
    _id: className,
    objectId: 'string',
    updatedAt: 'string',
    createdAt: 'string',
    _metadata: undefined
  };

  for (const fieldName in fields) {
    mongoObject[fieldName] = _MongoSchemaCollection2.default.parseFieldTypeToMongoFieldType(fields[fieldName]);
  }

  if (typeof classLevelPermissions !== 'undefined') {
    mongoObject._metadata = mongoObject._metadata || {};
    if (!classLevelPermissions) {
      delete mongoObject._metadata.class_permissions;
    } else {
      mongoObject._metadata.class_permissions = classLevelPermissions;
    }
  }

  if (indexes && typeof indexes === 'object' && Object.keys(indexes).length > 0) {
    mongoObject._metadata = mongoObject._metadata || {};
    mongoObject._metadata.indexes = indexes;
  }

  if (!mongoObject._metadata) {
    // cleanup the unused _metadata
    delete mongoObject._metadata;
  }

  return mongoObject;
};

class MongoStorageAdapter {
  // Private
  constructor({
    uri = _defaults2.default.DefaultMongoURI,
    collectionPrefix = '',
    mongoOptions = {}
  }) {
    this._uri = uri;
    this._collectionPrefix = collectionPrefix;
    this._mongoOptions = mongoOptions;

    // MaxTimeMS is not a global MongoDB client option, it is applied per operation.
    this._maxTimeMS = mongoOptions.maxTimeMS;
    this.canSortOnJoinTables = true;
    delete mongoOptions.maxTimeMS;
  }
  // Public


  connect() {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    // parsing and re-formatting causes the auth value (if there) to get URI
    // encoded
    const encodedUri = (0, _mongodbUrl.format)((0, _mongodbUrl.parse)(this._uri));

    this.connectionPromise = MongoClient.connect(encodedUri, this._mongoOptions).then(client => {
      // Starting mongoDB 3.0, the MongoClient.connect don't return a DB anymore but a client
      // Fortunately, we can get back the options and use them to select the proper DB.
      // https://github.com/mongodb/node-mongodb-native/blob/2c35d76f08574225b8db02d7bef687123e6bb018/lib/mongo_client.js#L885
      const options = client.s.options;
      const database = client.db(options.dbName);
      if (!database) {
        delete this.connectionPromise;
        return;
      }
      database.on('error', () => {
        delete this.connectionPromise;
      });
      database.on('close', () => {
        delete this.connectionPromise;
      });
      this.client = client;
      this.database = database;
    }).catch(err => {
      delete this.connectionPromise;
      return Promise.reject(err);
    });

    return this.connectionPromise;
  }

  handleError(error) {
    if (error && error.code === 13) {
      // Unauthorized error
      delete this.client;
      delete this.database;
      delete this.connectionPromise;
      _logger2.default.error('Received unauthorized error', { error: error });
    }
    throw error;
  }

  handleShutdown() {
    if (!this.client) {
      return;
    }
    this.client.close(false);
  }

  _adaptiveCollection(name) {
    return this.connect().then(() => this.database.collection(this._collectionPrefix + name)).then(rawCollection => new _MongoCollection2.default(rawCollection)).catch(err => this.handleError(err));
  }

  _schemaCollection() {
    return this.connect().then(() => this._adaptiveCollection(MongoSchemaCollectionName)).then(collection => new _MongoSchemaCollection2.default(collection));
  }

  classExists(name) {
    return this.connect().then(() => {
      return this.database.listCollections({ name: this._collectionPrefix + name }).toArray();
    }).then(collections => {
      return collections.length > 0;
    }).catch(err => this.handleError(err));
  }

  setClassLevelPermissions(className, CLPs) {
    return this._schemaCollection().then(schemaCollection => schemaCollection.updateSchema(className, {
      $set: { '_metadata.class_permissions': CLPs }
    })).catch(err => this.handleError(err));
  }

  setIndexesWithSchemaFormat(className, submittedIndexes, existingIndexes = {}, fields) {
    if (submittedIndexes === undefined) {
      return Promise.resolve();
    }
    if (Object.keys(existingIndexes).length === 0) {
      existingIndexes = { _id_: { _id: 1 } };
    }
    const deletePromises = [];
    const insertedIndexes = [];
    Object.keys(submittedIndexes).forEach(name => {
      const field = submittedIndexes[name];
      if (existingIndexes[name] && field.__op !== 'Delete') {
        throw new _node2.default.Error(_node2.default.Error.INVALID_QUERY, `Index ${name} exists, cannot update.`);
      }
      if (!existingIndexes[name] && field.__op === 'Delete') {
        throw new _node2.default.Error(_node2.default.Error.INVALID_QUERY, `Index ${name} does not exist, cannot delete.`);
      }
      if (field.__op === 'Delete') {
        const promise = this.dropIndex(className, name);
        deletePromises.push(promise);
        delete existingIndexes[name];
      } else {
        Object.keys(field).forEach(key => {
          if (!fields.hasOwnProperty(key)) {
            throw new _node2.default.Error(_node2.default.Error.INVALID_QUERY, `Field ${key} does not exist, cannot add index.`);
          }
        });
        existingIndexes[name] = field;
        insertedIndexes.push({
          key: field,
          name
        });
      }
    });
    let insertPromise = Promise.resolve();
    if (insertedIndexes.length > 0) {
      insertPromise = this.createIndexes(className, insertedIndexes);
    }
    return Promise.all(deletePromises).then(() => insertPromise).then(() => this._schemaCollection()).then(schemaCollection => schemaCollection.updateSchema(className, {
      $set: { '_metadata.indexes': existingIndexes }
    })).catch(err => this.handleError(err));
  }

  setIndexesFromMongo(className) {
    return this.getIndexes(className).then(indexes => {
      indexes = indexes.reduce((obj, index) => {
        if (index.key._fts) {
          delete index.key._fts;
          delete index.key._ftsx;
          for (const field in index.weights) {
            index.key[field] = 'text';
          }
        }
        obj[index.name] = index.key;
        return obj;
      }, {});
      return this._schemaCollection().then(schemaCollection => schemaCollection.updateSchema(className, {
        $set: { '_metadata.indexes': indexes }
      }));
    }).catch(err => this.handleError(err)).catch(() => {
      // Ignore if collection not found
      return Promise.resolve();
    });
  }

  createClass(className, schema) {
    schema = convertParseSchemaToMongoSchema(schema);
    const mongoObject = mongoSchemaFromFieldsAndClassNameAndCLP(schema.fields, className, schema.classLevelPermissions, schema.indexes);
    mongoObject._id = className;
    return this.setIndexesWithSchemaFormat(className, schema.indexes, {}, schema.fields).then(() => this._schemaCollection()).then(schemaCollection => schemaCollection.insertSchema(mongoObject)).catch(err => this.handleError(err));
  }

  addFieldIfNotExists(className, fieldName, type) {
    return this._schemaCollection().then(schemaCollection => schemaCollection.addFieldIfNotExists(className, fieldName, type)).then(() => this.createIndexesIfNeeded(className, fieldName, type)).catch(err => this.handleError(err));
  }

  // Drops a collection. Resolves with true if it was a Parse Schema (eg. _User, Custom, etc.)
  // and resolves with false if it wasn't (eg. a join table). Rejects if deletion was impossible.
  deleteClass(className) {
    return this._adaptiveCollection(className).then(collection => collection.drop()).catch(error => {
      // 'ns not found' means collection was already gone. Ignore deletion attempt.
      if (error.message == 'ns not found') {
        return;
      }
      throw error;
    })
    // We've dropped the collection, now remove the _SCHEMA document
    .then(() => this._schemaCollection()).then(schemaCollection => schemaCollection.findAndDeleteSchema(className)).catch(err => this.handleError(err));
  }

  deleteAllClasses(fast) {
    return storageAdapterAllCollections(this).then(collections => Promise.all(collections.map(collection => fast ? collection.remove({}) : collection.drop())));
  }

  // Remove the column and all the data. For Relations, the _Join collection is handled
  // specially, this function does not delete _Join columns. It should, however, indicate
  // that the relation fields does not exist anymore. In mongo, this means removing it from
  // the _SCHEMA collection.  There should be no actual data in the collection under the same name
  // as the relation column, so it's fine to attempt to delete it. If the fields listed to be
  // deleted do not exist, this function should return successfully anyways. Checking for
  // attempts to delete non-existent fields is the responsibility of Parse Server.

  // Pointer field names are passed for legacy reasons: the original mongo
  // format stored pointer field names differently in the database, and therefore
  // needed to know the type of the field before it could delete it. Future database
  // adapters should ignore the pointerFieldNames argument. All the field names are in
  // fieldNames, they show up additionally in the pointerFieldNames database for use
  // by the mongo adapter, which deals with the legacy mongo format.

  // This function is not obligated to delete fields atomically. It is given the field
  // names in a list so that databases that are capable of deleting fields atomically
  // may do so.

  // Returns a Promise.
  deleteFields(className, schema, fieldNames) {
    const mongoFormatNames = fieldNames.map(fieldName => {
      if (schema.fields[fieldName].type === 'Pointer') {
        return `_p_${fieldName}`;
      } else {
        return fieldName;
      }
    });
    const collectionUpdate = { '$unset': {} };
    mongoFormatNames.forEach(name => {
      collectionUpdate['$unset'][name] = null;
    });

    const schemaUpdate = { '$unset': {} };
    fieldNames.forEach(name => {
      schemaUpdate['$unset'][name] = null;
    });

    return this._adaptiveCollection(className).then(collection => collection.updateMany({}, collectionUpdate)).then(() => this._schemaCollection()).then(schemaCollection => schemaCollection.updateSchema(className, schemaUpdate)).catch(err => this.handleError(err));
  }

  // Return a promise for all schemas known to this adapter, in Parse format. In case the
  // schemas cannot be retrieved, returns a promise that rejects. Requirements for the
  // rejection reason are TBD.
  getAllClasses() {
    return this._schemaCollection().then(schemasCollection => schemasCollection._fetchAllSchemasFrom_SCHEMA()).catch(err => this.handleError(err));
  }

  // Return a promise for the schema with the given name, in Parse format. If
  // this adapter doesn't know about the schema, return a promise that rejects with
  // undefined as the reason.
  getClass(className) {
    return this._schemaCollection().then(schemasCollection => schemasCollection._fetchOneSchemaFrom_SCHEMA(className)).catch(err => this.handleError(err));
  }

  // TODO: As yet not particularly well specified. Creates an object. Maybe shouldn't even need the schema,
  // and should infer from the type. Or maybe does need the schema for validations. Or maybe needs
  // the schema only for the legacy mongo format. We'll figure that out later.
  createObject(className, schema, object) {
    schema = convertParseSchemaToMongoSchema(schema);
    const mongoObject = (0, _MongoTransform.parseObjectToMongoObjectForCreate)(className, object, schema);
    return this._adaptiveCollection(className).then(collection => collection.insertOne(mongoObject)).catch(error => {
      if (error.code === 11000) {
        // Duplicate value
        const err = new _node2.default.Error(_node2.default.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
        err.underlyingError = error;
        if (error.message) {
          const matches = error.message.match(/index:[\sa-zA-Z0-9_\-\.]+\$?([a-zA-Z_-]+)_1/);
          if (matches && Array.isArray(matches)) {
            err.userInfo = { duplicated_field: matches[1] };
          }
        }
        throw err;
      }
      throw error;
    }).catch(err => this.handleError(err));
  }

  // Remove all objects that match the given Parse Query.
  // If no objects match, reject with OBJECT_NOT_FOUND. If objects are found and deleted, resolve with undefined.
  // If there is some other error, reject with INTERNAL_SERVER_ERROR.
  deleteObjectsByQuery(className, schema, query) {
    schema = convertParseSchemaToMongoSchema(schema);
    return this._adaptiveCollection(className).then(collection => {
      const mongoWhere = (0, _MongoTransform.transformWhere)(className, query, schema);
      return collection.deleteMany(mongoWhere);
    }).catch(err => this.handleError(err)).then(({ result }) => {
      if (result.n === 0) {
        throw new _node2.default.Error(_node2.default.Error.OBJECT_NOT_FOUND, 'Object not found.');
      }
      return Promise.resolve();
    }, () => {
      throw new _node2.default.Error(_node2.default.Error.INTERNAL_SERVER_ERROR, 'Database adapter error');
    });
  }

  // Apply the update to all objects that match the given Parse Query.
  updateObjectsByQuery(className, schema, query, update) {
    schema = convertParseSchemaToMongoSchema(schema);
    const mongoUpdate = (0, _MongoTransform.transformUpdate)(className, update, schema);
    const mongoWhere = (0, _MongoTransform.transformWhere)(className, query, schema);
    return this._adaptiveCollection(className).then(collection => collection.updateMany(mongoWhere, mongoUpdate)).catch(err => this.handleError(err));
  }

  // Atomically finds and updates an object based on query.
  // Return value not currently well specified.
  findOneAndUpdate(className, schema, query, update) {
    schema = convertParseSchemaToMongoSchema(schema);
    const mongoUpdate = (0, _MongoTransform.transformUpdate)(className, update, schema);
    const mongoWhere = (0, _MongoTransform.transformWhere)(className, query, schema);
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.findAndModify(mongoWhere, [], mongoUpdate, { new: true })).then(result => (0, _MongoTransform.mongoObjectToParseObject)(className, result.value, schema)).catch(error => {
      if (error.code === 11000) {
        throw new _node2.default.Error(_node2.default.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
      }
      throw error;
    }).catch(err => this.handleError(err));
  }

  // Hopefully we can get rid of this. It's only used for config and hooks.
  upsertOneObject(className, schema, query, update) {
    schema = convertParseSchemaToMongoSchema(schema);
    const mongoUpdate = (0, _MongoTransform.transformUpdate)(className, update, schema);
    const mongoWhere = (0, _MongoTransform.transformWhere)(className, query, schema);
    return this._adaptiveCollection(className).then(collection => collection.upsertOne(mongoWhere, mongoUpdate)).catch(err => this.handleError(err));
  }

  // Executes a find. Accepts: className, query in Parse format, and { skip, limit, sort }.
  find(className, schema, query, { skip, limit, sort, keys, readPreference }) {
    schema = convertParseSchemaToMongoSchema(schema);
    const mongoWhere = (0, _MongoTransform.transformWhere)(className, query, schema);
    const mongoSort = _lodash2.default.mapKeys(sort, (value, fieldName) => (0, _MongoTransform.transformKey)(className, fieldName, schema));
    const mongoKeys = _lodash2.default.reduce(keys, (memo, key) => {
      memo[(0, _MongoTransform.transformKey)(className, key, schema)] = 1;
      return memo;
    }, {});

    readPreference = this._parseReadPreference(readPreference);
    return this.createTextIndexesIfNeeded(className, query, schema).then(() => this._adaptiveCollection(className)).then(collection => collection.find(mongoWhere, {
      skip,
      limit,
      sort: mongoSort,
      keys: mongoKeys,
      maxTimeMS: this._maxTimeMS,
      readPreference
    })).then(objects => objects.map(object => (0, _MongoTransform.mongoObjectToParseObject)(className, object, schema))).catch(err => this.handleError(err));
  }

  // Create a unique index. Unique indexes on nullable fields are not allowed. Since we don't
  // currently know which fields are nullable and which aren't, we ignore that criteria.
  // As such, we shouldn't expose this function to users of parse until we have an out-of-band
  // Way of determining if a field is nullable. Undefined doesn't count against uniqueness,
  // which is why we use sparse indexes.
  ensureUniqueness(className, schema, fieldNames) {
    schema = convertParseSchemaToMongoSchema(schema);
    const indexCreationRequest = {};
    const mongoFieldNames = fieldNames.map(fieldName => (0, _MongoTransform.transformKey)(className, fieldName, schema));
    mongoFieldNames.forEach(fieldName => {
      indexCreationRequest[fieldName] = 1;
    });
    return this._adaptiveCollection(className).then(collection => collection._ensureSparseUniqueIndexInBackground(indexCreationRequest)).catch(error => {
      if (error.code === 11000) {
        throw new _node2.default.Error(_node2.default.Error.DUPLICATE_VALUE, 'Tried to ensure field uniqueness for a class that already has duplicates.');
      }
      throw error;
    }).catch(err => this.handleError(err));
  }

  // Used in tests
  _rawFind(className, query) {
    return this._adaptiveCollection(className).then(collection => collection.find(query, {
      maxTimeMS: this._maxTimeMS
    })).catch(err => this.handleError(err));
  }

  // Executes a count.
  count(className, schema, query, readPreference) {
    schema = convertParseSchemaToMongoSchema(schema);
    readPreference = this._parseReadPreference(readPreference);
    return this._adaptiveCollection(className).then(collection => collection.count((0, _MongoTransform.transformWhere)(className, query, schema), {
      maxTimeMS: this._maxTimeMS,
      readPreference
    })).catch(err => this.handleError(err));
  }

  distinct(className, schema, query, fieldName) {
    schema = convertParseSchemaToMongoSchema(schema);
    const isPointerField = schema.fields[fieldName] && schema.fields[fieldName].type === 'Pointer';
    if (isPointerField) {
      fieldName = `_p_${fieldName}`;
    }
    return this._adaptiveCollection(className).then(collection => collection.distinct(fieldName, (0, _MongoTransform.transformWhere)(className, query, schema))).then(objects => {
      objects = objects.filter(obj => obj != null);
      return objects.map(object => {
        if (isPointerField) {
          const field = fieldName.substring(3);
          return (0, _MongoTransform.transformPointerString)(schema, field, object);
        }
        return (0, _MongoTransform.mongoObjectToParseObject)(className, object, schema);
      });
    }).catch(err => this.handleError(err));
  }

  aggregate(className, schema, pipeline, readPreference) {
    let isPointerField = false;
    pipeline = pipeline.map(stage => {
      if (stage.$group) {
        stage.$group = this._parseAggregateGroupArgs(schema, stage.$group);
        if (stage.$group._id && typeof stage.$group._id === 'string' && stage.$group._id.indexOf('$_p_') >= 0) {
          isPointerField = true;
        }
      }
      if (stage.$match) {
        stage.$match = this._parseAggregateArgs(schema, stage.$match);
      }
      if (stage.$project) {
        stage.$project = this._parseAggregateProjectArgs(schema, stage.$project);
      }
      return stage;
    });
    readPreference = this._parseReadPreference(readPreference);
    return this._adaptiveCollection(className).then(collection => collection.aggregate(pipeline, { readPreference, maxTimeMS: this._maxTimeMS })).catch(error => {
      if (error.code === 16006) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_QUERY, error.message);
      }
      throw error;
    }).then(results => {
      results.forEach(result => {
        if (result.hasOwnProperty('_id')) {
          if (isPointerField && result._id) {
            result._id = result._id.split('$')[1];
          }
          if (result._id == null || _lodash2.default.isEmpty(result._id)) {
            result._id = null;
          }
          result.objectId = result._id;
          delete result._id;
        }
      });
      return results;
    }).then(objects => objects.map(object => (0, _MongoTransform.mongoObjectToParseObject)(className, object, schema))).catch(err => this.handleError(err));
  }

  // This function will recursively traverse the pipeline and convert any Pointer or Date columns.
  // If we detect a pointer column we will rename the column being queried for to match the column
  // in the database. We also modify the value to what we expect the value to be in the database
  // as well.
  // For dates, the driver expects a Date object, but we have a string coming in. So we'll convert
  // the string to a Date so the driver can perform the necessary comparison.
  //
  // The goal of this method is to look for the "leaves" of the pipeline and determine if it needs
  // to be converted. The pipeline can have a few different forms. For more details, see:
  //     https://docs.mongodb.com/manual/reference/operator/aggregation/
  //
  // If the pipeline is an array, it means we are probably parsing an '$and' or '$or' operator. In
  // that case we need to loop through all of it's children to find the columns being operated on.
  // If the pipeline is an object, then we'll loop through the keys checking to see if the key name
  // matches one of the schema columns. If it does match a column and the column is a Pointer or
  // a Date, then we'll convert the value as described above.
  //
  // As much as I hate recursion...this seemed like a good fit for it. We're essentially traversing
  // down a tree to find a "leaf node" and checking to see if it needs to be converted.
  _parseAggregateArgs(schema, pipeline) {
    if (Array.isArray(pipeline)) {
      return pipeline.map(value => this._parseAggregateArgs(schema, value));
    } else if (typeof pipeline === 'object') {
      const returnValue = {};
      for (const field in pipeline) {
        if (schema.fields[field] && schema.fields[field].type === 'Pointer') {
          if (typeof pipeline[field] === 'object') {
            // Pass objects down to MongoDB...this is more than likely an $exists operator.
            returnValue[`_p_${field}`] = pipeline[field];
          } else {
            returnValue[`_p_${field}`] = `${schema.fields[field].targetClass}$${pipeline[field]}`;
          }
        } else if (schema.fields[field] && schema.fields[field].type === 'Date') {
          returnValue[field] = this._convertToDate(pipeline[field]);
        } else {
          returnValue[field] = this._parseAggregateArgs(schema, pipeline[field]);
        }

        if (field === 'objectId') {
          returnValue['_id'] = returnValue[field];
          delete returnValue[field];
        } else if (field === 'createdAt') {
          returnValue['_created_at'] = returnValue[field];
          delete returnValue[field];
        } else if (field === 'updatedAt') {
          returnValue['_updated_at'] = returnValue[field];
          delete returnValue[field];
        }
      }
      return returnValue;
    }
    return pipeline;
  }

  // This function is slightly different than the one above. Rather than trying to combine these
  // two functions and making the code even harder to understand, I decided to split it up. The
  // difference with this function is we are not transforming the values, only the keys of the
  // pipeline.
  _parseAggregateProjectArgs(schema, pipeline) {
    const returnValue = {};
    for (const field in pipeline) {
      if (schema.fields[field] && schema.fields[field].type === 'Pointer') {
        returnValue[`_p_${field}`] = pipeline[field];
      } else {
        returnValue[field] = this._parseAggregateArgs(schema, pipeline[field]);
      }

      if (field === 'objectId') {
        returnValue['_id'] = returnValue[field];
        delete returnValue[field];
      } else if (field === 'createdAt') {
        returnValue['_created_at'] = returnValue[field];
        delete returnValue[field];
      } else if (field === 'updatedAt') {
        returnValue['_updated_at'] = returnValue[field];
        delete returnValue[field];
      }
    }
    return returnValue;
  }

  // This function is slightly different than the two above. MongoDB $group aggregate looks like:
  //     { $group: { _id: <expression>, <field1>: { <accumulator1> : <expression1> }, ... } }
  // The <expression> could be a column name, prefixed with the '$' character. We'll look for
  // these <expression> and check to see if it is a 'Pointer' or if it's one of createdAt,
  // updatedAt or objectId and change it accordingly.
  _parseAggregateGroupArgs(schema, pipeline) {
    if (Array.isArray(pipeline)) {
      return pipeline.map(value => this._parseAggregateGroupArgs(schema, value));
    } else if (typeof pipeline === 'object') {
      const returnValue = {};
      for (const field in pipeline) {
        returnValue[field] = this._parseAggregateGroupArgs(schema, pipeline[field]);
      }
      return returnValue;
    } else if (typeof pipeline === 'string') {
      const field = pipeline.substring(1);
      if (schema.fields[field] && schema.fields[field].type === 'Pointer') {
        return `$_p_${field}`;
      } else if (field == 'createdAt') {
        return '$_created_at';
      } else if (field == 'updatedAt') {
        return '$_updated_at';
      }
    }
    return pipeline;
  }

  // This function will attempt to convert the provided value to a Date object. Since this is part
  // of an aggregation pipeline, the value can either be a string or it can be another object with
  // an operator in it (like $gt, $lt, etc). Because of this I felt it was easier to make this a
  // recursive method to traverse down to the "leaf node" which is going to be the string.
  _convertToDate(value) {
    if (typeof value === 'string') {
      return new Date(value);
    }

    const returnValue = {};
    for (const field in value) {
      returnValue[field] = this._convertToDate(value[field]);
    }
    return returnValue;
  }

  _parseReadPreference(readPreference) {
    switch (readPreference) {
      case 'PRIMARY':
        readPreference = ReadPreference.PRIMARY;
        break;
      case 'PRIMARY_PREFERRED':
        readPreference = ReadPreference.PRIMARY_PREFERRED;
        break;
      case 'SECONDARY':
        readPreference = ReadPreference.SECONDARY;
        break;
      case 'SECONDARY_PREFERRED':
        readPreference = ReadPreference.SECONDARY_PREFERRED;
        break;
      case 'NEAREST':
        readPreference = ReadPreference.NEAREST;
        break;
      case undefined:
        break;
      default:
        throw new _node2.default.Error(_node2.default.Error.INVALID_QUERY, 'Not supported read preference.');
    }
    return readPreference;
  }

  performInitialization() {
    return Promise.resolve();
  }

  createIndex(className, index) {
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.createIndex(index, { background: true })).catch(err => this.handleError(err));
  }

  createIndexes(className, indexes) {
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.createIndexes(indexes, { background: true })).catch(err => this.handleError(err));
  }

  createIndexesIfNeeded(className, fieldName, type) {
    if (type && type.type === 'Polygon') {
      const index = {
        [fieldName]: '2dsphere'
      };
      return this.createIndex(className, index);
    }
    return Promise.resolve();
  }

  createTextIndexesIfNeeded(className, query, schema) {
    for (const fieldName in query) {
      if (!query[fieldName] || !query[fieldName].$text) {
        continue;
      }
      const existingIndexes = schema.indexes;
      for (const key in existingIndexes) {
        const index = existingIndexes[key];
        if (index.hasOwnProperty(fieldName)) {
          return Promise.resolve();
        }
      }
      const indexName = `${fieldName}_text`;
      const textIndex = {
        [indexName]: { [fieldName]: 'text' }
      };
      return this.setIndexesWithSchemaFormat(className, textIndex, existingIndexes, schema.fields).catch(error => {
        if (error.code === 85) {
          // Index exist with different options
          return this.setIndexesFromMongo(className);
        }
        throw error;
      });
    }
    return Promise.resolve();
  }

  getIndexes(className) {
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.indexes()).catch(err => this.handleError(err));
  }

  dropIndex(className, index) {
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.dropIndex(index)).catch(err => this.handleError(err));
  }

  dropAllIndexes(className) {
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.dropIndexes()).catch(err => this.handleError(err));
  }

  updateSchemaWithIndexes() {
    return this.getAllClasses().then(classes => {
      const promises = classes.map(schema => {
        return this.setIndexesFromMongo(schema.className);
      });
      return Promise.all(promises);
    }).catch(err => this.handleError(err));
  }
}

exports.MongoStorageAdapter = MongoStorageAdapter;
exports.default = MongoStorageAdapter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9BZGFwdGVycy9TdG9yYWdlL01vbmdvL01vbmdvU3RvcmFnZUFkYXB0ZXIuanMiXSwibmFtZXMiOlsibW9uZ29kYiIsInJlcXVpcmUiLCJNb25nb0NsaWVudCIsIlJlYWRQcmVmZXJlbmNlIiwiTW9uZ29TY2hlbWFDb2xsZWN0aW9uTmFtZSIsInN0b3JhZ2VBZGFwdGVyQWxsQ29sbGVjdGlvbnMiLCJtb25nb0FkYXB0ZXIiLCJjb25uZWN0IiwidGhlbiIsImRhdGFiYXNlIiwiY29sbGVjdGlvbnMiLCJmaWx0ZXIiLCJjb2xsZWN0aW9uIiwibmFtZXNwYWNlIiwibWF0Y2giLCJjb2xsZWN0aW9uTmFtZSIsImluZGV4T2YiLCJfY29sbGVjdGlvblByZWZpeCIsImNvbnZlcnRQYXJzZVNjaGVtYVRvTW9uZ29TY2hlbWEiLCJzY2hlbWEiLCJmaWVsZHMiLCJfcnBlcm0iLCJfd3Blcm0iLCJjbGFzc05hbWUiLCJfaGFzaGVkX3Bhc3N3b3JkIiwibW9uZ29TY2hlbWFGcm9tRmllbGRzQW5kQ2xhc3NOYW1lQW5kQ0xQIiwiY2xhc3NMZXZlbFBlcm1pc3Npb25zIiwiaW5kZXhlcyIsIm1vbmdvT2JqZWN0IiwiX2lkIiwib2JqZWN0SWQiLCJ1cGRhdGVkQXQiLCJjcmVhdGVkQXQiLCJfbWV0YWRhdGEiLCJ1bmRlZmluZWQiLCJmaWVsZE5hbWUiLCJNb25nb1NjaGVtYUNvbGxlY3Rpb24iLCJwYXJzZUZpZWxkVHlwZVRvTW9uZ29GaWVsZFR5cGUiLCJjbGFzc19wZXJtaXNzaW9ucyIsIk9iamVjdCIsImtleXMiLCJsZW5ndGgiLCJNb25nb1N0b3JhZ2VBZGFwdGVyIiwiY29uc3RydWN0b3IiLCJ1cmkiLCJkZWZhdWx0cyIsIkRlZmF1bHRNb25nb1VSSSIsImNvbGxlY3Rpb25QcmVmaXgiLCJtb25nb09wdGlvbnMiLCJfdXJpIiwiX21vbmdvT3B0aW9ucyIsIl9tYXhUaW1lTVMiLCJtYXhUaW1lTVMiLCJjYW5Tb3J0T25Kb2luVGFibGVzIiwiY29ubmVjdGlvblByb21pc2UiLCJlbmNvZGVkVXJpIiwiY2xpZW50Iiwib3B0aW9ucyIsInMiLCJkYiIsImRiTmFtZSIsIm9uIiwiY2F0Y2giLCJlcnIiLCJQcm9taXNlIiwicmVqZWN0IiwiaGFuZGxlRXJyb3IiLCJlcnJvciIsImNvZGUiLCJsb2dnZXIiLCJoYW5kbGVTaHV0ZG93biIsImNsb3NlIiwiX2FkYXB0aXZlQ29sbGVjdGlvbiIsIm5hbWUiLCJyYXdDb2xsZWN0aW9uIiwiTW9uZ29Db2xsZWN0aW9uIiwiX3NjaGVtYUNvbGxlY3Rpb24iLCJjbGFzc0V4aXN0cyIsImxpc3RDb2xsZWN0aW9ucyIsInRvQXJyYXkiLCJzZXRDbGFzc0xldmVsUGVybWlzc2lvbnMiLCJDTFBzIiwic2NoZW1hQ29sbGVjdGlvbiIsInVwZGF0ZVNjaGVtYSIsIiRzZXQiLCJzZXRJbmRleGVzV2l0aFNjaGVtYUZvcm1hdCIsInN1Ym1pdHRlZEluZGV4ZXMiLCJleGlzdGluZ0luZGV4ZXMiLCJyZXNvbHZlIiwiX2lkXyIsImRlbGV0ZVByb21pc2VzIiwiaW5zZXJ0ZWRJbmRleGVzIiwiZm9yRWFjaCIsImZpZWxkIiwiX19vcCIsIlBhcnNlIiwiRXJyb3IiLCJJTlZBTElEX1FVRVJZIiwicHJvbWlzZSIsImRyb3BJbmRleCIsInB1c2giLCJrZXkiLCJoYXNPd25Qcm9wZXJ0eSIsImluc2VydFByb21pc2UiLCJjcmVhdGVJbmRleGVzIiwiYWxsIiwic2V0SW5kZXhlc0Zyb21Nb25nbyIsImdldEluZGV4ZXMiLCJyZWR1Y2UiLCJvYmoiLCJpbmRleCIsIl9mdHMiLCJfZnRzeCIsIndlaWdodHMiLCJjcmVhdGVDbGFzcyIsImluc2VydFNjaGVtYSIsImFkZEZpZWxkSWZOb3RFeGlzdHMiLCJ0eXBlIiwiY3JlYXRlSW5kZXhlc0lmTmVlZGVkIiwiZGVsZXRlQ2xhc3MiLCJkcm9wIiwibWVzc2FnZSIsImZpbmRBbmREZWxldGVTY2hlbWEiLCJkZWxldGVBbGxDbGFzc2VzIiwiZmFzdCIsIm1hcCIsInJlbW92ZSIsImRlbGV0ZUZpZWxkcyIsImZpZWxkTmFtZXMiLCJtb25nb0Zvcm1hdE5hbWVzIiwiY29sbGVjdGlvblVwZGF0ZSIsInNjaGVtYVVwZGF0ZSIsInVwZGF0ZU1hbnkiLCJnZXRBbGxDbGFzc2VzIiwic2NoZW1hc0NvbGxlY3Rpb24iLCJfZmV0Y2hBbGxTY2hlbWFzRnJvbV9TQ0hFTUEiLCJnZXRDbGFzcyIsIl9mZXRjaE9uZVNjaGVtYUZyb21fU0NIRU1BIiwiY3JlYXRlT2JqZWN0Iiwib2JqZWN0IiwiaW5zZXJ0T25lIiwiRFVQTElDQVRFX1ZBTFVFIiwidW5kZXJseWluZ0Vycm9yIiwibWF0Y2hlcyIsIkFycmF5IiwiaXNBcnJheSIsInVzZXJJbmZvIiwiZHVwbGljYXRlZF9maWVsZCIsImRlbGV0ZU9iamVjdHNCeVF1ZXJ5IiwicXVlcnkiLCJtb25nb1doZXJlIiwiZGVsZXRlTWFueSIsInJlc3VsdCIsIm4iLCJPQkpFQ1RfTk9UX0ZPVU5EIiwiSU5URVJOQUxfU0VSVkVSX0VSUk9SIiwidXBkYXRlT2JqZWN0c0J5UXVlcnkiLCJ1cGRhdGUiLCJtb25nb1VwZGF0ZSIsImZpbmRPbmVBbmRVcGRhdGUiLCJfbW9uZ29Db2xsZWN0aW9uIiwiZmluZEFuZE1vZGlmeSIsIm5ldyIsInZhbHVlIiwidXBzZXJ0T25lT2JqZWN0IiwidXBzZXJ0T25lIiwiZmluZCIsInNraXAiLCJsaW1pdCIsInNvcnQiLCJyZWFkUHJlZmVyZW5jZSIsIm1vbmdvU29ydCIsIl8iLCJtYXBLZXlzIiwibW9uZ29LZXlzIiwibWVtbyIsIl9wYXJzZVJlYWRQcmVmZXJlbmNlIiwiY3JlYXRlVGV4dEluZGV4ZXNJZk5lZWRlZCIsIm9iamVjdHMiLCJlbnN1cmVVbmlxdWVuZXNzIiwiaW5kZXhDcmVhdGlvblJlcXVlc3QiLCJtb25nb0ZpZWxkTmFtZXMiLCJfZW5zdXJlU3BhcnNlVW5pcXVlSW5kZXhJbkJhY2tncm91bmQiLCJfcmF3RmluZCIsImNvdW50IiwiZGlzdGluY3QiLCJpc1BvaW50ZXJGaWVsZCIsInN1YnN0cmluZyIsImFnZ3JlZ2F0ZSIsInBpcGVsaW5lIiwic3RhZ2UiLCIkZ3JvdXAiLCJfcGFyc2VBZ2dyZWdhdGVHcm91cEFyZ3MiLCIkbWF0Y2giLCJfcGFyc2VBZ2dyZWdhdGVBcmdzIiwiJHByb2plY3QiLCJfcGFyc2VBZ2dyZWdhdGVQcm9qZWN0QXJncyIsInJlc3VsdHMiLCJzcGxpdCIsImlzRW1wdHkiLCJyZXR1cm5WYWx1ZSIsInRhcmdldENsYXNzIiwiX2NvbnZlcnRUb0RhdGUiLCJEYXRlIiwiUFJJTUFSWSIsIlBSSU1BUllfUFJFRkVSUkVEIiwiU0VDT05EQVJZIiwiU0VDT05EQVJZX1BSRUZFUlJFRCIsIk5FQVJFU1QiLCJwZXJmb3JtSW5pdGlhbGl6YXRpb24iLCJjcmVhdGVJbmRleCIsImJhY2tncm91bmQiLCIkdGV4dCIsImluZGV4TmFtZSIsInRleHRJbmRleCIsImRyb3BBbGxJbmRleGVzIiwiZHJvcEluZGV4ZXMiLCJ1cGRhdGVTY2hlbWFXaXRoSW5kZXhlcyIsImNsYXNzZXMiLCJwcm9taXNlcyJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7QUFLQTs7QUFJQTs7QUFTQTs7OztBQUVBOzs7O0FBQ0E7Ozs7QUFDQTs7Ozs7OztBQUxBOztBQUVBOzs7QUFLQTtBQUNBLE1BQU1BLFVBQVVDLFFBQVEsU0FBUixDQUFoQjtBQUNBLE1BQU1DLGNBQWNGLFFBQVFFLFdBQTVCO0FBQ0EsTUFBTUMsaUJBQWlCSCxRQUFRRyxjQUEvQjs7QUFFQSxNQUFNQyw0QkFBNEIsU0FBbEM7O0FBRUEsTUFBTUMsK0JBQStCQyxnQkFBZ0I7QUFDbkQsU0FBT0EsYUFBYUMsT0FBYixHQUNKQyxJQURJLENBQ0MsTUFBTUYsYUFBYUcsUUFBYixDQUFzQkMsV0FBdEIsRUFEUCxFQUVKRixJQUZJLENBRUNFLGVBQWU7QUFDbkIsV0FBT0EsWUFBWUMsTUFBWixDQUFtQkMsY0FBYztBQUN0QyxVQUFJQSxXQUFXQyxTQUFYLENBQXFCQyxLQUFyQixDQUEyQixZQUEzQixDQUFKLEVBQThDO0FBQzVDLGVBQU8sS0FB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TCxDQUFpQkgsR0FBakIsQ0FGVCxDQUFQO0FBR0Q7O0FBRURvQyxZQUFVNUUsU0FBVixFQUE2QnVGLEtBQTdCLEVBQXlDO0FBQ3ZDLFdBQU8sS0FBS3RDLG1CQUFMLENBQXlCakQsU0FBekIsRUFDSmYsSUFESSxDQUNDSSxjQUFjQSxXQUFXb0osZ0JBQVgsQ0FBNEI3RCxTQUE1QixDQUFzQ1csS0FBdEMsQ0FEZixFQUVKaEQsS0FGSSxDQUVFQyxPQUFPLEtBQUtHLFdBQUwsQ0FBaUJILEdBQWpCLENBRlQsQ0FBUDtBQUdEOztBQUVEd0osaUJBQWVoTSxTQUFmLEVBQWtDO0FBQ2hDLFdBQU8sS0FBS2lELG1CQUFMLENBQXlCakQsU0FBekIsRUFDSmYsSUFESSxDQUNDSSxjQUFjQSxXQUFXb0osZ0JBQVgsQ0FBNEJ3RCxXQUE1QixFQURmLEVBRUoxSixLQUZJLENBRUVDLE9BQU8sS0FBS0csV0FBTCxDQUFpQkgsR0FBakIsQ0FGVCxDQUFQO0FBR0Q7O0FBRUQwSiw0QkFBd0M7QUFDdEMsV0FBTyxLQUFLcEYsYUFBTCxHQUNKN0gsSUFESSxDQUNFa04sT0FBRCxJQUFhO0FBQ2pCLFlBQU1DLFdBQVdELFFBQVE3RixHQUFSLENBQWExRyxNQUFELElBQVk7QUFDdkMsZUFBTyxLQUFLdUYsbUJBQUwsQ0FBeUJ2RixPQUFPSSxTQUFoQyxDQUFQO0FBQ0QsT0FGZ0IsQ0FBakI7QUFHQSxhQUFPeUMsUUFBUXlDLEdBQVIsQ0FBWWtILFFBQVosQ0FBUDtBQUNELEtBTkksRUFPSjdKLEtBUEksQ0FPRUMsT0FBTyxLQUFLRyxXQUFMLENBQWlCSCxHQUFqQixDQVBULENBQVA7QUFRRDtBQXZ0QndEOztRQUE5Q3JCLG1CLEdBQUFBLG1CO2tCQTB0QkVBLG1CIiwiZmlsZSI6Ik1vbmdvU3RvcmFnZUFkYXB0ZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAZmxvd1xuaW1wb3J0IE1vbmdvQ29sbGVjdGlvbiAgICAgICBmcm9tICcuL01vbmdvQ29sbGVjdGlvbic7XG5pbXBvcnQgTW9uZ29TY2hlbWFDb2xsZWN0aW9uIGZyb20gJy4vTW9uZ29TY2hlbWFDb2xsZWN0aW9uJztcbmltcG9ydCB7IFN0b3JhZ2VBZGFwdGVyIH0gICAgZnJvbSAnLi4vU3RvcmFnZUFkYXB0ZXInO1xuaW1wb3J0IHR5cGUgeyBTY2hlbWFUeXBlLFxuICBRdWVyeVR5cGUsXG4gIFN0b3JhZ2VDbGFzcyxcbiAgUXVlcnlPcHRpb25zIH0gZnJvbSAnLi4vU3RvcmFnZUFkYXB0ZXInO1xuaW1wb3J0IHtcbiAgcGFyc2UgYXMgcGFyc2VVcmwsXG4gIGZvcm1hdCBhcyBmb3JtYXRVcmwsXG59IGZyb20gJy4uLy4uLy4uL3ZlbmRvci9tb25nb2RiVXJsJztcbmltcG9ydCB7XG4gIHBhcnNlT2JqZWN0VG9Nb25nb09iamVjdEZvckNyZWF0ZSxcbiAgbW9uZ29PYmplY3RUb1BhcnNlT2JqZWN0LFxuICB0cmFuc2Zvcm1LZXksXG4gIHRyYW5zZm9ybVdoZXJlLFxuICB0cmFuc2Zvcm1VcGRhdGUsXG4gIHRyYW5zZm9ybVBvaW50ZXJTdHJpbmcsXG59IGZyb20gJy4vTW9uZ29UcmFuc2Zvcm0nO1xuLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG5pbXBvcnQgUGFyc2UgICAgICAgICAgICAgICAgIGZyb20gJ3BhcnNlL25vZGUnO1xuLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG5pbXBvcnQgXyAgICAgICAgICAgICAgICAgICAgIGZyb20gJ2xvZGFzaCc7XG5pbXBvcnQgZGVmYXVsdHMgICAgICAgICAgICAgIGZyb20gJy4uLy4uLy4uL2RlZmF1bHRzJztcbmltcG9ydCBsb2dnZXIgICAgICAgICAgICAgICAgZnJvbSAnLi4vLi4vLi4vbG9nZ2VyJztcblxuLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG5jb25zdCBtb25nb2RiID0gcmVxdWlyZSgnbW9uZ29kYicpO1xuY29uc3QgTW9uZ29DbGllbnQgPSBtb25nb2RiLk1vbmdvQ2xpZW50O1xuY29uc3QgUmVhZFByZWZlcmVuY2UgPSBtb25nb2RiLlJlYWRQcmVmZXJlbmNlO1xuXG5jb25zdCBNb25nb1NjaGVtYUNvbGxlY3Rpb25OYW1lID0gJ19TQ0hFTUEnO1xuXG5jb25zdCBzdG9yYWdlQWRhcHRlckFsbENvbGxlY3Rpb25zID0gbW9uZ29BZGFwdGVyID0+IHtcbiAgcmV0dXJuIG1vbmdvQWRhcHRlci5jb25uZWN0KClcbiAgICAudGhlbigoKSA9PiBtb25nb0FkYXB0ZXIuZGF0YWJhc2UuY29sbGVjdGlvbnMoKSlcbiAgICAudGhlbihjb2xsZWN0aW9ucyA9PiB7XG4gICAgICByZXR1cm4gY29sbGVjdGlvbnMuZmlsdGVyKGNvbGxlY3Rpb24gPT4ge1xuICAgICAgICBpZiAoY29sbGVjdGlvbi5uYW1lc3BhY2UubWF0Y2goL1xcLnN5c3RlbVxcLi8pKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIC8vIFRPRE86IElmIHlvdSBoYXZlIG9uZSBhcHAgd2l0aCBhIGNvbGxlY3Rpb24gcHJlZml4IHRoYXQgaGFwcGVucyB0byBiZSBhIHByZWZpeCBvZiBhbm90aGVyXG4gICAgICAgIC8vIGFwcHMgcHJlZml4LCB0aGlzIHdpbGwgZ28gdmVyeSB2ZXJ5IGJhZGx5LiBXZSBzaG91bGQgZml4IHRoYXQgc29tZWhvdy5cbiAgICAgICAgcmV0dXJuIChjb2xsZWN0aW9uLmNvbGxlY3Rpb25OYW1lLmluZGV4T2YobW9uZ29BZGFwdGVyLl9jb2xsZWN0aW9uUHJlZml4KSA9PSAwKTtcbiAgICAgIH0pO1xuICAgIH0pO1xufVxuXG5jb25zdCBjb252ZXJ0UGFyc2VTY2hlbWFUb01vbmdvU2NoZW1hID0gKHsuLi5zY2hlbWF9KSA9PiB7XG4gIGRlbGV0ZSBzY2hlbWEuZmllbGRzLl9ycGVybTtcbiAgZGVsZXRlIHNjaGVtYS5maWVsZHMuX3dwZXJtO1xuXG4gIGlmIChzY2hlbWEuY2xhc3NOYW1lID09PSAnX1VzZXInKSB7XG4gICAgLy8gTGVnYWN5IG1vbmdvIGFkYXB0ZXIga25vd3MgYWJvdXQgdGhlIGRpZmZlcmVuY2UgYmV0d2VlbiBwYXNzd29yZCBhbmQgX2hhc2hlZF9wYXNzd29yZC5cbiAgICAvLyBGdXR1cmUgZGF0YWJhc2UgYWRhcHRlcnMgd2lsbCBvbmx5IGtub3cgYWJvdXQgX2hhc2hlZF9wYXNzd29yZC5cbiAgICAvLyBOb3RlOiBQYXJzZSBTZXJ2ZXIgd2lsbCBicmluZyBiYWNrIHBhc3N3b3JkIHdpdGggaW5qZWN0RGVmYXVsdFNjaGVtYSwgc28gd2UgZG9uJ3QgbmVlZFxuICAgIC8vIHRvIGFkZCBfaGFzaGVkX3Bhc3N3b3JkIGJhY2sgZXZlci5cbiAgICBkZWxldGUgc2NoZW1hLmZpZWxkcy5faGFzaGVkX3Bhc3N3b3JkO1xuICB9XG5cbiAgcmV0dXJuIHNjaGVtYTtcbn1cblxuLy8gUmV0dXJucyB7IGNvZGUsIGVycm9yIH0gaWYgaW52YWxpZCwgb3IgeyByZXN1bHQgfSwgYW4gb2JqZWN0XG4vLyBzdWl0YWJsZSBmb3IgaW5zZXJ0aW5nIGludG8gX1NDSEVNQSBjb2xsZWN0aW9uLCBvdGhlcndpc2UuXG5jb25zdCBtb25nb1NjaGVtYUZyb21GaWVsZHNBbmRDbGFzc05hbWVBbmRDTFAgPSAoZmllbGRzLCBjbGFzc05hbWUsIGNsYXNzTGV2ZWxQZXJtaXNzaW9ucywgaW5kZXhlcykgPT4ge1xuICBjb25zdCBtb25nb09iamVjdCA9IHtcbiAgICBfaWQ6IGNsYXNzTmFtZSxcbiAgICBvYmplY3RJZDogJ3N0cmluZycsXG4gICAgdXBkYXRlZEF0OiAnc3RyaW5nJyxcbiAgICBjcmVhdGVkQXQ6ICdzdHJpbmcnLFxuICAgIF9tZXRhZGF0YTogdW5kZWZpbmVkLFxuICB9O1xuXG4gIGZvciAoY29uc3QgZmllbGROYW1lIGluIGZpZWxkcykge1xuICAgIG1vbmdvT2JqZWN0W2ZpZWxkTmFtZV0gPSBNb25nb1NjaGVtYUNvbGxlY3Rpb24ucGFyc2VGaWVsZFR5cGVUb01vbmdvRmllbGRUeXBlKGZpZWxkc1tmaWVsZE5hbWVdKTtcbiAgfVxuXG4gIGlmICh0eXBlb2YgY2xhc3NMZXZlbFBlcm1pc3Npb25zICE9PSAndW5kZWZpbmVkJykge1xuICAgIG1vbmdvT2JqZWN0Ll9tZXRhZGF0YSA9IG1vbmdvT2JqZWN0Ll9tZXRhZGF0YSB8fCB7fTtcbiAgICBpZiAoIWNsYXNzTGV2ZWxQZXJtaXNzaW9ucykge1xuICAgICAgZGVsZXRlIG1vbmdvT2JqZWN0Ll9tZXRhZGF0YS5jbGFzc19wZXJtaXNzaW9ucztcbiAgICB9IGVsc2Uge1xuICAgICAgbW9uZ29PYmplY3QuX21ldGFkYXRhLmNsYXNzX3Blcm1pc3Npb25zID0gY2xhc3NMZXZlbFBlcm1pc3Npb25zO1xuICAgIH1cbiAgfVxuXG4gIGlmIChpbmRleGVzICYmIHR5cGVvZiBpbmRleGVzID09PSAnb2JqZWN0JyAmJiBPYmplY3Qua2V5cyhpbmRleGVzKS5sZW5ndGggPiAwKSB7XG4gICAgbW9uZ29PYmplY3QuX21ldGFkYXRhID0gbW9uZ29PYmplY3QuX21ldGFkYXRhIHx8IHt9O1xuICAgIG1vbmdvT2JqZWN0Ll9tZXRhZGF0YS5pbmRleGVzID0gaW5kZXhlcztcbiAgfVxuXG4gIGlmICghbW9uZ29PYmplY3QuX21ldGFkYXRhKSB7IC8vIGNsZWFudXAgdGhlIHVudXNlZCBfbWV0YWRhdGFcbiAgICBkZWxldGUgbW9uZ29PYmplY3QuX21ldGFkYXRhO1xuICB9XG5cbiAgcmV0dXJuIG1vbmdvT2JqZWN0O1xufVxuXG5cbmV4cG9ydCBjbGFzcyBNb25nb1N0b3JhZ2VBZGFwdGVyIGltcGxlbWVudHMgU3RvcmFnZUFkYXB0ZXIge1xuICAvLyBQcml2YXRlXG4gIF91cmk6IHN0cmluZztcbiAgX2NvbGxlY3Rpb25QcmVmaXg6IHN0cmluZztcbiAgX21vbmdvT3B0aW9uczogT2JqZWN0O1xuICAvLyBQdWJsaWNcbiAgY29ubmVjdGlvblByb21pc2U6IFByb21pc2U8YW55PjtcbiAgZGF0YWJhc2U6IGFueTtcbiAgY2xpZW50OiBNb25nb0NsaWVudDtcbiAgX21heFRpbWVNUzogP251bWJlcjtcbiAgY2FuU29ydE9uSm9pblRhYmxlczogYm9vbGVhbjtcblxuICBjb25zdHJ1Y3Rvcih7XG4gICAgdXJpID0gZGVmYXVsdHMuRGVmYXVsdE1vbmdvVVJJLFxuICAgIGNvbGxlY3Rpb25QcmVmaXggPSAnJyxcbiAgICBtb25nb09wdGlvbnMgPSB7fSxcbiAgfTogYW55KSB7XG4gICAgdGhpcy5fdXJpID0gdXJpO1xuICAgIHRoaXMuX2NvbGxlY3Rpb25QcmVmaXggPSBjb2xsZWN0aW9uUHJlZml4O1xuICAgIHRoaXMuX21vbmdvT3B0aW9ucyA9IG1vbmdvT3B0aW9ucztcblxuICAgIC8vIE1heFRpbWVNUyBpcyBub3QgYSBnbG9iYWwgTW9uZ29EQiBjbGllbnQgb3B0aW9uLCBpdCBpcyBhcHBsaWVkIHBlciBvcGVyYXRpb24uXG4gICAgdGhpcy5fbWF4VGltZU1TID0gbW9uZ29PcHRpb25zLm1heFRpbWVNUztcbiAgICB0aGlzLmNhblNvcnRPbkpvaW5UYWJsZXMgPSB0cnVlO1xuICAgIGRlbGV0ZSBtb25nb09wdGlvbnMubWF4VGltZU1TO1xuICB9XG5cbiAgY29ubmVjdCgpIHtcbiAgICBpZiAodGhpcy5jb25uZWN0aW9uUHJvbWlzZSkge1xuICAgICAgcmV0dXJuIHRoaXMuY29ubmVjdGlvblByb21pc2U7XG4gICAgfVxuXG4gICAgLy8gcGFyc2luZyBhbmQgcmUtZm9ybWF0dGluZyBjYXVzZXMgdGhlIGF1dGggdmFsdWUgKGlmIHRoZXJlKSB0byBnZXQgVVJJXG4gICAgLy8gZW5jb2RlZFxuICAgIGNvbnN0IGVuY29kZWRVcmkgPSBmb3JtYXRVcmwocGFyc2VVcmwodGhpcy5fdXJpKSk7XG5cbiAgICB0aGlzLmNvbm5lY3Rpb25Qcm9taXNlID0gTW9uZ29DbGllbnQuY29ubmVjdChlbmNvZGVkVXJpLCB0aGlzLl9tb25nb09wdGlvbnMpLnRoZW4oY2xpZW50ID0+IHtcbiAgICAgIC8vIFN0YXJ0aW5nIG1vbmdvREIgMy4wLCB0aGUgTW9uZ29DbGllbnQuY29ubmVjdCBkb24ndCByZXR1cm4gYSBEQiBhbnltb3JlIGJ1dCBhIGNsaWVudFxuICAgICAgLy8gRm9ydHVuYXRlbHksIHdlIGNhbiBnZXQgYmFjayB0aGUgb3B0aW9ucyBhbmQgdXNlIHRoZW0gdG8gc2VsZWN0IHRoZSBwcm9wZXIgREIuXG4gICAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vbW9uZ29kYi9ub2RlLW1vbmdvZGItbmF0aXZlL2Jsb2IvMmMzNWQ3NmYwODU3NDIyNWI4ZGIwMmQ3YmVmNjg3MTIzZTZiYjAxOC9saWIvbW9uZ29fY2xpZW50LmpzI0w4ODVcbiAgICAgIGNvbnN0IG9wdGlvbnMgPSBjbGllbnQucy5vcHRpb25zO1xuICAgICAgY29uc3QgZGF0YWJhc2UgPSBjbGllbnQuZGIob3B0aW9ucy5kYk5hbWUpO1xuICAgICAgaWYgKCFkYXRhYmFzZSkge1xuICAgICAgICBkZWxldGUgdGhpcy5jb25uZWN0aW9uUHJvbWlzZTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgZGF0YWJhc2Uub24oJ2Vycm9yJywgKCkgPT4ge1xuICAgICAgICBkZWxldGUgdGhpcy5jb25uZWN0aW9uUHJvbWlzZTtcbiAgICAgIH0pO1xuICAgICAgZGF0YWJhc2Uub24oJ2Nsb3NlJywgKCkgPT4ge1xuICAgICAgICBkZWxldGUgdGhpcy5jb25uZWN0aW9uUHJvbWlzZTtcbiAgICAgIH0pO1xuICAgICAgdGhpcy5jbGllbnQgPSBjbGllbnQ7XG4gICAgICB0aGlzLmRhdGFiYXNlID0gZGF0YWJhc2U7XG4gICAgfSkuY2F0Y2goKGVycikgPT4ge1xuICAgICAgZGVsZXRlIHRoaXMuY29ubmVjdGlvblByb21pc2U7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QoZXJyKTtcbiAgICB9KTtcblxuICAgIHJldHVybiB0aGlzLmNvbm5lY3Rpb25Qcm9taXNlO1xuICB9XG5cbiAgaGFuZGxlRXJyb3I8VD4oZXJyb3I6ID8oRXJyb3IgfCBQYXJzZS5FcnJvcikpOiBQcm9taXNlPFQ+IHtcbiAgICBpZiAoZXJyb3IgJiYgZXJyb3IuY29kZSA9PT0gMTMpIHsgLy8gVW5hdXRob3JpemVkIGVycm9yXG4gICAgICBkZWxldGUgdGhpcy5jbGllbnQ7XG4gICAgICBkZWxldGUgdGhpcy5kYXRhYmFzZTtcbiAgICAgIGRlbGV0ZSB0aGlzLmNvbm5lY3Rpb25Qcm9taXNlO1xuICAgICAgbG9nZ2VyLmVycm9yKCdSZWNlaXZlZCB1bmF1dGhvcml6ZWQgZXJyb3InLCB7IGVycm9yOiBlcnJvciB9KTtcbiAgICB9XG4gICAgdGhyb3cgZXJyb3I7XG4gIH1cblxuICBoYW5kbGVTaHV0ZG93bigpIHtcbiAgICBpZiAoIXRoaXMuY2xpZW50KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuY2xpZW50LmNsb3NlKGZhbHNlKTtcbiAgfVxuXG4gIF9hZGFwdGl2ZUNvbGxlY3Rpb24obmFtZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHRoaXMuY29ubmVjdCgpXG4gICAgICAudGhlbigoKSA9PiB0aGlzLmRhdGFiYXNlLmNvbGxlY3Rpb24odGhpcy5fY29sbGVjdGlvblByZWZpeCArIG5hbWUpKVxuICAgICAgLnRoZW4ocmF3Q29sbGVjdGlvbiA9PiBuZXcgTW9uZ29Db2xsZWN0aW9uKHJhd0NvbGxlY3Rpb24pKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgX3NjaGVtYUNvbGxlY3Rpb24oKTogUHJvbWlzZTxNb25nb1NjaGVtYUNvbGxlY3Rpb24+IHtcbiAgICByZXR1cm4gdGhpcy5jb25uZWN0KClcbiAgICAgIC50aGVuKCgpID0+IHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihNb25nb1NjaGVtYUNvbGxlY3Rpb25OYW1lKSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gbmV3IE1vbmdvU2NoZW1hQ29sbGVjdGlvbihjb2xsZWN0aW9uKSk7XG4gIH1cblxuICBjbGFzc0V4aXN0cyhuYW1lOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5jb25uZWN0KCkudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5kYXRhYmFzZS5saXN0Q29sbGVjdGlvbnMoeyBuYW1lOiB0aGlzLl9jb2xsZWN0aW9uUHJlZml4ICsgbmFtZSB9KS50b0FycmF5KCk7XG4gICAgfSkudGhlbihjb2xsZWN0aW9ucyA9PiB7XG4gICAgICByZXR1cm4gY29sbGVjdGlvbnMubGVuZ3RoID4gMDtcbiAgICB9KS5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIHNldENsYXNzTGV2ZWxQZXJtaXNzaW9ucyhjbGFzc05hbWU6IHN0cmluZywgQ0xQczogYW55KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIHRoaXMuX3NjaGVtYUNvbGxlY3Rpb24oKVxuICAgICAgLnRoZW4oc2NoZW1hQ29sbGVjdGlvbiA9PiBzY2hlbWFDb2xsZWN0aW9uLnVwZGF0ZVNjaGVtYShjbGFzc05hbWUsIHtcbiAgICAgICAgJHNldDogeyAnX21ldGFkYXRhLmNsYXNzX3Blcm1pc3Npb25zJzogQ0xQcyB9XG4gICAgICB9KSkuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICBzZXRJbmRleGVzV2l0aFNjaGVtYUZvcm1hdChjbGFzc05hbWU6IHN0cmluZywgc3VibWl0dGVkSW5kZXhlczogYW55LCBleGlzdGluZ0luZGV4ZXM6IGFueSA9IHt9LCBmaWVsZHM6IGFueSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChzdWJtaXR0ZWRJbmRleGVzID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG4gICAgaWYgKE9iamVjdC5rZXlzKGV4aXN0aW5nSW5kZXhlcykubGVuZ3RoID09PSAwKSB7XG4gICAgICBleGlzdGluZ0luZGV4ZXMgPSB7IF9pZF86IHsgX2lkOiAxfSB9O1xuICAgIH1cbiAgICBjb25zdCBkZWxldGVQcm9taXNlcyA9IFtdO1xuICAgIGNvbnN0IGluc2VydGVkSW5kZXhlcyA9IFtdO1xuICAgIE9iamVjdC5rZXlzKHN1Ym1pdHRlZEluZGV4ZXMpLmZvckVhY2gobmFtZSA9PiB7XG4gICAgICBjb25zdCBmaWVsZCA9IHN1Ym1pdHRlZEluZGV4ZXNbbmFtZV07XG4gICAgICBpZiAoZXhpc3RpbmdJbmRleGVzW25hbWVdICYmIGZpZWxkLl9fb3AgIT09ICdEZWxldGUnKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLCBgSW5kZXggJHtuYW1lfSBleGlzdHMsIGNhbm5vdCB1cGRhdGUuYCk7XG4gICAgICB9XG4gICAgICBpZiAoIWV4aXN0aW5nSW5kZXhlc1tuYW1lXSAmJiBmaWVsZC5fX29wID09PSAnRGVsZXRlJykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSwgYEluZGV4ICR7bmFtZX0gZG9lcyBub3QgZXhpc3QsIGNhbm5vdCBkZWxldGUuYCk7XG4gICAgICB9XG4gICAgICBpZiAoZmllbGQuX19vcCA9PT0gJ0RlbGV0ZScpIHtcbiAgICAgICAgY29uc3QgcHJvbWlzZSA9IHRoaXMuZHJvcEluZGV4KGNsYXNzTmFtZSwgbmFtZSk7XG4gICAgICAgIGRlbGV0ZVByb21pc2VzLnB1c2gocHJvbWlzZSk7XG4gICAgICAgIGRlbGV0ZSBleGlzdGluZ0luZGV4ZXNbbmFtZV07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBPYmplY3Qua2V5cyhmaWVsZCkuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgICAgIGlmICghZmllbGRzLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLCBgRmllbGQgJHtrZXl9IGRvZXMgbm90IGV4aXN0LCBjYW5ub3QgYWRkIGluZGV4LmApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGV4aXN0aW5nSW5kZXhlc1tuYW1lXSA9IGZpZWxkO1xuICAgICAgICBpbnNlcnRlZEluZGV4ZXMucHVzaCh7XG4gICAgICAgICAga2V5OiBmaWVsZCxcbiAgICAgICAgICBuYW1lLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBsZXQgaW5zZXJ0UHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xuICAgIGlmIChpbnNlcnRlZEluZGV4ZXMubGVuZ3RoID4gMCkge1xuICAgICAgaW5zZXJ0UHJvbWlzZSA9IHRoaXMuY3JlYXRlSW5kZXhlcyhjbGFzc05hbWUsIGluc2VydGVkSW5kZXhlcyk7XG4gICAgfVxuICAgIHJldHVybiBQcm9taXNlLmFsbChkZWxldGVQcm9taXNlcylcbiAgICAgIC50aGVuKCgpID0+IGluc2VydFByb21pc2UpXG4gICAgICAudGhlbigoKSA9PiB0aGlzLl9zY2hlbWFDb2xsZWN0aW9uKCkpXG4gICAgICAudGhlbihzY2hlbWFDb2xsZWN0aW9uID0+IHNjaGVtYUNvbGxlY3Rpb24udXBkYXRlU2NoZW1hKGNsYXNzTmFtZSwge1xuICAgICAgICAkc2V0OiB7ICdfbWV0YWRhdGEuaW5kZXhlcyc6ICBleGlzdGluZ0luZGV4ZXMgfVxuICAgICAgfSkpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICBzZXRJbmRleGVzRnJvbU1vbmdvKGNsYXNzTmFtZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0SW5kZXhlcyhjbGFzc05hbWUpLnRoZW4oKGluZGV4ZXMpID0+IHtcbiAgICAgIGluZGV4ZXMgPSBpbmRleGVzLnJlZHVjZSgob2JqLCBpbmRleCkgPT4ge1xuICAgICAgICBpZiAoaW5kZXgua2V5Ll9mdHMpIHtcbiAgICAgICAgICBkZWxldGUgaW5kZXgua2V5Ll9mdHM7XG4gICAgICAgICAgZGVsZXRlIGluZGV4LmtleS5fZnRzeDtcbiAgICAgICAgICBmb3IgKGNvbnN0IGZpZWxkIGluIGluZGV4LndlaWdodHMpIHtcbiAgICAgICAgICAgIGluZGV4LmtleVtmaWVsZF0gPSAndGV4dCc7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIG9ialtpbmRleC5uYW1lXSA9IGluZGV4LmtleTtcbiAgICAgICAgcmV0dXJuIG9iajtcbiAgICAgIH0sIHt9KTtcbiAgICAgIHJldHVybiB0aGlzLl9zY2hlbWFDb2xsZWN0aW9uKClcbiAgICAgICAgLnRoZW4oc2NoZW1hQ29sbGVjdGlvbiA9PiBzY2hlbWFDb2xsZWN0aW9uLnVwZGF0ZVNjaGVtYShjbGFzc05hbWUsIHtcbiAgICAgICAgICAkc2V0OiB7ICdfbWV0YWRhdGEuaW5kZXhlcyc6IGluZGV4ZXMgfVxuICAgICAgICB9KSk7XG4gICAgfSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKVxuICAgICAgLmNhdGNoKCgpID0+IHtcbiAgICAgICAgLy8gSWdub3JlIGlmIGNvbGxlY3Rpb24gbm90IGZvdW5kXG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgIH0pO1xuICB9XG5cbiAgY3JlYXRlQ2xhc3MoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSk6IFByb21pc2U8dm9pZD4ge1xuICAgIHNjaGVtYSA9IGNvbnZlcnRQYXJzZVNjaGVtYVRvTW9uZ29TY2hlbWEoc2NoZW1hKTtcbiAgICBjb25zdCBtb25nb09iamVjdCA9IG1vbmdvU2NoZW1hRnJvbUZpZWxkc0FuZENsYXNzTmFtZUFuZENMUChzY2hlbWEuZmllbGRzLCBjbGFzc05hbWUsIHNjaGVtYS5jbGFzc0xldmVsUGVybWlzc2lvbnMsIHNjaGVtYS5pbmRleGVzKTtcbiAgICBtb25nb09iamVjdC5faWQgPSBjbGFzc05hbWU7XG4gICAgcmV0dXJuIHRoaXMuc2V0SW5kZXhlc1dpdGhTY2hlbWFGb3JtYXQoY2xhc3NOYW1lLCBzY2hlbWEuaW5kZXhlcywge30sIHNjaGVtYS5maWVsZHMpXG4gICAgICAudGhlbigoKSA9PiB0aGlzLl9zY2hlbWFDb2xsZWN0aW9uKCkpXG4gICAgICAudGhlbihzY2hlbWFDb2xsZWN0aW9uID0+IHNjaGVtYUNvbGxlY3Rpb24uaW5zZXJ0U2NoZW1hKG1vbmdvT2JqZWN0KSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIGFkZEZpZWxkSWZOb3RFeGlzdHMoY2xhc3NOYW1lOiBzdHJpbmcsIGZpZWxkTmFtZTogc3RyaW5nLCB0eXBlOiBhbnkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gdGhpcy5fc2NoZW1hQ29sbGVjdGlvbigpXG4gICAgICAudGhlbihzY2hlbWFDb2xsZWN0aW9uID0+IHNjaGVtYUNvbGxlY3Rpb24uYWRkRmllbGRJZk5vdEV4aXN0cyhjbGFzc05hbWUsIGZpZWxkTmFtZSwgdHlwZSkpXG4gICAgICAudGhlbigoKSA9PiB0aGlzLmNyZWF0ZUluZGV4ZXNJZk5lZWRlZChjbGFzc05hbWUsIGZpZWxkTmFtZSwgdHlwZSkpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICAvLyBEcm9wcyBhIGNvbGxlY3Rpb24uIFJlc29sdmVzIHdpdGggdHJ1ZSBpZiBpdCB3YXMgYSBQYXJzZSBTY2hlbWEgKGVnLiBfVXNlciwgQ3VzdG9tLCBldGMuKVxuICAvLyBhbmQgcmVzb2x2ZXMgd2l0aCBmYWxzZSBpZiBpdCB3YXNuJ3QgKGVnLiBhIGpvaW4gdGFibGUpLiBSZWplY3RzIGlmIGRlbGV0aW9uIHdhcyBpbXBvc3NpYmxlLlxuICBkZWxldGVDbGFzcyhjbGFzc05hbWU6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLmRyb3AoKSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAvLyAnbnMgbm90IGZvdW5kJyBtZWFucyBjb2xsZWN0aW9uIHdhcyBhbHJlYWR5IGdvbmUuIElnbm9yZSBkZWxldGlvbiBhdHRlbXB0LlxuICAgICAgICBpZiAoZXJyb3IubWVzc2FnZSA9PSAnbnMgbm90IGZvdW5kJykge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH0pXG4gICAgLy8gV2UndmUgZHJvcHBlZCB0aGUgY29sbGVjdGlvbiwgbm93IHJlbW92ZSB0aGUgX1NDSEVNQSBkb2N1bWVudFxuICAgICAgLnRoZW4oKCkgPT4gdGhpcy5fc2NoZW1hQ29sbGVjdGlvbigpKVxuICAgICAgLnRoZW4oc2NoZW1hQ29sbGVjdGlvbiA9PiBzY2hlbWFDb2xsZWN0aW9uLmZpbmRBbmREZWxldGVTY2hlbWEoY2xhc3NOYW1lKSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIGRlbGV0ZUFsbENsYXNzZXMoZmFzdDogYm9vbGVhbikge1xuICAgIHJldHVybiBzdG9yYWdlQWRhcHRlckFsbENvbGxlY3Rpb25zKHRoaXMpXG4gICAgICAudGhlbihjb2xsZWN0aW9ucyA9PiBQcm9taXNlLmFsbChjb2xsZWN0aW9ucy5tYXAoY29sbGVjdGlvbiA9PiBmYXN0ID8gY29sbGVjdGlvbi5yZW1vdmUoe30pIDogY29sbGVjdGlvbi5kcm9wKCkpKSk7XG4gIH1cblxuICAvLyBSZW1vdmUgdGhlIGNvbHVtbiBhbmQgYWxsIHRoZSBkYXRhLiBGb3IgUmVsYXRpb25zLCB0aGUgX0pvaW4gY29sbGVjdGlvbiBpcyBoYW5kbGVkXG4gIC8vIHNwZWNpYWxseSwgdGhpcyBmdW5jdGlvbiBkb2VzIG5vdCBkZWxldGUgX0pvaW4gY29sdW1ucy4gSXQgc2hvdWxkLCBob3dldmVyLCBpbmRpY2F0ZVxuICAvLyB0aGF0IHRoZSByZWxhdGlvbiBmaWVsZHMgZG9lcyBub3QgZXhpc3QgYW55bW9yZS4gSW4gbW9uZ28sIHRoaXMgbWVhbnMgcmVtb3ZpbmcgaXQgZnJvbVxuICAvLyB0aGUgX1NDSEVNQSBjb2xsZWN0aW9uLiAgVGhlcmUgc2hvdWxkIGJlIG5vIGFjdHVhbCBkYXRhIGluIHRoZSBjb2xsZWN0aW9uIHVuZGVyIHRoZSBzYW1lIG5hbWVcbiAgLy8gYXMgdGhlIHJlbGF0aW9uIGNvbHVtbiwgc28gaXQncyBmaW5lIHRvIGF0dGVtcHQgdG8gZGVsZXRlIGl0LiBJZiB0aGUgZmllbGRzIGxpc3RlZCB0byBiZVxuICAvLyBkZWxldGVkIGRvIG5vdCBleGlzdCwgdGhpcyBmdW5jdGlvbiBzaG91bGQgcmV0dXJuIHN1Y2Nlc3NmdWxseSBhbnl3YXlzLiBDaGVja2luZyBmb3JcbiAgLy8gYXR0ZW1wdHMgdG8gZGVsZXRlIG5vbi1leGlzdGVudCBmaWVsZHMgaXMgdGhlIHJlc3BvbnNpYmlsaXR5IG9mIFBhcnNlIFNlcnZlci5cblxuICAvLyBQb2ludGVyIGZpZWxkIG5hbWVzIGFyZSBwYXNzZWQgZm9yIGxlZ2FjeSByZWFzb25zOiB0aGUgb3JpZ2luYWwgbW9uZ29cbiAgLy8gZm9ybWF0IHN0b3JlZCBwb2ludGVyIGZpZWxkIG5hbWVzIGRpZmZlcmVudGx5IGluIHRoZSBkYXRhYmFzZSwgYW5kIHRoZXJlZm9yZVxuICAvLyBuZWVkZWQgdG8ga25vdyB0aGUgdHlwZSBvZiB0aGUgZmllbGQgYmVmb3JlIGl0IGNvdWxkIGRlbGV0ZSBpdC4gRnV0dXJlIGRhdGFiYXNlXG4gIC8vIGFkYXB0ZXJzIHNob3VsZCBpZ25vcmUgdGhlIHBvaW50ZXJGaWVsZE5hbWVzIGFyZ3VtZW50LiBBbGwgdGhlIGZpZWxkIG5hbWVzIGFyZSBpblxuICAvLyBmaWVsZE5hbWVzLCB0aGV5IHNob3cgdXAgYWRkaXRpb25hbGx5IGluIHRoZSBwb2ludGVyRmllbGROYW1lcyBkYXRhYmFzZSBmb3IgdXNlXG4gIC8vIGJ5IHRoZSBtb25nbyBhZGFwdGVyLCB3aGljaCBkZWFscyB3aXRoIHRoZSBsZWdhY3kgbW9uZ28gZm9ybWF0LlxuXG4gIC8vIFRoaXMgZnVuY3Rpb24gaXMgbm90IG9ibGlnYXRlZCB0byBkZWxldGUgZmllbGRzIGF0b21pY2FsbHkuIEl0IGlzIGdpdmVuIHRoZSBmaWVsZFxuICAvLyBuYW1lcyBpbiBhIGxpc3Qgc28gdGhhdCBkYXRhYmFzZXMgdGhhdCBhcmUgY2FwYWJsZSBvZiBkZWxldGluZyBmaWVsZHMgYXRvbWljYWxseVxuICAvLyBtYXkgZG8gc28uXG5cbiAgLy8gUmV0dXJucyBhIFByb21pc2UuXG4gIGRlbGV0ZUZpZWxkcyhjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBmaWVsZE5hbWVzOiBzdHJpbmdbXSkge1xuICAgIGNvbnN0IG1vbmdvRm9ybWF0TmFtZXMgPSBmaWVsZE5hbWVzLm1hcChmaWVsZE5hbWUgPT4ge1xuICAgICAgaWYgKHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09PSAnUG9pbnRlcicpIHtcbiAgICAgICAgcmV0dXJuIGBfcF8ke2ZpZWxkTmFtZX1gXG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gZmllbGROYW1lO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGNvbnN0IGNvbGxlY3Rpb25VcGRhdGUgPSB7ICckdW5zZXQnIDoge30gfTtcbiAgICBtb25nb0Zvcm1hdE5hbWVzLmZvckVhY2gobmFtZSA9PiB7XG4gICAgICBjb2xsZWN0aW9uVXBkYXRlWyckdW5zZXQnXVtuYW1lXSA9IG51bGw7XG4gICAgfSk7XG5cbiAgICBjb25zdCBzY2hlbWFVcGRhdGUgPSB7ICckdW5zZXQnIDoge30gfTtcbiAgICBmaWVsZE5hbWVzLmZvckVhY2gobmFtZSA9PiB7XG4gICAgICBzY2hlbWFVcGRhdGVbJyR1bnNldCddW25hbWVdID0gbnVsbDtcbiAgICB9KTtcblxuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLnVwZGF0ZU1hbnkoe30sIGNvbGxlY3Rpb25VcGRhdGUpKVxuICAgICAgLnRoZW4oKCkgPT4gdGhpcy5fc2NoZW1hQ29sbGVjdGlvbigpKVxuICAgICAgLnRoZW4oc2NoZW1hQ29sbGVjdGlvbiA9PiBzY2hlbWFDb2xsZWN0aW9uLnVwZGF0ZVNjaGVtYShjbGFzc05hbWUsIHNjaGVtYVVwZGF0ZSkpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICAvLyBSZXR1cm4gYSBwcm9taXNlIGZvciBhbGwgc2NoZW1hcyBrbm93biB0byB0aGlzIGFkYXB0ZXIsIGluIFBhcnNlIGZvcm1hdC4gSW4gY2FzZSB0aGVcbiAgLy8gc2NoZW1hcyBjYW5ub3QgYmUgcmV0cmlldmVkLCByZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHJlamVjdHMuIFJlcXVpcmVtZW50cyBmb3IgdGhlXG4gIC8vIHJlamVjdGlvbiByZWFzb24gYXJlIFRCRC5cbiAgZ2V0QWxsQ2xhc3NlcygpOiBQcm9taXNlPFN0b3JhZ2VDbGFzc1tdPiB7XG4gICAgcmV0dXJuIHRoaXMuX3NjaGVtYUNvbGxlY3Rpb24oKS50aGVuKHNjaGVtYXNDb2xsZWN0aW9uID0+IHNjaGVtYXNDb2xsZWN0aW9uLl9mZXRjaEFsbFNjaGVtYXNGcm9tX1NDSEVNQSgpKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgLy8gUmV0dXJuIGEgcHJvbWlzZSBmb3IgdGhlIHNjaGVtYSB3aXRoIHRoZSBnaXZlbiBuYW1lLCBpbiBQYXJzZSBmb3JtYXQuIElmXG4gIC8vIHRoaXMgYWRhcHRlciBkb2Vzbid0IGtub3cgYWJvdXQgdGhlIHNjaGVtYSwgcmV0dXJuIGEgcHJvbWlzZSB0aGF0IHJlamVjdHMgd2l0aFxuICAvLyB1bmRlZmluZWQgYXMgdGhlIHJlYXNvbi5cbiAgZ2V0Q2xhc3MoY2xhc3NOYW1lOiBzdHJpbmcpOiBQcm9taXNlPFN0b3JhZ2VDbGFzcz4ge1xuICAgIHJldHVybiB0aGlzLl9zY2hlbWFDb2xsZWN0aW9uKClcbiAgICAgIC50aGVuKHNjaGVtYXNDb2xsZWN0aW9uID0+IHNjaGVtYXNDb2xsZWN0aW9uLl9mZXRjaE9uZVNjaGVtYUZyb21fU0NIRU1BKGNsYXNzTmFtZSkpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICAvLyBUT0RPOiBBcyB5ZXQgbm90IHBhcnRpY3VsYXJseSB3ZWxsIHNwZWNpZmllZC4gQ3JlYXRlcyBhbiBvYmplY3QuIE1heWJlIHNob3VsZG4ndCBldmVuIG5lZWQgdGhlIHNjaGVtYSxcbiAgLy8gYW5kIHNob3VsZCBpbmZlciBmcm9tIHRoZSB0eXBlLiBPciBtYXliZSBkb2VzIG5lZWQgdGhlIHNjaGVtYSBmb3IgdmFsaWRhdGlvbnMuIE9yIG1heWJlIG5lZWRzXG4gIC8vIHRoZSBzY2hlbWEgb25seSBmb3IgdGhlIGxlZ2FjeSBtb25nbyBmb3JtYXQuIFdlJ2xsIGZpZ3VyZSB0aGF0IG91dCBsYXRlci5cbiAgY3JlYXRlT2JqZWN0KGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIG9iamVjdDogYW55KSB7XG4gICAgc2NoZW1hID0gY29udmVydFBhcnNlU2NoZW1hVG9Nb25nb1NjaGVtYShzY2hlbWEpO1xuICAgIGNvbnN0IG1vbmdvT2JqZWN0ID0gcGFyc2VPYmplY3RUb01vbmdvT2JqZWN0Rm9yQ3JlYXRlKGNsYXNzTmFtZSwgb2JqZWN0LCBzY2hlbWEpO1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLmluc2VydE9uZShtb25nb09iamVjdCkpXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IuY29kZSA9PT0gMTEwMDApIHsgLy8gRHVwbGljYXRlIHZhbHVlXG4gICAgICAgICAgY29uc3QgZXJyID0gbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLkRVUExJQ0FURV9WQUxVRSwgJ0EgZHVwbGljYXRlIHZhbHVlIGZvciBhIGZpZWxkIHdpdGggdW5pcXVlIHZhbHVlcyB3YXMgcHJvdmlkZWQnKTtcbiAgICAgICAgICBlcnIudW5kZXJseWluZ0Vycm9yID0gZXJyb3I7XG4gICAgICAgICAgaWYgKGVycm9yLm1lc3NhZ2UpIHtcbiAgICAgICAgICAgIGNvbnN0IG1hdGNoZXMgPSBlcnJvci5tZXNzYWdlLm1hdGNoKC9pbmRleDpbXFxzYS16QS1aMC05X1xcLVxcLl0rXFwkPyhbYS16QS1aXy1dKylfMS8pO1xuICAgICAgICAgICAgaWYgKG1hdGNoZXMgJiYgQXJyYXkuaXNBcnJheShtYXRjaGVzKSkge1xuICAgICAgICAgICAgICBlcnIudXNlckluZm8gPSB7IGR1cGxpY2F0ZWRfZmllbGQ6IG1hdGNoZXNbMV0gfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIC8vIFJlbW92ZSBhbGwgb2JqZWN0cyB0aGF0IG1hdGNoIHRoZSBnaXZlbiBQYXJzZSBRdWVyeS5cbiAgLy8gSWYgbm8gb2JqZWN0cyBtYXRjaCwgcmVqZWN0IHdpdGggT0JKRUNUX05PVF9GT1VORC4gSWYgb2JqZWN0cyBhcmUgZm91bmQgYW5kIGRlbGV0ZWQsIHJlc29sdmUgd2l0aCB1bmRlZmluZWQuXG4gIC8vIElmIHRoZXJlIGlzIHNvbWUgb3RoZXIgZXJyb3IsIHJlamVjdCB3aXRoIElOVEVSTkFMX1NFUlZFUl9FUlJPUi5cbiAgZGVsZXRlT2JqZWN0c0J5UXVlcnkoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgcXVlcnk6IFF1ZXJ5VHlwZSkge1xuICAgIHNjaGVtYSA9IGNvbnZlcnRQYXJzZVNjaGVtYVRvTW9uZ29TY2hlbWEoc2NoZW1hKTtcbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4ge1xuICAgICAgICBjb25zdCBtb25nb1doZXJlID0gdHJhbnNmb3JtV2hlcmUoY2xhc3NOYW1lLCBxdWVyeSwgc2NoZW1hKTtcbiAgICAgICAgcmV0dXJuIGNvbGxlY3Rpb24uZGVsZXRlTWFueShtb25nb1doZXJlKVxuICAgICAgfSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKVxuICAgICAgLnRoZW4oKHsgcmVzdWx0IH0pID0+IHtcbiAgICAgICAgaWYgKHJlc3VsdC5uID09PSAwKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsICdPYmplY3Qgbm90IGZvdW5kLicpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgIH0sICgpID0+IHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVEVSTkFMX1NFUlZFUl9FUlJPUiwgJ0RhdGFiYXNlIGFkYXB0ZXIgZXJyb3InKTtcbiAgICAgIH0pO1xuICB9XG5cbiAgLy8gQXBwbHkgdGhlIHVwZGF0ZSB0byBhbGwgb2JqZWN0cyB0aGF0IG1hdGNoIHRoZSBnaXZlbiBQYXJzZSBRdWVyeS5cbiAgdXBkYXRlT2JqZWN0c0J5UXVlcnkoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgcXVlcnk6IFF1ZXJ5VHlwZSwgdXBkYXRlOiBhbnkpIHtcbiAgICBzY2hlbWEgPSBjb252ZXJ0UGFyc2VTY2hlbWFUb01vbmdvU2NoZW1hKHNjaGVtYSk7XG4gICAgY29uc3QgbW9uZ29VcGRhdGUgPSB0cmFuc2Zvcm1VcGRhdGUoY2xhc3NOYW1lLCB1cGRhdGUsIHNjaGVtYSk7XG4gICAgY29uc3QgbW9uZ29XaGVyZSA9IHRyYW5zZm9ybVdoZXJlKGNsYXNzTmFtZSwgcXVlcnksIHNjaGVtYSk7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24udXBkYXRlTWFueShtb25nb1doZXJlLCBtb25nb1VwZGF0ZSkpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICAvLyBBdG9taWNhbGx5IGZpbmRzIGFuZCB1cGRhdGVzIGFuIG9iamVjdCBiYXNlZCBvbiBxdWVyeS5cbiAgLy8gUmV0dXJuIHZhbHVlIG5vdCBjdXJyZW50bHkgd2VsbCBzcGVjaWZpZWQuXG4gIGZpbmRPbmVBbmRVcGRhdGUoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgcXVlcnk6IFF1ZXJ5VHlwZSwgdXBkYXRlOiBhbnkpIHtcbiAgICBzY2hlbWEgPSBjb252ZXJ0UGFyc2VTY2hlbWFUb01vbmdvU2NoZW1hKHNjaGVtYSk7XG4gICAgY29uc3QgbW9uZ29VcGRhdGUgPSB0cmFuc2Zvcm1VcGRhdGUoY2xhc3NOYW1lLCB1cGRhdGUsIHNjaGVtYSk7XG4gICAgY29uc3QgbW9uZ29XaGVyZSA9IHRyYW5zZm9ybVdoZXJlKGNsYXNzTmFtZSwgcXVlcnksIHNjaGVtYSk7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24uX21vbmdvQ29sbGVjdGlvbi5maW5kQW5kTW9kaWZ5KG1vbmdvV2hlcmUsIFtdLCBtb25nb1VwZGF0ZSwgeyBuZXc6IHRydWUgfSkpXG4gICAgICAudGhlbihyZXN1bHQgPT4gbW9uZ29PYmplY3RUb1BhcnNlT2JqZWN0KGNsYXNzTmFtZSwgcmVzdWx0LnZhbHVlLCBzY2hlbWEpKVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKGVycm9yLmNvZGUgPT09IDExMDAwKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLkRVUExJQ0FURV9WQUxVRSwgJ0EgZHVwbGljYXRlIHZhbHVlIGZvciBhIGZpZWxkIHdpdGggdW5pcXVlIHZhbHVlcyB3YXMgcHJvdmlkZWQnKTtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICAvLyBIb3BlZnVsbHkgd2UgY2FuIGdldCByaWQgb2YgdGhpcy4gSXQncyBvbmx5IHVzZWQgZm9yIGNvbmZpZyBhbmQgaG9va3MuXG4gIHVwc2VydE9uZU9iamVjdChjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBxdWVyeTogUXVlcnlUeXBlLCB1cGRhdGU6IGFueSkge1xuICAgIHNjaGVtYSA9IGNvbnZlcnRQYXJzZVNjaGVtYVRvTW9uZ29TY2hlbWEoc2NoZW1hKTtcbiAgICBjb25zdCBtb25nb1VwZGF0ZSA9IHRyYW5zZm9ybVVwZGF0ZShjbGFzc05hbWUsIHVwZGF0ZSwgc2NoZW1hKTtcbiAgICBjb25zdCBtb25nb1doZXJlID0gdHJhbnNmb3JtV2hlcmUoY2xhc3NOYW1lLCBxdWVyeSwgc2NoZW1hKTtcbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi51cHNlcnRPbmUobW9uZ29XaGVyZSwgbW9uZ29VcGRhdGUpKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgLy8gRXhlY3V0ZXMgYSBmaW5kLiBBY2NlcHRzOiBjbGFzc05hbWUsIHF1ZXJ5IGluIFBhcnNlIGZvcm1hdCwgYW5kIHsgc2tpcCwgbGltaXQsIHNvcnQgfS5cbiAgZmluZChjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBxdWVyeTogUXVlcnlUeXBlLCB7IHNraXAsIGxpbWl0LCBzb3J0LCBrZXlzLCByZWFkUHJlZmVyZW5jZSB9OiBRdWVyeU9wdGlvbnMpOiBQcm9taXNlPGFueT4ge1xuICAgIHNjaGVtYSA9IGNvbnZlcnRQYXJzZVNjaGVtYVRvTW9uZ29TY2hlbWEoc2NoZW1hKTtcbiAgICBjb25zdCBtb25nb1doZXJlID0gdHJhbnNmb3JtV2hlcmUoY2xhc3NOYW1lLCBxdWVyeSwgc2NoZW1hKTtcbiAgICBjb25zdCBtb25nb1NvcnQgPSBfLm1hcEtleXMoc29ydCwgKHZhbHVlLCBmaWVsZE5hbWUpID0+IHRyYW5zZm9ybUtleShjbGFzc05hbWUsIGZpZWxkTmFtZSwgc2NoZW1hKSk7XG4gICAgY29uc3QgbW9uZ29LZXlzID0gXy5yZWR1Y2Uoa2V5cywgKG1lbW8sIGtleSkgPT4ge1xuICAgICAgbWVtb1t0cmFuc2Zvcm1LZXkoY2xhc3NOYW1lLCBrZXksIHNjaGVtYSldID0gMTtcbiAgICAgIHJldHVybiBtZW1vO1xuICAgIH0sIHt9KTtcblxuICAgIHJlYWRQcmVmZXJlbmNlID0gdGhpcy5fcGFyc2VSZWFkUHJlZmVyZW5jZShyZWFkUHJlZmVyZW5jZSk7XG4gICAgcmV0dXJuIHRoaXMuY3JlYXRlVGV4dEluZGV4ZXNJZk5lZWRlZChjbGFzc05hbWUsIHF1ZXJ5LCBzY2hlbWEpXG4gICAgICAudGhlbigoKSA9PiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi5maW5kKG1vbmdvV2hlcmUsIHtcbiAgICAgICAgc2tpcCxcbiAgICAgICAgbGltaXQsXG4gICAgICAgIHNvcnQ6IG1vbmdvU29ydCxcbiAgICAgICAga2V5czogbW9uZ29LZXlzLFxuICAgICAgICBtYXhUaW1lTVM6IHRoaXMuX21heFRpbWVNUyxcbiAgICAgICAgcmVhZFByZWZlcmVuY2UsXG4gICAgICB9KSlcbiAgICAgIC50aGVuKG9iamVjdHMgPT4gb2JqZWN0cy5tYXAob2JqZWN0ID0+IG1vbmdvT2JqZWN0VG9QYXJzZU9iamVjdChjbGFzc05hbWUsIG9iamVjdCwgc2NoZW1hKSkpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICAvLyBDcmVhdGUgYSB1bmlxdWUgaW5kZXguIFVuaXF1ZSBpbmRleGVzIG9uIG51bGxhYmxlIGZpZWxkcyBhcmUgbm90IGFsbG93ZWQuIFNpbmNlIHdlIGRvbid0XG4gIC8vIGN1cnJlbnRseSBrbm93IHdoaWNoIGZpZWxkcyBhcmUgbnVsbGFibGUgYW5kIHdoaWNoIGFyZW4ndCwgd2UgaWdub3JlIHRoYXQgY3JpdGVyaWEuXG4gIC8vIEFzIHN1Y2gsIHdlIHNob3VsZG4ndCBleHBvc2UgdGhpcyBmdW5jdGlvbiB0byB1c2VycyBvZiBwYXJzZSB1bnRpbCB3ZSBoYXZlIGFuIG91dC1vZi1iYW5kXG4gIC8vIFdheSBvZiBkZXRlcm1pbmluZyBpZiBhIGZpZWxkIGlzIG51bGxhYmxlLiBVbmRlZmluZWQgZG9lc24ndCBjb3VudCBhZ2FpbnN0IHVuaXF1ZW5lc3MsXG4gIC8vIHdoaWNoIGlzIHdoeSB3ZSB1c2Ugc3BhcnNlIGluZGV4ZXMuXG4gIGVuc3VyZVVuaXF1ZW5lc3MoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgZmllbGROYW1lczogc3RyaW5nW10pIHtcbiAgICBzY2hlbWEgPSBjb252ZXJ0UGFyc2VTY2hlbWFUb01vbmdvU2NoZW1hKHNjaGVtYSk7XG4gICAgY29uc3QgaW5kZXhDcmVhdGlvblJlcXVlc3QgPSB7fTtcbiAgICBjb25zdCBtb25nb0ZpZWxkTmFtZXMgPSBmaWVsZE5hbWVzLm1hcChmaWVsZE5hbWUgPT4gdHJhbnNmb3JtS2V5KGNsYXNzTmFtZSwgZmllbGROYW1lLCBzY2hlbWEpKTtcbiAgICBtb25nb0ZpZWxkTmFtZXMuZm9yRWFjaChmaWVsZE5hbWUgPT4ge1xuICAgICAgaW5kZXhDcmVhdGlvblJlcXVlc3RbZmllbGROYW1lXSA9IDE7XG4gICAgfSk7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24uX2Vuc3VyZVNwYXJzZVVuaXF1ZUluZGV4SW5CYWNrZ3JvdW5kKGluZGV4Q3JlYXRpb25SZXF1ZXN0KSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlID09PSAxMTAwMCkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUUsICdUcmllZCB0byBlbnN1cmUgZmllbGQgdW5pcXVlbmVzcyBmb3IgYSBjbGFzcyB0aGF0IGFscmVhZHkgaGFzIGR1cGxpY2F0ZXMuJyk7XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgLy8gVXNlZCBpbiB0ZXN0c1xuICBfcmF3RmluZChjbGFzc05hbWU6IHN0cmluZywgcXVlcnk6IFF1ZXJ5VHlwZSkge1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKS50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi5maW5kKHF1ZXJ5LCB7XG4gICAgICBtYXhUaW1lTVM6IHRoaXMuX21heFRpbWVNUyxcbiAgICB9KSkuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICAvLyBFeGVjdXRlcyBhIGNvdW50LlxuICBjb3VudChjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBxdWVyeTogUXVlcnlUeXBlLCByZWFkUHJlZmVyZW5jZTogP3N0cmluZykge1xuICAgIHNjaGVtYSA9IGNvbnZlcnRQYXJzZVNjaGVtYVRvTW9uZ29TY2hlbWEoc2NoZW1hKTtcbiAgICByZWFkUHJlZmVyZW5jZSA9IHRoaXMuX3BhcnNlUmVhZFByZWZlcmVuY2UocmVhZFByZWZlcmVuY2UpO1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLmNvdW50KHRyYW5zZm9ybVdoZXJlKGNsYXNzTmFtZSwgcXVlcnksIHNjaGVtYSksIHtcbiAgICAgICAgbWF4VGltZU1TOiB0aGlzLl9tYXhUaW1lTVMsXG4gICAgICAgIHJlYWRQcmVmZXJlbmNlLFxuICAgICAgfSkpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICBkaXN0aW5jdChjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBxdWVyeTogUXVlcnlUeXBlLCBmaWVsZE5hbWU6IHN0cmluZykge1xuICAgIHNjaGVtYSA9IGNvbnZlcnRQYXJzZVNjaGVtYVRvTW9uZ29TY2hlbWEoc2NoZW1hKTtcbiAgICBjb25zdCBpc1BvaW50ZXJGaWVsZCA9IHNjaGVtYS5maWVsZHNbZmllbGROYW1lXSAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ1BvaW50ZXInO1xuICAgIGlmIChpc1BvaW50ZXJGaWVsZCkge1xuICAgICAgZmllbGROYW1lID0gYF9wXyR7ZmllbGROYW1lfWBcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24uZGlzdGluY3QoZmllbGROYW1lLCB0cmFuc2Zvcm1XaGVyZShjbGFzc05hbWUsIHF1ZXJ5LCBzY2hlbWEpKSlcbiAgICAgIC50aGVuKG9iamVjdHMgPT4ge1xuICAgICAgICBvYmplY3RzID0gb2JqZWN0cy5maWx0ZXIoKG9iaikgPT4gb2JqICE9IG51bGwpO1xuICAgICAgICByZXR1cm4gb2JqZWN0cy5tYXAob2JqZWN0ID0+IHtcbiAgICAgICAgICBpZiAoaXNQb2ludGVyRmllbGQpIHtcbiAgICAgICAgICAgIGNvbnN0IGZpZWxkID0gZmllbGROYW1lLnN1YnN0cmluZygzKTtcbiAgICAgICAgICAgIHJldHVybiB0cmFuc2Zvcm1Qb2ludGVyU3RyaW5nKHNjaGVtYSwgZmllbGQsIG9iamVjdCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBtb25nb09iamVjdFRvUGFyc2VPYmplY3QoY2xhc3NOYW1lLCBvYmplY3QsIHNjaGVtYSk7XG4gICAgICAgIH0pO1xuICAgICAgfSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIGFnZ3JlZ2F0ZShjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBhbnksIHBpcGVsaW5lOiBhbnksIHJlYWRQcmVmZXJlbmNlOiA/c3RyaW5nKSB7XG4gICAgbGV0IGlzUG9pbnRlckZpZWxkID0gZmFsc2U7XG4gICAgcGlwZWxpbmUgPSBwaXBlbGluZS5tYXAoKHN0YWdlKSA9PiB7XG4gICAgICBpZiAoc3RhZ2UuJGdyb3VwKSB7XG4gICAgICAgIHN0YWdlLiRncm91cCA9IHRoaXMuX3BhcnNlQWdncmVnYXRlR3JvdXBBcmdzKHNjaGVtYSwgc3RhZ2UuJGdyb3VwKTtcbiAgICAgICAgaWYgKHN0YWdlLiRncm91cC5faWQgJiYgKHR5cGVvZiBzdGFnZS4kZ3JvdXAuX2lkID09PSAnc3RyaW5nJykgJiYgc3RhZ2UuJGdyb3VwLl9pZC5pbmRleE9mKCckX3BfJykgPj0gMCkge1xuICAgICAgICAgIGlzUG9pbnRlckZpZWxkID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKHN0YWdlLiRtYXRjaCkge1xuICAgICAgICBzdGFnZS4kbWF0Y2ggPSB0aGlzLl9wYXJzZUFnZ3JlZ2F0ZUFyZ3Moc2NoZW1hLCBzdGFnZS4kbWF0Y2gpO1xuICAgICAgfVxuICAgICAgaWYgKHN0YWdlLiRwcm9qZWN0KSB7XG4gICAgICAgIHN0YWdlLiRwcm9qZWN0ID0gdGhpcy5fcGFyc2VBZ2dyZWdhdGVQcm9qZWN0QXJncyhzY2hlbWEsIHN0YWdlLiRwcm9qZWN0KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBzdGFnZTtcbiAgICB9KTtcbiAgICByZWFkUHJlZmVyZW5jZSA9IHRoaXMuX3BhcnNlUmVhZFByZWZlcmVuY2UocmVhZFByZWZlcmVuY2UpO1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLmFnZ3JlZ2F0ZShwaXBlbGluZSwgeyByZWFkUHJlZmVyZW5jZSwgbWF4VGltZU1TOiB0aGlzLl9tYXhUaW1lTVMgfSkpXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IuY29kZSA9PT0gMTYwMDYpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSwgZXJyb3IubWVzc2FnZSk7XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9KVxuICAgICAgLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICAgIHJlc3VsdHMuZm9yRWFjaChyZXN1bHQgPT4ge1xuICAgICAgICAgIGlmIChyZXN1bHQuaGFzT3duUHJvcGVydHkoJ19pZCcpKSB7XG4gICAgICAgICAgICBpZiAoaXNQb2ludGVyRmllbGQgJiYgcmVzdWx0Ll9pZCkge1xuICAgICAgICAgICAgICByZXN1bHQuX2lkID0gcmVzdWx0Ll9pZC5zcGxpdCgnJCcpWzFdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHJlc3VsdC5faWQgPT0gbnVsbCB8fCBfLmlzRW1wdHkocmVzdWx0Ll9pZCkpIHtcbiAgICAgICAgICAgICAgcmVzdWx0Ll9pZCA9IG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXN1bHQub2JqZWN0SWQgPSByZXN1bHQuX2lkO1xuICAgICAgICAgICAgZGVsZXRlIHJlc3VsdC5faWQ7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHJlc3VsdHM7XG4gICAgICB9KVxuICAgICAgLnRoZW4ob2JqZWN0cyA9PiBvYmplY3RzLm1hcChvYmplY3QgPT4gbW9uZ29PYmplY3RUb1BhcnNlT2JqZWN0KGNsYXNzTmFtZSwgb2JqZWN0LCBzY2hlbWEpKSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIC8vIFRoaXMgZnVuY3Rpb24gd2lsbCByZWN1cnNpdmVseSB0cmF2ZXJzZSB0aGUgcGlwZWxpbmUgYW5kIGNvbnZlcnQgYW55IFBvaW50ZXIgb3IgRGF0ZSBjb2x1bW5zLlxuICAvLyBJZiB3ZSBkZXRlY3QgYSBwb2ludGVyIGNvbHVtbiB3ZSB3aWxsIHJlbmFtZSB0aGUgY29sdW1uIGJlaW5nIHF1ZXJpZWQgZm9yIHRvIG1hdGNoIHRoZSBjb2x1bW5cbiAgLy8gaW4gdGhlIGRhdGFiYXNlLiBXZSBhbHNvIG1vZGlmeSB0aGUgdmFsdWUgdG8gd2hhdCB3ZSBleHBlY3QgdGhlIHZhbHVlIHRvIGJlIGluIHRoZSBkYXRhYmFzZVxuICAvLyBhcyB3ZWxsLlxuICAvLyBGb3IgZGF0ZXMsIHRoZSBkcml2ZXIgZXhwZWN0cyBhIERhdGUgb2JqZWN0LCBidXQgd2UgaGF2ZSBhIHN0cmluZyBjb21pbmcgaW4uIFNvIHdlJ2xsIGNvbnZlcnRcbiAgLy8gdGhlIHN0cmluZyB0byBhIERhdGUgc28gdGhlIGRyaXZlciBjYW4gcGVyZm9ybSB0aGUgbmVjZXNzYXJ5IGNvbXBhcmlzb24uXG4gIC8vXG4gIC8vIFRoZSBnb2FsIG9mIHRoaXMgbWV0aG9kIGlzIHRvIGxvb2sgZm9yIHRoZSBcImxlYXZlc1wiIG9mIHRoZSBwaXBlbGluZSBhbmQgZGV0ZXJtaW5lIGlmIGl0IG5lZWRzXG4gIC8vIHRvIGJlIGNvbnZlcnRlZC4gVGhlIHBpcGVsaW5lIGNhbiBoYXZlIGEgZmV3IGRpZmZlcmVudCBmb3Jtcy4gRm9yIG1vcmUgZGV0YWlscywgc2VlOlxuICAvLyAgICAgaHR0cHM6Ly9kb2NzLm1vbmdvZGIuY29tL21hbnVhbC9yZWZlcmVuY2Uvb3BlcmF0b3IvYWdncmVnYXRpb24vXG4gIC8vXG4gIC8vIElmIHRoZSBwaXBlbGluZSBpcyBhbiBhcnJheSwgaXQgbWVhbnMgd2UgYXJlIHByb2JhYmx5IHBhcnNpbmcgYW4gJyRhbmQnIG9yICckb3InIG9wZXJhdG9yLiBJblxuICAvLyB0aGF0IGNhc2Ugd2UgbmVlZCB0byBsb29wIHRocm91Z2ggYWxsIG9mIGl0J3MgY2hpbGRyZW4gdG8gZmluZCB0aGUgY29sdW1ucyBiZWluZyBvcGVyYXRlZCBvbi5cbiAgLy8gSWYgdGhlIHBpcGVsaW5lIGlzIGFuIG9iamVjdCwgdGhlbiB3ZSdsbCBsb29wIHRocm91Z2ggdGhlIGtleXMgY2hlY2tpbmcgdG8gc2VlIGlmIHRoZSBrZXkgbmFtZVxuICAvLyBtYXRjaGVzIG9uZSBvZiB0aGUgc2NoZW1hIGNvbHVtbnMuIElmIGl0IGRvZXMgbWF0Y2ggYSBjb2x1bW4gYW5kIHRoZSBjb2x1bW4gaXMgYSBQb2ludGVyIG9yXG4gIC8vIGEgRGF0ZSwgdGhlbiB3ZSdsbCBjb252ZXJ0IHRoZSB2YWx1ZSBhcyBkZXNjcmliZWQgYWJvdmUuXG4gIC8vXG4gIC8vIEFzIG11Y2ggYXMgSSBoYXRlIHJlY3Vyc2lvbi4uLnRoaXMgc2VlbWVkIGxpa2UgYSBnb29kIGZpdCBmb3IgaXQuIFdlJ3JlIGVzc2VudGlhbGx5IHRyYXZlcnNpbmdcbiAgLy8gZG93biBhIHRyZWUgdG8gZmluZCBhIFwibGVhZiBub2RlXCIgYW5kIGNoZWNraW5nIHRvIHNlZSBpZiBpdCBuZWVkcyB0byBiZSBjb252ZXJ0ZWQuXG4gIF9wYXJzZUFnZ3JlZ2F0ZUFyZ3Moc2NoZW1hOiBhbnksIHBpcGVsaW5lOiBhbnkpOiBhbnkge1xuICAgIGlmIChBcnJheS5pc0FycmF5KHBpcGVsaW5lKSkge1xuICAgICAgcmV0dXJuIHBpcGVsaW5lLm1hcCgodmFsdWUpID0+IHRoaXMuX3BhcnNlQWdncmVnYXRlQXJncyhzY2hlbWEsIHZhbHVlKSk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgcGlwZWxpbmUgPT09ICdvYmplY3QnKSB7XG4gICAgICBjb25zdCByZXR1cm5WYWx1ZSA9IHt9O1xuICAgICAgZm9yIChjb25zdCBmaWVsZCBpbiBwaXBlbGluZSkge1xuICAgICAgICBpZiAoc2NoZW1hLmZpZWxkc1tmaWVsZF0gJiYgc2NoZW1hLmZpZWxkc1tmaWVsZF0udHlwZSA9PT0gJ1BvaW50ZXInKSB7XG4gICAgICAgICAgaWYgKHR5cGVvZiBwaXBlbGluZVtmaWVsZF0gPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICAvLyBQYXNzIG9iamVjdHMgZG93biB0byBNb25nb0RCLi4udGhpcyBpcyBtb3JlIHRoYW4gbGlrZWx5IGFuICRleGlzdHMgb3BlcmF0b3IuXG4gICAgICAgICAgICByZXR1cm5WYWx1ZVtgX3BfJHtmaWVsZH1gXSA9IHBpcGVsaW5lW2ZpZWxkXTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuVmFsdWVbYF9wXyR7ZmllbGR9YF0gPSBgJHtzY2hlbWEuZmllbGRzW2ZpZWxkXS50YXJnZXRDbGFzc30kJHtwaXBlbGluZVtmaWVsZF19YDtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoc2NoZW1hLmZpZWxkc1tmaWVsZF0gJiYgc2NoZW1hLmZpZWxkc1tmaWVsZF0udHlwZSA9PT0gJ0RhdGUnKSB7XG4gICAgICAgICAgcmV0dXJuVmFsdWVbZmllbGRdID0gdGhpcy5fY29udmVydFRvRGF0ZShwaXBlbGluZVtmaWVsZF0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVyblZhbHVlW2ZpZWxkXSA9IHRoaXMuX3BhcnNlQWdncmVnYXRlQXJncyhzY2hlbWEsIHBpcGVsaW5lW2ZpZWxkXSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZmllbGQgPT09ICdvYmplY3RJZCcpIHtcbiAgICAgICAgICByZXR1cm5WYWx1ZVsnX2lkJ10gPSByZXR1cm5WYWx1ZVtmaWVsZF07XG4gICAgICAgICAgZGVsZXRlIHJldHVyblZhbHVlW2ZpZWxkXTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZCA9PT0gJ2NyZWF0ZWRBdCcpIHtcbiAgICAgICAgICByZXR1cm5WYWx1ZVsnX2NyZWF0ZWRfYXQnXSA9IHJldHVyblZhbHVlW2ZpZWxkXTtcbiAgICAgICAgICBkZWxldGUgcmV0dXJuVmFsdWVbZmllbGRdO1xuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkID09PSAndXBkYXRlZEF0Jykge1xuICAgICAgICAgIHJldHVyblZhbHVlWydfdXBkYXRlZF9hdCddID0gcmV0dXJuVmFsdWVbZmllbGRdO1xuICAgICAgICAgIGRlbGV0ZSByZXR1cm5WYWx1ZVtmaWVsZF07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiByZXR1cm5WYWx1ZTtcbiAgICB9XG4gICAgcmV0dXJuIHBpcGVsaW5lO1xuICB9XG5cbiAgLy8gVGhpcyBmdW5jdGlvbiBpcyBzbGlnaHRseSBkaWZmZXJlbnQgdGhhbiB0aGUgb25lIGFib3ZlLiBSYXRoZXIgdGhhbiB0cnlpbmcgdG8gY29tYmluZSB0aGVzZVxuICAvLyB0d28gZnVuY3Rpb25zIGFuZCBtYWtpbmcgdGhlIGNvZGUgZXZlbiBoYXJkZXIgdG8gdW5kZXJzdGFuZCwgSSBkZWNpZGVkIHRvIHNwbGl0IGl0IHVwLiBUaGVcbiAgLy8gZGlmZmVyZW5jZSB3aXRoIHRoaXMgZnVuY3Rpb24gaXMgd2UgYXJlIG5vdCB0cmFuc2Zvcm1pbmcgdGhlIHZhbHVlcywgb25seSB0aGUga2V5cyBvZiB0aGVcbiAgLy8gcGlwZWxpbmUuXG4gIF9wYXJzZUFnZ3JlZ2F0ZVByb2plY3RBcmdzKHNjaGVtYTogYW55LCBwaXBlbGluZTogYW55KTogYW55IHtcbiAgICBjb25zdCByZXR1cm5WYWx1ZSA9IHt9O1xuICAgIGZvciAoY29uc3QgZmllbGQgaW4gcGlwZWxpbmUpIHtcbiAgICAgIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkXSAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkXS50eXBlID09PSAnUG9pbnRlcicpIHtcbiAgICAgICAgcmV0dXJuVmFsdWVbYF9wXyR7ZmllbGR9YF0gPSBwaXBlbGluZVtmaWVsZF07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm5WYWx1ZVtmaWVsZF0gPSB0aGlzLl9wYXJzZUFnZ3JlZ2F0ZUFyZ3Moc2NoZW1hLCBwaXBlbGluZVtmaWVsZF0pO1xuICAgICAgfVxuXG4gICAgICBpZiAoZmllbGQgPT09ICdvYmplY3RJZCcpIHtcbiAgICAgICAgcmV0dXJuVmFsdWVbJ19pZCddID0gcmV0dXJuVmFsdWVbZmllbGRdO1xuICAgICAgICBkZWxldGUgcmV0dXJuVmFsdWVbZmllbGRdO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZCA9PT0gJ2NyZWF0ZWRBdCcpIHtcbiAgICAgICAgcmV0dXJuVmFsdWVbJ19jcmVhdGVkX2F0J10gPSByZXR1cm5WYWx1ZVtmaWVsZF07XG4gICAgICAgIGRlbGV0ZSByZXR1cm5WYWx1ZVtmaWVsZF07XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkID09PSAndXBkYXRlZEF0Jykge1xuICAgICAgICByZXR1cm5WYWx1ZVsnX3VwZGF0ZWRfYXQnXSA9IHJldHVyblZhbHVlW2ZpZWxkXTtcbiAgICAgICAgZGVsZXRlIHJldHVyblZhbHVlW2ZpZWxkXTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJldHVyblZhbHVlO1xuICB9XG5cbiAgLy8gVGhpcyBmdW5jdGlvbiBpcyBzbGlnaHRseSBkaWZmZXJlbnQgdGhhbiB0aGUgdHdvIGFib3ZlLiBNb25nb0RCICRncm91cCBhZ2dyZWdhdGUgbG9va3MgbGlrZTpcbiAgLy8gICAgIHsgJGdyb3VwOiB7IF9pZDogPGV4cHJlc3Npb24+LCA8ZmllbGQxPjogeyA8YWNjdW11bGF0b3IxPiA6IDxleHByZXNzaW9uMT4gfSwgLi4uIH0gfVxuICAvLyBUaGUgPGV4cHJlc3Npb24+IGNvdWxkIGJlIGEgY29sdW1uIG5hbWUsIHByZWZpeGVkIHdpdGggdGhlICckJyBjaGFyYWN0ZXIuIFdlJ2xsIGxvb2sgZm9yXG4gIC8vIHRoZXNlIDxleHByZXNzaW9uPiBhbmQgY2hlY2sgdG8gc2VlIGlmIGl0IGlzIGEgJ1BvaW50ZXInIG9yIGlmIGl0J3Mgb25lIG9mIGNyZWF0ZWRBdCxcbiAgLy8gdXBkYXRlZEF0IG9yIG9iamVjdElkIGFuZCBjaGFuZ2UgaXQgYWNjb3JkaW5nbHkuXG4gIF9wYXJzZUFnZ3JlZ2F0ZUdyb3VwQXJncyhzY2hlbWE6IGFueSwgcGlwZWxpbmU6IGFueSk6IGFueSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkocGlwZWxpbmUpKSB7XG4gICAgICByZXR1cm4gcGlwZWxpbmUubWFwKCh2YWx1ZSkgPT4gdGhpcy5fcGFyc2VBZ2dyZWdhdGVHcm91cEFyZ3Moc2NoZW1hLCB2YWx1ZSkpO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIHBpcGVsaW5lID09PSAnb2JqZWN0Jykge1xuICAgICAgY29uc3QgcmV0dXJuVmFsdWUgPSB7fTtcbiAgICAgIGZvciAoY29uc3QgZmllbGQgaW4gcGlwZWxpbmUpIHtcbiAgICAgICAgcmV0dXJuVmFsdWVbZmllbGRdID0gdGhpcy5fcGFyc2VBZ2dyZWdhdGVHcm91cEFyZ3Moc2NoZW1hLCBwaXBlbGluZVtmaWVsZF0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJldHVyblZhbHVlO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIHBpcGVsaW5lID09PSAnc3RyaW5nJykge1xuICAgICAgY29uc3QgZmllbGQgPSBwaXBlbGluZS5zdWJzdHJpbmcoMSk7XG4gICAgICBpZiAoc2NoZW1hLmZpZWxkc1tmaWVsZF0gJiYgc2NoZW1hLmZpZWxkc1tmaWVsZF0udHlwZSA9PT0gJ1BvaW50ZXInKSB7XG4gICAgICAgIHJldHVybiBgJF9wXyR7ZmllbGR9YDtcbiAgICAgIH0gZWxzZSBpZiAoZmllbGQgPT0gJ2NyZWF0ZWRBdCcpIHtcbiAgICAgICAgcmV0dXJuICckX2NyZWF0ZWRfYXQnO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZCA9PSAndXBkYXRlZEF0Jykge1xuICAgICAgICByZXR1cm4gJyRfdXBkYXRlZF9hdCc7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBwaXBlbGluZTtcbiAgfVxuXG4gIC8vIFRoaXMgZnVuY3Rpb24gd2lsbCBhdHRlbXB0IHRvIGNvbnZlcnQgdGhlIHByb3ZpZGVkIHZhbHVlIHRvIGEgRGF0ZSBvYmplY3QuIFNpbmNlIHRoaXMgaXMgcGFydFxuICAvLyBvZiBhbiBhZ2dyZWdhdGlvbiBwaXBlbGluZSwgdGhlIHZhbHVlIGNhbiBlaXRoZXIgYmUgYSBzdHJpbmcgb3IgaXQgY2FuIGJlIGFub3RoZXIgb2JqZWN0IHdpdGhcbiAgLy8gYW4gb3BlcmF0b3IgaW4gaXQgKGxpa2UgJGd0LCAkbHQsIGV0YykuIEJlY2F1c2Ugb2YgdGhpcyBJIGZlbHQgaXQgd2FzIGVhc2llciB0byBtYWtlIHRoaXMgYVxuICAvLyByZWN1cnNpdmUgbWV0aG9kIHRvIHRyYXZlcnNlIGRvd24gdG8gdGhlIFwibGVhZiBub2RlXCIgd2hpY2ggaXMgZ29pbmcgdG8gYmUgdGhlIHN0cmluZy5cbiAgX2NvbnZlcnRUb0RhdGUodmFsdWU6IGFueSk6IGFueSB7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHJldHVybiBuZXcgRGF0ZSh2YWx1ZSk7XG4gICAgfVxuXG4gICAgY29uc3QgcmV0dXJuVmFsdWUgPSB7fVxuICAgIGZvciAoY29uc3QgZmllbGQgaW4gdmFsdWUpIHtcbiAgICAgIHJldHVyblZhbHVlW2ZpZWxkXSA9IHRoaXMuX2NvbnZlcnRUb0RhdGUodmFsdWVbZmllbGRdKVxuICAgIH1cbiAgICByZXR1cm4gcmV0dXJuVmFsdWU7XG4gIH1cblxuICBfcGFyc2VSZWFkUHJlZmVyZW5jZShyZWFkUHJlZmVyZW5jZTogP3N0cmluZyk6ID9zdHJpbmcge1xuICAgIHN3aXRjaCAocmVhZFByZWZlcmVuY2UpIHtcbiAgICBjYXNlICdQUklNQVJZJzpcbiAgICAgIHJlYWRQcmVmZXJlbmNlID0gUmVhZFByZWZlcmVuY2UuUFJJTUFSWTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ1BSSU1BUllfUFJFRkVSUkVEJzpcbiAgICAgIHJlYWRQcmVmZXJlbmNlID0gUmVhZFByZWZlcmVuY2UuUFJJTUFSWV9QUkVGRVJSRUQ7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdTRUNPTkRBUlknOlxuICAgICAgcmVhZFByZWZlcmVuY2UgPSBSZWFkUHJlZmVyZW5jZS5TRUNPTkRBUlk7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdTRUNPTkRBUllfUFJFRkVSUkVEJzpcbiAgICAgIHJlYWRQcmVmZXJlbmNlID0gUmVhZFByZWZlcmVuY2UuU0VDT05EQVJZX1BSRUZFUlJFRDtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ05FQVJFU1QnOlxuICAgICAgcmVhZFByZWZlcmVuY2UgPSBSZWFkUHJlZmVyZW5jZS5ORUFSRVNUO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSB1bmRlZmluZWQ6XG4gICAgICBicmVhaztcbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksICdOb3Qgc3VwcG9ydGVkIHJlYWQgcHJlZmVyZW5jZS4nKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlYWRQcmVmZXJlbmNlO1xuICB9XG5cbiAgcGVyZm9ybUluaXRpYWxpemF0aW9uKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIGNyZWF0ZUluZGV4KGNsYXNzTmFtZTogc3RyaW5nLCBpbmRleDogYW55KSB7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24uX21vbmdvQ29sbGVjdGlvbi5jcmVhdGVJbmRleChpbmRleCwge2JhY2tncm91bmQ6IHRydWV9KSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIGNyZWF0ZUluZGV4ZXMoY2xhc3NOYW1lOiBzdHJpbmcsIGluZGV4ZXM6IGFueSkge1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLl9tb25nb0NvbGxlY3Rpb24uY3JlYXRlSW5kZXhlcyhpbmRleGVzLCB7YmFja2dyb3VuZDogdHJ1ZX0pKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgY3JlYXRlSW5kZXhlc0lmTmVlZGVkKGNsYXNzTmFtZTogc3RyaW5nLCBmaWVsZE5hbWU6IHN0cmluZywgdHlwZTogYW55KSB7XG4gICAgaWYgKHR5cGUgJiYgdHlwZS50eXBlID09PSAnUG9seWdvbicpIHtcbiAgICAgIGNvbnN0IGluZGV4ID0ge1xuICAgICAgICBbZmllbGROYW1lXTogJzJkc3BoZXJlJ1xuICAgICAgfTtcbiAgICAgIHJldHVybiB0aGlzLmNyZWF0ZUluZGV4KGNsYXNzTmFtZSwgaW5kZXgpO1xuICAgIH1cbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICBjcmVhdGVUZXh0SW5kZXhlc0lmTmVlZGVkKGNsYXNzTmFtZTogc3RyaW5nLCBxdWVyeTogUXVlcnlUeXBlLCBzY2hlbWE6IGFueSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGZvcihjb25zdCBmaWVsZE5hbWUgaW4gcXVlcnkpIHtcbiAgICAgIGlmICghcXVlcnlbZmllbGROYW1lXSB8fCAhcXVlcnlbZmllbGROYW1lXS4kdGV4dCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGV4aXN0aW5nSW5kZXhlcyA9IHNjaGVtYS5pbmRleGVzO1xuICAgICAgZm9yIChjb25zdCBrZXkgaW4gZXhpc3RpbmdJbmRleGVzKSB7XG4gICAgICAgIGNvbnN0IGluZGV4ID0gZXhpc3RpbmdJbmRleGVzW2tleV07XG4gICAgICAgIGlmIChpbmRleC5oYXNPd25Qcm9wZXJ0eShmaWVsZE5hbWUpKSB7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBjb25zdCBpbmRleE5hbWUgPSBgJHtmaWVsZE5hbWV9X3RleHRgO1xuICAgICAgY29uc3QgdGV4dEluZGV4ID0ge1xuICAgICAgICBbaW5kZXhOYW1lXTogeyBbZmllbGROYW1lXTogJ3RleHQnIH1cbiAgICAgIH07XG4gICAgICByZXR1cm4gdGhpcy5zZXRJbmRleGVzV2l0aFNjaGVtYUZvcm1hdChjbGFzc05hbWUsIHRleHRJbmRleCwgZXhpc3RpbmdJbmRleGVzLCBzY2hlbWEuZmllbGRzKVxuICAgICAgICAuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgICAgaWYgKGVycm9yLmNvZGUgPT09IDg1KSB7IC8vIEluZGV4IGV4aXN0IHdpdGggZGlmZmVyZW50IG9wdGlvbnNcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnNldEluZGV4ZXNGcm9tTW9uZ28oY2xhc3NOYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICBnZXRJbmRleGVzKGNsYXNzTmFtZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24uX21vbmdvQ29sbGVjdGlvbi5pbmRleGVzKCkpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICBkcm9wSW5kZXgoY2xhc3NOYW1lOiBzdHJpbmcsIGluZGV4OiBhbnkpIHtcbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi5fbW9uZ29Db2xsZWN0aW9uLmRyb3BJbmRleChpbmRleCkpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICBkcm9wQWxsSW5kZXhlcyhjbGFzc05hbWU6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLl9tb25nb0NvbGxlY3Rpb24uZHJvcEluZGV4ZXMoKSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIHVwZGF0ZVNjaGVtYVdpdGhJbmRleGVzKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QWxsQ2xhc3NlcygpXG4gICAgICAudGhlbigoY2xhc3NlcykgPT4ge1xuICAgICAgICBjb25zdCBwcm9taXNlcyA9IGNsYXNzZXMubWFwKChzY2hlbWEpID0+IHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5zZXRJbmRleGVzRnJvbU1vbmdvKHNjaGVtYS5jbGFzc05hbWUpO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKHByb21pc2VzKTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgTW9uZ29TdG9yYWdlQWRhcHRlcjtcbiJdfQ==