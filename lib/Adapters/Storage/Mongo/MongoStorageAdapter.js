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
    this._mongoOptions.useNewUrlParser = true;

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9BZGFwdGVycy9TdG9yYWdlL01vbmdvL01vbmdvU3RvcmFnZUFkYXB0ZXIuanMiXSwibmFtZXMiOlsibW9uZ29kYiIsInJlcXVpcmUiLCJNb25nb0NsaWVudCIsIlJlYWRQcmVmZXJlbmNlIiwiTW9uZ29TY2hlbWFDb2xsZWN0aW9uTmFtZSIsInN0b3JhZ2VBZGFwdGVyQWxsQ29sbGVjdGlvbnMiLCJtb25nb0FkYXB0ZXIiLCJjb25uZWN0IiwidGhlbiIsImRhdGFiYXNlIiwiY29sbGVjdGlvbnMiLCJmaWx0ZXIiLCJjb2xsZWN0aW9uIiwibmFtZXNwYWNlIiwibWF0Y2giLCJjb2xsZWN0aW9uTmFtZSIsImluZGV4T2YiLCJfY29sbGVjdGlvblByZWZpeCIsImNvbnZlcnRQYXJzZVNjaGVtYVRvTW9uZ29TY2hlbWEiLCJzY2hlbWEiLCJmaWVsZHMiLCJfcnBlcm0iLCJfd3Blcm0iLCJjbGFzc05hbWUiLCJfaGFzaGVkX3Bhc3N3b3JkIiwibW9uZ29TY2hlbWFGcm9tRmllbGRzQW5kQ2xhc3NOYW1lQW5kQ0xQIiwiY2xhc3NMZXZlbFBlcm1pc3Npb25zIiwiaW5kZXhlcyIsIm1vbmdvT2JqZWN0IiwiX2lkIiwib2JqZWN0SWQiLCJ1cGRhdGVkQXQiLCJjcmVhdGVkQXQiLCJfbWV0YWRhdGEiLCJ1bmRlZmluZWQiLCJmaWVsZE5hbWUiLCJNb25nb1NjaGVtYUNvbGxlY3Rpb24iLCJwYXJzZUZpZWxkVHlwZVRvTW9uZ29GaWVsZFR5cGUiLCJjbGFzc19wZXJtaXNzaW9ucyIsIk9iamVjdCIsImtleXMiLCJsZW5ndGgiLCJNb25nb1N0b3JhZ2VBZGFwdGVyIiwiY29uc3RydWN0b3IiLCJ1cmkiLCJkZWZhdWx0cyIsIkRlZmF1bHRNb25nb1VSSSIsImNvbGxlY3Rpb25QcmVmaXgiLCJtb25nb09wdGlvbnMiLCJfdXJpIiwiX21vbmdvT3B0aW9ucyIsInVzZU5ld1VybFBhcnNlciIsIl9tYXhUaW1lTVMiLCJtYXhUaW1lTVMiLCJjYW5Tb3J0T25Kb2luVGFibGVzIiwiY29ubmVjdGlvblByb21pc2UiLCJlbmNvZGVkVXJpIiwiY2xpZW50Iiwib3B0aW9ucyIsInMiLCJkYiIsImRiTmFtZSIsIm9uIiwiY2F0Y2giLCJlcnIiLCJQcm9taXNlIiwicmVqZWN0IiwiaGFuZGxlRXJyb3IiLCJlcnJvciIsImNvZGUiLCJsb2dnZXIiLCJoYW5kbGVTaHV0ZG93biIsImNsb3NlIiwiX2FkYXB0aXZlQ29sbGVjdGlvbiIsIm5hbWUiLCJyYXdDb2xsZWN0aW9uIiwiTW9uZ29Db2xsZWN0aW9uIiwiX3NjaGVtYUNvbGxlY3Rpb24iLCJjbGFzc0V4aXN0cyIsImxpc3RDb2xsZWN0aW9ucyIsInRvQXJyYXkiLCJzZXRDbGFzc0xldmVsUGVybWlzc2lvbnMiLCJDTFBzIiwic2NoZW1hQ29sbGVjdGlvbiIsInVwZGF0ZVNjaGVtYSIsIiRzZXQiLCJzZXRJbmRleGVzV2l0aFNjaGVtYUZvcm1hdCIsInN1Ym1pdHRlZEluZGV4ZXMiLCJleGlzdGluZ0luZGV4ZXMiLCJyZXNvbHZlIiwiX2lkXyIsImRlbGV0ZVByb21pc2VzIiwiaW5zZXJ0ZWRJbmRleGVzIiwiZm9yRWFjaCIsImZpZWxkIiwiX19vcCIsIlBhcnNlIiwiRXJyb3IiLCJJTlZBTElEX1FVRVJZIiwicHJvbWlzZSIsImRyb3BJbmRleCIsInB1c2giLCJrZXkiLCJoYXNPd25Qcm9wZXJ0eSIsImluc2VydFByb21pc2UiLCJjcmVhdGVJbmRleGVzIiwiYWxsIiwic2V0SW5kZXhlc0Zyb21Nb25nbyIsImdldEluZGV4ZXMiLCJyZWR1Y2UiLCJvYmoiLCJpbmRleCIsIl9mdHMiLCJfZnRzeCIsIndlaWdodHMiLCJjcmVhdGVDbGFzcyIsImluc2VydFNjaGVtYSIsImFkZEZpZWxkSWZOb3RFeGlzdHMiLCJ0eXBlIiwiY3JlYXRlSW5kZXhlc0lmTmVlZGVkIiwiZGVsZXRlQ2xhc3MiLCJkcm9wIiwibWVzc2FnZSIsImZpbmRBbmREZWxldGVTY2hlbWEiLCJkZWxldGVBbGxDbGFzc2VzIiwiZmFzdCIsIm1hcCIsInJlbW92ZSIsImRlbGV0ZUZpZWxkcyIsImZpZWxkTmFtZXMiLCJtb25nb0Zvcm1hdE5hbWVzIiwiY29sbGVjdGlvblVwZGF0ZSIsInNjaGVtYVVwZGF0ZSIsInVwZGF0ZU1hbnkiLCJnZXRBbGxDbGFzc2VzIiwic2NoZW1hc0NvbGxlY3Rpb24iLCJfZmV0Y2hBbGxTY2hlbWFzRnJvbV9TQ0hFTUEiLCJnZXRDbGFzcyIsIl9mZXRjaE9uZVNjaGVtYUZyb21fU0NIRU1BIiwiY3JlYXRlT2JqZWN0Iiwib2JqZWN0IiwiaW5zZXJ0T25lIiwiRFVQTElDQVRFX1ZBTFVFIiwidW5kZXJseWluZ0Vycm9yIiwibWF0Y2hlcyIsIkFycmF5IiwiaXNBcnJheSIsInVzZXJJbmZvIiwiZHVwbGljYXRlZF9maWVsZCIsImRlbGV0ZU9iamVjdHNCeVF1ZXJ5IiwicXVlcnkiLCJtb25nb1doZXJlIiwiZGVsZXRlTWFueSIsInJlc3VsdCIsIm4iLCJPQkpFQ1RfTk9UX0ZPVU5EIiwiSU5URVJOQUxfU0VSVkVSX0VSUk9SIiwidXBkYXRlT2JqZWN0c0J5UXVlcnkiLCJ1cGRhdGUiLCJtb25nb1VwZGF0ZSIsImZpbmRPbmVBbmRVcGRhdGUiLCJfbW9uZ29Db2xsZWN0aW9uIiwiZmluZEFuZE1vZGlmeSIsIm5ldyIsInZhbHVlIiwidXBzZXJ0T25lT2JqZWN0IiwidXBzZXJ0T25lIiwiZmluZCIsInNraXAiLCJsaW1pdCIsInNvcnQiLCJyZWFkUHJlZmVyZW5jZSIsIm1vbmdvU29ydCIsIl8iLCJtYXBLZXlzIiwibW9uZ29LZXlzIiwibWVtbyIsIl9wYXJzZVJlYWRQcmVmZXJlbmNlIiwiY3JlYXRlVGV4dEluZGV4ZXNJZk5lZWRlZCIsIm9iamVjdHMiLCJlbnN1cmVVbmlxdWVuZXNzIiwiaW5kZXhDcmVhdGlvblJlcXVlc3QiLCJtb25nb0ZpZWxkTmFtZXMiLCJfZW5zdXJlU3BhcnNlVW5pcXVlSW5kZXhJbkJhY2tncm91bmQiLCJfcmF3RmluZCIsImNvdW50IiwiZGlzdGluY3QiLCJpc1BvaW50ZXJGaWVsZCIsInN1YnN0cmluZyIsImFnZ3JlZ2F0ZSIsInBpcGVsaW5lIiwic3RhZ2UiLCIkZ3JvdXAiLCJfcGFyc2VBZ2dyZWdhdGVHcm91cEFyZ3MiLCIkbWF0Y2giLCJfcGFyc2VBZ2dyZWdhdGVBcmdzIiwiJHByb2plY3QiLCJfcGFyc2VBZ2dyZWdhdGVQcm9qZWN0QXJncyIsInJlc3VsdHMiLCJzcGxpdCIsImlzRW1wdHkiLCJyZXR1cm5WYWx1ZSIsInRhcmdldENsYXNzIiwiX2NvbnZlcnRUb0RhdGUiLCJEYXRlIiwiUFJJTUFSWSIsIlBSSU1BUllfUFJFRkVSUkVEIiwiU0VDT05EQVJZIiwiU0VDT05EQVJZX1BSRUZFUlJFRCIsIk5FQVJFU1QiLCJwZXJmb3JtSW5pdGlhbGl6YXRpb24iLCJjcmVhdGVJbmRleCIsImJhY2tncm91bmQiLCIkdGV4dCIsImluZGV4TmFtZSIsInRleHRJbmRleCIsImRyb3BBbGxJbmRleGVzIiwiZHJvcEluZGV4ZXMiLCJ1cGRhdGVTY2hlbWFXaXRoSW5kZXhlcyIsImNsYXNzZXMiLCJwcm9taXNlcyJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7QUFLQTs7QUFJQTs7QUFTQTs7OztBQUVBOzs7O0FBQ0E7Ozs7QUFDQTs7Ozs7OztBQUxBOztBQUVBOzs7QUFLQTtBQUNBLE1BQU1BLFVBQVVDLFFBQVEsU0FBUixDQUFoQjtBQUNBLE1BQU1DLGNBQWNGLFFBQVFFLFdBQTVCO0FBQ0EsTUFBTUMsaUJBQWlCSCxRQUFRRyxjQUEvQjs7QUFFQSxNQUFNQyw0QkFBNEIsU0FBbEM7O0FBRUEsTUFBTUMsK0JBQStCQyxnQkFBZ0I7QUFDbkQsU0FBT0EsYUFBYUMsT0FBYixHQUNKQyxJQURJLENBQ0MsTUFBTUYsYUFBYUcsUUFBYixDQUFzQkMsV0FBdEIsRUFEUCxFQUVKRixJQUZJLENBRUNFLGVBQWU7QUFDbkIsV0FBT0EsWUFBWUMsTUFBWixDQUFtQkMsY0FBYztBQUN0QyxVQUFJQSxXQUFXQyxTQUFYLENBQXFCQyxLQUFyQixDQUEyQixZQUEzQixDQUFKLEVB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SixnQkFBWCxDQUE0QnRJLE9BQTVCLEVBRGYsRUFFSm9DLEtBRkksQ0FFRUMsT0FBTyxLQUFLRyxXQUFMLENBQWlCSCxHQUFqQixDQUZULENBQVA7QUFHRDs7QUFFRG9DLFlBQVU3RSxTQUFWLEVBQTZCd0YsS0FBN0IsRUFBeUM7QUFDdkMsV0FBTyxLQUFLdEMsbUJBQUwsQ0FBeUJsRCxTQUF6QixFQUNKZixJQURJLENBQ0NJLGNBQWNBLFdBQVdxSixnQkFBWCxDQUE0QjdELFNBQTVCLENBQXNDVyxLQUF0QyxDQURmLEVBRUpoRCxLQUZJLENBRUVDLE9BQU8sS0FBS0csV0FBTCxDQUFpQkgsR0FBakIsQ0FGVCxDQUFQO0FBR0Q7O0FBRUR3SixpQkFBZWpNLFNBQWYsRUFBa0M7QUFDaEMsV0FBTyxLQUFLa0QsbUJBQUwsQ0FBeUJsRCxTQUF6QixFQUNKZixJQURJLENBQ0NJLGNBQWNBLFdBQVdxSixnQkFBWCxDQUE0QndELFdBQTVCLEVBRGYsRUFFSjFKLEtBRkksQ0FFRUMsT0FBTyxLQUFLRyxXQUFMLENBQWlCSCxHQUFqQixDQUZULENBQVA7QUFHRDs7QUFFRDBKLDRCQUF3QztBQUN0QyxXQUFPLEtBQUtwRixhQUFMLEdBQ0o5SCxJQURJLENBQ0VtTixPQUFELElBQWE7QUFDakIsWUFBTUMsV0FBV0QsUUFBUTdGLEdBQVIsQ0FBYTNHLE1BQUQsSUFBWTtBQUN2QyxlQUFPLEtBQUt3RixtQkFBTCxDQUF5QnhGLE9BQU9JLFNBQWhDLENBQVA7QUFDRCxPQUZnQixDQUFqQjtBQUdBLGFBQU8wQyxRQUFReUMsR0FBUixDQUFZa0gsUUFBWixDQUFQO0FBQ0QsS0FOSSxFQU9KN0osS0FQSSxDQU9FQyxPQUFPLEtBQUtHLFdBQUwsQ0FBaUJILEdBQWpCLENBUFQsQ0FBUDtBQVFEO0FBeHRCd0Q7O1FBQTlDdEIsbUIsR0FBQUEsbUI7a0JBMnRCRUEsbUIiLCJmaWxlIjoiTW9uZ29TdG9yYWdlQWRhcHRlci5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEBmbG93XG5pbXBvcnQgTW9uZ29Db2xsZWN0aW9uICAgICAgIGZyb20gJy4vTW9uZ29Db2xsZWN0aW9uJztcbmltcG9ydCBNb25nb1NjaGVtYUNvbGxlY3Rpb24gZnJvbSAnLi9Nb25nb1NjaGVtYUNvbGxlY3Rpb24nO1xuaW1wb3J0IHsgU3RvcmFnZUFkYXB0ZXIgfSAgICBmcm9tICcuLi9TdG9yYWdlQWRhcHRlcic7XG5pbXBvcnQgdHlwZSB7IFNjaGVtYVR5cGUsXG4gIFF1ZXJ5VHlwZSxcbiAgU3RvcmFnZUNsYXNzLFxuICBRdWVyeU9wdGlvbnMgfSBmcm9tICcuLi9TdG9yYWdlQWRhcHRlcic7XG5pbXBvcnQge1xuICBwYXJzZSBhcyBwYXJzZVVybCxcbiAgZm9ybWF0IGFzIGZvcm1hdFVybCxcbn0gZnJvbSAnLi4vLi4vLi4vdmVuZG9yL21vbmdvZGJVcmwnO1xuaW1wb3J0IHtcbiAgcGFyc2VPYmplY3RUb01vbmdvT2JqZWN0Rm9yQ3JlYXRlLFxuICBtb25nb09iamVjdFRvUGFyc2VPYmplY3QsXG4gIHRyYW5zZm9ybUtleSxcbiAgdHJhbnNmb3JtV2hlcmUsXG4gIHRyYW5zZm9ybVVwZGF0ZSxcbiAgdHJhbnNmb3JtUG9pbnRlclN0cmluZyxcbn0gZnJvbSAnLi9Nb25nb1RyYW5zZm9ybSc7XG4vLyBAZmxvdy1kaXNhYmxlLW5leHRcbmltcG9ydCBQYXJzZSAgICAgICAgICAgICAgICAgZnJvbSAncGFyc2Uvbm9kZSc7XG4vLyBAZmxvdy1kaXNhYmxlLW5leHRcbmltcG9ydCBfICAgICAgICAgICAgICAgICAgICAgZnJvbSAnbG9kYXNoJztcbmltcG9ydCBkZWZhdWx0cyAgICAgICAgICAgICAgZnJvbSAnLi4vLi4vLi4vZGVmYXVsdHMnO1xuaW1wb3J0IGxvZ2dlciAgICAgICAgICAgICAgICBmcm9tICcuLi8uLi8uLi9sb2dnZXInO1xuXG4vLyBAZmxvdy1kaXNhYmxlLW5leHRcbmNvbnN0IG1vbmdvZGIgPSByZXF1aXJlKCdtb25nb2RiJyk7XG5jb25zdCBNb25nb0NsaWVudCA9IG1vbmdvZGIuTW9uZ29DbGllbnQ7XG5jb25zdCBSZWFkUHJlZmVyZW5jZSA9IG1vbmdvZGIuUmVhZFByZWZlcmVuY2U7XG5cbmNvbnN0IE1vbmdvU2NoZW1hQ29sbGVjdGlvbk5hbWUgPSAnX1NDSEVNQSc7XG5cbmNvbnN0IHN0b3JhZ2VBZGFwdGVyQWxsQ29sbGVjdGlvbnMgPSBtb25nb0FkYXB0ZXIgPT4ge1xuICByZXR1cm4gbW9uZ29BZGFwdGVyLmNvbm5lY3QoKVxuICAgIC50aGVuKCgpID0+IG1vbmdvQWRhcHRlci5kYXRhYmFzZS5jb2xsZWN0aW9ucygpKVxuICAgIC50aGVuKGNvbGxlY3Rpb25zID0+IHtcbiAgICAgIHJldHVybiBjb2xsZWN0aW9ucy5maWx0ZXIoY29sbGVjdGlvbiA9PiB7XG4gICAgICAgIGlmIChjb2xsZWN0aW9uLm5hbWVzcGFjZS5tYXRjaCgvXFwuc3lzdGVtXFwuLykpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgLy8gVE9ETzogSWYgeW91IGhhdmUgb25lIGFwcCB3aXRoIGEgY29sbGVjdGlvbiBwcmVmaXggdGhhdCBoYXBwZW5zIHRvIGJlIGEgcHJlZml4IG9mIGFub3RoZXJcbiAgICAgICAgLy8gYXBwcyBwcmVmaXgsIHRoaXMgd2lsbCBnbyB2ZXJ5IHZlcnkgYmFkbHkuIFdlIHNob3VsZCBmaXggdGhhdCBzb21laG93LlxuICAgICAgICByZXR1cm4gKGNvbGxlY3Rpb24uY29sbGVjdGlvbk5hbWUuaW5kZXhPZihtb25nb0FkYXB0ZXIuX2NvbGxlY3Rpb25QcmVmaXgpID09IDApO1xuICAgICAgfSk7XG4gICAgfSk7XG59XG5cbmNvbnN0IGNvbnZlcnRQYXJzZVNjaGVtYVRvTW9uZ29TY2hlbWEgPSAoey4uLnNjaGVtYX0pID0+IHtcbiAgZGVsZXRlIHNjaGVtYS5maWVsZHMuX3JwZXJtO1xuICBkZWxldGUgc2NoZW1hLmZpZWxkcy5fd3Blcm07XG5cbiAgaWYgKHNjaGVtYS5jbGFzc05hbWUgPT09ICdfVXNlcicpIHtcbiAgICAvLyBMZWdhY3kgbW9uZ28gYWRhcHRlciBrbm93cyBhYm91dCB0aGUgZGlmZmVyZW5jZSBiZXR3ZWVuIHBhc3N3b3JkIGFuZCBfaGFzaGVkX3Bhc3N3b3JkLlxuICAgIC8vIEZ1dHVyZSBkYXRhYmFzZSBhZGFwdGVycyB3aWxsIG9ubHkga25vdyBhYm91dCBfaGFzaGVkX3Bhc3N3b3JkLlxuICAgIC8vIE5vdGU6IFBhcnNlIFNlcnZlciB3aWxsIGJyaW5nIGJhY2sgcGFzc3dvcmQgd2l0aCBpbmplY3REZWZhdWx0U2NoZW1hLCBzbyB3ZSBkb24ndCBuZWVkXG4gICAgLy8gdG8gYWRkIF9oYXNoZWRfcGFzc3dvcmQgYmFjayBldmVyLlxuICAgIGRlbGV0ZSBzY2hlbWEuZmllbGRzLl9oYXNoZWRfcGFzc3dvcmQ7XG4gIH1cblxuICByZXR1cm4gc2NoZW1hO1xufVxuXG4vLyBSZXR1cm5zIHsgY29kZSwgZXJyb3IgfSBpZiBpbnZhbGlkLCBvciB7IHJlc3VsdCB9LCBhbiBvYmplY3Rcbi8vIHN1aXRhYmxlIGZvciBpbnNlcnRpbmcgaW50byBfU0NIRU1BIGNvbGxlY3Rpb24sIG90aGVyd2lzZS5cbmNvbnN0IG1vbmdvU2NoZW1hRnJvbUZpZWxkc0FuZENsYXNzTmFtZUFuZENMUCA9IChmaWVsZHMsIGNsYXNzTmFtZSwgY2xhc3NMZXZlbFBlcm1pc3Npb25zLCBpbmRleGVzKSA9PiB7XG4gIGNvbnN0IG1vbmdvT2JqZWN0ID0ge1xuICAgIF9pZDogY2xhc3NOYW1lLFxuICAgIG9iamVjdElkOiAnc3RyaW5nJyxcbiAgICB1cGRhdGVkQXQ6ICdzdHJpbmcnLFxuICAgIGNyZWF0ZWRBdDogJ3N0cmluZycsXG4gICAgX21ldGFkYXRhOiB1bmRlZmluZWQsXG4gIH07XG5cbiAgZm9yIChjb25zdCBmaWVsZE5hbWUgaW4gZmllbGRzKSB7XG4gICAgbW9uZ29PYmplY3RbZmllbGROYW1lXSA9IE1vbmdvU2NoZW1hQ29sbGVjdGlvbi5wYXJzZUZpZWxkVHlwZVRvTW9uZ29GaWVsZFR5cGUoZmllbGRzW2ZpZWxkTmFtZV0pO1xuICB9XG5cbiAgaWYgKHR5cGVvZiBjbGFzc0xldmVsUGVybWlzc2lvbnMgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgbW9uZ29PYmplY3QuX21ldGFkYXRhID0gbW9uZ29PYmplY3QuX21ldGFkYXRhIHx8IHt9O1xuICAgIGlmICghY2xhc3NMZXZlbFBlcm1pc3Npb25zKSB7XG4gICAgICBkZWxldGUgbW9uZ29PYmplY3QuX21ldGFkYXRhLmNsYXNzX3Blcm1pc3Npb25zO1xuICAgIH0gZWxzZSB7XG4gICAgICBtb25nb09iamVjdC5fbWV0YWRhdGEuY2xhc3NfcGVybWlzc2lvbnMgPSBjbGFzc0xldmVsUGVybWlzc2lvbnM7XG4gICAgfVxuICB9XG5cbiAgaWYgKGluZGV4ZXMgJiYgdHlwZW9mIGluZGV4ZXMgPT09ICdvYmplY3QnICYmIE9iamVjdC5rZXlzKGluZGV4ZXMpLmxlbmd0aCA+IDApIHtcbiAgICBtb25nb09iamVjdC5fbWV0YWRhdGEgPSBtb25nb09iamVjdC5fbWV0YWRhdGEgfHwge307XG4gICAgbW9uZ29PYmplY3QuX21ldGFkYXRhLmluZGV4ZXMgPSBpbmRleGVzO1xuICB9XG5cbiAgaWYgKCFtb25nb09iamVjdC5fbWV0YWRhdGEpIHsgLy8gY2xlYW51cCB0aGUgdW51c2VkIF9tZXRhZGF0YVxuICAgIGRlbGV0ZSBtb25nb09iamVjdC5fbWV0YWRhdGE7XG4gIH1cblxuICByZXR1cm4gbW9uZ29PYmplY3Q7XG59XG5cblxuZXhwb3J0IGNsYXNzIE1vbmdvU3RvcmFnZUFkYXB0ZXIgaW1wbGVtZW50cyBTdG9yYWdlQWRhcHRlciB7XG4gIC8vIFByaXZhdGVcbiAgX3VyaTogc3RyaW5nO1xuICBfY29sbGVjdGlvblByZWZpeDogc3RyaW5nO1xuICBfbW9uZ29PcHRpb25zOiBPYmplY3Q7XG4gIC8vIFB1YmxpY1xuICBjb25uZWN0aW9uUHJvbWlzZTogUHJvbWlzZTxhbnk+O1xuICBkYXRhYmFzZTogYW55O1xuICBjbGllbnQ6IE1vbmdvQ2xpZW50O1xuICBfbWF4VGltZU1TOiA/bnVtYmVyO1xuICBjYW5Tb3J0T25Kb2luVGFibGVzOiBib29sZWFuO1xuXG4gIGNvbnN0cnVjdG9yKHtcbiAgICB1cmkgPSBkZWZhdWx0cy5EZWZhdWx0TW9uZ29VUkksXG4gICAgY29sbGVjdGlvblByZWZpeCA9ICcnLFxuICAgIG1vbmdvT3B0aW9ucyA9IHt9LFxuICB9OiBhbnkpIHtcbiAgICB0aGlzLl91cmkgPSB1cmk7XG4gICAgdGhpcy5fY29sbGVjdGlvblByZWZpeCA9IGNvbGxlY3Rpb25QcmVmaXg7XG4gICAgdGhpcy5fbW9uZ29PcHRpb25zID0gbW9uZ29PcHRpb25zO1xuICAgIHRoaXMuX21vbmdvT3B0aW9ucy51c2VOZXdVcmxQYXJzZXIgPSB0cnVlO1xuXG4gICAgLy8gTWF4VGltZU1TIGlzIG5vdCBhIGdsb2JhbCBNb25nb0RCIGNsaWVudCBvcHRpb24sIGl0IGlzIGFwcGxpZWQgcGVyIG9wZXJhdGlvbi5cbiAgICB0aGlzLl9tYXhUaW1lTVMgPSBtb25nb09wdGlvbnMubWF4VGltZU1TO1xuICAgIHRoaXMuY2FuU29ydE9uSm9pblRhYmxlcyA9IHRydWU7XG4gICAgZGVsZXRlIG1vbmdvT3B0aW9ucy5tYXhUaW1lTVM7XG4gIH1cblxuICBjb25uZWN0KCkge1xuICAgIGlmICh0aGlzLmNvbm5lY3Rpb25Qcm9taXNlKSB7XG4gICAgICByZXR1cm4gdGhpcy5jb25uZWN0aW9uUHJvbWlzZTtcbiAgICB9XG5cbiAgICAvLyBwYXJzaW5nIGFuZCByZS1mb3JtYXR0aW5nIGNhdXNlcyB0aGUgYXV0aCB2YWx1ZSAoaWYgdGhlcmUpIHRvIGdldCBVUklcbiAgICAvLyBlbmNvZGVkXG4gICAgY29uc3QgZW5jb2RlZFVyaSA9IGZvcm1hdFVybChwYXJzZVVybCh0aGlzLl91cmkpKTtcblxuICAgIHRoaXMuY29ubmVjdGlvblByb21pc2UgPSBNb25nb0NsaWVudC5jb25uZWN0KGVuY29kZWRVcmksIHRoaXMuX21vbmdvT3B0aW9ucykudGhlbihjbGllbnQgPT4ge1xuICAgICAgLy8gU3RhcnRpbmcgbW9uZ29EQiAzLjAsIHRoZSBNb25nb0NsaWVudC5jb25uZWN0IGRvbid0IHJldHVybiBhIERCIGFueW1vcmUgYnV0IGEgY2xpZW50XG4gICAgICAvLyBGb3J0dW5hdGVseSwgd2UgY2FuIGdldCBiYWNrIHRoZSBvcHRpb25zIGFuZCB1c2UgdGhlbSB0byBzZWxlY3QgdGhlIHByb3BlciBEQi5cbiAgICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9tb25nb2RiL25vZGUtbW9uZ29kYi1uYXRpdmUvYmxvYi8yYzM1ZDc2ZjA4NTc0MjI1YjhkYjAyZDdiZWY2ODcxMjNlNmJiMDE4L2xpYi9tb25nb19jbGllbnQuanMjTDg4NVxuICAgICAgY29uc3Qgb3B0aW9ucyA9IGNsaWVudC5zLm9wdGlvbnM7XG4gICAgICBjb25zdCBkYXRhYmFzZSA9IGNsaWVudC5kYihvcHRpb25zLmRiTmFtZSk7XG4gICAgICBpZiAoIWRhdGFiYXNlKSB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLmNvbm5lY3Rpb25Qcm9taXNlO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBkYXRhYmFzZS5vbignZXJyb3InLCAoKSA9PiB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLmNvbm5lY3Rpb25Qcm9taXNlO1xuICAgICAgfSk7XG4gICAgICBkYXRhYmFzZS5vbignY2xvc2UnLCAoKSA9PiB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLmNvbm5lY3Rpb25Qcm9taXNlO1xuICAgICAgfSk7XG4gICAgICB0aGlzLmNsaWVudCA9IGNsaWVudDtcbiAgICAgIHRoaXMuZGF0YWJhc2UgPSBkYXRhYmFzZTtcbiAgICB9KS5jYXRjaCgoZXJyKSA9PiB7XG4gICAgICBkZWxldGUgdGhpcy5jb25uZWN0aW9uUHJvbWlzZTtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChlcnIpO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHRoaXMuY29ubmVjdGlvblByb21pc2U7XG4gIH1cblxuICBoYW5kbGVFcnJvcjxUPihlcnJvcjogPyhFcnJvciB8IFBhcnNlLkVycm9yKSk6IFByb21pc2U8VD4ge1xuICAgIGlmIChlcnJvciAmJiBlcnJvci5jb2RlID09PSAxMykgeyAvLyBVbmF1dGhvcml6ZWQgZXJyb3JcbiAgICAgIGRlbGV0ZSB0aGlzLmNsaWVudDtcbiAgICAgIGRlbGV0ZSB0aGlzLmRhdGFiYXNlO1xuICAgICAgZGVsZXRlIHRoaXMuY29ubmVjdGlvblByb21pc2U7XG4gICAgICBsb2dnZXIuZXJyb3IoJ1JlY2VpdmVkIHVuYXV0aG9yaXplZCBlcnJvcicsIHsgZXJyb3I6IGVycm9yIH0pO1xuICAgIH1cbiAgICB0aHJvdyBlcnJvcjtcbiAgfVxuXG4gIGhhbmRsZVNodXRkb3duKCkge1xuICAgIGlmICghdGhpcy5jbGllbnQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5jbGllbnQuY2xvc2UoZmFsc2UpO1xuICB9XG5cbiAgX2FkYXB0aXZlQ29sbGVjdGlvbihuYW1lOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5jb25uZWN0KClcbiAgICAgIC50aGVuKCgpID0+IHRoaXMuZGF0YWJhc2UuY29sbGVjdGlvbih0aGlzLl9jb2xsZWN0aW9uUHJlZml4ICsgbmFtZSkpXG4gICAgICAudGhlbihyYXdDb2xsZWN0aW9uID0+IG5ldyBNb25nb0NvbGxlY3Rpb24ocmF3Q29sbGVjdGlvbikpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICBfc2NoZW1hQ29sbGVjdGlvbigpOiBQcm9taXNlPE1vbmdvU2NoZW1hQ29sbGVjdGlvbj4ge1xuICAgIHJldHVybiB0aGlzLmNvbm5lY3QoKVxuICAgICAgLnRoZW4oKCkgPT4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKE1vbmdvU2NoZW1hQ29sbGVjdGlvbk5hbWUpKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBuZXcgTW9uZ29TY2hlbWFDb2xsZWN0aW9uKGNvbGxlY3Rpb24pKTtcbiAgfVxuXG4gIGNsYXNzRXhpc3RzKG5hbWU6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLmNvbm5lY3QoKS50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmRhdGFiYXNlLmxpc3RDb2xsZWN0aW9ucyh7IG5hbWU6IHRoaXMuX2NvbGxlY3Rpb25QcmVmaXggKyBuYW1lIH0pLnRvQXJyYXkoKTtcbiAgICB9KS50aGVuKGNvbGxlY3Rpb25zID0+IHtcbiAgICAgIHJldHVybiBjb2xsZWN0aW9ucy5sZW5ndGggPiAwO1xuICAgIH0pLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgc2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zKGNsYXNzTmFtZTogc3RyaW5nLCBDTFBzOiBhbnkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gdGhpcy5fc2NoZW1hQ29sbGVjdGlvbigpXG4gICAgICAudGhlbihzY2hlbWFDb2xsZWN0aW9uID0+IHNjaGVtYUNvbGxlY3Rpb24udXBkYXRlU2NoZW1hKGNsYXNzTmFtZSwge1xuICAgICAgICAkc2V0OiB7ICdfbWV0YWRhdGEuY2xhc3NfcGVybWlzc2lvbnMnOiBDTFBzIH1cbiAgICAgIH0pKS5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIHNldEluZGV4ZXNXaXRoU2NoZW1hRm9ybWF0KGNsYXNzTmFtZTogc3RyaW5nLCBzdWJtaXR0ZWRJbmRleGVzOiBhbnksIGV4aXN0aW5nSW5kZXhlczogYW55ID0ge30sIGZpZWxkczogYW55KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHN1Ym1pdHRlZEluZGV4ZXMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cbiAgICBpZiAoT2JqZWN0LmtleXMoZXhpc3RpbmdJbmRleGVzKS5sZW5ndGggPT09IDApIHtcbiAgICAgIGV4aXN0aW5nSW5kZXhlcyA9IHsgX2lkXzogeyBfaWQ6IDF9IH07XG4gICAgfVxuICAgIGNvbnN0IGRlbGV0ZVByb21pc2VzID0gW107XG4gICAgY29uc3QgaW5zZXJ0ZWRJbmRleGVzID0gW107XG4gICAgT2JqZWN0LmtleXMoc3VibWl0dGVkSW5kZXhlcykuZm9yRWFjaChuYW1lID0+IHtcbiAgICAgIGNvbnN0IGZpZWxkID0gc3VibWl0dGVkSW5kZXhlc1tuYW1lXTtcbiAgICAgIGlmIChleGlzdGluZ0luZGV4ZXNbbmFtZV0gJiYgZmllbGQuX19vcCAhPT0gJ0RlbGV0ZScpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksIGBJbmRleCAke25hbWV9IGV4aXN0cywgY2Fubm90IHVwZGF0ZS5gKTtcbiAgICAgIH1cbiAgICAgIGlmICghZXhpc3RpbmdJbmRleGVzW25hbWVdICYmIGZpZWxkLl9fb3AgPT09ICdEZWxldGUnKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLCBgSW5kZXggJHtuYW1lfSBkb2VzIG5vdCBleGlzdCwgY2Fubm90IGRlbGV0ZS5gKTtcbiAgICAgIH1cbiAgICAgIGlmIChmaWVsZC5fX29wID09PSAnRGVsZXRlJykge1xuICAgICAgICBjb25zdCBwcm9taXNlID0gdGhpcy5kcm9wSW5kZXgoY2xhc3NOYW1lLCBuYW1lKTtcbiAgICAgICAgZGVsZXRlUHJvbWlzZXMucHVzaChwcm9taXNlKTtcbiAgICAgICAgZGVsZXRlIGV4aXN0aW5nSW5kZXhlc1tuYW1lXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIE9iamVjdC5rZXlzKGZpZWxkKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgICAgaWYgKCFmaWVsZHMuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksIGBGaWVsZCAke2tleX0gZG9lcyBub3QgZXhpc3QsIGNhbm5vdCBhZGQgaW5kZXguYCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgZXhpc3RpbmdJbmRleGVzW25hbWVdID0gZmllbGQ7XG4gICAgICAgIGluc2VydGVkSW5kZXhlcy5wdXNoKHtcbiAgICAgICAgICBrZXk6IGZpZWxkLFxuICAgICAgICAgIG5hbWUsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGxldCBpbnNlcnRQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgaWYgKGluc2VydGVkSW5kZXhlcy5sZW5ndGggPiAwKSB7XG4gICAgICBpbnNlcnRQcm9taXNlID0gdGhpcy5jcmVhdGVJbmRleGVzKGNsYXNzTmFtZSwgaW5zZXJ0ZWRJbmRleGVzKTtcbiAgICB9XG4gICAgcmV0dXJuIFByb21pc2UuYWxsKGRlbGV0ZVByb21pc2VzKVxuICAgICAgLnRoZW4oKCkgPT4gaW5zZXJ0UHJvbWlzZSlcbiAgICAgIC50aGVuKCgpID0+IHRoaXMuX3NjaGVtYUNvbGxlY3Rpb24oKSlcbiAgICAgIC50aGVuKHNjaGVtYUNvbGxlY3Rpb24gPT4gc2NoZW1hQ29sbGVjdGlvbi51cGRhdGVTY2hlbWEoY2xhc3NOYW1lLCB7XG4gICAgICAgICRzZXQ6IHsgJ19tZXRhZGF0YS5pbmRleGVzJzogIGV4aXN0aW5nSW5kZXhlcyB9XG4gICAgICB9KSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIHNldEluZGV4ZXNGcm9tTW9uZ28oY2xhc3NOYW1lOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRJbmRleGVzKGNsYXNzTmFtZSkudGhlbigoaW5kZXhlcykgPT4ge1xuICAgICAgaW5kZXhlcyA9IGluZGV4ZXMucmVkdWNlKChvYmosIGluZGV4KSA9PiB7XG4gICAgICAgIGlmIChpbmRleC5rZXkuX2Z0cykge1xuICAgICAgICAgIGRlbGV0ZSBpbmRleC5rZXkuX2Z0cztcbiAgICAgICAgICBkZWxldGUgaW5kZXgua2V5Ll9mdHN4O1xuICAgICAgICAgIGZvciAoY29uc3QgZmllbGQgaW4gaW5kZXgud2VpZ2h0cykge1xuICAgICAgICAgICAgaW5kZXgua2V5W2ZpZWxkXSA9ICd0ZXh0JztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgb2JqW2luZGV4Lm5hbWVdID0gaW5kZXgua2V5O1xuICAgICAgICByZXR1cm4gb2JqO1xuICAgICAgfSwge30pO1xuICAgICAgcmV0dXJuIHRoaXMuX3NjaGVtYUNvbGxlY3Rpb24oKVxuICAgICAgICAudGhlbihzY2hlbWFDb2xsZWN0aW9uID0+IHNjaGVtYUNvbGxlY3Rpb24udXBkYXRlU2NoZW1hKGNsYXNzTmFtZSwge1xuICAgICAgICAgICRzZXQ6IHsgJ19tZXRhZGF0YS5pbmRleGVzJzogaW5kZXhlcyB9XG4gICAgICAgIH0pKTtcbiAgICB9KVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpXG4gICAgICAuY2F0Y2goKCkgPT4ge1xuICAgICAgICAvLyBJZ25vcmUgaWYgY29sbGVjdGlvbiBub3QgZm91bmRcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgfSk7XG4gIH1cblxuICBjcmVhdGVDbGFzcyhjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgc2NoZW1hID0gY29udmVydFBhcnNlU2NoZW1hVG9Nb25nb1NjaGVtYShzY2hlbWEpO1xuICAgIGNvbnN0IG1vbmdvT2JqZWN0ID0gbW9uZ29TY2hlbWFGcm9tRmllbGRzQW5kQ2xhc3NOYW1lQW5kQ0xQKHNjaGVtYS5maWVsZHMsIGNsYXNzTmFtZSwgc2NoZW1hLmNsYXNzTGV2ZWxQZXJtaXNzaW9ucywgc2NoZW1hLmluZGV4ZXMpO1xuICAgIG1vbmdvT2JqZWN0Ll9pZCA9IGNsYXNzTmFtZTtcbiAgICByZXR1cm4gdGhpcy5zZXRJbmRleGVzV2l0aFNjaGVtYUZvcm1hdChjbGFzc05hbWUsIHNjaGVtYS5pbmRleGVzLCB7fSwgc2NoZW1hLmZpZWxkcylcbiAgICAgIC50aGVuKCgpID0+IHRoaXMuX3NjaGVtYUNvbGxlY3Rpb24oKSlcbiAgICAgIC50aGVuKHNjaGVtYUNvbGxlY3Rpb24gPT4gc2NoZW1hQ29sbGVjdGlvbi5pbnNlcnRTY2hlbWEobW9uZ29PYmplY3QpKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgYWRkRmllbGRJZk5vdEV4aXN0cyhjbGFzc05hbWU6IHN0cmluZywgZmllbGROYW1lOiBzdHJpbmcsIHR5cGU6IGFueSk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiB0aGlzLl9zY2hlbWFDb2xsZWN0aW9uKClcbiAgICAgIC50aGVuKHNjaGVtYUNvbGxlY3Rpb24gPT4gc2NoZW1hQ29sbGVjdGlvbi5hZGRGaWVsZElmTm90RXhpc3RzKGNsYXNzTmFtZSwgZmllbGROYW1lLCB0eXBlKSlcbiAgICAgIC50aGVuKCgpID0+IHRoaXMuY3JlYXRlSW5kZXhlc0lmTmVlZGVkKGNsYXNzTmFtZSwgZmllbGROYW1lLCB0eXBlKSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIC8vIERyb3BzIGEgY29sbGVjdGlvbi4gUmVzb2x2ZXMgd2l0aCB0cnVlIGlmIGl0IHdhcyBhIFBhcnNlIFNjaGVtYSAoZWcuIF9Vc2VyLCBDdXN0b20sIGV0Yy4pXG4gIC8vIGFuZCByZXNvbHZlcyB3aXRoIGZhbHNlIGlmIGl0IHdhc24ndCAoZWcuIGEgam9pbiB0YWJsZSkuIFJlamVjdHMgaWYgZGVsZXRpb24gd2FzIGltcG9zc2libGUuXG4gIGRlbGV0ZUNsYXNzKGNsYXNzTmFtZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24uZHJvcCgpKVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgIC8vICducyBub3QgZm91bmQnIG1lYW5zIGNvbGxlY3Rpb24gd2FzIGFscmVhZHkgZ29uZS4gSWdub3JlIGRlbGV0aW9uIGF0dGVtcHQuXG4gICAgICAgIGlmIChlcnJvci5tZXNzYWdlID09ICducyBub3QgZm91bmQnKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSlcbiAgICAvLyBXZSd2ZSBkcm9wcGVkIHRoZSBjb2xsZWN0aW9uLCBub3cgcmVtb3ZlIHRoZSBfU0NIRU1BIGRvY3VtZW50XG4gICAgICAudGhlbigoKSA9PiB0aGlzLl9zY2hlbWFDb2xsZWN0aW9uKCkpXG4gICAgICAudGhlbihzY2hlbWFDb2xsZWN0aW9uID0+IHNjaGVtYUNvbGxlY3Rpb24uZmluZEFuZERlbGV0ZVNjaGVtYShjbGFzc05hbWUpKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgZGVsZXRlQWxsQ2xhc3NlcyhmYXN0OiBib29sZWFuKSB7XG4gICAgcmV0dXJuIHN0b3JhZ2VBZGFwdGVyQWxsQ29sbGVjdGlvbnModGhpcylcbiAgICAgIC50aGVuKGNvbGxlY3Rpb25zID0+IFByb21pc2UuYWxsKGNvbGxlY3Rpb25zLm1hcChjb2xsZWN0aW9uID0+IGZhc3QgPyBjb2xsZWN0aW9uLnJlbW92ZSh7fSkgOiBjb2xsZWN0aW9uLmRyb3AoKSkpKTtcbiAgfVxuXG4gIC8vIFJlbW92ZSB0aGUgY29sdW1uIGFuZCBhbGwgdGhlIGRhdGEuIEZvciBSZWxhdGlvbnMsIHRoZSBfSm9pbiBjb2xsZWN0aW9uIGlzIGhhbmRsZWRcbiAgLy8gc3BlY2lhbGx5LCB0aGlzIGZ1bmN0aW9uIGRvZXMgbm90IGRlbGV0ZSBfSm9pbiBjb2x1bW5zLiBJdCBzaG91bGQsIGhvd2V2ZXIsIGluZGljYXRlXG4gIC8vIHRoYXQgdGhlIHJlbGF0aW9uIGZpZWxkcyBkb2VzIG5vdCBleGlzdCBhbnltb3JlLiBJbiBtb25nbywgdGhpcyBtZWFucyByZW1vdmluZyBpdCBmcm9tXG4gIC8vIHRoZSBfU0NIRU1BIGNvbGxlY3Rpb24uICBUaGVyZSBzaG91bGQgYmUgbm8gYWN0dWFsIGRhdGEgaW4gdGhlIGNvbGxlY3Rpb24gdW5kZXIgdGhlIHNhbWUgbmFtZVxuICAvLyBhcyB0aGUgcmVsYXRpb24gY29sdW1uLCBzbyBpdCdzIGZpbmUgdG8gYXR0ZW1wdCB0byBkZWxldGUgaXQuIElmIHRoZSBmaWVsZHMgbGlzdGVkIHRvIGJlXG4gIC8vIGRlbGV0ZWQgZG8gbm90IGV4aXN0LCB0aGlzIGZ1bmN0aW9uIHNob3VsZCByZXR1cm4gc3VjY2Vzc2Z1bGx5IGFueXdheXMuIENoZWNraW5nIGZvclxuICAvLyBhdHRlbXB0cyB0byBkZWxldGUgbm9uLWV4aXN0ZW50IGZpZWxkcyBpcyB0aGUgcmVzcG9uc2liaWxpdHkgb2YgUGFyc2UgU2VydmVyLlxuXG4gIC8vIFBvaW50ZXIgZmllbGQgbmFtZXMgYXJlIHBhc3NlZCBmb3IgbGVnYWN5IHJlYXNvbnM6IHRoZSBvcmlnaW5hbCBtb25nb1xuICAvLyBmb3JtYXQgc3RvcmVkIHBvaW50ZXIgZmllbGQgbmFtZXMgZGlmZmVyZW50bHkgaW4gdGhlIGRhdGFiYXNlLCBhbmQgdGhlcmVmb3JlXG4gIC8vIG5lZWRlZCB0byBrbm93IHRoZSB0eXBlIG9mIHRoZSBmaWVsZCBiZWZvcmUgaXQgY291bGQgZGVsZXRlIGl0LiBGdXR1cmUgZGF0YWJhc2VcbiAgLy8gYWRhcHRlcnMgc2hvdWxkIGlnbm9yZSB0aGUgcG9pbnRlckZpZWxkTmFtZXMgYXJndW1lbnQuIEFsbCB0aGUgZmllbGQgbmFtZXMgYXJlIGluXG4gIC8vIGZpZWxkTmFtZXMsIHRoZXkgc2hvdyB1cCBhZGRpdGlvbmFsbHkgaW4gdGhlIHBvaW50ZXJGaWVsZE5hbWVzIGRhdGFiYXNlIGZvciB1c2VcbiAgLy8gYnkgdGhlIG1vbmdvIGFkYXB0ZXIsIHdoaWNoIGRlYWxzIHdpdGggdGhlIGxlZ2FjeSBtb25nbyBmb3JtYXQuXG5cbiAgLy8gVGhpcyBmdW5jdGlvbiBpcyBub3Qgb2JsaWdhdGVkIHRvIGRlbGV0ZSBmaWVsZHMgYXRvbWljYWxseS4gSXQgaXMgZ2l2ZW4gdGhlIGZpZWxkXG4gIC8vIG5hbWVzIGluIGEgbGlzdCBzbyB0aGF0IGRhdGFiYXNlcyB0aGF0IGFyZSBjYXBhYmxlIG9mIGRlbGV0aW5nIGZpZWxkcyBhdG9taWNhbGx5XG4gIC8vIG1heSBkbyBzby5cblxuICAvLyBSZXR1cm5zIGEgUHJvbWlzZS5cbiAgZGVsZXRlRmllbGRzKGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIGZpZWxkTmFtZXM6IHN0cmluZ1tdKSB7XG4gICAgY29uc3QgbW9uZ29Gb3JtYXROYW1lcyA9IGZpZWxkTmFtZXMubWFwKGZpZWxkTmFtZSA9PiB7XG4gICAgICBpZiAoc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdQb2ludGVyJykge1xuICAgICAgICByZXR1cm4gYF9wXyR7ZmllbGROYW1lfWBcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBmaWVsZE5hbWU7XG4gICAgICB9XG4gICAgfSk7XG4gICAgY29uc3QgY29sbGVjdGlvblVwZGF0ZSA9IHsgJyR1bnNldCcgOiB7fSB9O1xuICAgIG1vbmdvRm9ybWF0TmFtZXMuZm9yRWFjaChuYW1lID0+IHtcbiAgICAgIGNvbGxlY3Rpb25VcGRhdGVbJyR1bnNldCddW25hbWVdID0gbnVsbDtcbiAgICB9KTtcblxuICAgIGNvbnN0IHNjaGVtYVVwZGF0ZSA9IHsgJyR1bnNldCcgOiB7fSB9O1xuICAgIGZpZWxkTmFtZXMuZm9yRWFjaChuYW1lID0+IHtcbiAgICAgIHNjaGVtYVVwZGF0ZVsnJHVuc2V0J11bbmFtZV0gPSBudWxsO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24udXBkYXRlTWFueSh7fSwgY29sbGVjdGlvblVwZGF0ZSkpXG4gICAgICAudGhlbigoKSA9PiB0aGlzLl9zY2hlbWFDb2xsZWN0aW9uKCkpXG4gICAgICAudGhlbihzY2hlbWFDb2xsZWN0aW9uID0+IHNjaGVtYUNvbGxlY3Rpb24udXBkYXRlU2NoZW1hKGNsYXNzTmFtZSwgc2NoZW1hVXBkYXRlKSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIC8vIFJldHVybiBhIHByb21pc2UgZm9yIGFsbCBzY2hlbWFzIGtub3duIHRvIHRoaXMgYWRhcHRlciwgaW4gUGFyc2UgZm9ybWF0LiBJbiBjYXNlIHRoZVxuICAvLyBzY2hlbWFzIGNhbm5vdCBiZSByZXRyaWV2ZWQsIHJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVqZWN0cy4gUmVxdWlyZW1lbnRzIGZvciB0aGVcbiAgLy8gcmVqZWN0aW9uIHJlYXNvbiBhcmUgVEJELlxuICBnZXRBbGxDbGFzc2VzKCk6IFByb21pc2U8U3RvcmFnZUNsYXNzW10+IHtcbiAgICByZXR1cm4gdGhpcy5fc2NoZW1hQ29sbGVjdGlvbigpLnRoZW4oc2NoZW1hc0NvbGxlY3Rpb24gPT4gc2NoZW1hc0NvbGxlY3Rpb24uX2ZldGNoQWxsU2NoZW1hc0Zyb21fU0NIRU1BKCkpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICAvLyBSZXR1cm4gYSBwcm9taXNlIGZvciB0aGUgc2NoZW1hIHdpdGggdGhlIGdpdmVuIG5hbWUsIGluIFBhcnNlIGZvcm1hdC4gSWZcbiAgLy8gdGhpcyBhZGFwdGVyIGRvZXNuJ3Qga25vdyBhYm91dCB0aGUgc2NoZW1hLCByZXR1cm4gYSBwcm9taXNlIHRoYXQgcmVqZWN0cyB3aXRoXG4gIC8vIHVuZGVmaW5lZCBhcyB0aGUgcmVhc29uLlxuICBnZXRDbGFzcyhjbGFzc05hbWU6IHN0cmluZyk6IFByb21pc2U8U3RvcmFnZUNsYXNzPiB7XG4gICAgcmV0dXJuIHRoaXMuX3NjaGVtYUNvbGxlY3Rpb24oKVxuICAgICAgLnRoZW4oc2NoZW1hc0NvbGxlY3Rpb24gPT4gc2NoZW1hc0NvbGxlY3Rpb24uX2ZldGNoT25lU2NoZW1hRnJvbV9TQ0hFTUEoY2xhc3NOYW1lKSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIC8vIFRPRE86IEFzIHlldCBub3QgcGFydGljdWxhcmx5IHdlbGwgc3BlY2lmaWVkLiBDcmVhdGVzIGFuIG9iamVjdC4gTWF5YmUgc2hvdWxkbid0IGV2ZW4gbmVlZCB0aGUgc2NoZW1hLFxuICAvLyBhbmQgc2hvdWxkIGluZmVyIGZyb20gdGhlIHR5cGUuIE9yIG1heWJlIGRvZXMgbmVlZCB0aGUgc2NoZW1hIGZvciB2YWxpZGF0aW9ucy4gT3IgbWF5YmUgbmVlZHNcbiAgLy8gdGhlIHNjaGVtYSBvbmx5IGZvciB0aGUgbGVnYWN5IG1vbmdvIGZvcm1hdC4gV2UnbGwgZmlndXJlIHRoYXQgb3V0IGxhdGVyLlxuICBjcmVhdGVPYmplY3QoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgb2JqZWN0OiBhbnkpIHtcbiAgICBzY2hlbWEgPSBjb252ZXJ0UGFyc2VTY2hlbWFUb01vbmdvU2NoZW1hKHNjaGVtYSk7XG4gICAgY29uc3QgbW9uZ29PYmplY3QgPSBwYXJzZU9iamVjdFRvTW9uZ29PYmplY3RGb3JDcmVhdGUoY2xhc3NOYW1lLCBvYmplY3QsIHNjaGVtYSk7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24uaW5zZXJ0T25lKG1vbmdvT2JqZWN0KSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlID09PSAxMTAwMCkgeyAvLyBEdXBsaWNhdGUgdmFsdWVcbiAgICAgICAgICBjb25zdCBlcnIgPSBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuRFVQTElDQVRFX1ZBTFVFLCAnQSBkdXBsaWNhdGUgdmFsdWUgZm9yIGEgZmllbGQgd2l0aCB1bmlxdWUgdmFsdWVzIHdhcyBwcm92aWRlZCcpO1xuICAgICAgICAgIGVyci51bmRlcmx5aW5nRXJyb3IgPSBlcnJvcjtcbiAgICAgICAgICBpZiAoZXJyb3IubWVzc2FnZSkge1xuICAgICAgICAgICAgY29uc3QgbWF0Y2hlcyA9IGVycm9yLm1lc3NhZ2UubWF0Y2goL2luZGV4OltcXHNhLXpBLVowLTlfXFwtXFwuXStcXCQ/KFthLXpBLVpfLV0rKV8xLyk7XG4gICAgICAgICAgICBpZiAobWF0Y2hlcyAmJiBBcnJheS5pc0FycmF5KG1hdGNoZXMpKSB7XG4gICAgICAgICAgICAgIGVyci51c2VySW5mbyA9IHsgZHVwbGljYXRlZF9maWVsZDogbWF0Y2hlc1sxXSB9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgLy8gUmVtb3ZlIGFsbCBvYmplY3RzIHRoYXQgbWF0Y2ggdGhlIGdpdmVuIFBhcnNlIFF1ZXJ5LlxuICAvLyBJZiBubyBvYmplY3RzIG1hdGNoLCByZWplY3Qgd2l0aCBPQkpFQ1RfTk9UX0ZPVU5ELiBJZiBvYmplY3RzIGFyZSBmb3VuZCBhbmQgZGVsZXRlZCwgcmVzb2x2ZSB3aXRoIHVuZGVmaW5lZC5cbiAgLy8gSWYgdGhlcmUgaXMgc29tZSBvdGhlciBlcnJvciwgcmVqZWN0IHdpdGggSU5URVJOQUxfU0VSVkVSX0VSUk9SLlxuICBkZWxldGVPYmplY3RzQnlRdWVyeShjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBxdWVyeTogUXVlcnlUeXBlKSB7XG4gICAgc2NoZW1hID0gY29udmVydFBhcnNlU2NoZW1hVG9Nb25nb1NjaGVtYShzY2hlbWEpO1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiB7XG4gICAgICAgIGNvbnN0IG1vbmdvV2hlcmUgPSB0cmFuc2Zvcm1XaGVyZShjbGFzc05hbWUsIHF1ZXJ5LCBzY2hlbWEpO1xuICAgICAgICByZXR1cm4gY29sbGVjdGlvbi5kZWxldGVNYW55KG1vbmdvV2hlcmUpXG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpXG4gICAgICAudGhlbigoeyByZXN1bHQgfSkgPT4ge1xuICAgICAgICBpZiAocmVzdWx0Lm4gPT09IDApIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCwgJ09iamVjdCBub3QgZm91bmQuJyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgfSwgKCkgPT4ge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5URVJOQUxfU0VSVkVSX0VSUk9SLCAnRGF0YWJhc2UgYWRhcHRlciBlcnJvcicpO1xuICAgICAgfSk7XG4gIH1cblxuICAvLyBBcHBseSB0aGUgdXBkYXRlIHRvIGFsbCBvYmplY3RzIHRoYXQgbWF0Y2ggdGhlIGdpdmVuIFBhcnNlIFF1ZXJ5LlxuICB1cGRhdGVPYmplY3RzQnlRdWVyeShjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBxdWVyeTogUXVlcnlUeXBlLCB1cGRhdGU6IGFueSkge1xuICAgIHNjaGVtYSA9IGNvbnZlcnRQYXJzZVNjaGVtYVRvTW9uZ29TY2hlbWEoc2NoZW1hKTtcbiAgICBjb25zdCBtb25nb1VwZGF0ZSA9IHRyYW5zZm9ybVVwZGF0ZShjbGFzc05hbWUsIHVwZGF0ZSwgc2NoZW1hKTtcbiAgICBjb25zdCBtb25nb1doZXJlID0gdHJhbnNmb3JtV2hlcmUoY2xhc3NOYW1lLCBxdWVyeSwgc2NoZW1hKTtcbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi51cGRhdGVNYW55KG1vbmdvV2hlcmUsIG1vbmdvVXBkYXRlKSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIC8vIEF0b21pY2FsbHkgZmluZHMgYW5kIHVwZGF0ZXMgYW4gb2JqZWN0IGJhc2VkIG9uIHF1ZXJ5LlxuICAvLyBSZXR1cm4gdmFsdWUgbm90IGN1cnJlbnRseSB3ZWxsIHNwZWNpZmllZC5cbiAgZmluZE9uZUFuZFVwZGF0ZShjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBxdWVyeTogUXVlcnlUeXBlLCB1cGRhdGU6IGFueSkge1xuICAgIHNjaGVtYSA9IGNvbnZlcnRQYXJzZVNjaGVtYVRvTW9uZ29TY2hlbWEoc2NoZW1hKTtcbiAgICBjb25zdCBtb25nb1VwZGF0ZSA9IHRyYW5zZm9ybVVwZGF0ZShjbGFzc05hbWUsIHVwZGF0ZSwgc2NoZW1hKTtcbiAgICBjb25zdCBtb25nb1doZXJlID0gdHJhbnNmb3JtV2hlcmUoY2xhc3NOYW1lLCBxdWVyeSwgc2NoZW1hKTtcbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi5fbW9uZ29Db2xsZWN0aW9uLmZpbmRBbmRNb2RpZnkobW9uZ29XaGVyZSwgW10sIG1vbmdvVXBkYXRlLCB7IG5ldzogdHJ1ZSB9KSlcbiAgICAgIC50aGVuKHJlc3VsdCA9PiBtb25nb09iamVjdFRvUGFyc2VPYmplY3QoY2xhc3NOYW1lLCByZXN1bHQudmFsdWUsIHNjaGVtYSkpXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IuY29kZSA9PT0gMTEwMDApIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuRFVQTElDQVRFX1ZBTFVFLCAnQSBkdXBsaWNhdGUgdmFsdWUgZm9yIGEgZmllbGQgd2l0aCB1bmlxdWUgdmFsdWVzIHdhcyBwcm92aWRlZCcpO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIC8vIEhvcGVmdWxseSB3ZSBjYW4gZ2V0IHJpZCBvZiB0aGlzLiBJdCdzIG9ubHkgdXNlZCBmb3IgY29uZmlnIGFuZCBob29rcy5cbiAgdXBzZXJ0T25lT2JqZWN0KGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIHF1ZXJ5OiBRdWVyeVR5cGUsIHVwZGF0ZTogYW55KSB7XG4gICAgc2NoZW1hID0gY29udmVydFBhcnNlU2NoZW1hVG9Nb25nb1NjaGVtYShzY2hlbWEpO1xuICAgIGNvbnN0IG1vbmdvVXBkYXRlID0gdHJhbnNmb3JtVXBkYXRlKGNsYXNzTmFtZSwgdXBkYXRlLCBzY2hlbWEpO1xuICAgIGNvbnN0IG1vbmdvV2hlcmUgPSB0cmFuc2Zvcm1XaGVyZShjbGFzc05hbWUsIHF1ZXJ5LCBzY2hlbWEpO1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLnVwc2VydE9uZShtb25nb1doZXJlLCBtb25nb1VwZGF0ZSkpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICAvLyBFeGVjdXRlcyBhIGZpbmQuIEFjY2VwdHM6IGNsYXNzTmFtZSwgcXVlcnkgaW4gUGFyc2UgZm9ybWF0LCBhbmQgeyBza2lwLCBsaW1pdCwgc29ydCB9LlxuICBmaW5kKGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIHF1ZXJ5OiBRdWVyeVR5cGUsIHsgc2tpcCwgbGltaXQsIHNvcnQsIGtleXMsIHJlYWRQcmVmZXJlbmNlIH06IFF1ZXJ5T3B0aW9ucyk6IFByb21pc2U8YW55PiB7XG4gICAgc2NoZW1hID0gY29udmVydFBhcnNlU2NoZW1hVG9Nb25nb1NjaGVtYShzY2hlbWEpO1xuICAgIGNvbnN0IG1vbmdvV2hlcmUgPSB0cmFuc2Zvcm1XaGVyZShjbGFzc05hbWUsIHF1ZXJ5LCBzY2hlbWEpO1xuICAgIGNvbnN0IG1vbmdvU29ydCA9IF8ubWFwS2V5cyhzb3J0LCAodmFsdWUsIGZpZWxkTmFtZSkgPT4gdHJhbnNmb3JtS2V5KGNsYXNzTmFtZSwgZmllbGROYW1lLCBzY2hlbWEpKTtcbiAgICBjb25zdCBtb25nb0tleXMgPSBfLnJlZHVjZShrZXlzLCAobWVtbywga2V5KSA9PiB7XG4gICAgICBtZW1vW3RyYW5zZm9ybUtleShjbGFzc05hbWUsIGtleSwgc2NoZW1hKV0gPSAxO1xuICAgICAgcmV0dXJuIG1lbW87XG4gICAgfSwge30pO1xuXG4gICAgcmVhZFByZWZlcmVuY2UgPSB0aGlzLl9wYXJzZVJlYWRQcmVmZXJlbmNlKHJlYWRQcmVmZXJlbmNlKTtcbiAgICByZXR1cm4gdGhpcy5jcmVhdGVUZXh0SW5kZXhlc0lmTmVlZGVkKGNsYXNzTmFtZSwgcXVlcnksIHNjaGVtYSlcbiAgICAgIC50aGVuKCgpID0+IHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLmZpbmQobW9uZ29XaGVyZSwge1xuICAgICAgICBza2lwLFxuICAgICAgICBsaW1pdCxcbiAgICAgICAgc29ydDogbW9uZ29Tb3J0LFxuICAgICAgICBrZXlzOiBtb25nb0tleXMsXG4gICAgICAgIG1heFRpbWVNUzogdGhpcy5fbWF4VGltZU1TLFxuICAgICAgICByZWFkUHJlZmVyZW5jZSxcbiAgICAgIH0pKVxuICAgICAgLnRoZW4ob2JqZWN0cyA9PiBvYmplY3RzLm1hcChvYmplY3QgPT4gbW9uZ29PYmplY3RUb1BhcnNlT2JqZWN0KGNsYXNzTmFtZSwgb2JqZWN0LCBzY2hlbWEpKSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIC8vIENyZWF0ZSBhIHVuaXF1ZSBpbmRleC4gVW5pcXVlIGluZGV4ZXMgb24gbnVsbGFibGUgZmllbGRzIGFyZSBub3QgYWxsb3dlZC4gU2luY2Ugd2UgZG9uJ3RcbiAgLy8gY3VycmVudGx5IGtub3cgd2hpY2ggZmllbGRzIGFyZSBudWxsYWJsZSBhbmQgd2hpY2ggYXJlbid0LCB3ZSBpZ25vcmUgdGhhdCBjcml0ZXJpYS5cbiAgLy8gQXMgc3VjaCwgd2Ugc2hvdWxkbid0IGV4cG9zZSB0aGlzIGZ1bmN0aW9uIHRvIHVzZXJzIG9mIHBhcnNlIHVudGlsIHdlIGhhdmUgYW4gb3V0LW9mLWJhbmRcbiAgLy8gV2F5IG9mIGRldGVybWluaW5nIGlmIGEgZmllbGQgaXMgbnVsbGFibGUuIFVuZGVmaW5lZCBkb2Vzbid0IGNvdW50IGFnYWluc3QgdW5pcXVlbmVzcyxcbiAgLy8gd2hpY2ggaXMgd2h5IHdlIHVzZSBzcGFyc2UgaW5kZXhlcy5cbiAgZW5zdXJlVW5pcXVlbmVzcyhjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBmaWVsZE5hbWVzOiBzdHJpbmdbXSkge1xuICAgIHNjaGVtYSA9IGNvbnZlcnRQYXJzZVNjaGVtYVRvTW9uZ29TY2hlbWEoc2NoZW1hKTtcbiAgICBjb25zdCBpbmRleENyZWF0aW9uUmVxdWVzdCA9IHt9O1xuICAgIGNvbnN0IG1vbmdvRmllbGROYW1lcyA9IGZpZWxkTmFtZXMubWFwKGZpZWxkTmFtZSA9PiB0cmFuc2Zvcm1LZXkoY2xhc3NOYW1lLCBmaWVsZE5hbWUsIHNjaGVtYSkpO1xuICAgIG1vbmdvRmllbGROYW1lcy5mb3JFYWNoKGZpZWxkTmFtZSA9PiB7XG4gICAgICBpbmRleENyZWF0aW9uUmVxdWVzdFtmaWVsZE5hbWVdID0gMTtcbiAgICB9KTtcbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi5fZW5zdXJlU3BhcnNlVW5pcXVlSW5kZXhJbkJhY2tncm91bmQoaW5kZXhDcmVhdGlvblJlcXVlc3QpKVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKGVycm9yLmNvZGUgPT09IDExMDAwKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLkRVUExJQ0FURV9WQUxVRSwgJ1RyaWVkIHRvIGVuc3VyZSBmaWVsZCB1bmlxdWVuZXNzIGZvciBhIGNsYXNzIHRoYXQgYWxyZWFkeSBoYXMgZHVwbGljYXRlcy4nKTtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICAvLyBVc2VkIGluIHRlc3RzXG4gIF9yYXdGaW5kKGNsYXNzTmFtZTogc3RyaW5nLCBxdWVyeTogUXVlcnlUeXBlKSB7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLmZpbmQocXVlcnksIHtcbiAgICAgIG1heFRpbWVNUzogdGhpcy5fbWF4VGltZU1TLFxuICAgIH0pKS5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIC8vIEV4ZWN1dGVzIGEgY291bnQuXG4gIGNvdW50KGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIHF1ZXJ5OiBRdWVyeVR5cGUsIHJlYWRQcmVmZXJlbmNlOiA/c3RyaW5nKSB7XG4gICAgc2NoZW1hID0gY29udmVydFBhcnNlU2NoZW1hVG9Nb25nb1NjaGVtYShzY2hlbWEpO1xuICAgIHJlYWRQcmVmZXJlbmNlID0gdGhpcy5fcGFyc2VSZWFkUHJlZmVyZW5jZShyZWFkUHJlZmVyZW5jZSk7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24uY291bnQodHJhbnNmb3JtV2hlcmUoY2xhc3NOYW1lLCBxdWVyeSwgc2NoZW1hKSwge1xuICAgICAgICBtYXhUaW1lTVM6IHRoaXMuX21heFRpbWVNUyxcbiAgICAgICAgcmVhZFByZWZlcmVuY2UsXG4gICAgICB9KSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIGRpc3RpbmN0KGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIHF1ZXJ5OiBRdWVyeVR5cGUsIGZpZWxkTmFtZTogc3RyaW5nKSB7XG4gICAgc2NoZW1hID0gY29udmVydFBhcnNlU2NoZW1hVG9Nb25nb1NjaGVtYShzY2hlbWEpO1xuICAgIGNvbnN0IGlzUG9pbnRlckZpZWxkID0gc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdICYmIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09PSAnUG9pbnRlcic7XG4gICAgaWYgKGlzUG9pbnRlckZpZWxkKSB7XG4gICAgICBmaWVsZE5hbWUgPSBgX3BfJHtmaWVsZE5hbWV9YFxuICAgIH1cbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi5kaXN0aW5jdChmaWVsZE5hbWUsIHRyYW5zZm9ybVdoZXJlKGNsYXNzTmFtZSwgcXVlcnksIHNjaGVtYSkpKVxuICAgICAgLnRoZW4ob2JqZWN0cyA9PiB7XG4gICAgICAgIG9iamVjdHMgPSBvYmplY3RzLmZpbHRlcigob2JqKSA9PiBvYmogIT0gbnVsbCk7XG4gICAgICAgIHJldHVybiBvYmplY3RzLm1hcChvYmplY3QgPT4ge1xuICAgICAgICAgIGlmIChpc1BvaW50ZXJGaWVsZCkge1xuICAgICAgICAgICAgY29uc3QgZmllbGQgPSBmaWVsZE5hbWUuc3Vic3RyaW5nKDMpO1xuICAgICAgICAgICAgcmV0dXJuIHRyYW5zZm9ybVBvaW50ZXJTdHJpbmcoc2NoZW1hLCBmaWVsZCwgb2JqZWN0KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIG1vbmdvT2JqZWN0VG9QYXJzZU9iamVjdChjbGFzc05hbWUsIG9iamVjdCwgc2NoZW1hKTtcbiAgICAgICAgfSk7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgYWdncmVnYXRlKGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IGFueSwgcGlwZWxpbmU6IGFueSwgcmVhZFByZWZlcmVuY2U6ID9zdHJpbmcpIHtcbiAgICBsZXQgaXNQb2ludGVyRmllbGQgPSBmYWxzZTtcbiAgICBwaXBlbGluZSA9IHBpcGVsaW5lLm1hcCgoc3RhZ2UpID0+IHtcbiAgICAgIGlmIChzdGFnZS4kZ3JvdXApIHtcbiAgICAgICAgc3RhZ2UuJGdyb3VwID0gdGhpcy5fcGFyc2VBZ2dyZWdhdGVHcm91cEFyZ3Moc2NoZW1hLCBzdGFnZS4kZ3JvdXApO1xuICAgICAgICBpZiAoc3RhZ2UuJGdyb3VwLl9pZCAmJiAodHlwZW9mIHN0YWdlLiRncm91cC5faWQgPT09ICdzdHJpbmcnKSAmJiBzdGFnZS4kZ3JvdXAuX2lkLmluZGV4T2YoJyRfcF8nKSA+PSAwKSB7XG4gICAgICAgICAgaXNQb2ludGVyRmllbGQgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoc3RhZ2UuJG1hdGNoKSB7XG4gICAgICAgIHN0YWdlLiRtYXRjaCA9IHRoaXMuX3BhcnNlQWdncmVnYXRlQXJncyhzY2hlbWEsIHN0YWdlLiRtYXRjaCk7XG4gICAgICB9XG4gICAgICBpZiAoc3RhZ2UuJHByb2plY3QpIHtcbiAgICAgICAgc3RhZ2UuJHByb2plY3QgPSB0aGlzLl9wYXJzZUFnZ3JlZ2F0ZVByb2plY3RBcmdzKHNjaGVtYSwgc3RhZ2UuJHByb2plY3QpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHN0YWdlO1xuICAgIH0pO1xuICAgIHJlYWRQcmVmZXJlbmNlID0gdGhpcy5fcGFyc2VSZWFkUHJlZmVyZW5jZShyZWFkUHJlZmVyZW5jZSk7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24uYWdncmVnYXRlKHBpcGVsaW5lLCB7IHJlYWRQcmVmZXJlbmNlLCBtYXhUaW1lTVM6IHRoaXMuX21heFRpbWVNUyB9KSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlID09PSAxNjAwNikge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLCBlcnJvci5tZXNzYWdlKTtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH0pXG4gICAgICAudGhlbihyZXN1bHRzID0+IHtcbiAgICAgICAgcmVzdWx0cy5mb3JFYWNoKHJlc3VsdCA9PiB7XG4gICAgICAgICAgaWYgKHJlc3VsdC5oYXNPd25Qcm9wZXJ0eSgnX2lkJykpIHtcbiAgICAgICAgICAgIGlmIChpc1BvaW50ZXJGaWVsZCAmJiByZXN1bHQuX2lkKSB7XG4gICAgICAgICAgICAgIHJlc3VsdC5faWQgPSByZXN1bHQuX2lkLnNwbGl0KCckJylbMV07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAocmVzdWx0Ll9pZCA9PSBudWxsIHx8IF8uaXNFbXB0eShyZXN1bHQuX2lkKSkge1xuICAgICAgICAgICAgICByZXN1bHQuX2lkID0gbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlc3VsdC5vYmplY3RJZCA9IHJlc3VsdC5faWQ7XG4gICAgICAgICAgICBkZWxldGUgcmVzdWx0Ll9pZDtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gcmVzdWx0cztcbiAgICAgIH0pXG4gICAgICAudGhlbihvYmplY3RzID0+IG9iamVjdHMubWFwKG9iamVjdCA9PiBtb25nb09iamVjdFRvUGFyc2VPYmplY3QoY2xhc3NOYW1lLCBvYmplY3QsIHNjaGVtYSkpKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgLy8gVGhpcyBmdW5jdGlvbiB3aWxsIHJlY3Vyc2l2ZWx5IHRyYXZlcnNlIHRoZSBwaXBlbGluZSBhbmQgY29udmVydCBhbnkgUG9pbnRlciBvciBEYXRlIGNvbHVtbnMuXG4gIC8vIElmIHdlIGRldGVjdCBhIHBvaW50ZXIgY29sdW1uIHdlIHdpbGwgcmVuYW1lIHRoZSBjb2x1bW4gYmVpbmcgcXVlcmllZCBmb3IgdG8gbWF0Y2ggdGhlIGNvbHVtblxuICAvLyBpbiB0aGUgZGF0YWJhc2UuIFdlIGFsc28gbW9kaWZ5IHRoZSB2YWx1ZSB0byB3aGF0IHdlIGV4cGVjdCB0aGUgdmFsdWUgdG8gYmUgaW4gdGhlIGRhdGFiYXNlXG4gIC8vIGFzIHdlbGwuXG4gIC8vIEZvciBkYXRlcywgdGhlIGRyaXZlciBleHBlY3RzIGEgRGF0ZSBvYmplY3QsIGJ1dCB3ZSBoYXZlIGEgc3RyaW5nIGNvbWluZyBpbi4gU28gd2UnbGwgY29udmVydFxuICAvLyB0aGUgc3RyaW5nIHRvIGEgRGF0ZSBzbyB0aGUgZHJpdmVyIGNhbiBwZXJmb3JtIHRoZSBuZWNlc3NhcnkgY29tcGFyaXNvbi5cbiAgLy9cbiAgLy8gVGhlIGdvYWwgb2YgdGhpcyBtZXRob2QgaXMgdG8gbG9vayBmb3IgdGhlIFwibGVhdmVzXCIgb2YgdGhlIHBpcGVsaW5lIGFuZCBkZXRlcm1pbmUgaWYgaXQgbmVlZHNcbiAgLy8gdG8gYmUgY29udmVydGVkLiBUaGUgcGlwZWxpbmUgY2FuIGhhdmUgYSBmZXcgZGlmZmVyZW50IGZvcm1zLiBGb3IgbW9yZSBkZXRhaWxzLCBzZWU6XG4gIC8vICAgICBodHRwczovL2RvY3MubW9uZ29kYi5jb20vbWFudWFsL3JlZmVyZW5jZS9vcGVyYXRvci9hZ2dyZWdhdGlvbi9cbiAgLy9cbiAgLy8gSWYgdGhlIHBpcGVsaW5lIGlzIGFuIGFycmF5LCBpdCBtZWFucyB3ZSBhcmUgcHJvYmFibHkgcGFyc2luZyBhbiAnJGFuZCcgb3IgJyRvcicgb3BlcmF0b3IuIEluXG4gIC8vIHRoYXQgY2FzZSB3ZSBuZWVkIHRvIGxvb3AgdGhyb3VnaCBhbGwgb2YgaXQncyBjaGlsZHJlbiB0byBmaW5kIHRoZSBjb2x1bW5zIGJlaW5nIG9wZXJhdGVkIG9uLlxuICAvLyBJZiB0aGUgcGlwZWxpbmUgaXMgYW4gb2JqZWN0LCB0aGVuIHdlJ2xsIGxvb3AgdGhyb3VnaCB0aGUga2V5cyBjaGVja2luZyB0byBzZWUgaWYgdGhlIGtleSBuYW1lXG4gIC8vIG1hdGNoZXMgb25lIG9mIHRoZSBzY2hlbWEgY29sdW1ucy4gSWYgaXQgZG9lcyBtYXRjaCBhIGNvbHVtbiBhbmQgdGhlIGNvbHVtbiBpcyBhIFBvaW50ZXIgb3JcbiAgLy8gYSBEYXRlLCB0aGVuIHdlJ2xsIGNvbnZlcnQgdGhlIHZhbHVlIGFzIGRlc2NyaWJlZCBhYm92ZS5cbiAgLy9cbiAgLy8gQXMgbXVjaCBhcyBJIGhhdGUgcmVjdXJzaW9uLi4udGhpcyBzZWVtZWQgbGlrZSBhIGdvb2QgZml0IGZvciBpdC4gV2UncmUgZXNzZW50aWFsbHkgdHJhdmVyc2luZ1xuICAvLyBkb3duIGEgdHJlZSB0byBmaW5kIGEgXCJsZWFmIG5vZGVcIiBhbmQgY2hlY2tpbmcgdG8gc2VlIGlmIGl0IG5lZWRzIHRvIGJlIGNvbnZlcnRlZC5cbiAgX3BhcnNlQWdncmVnYXRlQXJncyhzY2hlbWE6IGFueSwgcGlwZWxpbmU6IGFueSk6IGFueSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkocGlwZWxpbmUpKSB7XG4gICAgICByZXR1cm4gcGlwZWxpbmUubWFwKCh2YWx1ZSkgPT4gdGhpcy5fcGFyc2VBZ2dyZWdhdGVBcmdzKHNjaGVtYSwgdmFsdWUpKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBwaXBlbGluZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIGNvbnN0IHJldHVyblZhbHVlID0ge307XG4gICAgICBmb3IgKGNvbnN0IGZpZWxkIGluIHBpcGVsaW5lKSB7XG4gICAgICAgIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkXSAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkXS50eXBlID09PSAnUG9pbnRlcicpIHtcbiAgICAgICAgICBpZiAodHlwZW9mIHBpcGVsaW5lW2ZpZWxkXSA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIC8vIFBhc3Mgb2JqZWN0cyBkb3duIHRvIE1vbmdvREIuLi50aGlzIGlzIG1vcmUgdGhhbiBsaWtlbHkgYW4gJGV4aXN0cyBvcGVyYXRvci5cbiAgICAgICAgICAgIHJldHVyblZhbHVlW2BfcF8ke2ZpZWxkfWBdID0gcGlwZWxpbmVbZmllbGRdO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm5WYWx1ZVtgX3BfJHtmaWVsZH1gXSA9IGAke3NjaGVtYS5maWVsZHNbZmllbGRdLnRhcmdldENsYXNzfSQke3BpcGVsaW5lW2ZpZWxkXX1gO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkXSAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkXS50eXBlID09PSAnRGF0ZScpIHtcbiAgICAgICAgICByZXR1cm5WYWx1ZVtmaWVsZF0gPSB0aGlzLl9jb252ZXJ0VG9EYXRlKHBpcGVsaW5lW2ZpZWxkXSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuVmFsdWVbZmllbGRdID0gdGhpcy5fcGFyc2VBZ2dyZWdhdGVBcmdzKHNjaGVtYSwgcGlwZWxpbmVbZmllbGRdKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChmaWVsZCA9PT0gJ29iamVjdElkJykge1xuICAgICAgICAgIHJldHVyblZhbHVlWydfaWQnXSA9IHJldHVyblZhbHVlW2ZpZWxkXTtcbiAgICAgICAgICBkZWxldGUgcmV0dXJuVmFsdWVbZmllbGRdO1xuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkID09PSAnY3JlYXRlZEF0Jykge1xuICAgICAgICAgIHJldHVyblZhbHVlWydfY3JlYXRlZF9hdCddID0gcmV0dXJuVmFsdWVbZmllbGRdO1xuICAgICAgICAgIGRlbGV0ZSByZXR1cm5WYWx1ZVtmaWVsZF07XG4gICAgICAgIH0gZWxzZSBpZiAoZmllbGQgPT09ICd1cGRhdGVkQXQnKSB7XG4gICAgICAgICAgcmV0dXJuVmFsdWVbJ191cGRhdGVkX2F0J10gPSByZXR1cm5WYWx1ZVtmaWVsZF07XG4gICAgICAgICAgZGVsZXRlIHJldHVyblZhbHVlW2ZpZWxkXTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIHJldHVyblZhbHVlO1xuICAgIH1cbiAgICByZXR1cm4gcGlwZWxpbmU7XG4gIH1cblxuICAvLyBUaGlzIGZ1bmN0aW9uIGlzIHNsaWdodGx5IGRpZmZlcmVudCB0aGFuIHRoZSBvbmUgYWJvdmUuIFJhdGhlciB0aGFuIHRyeWluZyB0byBjb21iaW5lIHRoZXNlXG4gIC8vIHR3byBmdW5jdGlvbnMgYW5kIG1ha2luZyB0aGUgY29kZSBldmVuIGhhcmRlciB0byB1bmRlcnN0YW5kLCBJIGRlY2lkZWQgdG8gc3BsaXQgaXQgdXAuIFRoZVxuICAvLyBkaWZmZXJlbmNlIHdpdGggdGhpcyBmdW5jdGlvbiBpcyB3ZSBhcmUgbm90IHRyYW5zZm9ybWluZyB0aGUgdmFsdWVzLCBvbmx5IHRoZSBrZXlzIG9mIHRoZVxuICAvLyBwaXBlbGluZS5cbiAgX3BhcnNlQWdncmVnYXRlUHJvamVjdEFyZ3Moc2NoZW1hOiBhbnksIHBpcGVsaW5lOiBhbnkpOiBhbnkge1xuICAgIGNvbnN0IHJldHVyblZhbHVlID0ge307XG4gICAgZm9yIChjb25zdCBmaWVsZCBpbiBwaXBlbGluZSkge1xuICAgICAgaWYgKHNjaGVtYS5maWVsZHNbZmllbGRdICYmIHNjaGVtYS5maWVsZHNbZmllbGRdLnR5cGUgPT09ICdQb2ludGVyJykge1xuICAgICAgICByZXR1cm5WYWx1ZVtgX3BfJHtmaWVsZH1gXSA9IHBpcGVsaW5lW2ZpZWxkXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVyblZhbHVlW2ZpZWxkXSA9IHRoaXMuX3BhcnNlQWdncmVnYXRlQXJncyhzY2hlbWEsIHBpcGVsaW5lW2ZpZWxkXSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChmaWVsZCA9PT0gJ29iamVjdElkJykge1xuICAgICAgICByZXR1cm5WYWx1ZVsnX2lkJ10gPSByZXR1cm5WYWx1ZVtmaWVsZF07XG4gICAgICAgIGRlbGV0ZSByZXR1cm5WYWx1ZVtmaWVsZF07XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkID09PSAnY3JlYXRlZEF0Jykge1xuICAgICAgICByZXR1cm5WYWx1ZVsnX2NyZWF0ZWRfYXQnXSA9IHJldHVyblZhbHVlW2ZpZWxkXTtcbiAgICAgICAgZGVsZXRlIHJldHVyblZhbHVlW2ZpZWxkXTtcbiAgICAgIH0gZWxzZSBpZiAoZmllbGQgPT09ICd1cGRhdGVkQXQnKSB7XG4gICAgICAgIHJldHVyblZhbHVlWydfdXBkYXRlZF9hdCddID0gcmV0dXJuVmFsdWVbZmllbGRdO1xuICAgICAgICBkZWxldGUgcmV0dXJuVmFsdWVbZmllbGRdO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmV0dXJuVmFsdWU7XG4gIH1cblxuICAvLyBUaGlzIGZ1bmN0aW9uIGlzIHNsaWdodGx5IGRpZmZlcmVudCB0aGFuIHRoZSB0d28gYWJvdmUuIE1vbmdvREIgJGdyb3VwIGFnZ3JlZ2F0ZSBsb29rcyBsaWtlOlxuICAvLyAgICAgeyAkZ3JvdXA6IHsgX2lkOiA8ZXhwcmVzc2lvbj4sIDxmaWVsZDE+OiB7IDxhY2N1bXVsYXRvcjE+IDogPGV4cHJlc3Npb24xPiB9LCAuLi4gfSB9XG4gIC8vIFRoZSA8ZXhwcmVzc2lvbj4gY291bGQgYmUgYSBjb2x1bW4gbmFtZSwgcHJlZml4ZWQgd2l0aCB0aGUgJyQnIGNoYXJhY3Rlci4gV2UnbGwgbG9vayBmb3JcbiAgLy8gdGhlc2UgPGV4cHJlc3Npb24+IGFuZCBjaGVjayB0byBzZWUgaWYgaXQgaXMgYSAnUG9pbnRlcicgb3IgaWYgaXQncyBvbmUgb2YgY3JlYXRlZEF0LFxuICAvLyB1cGRhdGVkQXQgb3Igb2JqZWN0SWQgYW5kIGNoYW5nZSBpdCBhY2NvcmRpbmdseS5cbiAgX3BhcnNlQWdncmVnYXRlR3JvdXBBcmdzKHNjaGVtYTogYW55LCBwaXBlbGluZTogYW55KTogYW55IHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShwaXBlbGluZSkpIHtcbiAgICAgIHJldHVybiBwaXBlbGluZS5tYXAoKHZhbHVlKSA9PiB0aGlzLl9wYXJzZUFnZ3JlZ2F0ZUdyb3VwQXJncyhzY2hlbWEsIHZhbHVlKSk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgcGlwZWxpbmUgPT09ICdvYmplY3QnKSB7XG4gICAgICBjb25zdCByZXR1cm5WYWx1ZSA9IHt9O1xuICAgICAgZm9yIChjb25zdCBmaWVsZCBpbiBwaXBlbGluZSkge1xuICAgICAgICByZXR1cm5WYWx1ZVtmaWVsZF0gPSB0aGlzLl9wYXJzZUFnZ3JlZ2F0ZUdyb3VwQXJncyhzY2hlbWEsIHBpcGVsaW5lW2ZpZWxkXSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gcmV0dXJuVmFsdWU7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgcGlwZWxpbmUgPT09ICdzdHJpbmcnKSB7XG4gICAgICBjb25zdCBmaWVsZCA9IHBpcGVsaW5lLnN1YnN0cmluZygxKTtcbiAgICAgIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkXSAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkXS50eXBlID09PSAnUG9pbnRlcicpIHtcbiAgICAgICAgcmV0dXJuIGAkX3BfJHtmaWVsZH1gO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZCA9PSAnY3JlYXRlZEF0Jykge1xuICAgICAgICByZXR1cm4gJyRfY3JlYXRlZF9hdCc7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkID09ICd1cGRhdGVkQXQnKSB7XG4gICAgICAgIHJldHVybiAnJF91cGRhdGVkX2F0JztcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHBpcGVsaW5lO1xuICB9XG5cbiAgLy8gVGhpcyBmdW5jdGlvbiB3aWxsIGF0dGVtcHQgdG8gY29udmVydCB0aGUgcHJvdmlkZWQgdmFsdWUgdG8gYSBEYXRlIG9iamVjdC4gU2luY2UgdGhpcyBpcyBwYXJ0XG4gIC8vIG9mIGFuIGFnZ3JlZ2F0aW9uIHBpcGVsaW5lLCB0aGUgdmFsdWUgY2FuIGVpdGhlciBiZSBhIHN0cmluZyBvciBpdCBjYW4gYmUgYW5vdGhlciBvYmplY3Qgd2l0aFxuICAvLyBhbiBvcGVyYXRvciBpbiBpdCAobGlrZSAkZ3QsICRsdCwgZXRjKS4gQmVjYXVzZSBvZiB0aGlzIEkgZmVsdCBpdCB3YXMgZWFzaWVyIHRvIG1ha2UgdGhpcyBhXG4gIC8vIHJlY3Vyc2l2ZSBtZXRob2QgdG8gdHJhdmVyc2UgZG93biB0byB0aGUgXCJsZWFmIG5vZGVcIiB3aGljaCBpcyBnb2luZyB0byBiZSB0aGUgc3RyaW5nLlxuICBfY29udmVydFRvRGF0ZSh2YWx1ZTogYW55KTogYW55IHtcbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuIG5ldyBEYXRlKHZhbHVlKTtcbiAgICB9XG5cbiAgICBjb25zdCByZXR1cm5WYWx1ZSA9IHt9XG4gICAgZm9yIChjb25zdCBmaWVsZCBpbiB2YWx1ZSkge1xuICAgICAgcmV0dXJuVmFsdWVbZmllbGRdID0gdGhpcy5fY29udmVydFRvRGF0ZSh2YWx1ZVtmaWVsZF0pXG4gICAgfVxuICAgIHJldHVybiByZXR1cm5WYWx1ZTtcbiAgfVxuXG4gIF9wYXJzZVJlYWRQcmVmZXJlbmNlKHJlYWRQcmVmZXJlbmNlOiA/c3RyaW5nKTogP3N0cmluZyB7XG4gICAgc3dpdGNoIChyZWFkUHJlZmVyZW5jZSkge1xuICAgIGNhc2UgJ1BSSU1BUlknOlxuICAgICAgcmVhZFByZWZlcmVuY2UgPSBSZWFkUHJlZmVyZW5jZS5QUklNQVJZO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnUFJJTUFSWV9QUkVGRVJSRUQnOlxuICAgICAgcmVhZFByZWZlcmVuY2UgPSBSZWFkUHJlZmVyZW5jZS5QUklNQVJZX1BSRUZFUlJFRDtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ1NFQ09OREFSWSc6XG4gICAgICByZWFkUHJlZmVyZW5jZSA9IFJlYWRQcmVmZXJlbmNlLlNFQ09OREFSWTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ1NFQ09OREFSWV9QUkVGRVJSRUQnOlxuICAgICAgcmVhZFByZWZlcmVuY2UgPSBSZWFkUHJlZmVyZW5jZS5TRUNPTkRBUllfUFJFRkVSUkVEO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnTkVBUkVTVCc6XG4gICAgICByZWFkUHJlZmVyZW5jZSA9IFJlYWRQcmVmZXJlbmNlLk5FQVJFU1Q7XG4gICAgICBicmVhaztcbiAgICBjYXNlIHVuZGVmaW5lZDpcbiAgICAgIGJyZWFrO1xuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSwgJ05vdCBzdXBwb3J0ZWQgcmVhZCBwcmVmZXJlbmNlLicpO1xuICAgIH1cbiAgICByZXR1cm4gcmVhZFByZWZlcmVuY2U7XG4gIH1cblxuICBwZXJmb3JtSW5pdGlhbGl6YXRpb24oKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgY3JlYXRlSW5kZXgoY2xhc3NOYW1lOiBzdHJpbmcsIGluZGV4OiBhbnkpIHtcbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi5fbW9uZ29Db2xsZWN0aW9uLmNyZWF0ZUluZGV4KGluZGV4LCB7YmFja2dyb3VuZDogdHJ1ZX0pKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgY3JlYXRlSW5kZXhlcyhjbGFzc05hbWU6IHN0cmluZywgaW5kZXhlczogYW55KSB7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24uX21vbmdvQ29sbGVjdGlvbi5jcmVhdGVJbmRleGVzKGluZGV4ZXMsIHtiYWNrZ3JvdW5kOiB0cnVlfSkpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICBjcmVhdGVJbmRleGVzSWZOZWVkZWQoY2xhc3NOYW1lOiBzdHJpbmcsIGZpZWxkTmFtZTogc3RyaW5nLCB0eXBlOiBhbnkpIHtcbiAgICBpZiAodHlwZSAmJiB0eXBlLnR5cGUgPT09ICdQb2x5Z29uJykge1xuICAgICAgY29uc3QgaW5kZXggPSB7XG4gICAgICAgIFtmaWVsZE5hbWVdOiAnMmRzcGhlcmUnXG4gICAgICB9O1xuICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlSW5kZXgoY2xhc3NOYW1lLCBpbmRleCk7XG4gICAgfVxuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIGNyZWF0ZVRleHRJbmRleGVzSWZOZWVkZWQoY2xhc3NOYW1lOiBzdHJpbmcsIHF1ZXJ5OiBRdWVyeVR5cGUsIHNjaGVtYTogYW55KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgZm9yKGNvbnN0IGZpZWxkTmFtZSBpbiBxdWVyeSkge1xuICAgICAgaWYgKCFxdWVyeVtmaWVsZE5hbWVdIHx8ICFxdWVyeVtmaWVsZE5hbWVdLiR0ZXh0KSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgZXhpc3RpbmdJbmRleGVzID0gc2NoZW1hLmluZGV4ZXM7XG4gICAgICBmb3IgKGNvbnN0IGtleSBpbiBleGlzdGluZ0luZGV4ZXMpIHtcbiAgICAgICAgY29uc3QgaW5kZXggPSBleGlzdGluZ0luZGV4ZXNba2V5XTtcbiAgICAgICAgaWYgKGluZGV4Lmhhc093blByb3BlcnR5KGZpZWxkTmFtZSkpIHtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGNvbnN0IGluZGV4TmFtZSA9IGAke2ZpZWxkTmFtZX1fdGV4dGA7XG4gICAgICBjb25zdCB0ZXh0SW5kZXggPSB7XG4gICAgICAgIFtpbmRleE5hbWVdOiB7IFtmaWVsZE5hbWVdOiAndGV4dCcgfVxuICAgICAgfTtcbiAgICAgIHJldHVybiB0aGlzLnNldEluZGV4ZXNXaXRoU2NoZW1hRm9ybWF0KGNsYXNzTmFtZSwgdGV4dEluZGV4LCBleGlzdGluZ0luZGV4ZXMsIHNjaGVtYS5maWVsZHMpXG4gICAgICAgIC5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgICBpZiAoZXJyb3IuY29kZSA9PT0gODUpIHsgLy8gSW5kZXggZXhpc3Qgd2l0aCBkaWZmZXJlbnQgb3B0aW9uc1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuc2V0SW5kZXhlc0Zyb21Nb25nbyhjbGFzc05hbWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIGdldEluZGV4ZXMoY2xhc3NOYW1lOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi5fbW9uZ29Db2xsZWN0aW9uLmluZGV4ZXMoKSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIGRyb3BJbmRleChjbGFzc05hbWU6IHN0cmluZywgaW5kZXg6IGFueSkge1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLl9tb25nb0NvbGxlY3Rpb24uZHJvcEluZGV4KGluZGV4KSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIGRyb3BBbGxJbmRleGVzKGNsYXNzTmFtZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24uX21vbmdvQ29sbGVjdGlvbi5kcm9wSW5kZXhlcygpKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgdXBkYXRlU2NoZW1hV2l0aEluZGV4ZXMoKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4gdGhpcy5nZXRBbGxDbGFzc2VzKClcbiAgICAgIC50aGVuKChjbGFzc2VzKSA9PiB7XG4gICAgICAgIGNvbnN0IHByb21pc2VzID0gY2xhc3Nlcy5tYXAoKHNjaGVtYSkgPT4ge1xuICAgICAgICAgIHJldHVybiB0aGlzLnNldEluZGV4ZXNGcm9tTW9uZ28oc2NoZW1hLmNsYXNzTmFtZSk7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xuICAgICAgfSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBNb25nb1N0b3JhZ2VBZGFwdGVyO1xuIl19