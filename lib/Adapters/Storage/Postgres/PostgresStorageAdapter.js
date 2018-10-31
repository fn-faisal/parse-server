"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.PostgresStorageAdapter = void 0;

var _PostgresClient = require("./PostgresClient");

var _node = _interopRequireDefault(require("parse/node"));

var _lodash = _interopRequireDefault(require("lodash"));

var _sql = _interopRequireDefault(require("./sql"));

var _StorageAdapter = require("../StorageAdapter");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; var ownKeys = Object.keys(source); if (typeof Object.getOwnPropertySymbols === 'function') { ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function (sym) { return Object.getOwnPropertyDescriptor(source, sym).enumerable; })); } ownKeys.forEach(function (key) { _defineProperty(target, key, source[key]); }); } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

const PostgresRelationDoesNotExistError = '42P01';
const PostgresDuplicateRelationError = '42P07';
const PostgresDuplicateColumnError = '42701';
const PostgresMissingColumnError = '42703';
const PostgresDuplicateObjectError = '42710';
const PostgresUniqueIndexViolationError = '23505';
const PostgresTransactionAbortedError = '25P02';

const logger = require('../../../logger');

const debug = function (...args) {
  args = ['PG: ' + arguments[0]].concat(args.slice(1, args.length));
  const log = logger.getLogger();
  log.debug.apply(log, args);
};

const parseTypeToPostgresType = type => {
  switch (type.type) {
    case 'String':
      return 'text';

    case 'Date':
      return 'timestamp with time zone';

    case 'Object':
      return 'jsonb';

    case 'File':
      return 'text';

    case 'Boolean':
      return 'boolean';

    case 'Pointer':
      return 'char(10)';

    case 'Number':
      return 'double precision';

    case 'GeoPoint':
      return 'point';

    case 'Bytes':
      return 'jsonb';

    case 'Polygon':
      return 'polygon';

    case 'Array':
      if (type.contents && type.contents.type === 'String') {
        return 'text[]';
      } else {
        return 'jsonb';
      }

    default:
      throw `no type for ${JSON.stringify(type)} yet`;
  }
};

const ParseToPosgresComparator = {
  $gt: '>',
  $lt: '<',
  $gte: '>=',
  $lte: '<='
};
const mongoAggregateToPostgres = {
  $dayOfMonth: 'DAY',
  $dayOfWeek: 'DOW',
  $dayOfYear: 'DOY',
  $isoDayOfWeek: 'ISODOW',
  $isoWeekYear: 'ISOYEAR',
  $hour: 'HOUR',
  $minute: 'MINUTE',
  $second: 'SECOND',
  $millisecond: 'MILLISECONDS',
  $month: 'MONTH',
  $week: 'WEEK',
  $year: 'YEAR'
};

const toPostgresValue = value => {
  if (typeof value === 'object') {
    if (value.__type === 'Date') {
      return value.iso;
    }

    if (value.__type === 'File') {
      return value.name;
    }
  }

  return value;
};

const transformValue = value => {
  if (typeof value === 'object' && value.__type === 'Pointer') {
    return value.objectId;
  }

  return value;
}; // Duplicate from then mongo adapter...


const emptyCLPS = Object.freeze({
  find: {},
  get: {},
  create: {},
  update: {},
  delete: {},
  addField: {}
});
const defaultCLPS = Object.freeze({
  find: {
    '*': true
  },
  get: {
    '*': true
  },
  create: {
    '*': true
  },
  update: {
    '*': true
  },
  delete: {
    '*': true
  },
  addField: {
    '*': true
  }
});

const toParseSchema = schema => {
  if (schema.className === '_User') {
    delete schema.fields._hashed_password;
  }

  if (schema.fields) {
    delete schema.fields._wperm;
    delete schema.fields._rperm;
  }

  let clps = defaultCLPS;

  if (schema.classLevelPermissions) {
    clps = _objectSpread({}, emptyCLPS, schema.classLevelPermissions);
  }

  let indexes = {};

  if (schema.indexes) {
    indexes = _objectSpread({}, schema.indexes);
  }

  return {
    className: schema.className,
    fields: schema.fields,
    classLevelPermissions: clps,
    indexes
  };
};

const toPostgresSchema = schema => {
  if (!schema) {
    return schema;
  }

  schema.fields = schema.fields || {};
  schema.fields._wperm = {
    type: 'Array',
    contents: {
      type: 'String'
    }
  };
  schema.fields._rperm = {
    type: 'Array',
    contents: {
      type: 'String'
    }
  };

  if (schema.className === '_User') {
    schema.fields._hashed_password = {
      type: 'String'
    };
    schema.fields._password_history = {
      type: 'Array'
    };
  }

  return schema;
};

const handleDotFields = object => {
  Object.keys(object).forEach(fieldName => {
    if (fieldName.indexOf('.') > -1) {
      const components = fieldName.split('.');
      const first = components.shift();
      object[first] = object[first] || {};
      let currentObj = object[first];
      let next;
      let value = object[fieldName];

      if (value && value.__op === 'Delete') {
        value = undefined;
      }
      /* eslint-disable no-cond-assign */


      while (next = components.shift()) {
        /* eslint-enable no-cond-assign */
        currentObj[next] = currentObj[next] || {};

        if (components.length === 0) {
          currentObj[next] = value;
        }

        currentObj = currentObj[next];
      }

      delete object[fieldName];
    }
  });
  return object;
};

const transformDotFieldToComponents = fieldName => {
  return fieldName.split('.').map((cmpt, index) => {
    if (index === 0) {
      return `"${cmpt}"`;
    }

    return `'${cmpt}'`;
  });
};

const transformDotField = fieldName => {
  if (fieldName.indexOf('.') === -1) {
    return `"${fieldName}"`;
  }

  const components = transformDotFieldToComponents(fieldName);
  let name = components.slice(0, components.length - 1).join('->');
  name += '->>' + components[components.length - 1];
  return name;
};

const transformAggregateField = fieldName => {
  if (typeof fieldName !== 'string') {
    return fieldName;
  }

  if (fieldName === '$_created_at') {
    return 'createdAt';
  }

  if (fieldName === '$_updated_at') {
    return 'updatedAt';
  }

  return fieldName.substr(1);
};

const validateKeys = object => {
  if (typeof object == 'object') {
    for (const key in object) {
      if (typeof object[key] == 'object') {
        validateKeys(object[key]);
      }

      if (key.includes('$') || key.includes('.')) {
        throw new _node.default.Error(_node.default.Error.INVALID_NESTED_KEY, "Nested keys should not contain the '$' or '.' characters");
      }
    }
  }
}; // Returns the list of join tables on a schema


const joinTablesForSchema = schema => {
  const list = [];

  if (schema) {
    Object.keys(schema.fields).forEach(field => {
      if (schema.fields[field].type === 'Relation') {
        list.push(`_Join:${field}:${schema.className}`);
      }
    });
  }

  return list;
};

const buildWhereClause = ({
  schema,
  query,
  index
}) => {
  const patterns = [];
  let values = [];
  const sorts = [];
  schema = toPostgresSchema(schema);

  for (const fieldName in query) {
    const isArrayField = schema.fields && schema.fields[fieldName] && schema.fields[fieldName].type === 'Array';
    const initialPatternsLength = patterns.length;
    const fieldValue = query[fieldName]; // nothingin the schema, it's gonna blow up

    if (!schema.fields[fieldName]) {
      // as it won't exist
      if (fieldValue && fieldValue.$exists === false) {
        continue;
      }
    }

    if (fieldName.indexOf('.') >= 0) {
      let name = transformDotField(fieldName);

      if (fieldValue === null) {
        patterns.push(`${name} IS NULL`);
      } else {
        if (fieldValue.$in) {
          const inPatterns = [];
          name = transformDotFieldToComponents(fieldName).join('->');
          fieldValue.$in.forEach(listElem => {
            if (typeof listElem === 'string') {
              inPatterns.push(`"${listElem}"`);
            } else {
              inPatterns.push(`${listElem}`);
            }
          });
          patterns.push(`(${name})::jsonb @> '[${inPatterns.join()}]'::jsonb`);
        } else if (fieldValue.$regex) {// Handle later
        } else {
          patterns.push(`${name} = '${fieldValue}'`);
        }
      }
    } else if (fieldValue === null || fieldValue === undefined) {
      patterns.push(`$${index}:name IS NULL`);
      values.push(fieldName);
      index += 1;
      continue;
    } else if (typeof fieldValue === 'string') {
      patterns.push(`$${index}:name = $${index + 1}`);
      values.push(fieldName, fieldValue);
      index += 2;
    } else if (typeof fieldValue === 'boolean') {
      patterns.push(`$${index}:name = $${index + 1}`); // Can't cast boolean to double precision

      if (schema.fields[fieldName] && schema.fields[fieldName].type === 'Number') {
        // Should always return zero results
        const MAX_INT_PLUS_ONE = 9223372036854775808;
        values.push(fieldName, MAX_INT_PLUS_ONE);
      } else {
        values.push(fieldName, fieldValue);
      }

      index += 2;
    } else if (typeof fieldValue === 'number') {
      patterns.push(`$${index}:name = $${index + 1}`);
      values.push(fieldName, fieldValue);
      index += 2;
    } else if (['$or', '$nor', '$and'].includes(fieldName)) {
      const clauses = [];
      const clauseValues = [];
      fieldValue.forEach(subQuery => {
        const clause = buildWhereClause({
          schema,
          query: subQuery,
          index
        });

        if (clause.pattern.length > 0) {
          clauses.push(clause.pattern);
          clauseValues.push(...clause.values);
          index += clause.values.length;
        }
      });
      const orOrAnd = fieldName === '$and' ? ' AND ' : ' OR ';
      const not = fieldName === '$nor' ? ' NOT ' : '';
      patterns.push(`${not}(${clauses.join(orOrAnd)})`);
      values.push(...clauseValues);
    }

    if (fieldValue.$ne !== undefined) {
      if (isArrayField) {
        fieldValue.$ne = JSON.stringify([fieldValue.$ne]);
        patterns.push(`NOT array_contains($${index}:name, $${index + 1})`);
      } else {
        if (fieldValue.$ne === null) {
          patterns.push(`$${index}:name IS NOT NULL`);
          values.push(fieldName);
          index += 1;
          continue;
        } else {
          // if not null, we need to manually exclude null
          patterns.push(`($${index}:name <> $${index + 1} OR $${index}:name IS NULL)`);
        }
      } // TODO: support arrays


      values.push(fieldName, fieldValue.$ne);
      index += 2;
    }

    if (fieldValue.$eq !== undefined) {
      if (fieldValue.$eq === null) {
        patterns.push(`$${index}:name IS NULL`);
        values.push(fieldName);
        index += 1;
      } else {
        patterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue.$eq);
        index += 2;
      }
    }

    const isInOrNin = Array.isArray(fieldValue.$in) || Array.isArray(fieldValue.$nin);

    if (Array.isArray(fieldValue.$in) && isArrayField && schema.fields[fieldName].contents && schema.fields[fieldName].contents.type === 'String') {
      const inPatterns = [];
      let allowNull = false;
      values.push(fieldName);
      fieldValue.$in.forEach((listElem, listIndex) => {
        if (listElem === null) {
          allowNull = true;
        } else {
          values.push(listElem);
          inPatterns.push(`$${index + 1 + listIndex - (allowNull ? 1 : 0)}`);
        }
      });

      if (allowNull) {
        patterns.push(`($${index}:name IS NULL OR $${index}:name && ARRAY[${inPatterns.join()}])`);
      } else {
        patterns.push(`$${index}:name && ARRAY[${inPatterns.join()}]`);
      }

      index = index + 1 + inPatterns.length;
    } else if (isInOrNin) {
      var createConstraint = (baseArray, notIn) => {
        if (baseArray.length > 0) {
          const not = notIn ? ' NOT ' : '';

          if (isArrayField) {
            patterns.push(`${not} array_contains($${index}:name, $${index + 1})`);
            values.push(fieldName, JSON.stringify(baseArray));
            index += 2;
          } else {
            // Handle Nested Dot Notation Above
            if (fieldName.indexOf('.') >= 0) {
              return;
            }

            const inPatterns = [];
            values.push(fieldName);
            baseArray.forEach((listElem, listIndex) => {
              if (listElem !== null) {
                values.push(listElem);
                inPatterns.push(`$${index + 1 + listIndex}`);
              }
            });
            patterns.push(`$${index}:name ${not} IN (${inPatterns.join()})`);
            index = index + 1 + inPatterns.length;
          }
        } else if (!notIn) {
          values.push(fieldName);
          patterns.push(`$${index}:name IS NULL`);
          index = index + 1;
        }
      };

      if (fieldValue.$in) {
        createConstraint(_lodash.default.flatMap(fieldValue.$in, elt => elt), false);
      }

      if (fieldValue.$nin) {
        createConstraint(_lodash.default.flatMap(fieldValue.$nin, elt => elt), true);
      }
    } else if (typeof fieldValue.$in !== 'undefined') {
      throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $in value');
    } else if (typeof fieldValue.$nin !== 'undefined') {
      throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $nin value');
    }

    if (Array.isArray(fieldValue.$all) && isArrayField) {
      if (isAnyValueRegexStartsWith(fieldValue.$all)) {
        if (!isAllValuesRegexOrNone(fieldValue.$all)) {
          throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'All $all values must be of regex type or none: ' + fieldValue.$all);
        }

        for (let i = 0; i < fieldValue.$all.length; i += 1) {
          const value = processRegexPattern(fieldValue.$all[i].$regex);
          fieldValue.$all[i] = value.substring(1) + '%';
        }

        patterns.push(`array_contains_all_regex($${index}:name, $${index + 1}::jsonb)`);
      } else {
        patterns.push(`array_contains_all($${index}:name, $${index + 1}::jsonb)`);
      }

      values.push(fieldName, JSON.stringify(fieldValue.$all));
      index += 2;
    }

    if (typeof fieldValue.$exists !== 'undefined') {
      if (fieldValue.$exists) {
        patterns.push(`$${index}:name IS NOT NULL`);
      } else {
        patterns.push(`$${index}:name IS NULL`);
      }

      values.push(fieldName);
      index += 1;
    }

    if (fieldValue.$containedBy) {
      const arr = fieldValue.$containedBy;

      if (!(arr instanceof Array)) {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $containedBy: should be an array`);
      }

      patterns.push(`$${index}:name <@ $${index + 1}::jsonb`);
      values.push(fieldName, JSON.stringify(arr));
      index += 2;
    }

    if (fieldValue.$text) {
      const search = fieldValue.$text.$search;
      let language = 'english';

      if (typeof search !== 'object') {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $text: $search, should be object`);
      }

      if (!search.$term || typeof search.$term !== 'string') {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $text: $term, should be string`);
      }

      if (search.$language && typeof search.$language !== 'string') {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $text: $language, should be string`);
      } else if (search.$language) {
        language = search.$language;
      }

      if (search.$caseSensitive && typeof search.$caseSensitive !== 'boolean') {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $text: $caseSensitive, should be boolean`);
      } else if (search.$caseSensitive) {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $text: $caseSensitive not supported, please use $regex or create a separate lower case column.`);
      }

      if (search.$diacriticSensitive && typeof search.$diacriticSensitive !== 'boolean') {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $text: $diacriticSensitive, should be boolean`);
      } else if (search.$diacriticSensitive === false) {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, `bad $text: $diacriticSensitive - false not supported, install Postgres Unaccent Extension`);
      }

      patterns.push(`to_tsvector($${index}, $${index + 1}:name) @@ to_tsquery($${index + 2}, $${index + 3})`);
      values.push(language, fieldName, language, search.$term);
      index += 4;
    }

    if (fieldValue.$nearSphere) {
      const point = fieldValue.$nearSphere;
      const distance = fieldValue.$maxDistance;
      const distanceInKM = distance * 6371 * 1000;
      patterns.push(`ST_distance_sphere($${index}:name::geometry, POINT($${index + 1}, $${index + 2})::geometry) <= $${index + 3}`);
      sorts.push(`ST_distance_sphere($${index}:name::geometry, POINT($${index + 1}, $${index + 2})::geometry) ASC`);
      values.push(fieldName, point.longitude, point.latitude, distanceInKM);
      index += 4;
    }

    if (fieldValue.$within && fieldValue.$within.$box) {
      const box = fieldValue.$within.$box;
      const left = box[0].longitude;
      const bottom = box[0].latitude;
      const right = box[1].longitude;
      const top = box[1].latitude;
      patterns.push(`$${index}:name::point <@ $${index + 1}::box`);
      values.push(fieldName, `((${left}, ${bottom}), (${right}, ${top}))`);
      index += 2;
    }

    if (fieldValue.$geoWithin && fieldValue.$geoWithin.$centerSphere) {
      const centerSphere = fieldValue.$geoWithin.$centerSphere;

      if (!(centerSphere instanceof Array) || centerSphere.length < 2) {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere should be an array of Parse.GeoPoint and distance');
      } // Get point, convert to geo point if necessary and validate


      let point = centerSphere[0];

      if (point instanceof Array && point.length === 2) {
        point = new _node.default.GeoPoint(point[1], point[0]);
      } else if (!GeoPointCoder.isValidJSON(point)) {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere geo point invalid');
      }

      _node.default.GeoPoint._validate(point.latitude, point.longitude); // Get distance and validate


      const distance = centerSphere[1];

      if (isNaN(distance) || distance < 0) {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere distance invalid');
      }

      const distanceInKM = distance * 6371 * 1000;
      patterns.push(`ST_distance_sphere($${index}:name::geometry, POINT($${index + 1}, $${index + 2})::geometry) <= $${index + 3}`);
      values.push(fieldName, point.longitude, point.latitude, distanceInKM);
      index += 4;
    }

    if (fieldValue.$geoWithin && fieldValue.$geoWithin.$polygon) {
      const polygon = fieldValue.$geoWithin.$polygon;
      let points;

      if (typeof polygon === 'object' && polygon.__type === 'Polygon') {
        if (!polygon.coordinates || polygon.coordinates.length < 3) {
          throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $geoWithin value; Polygon.coordinates should contain at least 3 lon/lat pairs');
        }

        points = polygon.coordinates;
      } else if (polygon instanceof Array) {
        if (polygon.length < 3) {
          throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $geoWithin value; $polygon should contain at least 3 GeoPoints');
        }

        points = polygon;
      } else {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, "bad $geoWithin value; $polygon should be Polygon object or Array of Parse.GeoPoint's");
      }

      points = points.map(point => {
        if (point instanceof Array && point.length === 2) {
          _node.default.GeoPoint._validate(point[1], point[0]);

          return `(${point[0]}, ${point[1]})`;
        }

        if (typeof point !== 'object' || point.__type !== 'GeoPoint') {
          throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $geoWithin value');
        } else {
          _node.default.GeoPoint._validate(point.latitude, point.longitude);
        }

        return `(${point.longitude}, ${point.latitude})`;
      }).join(', ');
      patterns.push(`$${index}:name::point <@ $${index + 1}::polygon`);
      values.push(fieldName, `(${points})`);
      index += 2;
    }

    if (fieldValue.$geoIntersects && fieldValue.$geoIntersects.$point) {
      const point = fieldValue.$geoIntersects.$point;

      if (typeof point !== 'object' || point.__type !== 'GeoPoint') {
        throw new _node.default.Error(_node.default.Error.INVALID_JSON, 'bad $geoIntersect value; $point should be GeoPoint');
      } else {
        _node.default.GeoPoint._validate(point.latitude, point.longitude);
      }

      patterns.push(`$${index}:name::polygon @> $${index + 1}::point`);
      values.push(fieldName, `(${point.longitude}, ${point.latitude})`);
      index += 2;
    }

    if (fieldValue.$regex) {
      let regex = fieldValue.$regex;
      let operator = '~';
      const opts = fieldValue.$options;

      if (opts) {
        if (opts.indexOf('i') >= 0) {
          operator = '~*';
        }

        if (opts.indexOf('x') >= 0) {
          regex = removeWhiteSpace(regex);
        }
      }

      const name = transformDotField(fieldName);
      regex = processRegexPattern(regex);
      patterns.push(`$${index}:raw ${operator} '$${index + 1}:raw'`);
      values.push(name, regex);
      index += 2;
    }

    if (fieldValue.__type === 'Pointer') {
      if (isArrayField) {
        patterns.push(`array_contains($${index}:name, $${index + 1})`);
        values.push(fieldName, JSON.stringify([fieldValue]));
        index += 2;
      } else {
        patterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue.objectId);
        index += 2;
      }
    }

    if (fieldValue.__type === 'Date') {
      patterns.push(`$${index}:name = $${index + 1}`);
      values.push(fieldName, fieldValue.iso);
      index += 2;
    }

    if (fieldValue.__type === 'GeoPoint') {
      patterns.push('$' + index + ':name ~= POINT($' + (index + 1) + ', $' + (index + 2) + ')');
      values.push(fieldName, fieldValue.longitude, fieldValue.latitude);
      index += 3;
    }

    if (fieldValue.__type === 'Polygon') {
      const value = convertPolygonToSQL(fieldValue.coordinates);
      patterns.push(`$${index}:name ~= $${index + 1}::polygon`);
      values.push(fieldName, value);
      index += 2;
    }

    Object.keys(ParseToPosgresComparator).forEach(cmp => {
      if (fieldValue[cmp] || fieldValue[cmp] === 0) {
        const pgComparator = ParseToPosgresComparator[cmp];
        patterns.push(`$${index}:name ${pgComparator} $${index + 1}`);
        values.push(fieldName, toPostgresValue(fieldValue[cmp]));
        index += 2;
      }
    });

    if (initialPatternsLength === patterns.length) {
      throw new _node.default.Error(_node.default.Error.OPERATION_FORBIDDEN, `Postgres doesn't support this query type yet ${JSON.stringify(fieldValue)}`);
    }
  }

  values = values.map(transformValue);
  return {
    pattern: patterns.join(' AND '),
    values,
    sorts
  };
};

class PostgresStorageAdapter {
  // Private
  constructor({
    uri,
    collectionPrefix = '',
    databaseOptions
  }) {
    this._collectionPrefix = collectionPrefix;
    const {
      client,
      pgp
    } = (0, _PostgresClient.createClient)(uri, databaseOptions);
    this._client = client;
    this._pgp = pgp;
    this.canSortOnJoinTables = false;
  }

  handleShutdown() {
    if (!this._client) {
      return;
    }

    this._client.$pool.end();
  }

  _ensureSchemaCollectionExists(conn) {
    conn = conn || this._client;
    return conn.none('CREATE TABLE IF NOT EXISTS "_SCHEMA" ( "className" varChar(120), "schema" jsonb, "isParseClass" bool, PRIMARY KEY ("className") )').catch(error => {
      if (error.code === PostgresDuplicateRelationError || error.code === PostgresUniqueIndexViolationError || error.code === PostgresDuplicateObjectError) {// Table already exists, must have been created by a different request. Ignore error.
      } else {
        throw error;
      }
    });
  }

  classExists(name) {
    return this._client.one('SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1)', [name], a => a.exists);
  }

  setClassLevelPermissions(className, CLPs) {
    const self = this;
    return this._client.task('set-class-level-permissions', function* (t) {
      yield self._ensureSchemaCollectionExists(t);
      const values = [className, 'schema', 'classLevelPermissions', JSON.stringify(CLPs)];
      yield t.none(`UPDATE "_SCHEMA" SET $2:name = json_object_set_key($2:name, $3::text, $4::jsonb) WHERE "className"=$1`, values);
    });
  }

  setIndexesWithSchemaFormat(className, submittedIndexes, existingIndexes = {}, fields, conn) {
    conn = conn || this._client;
    const self = this;

    if (submittedIndexes === undefined) {
      return Promise.resolve();
    }

    if (Object.keys(existingIndexes).length === 0) {
      existingIndexes = {
        _id_: {
          _id: 1
        }
      };
    }

    const deletedIndexes = [];
    const insertedIndexes = [];
    Object.keys(submittedIndexes).forEach(name => {
      const field = submittedIndexes[name];

      if (existingIndexes[name] && field.__op !== 'Delete') {
        throw new _node.default.Error(_node.default.Error.INVALID_QUERY, `Index ${name} exists, cannot update.`);
      }

      if (!existingIndexes[name] && field.__op === 'Delete') {
        throw new _node.default.Error(_node.default.Error.INVALID_QUERY, `Index ${name} does not exist, cannot delete.`);
      }

      if (field.__op === 'Delete') {
        deletedIndexes.push(name);
        delete existingIndexes[name];
      } else {
        Object.keys(field).forEach(key => {
          if (!fields.hasOwnProperty(key)) {
            throw new _node.default.Error(_node.default.Error.INVALID_QUERY, `Field ${key} does not exist, cannot add index.`);
          }
        });
        existingIndexes[name] = field;
        insertedIndexes.push({
          key: field,
          name
        });
      }
    });
    return conn.tx('set-indexes-with-schema-format', function* (t) {
      if (insertedIndexes.length > 0) {
        yield self.createIndexes(className, insertedIndexes, t);
      }

      if (deletedIndexes.length > 0) {
        yield self.dropIndexes(className, deletedIndexes, t);
      }

      yield self._ensureSchemaCollectionExists(t);
      yield t.none('UPDATE "_SCHEMA" SET $2:name = json_object_set_key($2:name, $3::text, $4::jsonb) WHERE "className"=$1', [className, 'schema', 'indexes', JSON.stringify(existingIndexes)]);
    });
  }

  createClass(className, schema, conn) {
    conn = conn || this._client;
    return conn.tx('create-class', t => {
      const q1 = this.createTable(className, schema, t);
      const q2 = t.none('INSERT INTO "_SCHEMA" ("className", "schema", "isParseClass") VALUES ($<className>, $<schema>, true)', {
        className,
        schema
      });
      const q3 = this.setIndexesWithSchemaFormat(className, schema.indexes, {}, schema.fields, t);
      return t.batch([q1, q2, q3]);
    }).then(() => {
      return toParseSchema(schema);
    }).catch(err => {
      if (err.data[0].result.code === PostgresTransactionAbortedError) {
        err = err.data[1].result;
      }

      if (err.code === PostgresUniqueIndexViolationError && err.detail.includes(className)) {
        throw new _node.default.Error(_node.default.Error.DUPLICATE_VALUE, `Class ${className} already exists.`);
      }

      throw err;
    });
  } // Just create a table, do not insert in schema


  createTable(className, schema, conn) {
    conn = conn || this._client;
    const self = this;
    debug('createTable', className, schema);
    const valuesArray = [];
    const patternsArray = [];
    const fields = Object.assign({}, schema.fields);

    if (className === '_User') {
      fields._email_verify_token_expires_at = {
        type: 'Date'
      };
      fields._email_verify_token = {
        type: 'String'
      };
      fields._account_lockout_expires_at = {
        type: 'Date'
      };
      fields._failed_login_count = {
        type: 'Number'
      };
      fields._perishable_token = {
        type: 'String'
      };
      fields._perishable_token_expires_at = {
        type: 'Date'
      };
      fields._password_changed_at = {
        type: 'Date'
      };
      fields._password_history = {
        type: 'Array'
      };
    }

    let index = 2;
    const relations = [];
    Object.keys(fields).forEach(fieldName => {
      const parseType = fields[fieldName]; // Skip when it's a relation
      // We'll create the tables later

      if (parseType.type === 'Relation') {
        relations.push(fieldName);
        return;
      }

      if (['_rperm', '_wperm'].indexOf(fieldName) >= 0) {
        parseType.contents = {
          type: 'String'
        };
      }

      valuesArray.push(fieldName);
      valuesArray.push(parseTypeToPostgresType(parseType));
      patternsArray.push(`$${index}:name $${index + 1}:raw`);

      if (fieldName === 'objectId') {
        patternsArray.push(`PRIMARY KEY ($${index}:name)`);
      }

      index = index + 2;
    });
    const qs = `CREATE TABLE IF NOT EXISTS $1:name (${patternsArray.join()})`;
    const values = [className, ...valuesArray];
    return conn.task('create-table', function* (t) {
      try {
        yield self._ensureSchemaCollectionExists(t);
        yield t.none(qs, values);
      } catch (error) {
        if (error.code !== PostgresDuplicateRelationError) {
          throw error;
        } // ELSE: Table already exists, must have been created by a different request. Ignore the error.

      }

      yield t.tx('create-table-tx', tx => {
        return tx.batch(relations.map(fieldName => {
          return tx.none('CREATE TABLE IF NOT EXISTS $<joinTable:name> ("relatedId" varChar(120), "owningId" varChar(120), PRIMARY KEY("relatedId", "owningId") )', {
            joinTable: `_Join:${fieldName}:${className}`
          });
        }));
      });
    });
  }

  schemaUpgrade(className, schema, conn) {
    debug('schemaUpgrade', {
      className,
      schema
    });
    conn = conn || this._client;
    const self = this;
    return conn.tx('schema-upgrade', function* (t) {
      const columns = yield t.map('SELECT column_name FROM information_schema.columns WHERE table_name = $<className>', {
        className
      }, a => a.column_name);
      const newColumns = Object.keys(schema.fields).filter(item => columns.indexOf(item) === -1).map(fieldName => self.addFieldIfNotExists(className, fieldName, schema.fields[fieldName], t));
      yield t.batch(newColumns);
    });
  }

  addFieldIfNotExists(className, fieldName, type, conn) {
    // TODO: Must be revised for invalid logic...
    debug('addFieldIfNotExists', {
      className,
      fieldName,
      type
    });
    conn = conn || this._client;
    const self = this;
    return conn.tx('add-field-if-not-exists', function* (t) {
      if (type.type !== 'Relation') {
        try {
          yield t.none('ALTER TABLE $<className:name> ADD COLUMN $<fieldName:name> $<postgresType:raw>', {
            className,
            fieldName,
            postgresType: parseTypeToPostgresType(type)
          });
        } catch (error) {
          if (error.code === PostgresRelationDoesNotExistError) {
            return yield self.createClass(className, {
              fields: {
                [fieldName]: type
              }
            }, t);
          }

          if (error.code !== PostgresDuplicateColumnError) {
            throw error;
          } // Column already exists, created by other request. Carry on to see if it's the right type.

        }
      } else {
        yield t.none('CREATE TABLE IF NOT EXISTS $<joinTable:name> ("relatedId" varChar(120), "owningId" varChar(120), PRIMARY KEY("relatedId", "owningId") )', {
          joinTable: `_Join:${fieldName}:${className}`
        });
      }

      const result = yield t.any('SELECT "schema" FROM "_SCHEMA" WHERE "className" = $<className> and ("schema"::json->\'fields\'->$<fieldName>) is not null', {
        className,
        fieldName
      });

      if (result[0]) {
        throw 'Attempted to add a field that already exists';
      } else {
        const path = `{fields,${fieldName}}`;
        yield t.none('UPDATE "_SCHEMA" SET "schema"=jsonb_set("schema", $<path>, $<type>)  WHERE "className"=$<className>', {
          path,
          type,
          className
        });
      }
    });
  } // Drops a collection. Resolves with true if it was a Parse Schema (eg. _User, Custom, etc.)
  // and resolves with false if it wasn't (eg. a join table). Rejects if deletion was impossible.


  deleteClass(className) {
    const operations = [{
      query: `DROP TABLE IF EXISTS $1:name`,
      values: [className]
    }, {
      query: `DELETE FROM "_SCHEMA" WHERE "className" = $1`,
      values: [className]
    }];
    return this._client.tx(t => t.none(this._pgp.helpers.concat(operations))).then(() => className.indexOf('_Join:') != 0); // resolves with false when _Join table
  } // Delete all data known to this adapter. Used for testing.


  deleteAllClasses() {
    const now = new Date().getTime();
    const helpers = this._pgp.helpers;
    debug('deleteAllClasses');
    return this._client.task('delete-all-classes', function* (t) {
      try {
        const results = yield t.any('SELECT * FROM "_SCHEMA"');
        const joins = results.reduce((list, schema) => {
          return list.concat(joinTablesForSchema(schema.schema));
        }, []);
        const classes = ['_SCHEMA', '_PushStatus', '_JobStatus', '_JobSchedule', '_Hooks', '_GlobalConfig', '_Audience', ...results.map(result => result.className), ...joins];
        const queries = classes.map(className => ({
          query: 'DROP TABLE IF EXISTS $<className:name>',
          values: {
            className
          }
        }));
        yield t.tx(tx => tx.none(helpers.concat(queries)));
      } catch (error) {
        if (error.code !== PostgresRelationDoesNotExistError) {
          throw error;
        } // No _SCHEMA collection. Don't delete anything.

      }
    }).then(() => {
      debug(`deleteAllClasses done in ${new Date().getTime() - now}`);
    });
  } // Remove the column and all the data. For Relations, the _Join collection is handled
  // specially, this function does not delete _Join columns. It should, however, indicate
  // that the relation fields does not exist anymore. In mongo, this means removing it from
  // the _SCHEMA collection.  There should be no actual data in the collection under the same name
  // as the relation column, so it's fine to attempt to delete it. If the fields listed to be
  // deleted do not exist, this function should return successfully anyways. Checking for
  // attempts to delete non-existent fields is the responsibility of Parse Server.
  // This function is not obligated to delete fields atomically. It is given the field
  // names in a list so that databases that are capable of deleting fields atomically
  // may do so.
  // Returns a Promise.


  deleteFields(className, schema, fieldNames) {
    debug('deleteFields', className, fieldNames);
    fieldNames = fieldNames.reduce((list, fieldName) => {
      const field = schema.fields[fieldName];

      if (field.type !== 'Relation') {
        list.push(fieldName);
      }

      delete schema.fields[fieldName];
      return list;
    }, []);
    const values = [className, ...fieldNames];
    const columns = fieldNames.map((name, idx) => {
      return `$${idx + 2}:name`;
    }).join(', DROP COLUMN');
    return this._client.tx('delete-fields', function* (t) {
      yield t.none('UPDATE "_SCHEMA" SET "schema"=$<schema> WHERE "className"=$<className>', {
        schema,
        className
      });

      if (values.length > 1) {
        yield t.none(`ALTER TABLE $1:name DROP COLUMN ${columns}`, values);
      }
    });
  } // Return a promise for all schemas known to this adapter, in Parse format. In case the
  // schemas cannot be retrieved, returns a promise that rejects. Requirements for the
  // rejection reason are TBD.


  getAllClasses() {
    const self = this;
    return this._client.task('get-all-classes', function* (t) {
      yield self._ensureSchemaCollectionExists(t);
      return yield t.map('SELECT * FROM "_SCHEMA"', null, row => toParseSchema(_objectSpread({
        className: row.className
      }, row.schema)));
    });
  } // Return a promise for the schema with the given name, in Parse format. If
  // this adapter doesn't know about the schema, return a promise that rejects with
  // undefined as the reason.


  getClass(className) {
    debug('getClass', className);
    return this._client.any('SELECT * FROM "_SCHEMA" WHERE "className"=$<className>', {
      className
    }).then(result => {
      if (result.length !== 1) {
        throw undefined;
      }

      return result[0].schema;
    }).then(toParseSchema);
  } // TODO: remove the mongo format dependency in the return value


  createObject(className, schema, object) {
    debug('createObject', className, object);
    let columnsArray = [];
    const valuesArray = [];
    schema = toPostgresSchema(schema);
    const geoPoints = {};
    object = handleDotFields(object);
    validateKeys(object);
    Object.keys(object).forEach(fieldName => {
      if (object[fieldName] === null) {
        return;
      }

      var authDataMatch = fieldName.match(/^_auth_data_([a-zA-Z0-9_]+)$/);

      if (authDataMatch) {
        var provider = authDataMatch[1];
        object['authData'] = object['authData'] || {};
        object['authData'][provider] = object[fieldName];
        delete object[fieldName];
        fieldName = 'authData';
      }

      columnsArray.push(fieldName);

      if (!schema.fields[fieldName] && className === '_User') {
        if (fieldName === '_email_verify_token' || fieldName === '_failed_login_count' || fieldName === '_perishable_token' || fieldName === '_password_history') {
          valuesArray.push(object[fieldName]);
        }

        if (fieldName === '_email_verify_token_expires_at') {
          if (object[fieldName]) {
            valuesArray.push(object[fieldName].iso);
          } else {
            valuesArray.push(null);
          }
        }

        if (fieldName === '_account_lockout_expires_at' || fieldName === '_perishable_token_expires_at' || fieldName === '_password_changed_at') {
          if (object[fieldName]) {
            valuesArray.push(object[fieldName].iso);
          } else {
            valuesArray.push(null);
          }
        }

        return;
      }

      switch (schema.fields[fieldName].type) {
        case 'Date':
          if (object[fieldName]) {
            valuesArray.push(object[fieldName].iso);
          } else {
            valuesArray.push(null);
          }

          break;

        case 'Pointer':
          valuesArray.push(object[fieldName].objectId);
          break;

        case 'Array':
          if (['_rperm', '_wperm'].indexOf(fieldName) >= 0) {
            valuesArray.push(object[fieldName]);
          } else {
            valuesArray.push(JSON.stringify(object[fieldName]));
          }

          break;

        case 'Object':
        case 'Bytes':
        case 'String':
        case 'Number':
        case 'Boolean':
          valuesArray.push(object[fieldName]);
          break;

        case 'File':
          valuesArray.push(object[fieldName].name);
          break;

        case 'Polygon':
          {
            const value = convertPolygonToSQL(object[fieldName].coordinates);
            valuesArray.push(value);
            break;
          }

        case 'GeoPoint':
          // pop the point and process later
          geoPoints[fieldName] = object[fieldName];
          columnsArray.pop();
          break;

        default:
          throw `Type ${schema.fields[fieldName].type} not supported yet`;
      }
    });
    columnsArray = columnsArray.concat(Object.keys(geoPoints));
    const initialValues = valuesArray.map((val, index) => {
      let termination = '';
      const fieldName = columnsArray[index];

      if (['_rperm', '_wperm'].indexOf(fieldName) >= 0) {
        termination = '::text[]';
      } else if (schema.fields[fieldName] && schema.fields[fieldName].type === 'Array') {
        termination = '::jsonb';
      }

      return `$${index + 2 + columnsArray.length}${termination}`;
    });
    const geoPointsInjects = Object.keys(geoPoints).map(key => {
      const value = geoPoints[key];
      valuesArray.push(value.longitude, value.latitude);
      const l = valuesArray.length + columnsArray.length;
      return `POINT($${l}, $${l + 1})`;
    });
    const columnsPattern = columnsArray.map((col, index) => `$${index + 2}:name`).join();
    const valuesPattern = initialValues.concat(geoPointsInjects).join();
    const qs = `INSERT INTO $1:name (${columnsPattern}) VALUES (${valuesPattern})`;
    const values = [className, ...columnsArray, ...valuesArray];
    debug(qs, values);
    return this._client.none(qs, values).then(() => ({
      ops: [object]
    })).catch(error => {
      if (error.code === PostgresUniqueIndexViolationError) {
        const err = new _node.default.Error(_node.default.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
        err.underlyingError = error;

        if (error.constraint) {
          const matches = error.constraint.match(/unique_([a-zA-Z]+)/);

          if (matches && Array.isArray(matches)) {
            err.userInfo = {
              duplicated_field: matches[1]
            };
          }
        }

        error = err;
      }

      throw error;
    });
  } // Remove all objects that match the given Parse Query.
  // If no objects match, reject with OBJECT_NOT_FOUND. If objects are found and deleted, resolve with undefined.
  // If there is some other error, reject with INTERNAL_SERVER_ERROR.


  deleteObjectsByQuery(className, schema, query) {
    debug('deleteObjectsByQuery', className, query);
    const values = [className];
    const index = 2;
    const where = buildWhereClause({
      schema,
      index,
      query
    });
    values.push(...where.values);

    if (Object.keys(query).length === 0) {
      where.pattern = 'TRUE';
    }

    const qs = `WITH deleted AS (DELETE FROM $1:name WHERE ${where.pattern} RETURNING *) SELECT count(*) FROM deleted`;
    debug(qs, values);
    return this._client.one(qs, values, a => +a.count).then(count => {
      if (count === 0) {
        throw new _node.default.Error(_node.default.Error.OBJECT_NOT_FOUND, 'Object not found.');
      } else {
        return count;
      }
    }).catch(error => {
      if (error.code !== PostgresRelationDoesNotExistError) {
        throw error;
      } // ELSE: Don't delete anything if doesn't exist

    });
  } // Return value not currently well specified.


  findOneAndUpdate(className, schema, query, update) {
    debug('findOneAndUpdate', className, query, update);
    return this.updateObjectsByQuery(className, schema, query, update).then(val => val[0]);
  } // Apply the update to all objects that match the given Parse Query.


  updateObjectsByQuery(className, schema, query, update) {
    debug('updateObjectsByQuery', className, query, update);
    const updatePatterns = [];
    const values = [className];
    let index = 2;
    schema = toPostgresSchema(schema);

    const originalUpdate = _objectSpread({}, update);

    update = handleDotFields(update); // Resolve authData first,
    // So we don't end up with multiple key updates

    for (const fieldName in update) {
      const authDataMatch = fieldName.match(/^_auth_data_([a-zA-Z0-9_]+)$/);

      if (authDataMatch) {
        var provider = authDataMatch[1];
        const value = update[fieldName];
        delete update[fieldName];
        update['authData'] = update['authData'] || {};
        update['authData'][provider] = value;
      }
    }

    for (const fieldName in update) {
      const fieldValue = update[fieldName]; // Drop any undefined values.

      if (typeof fieldValue === 'undefined') {
        delete update[fieldName];
      } else if (fieldValue === null) {
        updatePatterns.push(`$${index}:name = NULL`);
        values.push(fieldName);
        index += 1;
      } else if (fieldName == 'authData') {
        // This recursively sets the json_object
        // Only 1 level deep
        const generate = (jsonb, key, value) => {
          return `json_object_set_key(COALESCE(${jsonb}, '{}'::jsonb), ${key}, ${value})::jsonb`;
        };

        const lastKey = `$${index}:name`;
        const fieldNameIndex = index;
        index += 1;
        values.push(fieldName);
        const update = Object.keys(fieldValue).reduce((lastKey, key) => {
          const str = generate(lastKey, `$${index}::text`, `$${index + 1}::jsonb`);
          index += 2;
          let value = fieldValue[key];

          if (value) {
            if (value.__op === 'Delete') {
              value = null;
            } else {
              value = JSON.stringify(value);
            }
          }

          values.push(key, value);
          return str;
        }, lastKey);
        updatePatterns.push(`$${fieldNameIndex}:name = ${update}`);
      } else if (fieldValue.__op === 'Increment') {
        updatePatterns.push(`$${index}:name = COALESCE($${index}:name, 0) + $${index + 1}`);
        values.push(fieldName, fieldValue.amount);
        index += 2;
      } else if (fieldValue.__op === 'Add') {
        updatePatterns.push(`$${index}:name = array_add(COALESCE($${index}:name, '[]'::jsonb), $${index + 1}::jsonb)`);
        values.push(fieldName, JSON.stringify(fieldValue.objects));
        index += 2;
      } else if (fieldValue.__op === 'Delete') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, null);
        index += 2;
      } else if (fieldValue.__op === 'Remove') {
        updatePatterns.push(`$${index}:name = array_remove(COALESCE($${index}:name, '[]'::jsonb), $${index + 1}::jsonb)`);
        values.push(fieldName, JSON.stringify(fieldValue.objects));
        index += 2;
      } else if (fieldValue.__op === 'AddUnique') {
        updatePatterns.push(`$${index}:name = array_add_unique(COALESCE($${index}:name, '[]'::jsonb), $${index + 1}::jsonb)`);
        values.push(fieldName, JSON.stringify(fieldValue.objects));
        index += 2;
      } else if (fieldName === 'updatedAt') {
        //TODO: stop special casing this. It should check for __type === 'Date' and use .iso
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (typeof fieldValue === 'string') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (typeof fieldValue === 'boolean') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (fieldValue.__type === 'Pointer') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue.objectId);
        index += 2;
      } else if (fieldValue.__type === 'Date') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, toPostgresValue(fieldValue));
        index += 2;
      } else if (fieldValue instanceof Date) {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (fieldValue.__type === 'File') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, toPostgresValue(fieldValue));
        index += 2;
      } else if (fieldValue.__type === 'GeoPoint') {
        updatePatterns.push(`$${index}:name = POINT($${index + 1}, $${index + 2})`);
        values.push(fieldName, fieldValue.longitude, fieldValue.latitude);
        index += 3;
      } else if (fieldValue.__type === 'Polygon') {
        const value = convertPolygonToSQL(fieldValue.coordinates);
        updatePatterns.push(`$${index}:name = $${index + 1}::polygon`);
        values.push(fieldName, value);
        index += 2;
      } else if (fieldValue.__type === 'Relation') {// noop
      } else if (typeof fieldValue === 'number') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (typeof fieldValue === 'object' && schema.fields[fieldName] && schema.fields[fieldName].type === 'Object') {
        // Gather keys to increment
        const keysToIncrement = Object.keys(originalUpdate).filter(k => {
          // choose top level fields that have a delete operation set
          // Note that Object.keys is iterating over the **original** update object
          // and that some of the keys of the original update could be null or undefined:
          // (See the above check `if (fieldValue === null || typeof fieldValue == "undefined")`)
          const value = originalUpdate[k];
          return value && value.__op === 'Increment' && k.split('.').length === 2 && k.split('.')[0] === fieldName;
        }).map(k => k.split('.')[1]);
        let incrementPatterns = '';

        if (keysToIncrement.length > 0) {
          incrementPatterns = ' || ' + keysToIncrement.map(c => {
            const amount = fieldValue[c].amount;
            return `CONCAT('{"${c}":', COALESCE($${index}:name->>'${c}','0')::int + ${amount}, '}')::jsonb`;
          }).join(' || '); // Strip the keys

          keysToIncrement.forEach(key => {
            delete fieldValue[key];
          });
        }

        const keysToDelete = Object.keys(originalUpdate).filter(k => {
          // choose top level fields that have a delete operation set.
          const value = originalUpdate[k];
          return value && value.__op === 'Delete' && k.split('.').length === 2 && k.split('.')[0] === fieldName;
        }).map(k => k.split('.')[1]);
        const deletePatterns = keysToDelete.reduce((p, c, i) => {
          return p + ` - '$${index + 1 + i}:value'`;
        }, '');
        updatePatterns.push(`$${index}:name = ('{}'::jsonb ${deletePatterns} ${incrementPatterns} || $${index + 1 + keysToDelete.length}::jsonb )`);
        values.push(fieldName, ...keysToDelete, JSON.stringify(fieldValue));
        index += 2 + keysToDelete.length;
      } else if (Array.isArray(fieldValue) && schema.fields[fieldName] && schema.fields[fieldName].type === 'Array') {
        const expectedType = parseTypeToPostgresType(schema.fields[fieldName]);

        if (expectedType === 'text[]') {
          updatePatterns.push(`$${index}:name = $${index + 1}::text[]`);
        } else {
          let type = 'text';

          for (const elt of fieldValue) {
            if (typeof elt == 'object') {
              type = 'json';
              break;
            }
          }

          updatePatterns.push(`$${index}:name = array_to_json($${index + 1}::${type}[])::jsonb`);
        }

        values.push(fieldName, fieldValue);
        index += 2;
      } else {
        debug('Not supported update', fieldName, fieldValue);
        return Promise.reject(new _node.default.Error(_node.default.Error.OPERATION_FORBIDDEN, `Postgres doesn't support update ${JSON.stringify(fieldValue)} yet`));
      }
    }

    const where = buildWhereClause({
      schema,
      index,
      query
    });
    values.push(...where.values);
    const whereClause = where.pattern.length > 0 ? `WHERE ${where.pattern}` : '';
    const qs = `UPDATE $1:name SET ${updatePatterns.join()} ${whereClause} RETURNING *`;
    debug('update: ', qs, values);
    return this._client.any(qs, values);
  } // Hopefully, we can get rid of this. It's only used for config and hooks.


  upsertOneObject(className, schema, query, update) {
    debug('upsertOneObject', {
      className,
      query,
      update
    });
    const createValue = Object.assign({}, query, update);
    return this.createObject(className, schema, createValue).catch(error => {
      // ignore duplicate value errors as it's upsert
      if (error.code !== _node.default.Error.DUPLICATE_VALUE) {
        throw error;
      }

      return this.findOneAndUpdate(className, schema, query, update);
    });
  }

  find(className, schema, query, {
    skip,
    limit,
    sort,
    keys
  }) {
    debug('find', className, query, {
      skip,
      limit,
      sort,
      keys
    });
    const hasLimit = limit !== undefined;
    const hasSkip = skip !== undefined;
    let values = [className];
    const where = buildWhereClause({
      schema,
      query,
      index: 2
    });
    values.push(...where.values);
    const wherePattern = where.pattern.length > 0 ? `WHERE ${where.pattern}` : '';
    const limitPattern = hasLimit ? `LIMIT $${values.length + 1}` : '';

    if (hasLimit) {
      values.push(limit);
    }

    const skipPattern = hasSkip ? `OFFSET $${values.length + 1}` : '';

    if (hasSkip) {
      values.push(skip);
    }

    let sortPattern = '';

    if (sort) {
      const sortCopy = sort;
      const sorting = Object.keys(sort).map(key => {
        const transformKey = transformDotFieldToComponents(key).join('->'); // Using $idx pattern gives:  non-integer constant in ORDER BY

        if (sortCopy[key] === 1) {
          return `${transformKey} ASC`;
        }

        return `${transformKey} DESC`;
      }).join();
      sortPattern = sort !== undefined && Object.keys(sort).length > 0 ? `ORDER BY ${sorting}` : '';
    }

    if (where.sorts && Object.keys(where.sorts).length > 0) {
      sortPattern = `ORDER BY ${where.sorts.join()}`;
    }

    let columns = '*';

    if (keys) {
      // Exclude empty keys
      // Replace ACL by it's keys
      keys = keys.reduce((memo, key) => {
        if (key === 'ACL') {
          memo.push('_rperm');
          memo.push('_wperm');
        } else if (key.length > 0) {
          memo.push(key);
        }

        return memo;
      }, []);
      columns = keys.map((key, index) => {
        if (key === '$score') {
          return `ts_rank_cd(to_tsvector($${2}, $${3}:name), to_tsquery($${4}, $${5}), 32) as score`;
        }

        return `$${index + values.length + 1}:name`;
      }).join();
      values = values.concat(keys);
    }

    const qs = `SELECT ${columns} FROM $1:name ${wherePattern} ${sortPattern} ${limitPattern} ${skipPattern}`;
    debug(qs, values);
    return this._client.any(qs, values).catch(error => {
      // Query on non existing table, don't crash
      if (error.code !== PostgresRelationDoesNotExistError) {
        throw error;
      }

      return [];
    }).then(results => results.map(object => this.postgresObjectToParseObject(className, object, schema)));
  } // Converts from a postgres-format object to a REST-format object.
  // Does not strip out anything based on a lack of authentication.


  postgresObjectToParseObject(className, object, schema) {
    Object.keys(schema.fields).forEach(fieldName => {
      if (schema.fields[fieldName].type === 'Pointer' && object[fieldName]) {
        object[fieldName] = {
          objectId: object[fieldName],
          __type: 'Pointer',
          className: schema.fields[fieldName].targetClass
        };
      }

      if (schema.fields[fieldName].type === 'Relation') {
        object[fieldName] = {
          __type: 'Relation',
          className: schema.fields[fieldName].targetClass
        };
      }

      if (object[fieldName] && schema.fields[fieldName].type === 'GeoPoint') {
        object[fieldName] = {
          __type: 'GeoPoint',
          latitude: object[fieldName].y,
          longitude: object[fieldName].x
        };
      }

      if (object[fieldName] && schema.fields[fieldName].type === 'Polygon') {
        let coords = object[fieldName];
        coords = coords.substr(2, coords.length - 4).split('),(');
        coords = coords.map(point => {
          return [parseFloat(point.split(',')[1]), parseFloat(point.split(',')[0])];
        });
        object[fieldName] = {
          __type: 'Polygon',
          coordinates: coords
        };
      }

      if (object[fieldName] && schema.fields[fieldName].type === 'File') {
        object[fieldName] = {
          __type: 'File',
          name: object[fieldName]
        };
      }
    }); //TODO: remove this reliance on the mongo format. DB adapter shouldn't know there is a difference between created at and any other date field.

    if (object.createdAt) {
      object.createdAt = object.createdAt.toISOString();
    }

    if (object.updatedAt) {
      object.updatedAt = object.updatedAt.toISOString();
    }

    if (object.expiresAt) {
      object.expiresAt = {
        __type: 'Date',
        iso: object.expiresAt.toISOString()
      };
    }

    if (object._email_verify_token_expires_at) {
      object._email_verify_token_expires_at = {
        __type: 'Date',
        iso: object._email_verify_token_expires_at.toISOString()
      };
    }

    if (object._account_lockout_expires_at) {
      object._account_lockout_expires_at = {
        __type: 'Date',
        iso: object._account_lockout_expires_at.toISOString()
      };
    }

    if (object._perishable_token_expires_at) {
      object._perishable_token_expires_at = {
        __type: 'Date',
        iso: object._perishable_token_expires_at.toISOString()
      };
    }

    if (object._password_changed_at) {
      object._password_changed_at = {
        __type: 'Date',
        iso: object._password_changed_at.toISOString()
      };
    }

    for (const fieldName in object) {
      if (object[fieldName] === null) {
        delete object[fieldName];
      }

      if (object[fieldName] instanceof Date) {
        object[fieldName] = {
          __type: 'Date',
          iso: object[fieldName].toISOString()
        };
      }
    }

    return object;
  } // Create a unique index. Unique indexes on nullable fields are not allowed. Since we don't
  // currently know which fields are nullable and which aren't, we ignore that criteria.
  // As such, we shouldn't expose this function to users of parse until we have an out-of-band
  // Way of determining if a field is nullable. Undefined doesn't count against uniqueness,
  // which is why we use sparse indexes.


  ensureUniqueness(className, schema, fieldNames) {
    // Use the same name for every ensureUniqueness attempt, because postgres
    // Will happily create the same index with multiple names.
    const constraintName = `unique_${fieldNames.sort().join('_')}`;
    const constraintPatterns = fieldNames.map((fieldName, index) => `$${index + 3}:name`);
    const qs = `ALTER TABLE $1:name ADD CONSTRAINT $2:name UNIQUE (${constraintPatterns.join()})`;
    return this._client.none(qs, [className, constraintName, ...fieldNames]).catch(error => {
      if (error.code === PostgresDuplicateRelationError && error.message.includes(constraintName)) {// Index already exists. Ignore error.
      } else if (error.code === PostgresUniqueIndexViolationError && error.message.includes(constraintName)) {
        // Cast the error into the proper parse error
        throw new _node.default.Error(_node.default.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
      } else {
        throw error;
      }
    });
  } // Executes a count.


  count(className, schema, query) {
    debug('count', className, query);
    const values = [className];
    const where = buildWhereClause({
      schema,
      query,
      index: 2
    });
    values.push(...where.values);
    const wherePattern = where.pattern.length > 0 ? `WHERE ${where.pattern}` : '';
    const qs = `SELECT count(*) FROM $1:name ${wherePattern}`;
    return this._client.one(qs, values, a => +a.count).catch(error => {
      if (error.code !== PostgresRelationDoesNotExistError) {
        throw error;
      }

      return 0;
    });
  }

  distinct(className, schema, query, fieldName) {
    debug('distinct', className, query);
    let field = fieldName;
    let column = fieldName;
    const isNested = fieldName.indexOf('.') >= 0;

    if (isNested) {
      field = transformDotFieldToComponents(fieldName).join('->');
      column = fieldName.split('.')[0];
    }

    const isArrayField = schema.fields && schema.fields[fieldName] && schema.fields[fieldName].type === 'Array';
    const isPointerField = schema.fields && schema.fields[fieldName] && schema.fields[fieldName].type === 'Pointer';
    const values = [field, column, className];
    const where = buildWhereClause({
      schema,
      query,
      index: 4
    });
    values.push(...where.values);
    const wherePattern = where.pattern.length > 0 ? `WHERE ${where.pattern}` : '';
    const transformer = isArrayField ? 'jsonb_array_elements' : 'ON';
    let qs = `SELECT DISTINCT ${transformer}($1:name) $2:name FROM $3:name ${wherePattern}`;

    if (isNested) {
      qs = `SELECT DISTINCT ${transformer}($1:raw) $2:raw FROM $3:name ${wherePattern}`;
    }

    debug(qs, values);
    return this._client.any(qs, values).catch(error => {
      if (error.code === PostgresMissingColumnError) {
        return [];
      }

      throw error;
    }).then(results => {
      if (!isNested) {
        results = results.filter(object => object[field] !== null);
        return results.map(object => {
          if (!isPointerField) {
            return object[field];
          }

          return {
            __type: 'Pointer',
            className: schema.fields[fieldName].targetClass,
            objectId: object[field]
          };
        });
      }

      const child = fieldName.split('.')[1];
      return results.map(object => object[column][child]);
    }).then(results => results.map(object => this.postgresObjectToParseObject(className, object, schema)));
  }

  aggregate(className, schema, pipeline) {
    debug('aggregate', className, pipeline);
    const values = [className];
    let index = 2;
    let columns = [];
    let countField = null;
    let groupValues = null;
    let wherePattern = '';
    let limitPattern = '';
    let skipPattern = '';
    let sortPattern = '';
    let groupPattern = '';

    for (let i = 0; i < pipeline.length; i += 1) {
      const stage = pipeline[i];

      if (stage.$group) {
        for (const field in stage.$group) {
          const value = stage.$group[field];

          if (value === null || value === undefined) {
            continue;
          }

          if (field === '_id' && typeof value === 'string' && value !== '') {
            columns.push(`$${index}:name AS "objectId"`);
            groupPattern = `GROUP BY $${index}:name`;
            values.push(transformAggregateField(value));
            index += 1;
            continue;
          }

          if (field === '_id' && typeof value === 'object' && Object.keys(value).length !== 0) {
            groupValues = value;
            const groupByFields = [];

            for (const alias in value) {
              const operation = Object.keys(value[alias])[0];
              const source = transformAggregateField(value[alias][operation]);

              if (mongoAggregateToPostgres[operation]) {
                if (!groupByFields.includes(`"${source}"`)) {
                  groupByFields.push(`"${source}"`);
                }

                columns.push(`EXTRACT(${mongoAggregateToPostgres[operation]} FROM $${index}:name AT TIME ZONE 'UTC') AS $${index + 1}:name`);
                values.push(source, alias);
                index += 2;
              }
            }

            groupPattern = `GROUP BY $${index}:raw`;
            values.push(groupByFields.join());
            index += 1;
            continue;
          }

          if (value.$sum) {
            if (typeof value.$sum === 'string') {
              columns.push(`SUM($${index}:name) AS $${index + 1}:name`);
              values.push(transformAggregateField(value.$sum), field);
              index += 2;
            } else {
              countField = field;
              columns.push(`COUNT(*) AS $${index}:name`);
              values.push(field);
              index += 1;
            }
          }

          if (value.$max) {
            columns.push(`MAX($${index}:name) AS $${index + 1}:name`);
            values.push(transformAggregateField(value.$max), field);
            index += 2;
          }

          if (value.$min) {
            columns.push(`MIN($${index}:name) AS $${index + 1}:name`);
            values.push(transformAggregateField(value.$min), field);
            index += 2;
          }

          if (value.$avg) {
            columns.push(`AVG($${index}:name) AS $${index + 1}:name`);
            values.push(transformAggregateField(value.$avg), field);
            index += 2;
          }
        }
      } else {
        columns.push('*');
      }

      if (stage.$project) {
        if (columns.includes('*')) {
          columns = [];
        }

        for (const field in stage.$project) {
          const value = stage.$project[field];

          if (value === 1 || value === true) {
            columns.push(`$${index}:name`);
            values.push(field);
            index += 1;
          }
        }
      }

      if (stage.$match) {
        const patterns = [];
        const orOrAnd = stage.$match.hasOwnProperty('$or') ? ' OR ' : ' AND ';

        if (stage.$match.$or) {
          const collapse = {};
          stage.$match.$or.forEach(element => {
            for (const key in element) {
              collapse[key] = element[key];
            }
          });
          stage.$match = collapse;
        }

        for (const field in stage.$match) {
          const value = stage.$match[field];
          const matchPatterns = [];
          Object.keys(ParseToPosgresComparator).forEach(cmp => {
            if (value[cmp]) {
              const pgComparator = ParseToPosgresComparator[cmp];
              matchPatterns.push(`$${index}:name ${pgComparator} $${index + 1}`);
              values.push(field, toPostgresValue(value[cmp]));
              index += 2;
            }
          });

          if (matchPatterns.length > 0) {
            patterns.push(`(${matchPatterns.join(' AND ')})`);
          }

          if (schema.fields[field] && schema.fields[field].type && matchPatterns.length === 0) {
            patterns.push(`$${index}:name = $${index + 1}`);
            values.push(field, value);
            index += 2;
          }
        }

        wherePattern = patterns.length > 0 ? `WHERE ${patterns.join(` ${orOrAnd} `)}` : '';
      }

      if (stage.$limit) {
        limitPattern = `LIMIT $${index}`;
        values.push(stage.$limit);
        index += 1;
      }

      if (stage.$skip) {
        skipPattern = `OFFSET $${index}`;
        values.push(stage.$skip);
        index += 1;
      }

      if (stage.$sort) {
        const sort = stage.$sort;
        const keys = Object.keys(sort);
        const sorting = keys.map(key => {
          const transformer = sort[key] === 1 ? 'ASC' : 'DESC';
          const order = `$${index}:name ${transformer}`;
          index += 1;
          return order;
        }).join();
        values.push(...keys);
        sortPattern = sort !== undefined && sorting.length > 0 ? `ORDER BY ${sorting}` : '';
      }
    }

    const qs = `SELECT ${columns.join()} FROM $1:name ${wherePattern} ${sortPattern} ${limitPattern} ${skipPattern} ${groupPattern}`;
    debug(qs, values);
    return this._client.map(qs, values, a => this.postgresObjectToParseObject(className, a, schema)).then(results => {
      results.forEach(result => {
        if (!result.hasOwnProperty('objectId')) {
          result.objectId = null;
        }

        if (groupValues) {
          result.objectId = {};

          for (const key in groupValues) {
            result.objectId[key] = result[key];
            delete result[key];
          }
        }

        if (countField) {
          result[countField] = parseInt(result[countField], 10);
        }
      });
      return results;
    });
  }

  performInitialization({
    VolatileClassesSchemas
  }) {
    // TODO: This method needs to be rewritten to make proper use of connections (@vitaly-t)
    debug('performInitialization');
    const promises = VolatileClassesSchemas.map(schema => {
      return this.createTable(schema.className, schema).catch(err => {
        if (err.code === PostgresDuplicateRelationError || err.code === _node.default.Error.INVALID_CLASS_NAME) {
          return Promise.resolve();
        }

        throw err;
      }).then(() => this.schemaUpgrade(schema.className, schema));
    });
    return Promise.all(promises).then(() => {
      return this._client.tx('perform-initialization', t => {
        return t.batch([t.none(_sql.default.misc.jsonObjectSetKeys), t.none(_sql.default.array.add), t.none(_sql.default.array.addUnique), t.none(_sql.default.array.remove), t.none(_sql.default.array.containsAll), t.none(_sql.default.array.containsAllRegex), t.none(_sql.default.array.contains)]);
      });
    }).then(data => {
      debug(`initializationDone in ${data.duration}`);
    }).catch(error => {
      /* eslint-disable no-console */
      console.error(error);
    });
  }

  createIndexes(className, indexes, conn) {
    return (conn || this._client).tx(t => t.batch(indexes.map(i => {
      return t.none('CREATE INDEX $1:name ON $2:name ($3:name)', [i.name, className, i.key]);
    })));
  }

  createIndexesIfNeeded(className, fieldName, type, conn) {
    return (conn || this._client).none('CREATE INDEX $1:name ON $2:name ($3:name)', [fieldName, className, type]);
  }

  dropIndexes(className, indexes, conn) {
    const queries = indexes.map(i => ({
      query: 'DROP INDEX $1:name',
      values: i
    }));
    return (conn || this._client).tx(t => t.none(this._pgp.helpers.concat(queries)));
  }

  getIndexes(className) {
    const qs = 'SELECT * FROM pg_indexes WHERE tablename = ${className}';
    return this._client.any(qs, {
      className
    });
  }

  updateSchemaWithIndexes() {
    return Promise.resolve();
  }

}

exports.PostgresStorageAdapter = PostgresStorageAdapter;

function convertPolygonToSQL(polygon) {
  if (polygon.length < 3) {
    throw new _node.default.Error(_node.default.Error.INVALID_JSON, `Polygon must have at least 3 values`);
  }

  if (polygon[0][0] !== polygon[polygon.length - 1][0] || polygon[0][1] !== polygon[polygon.length - 1][1]) {
    polygon.push(polygon[0]);
  }

  const unique = polygon.filter((item, index, ar) => {
    let foundIndex = -1;

    for (let i = 0; i < ar.length; i += 1) {
      const pt = ar[i];

      if (pt[0] === item[0] && pt[1] === item[1]) {
        foundIndex = i;
        break;
      }
    }

    return foundIndex === index;
  });

  if (unique.length < 3) {
    throw new _node.default.Error(_node.default.Error.INTERNAL_SERVER_ERROR, 'GeoJSON: Loop must have at least 3 different vertices');
  }

  const points = polygon.map(point => {
    _node.default.GeoPoint._validate(parseFloat(point[1]), parseFloat(point[0]));

    return `(${point[1]}, ${point[0]})`;
  }).join(', ');
  return `(${points})`;
}

function removeWhiteSpace(regex) {
  if (!regex.endsWith('\n')) {
    regex += '\n';
  } // remove non escaped comments


  return regex.replace(/([^\\])#.*\n/gim, '$1') // remove lines starting with a comment
  .replace(/^#.*\n/gim, '') // remove non escaped whitespace
  .replace(/([^\\])\s+/gim, '$1') // remove whitespace at the beginning of a line
  .replace(/^\s+/, '').trim();
}

function processRegexPattern(s) {
  if (s && s.startsWith('^')) {
    // regex for startsWith
    return '^' + literalizeRegexPart(s.slice(1));
  } else if (s && s.endsWith('$')) {
    // regex for endsWith
    return literalizeRegexPart(s.slice(0, s.length - 1)) + '$';
  } // regex for contains


  return literalizeRegexPart(s);
}

function isStartsWithRegex(value) {
  if (!value || typeof value !== 'string' || !value.startsWith('^')) {
    return false;
  }

  const matches = value.match(/\^\\Q.*\\E/);
  return !!matches;
}

function isAllValuesRegexOrNone(values) {
  if (!values || !Array.isArray(values) || values.length === 0) {
    return true;
  }

  const firstValuesIsRegex = isStartsWithRegex(values[0].$regex);

  if (values.length === 1) {
    return firstValuesIsRegex;
  }

  for (let i = 1, length = values.length; i < length; ++i) {
    if (firstValuesIsRegex !== isStartsWithRegex(values[i].$regex)) {
      return false;
    }
  }

  return true;
}

function isAnyValueRegexStartsWith(values) {
  return values.some(function (value) {
    return isStartsWithRegex(value.$regex);
  });
}

function createLiteralRegex(remaining) {
  return remaining.split('').map(c => {
    if (c.match(/[0-9a-zA-Z]/) !== null) {
      // don't escape alphanumeric characters
      return c;
    } // escape everything else (single quotes with single quotes, everything else with a backslash)


    return c === `'` ? `''` : `\\${c}`;
  }).join('');
}

function literalizeRegexPart(s) {
  const matcher1 = /\\Q((?!\\E).*)\\E$/;
  const result1 = s.match(matcher1);

  if (result1 && result1.length > 1 && result1.index > -1) {
    // process regex that has a beginning and an end specified for the literal text
    const prefix = s.substr(0, result1.index);
    const remaining = result1[1];
    return literalizeRegexPart(prefix) + createLiteralRegex(remaining);
  } // process regex that has a beginning specified for the literal text


  const matcher2 = /\\Q((?!\\E).*)$/;
  const result2 = s.match(matcher2);

  if (result2 && result2.length > 1 && result2.index > -1) {
    const prefix = s.substr(0, result2.index);
    const remaining = result2[1];
    return literalizeRegexPart(prefix) + createLiteralRegex(remaining);
  } // remove all instances of \Q and \E from the remaining text & escape single quotes


  return s.replace(/([^\\])(\\E)/, '$1').replace(/([^\\])(\\Q)/, '$1').replace(/^\\E/, '').replace(/^\\Q/, '').replace(/([^'])'/, `$1''`).replace(/^'([^'])/, `''$1`);
}

var GeoPointCoder = {
  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'GeoPoint';
  }

};
var _default = PostgresStorageAdapter;
exports.default = _default;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9BZGFwdGVycy9TdG9yYWdlL1Bvc3RncmVzL1Bvc3RncmVzU3RvcmFnZUFkYXB0ZXIuanMiXSwibmFtZXMiOlsiUG9zdGdyZXNSZWxhdGlvbkRvZXNOb3RFeGlzdEVycm9yIiwiUG9zdGdyZXNEdXBsaWNhdGVSZWxhdGlvbkVycm9yIiwiUG9zdGdyZXNEdXBsaWNhdGVDb2x1bW5FcnJvciIsIlBvc3RncmVzTWlzc2luZ0NvbHVtbkVycm9yIiwiUG9zdGdyZXNEdXBsaWNhdGVPYmplY3RFcnJvciIsIlBvc3RncmVzVW5pcXVlSW5kZXhWaW9sYXRpb25FcnJvciIsIlBvc3RncmVzVHJhbnNhY3Rpb25BYm9ydGVkRXJyb3IiLCJsb2dnZXIiLCJyZXF1aXJlIiwiZGVidWciLCJhcmdzIiwiYXJndW1lbnRzIiwiY29uY2F0Iiwic2xpY2UiLCJsZW5ndGgiLCJsb2ciLCJnZXRMb2dnZXIiLCJhcHBseSIsInBhcnNlVHlwZVRvUG9zdGdyZXNUeXBlIiwidHlwZSIsImNvbnRlbnRzIiwiSlNPTiIsInN0cmluZ2lmeSIsIlBhcnNlVG9Qb3NncmVzQ29tcGFyYXRvciIsIiRndCIsIiRsdCIsIiRndGUiLCIkbHRlIiwibW9uZ29BZ2dyZWdhdGVUb1Bvc3RncmVzIiwiJGRheU9mTW9udGgiLCIkZGF5T2ZXZWVrIiwiJGRheU9mWWVhciIsIiRpc29EYXlPZldlZWsiLCIkaXNvV2Vla1llYXIiLCIkaG91ciIsIiRtaW51dGUiLCIkc2Vjb25kIiwiJG1pbGxpc2Vjb25kIiwiJG1vbnRoIiwiJHdlZWsiLCIkeWVhciIsInRvUG9zdGdyZXNWYWx1ZSIsInZhbHVlIiwiX190eXBlIiwiaXNvIiwibmFtZSIsInRyYW5zZm9ybVZhbHVlIiwib2JqZWN0SWQiLCJlbXB0eUNMUFMiLCJPYmplY3QiLCJmcmVlemUiLCJmaW5kIiwiZ2V0IiwiY3JlYXRlIiwidXBkYXRlIiwiZGVsZXRlIiwiYWRkRmllbGQiLCJkZWZhdWx0Q0xQUyIsInRvUGFyc2VTY2hlbWEiLCJzY2hlbWEiLCJjbGFzc05hbWUiLCJmaWVsZHMiLCJfaGFzaGVkX3Bhc3N3b3JkIiwiX3dwZXJtIiwiX3JwZXJtIiwiY2xwcyIsImNsYXNzTGV2ZWxQZXJtaXNzaW9ucyIsImluZGV4ZXMiLCJ0b1Bvc3RncmVzU2NoZW1hIiwiX3Bhc3N3b3JkX2hpc3RvcnkiLCJoYW5kbGVEb3RGaWVsZHMiLCJvYmplY3QiLCJrZXlzIiwiZm9yRWFjaCIsImZpZWxkTmFtZSIsImluZGV4T2YiLCJjb21wb25lbnRzIiwic3BsaXQiLCJmaXJzdCIsInNoaWZ0IiwiY3VycmVudE9iaiIsIm5leHQiLCJfX29wIiwidW5kZWZpbmVkIiwidHJhbnNmb3JtRG90RmllbGRUb0NvbXBvbmVudHMiLCJtYXAiLCJjbXB0IiwiaW5kZXgiLCJ0cmFuc2Zvcm1Eb3RGaWVsZCIsImpvaW4iLCJ0cmFuc2Zvcm1BZ2dyZWdhdGVGaWVsZCIsInN1YnN0ciIsInZhbGlkYXRlS2V5cyIsImtleSIsImluY2x1ZGVzIiwiUGFyc2UiLCJFcnJvciIsIklOVkFMSURfTkVTVEVEX0tFWSIsImpvaW5UYWJsZXNGb3JTY2hlbWEiLCJsaXN0IiwiZmllbGQiLCJwdXNoIiwiYnVpbGRXaGVyZUNsYXVzZSIsInF1ZXJ5IiwicGF0dGVybnMiLCJ2YWx1ZXMiLCJzb3J0cyIsImlzQXJyYXlGaWVsZCIsImluaXRpYWxQYXR0ZXJuc0xlbmd0aCIsImZpZWxkVmFsdWUiLCIkZXhpc3RzIiwiJGluIiwiaW5QYXR0ZXJucyIsImxpc3RFbGVtIiwiJHJlZ2V4IiwiTUFYX0lOVF9QTFVTX09ORSIsImNsYXVzZXMiLCJjbGF1c2VWYWx1ZXMiLCJzdWJRdWVyeSIsImNsYXVzZSIsInBhdHRlcm4iLCJvck9yQW5kIiwibm90IiwiJG5lIiwiJGVxIiwiaXNJbk9yTmluIiwiQXJyYXkiLCJpc0FycmF5IiwiJG5pbiIsImFsbG93TnVsbCIsImxpc3RJbmRleCIsImNyZWF0ZUNvbnN0cmFpbnQiLCJiYXNlQXJyYXkiLCJub3RJbiIsIl8iLCJmbGF0TWFwIiwiZWx0IiwiSU5WQUxJRF9KU09OIiwiJGFsbCIsImlzQW55VmFsdWVSZWdleFN0YXJ0c1dpdGgiLCJpc0FsbFZhbHVlc1JlZ2V4T3JOb25lIiwiaSIsInByb2Nlc3NSZWdleFBhdHRlcm4iLCJzdWJzdHJpbmciLCIkY29udGFpbmVkQnkiLCJhcnIiLCIkdGV4dCIsInNlYXJjaCIsIiRzZWFyY2giLCJsYW5ndWFnZSIsIiR0ZXJtIiwiJGxhbmd1YWdlIiwiJGNhc2VTZW5zaXRpdmUiLCIkZGlhY3JpdGljU2Vuc2l0aXZlIiwiJG5lYXJTcGhlcmUiLCJwb2ludCIsImRpc3RhbmNlIiwiJG1heERpc3RhbmNlIiwiZGlzdGFuY2VJbktNIiwibG9uZ2l0dWRlIiwibGF0aXR1ZGUiLCIkd2l0aGluIiwiJGJveCIsImJveCIsImxlZnQiLCJib3R0b20iLCJyaWdodCIsInRvcCIsIiRnZW9XaXRoaW4iLCIkY2VudGVyU3BoZXJlIiwiY2VudGVyU3BoZXJlIiwiR2VvUG9pbnQiLCJHZW9Qb2ludENvZGVyIiwiaXNWYWxpZEpTT04iLCJfdmFsaWRhdGUiLCJpc05hTiIsIiRwb2x5Z29uIiwicG9seWdvbiIsInBvaW50cyIsImNvb3JkaW5hdGVzIiwiJGdlb0ludGVyc2VjdHMiLCIkcG9pbnQiLCJyZWdleCIsIm9wZXJhdG9yIiwib3B0cyIsIiRvcHRpb25zIiwicmVtb3ZlV2hpdGVTcGFjZSIsImNvbnZlcnRQb2x5Z29uVG9TUUwiLCJjbXAiLCJwZ0NvbXBhcmF0b3IiLCJPUEVSQVRJT05fRk9SQklEREVOIiwiUG9zdGdyZXNTdG9yYWdlQWRhcHRlciIsImNvbnN0cnVjdG9yIiwidXJpIiwiY29sbGVjdGlvblByZWZpeCIsImRhdGFiYXNlT3B0aW9ucyIsIl9jb2xsZWN0aW9uUHJlZml4IiwiY2xpZW50IiwicGdwIiwiX2NsaWVudCIsIl9wZ3AiLCJjYW5Tb3J0T25Kb2luVGFibGVzIiwiaGFuZGxlU2h1dGRvd24iLCIkcG9vbCIsImVuZCIsIl9lbnN1cmVTY2hlbWFDb2xsZWN0aW9uRXhpc3RzIiwiY29ubiIsIm5vbmUiLCJjYXRjaCIsImVycm9yIiwiY29kZSIsImNsYXNzRXhpc3RzIiwib25lIiwiYSIsImV4aXN0cyIsInNldENsYXNzTGV2ZWxQZXJtaXNzaW9ucyIsIkNMUHMiLCJzZWxmIiwidGFzayIsInQiLCJzZXRJbmRleGVzV2l0aFNjaGVtYUZvcm1hdCIsInN1Ym1pdHRlZEluZGV4ZXMiLCJleGlzdGluZ0luZGV4ZXMiLCJQcm9taXNlIiwicmVzb2x2ZSIsIl9pZF8iLCJfaWQiLCJkZWxldGVkSW5kZXhlcyIsImluc2VydGVkSW5kZXhlcyIsIklOVkFMSURfUVVFUlkiLCJoYXNPd25Qcm9wZXJ0eSIsInR4IiwiY3JlYXRlSW5kZXhlcyIsImRyb3BJbmRleGVzIiwiY3JlYXRlQ2xhc3MiLCJxMSIsImNyZWF0ZVRhYmxlIiwicTIiLCJxMyIsImJhdGNoIiwidGhlbiIsImVyciIsImRhdGEiLCJyZXN1bHQiLCJkZXRhaWwiLCJEVVBMSUNBVEVfVkFMVUUiLCJ2YWx1ZXNBcnJheSIsInBhdHRlcm5zQXJyYXkiLCJhc3NpZ24iLCJfZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQiLCJfZW1haWxfdmVyaWZ5X3Rva2VuIiwiX2FjY291bnRfbG9ja291dF9leHBpcmVzX2F0IiwiX2ZhaWxlZF9sb2dpbl9jb3VudCIsIl9wZXJpc2hhYmxlX3Rva2VuIiwiX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdCIsIl9wYXNzd29yZF9jaGFuZ2VkX2F0IiwicmVsYXRpb25zIiwicGFyc2VUeXBlIiwicXMiLCJqb2luVGFibGUiLCJzY2hlbWFVcGdyYWRlIiwiY29sdW1ucyIsImNvbHVtbl9uYW1lIiwibmV3Q29sdW1ucyIsImZpbHRlciIsIml0ZW0iLCJhZGRGaWVsZElmTm90RXhpc3RzIiwicG9zdGdyZXNUeXBlIiwiYW55IiwicGF0aCIsImRlbGV0ZUNsYXNzIiwib3BlcmF0aW9ucyIsImhlbHBlcnMiLCJkZWxldGVBbGxDbGFzc2VzIiwibm93IiwiRGF0ZSIsImdldFRpbWUiLCJyZXN1bHRzIiwiam9pbnMiLCJyZWR1Y2UiLCJjbGFzc2VzIiwicXVlcmllcyIsImRlbGV0ZUZpZWxkcyIsImZpZWxkTmFtZXMiLCJpZHgiLCJnZXRBbGxDbGFzc2VzIiwicm93IiwiZ2V0Q2xhc3MiLCJjcmVhdGVPYmplY3QiLCJjb2x1bW5zQXJyYXkiLCJnZW9Qb2ludHMiLCJhdXRoRGF0YU1hdGNoIiwibWF0Y2giLCJwcm92aWRlciIsInBvcCIsImluaXRpYWxWYWx1ZXMiLCJ2YWwiLCJ0ZXJtaW5hdGlvbiIsImdlb1BvaW50c0luamVjdHMiLCJsIiwiY29sdW1uc1BhdHRlcm4iLCJjb2wiLCJ2YWx1ZXNQYXR0ZXJuIiwib3BzIiwidW5kZXJseWluZ0Vycm9yIiwiY29uc3RyYWludCIsIm1hdGNoZXMiLCJ1c2VySW5mbyIsImR1cGxpY2F0ZWRfZmllbGQiLCJkZWxldGVPYmplY3RzQnlRdWVyeSIsIndoZXJlIiwiY291bnQiLCJPQkpFQ1RfTk9UX0ZPVU5EIiwiZmluZE9uZUFuZFVwZGF0ZSIsInVwZGF0ZU9iamVjdHNCeVF1ZXJ5IiwidXBkYXRlUGF0dGVybnMiLCJvcmlnaW5hbFVwZGF0ZSIsImdlbmVyYXRlIiwianNvbmIiLCJsYXN0S2V5IiwiZmllbGROYW1lSW5kZXgiLCJzdHIiLCJhbW91bnQiLCJvYmplY3RzIiwia2V5c1RvSW5jcmVtZW50IiwiayIsImluY3JlbWVudFBhdHRlcm5zIiwiYyIsImtleXNUb0RlbGV0ZSIsImRlbGV0ZVBhdHRlcm5zIiwicCIsImV4cGVjdGVkVHlwZSIsInJlamVjdCIsIndoZXJlQ2xhdXNlIiwidXBzZXJ0T25lT2JqZWN0IiwiY3JlYXRlVmFsdWUiLCJza2lwIiwibGltaXQiLCJzb3J0IiwiaGFzTGltaXQiLCJoYXNTa2lwIiwid2hlcmVQYXR0ZXJuIiwibGltaXRQYXR0ZXJuIiwic2tpcFBhdHRlcm4iLCJzb3J0UGF0dGVybiIsInNvcnRDb3B5Iiwic29ydGluZyIsInRyYW5zZm9ybUtleSIsIm1lbW8iLCJwb3N0Z3Jlc09iamVjdFRvUGFyc2VPYmplY3QiLCJ0YXJnZXRDbGFzcyIsInkiLCJ4IiwiY29vcmRzIiwicGFyc2VGbG9hdCIsImNyZWF0ZWRBdCIsInRvSVNPU3RyaW5nIiwidXBkYXRlZEF0IiwiZXhwaXJlc0F0IiwiZW5zdXJlVW5pcXVlbmVzcyIsImNvbnN0cmFpbnROYW1lIiwiY29uc3RyYWludFBhdHRlcm5zIiwibWVzc2FnZSIsImRpc3RpbmN0IiwiY29sdW1uIiwiaXNOZXN0ZWQiLCJpc1BvaW50ZXJGaWVsZCIsInRyYW5zZm9ybWVyIiwiY2hpbGQiLCJhZ2dyZWdhdGUiLCJwaXBlbGluZSIsImNvdW50RmllbGQiLCJncm91cFZhbHVlcyIsImdyb3VwUGF0dGVybiIsInN0YWdlIiwiJGdyb3VwIiwiZ3JvdXBCeUZpZWxkcyIsImFsaWFzIiwib3BlcmF0aW9uIiwic291cmNlIiwiJHN1bSIsIiRtYXgiLCIkbWluIiwiJGF2ZyIsIiRwcm9qZWN0IiwiJG1hdGNoIiwiJG9yIiwiY29sbGFwc2UiLCJlbGVtZW50IiwibWF0Y2hQYXR0ZXJucyIsIiRsaW1pdCIsIiRza2lwIiwiJHNvcnQiLCJvcmRlciIsInBhcnNlSW50IiwicGVyZm9ybUluaXRpYWxpemF0aW9uIiwiVm9sYXRpbGVDbGFzc2VzU2NoZW1hcyIsInByb21pc2VzIiwiSU5WQUxJRF9DTEFTU19OQU1FIiwiYWxsIiwic3FsIiwibWlzYyIsImpzb25PYmplY3RTZXRLZXlzIiwiYXJyYXkiLCJhZGQiLCJhZGRVbmlxdWUiLCJyZW1vdmUiLCJjb250YWluc0FsbCIsImNvbnRhaW5zQWxsUmVnZXgiLCJjb250YWlucyIsImR1cmF0aW9uIiwiY29uc29sZSIsImNyZWF0ZUluZGV4ZXNJZk5lZWRlZCIsImdldEluZGV4ZXMiLCJ1cGRhdGVTY2hlbWFXaXRoSW5kZXhlcyIsInVuaXF1ZSIsImFyIiwiZm91bmRJbmRleCIsInB0IiwiSU5URVJOQUxfU0VSVkVSX0VSUk9SIiwiZW5kc1dpdGgiLCJyZXBsYWNlIiwidHJpbSIsInMiLCJzdGFydHNXaXRoIiwibGl0ZXJhbGl6ZVJlZ2V4UGFydCIsImlzU3RhcnRzV2l0aFJlZ2V4IiwiZmlyc3RWYWx1ZXNJc1JlZ2V4Iiwic29tZSIsImNyZWF0ZUxpdGVyYWxSZWdleCIsInJlbWFpbmluZyIsIm1hdGNoZXIxIiwicmVzdWx0MSIsInByZWZpeCIsIm1hdGNoZXIyIiwicmVzdWx0MiJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUNBOztBQUVBOztBQUVBOztBQUNBOztBQWlCQTs7Ozs7Ozs7QUFmQSxNQUFNQSxpQ0FBaUMsR0FBRyxPQUExQztBQUNBLE1BQU1DLDhCQUE4QixHQUFHLE9BQXZDO0FBQ0EsTUFBTUMsNEJBQTRCLEdBQUcsT0FBckM7QUFDQSxNQUFNQywwQkFBMEIsR0FBRyxPQUFuQztBQUNBLE1BQU1DLDRCQUE0QixHQUFHLE9BQXJDO0FBQ0EsTUFBTUMsaUNBQWlDLEdBQUcsT0FBMUM7QUFDQSxNQUFNQywrQkFBK0IsR0FBRyxPQUF4Qzs7QUFDQSxNQUFNQyxNQUFNLEdBQUdDLE9BQU8sQ0FBQyxpQkFBRCxDQUF0Qjs7QUFFQSxNQUFNQyxLQUFLLEdBQUcsVUFBUyxHQUFHQyxJQUFaLEVBQXVCO0FBQ25DQSxFQUFBQSxJQUFJLEdBQUcsQ0FBQyxTQUFTQyxTQUFTLENBQUMsQ0FBRCxDQUFuQixFQUF3QkMsTUFBeEIsQ0FBK0JGLElBQUksQ0FBQ0csS0FBTCxDQUFXLENBQVgsRUFBY0gsSUFBSSxDQUFDSSxNQUFuQixDQUEvQixDQUFQO0FBQ0EsUUFBTUMsR0FBRyxHQUFHUixNQUFNLENBQUNTLFNBQVAsRUFBWjtBQUNBRCxFQUFBQSxHQUFHLENBQUNOLEtBQUosQ0FBVVEsS0FBVixDQUFnQkYsR0FBaEIsRUFBcUJMLElBQXJCO0FBQ0QsQ0FKRDs7QUFTQSxNQUFNUSx1QkFBdUIsR0FBR0MsSUFBSSxJQUFJO0FBQ3RDLFVBQVFBLElBQUksQ0FBQ0EsSUFBYjtBQUNFLFNBQUssUUFBTDtBQUNFLGFBQU8sTUFBUDs7QUFDRixTQUFLLE1BQUw7QUFDRSxhQUFPLDBCQUFQOztBQUNGLFNBQUssUUFBTDtBQUNFLGFBQU8sT0FBUDs7QUFDRixTQUFLLE1BQUw7QUFDRSxhQUFPLE1BQVA7O0FBQ0Ys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SlosRUFLSkEsT0FMSSxDQUtJLFNBTEosRUFLZ0IsTUFMaEIsRUFNSkEsT0FOSSxDQU1JLFVBTkosRUFNaUIsTUFOakIsQ0FBUDtBQU9EOztBQUVELElBQUl6UCxhQUFhLEdBQUc7QUFDbEJDLEVBQUFBLFdBQVcsQ0FBQ25JLEtBQUQsRUFBUTtBQUNqQixXQUNFLE9BQU9BLEtBQVAsS0FBaUIsUUFBakIsSUFBNkJBLEtBQUssS0FBSyxJQUF2QyxJQUErQ0EsS0FBSyxDQUFDQyxNQUFOLEtBQWlCLFVBRGxFO0FBR0Q7O0FBTGlCLENBQXBCO2VBUWVvSixzQiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEBmbG93XG5pbXBvcnQgeyBjcmVhdGVDbGllbnQgfSBmcm9tICcuL1Bvc3RncmVzQ2xpZW50Jztcbi8vIEBmbG93LWRpc2FibGUtbmV4dFxuaW1wb3J0IFBhcnNlIGZyb20gJ3BhcnNlL25vZGUnO1xuLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG5pbXBvcnQgXyBmcm9tICdsb2Rhc2gnO1xuaW1wb3J0IHNxbCBmcm9tICcuL3NxbCc7XG5cbmNvbnN0IFBvc3RncmVzUmVsYXRpb25Eb2VzTm90RXhpc3RFcnJvciA9ICc0MlAwMSc7XG5jb25zdCBQb3N0Z3Jlc0R1cGxpY2F0ZVJlbGF0aW9uRXJyb3IgPSAnNDJQMDcnO1xuY29uc3QgUG9zdGdyZXNEdXBsaWNhdGVDb2x1bW5FcnJvciA9ICc0MjcwMSc7XG5jb25zdCBQb3N0Z3Jlc01pc3NpbmdDb2x1bW5FcnJvciA9ICc0MjcwMyc7XG5jb25zdCBQb3N0Z3Jlc0R1cGxpY2F0ZU9iamVjdEVycm9yID0gJzQyNzEwJztcbmNvbnN0IFBvc3RncmVzVW5pcXVlSW5kZXhWaW9sYXRpb25FcnJvciA9ICcyMzUwNSc7XG5jb25zdCBQb3N0Z3Jlc1RyYW5zYWN0aW9uQWJvcnRlZEVycm9yID0gJzI1UDAyJztcbmNvbnN0IGxvZ2dlciA9IHJlcXVpcmUoJy4uLy4uLy4uL2xvZ2dlcicpO1xuXG5jb25zdCBkZWJ1ZyA9IGZ1bmN0aW9uKC4uLmFyZ3M6IGFueSkge1xuICBhcmdzID0gWydQRzogJyArIGFyZ3VtZW50c1swXV0uY29uY2F0KGFyZ3Muc2xpY2UoMSwgYXJncy5sZW5ndGgpKTtcbiAgY29uc3QgbG9nID0gbG9nZ2VyLmdldExvZ2dlcigpO1xuICBsb2cuZGVidWcuYXBwbHkobG9nLCBhcmdzKTtcbn07XG5cbmltcG9ydCB7IFN0b3JhZ2VBZGFwdGVyIH0gZnJvbSAnLi4vU3RvcmFnZUFkYXB0ZXInO1xuaW1wb3J0IHR5cGUgeyBTY2hlbWFUeXBlLCBRdWVyeVR5cGUsIFF1ZXJ5T3B0aW9ucyB9IGZyb20gJy4uL1N0b3JhZ2VBZGFwdGVyJztcblxuY29uc3QgcGFyc2VUeXBlVG9Qb3N0Z3Jlc1R5cGUgPSB0eXBlID0+IHtcbiAgc3dpdGNoICh0eXBlLnR5cGUpIHtcbiAgICBjYXNlICdTdHJpbmcnOlxuICAgICAgcmV0dXJuICd0ZXh0JztcbiAgICBjYXNlICdEYXRlJzpcbiAgICAgIHJldHVybiAndGltZXN0YW1wIHdpdGggdGltZSB6b25lJztcbiAgICBjYXNlICdPYmplY3QnOlxuICAgICAgcmV0dXJuICdqc29uYic7XG4gICAgY2FzZSAnRmlsZSc6XG4gICAgICByZXR1cm4gJ3RleHQnO1xuICAgIGNhc2UgJ0Jvb2xlYW4nOlxuICAgICAgcmV0dXJuICdib29sZWFuJztcbiAgICBjYXNlICdQb2ludGVyJzpcbiAgICAgIHJldHVybiAnY2hhcigxMCknO1xuICAgIGNhc2UgJ051bWJlcic6XG4gICAgICByZXR1cm4gJ2RvdWJsZSBwcmVjaXNpb24nO1xuICAgIGNhc2UgJ0dlb1BvaW50JzpcbiAgICAgIHJldHVybiAncG9pbnQnO1xuICAgIGNhc2UgJ0J5dGVzJzpcbiAgICAgIHJldHVybiAnanNvbmInO1xuICAgIGNhc2UgJ1BvbHlnb24nOlxuICAgICAgcmV0dXJuICdwb2x5Z29uJztcbiAgICBjYXNlICdBcnJheSc6XG4gICAgICBpZiAodHlwZS5jb250ZW50cyAmJiB0eXBlLmNvbnRlbnRzLnR5cGUgPT09ICdTdHJpbmcnKSB7XG4gICAgICAgIHJldHVybiAndGV4dFtdJztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiAnanNvbmInO1xuICAgICAgfVxuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyBgbm8gdHlwZSBmb3IgJHtKU09OLnN0cmluZ2lmeSh0eXBlKX0geWV0YDtcbiAgfVxufTtcblxuY29uc3QgUGFyc2VUb1Bvc2dyZXNDb21wYXJhdG9yID0ge1xuICAkZ3Q6ICc+JyxcbiAgJGx0OiAnPCcsXG4gICRndGU6ICc+PScsXG4gICRsdGU6ICc8PScsXG59O1xuXG5jb25zdCBtb25nb0FnZ3JlZ2F0ZVRvUG9zdGdyZXMgPSB7XG4gICRkYXlPZk1vbnRoOiAnREFZJyxcbiAgJGRheU9mV2VlazogJ0RPVycsXG4gICRkYXlPZlllYXI6ICdET1knLFxuICAkaXNvRGF5T2ZXZWVrOiAnSVNPRE9XJyxcbiAgJGlzb1dlZWtZZWFyOiAnSVNPWUVBUicsXG4gICRob3VyOiAnSE9VUicsXG4gICRtaW51dGU6ICdNSU5VVEUnLFxuICAkc2Vjb25kOiAnU0VDT05EJyxcbiAgJG1pbGxpc2Vjb25kOiAnTUlMTElTRUNPTkRTJyxcbiAgJG1vbnRoOiAnTU9OVEgnLFxuICAkd2VlazogJ1dFRUsnLFxuICAkeWVhcjogJ1lFQVInLFxufTtcblxuY29uc3QgdG9Qb3N0Z3Jlc1ZhbHVlID0gdmFsdWUgPT4ge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSAnb2JqZWN0Jykge1xuICAgIGlmICh2YWx1ZS5fX3R5cGUgPT09ICdEYXRlJykge1xuICAgICAgcmV0dXJuIHZhbHVlLmlzbztcbiAgICB9XG4gICAgaWYgKHZhbHVlLl9fdHlwZSA9PT0gJ0ZpbGUnKSB7XG4gICAgICByZXR1cm4gdmFsdWUubmFtZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHZhbHVlO1xufTtcblxuY29uc3QgdHJhbnNmb3JtVmFsdWUgPSB2YWx1ZSA9PiB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlLl9fdHlwZSA9PT0gJ1BvaW50ZXInKSB7XG4gICAgcmV0dXJuIHZhbHVlLm9iamVjdElkO1xuICB9XG4gIHJldHVybiB2YWx1ZTtcbn07XG5cbi8vIER1cGxpY2F0ZSBmcm9tIHRoZW4gbW9uZ28gYWRhcHRlci4uLlxuY29uc3QgZW1wdHlDTFBTID0gT2JqZWN0LmZyZWV6ZSh7XG4gIGZpbmQ6IHt9LFxuICBnZXQ6IHt9LFxuICBjcmVhdGU6IHt9LFxuICB1cGRhdGU6IHt9LFxuICBkZWxldGU6IHt9LFxuICBhZGRGaWVsZDoge30sXG59KTtcblxuY29uc3QgZGVmYXVsdENMUFMgPSBPYmplY3QuZnJlZXplKHtcbiAgZmluZDogeyAnKic6IHRydWUgfSxcbiAgZ2V0OiB7ICcqJzogdHJ1ZSB9LFxuICBjcmVhdGU6IHsgJyonOiB0cnVlIH0sXG4gIHVwZGF0ZTogeyAnKic6IHRydWUgfSxcbiAgZGVsZXRlOiB7ICcqJzogdHJ1ZSB9LFxuICBhZGRGaWVsZDogeyAnKic6IHRydWUgfSxcbn0pO1xuXG5jb25zdCB0b1BhcnNlU2NoZW1hID0gc2NoZW1hID0+IHtcbiAgaWYgKHNjaGVtYS5jbGFzc05hbWUgPT09ICdfVXNlcicpIHtcbiAgICBkZWxldGUgc2NoZW1hLmZpZWxkcy5faGFzaGVkX3Bhc3N3b3JkO1xuICB9XG4gIGlmIChzY2hlbWEuZmllbGRzKSB7XG4gICAgZGVsZXRlIHNjaGVtYS5maWVsZHMuX3dwZXJtO1xuICAgIGRlbGV0ZSBzY2hlbWEuZmllbGRzLl9ycGVybTtcbiAgfVxuICBsZXQgY2xwcyA9IGRlZmF1bHRDTFBTO1xuICBpZiAoc2NoZW1hLmNsYXNzTGV2ZWxQZXJtaXNzaW9ucykge1xuICAgIGNscHMgPSB7IC4uLmVtcHR5Q0xQUywgLi4uc2NoZW1hLmNsYXNzTGV2ZWxQZXJtaXNzaW9ucyB9O1xuICB9XG4gIGxldCBpbmRleGVzID0ge307XG4gIGlmIChzY2hlbWEuaW5kZXhlcykge1xuICAgIGluZGV4ZXMgPSB7IC4uLnNjaGVtYS5pbmRleGVzIH07XG4gIH1cbiAgcmV0dXJuIHtcbiAgICBjbGFzc05hbWU6IHNjaGVtYS5jbGFzc05hbWUsXG4gICAgZmllbGRzOiBzY2hlbWEuZmllbGRzLFxuICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczogY2xwcyxcbiAgICBpbmRleGVzLFxuICB9O1xufTtcblxuY29uc3QgdG9Qb3N0Z3Jlc1NjaGVtYSA9IHNjaGVtYSA9PiB7XG4gIGlmICghc2NoZW1hKSB7XG4gICAgcmV0dXJuIHNjaGVtYTtcbiAgfVxuICBzY2hlbWEuZmllbGRzID0gc2NoZW1hLmZpZWxkcyB8fCB7fTtcbiAgc2NoZW1hLmZpZWxkcy5fd3Blcm0gPSB7IHR5cGU6ICdBcnJheScsIGNvbnRlbnRzOiB7IHR5cGU6ICdTdHJpbmcnIH0gfTtcbiAgc2NoZW1hLmZpZWxkcy5fcnBlcm0gPSB7IHR5cGU6ICdBcnJheScsIGNvbnRlbnRzOiB7IHR5cGU6ICdTdHJpbmcnIH0gfTtcbiAgaWYgKHNjaGVtYS5jbGFzc05hbWUgPT09ICdfVXNlcicpIHtcbiAgICBzY2hlbWEuZmllbGRzLl9oYXNoZWRfcGFzc3dvcmQgPSB7IHR5cGU6ICdTdHJpbmcnIH07XG4gICAgc2NoZW1hLmZpZWxkcy5fcGFzc3dvcmRfaGlzdG9yeSA9IHsgdHlwZTogJ0FycmF5JyB9O1xuICB9XG4gIHJldHVybiBzY2hlbWE7XG59O1xuXG5jb25zdCBoYW5kbGVEb3RGaWVsZHMgPSBvYmplY3QgPT4ge1xuICBPYmplY3Qua2V5cyhvYmplY3QpLmZvckVhY2goZmllbGROYW1lID0+IHtcbiAgICBpZiAoZmllbGROYW1lLmluZGV4T2YoJy4nKSA+IC0xKSB7XG4gICAgICBjb25zdCBjb21wb25lbnRzID0gZmllbGROYW1lLnNwbGl0KCcuJyk7XG4gICAgICBjb25zdCBmaXJzdCA9IGNvbXBvbmVudHMuc2hpZnQoKTtcbiAgICAgIG9iamVjdFtmaXJzdF0gPSBvYmplY3RbZmlyc3RdIHx8IHt9O1xuICAgICAgbGV0IGN1cnJlbnRPYmogPSBvYmplY3RbZmlyc3RdO1xuICAgICAgbGV0IG5leHQ7XG4gICAgICBsZXQgdmFsdWUgPSBvYmplY3RbZmllbGROYW1lXTtcbiAgICAgIGlmICh2YWx1ZSAmJiB2YWx1ZS5fX29wID09PSAnRGVsZXRlJykge1xuICAgICAgICB2YWx1ZSA9IHVuZGVmaW5lZDtcbiAgICAgIH1cbiAgICAgIC8qIGVzbGludC1kaXNhYmxlIG5vLWNvbmQtYXNzaWduICovXG4gICAgICB3aGlsZSAoKG5leHQgPSBjb21wb25lbnRzLnNoaWZ0KCkpKSB7XG4gICAgICAgIC8qIGVzbGludC1lbmFibGUgbm8tY29uZC1hc3NpZ24gKi9cbiAgICAgICAgY3VycmVudE9ialtuZXh0XSA9IGN1cnJlbnRPYmpbbmV4dF0gfHwge307XG4gICAgICAgIGlmIChjb21wb25lbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgIGN1cnJlbnRPYmpbbmV4dF0gPSB2YWx1ZTtcbiAgICAgICAgfVxuICAgICAgICBjdXJyZW50T2JqID0gY3VycmVudE9ialtuZXh0XTtcbiAgICAgIH1cbiAgICAgIGRlbGV0ZSBvYmplY3RbZmllbGROYW1lXTtcbiAgICB9XG4gIH0pO1xuICByZXR1cm4gb2JqZWN0O1xufTtcblxuY29uc3QgdHJhbnNmb3JtRG90RmllbGRUb0NvbXBvbmVudHMgPSBmaWVsZE5hbWUgPT4ge1xuICByZXR1cm4gZmllbGROYW1lLnNwbGl0KCcuJykubWFwKChjbXB0LCBpbmRleCkgPT4ge1xuICAgIGlmIChpbmRleCA9PT0gMCkge1xuICAgICAgcmV0dXJuIGBcIiR7Y21wdH1cImA7XG4gICAgfVxuICAgIHJldHVybiBgJyR7Y21wdH0nYDtcbiAgfSk7XG59O1xuXG5jb25zdCB0cmFuc2Zvcm1Eb3RGaWVsZCA9IGZpZWxkTmFtZSA9PiB7XG4gIGlmIChmaWVsZE5hbWUuaW5kZXhPZignLicpID09PSAtMSkge1xuICAgIHJldHVybiBgXCIke2ZpZWxkTmFtZX1cImA7XG4gIH1cbiAgY29uc3QgY29tcG9uZW50cyA9IHRyYW5zZm9ybURvdEZpZWxkVG9Db21wb25lbnRzKGZpZWxkTmFtZSk7XG4gIGxldCBuYW1lID0gY29tcG9uZW50cy5zbGljZSgwLCBjb21wb25lbnRzLmxlbmd0aCAtIDEpLmpvaW4oJy0+Jyk7XG4gIG5hbWUgKz0gJy0+PicgKyBjb21wb25lbnRzW2NvbXBvbmVudHMubGVuZ3RoIC0gMV07XG4gIHJldHVybiBuYW1lO1xufTtcblxuY29uc3QgdHJhbnNmb3JtQWdncmVnYXRlRmllbGQgPSBmaWVsZE5hbWUgPT4ge1xuICBpZiAodHlwZW9mIGZpZWxkTmFtZSAhPT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gZmllbGROYW1lO1xuICB9XG4gIGlmIChmaWVsZE5hbWUgPT09ICckX2NyZWF0ZWRfYXQnKSB7XG4gICAgcmV0dXJuICdjcmVhdGVkQXQnO1xuICB9XG4gIGlmIChmaWVsZE5hbWUgPT09ICckX3VwZGF0ZWRfYXQnKSB7XG4gICAgcmV0dXJuICd1cGRhdGVkQXQnO1xuICB9XG4gIHJldHVybiBmaWVsZE5hbWUuc3Vic3RyKDEpO1xufTtcblxuY29uc3QgdmFsaWRhdGVLZXlzID0gb2JqZWN0ID0+IHtcbiAgaWYgKHR5cGVvZiBvYmplY3QgPT0gJ29iamVjdCcpIHtcbiAgICBmb3IgKGNvbnN0IGtleSBpbiBvYmplY3QpIHtcbiAgICAgIGlmICh0eXBlb2Ygb2JqZWN0W2tleV0gPT0gJ29iamVjdCcpIHtcbiAgICAgICAgdmFsaWRhdGVLZXlzKG9iamVjdFtrZXldKTtcbiAgICAgIH1cblxuICAgICAgaWYgKGtleS5pbmNsdWRlcygnJCcpIHx8IGtleS5pbmNsdWRlcygnLicpKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX05FU1RFRF9LRVksXG4gICAgICAgICAgXCJOZXN0ZWQga2V5cyBzaG91bGQgbm90IGNvbnRhaW4gdGhlICckJyBvciAnLicgY2hhcmFjdGVyc1wiXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuICB9XG59O1xuXG4vLyBSZXR1cm5zIHRoZSBsaXN0IG9mIGpvaW4gdGFibGVzIG9uIGEgc2NoZW1hXG5jb25zdCBqb2luVGFibGVzRm9yU2NoZW1hID0gc2NoZW1hID0+IHtcbiAgY29uc3QgbGlzdCA9IFtdO1xuICBpZiAoc2NoZW1hKSB7XG4gICAgT2JqZWN0LmtleXMoc2NoZW1hLmZpZWxkcykuZm9yRWFjaChmaWVsZCA9PiB7XG4gICAgICBpZiAoc2NoZW1hLmZpZWxkc1tmaWVsZF0udHlwZSA9PT0gJ1JlbGF0aW9uJykge1xuICAgICAgICBsaXN0LnB1c2goYF9Kb2luOiR7ZmllbGR9OiR7c2NoZW1hLmNsYXNzTmFtZX1gKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuICByZXR1cm4gbGlzdDtcbn07XG5cbmNvbnN0IGJ1aWxkV2hlcmVDbGF1c2UgPSAoeyBzY2hlbWEsIHF1ZXJ5LCBpbmRleCB9KSA9PiB7XG4gIGNvbnN0IHBhdHRlcm5zID0gW107XG4gIGxldCB2YWx1ZXMgPSBbXTtcbiAgY29uc3Qgc29ydHMgPSBbXTtcblxuICBzY2hlbWEgPSB0b1Bvc3RncmVzU2NoZW1hKHNjaGVtYSk7XG4gIGZvciAoY29uc3QgZmllbGROYW1lIGluIHF1ZXJ5KSB7XG4gICAgY29uc3QgaXNBcnJheUZpZWxkID1cbiAgICAgIHNjaGVtYS5maWVsZHMgJiZcbiAgICAgIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXSAmJlxuICAgICAgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdBcnJheSc7XG4gICAgY29uc3QgaW5pdGlhbFBhdHRlcm5zTGVuZ3RoID0gcGF0dGVybnMubGVuZ3RoO1xuICAgIGNvbnN0IGZpZWxkVmFsdWUgPSBxdWVyeVtmaWVsZE5hbWVdO1xuXG4gICAgLy8gbm90aGluZ2luIHRoZSBzY2hlbWEsIGl0J3MgZ29ubmEgYmxvdyB1cFxuICAgIGlmICghc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdKSB7XG4gICAgICAvLyBhcyBpdCB3b24ndCBleGlzdFxuICAgICAgaWYgKGZpZWxkVmFsdWUgJiYgZmllbGRWYWx1ZS4kZXhpc3RzID09PSBmYWxzZSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZmllbGROYW1lLmluZGV4T2YoJy4nKSA+PSAwKSB7XG4gICAgICBsZXQgbmFtZSA9IHRyYW5zZm9ybURvdEZpZWxkKGZpZWxkTmFtZSk7XG4gICAgICBpZiAoZmllbGRWYWx1ZSA9PT0gbnVsbCkge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGAke25hbWV9IElTIE5VTExgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChmaWVsZFZhbHVlLiRpbikge1xuICAgICAgICAgIGNvbnN0IGluUGF0dGVybnMgPSBbXTtcbiAgICAgICAgICBuYW1lID0gdHJhbnNmb3JtRG90RmllbGRUb0NvbXBvbmVudHMoZmllbGROYW1lKS5qb2luKCctPicpO1xuICAgICAgICAgIGZpZWxkVmFsdWUuJGluLmZvckVhY2gobGlzdEVsZW0gPT4ge1xuICAgICAgICAgICAgaWYgKHR5cGVvZiBsaXN0RWxlbSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgaW5QYXR0ZXJucy5wdXNoKGBcIiR7bGlzdEVsZW19XCJgKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGluUGF0dGVybnMucHVzaChgJHtsaXN0RWxlbX1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgICBwYXR0ZXJucy5wdXNoKGAoJHtuYW1lfSk6Ompzb25iIEA+ICdbJHtpblBhdHRlcm5zLmpvaW4oKX1dJzo6anNvbmJgKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLiRyZWdleCkge1xuICAgICAgICAgIC8vIEhhbmRsZSBsYXRlclxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHBhdHRlcm5zLnB1c2goYCR7bmFtZX0gPSAnJHtmaWVsZFZhbHVlfSdgKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoZmllbGRWYWx1ZSA9PT0gbnVsbCB8fCBmaWVsZFZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lIElTIE5VTExgKTtcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICBpbmRleCArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZmllbGRWYWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlKTtcbiAgICAgIGluZGV4ICs9IDI7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZmllbGRWYWx1ZSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX1gKTtcbiAgICAgIC8vIENhbid0IGNhc3QgYm9vbGVhbiB0byBkb3VibGUgcHJlY2lzaW9uXG4gICAgICBpZiAoXG4gICAgICAgIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXSAmJlxuICAgICAgICBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ051bWJlcidcbiAgICAgICkge1xuICAgICAgICAvLyBTaG91bGQgYWx3YXlzIHJldHVybiB6ZXJvIHJlc3VsdHNcbiAgICAgICAgY29uc3QgTUFYX0lOVF9QTFVTX09ORSA9IDkyMjMzNzIwMzY4NTQ3NzU4MDg7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgTUFYX0lOVF9QTFVTX09ORSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUpO1xuICAgICAgfVxuICAgICAgaW5kZXggKz0gMjtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBmaWVsZFZhbHVlID09PSAnbnVtYmVyJykge1xuICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YCk7XG4gICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUpO1xuICAgICAgaW5kZXggKz0gMjtcbiAgICB9IGVsc2UgaWYgKFsnJG9yJywgJyRub3InLCAnJGFuZCddLmluY2x1ZGVzKGZpZWxkTmFtZSkpIHtcbiAgICAgIGNvbnN0IGNsYXVzZXMgPSBbXTtcbiAgICAgIGNvbnN0IGNsYXVzZVZhbHVlcyA9IFtdO1xuICAgICAgZmllbGRWYWx1ZS5mb3JFYWNoKHN1YlF1ZXJ5ID0+IHtcbiAgICAgICAgY29uc3QgY2xhdXNlID0gYnVpbGRXaGVyZUNsYXVzZSh7IHNjaGVtYSwgcXVlcnk6IHN1YlF1ZXJ5LCBpbmRleCB9KTtcbiAgICAgICAgaWYgKGNsYXVzZS5wYXR0ZXJuLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjbGF1c2VzLnB1c2goY2xhdXNlLnBhdHRlcm4pO1xuICAgICAgICAgIGNsYXVzZVZhbHVlcy5wdXNoKC4uLmNsYXVzZS52YWx1ZXMpO1xuICAgICAgICAgIGluZGV4ICs9IGNsYXVzZS52YWx1ZXMubGVuZ3RoO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3Qgb3JPckFuZCA9IGZpZWxkTmFtZSA9PT0gJyRhbmQnID8gJyBBTkQgJyA6ICcgT1IgJztcbiAgICAgIGNvbnN0IG5vdCA9IGZpZWxkTmFtZSA9PT0gJyRub3InID8gJyBOT1QgJyA6ICcnO1xuXG4gICAgICBwYXR0ZXJucy5wdXNoKGAke25vdH0oJHtjbGF1c2VzLmpvaW4ob3JPckFuZCl9KWApO1xuICAgICAgdmFsdWVzLnB1c2goLi4uY2xhdXNlVmFsdWVzKTtcbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZS4kbmUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKGlzQXJyYXlGaWVsZCkge1xuICAgICAgICBmaWVsZFZhbHVlLiRuZSA9IEpTT04uc3RyaW5naWZ5KFtmaWVsZFZhbHVlLiRuZV0pO1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGBOT1QgYXJyYXlfY29udGFpbnMoJCR7aW5kZXh9Om5hbWUsICQke2luZGV4ICsgMX0pYCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAoZmllbGRWYWx1ZS4kbmUgPT09IG51bGwpIHtcbiAgICAgICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSBJUyBOT1QgTlVMTGApO1xuICAgICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICAgICAgaW5kZXggKz0gMTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBpZiBub3QgbnVsbCwgd2UgbmVlZCB0byBtYW51YWxseSBleGNsdWRlIG51bGxcbiAgICAgICAgICBwYXR0ZXJucy5wdXNoKFxuICAgICAgICAgICAgYCgkJHtpbmRleH06bmFtZSA8PiAkJHtpbmRleCArIDF9IE9SICQke2luZGV4fTpuYW1lIElTIE5VTEwpYFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gVE9ETzogc3VwcG9ydCBhcnJheXNcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZS4kbmUpO1xuICAgICAgaW5kZXggKz0gMjtcbiAgICB9XG4gICAgaWYgKGZpZWxkVmFsdWUuJGVxICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChmaWVsZFZhbHVlLiRlcSA9PT0gbnVsbCkge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSBJUyBOVUxMYCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICAgIGluZGV4ICs9IDE7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX1gKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlLiRlcSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IGlzSW5Pck5pbiA9XG4gICAgICBBcnJheS5pc0FycmF5KGZpZWxkVmFsdWUuJGluKSB8fCBBcnJheS5pc0FycmF5KGZpZWxkVmFsdWUuJG5pbik7XG4gICAgaWYgKFxuICAgICAgQXJyYXkuaXNBcnJheShmaWVsZFZhbHVlLiRpbikgJiZcbiAgICAgIGlzQXJyYXlGaWVsZCAmJlxuICAgICAgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLmNvbnRlbnRzICYmXG4gICAgICBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0uY29udGVudHMudHlwZSA9PT0gJ1N0cmluZydcbiAgICApIHtcbiAgICAgIGNvbnN0IGluUGF0dGVybnMgPSBbXTtcbiAgICAgIGxldCBhbGxvd051bGwgPSBmYWxzZTtcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICBmaWVsZFZhbHVlLiRpbi5mb3JFYWNoKChsaXN0RWxlbSwgbGlzdEluZGV4KSA9PiB7XG4gICAgICAgIGlmIChsaXN0RWxlbSA9PT0gbnVsbCkge1xuICAgICAgICAgIGFsbG93TnVsbCA9IHRydWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdmFsdWVzLnB1c2gobGlzdEVsZW0pO1xuICAgICAgICAgIGluUGF0dGVybnMucHVzaChgJCR7aW5kZXggKyAxICsgbGlzdEluZGV4IC0gKGFsbG93TnVsbCA/IDEgOiAwKX1gKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBpZiAoYWxsb3dOdWxsKSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goXG4gICAgICAgICAgYCgkJHtpbmRleH06bmFtZSBJUyBOVUxMIE9SICQke2luZGV4fTpuYW1lICYmIEFSUkFZWyR7aW5QYXR0ZXJucy5qb2luKCl9XSlgXG4gICAgICAgICk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSAmJiBBUlJBWVske2luUGF0dGVybnMuam9pbigpfV1gKTtcbiAgICAgIH1cbiAgICAgIGluZGV4ID0gaW5kZXggKyAxICsgaW5QYXR0ZXJucy5sZW5ndGg7XG4gICAgfSBlbHNlIGlmIChpc0luT3JOaW4pIHtcbiAgICAgIHZhciBjcmVhdGVDb25zdHJhaW50ID0gKGJhc2VBcnJheSwgbm90SW4pID0+IHtcbiAgICAgICAgaWYgKGJhc2VBcnJheS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgY29uc3Qgbm90ID0gbm90SW4gPyAnIE5PVCAnIDogJyc7XG4gICAgICAgICAgaWYgKGlzQXJyYXlGaWVsZCkge1xuICAgICAgICAgICAgcGF0dGVybnMucHVzaChcbiAgICAgICAgICAgICAgYCR7bm90fSBhcnJheV9jb250YWlucygkJHtpbmRleH06bmFtZSwgJCR7aW5kZXggKyAxfSlgXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBKU09OLnN0cmluZ2lmeShiYXNlQXJyYXkpKTtcbiAgICAgICAgICAgIGluZGV4ICs9IDI7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIEhhbmRsZSBOZXN0ZWQgRG90IE5vdGF0aW9uIEFib3ZlXG4gICAgICAgICAgICBpZiAoZmllbGROYW1lLmluZGV4T2YoJy4nKSA+PSAwKSB7XG4gICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGluUGF0dGVybnMgPSBbXTtcbiAgICAgICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICAgICAgICBiYXNlQXJyYXkuZm9yRWFjaCgobGlzdEVsZW0sIGxpc3RJbmRleCkgPT4ge1xuICAgICAgICAgICAgICBpZiAobGlzdEVsZW0gIT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICB2YWx1ZXMucHVzaChsaXN0RWxlbSk7XG4gICAgICAgICAgICAgICAgaW5QYXR0ZXJucy5wdXNoKGAkJHtpbmRleCArIDEgKyBsaXN0SW5kZXh9YCk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgJHtub3R9IElOICgke2luUGF0dGVybnMuam9pbigpfSlgKTtcbiAgICAgICAgICAgIGluZGV4ID0gaW5kZXggKyAxICsgaW5QYXR0ZXJucy5sZW5ndGg7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKCFub3RJbikge1xuICAgICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgSVMgTlVMTGApO1xuICAgICAgICAgIGluZGV4ID0gaW5kZXggKyAxO1xuICAgICAgICB9XG4gICAgICB9O1xuICAgICAgaWYgKGZpZWxkVmFsdWUuJGluKSB7XG4gICAgICAgIGNyZWF0ZUNvbnN0cmFpbnQoXy5mbGF0TWFwKGZpZWxkVmFsdWUuJGluLCBlbHQgPT4gZWx0KSwgZmFsc2UpO1xuICAgICAgfVxuICAgICAgaWYgKGZpZWxkVmFsdWUuJG5pbikge1xuICAgICAgICBjcmVhdGVDb25zdHJhaW50KF8uZmxhdE1hcChmaWVsZFZhbHVlLiRuaW4sIGVsdCA9PiBlbHQpLCB0cnVlKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBmaWVsZFZhbHVlLiRpbiAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICdiYWQgJGluIHZhbHVlJyk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZmllbGRWYWx1ZS4kbmluICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ2JhZCAkbmluIHZhbHVlJyk7XG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoZmllbGRWYWx1ZS4kYWxsKSAmJiBpc0FycmF5RmllbGQpIHtcbiAgICAgIGlmIChpc0FueVZhbHVlUmVnZXhTdGFydHNXaXRoKGZpZWxkVmFsdWUuJGFsbCkpIHtcbiAgICAgICAgaWYgKCFpc0FsbFZhbHVlc1JlZ2V4T3JOb25lKGZpZWxkVmFsdWUuJGFsbCkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgICAnQWxsICRhbGwgdmFsdWVzIG11c3QgYmUgb2YgcmVnZXggdHlwZSBvciBub25lOiAnICsgZmllbGRWYWx1ZS4kYWxsXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZmllbGRWYWx1ZS4kYWxsLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgICAgY29uc3QgdmFsdWUgPSBwcm9jZXNzUmVnZXhQYXR0ZXJuKGZpZWxkVmFsdWUuJGFsbFtpXS4kcmVnZXgpO1xuICAgICAgICAgIGZpZWxkVmFsdWUuJGFsbFtpXSA9IHZhbHVlLnN1YnN0cmluZygxKSArICclJztcbiAgICAgICAgfVxuICAgICAgICBwYXR0ZXJucy5wdXNoKFxuICAgICAgICAgIGBhcnJheV9jb250YWluc19hbGxfcmVnZXgoJCR7aW5kZXh9Om5hbWUsICQke2luZGV4ICsgMX06Ompzb25iKWBcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goXG4gICAgICAgICAgYGFycmF5X2NvbnRhaW5zX2FsbCgkJHtpbmRleH06bmFtZSwgJCR7aW5kZXggKyAxfTo6anNvbmIpYFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBKU09OLnN0cmluZ2lmeShmaWVsZFZhbHVlLiRhbGwpKTtcbiAgICAgIGluZGV4ICs9IDI7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBmaWVsZFZhbHVlLiRleGlzdHMgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBpZiAoZmllbGRWYWx1ZS4kZXhpc3RzKSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lIElTIE5PVCBOVUxMYCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSBJUyBOVUxMYCk7XG4gICAgICB9XG4gICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUpO1xuICAgICAgaW5kZXggKz0gMTtcbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZS4kY29udGFpbmVkQnkpIHtcbiAgICAgIGNvbnN0IGFyciA9IGZpZWxkVmFsdWUuJGNvbnRhaW5lZEJ5O1xuICAgICAgaWYgKCEoYXJyIGluc3RhbmNlb2YgQXJyYXkpKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgYGJhZCAkY29udGFpbmVkQnk6IHNob3VsZCBiZSBhbiBhcnJheWBcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPEAgJCR7aW5kZXggKyAxfTo6anNvbmJgKTtcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgSlNPTi5zdHJpbmdpZnkoYXJyKSk7XG4gICAgICBpbmRleCArPSAyO1xuICAgIH1cblxuICAgIGlmIChmaWVsZFZhbHVlLiR0ZXh0KSB7XG4gICAgICBjb25zdCBzZWFyY2ggPSBmaWVsZFZhbHVlLiR0ZXh0LiRzZWFyY2g7XG4gICAgICBsZXQgbGFuZ3VhZ2UgPSAnZW5nbGlzaCc7XG4gICAgICBpZiAodHlwZW9mIHNlYXJjaCAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICBgYmFkICR0ZXh0OiAkc2VhcmNoLCBzaG91bGQgYmUgb2JqZWN0YFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgaWYgKCFzZWFyY2guJHRlcm0gfHwgdHlwZW9mIHNlYXJjaC4kdGVybSAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICBgYmFkICR0ZXh0OiAkdGVybSwgc2hvdWxkIGJlIHN0cmluZ2BcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIGlmIChzZWFyY2guJGxhbmd1YWdlICYmIHR5cGVvZiBzZWFyY2guJGxhbmd1YWdlICE9PSAnc3RyaW5nJykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgIGBiYWQgJHRleHQ6ICRsYW5ndWFnZSwgc2hvdWxkIGJlIHN0cmluZ2BcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSBpZiAoc2VhcmNoLiRsYW5ndWFnZSkge1xuICAgICAgICBsYW5ndWFnZSA9IHNlYXJjaC4kbGFuZ3VhZ2U7XG4gICAgICB9XG4gICAgICBpZiAoc2VhcmNoLiRjYXNlU2Vuc2l0aXZlICYmIHR5cGVvZiBzZWFyY2guJGNhc2VTZW5zaXRpdmUgIT09ICdib29sZWFuJykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgIGBiYWQgJHRleHQ6ICRjYXNlU2Vuc2l0aXZlLCBzaG91bGQgYmUgYm9vbGVhbmBcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSBpZiAoc2VhcmNoLiRjYXNlU2Vuc2l0aXZlKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgYGJhZCAkdGV4dDogJGNhc2VTZW5zaXRpdmUgbm90IHN1cHBvcnRlZCwgcGxlYXNlIHVzZSAkcmVnZXggb3IgY3JlYXRlIGEgc2VwYXJhdGUgbG93ZXIgY2FzZSBjb2x1bW4uYFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgaWYgKFxuICAgICAgICBzZWFyY2guJGRpYWNyaXRpY1NlbnNpdGl2ZSAmJlxuICAgICAgICB0eXBlb2Ygc2VhcmNoLiRkaWFjcml0aWNTZW5zaXRpdmUgIT09ICdib29sZWFuJ1xuICAgICAgKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgYGJhZCAkdGV4dDogJGRpYWNyaXRpY1NlbnNpdGl2ZSwgc2hvdWxkIGJlIGJvb2xlYW5gXG4gICAgICAgICk7XG4gICAgICB9IGVsc2UgaWYgKHNlYXJjaC4kZGlhY3JpdGljU2Vuc2l0aXZlID09PSBmYWxzZSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgIGBiYWQgJHRleHQ6ICRkaWFjcml0aWNTZW5zaXRpdmUgLSBmYWxzZSBub3Qgc3VwcG9ydGVkLCBpbnN0YWxsIFBvc3RncmVzIFVuYWNjZW50IEV4dGVuc2lvbmBcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHBhdHRlcm5zLnB1c2goXG4gICAgICAgIGB0b190c3ZlY3RvcigkJHtpbmRleH0sICQke2luZGV4ICsgMX06bmFtZSkgQEAgdG9fdHNxdWVyeSgkJHtpbmRleCArXG4gICAgICAgICAgMn0sICQke2luZGV4ICsgM30pYFxuICAgICAgKTtcbiAgICAgIHZhbHVlcy5wdXNoKGxhbmd1YWdlLCBmaWVsZE5hbWUsIGxhbmd1YWdlLCBzZWFyY2guJHRlcm0pO1xuICAgICAgaW5kZXggKz0gNDtcbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZS4kbmVhclNwaGVyZSkge1xuICAgICAgY29uc3QgcG9pbnQgPSBmaWVsZFZhbHVlLiRuZWFyU3BoZXJlO1xuICAgICAgY29uc3QgZGlzdGFuY2UgPSBmaWVsZFZhbHVlLiRtYXhEaXN0YW5jZTtcbiAgICAgIGNvbnN0IGRpc3RhbmNlSW5LTSA9IGRpc3RhbmNlICogNjM3MSAqIDEwMDA7XG4gICAgICBwYXR0ZXJucy5wdXNoKFxuICAgICAgICBgU1RfZGlzdGFuY2Vfc3BoZXJlKCQke2luZGV4fTpuYW1lOjpnZW9tZXRyeSwgUE9JTlQoJCR7aW5kZXggK1xuICAgICAgICAgIDF9LCAkJHtpbmRleCArIDJ9KTo6Z2VvbWV0cnkpIDw9ICQke2luZGV4ICsgM31gXG4gICAgICApO1xuICAgICAgc29ydHMucHVzaChcbiAgICAgICAgYFNUX2Rpc3RhbmNlX3NwaGVyZSgkJHtpbmRleH06bmFtZTo6Z2VvbWV0cnksIFBPSU5UKCQke2luZGV4ICtcbiAgICAgICAgICAxfSwgJCR7aW5kZXggKyAyfSk6Omdlb21ldHJ5KSBBU0NgXG4gICAgICApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBwb2ludC5sb25naXR1ZGUsIHBvaW50LmxhdGl0dWRlLCBkaXN0YW5jZUluS00pO1xuICAgICAgaW5kZXggKz0gNDtcbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZS4kd2l0aGluICYmIGZpZWxkVmFsdWUuJHdpdGhpbi4kYm94KSB7XG4gICAgICBjb25zdCBib3ggPSBmaWVsZFZhbHVlLiR3aXRoaW4uJGJveDtcbiAgICAgIGNvbnN0IGxlZnQgPSBib3hbMF0ubG9uZ2l0dWRlO1xuICAgICAgY29uc3QgYm90dG9tID0gYm94WzBdLmxhdGl0dWRlO1xuICAgICAgY29uc3QgcmlnaHQgPSBib3hbMV0ubG9uZ2l0dWRlO1xuICAgICAgY29uc3QgdG9wID0gYm94WzFdLmxhdGl0dWRlO1xuXG4gICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZTo6cG9pbnQgPEAgJCR7aW5kZXggKyAxfTo6Ym94YCk7XG4gICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGAoKCR7bGVmdH0sICR7Ym90dG9tfSksICgke3JpZ2h0fSwgJHt0b3B9KSlgKTtcbiAgICAgIGluZGV4ICs9IDI7XG4gICAgfVxuXG4gICAgaWYgKGZpZWxkVmFsdWUuJGdlb1dpdGhpbiAmJiBmaWVsZFZhbHVlLiRnZW9XaXRoaW4uJGNlbnRlclNwaGVyZSkge1xuICAgICAgY29uc3QgY2VudGVyU3BoZXJlID0gZmllbGRWYWx1ZS4kZ2VvV2l0aGluLiRjZW50ZXJTcGhlcmU7XG4gICAgICBpZiAoIShjZW50ZXJTcGhlcmUgaW5zdGFuY2VvZiBBcnJheSkgfHwgY2VudGVyU3BoZXJlLmxlbmd0aCA8IDIpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAnYmFkICRnZW9XaXRoaW4gdmFsdWU7ICRjZW50ZXJTcGhlcmUgc2hvdWxkIGJlIGFuIGFycmF5IG9mIFBhcnNlLkdlb1BvaW50IGFuZCBkaXN0YW5jZSdcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIC8vIEdldCBwb2ludCwgY29udmVydCB0byBnZW8gcG9pbnQgaWYgbmVjZXNzYXJ5IGFuZCB2YWxpZGF0ZVxuICAgICAgbGV0IHBvaW50ID0gY2VudGVyU3BoZXJlWzBdO1xuICAgICAgaWYgKHBvaW50IGluc3RhbmNlb2YgQXJyYXkgJiYgcG9pbnQubGVuZ3RoID09PSAyKSB7XG4gICAgICAgIHBvaW50ID0gbmV3IFBhcnNlLkdlb1BvaW50KHBvaW50WzFdLCBwb2ludFswXSk7XG4gICAgICB9IGVsc2UgaWYgKCFHZW9Qb2ludENvZGVyLmlzVmFsaWRKU09OKHBvaW50KSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICdiYWQgJGdlb1dpdGhpbiB2YWx1ZTsgJGNlbnRlclNwaGVyZSBnZW8gcG9pbnQgaW52YWxpZCdcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIFBhcnNlLkdlb1BvaW50Ll92YWxpZGF0ZShwb2ludC5sYXRpdHVkZSwgcG9pbnQubG9uZ2l0dWRlKTtcbiAgICAgIC8vIEdldCBkaXN0YW5jZSBhbmQgdmFsaWRhdGVcbiAgICAgIGNvbnN0IGRpc3RhbmNlID0gY2VudGVyU3BoZXJlWzFdO1xuICAgICAgaWYgKGlzTmFOKGRpc3RhbmNlKSB8fCBkaXN0YW5jZSA8IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAnYmFkICRnZW9XaXRoaW4gdmFsdWU7ICRjZW50ZXJTcGhlcmUgZGlzdGFuY2UgaW52YWxpZCdcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGRpc3RhbmNlSW5LTSA9IGRpc3RhbmNlICogNjM3MSAqIDEwMDA7XG4gICAgICBwYXR0ZXJucy5wdXNoKFxuICAgICAgICBgU1RfZGlzdGFuY2Vfc3BoZXJlKCQke2luZGV4fTpuYW1lOjpnZW9tZXRyeSwgUE9JTlQoJCR7aW5kZXggK1xuICAgICAgICAgIDF9LCAkJHtpbmRleCArIDJ9KTo6Z2VvbWV0cnkpIDw9ICQke2luZGV4ICsgM31gXG4gICAgICApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBwb2ludC5sb25naXR1ZGUsIHBvaW50LmxhdGl0dWRlLCBkaXN0YW5jZUluS00pO1xuICAgICAgaW5kZXggKz0gNDtcbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZS4kZ2VvV2l0aGluICYmIGZpZWxkVmFsdWUuJGdlb1dpdGhpbi4kcG9seWdvbikge1xuICAgICAgY29uc3QgcG9seWdvbiA9IGZpZWxkVmFsdWUuJGdlb1dpdGhpbi4kcG9seWdvbjtcbiAgICAgIGxldCBwb2ludHM7XG4gICAgICBpZiAodHlwZW9mIHBvbHlnb24gPT09ICdvYmplY3QnICYmIHBvbHlnb24uX190eXBlID09PSAnUG9seWdvbicpIHtcbiAgICAgICAgaWYgKCFwb2x5Z29uLmNvb3JkaW5hdGVzIHx8IHBvbHlnb24uY29vcmRpbmF0ZXMubGVuZ3RoIDwgMykge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICdiYWQgJGdlb1dpdGhpbiB2YWx1ZTsgUG9seWdvbi5jb29yZGluYXRlcyBzaG91bGQgY29udGFpbiBhdCBsZWFzdCAzIGxvbi9sYXQgcGFpcnMnXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBwb2ludHMgPSBwb2x5Z29uLmNvb3JkaW5hdGVzO1xuICAgICAgfSBlbHNlIGlmIChwb2x5Z29uIGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICAgICAgaWYgKHBvbHlnb24ubGVuZ3RoIDwgMykge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICdiYWQgJGdlb1dpdGhpbiB2YWx1ZTsgJHBvbHlnb24gc2hvdWxkIGNvbnRhaW4gYXQgbGVhc3QgMyBHZW9Qb2ludHMnXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBwb2ludHMgPSBwb2x5Z29uO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICBcImJhZCAkZ2VvV2l0aGluIHZhbHVlOyAkcG9seWdvbiBzaG91bGQgYmUgUG9seWdvbiBvYmplY3Qgb3IgQXJyYXkgb2YgUGFyc2UuR2VvUG9pbnQnc1wiXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBwb2ludHMgPSBwb2ludHNcbiAgICAgICAgLm1hcChwb2ludCA9PiB7XG4gICAgICAgICAgaWYgKHBvaW50IGluc3RhbmNlb2YgQXJyYXkgJiYgcG9pbnQubGVuZ3RoID09PSAyKSB7XG4gICAgICAgICAgICBQYXJzZS5HZW9Qb2ludC5fdmFsaWRhdGUocG9pbnRbMV0sIHBvaW50WzBdKTtcbiAgICAgICAgICAgIHJldHVybiBgKCR7cG9pbnRbMF19LCAke3BvaW50WzFdfSlgO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAodHlwZW9mIHBvaW50ICE9PSAnb2JqZWN0JyB8fCBwb2ludC5fX3R5cGUgIT09ICdHZW9Qb2ludCcpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgICAnYmFkICRnZW9XaXRoaW4gdmFsdWUnXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBQYXJzZS5HZW9Qb2ludC5fdmFsaWRhdGUocG9pbnQubGF0aXR1ZGUsIHBvaW50LmxvbmdpdHVkZSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBgKCR7cG9pbnQubG9uZ2l0dWRlfSwgJHtwb2ludC5sYXRpdHVkZX0pYDtcbiAgICAgICAgfSlcbiAgICAgICAgLmpvaW4oJywgJyk7XG5cbiAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lOjpwb2ludCA8QCAkJHtpbmRleCArIDF9Ojpwb2x5Z29uYCk7XG4gICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGAoJHtwb2ludHN9KWApO1xuICAgICAgaW5kZXggKz0gMjtcbiAgICB9XG4gICAgaWYgKGZpZWxkVmFsdWUuJGdlb0ludGVyc2VjdHMgJiYgZmllbGRWYWx1ZS4kZ2VvSW50ZXJzZWN0cy4kcG9pbnQpIHtcbiAgICAgIGNvbnN0IHBvaW50ID0gZmllbGRWYWx1ZS4kZ2VvSW50ZXJzZWN0cy4kcG9pbnQ7XG4gICAgICBpZiAodHlwZW9mIHBvaW50ICE9PSAnb2JqZWN0JyB8fCBwb2ludC5fX3R5cGUgIT09ICdHZW9Qb2ludCcpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAnYmFkICRnZW9JbnRlcnNlY3QgdmFsdWU7ICRwb2ludCBzaG91bGQgYmUgR2VvUG9pbnQnXG4gICAgICAgICk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBQYXJzZS5HZW9Qb2ludC5fdmFsaWRhdGUocG9pbnQubGF0aXR1ZGUsIHBvaW50LmxvbmdpdHVkZSk7XG4gICAgICB9XG4gICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZTo6cG9seWdvbiBAPiAkJHtpbmRleCArIDF9Ojpwb2ludGApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBgKCR7cG9pbnQubG9uZ2l0dWRlfSwgJHtwb2ludC5sYXRpdHVkZX0pYCk7XG4gICAgICBpbmRleCArPSAyO1xuICAgIH1cblxuICAgIGlmIChmaWVsZFZhbHVlLiRyZWdleCkge1xuICAgICAgbGV0IHJlZ2V4ID0gZmllbGRWYWx1ZS4kcmVnZXg7XG4gICAgICBsZXQgb3BlcmF0b3IgPSAnfic7XG4gICAgICBjb25zdCBvcHRzID0gZmllbGRWYWx1ZS4kb3B0aW9ucztcbiAgICAgIGlmIChvcHRzKSB7XG4gICAgICAgIGlmIChvcHRzLmluZGV4T2YoJ2knKSA+PSAwKSB7XG4gICAgICAgICAgb3BlcmF0b3IgPSAnfionO1xuICAgICAgICB9XG4gICAgICAgIGlmIChvcHRzLmluZGV4T2YoJ3gnKSA+PSAwKSB7XG4gICAgICAgICAgcmVnZXggPSByZW1vdmVXaGl0ZVNwYWNlKHJlZ2V4KTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBuYW1lID0gdHJhbnNmb3JtRG90RmllbGQoZmllbGROYW1lKTtcbiAgICAgIHJlZ2V4ID0gcHJvY2Vzc1JlZ2V4UGF0dGVybihyZWdleCk7XG5cbiAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpyYXcgJHtvcGVyYXRvcn0gJyQke2luZGV4ICsgMX06cmF3J2ApO1xuICAgICAgdmFsdWVzLnB1c2gobmFtZSwgcmVnZXgpO1xuICAgICAgaW5kZXggKz0gMjtcbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZS5fX3R5cGUgPT09ICdQb2ludGVyJykge1xuICAgICAgaWYgKGlzQXJyYXlGaWVsZCkge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGBhcnJheV9jb250YWlucygkJHtpbmRleH06bmFtZSwgJCR7aW5kZXggKyAxfSlgKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBKU09OLnN0cmluZ2lmeShbZmllbGRWYWx1ZV0pKTtcbiAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUub2JqZWN0SWQpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChmaWVsZFZhbHVlLl9fdHlwZSA9PT0gJ0RhdGUnKSB7XG4gICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX1gKTtcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZS5pc28pO1xuICAgICAgaW5kZXggKz0gMjtcbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZS5fX3R5cGUgPT09ICdHZW9Qb2ludCcpIHtcbiAgICAgIHBhdHRlcm5zLnB1c2goXG4gICAgICAgICckJyArXG4gICAgICAgICAgaW5kZXggK1xuICAgICAgICAgICc6bmFtZSB+PSBQT0lOVCgkJyArXG4gICAgICAgICAgKGluZGV4ICsgMSkgK1xuICAgICAgICAgICcsICQnICtcbiAgICAgICAgICAoaW5kZXggKyAyKSArXG4gICAgICAgICAgJyknXG4gICAgICApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlLmxvbmdpdHVkZSwgZmllbGRWYWx1ZS5sYXRpdHVkZSk7XG4gICAgICBpbmRleCArPSAzO1xuICAgIH1cblxuICAgIGlmIChmaWVsZFZhbHVlLl9fdHlwZSA9PT0gJ1BvbHlnb24nKSB7XG4gICAgICBjb25zdCB2YWx1ZSA9IGNvbnZlcnRQb2x5Z29uVG9TUUwoZmllbGRWYWx1ZS5jb29yZGluYXRlcyk7XG4gICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSB+PSAkJHtpbmRleCArIDF9Ojpwb2x5Z29uYCk7XG4gICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIHZhbHVlKTtcbiAgICAgIGluZGV4ICs9IDI7XG4gICAgfVxuXG4gICAgT2JqZWN0LmtleXMoUGFyc2VUb1Bvc2dyZXNDb21wYXJhdG9yKS5mb3JFYWNoKGNtcCA9PiB7XG4gICAgICBpZiAoZmllbGRWYWx1ZVtjbXBdIHx8IGZpZWxkVmFsdWVbY21wXSA9PT0gMCkge1xuICAgICAgICBjb25zdCBwZ0NvbXBhcmF0b3IgPSBQYXJzZVRvUG9zZ3Jlc0NvbXBhcmF0b3JbY21wXTtcbiAgICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgJHtwZ0NvbXBhcmF0b3J9ICQke2luZGV4ICsgMX1gKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCB0b1Bvc3RncmVzVmFsdWUoZmllbGRWYWx1ZVtjbXBdKSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBpZiAoaW5pdGlhbFBhdHRlcm5zTGVuZ3RoID09PSBwYXR0ZXJucy5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTixcbiAgICAgICAgYFBvc3RncmVzIGRvZXNuJ3Qgc3VwcG9ydCB0aGlzIHF1ZXJ5IHR5cGUgeWV0ICR7SlNPTi5zdHJpbmdpZnkoXG4gICAgICAgICAgZmllbGRWYWx1ZVxuICAgICAgICApfWBcbiAgICAgICk7XG4gICAgfVxuICB9XG4gIHZhbHVlcyA9IHZhbHVlcy5tYXAodHJhbnNmb3JtVmFsdWUpO1xuICByZXR1cm4geyBwYXR0ZXJuOiBwYXR0ZXJucy5qb2luKCcgQU5EICcpLCB2YWx1ZXMsIHNvcnRzIH07XG59O1xuXG5leHBvcnQgY2xhc3MgUG9zdGdyZXNTdG9yYWdlQWRhcHRlciBpbXBsZW1lbnRzIFN0b3JhZ2VBZGFwdGVyIHtcbiAgY2FuU29ydE9uSm9pblRhYmxlczogYm9vbGVhbjtcblxuICAvLyBQcml2YXRlXG4gIF9jb2xsZWN0aW9uUHJlZml4OiBzdHJpbmc7XG4gIF9jbGllbnQ6IGFueTtcbiAgX3BncDogYW55O1xuXG4gIGNvbnN0cnVjdG9yKHsgdXJpLCBjb2xsZWN0aW9uUHJlZml4ID0gJycsIGRhdGFiYXNlT3B0aW9ucyB9OiBhbnkpIHtcbiAgICB0aGlzLl9jb2xsZWN0aW9uUHJlZml4ID0gY29sbGVjdGlvblByZWZpeDtcbiAgICBjb25zdCB7IGNsaWVudCwgcGdwIH0gPSBjcmVhdGVDbGllbnQodXJpLCBkYXRhYmFzZU9wdGlvbnMpO1xuICAgIHRoaXMuX2NsaWVudCA9IGNsaWVudDtcbiAgICB0aGlzLl9wZ3AgPSBwZ3A7XG4gICAgdGhpcy5jYW5Tb3J0T25Kb2luVGFibGVzID0gZmFsc2U7XG4gIH1cblxuICBoYW5kbGVTaHV0ZG93bigpIHtcbiAgICBpZiAoIXRoaXMuX2NsaWVudCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLl9jbGllbnQuJHBvb2wuZW5kKCk7XG4gIH1cblxuICBfZW5zdXJlU2NoZW1hQ29sbGVjdGlvbkV4aXN0cyhjb25uOiBhbnkpIHtcbiAgICBjb25uID0gY29ubiB8fCB0aGlzLl9jbGllbnQ7XG4gICAgcmV0dXJuIGNvbm5cbiAgICAgIC5ub25lKFxuICAgICAgICAnQ1JFQVRFIFRBQkxFIElGIE5PVCBFWElTVFMgXCJfU0NIRU1BXCIgKCBcImNsYXNzTmFtZVwiIHZhckNoYXIoMTIwKSwgXCJzY2hlbWFcIiBqc29uYiwgXCJpc1BhcnNlQ2xhc3NcIiBib29sLCBQUklNQVJZIEtFWSAoXCJjbGFzc05hbWVcIikgKSdcbiAgICAgIClcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChcbiAgICAgICAgICBlcnJvci5jb2RlID09PSBQb3N0Z3Jlc0R1cGxpY2F0ZVJlbGF0aW9uRXJyb3IgfHxcbiAgICAgICAgICBlcnJvci5jb2RlID09PSBQb3N0Z3Jlc1VuaXF1ZUluZGV4VmlvbGF0aW9uRXJyb3IgfHxcbiAgICAgICAgICBlcnJvci5jb2RlID09PSBQb3N0Z3Jlc0R1cGxpY2F0ZU9iamVjdEVycm9yXG4gICAgICAgICkge1xuICAgICAgICAgIC8vIFRhYmxlIGFscmVhZHkgZXhpc3RzLCBtdXN0IGhhdmUgYmVlbiBjcmVhdGVkIGJ5IGEgZGlmZmVyZW50IHJlcXVlc3QuIElnbm9yZSBlcnJvci5cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gIH1cblxuICBjbGFzc0V4aXN0cyhuYW1lOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5fY2xpZW50Lm9uZShcbiAgICAgICdTRUxFQ1QgRVhJU1RTIChTRUxFQ1QgMSBGUk9NIGluZm9ybWF0aW9uX3NjaGVtYS50YWJsZXMgV0hFUkUgdGFibGVfbmFtZSA9ICQxKScsXG4gICAgICBbbmFtZV0sXG4gICAgICBhID0+IGEuZXhpc3RzXG4gICAgKTtcbiAgfVxuXG4gIHNldENsYXNzTGV2ZWxQZXJtaXNzaW9ucyhjbGFzc05hbWU6IHN0cmluZywgQ0xQczogYW55KSB7XG4gICAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudC50YXNrKCdzZXQtY2xhc3MtbGV2ZWwtcGVybWlzc2lvbnMnLCBmdW5jdGlvbioodCkge1xuICAgICAgeWllbGQgc2VsZi5fZW5zdXJlU2NoZW1hQ29sbGVjdGlvbkV4aXN0cyh0KTtcbiAgICAgIGNvbnN0IHZhbHVlcyA9IFtcbiAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAnc2NoZW1hJyxcbiAgICAgICAgJ2NsYXNzTGV2ZWxQZXJtaXNzaW9ucycsXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KENMUHMpLFxuICAgICAgXTtcbiAgICAgIHlpZWxkIHQubm9uZShcbiAgICAgICAgYFVQREFURSBcIl9TQ0hFTUFcIiBTRVQgJDI6bmFtZSA9IGpzb25fb2JqZWN0X3NldF9rZXkoJDI6bmFtZSwgJDM6OnRleHQsICQ0Ojpqc29uYikgV0hFUkUgXCJjbGFzc05hbWVcIj0kMWAsXG4gICAgICAgIHZhbHVlc1xuICAgICAgKTtcbiAgICB9KTtcbiAgfVxuXG4gIHNldEluZGV4ZXNXaXRoU2NoZW1hRm9ybWF0KFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIHN1Ym1pdHRlZEluZGV4ZXM6IGFueSxcbiAgICBleGlzdGluZ0luZGV4ZXM6IGFueSA9IHt9LFxuICAgIGZpZWxkczogYW55LFxuICAgIGNvbm46ID9hbnlcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29ubiA9IGNvbm4gfHwgdGhpcy5fY2xpZW50O1xuICAgIGNvbnN0IHNlbGYgPSB0aGlzO1xuICAgIGlmIChzdWJtaXR0ZWRJbmRleGVzID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG4gICAgaWYgKE9iamVjdC5rZXlzKGV4aXN0aW5nSW5kZXhlcykubGVuZ3RoID09PSAwKSB7XG4gICAgICBleGlzdGluZ0luZGV4ZXMgPSB7IF9pZF86IHsgX2lkOiAxIH0gfTtcbiAgICB9XG4gICAgY29uc3QgZGVsZXRlZEluZGV4ZXMgPSBbXTtcbiAgICBjb25zdCBpbnNlcnRlZEluZGV4ZXMgPSBbXTtcbiAgICBPYmplY3Qua2V5cyhzdWJtaXR0ZWRJbmRleGVzKS5mb3JFYWNoKG5hbWUgPT4ge1xuICAgICAgY29uc3QgZmllbGQgPSBzdWJtaXR0ZWRJbmRleGVzW25hbWVdO1xuICAgICAgaWYgKGV4aXN0aW5nSW5kZXhlc1tuYW1lXSAmJiBmaWVsZC5fX29wICE9PSAnRGVsZXRlJykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSxcbiAgICAgICAgICBgSW5kZXggJHtuYW1lfSBleGlzdHMsIGNhbm5vdCB1cGRhdGUuYFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgaWYgKCFleGlzdGluZ0luZGV4ZXNbbmFtZV0gJiYgZmllbGQuX19vcCA9PT0gJ0RlbGV0ZScpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksXG4gICAgICAgICAgYEluZGV4ICR7bmFtZX0gZG9lcyBub3QgZXhpc3QsIGNhbm5vdCBkZWxldGUuYFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgaWYgKGZpZWxkLl9fb3AgPT09ICdEZWxldGUnKSB7XG4gICAgICAgIGRlbGV0ZWRJbmRleGVzLnB1c2gobmFtZSk7XG4gICAgICAgIGRlbGV0ZSBleGlzdGluZ0luZGV4ZXNbbmFtZV07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBPYmplY3Qua2V5cyhmaWVsZCkuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgICAgIGlmICghZmllbGRzLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSxcbiAgICAgICAgICAgICAgYEZpZWxkICR7a2V5fSBkb2VzIG5vdCBleGlzdCwgY2Fubm90IGFkZCBpbmRleC5gXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGV4aXN0aW5nSW5kZXhlc1tuYW1lXSA9IGZpZWxkO1xuICAgICAgICBpbnNlcnRlZEluZGV4ZXMucHVzaCh7XG4gICAgICAgICAga2V5OiBmaWVsZCxcbiAgICAgICAgICBuYW1lLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gY29ubi50eCgnc2V0LWluZGV4ZXMtd2l0aC1zY2hlbWEtZm9ybWF0JywgZnVuY3Rpb24qKHQpIHtcbiAgICAgIGlmIChpbnNlcnRlZEluZGV4ZXMubGVuZ3RoID4gMCkge1xuICAgICAgICB5aWVsZCBzZWxmLmNyZWF0ZUluZGV4ZXMoY2xhc3NOYW1lLCBpbnNlcnRlZEluZGV4ZXMsIHQpO1xuICAgICAgfVxuICAgICAgaWYgKGRlbGV0ZWRJbmRleGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgeWllbGQgc2VsZi5kcm9wSW5kZXhlcyhjbGFzc05hbWUsIGRlbGV0ZWRJbmRleGVzLCB0KTtcbiAgICAgIH1cbiAgICAgIHlpZWxkIHNlbGYuX2Vuc3VyZVNjaGVtYUNvbGxlY3Rpb25FeGlzdHModCk7XG4gICAgICB5aWVsZCB0Lm5vbmUoXG4gICAgICAgICdVUERBVEUgXCJfU0NIRU1BXCIgU0VUICQyOm5hbWUgPSBqc29uX29iamVjdF9zZXRfa2V5KCQyOm5hbWUsICQzOjp0ZXh0LCAkNDo6anNvbmIpIFdIRVJFIFwiY2xhc3NOYW1lXCI9JDEnLFxuICAgICAgICBbY2xhc3NOYW1lLCAnc2NoZW1hJywgJ2luZGV4ZXMnLCBKU09OLnN0cmluZ2lmeShleGlzdGluZ0luZGV4ZXMpXVxuICAgICAgKTtcbiAgICB9KTtcbiAgfVxuXG4gIGNyZWF0ZUNsYXNzKGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIGNvbm46ID9hbnkpIHtcbiAgICBjb25uID0gY29ubiB8fCB0aGlzLl9jbGllbnQ7XG4gICAgcmV0dXJuIGNvbm5cbiAgICAgIC50eCgnY3JlYXRlLWNsYXNzJywgdCA9PiB7XG4gICAgICAgIGNvbnN0IHExID0gdGhpcy5jcmVhdGVUYWJsZShjbGFzc05hbWUsIHNjaGVtYSwgdCk7XG4gICAgICAgIGNvbnN0IHEyID0gdC5ub25lKFxuICAgICAgICAgICdJTlNFUlQgSU5UTyBcIl9TQ0hFTUFcIiAoXCJjbGFzc05hbWVcIiwgXCJzY2hlbWFcIiwgXCJpc1BhcnNlQ2xhc3NcIikgVkFMVUVTICgkPGNsYXNzTmFtZT4sICQ8c2NoZW1hPiwgdHJ1ZSknLFxuICAgICAgICAgIHsgY2xhc3NOYW1lLCBzY2hlbWEgfVxuICAgICAgICApO1xuICAgICAgICBjb25zdCBxMyA9IHRoaXMuc2V0SW5kZXhlc1dpdGhTY2hlbWFGb3JtYXQoXG4gICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgIHNjaGVtYS5pbmRleGVzLFxuICAgICAgICAgIHt9LFxuICAgICAgICAgIHNjaGVtYS5maWVsZHMsXG4gICAgICAgICAgdFxuICAgICAgICApO1xuICAgICAgICByZXR1cm4gdC5iYXRjaChbcTEsIHEyLCBxM10pO1xuICAgICAgfSlcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIHRvUGFyc2VTY2hlbWEoc2NoZW1hKTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyID0+IHtcbiAgICAgICAgaWYgKGVyci5kYXRhWzBdLnJlc3VsdC5jb2RlID09PSBQb3N0Z3Jlc1RyYW5zYWN0aW9uQWJvcnRlZEVycm9yKSB7XG4gICAgICAgICAgZXJyID0gZXJyLmRhdGFbMV0ucmVzdWx0O1xuICAgICAgICB9XG4gICAgICAgIGlmIChcbiAgICAgICAgICBlcnIuY29kZSA9PT0gUG9zdGdyZXNVbmlxdWVJbmRleFZpb2xhdGlvbkVycm9yICYmXG4gICAgICAgICAgZXJyLmRldGFpbC5pbmNsdWRlcyhjbGFzc05hbWUpXG4gICAgICAgICkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLkRVUExJQ0FURV9WQUxVRSxcbiAgICAgICAgICAgIGBDbGFzcyAke2NsYXNzTmFtZX0gYWxyZWFkeSBleGlzdHMuYFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfSk7XG4gIH1cblxuICAvLyBKdXN0IGNyZWF0ZSBhIHRhYmxlLCBkbyBub3QgaW5zZXJ0IGluIHNjaGVtYVxuICBjcmVhdGVUYWJsZShjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBjb25uOiBhbnkpIHtcbiAgICBjb25uID0gY29ubiB8fCB0aGlzLl9jbGllbnQ7XG4gICAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gICAgZGVidWcoJ2NyZWF0ZVRhYmxlJywgY2xhc3NOYW1lLCBzY2hlbWEpO1xuICAgIGNvbnN0IHZhbHVlc0FycmF5ID0gW107XG4gICAgY29uc3QgcGF0dGVybnNBcnJheSA9IFtdO1xuICAgIGNvbnN0IGZpZWxkcyA9IE9iamVjdC5hc3NpZ24oe30sIHNjaGVtYS5maWVsZHMpO1xuICAgIGlmIChjbGFzc05hbWUgPT09ICdfVXNlcicpIHtcbiAgICAgIGZpZWxkcy5fZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQgPSB7IHR5cGU6ICdEYXRlJyB9O1xuICAgICAgZmllbGRzLl9lbWFpbF92ZXJpZnlfdG9rZW4gPSB7IHR5cGU6ICdTdHJpbmcnIH07XG4gICAgICBmaWVsZHMuX2FjY291bnRfbG9ja291dF9leHBpcmVzX2F0ID0geyB0eXBlOiAnRGF0ZScgfTtcbiAgICAgIGZpZWxkcy5fZmFpbGVkX2xvZ2luX2NvdW50ID0geyB0eXBlOiAnTnVtYmVyJyB9O1xuICAgICAgZmllbGRzLl9wZXJpc2hhYmxlX3Rva2VuID0geyB0eXBlOiAnU3RyaW5nJyB9O1xuICAgICAgZmllbGRzLl9wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQgPSB7IHR5cGU6ICdEYXRlJyB9O1xuICAgICAgZmllbGRzLl9wYXNzd29yZF9jaGFuZ2VkX2F0ID0geyB0eXBlOiAnRGF0ZScgfTtcbiAgICAgIGZpZWxkcy5fcGFzc3dvcmRfaGlzdG9yeSA9IHsgdHlwZTogJ0FycmF5JyB9O1xuICAgIH1cbiAgICBsZXQgaW5kZXggPSAyO1xuICAgIGNvbnN0IHJlbGF0aW9ucyA9IFtdO1xuICAgIE9iamVjdC5rZXlzKGZpZWxkcykuZm9yRWFjaChmaWVsZE5hbWUgPT4ge1xuICAgICAgY29uc3QgcGFyc2VUeXBlID0gZmllbGRzW2ZpZWxkTmFtZV07XG4gICAgICAvLyBTa2lwIHdoZW4gaXQncyBhIHJlbGF0aW9uXG4gICAgICAvLyBXZSdsbCBjcmVhdGUgdGhlIHRhYmxlcyBsYXRlclxuICAgICAgaWYgKHBhcnNlVHlwZS50eXBlID09PSAnUmVsYXRpb24nKSB7XG4gICAgICAgIHJlbGF0aW9ucy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGlmIChbJ19ycGVybScsICdfd3Blcm0nXS5pbmRleE9mKGZpZWxkTmFtZSkgPj0gMCkge1xuICAgICAgICBwYXJzZVR5cGUuY29udGVudHMgPSB7IHR5cGU6ICdTdHJpbmcnIH07XG4gICAgICB9XG4gICAgICB2YWx1ZXNBcnJheS5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICB2YWx1ZXNBcnJheS5wdXNoKHBhcnNlVHlwZVRvUG9zdGdyZXNUeXBlKHBhcnNlVHlwZSkpO1xuICAgICAgcGF0dGVybnNBcnJheS5wdXNoKGAkJHtpbmRleH06bmFtZSAkJHtpbmRleCArIDF9OnJhd2ApO1xuICAgICAgaWYgKGZpZWxkTmFtZSA9PT0gJ29iamVjdElkJykge1xuICAgICAgICBwYXR0ZXJuc0FycmF5LnB1c2goYFBSSU1BUlkgS0VZICgkJHtpbmRleH06bmFtZSlgKTtcbiAgICAgIH1cbiAgICAgIGluZGV4ID0gaW5kZXggKyAyO1xuICAgIH0pO1xuICAgIGNvbnN0IHFzID0gYENSRUFURSBUQUJMRSBJRiBOT1QgRVhJU1RTICQxOm5hbWUgKCR7cGF0dGVybnNBcnJheS5qb2luKCl9KWA7XG4gICAgY29uc3QgdmFsdWVzID0gW2NsYXNzTmFtZSwgLi4udmFsdWVzQXJyYXldO1xuXG4gICAgcmV0dXJuIGNvbm4udGFzaygnY3JlYXRlLXRhYmxlJywgZnVuY3Rpb24qKHQpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHlpZWxkIHNlbGYuX2Vuc3VyZVNjaGVtYUNvbGxlY3Rpb25FeGlzdHModCk7XG4gICAgICAgIHlpZWxkIHQubm9uZShxcywgdmFsdWVzKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlICE9PSBQb3N0Z3Jlc0R1cGxpY2F0ZVJlbGF0aW9uRXJyb3IpIHtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgICAvLyBFTFNFOiBUYWJsZSBhbHJlYWR5IGV4aXN0cywgbXVzdCBoYXZlIGJlZW4gY3JlYXRlZCBieSBhIGRpZmZlcmVudCByZXF1ZXN0LiBJZ25vcmUgdGhlIGVycm9yLlxuICAgICAgfVxuICAgICAgeWllbGQgdC50eCgnY3JlYXRlLXRhYmxlLXR4JywgdHggPT4ge1xuICAgICAgICByZXR1cm4gdHguYmF0Y2goXG4gICAgICAgICAgcmVsYXRpb25zLm1hcChmaWVsZE5hbWUgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHR4Lm5vbmUoXG4gICAgICAgICAgICAgICdDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyAkPGpvaW5UYWJsZTpuYW1lPiAoXCJyZWxhdGVkSWRcIiB2YXJDaGFyKDEyMCksIFwib3duaW5nSWRcIiB2YXJDaGFyKDEyMCksIFBSSU1BUlkgS0VZKFwicmVsYXRlZElkXCIsIFwib3duaW5nSWRcIikgKScsXG4gICAgICAgICAgICAgIHsgam9pblRhYmxlOiBgX0pvaW46JHtmaWVsZE5hbWV9OiR7Y2xhc3NOYW1lfWAgfVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9KVxuICAgICAgICApO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBzY2hlbWFVcGdyYWRlKGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIGNvbm46IGFueSkge1xuICAgIGRlYnVnKCdzY2hlbWFVcGdyYWRlJywgeyBjbGFzc05hbWUsIHNjaGVtYSB9KTtcbiAgICBjb25uID0gY29ubiB8fCB0aGlzLl9jbGllbnQ7XG4gICAgY29uc3Qgc2VsZiA9IHRoaXM7XG5cbiAgICByZXR1cm4gY29ubi50eCgnc2NoZW1hLXVwZ3JhZGUnLCBmdW5jdGlvbioodCkge1xuICAgICAgY29uc3QgY29sdW1ucyA9IHlpZWxkIHQubWFwKFxuICAgICAgICAnU0VMRUNUIGNvbHVtbl9uYW1lIEZST00gaW5mb3JtYXRpb25fc2NoZW1hLmNvbHVtbnMgV0hFUkUgdGFibGVfbmFtZSA9ICQ8Y2xhc3NOYW1lPicsXG4gICAgICAgIHsgY2xhc3NOYW1lIH0sXG4gICAgICAgIGEgPT4gYS5jb2x1bW5fbmFtZVxuICAgICAgKTtcbiAgICAgIGNvbnN0IG5ld0NvbHVtbnMgPSBPYmplY3Qua2V5cyhzY2hlbWEuZmllbGRzKVxuICAgICAgICAuZmlsdGVyKGl0ZW0gPT4gY29sdW1ucy5pbmRleE9mKGl0ZW0pID09PSAtMSlcbiAgICAgICAgLm1hcChmaWVsZE5hbWUgPT5cbiAgICAgICAgICBzZWxmLmFkZEZpZWxkSWZOb3RFeGlzdHMoXG4gICAgICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgICAgICBmaWVsZE5hbWUsXG4gICAgICAgICAgICBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0sXG4gICAgICAgICAgICB0XG4gICAgICAgICAgKVxuICAgICAgICApO1xuXG4gICAgICB5aWVsZCB0LmJhdGNoKG5ld0NvbHVtbnMpO1xuICAgIH0pO1xuICB9XG5cbiAgYWRkRmllbGRJZk5vdEV4aXN0cyhcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBmaWVsZE5hbWU6IHN0cmluZyxcbiAgICB0eXBlOiBhbnksXG4gICAgY29ubjogYW55XG4gICkge1xuICAgIC8vIFRPRE86IE11c3QgYmUgcmV2aXNlZCBmb3IgaW52YWxpZCBsb2dpYy4uLlxuICAgIGRlYnVnKCdhZGRGaWVsZElmTm90RXhpc3RzJywgeyBjbGFzc05hbWUsIGZpZWxkTmFtZSwgdHlwZSB9KTtcbiAgICBjb25uID0gY29ubiB8fCB0aGlzLl9jbGllbnQ7XG4gICAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gICAgcmV0dXJuIGNvbm4udHgoJ2FkZC1maWVsZC1pZi1ub3QtZXhpc3RzJywgZnVuY3Rpb24qKHQpIHtcbiAgICAgIGlmICh0eXBlLnR5cGUgIT09ICdSZWxhdGlvbicpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICB5aWVsZCB0Lm5vbmUoXG4gICAgICAgICAgICAnQUxURVIgVEFCTEUgJDxjbGFzc05hbWU6bmFtZT4gQUREIENPTFVNTiAkPGZpZWxkTmFtZTpuYW1lPiAkPHBvc3RncmVzVHlwZTpyYXc+JyxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICBmaWVsZE5hbWUsXG4gICAgICAgICAgICAgIHBvc3RncmVzVHlwZTogcGFyc2VUeXBlVG9Qb3N0Z3Jlc1R5cGUodHlwZSksXG4gICAgICAgICAgICB9XG4gICAgICAgICAgKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBpZiAoZXJyb3IuY29kZSA9PT0gUG9zdGdyZXNSZWxhdGlvbkRvZXNOb3RFeGlzdEVycm9yKSB7XG4gICAgICAgICAgICByZXR1cm4geWllbGQgc2VsZi5jcmVhdGVDbGFzcyhcbiAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICB7IGZpZWxkczogeyBbZmllbGROYW1lXTogdHlwZSB9IH0sXG4gICAgICAgICAgICAgIHRcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChlcnJvci5jb2RlICE9PSBQb3N0Z3Jlc0R1cGxpY2F0ZUNvbHVtbkVycm9yKSB7XG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gQ29sdW1uIGFscmVhZHkgZXhpc3RzLCBjcmVhdGVkIGJ5IG90aGVyIHJlcXVlc3QuIENhcnJ5IG9uIHRvIHNlZSBpZiBpdCdzIHRoZSByaWdodCB0eXBlLlxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB5aWVsZCB0Lm5vbmUoXG4gICAgICAgICAgJ0NSRUFURSBUQUJMRSBJRiBOT1QgRVhJU1RTICQ8am9pblRhYmxlOm5hbWU+IChcInJlbGF0ZWRJZFwiIHZhckNoYXIoMTIwKSwgXCJvd25pbmdJZFwiIHZhckNoYXIoMTIwKSwgUFJJTUFSWSBLRVkoXCJyZWxhdGVkSWRcIiwgXCJvd25pbmdJZFwiKSApJyxcbiAgICAgICAgICB7IGpvaW5UYWJsZTogYF9Kb2luOiR7ZmllbGROYW1lfToke2NsYXNzTmFtZX1gIH1cbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVzdWx0ID0geWllbGQgdC5hbnkoXG4gICAgICAgICdTRUxFQ1QgXCJzY2hlbWFcIiBGUk9NIFwiX1NDSEVNQVwiIFdIRVJFIFwiY2xhc3NOYW1lXCIgPSAkPGNsYXNzTmFtZT4gYW5kIChcInNjaGVtYVwiOjpqc29uLT5cXCdmaWVsZHNcXCctPiQ8ZmllbGROYW1lPikgaXMgbm90IG51bGwnLFxuICAgICAgICB7IGNsYXNzTmFtZSwgZmllbGROYW1lIH1cbiAgICAgICk7XG5cbiAgICAgIGlmIChyZXN1bHRbMF0pIHtcbiAgICAgICAgdGhyb3cgJ0F0dGVtcHRlZCB0byBhZGQgYSBmaWVsZCB0aGF0IGFscmVhZHkgZXhpc3RzJztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IHBhdGggPSBge2ZpZWxkcywke2ZpZWxkTmFtZX19YDtcbiAgICAgICAgeWllbGQgdC5ub25lKFxuICAgICAgICAgICdVUERBVEUgXCJfU0NIRU1BXCIgU0VUIFwic2NoZW1hXCI9anNvbmJfc2V0KFwic2NoZW1hXCIsICQ8cGF0aD4sICQ8dHlwZT4pICBXSEVSRSBcImNsYXNzTmFtZVwiPSQ8Y2xhc3NOYW1lPicsXG4gICAgICAgICAgeyBwYXRoLCB0eXBlLCBjbGFzc05hbWUgfVxuICAgICAgICApO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLy8gRHJvcHMgYSBjb2xsZWN0aW9uLiBSZXNvbHZlcyB3aXRoIHRydWUgaWYgaXQgd2FzIGEgUGFyc2UgU2NoZW1hIChlZy4gX1VzZXIsIEN1c3RvbSwgZXRjLilcbiAgLy8gYW5kIHJlc29sdmVzIHdpdGggZmFsc2UgaWYgaXQgd2Fzbid0IChlZy4gYSBqb2luIHRhYmxlKS4gUmVqZWN0cyBpZiBkZWxldGlvbiB3YXMgaW1wb3NzaWJsZS5cbiAgZGVsZXRlQ2xhc3MoY2xhc3NOYW1lOiBzdHJpbmcpIHtcbiAgICBjb25zdCBvcGVyYXRpb25zID0gW1xuICAgICAgeyBxdWVyeTogYERST1AgVEFCTEUgSUYgRVhJU1RTICQxOm5hbWVgLCB2YWx1ZXM6IFtjbGFzc05hbWVdIH0sXG4gICAgICB7XG4gICAgICAgIHF1ZXJ5OiBgREVMRVRFIEZST00gXCJfU0NIRU1BXCIgV0hFUkUgXCJjbGFzc05hbWVcIiA9ICQxYCxcbiAgICAgICAgdmFsdWVzOiBbY2xhc3NOYW1lXSxcbiAgICAgIH0sXG4gICAgXTtcbiAgICByZXR1cm4gdGhpcy5fY2xpZW50XG4gICAgICAudHgodCA9PiB0Lm5vbmUodGhpcy5fcGdwLmhlbHBlcnMuY29uY2F0KG9wZXJhdGlvbnMpKSlcbiAgICAgIC50aGVuKCgpID0+IGNsYXNzTmFtZS5pbmRleE9mKCdfSm9pbjonKSAhPSAwKTsgLy8gcmVzb2x2ZXMgd2l0aCBmYWxzZSB3aGVuIF9Kb2luIHRhYmxlXG4gIH1cblxuICAvLyBEZWxldGUgYWxsIGRhdGEga25vd24gdG8gdGhpcyBhZGFwdGVyLiBVc2VkIGZvciB0ZXN0aW5nLlxuICBkZWxldGVBbGxDbGFzc2VzKCkge1xuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkuZ2V0VGltZSgpO1xuICAgIGNvbnN0IGhlbHBlcnMgPSB0aGlzLl9wZ3AuaGVscGVycztcbiAgICBkZWJ1ZygnZGVsZXRlQWxsQ2xhc3NlcycpO1xuXG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudFxuICAgICAgLnRhc2soJ2RlbGV0ZS1hbGwtY2xhc3NlcycsIGZ1bmN0aW9uKih0KSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcmVzdWx0cyA9IHlpZWxkIHQuYW55KCdTRUxFQ1QgKiBGUk9NIFwiX1NDSEVNQVwiJyk7XG4gICAgICAgICAgY29uc3Qgam9pbnMgPSByZXN1bHRzLnJlZHVjZSgobGlzdDogQXJyYXk8c3RyaW5nPiwgc2NoZW1hOiBhbnkpID0+IHtcbiAgICAgICAgICAgIHJldHVybiBsaXN0LmNvbmNhdChqb2luVGFibGVzRm9yU2NoZW1hKHNjaGVtYS5zY2hlbWEpKTtcbiAgICAgICAgICB9LCBbXSk7XG4gICAgICAgICAgY29uc3QgY2xhc3NlcyA9IFtcbiAgICAgICAgICAgICdfU0NIRU1BJyxcbiAgICAgICAgICAgICdfUHVzaFN0YXR1cycsXG4gICAgICAgICAgICAnX0pvYlN0YXR1cycsXG4gICAgICAgICAgICAnX0pvYlNjaGVkdWxlJyxcbiAgICAgICAgICAgICdfSG9va3MnLFxuICAgICAgICAgICAgJ19HbG9iYWxDb25maWcnLFxuICAgICAgICAgICAgJ19BdWRpZW5jZScsXG4gICAgICAgICAgICAuLi5yZXN1bHRzLm1hcChyZXN1bHQgPT4gcmVzdWx0LmNsYXNzTmFtZSksXG4gICAgICAgICAgICAuLi5qb2lucyxcbiAgICAgICAgICBdO1xuICAgICAgICAgIGNvbnN0IHF1ZXJpZXMgPSBjbGFzc2VzLm1hcChjbGFzc05hbWUgPT4gKHtcbiAgICAgICAgICAgIHF1ZXJ5OiAnRFJPUCBUQUJMRSBJRiBFWElTVFMgJDxjbGFzc05hbWU6bmFtZT4nLFxuICAgICAgICAgICAgdmFsdWVzOiB7IGNsYXNzTmFtZSB9LFxuICAgICAgICAgIH0pKTtcbiAgICAgICAgICB5aWVsZCB0LnR4KHR4ID0+IHR4Lm5vbmUoaGVscGVycy5jb25jYXQocXVlcmllcykpKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBpZiAoZXJyb3IuY29kZSAhPT0gUG9zdGdyZXNSZWxhdGlvbkRvZXNOb3RFeGlzdEVycm9yKSB7XG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gTm8gX1NDSEVNQSBjb2xsZWN0aW9uLiBEb24ndCBkZWxldGUgYW55dGhpbmcuXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIGRlYnVnKGBkZWxldGVBbGxDbGFzc2VzIGRvbmUgaW4gJHtuZXcgRGF0ZSgpLmdldFRpbWUoKSAtIG5vd31gKTtcbiAgICAgIH0pO1xuICB9XG5cbiAgLy8gUmVtb3ZlIHRoZSBjb2x1bW4gYW5kIGFsbCB0aGUgZGF0YS4gRm9yIFJlbGF0aW9ucywgdGhlIF9Kb2luIGNvbGxlY3Rpb24gaXMgaGFuZGxlZFxuICAvLyBzcGVjaWFsbHksIHRoaXMgZnVuY3Rpb24gZG9lcyBub3QgZGVsZXRlIF9Kb2luIGNvbHVtbnMuIEl0IHNob3VsZCwgaG93ZXZlciwgaW5kaWNhdGVcbiAgLy8gdGhhdCB0aGUgcmVsYXRpb24gZmllbGRzIGRvZXMgbm90IGV4aXN0IGFueW1vcmUuIEluIG1vbmdvLCB0aGlzIG1lYW5zIHJlbW92aW5nIGl0IGZyb21cbiAgLy8gdGhlIF9TQ0hFTUEgY29sbGVjdGlvbi4gIFRoZXJlIHNob3VsZCBiZSBubyBhY3R1YWwgZGF0YSBpbiB0aGUgY29sbGVjdGlvbiB1bmRlciB0aGUgc2FtZSBuYW1lXG4gIC8vIGFzIHRoZSByZWxhdGlvbiBjb2x1bW4sIHNvIGl0J3MgZmluZSB0byBhdHRlbXB0IHRvIGRlbGV0ZSBpdC4gSWYgdGhlIGZpZWxkcyBsaXN0ZWQgdG8gYmVcbiAgLy8gZGVsZXRlZCBkbyBub3QgZXhpc3QsIHRoaXMgZnVuY3Rpb24gc2hvdWxkIHJldHVybiBzdWNjZXNzZnVsbHkgYW55d2F5cy4gQ2hlY2tpbmcgZm9yXG4gIC8vIGF0dGVtcHRzIHRvIGRlbGV0ZSBub24tZXhpc3RlbnQgZmllbGRzIGlzIHRoZSByZXNwb25zaWJpbGl0eSBvZiBQYXJzZSBTZXJ2ZXIuXG5cbiAgLy8gVGhpcyBmdW5jdGlvbiBpcyBub3Qgb2JsaWdhdGVkIHRvIGRlbGV0ZSBmaWVsZHMgYXRvbWljYWxseS4gSXQgaXMgZ2l2ZW4gdGhlIGZpZWxkXG4gIC8vIG5hbWVzIGluIGEgbGlzdCBzbyB0aGF0IGRhdGFiYXNlcyB0aGF0IGFyZSBjYXBhYmxlIG9mIGRlbGV0aW5nIGZpZWxkcyBhdG9taWNhbGx5XG4gIC8vIG1heSBkbyBzby5cblxuICAvLyBSZXR1cm5zIGEgUHJvbWlzZS5cbiAgZGVsZXRlRmllbGRzKFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIHNjaGVtYTogU2NoZW1hVHlwZSxcbiAgICBmaWVsZE5hbWVzOiBzdHJpbmdbXVxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBkZWJ1ZygnZGVsZXRlRmllbGRzJywgY2xhc3NOYW1lLCBmaWVsZE5hbWVzKTtcbiAgICBmaWVsZE5hbWVzID0gZmllbGROYW1lcy5yZWR1Y2UoKGxpc3Q6IEFycmF5PHN0cmluZz4sIGZpZWxkTmFtZTogc3RyaW5nKSA9PiB7XG4gICAgICBjb25zdCBmaWVsZCA9IHNjaGVtYS5maWVsZHNbZmllbGROYW1lXTtcbiAgICAgIGlmIChmaWVsZC50eXBlICE9PSAnUmVsYXRpb24nKSB7XG4gICAgICAgIGxpc3QucHVzaChmaWVsZE5hbWUpO1xuICAgICAgfVxuICAgICAgZGVsZXRlIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXTtcbiAgICAgIHJldHVybiBsaXN0O1xuICAgIH0sIFtdKTtcblxuICAgIGNvbnN0IHZhbHVlcyA9IFtjbGFzc05hbWUsIC4uLmZpZWxkTmFtZXNdO1xuICAgIGNvbnN0IGNvbHVtbnMgPSBmaWVsZE5hbWVzXG4gICAgICAubWFwKChuYW1lLCBpZHgpID0+IHtcbiAgICAgICAgcmV0dXJuIGAkJHtpZHggKyAyfTpuYW1lYDtcbiAgICAgIH0pXG4gICAgICAuam9pbignLCBEUk9QIENPTFVNTicpO1xuXG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudC50eCgnZGVsZXRlLWZpZWxkcycsIGZ1bmN0aW9uKih0KSB7XG4gICAgICB5aWVsZCB0Lm5vbmUoXG4gICAgICAgICdVUERBVEUgXCJfU0NIRU1BXCIgU0VUIFwic2NoZW1hXCI9JDxzY2hlbWE+IFdIRVJFIFwiY2xhc3NOYW1lXCI9JDxjbGFzc05hbWU+JyxcbiAgICAgICAgeyBzY2hlbWEsIGNsYXNzTmFtZSB9XG4gICAgICApO1xuICAgICAgaWYgKHZhbHVlcy5sZW5ndGggPiAxKSB7XG4gICAgICAgIHlpZWxkIHQubm9uZShgQUxURVIgVEFCTEUgJDE6bmFtZSBEUk9QIENPTFVNTiAke2NvbHVtbnN9YCwgdmFsdWVzKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8vIFJldHVybiBhIHByb21pc2UgZm9yIGFsbCBzY2hlbWFzIGtub3duIHRvIHRoaXMgYWRhcHRlciwgaW4gUGFyc2UgZm9ybWF0LiBJbiBjYXNlIHRoZVxuICAvLyBzY2hlbWFzIGNhbm5vdCBiZSByZXRyaWV2ZWQsIHJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVqZWN0cy4gUmVxdWlyZW1lbnRzIGZvciB0aGVcbiAgLy8gcmVqZWN0aW9uIHJlYXNvbiBhcmUgVEJELlxuICBnZXRBbGxDbGFzc2VzKCkge1xuICAgIGNvbnN0IHNlbGYgPSB0aGlzO1xuICAgIHJldHVybiB0aGlzLl9jbGllbnQudGFzaygnZ2V0LWFsbC1jbGFzc2VzJywgZnVuY3Rpb24qKHQpIHtcbiAgICAgIHlpZWxkIHNlbGYuX2Vuc3VyZVNjaGVtYUNvbGxlY3Rpb25FeGlzdHModCk7XG4gICAgICByZXR1cm4geWllbGQgdC5tYXAoJ1NFTEVDVCAqIEZST00gXCJfU0NIRU1BXCInLCBudWxsLCByb3cgPT5cbiAgICAgICAgdG9QYXJzZVNjaGVtYSh7IGNsYXNzTmFtZTogcm93LmNsYXNzTmFtZSwgLi4ucm93LnNjaGVtYSB9KVxuICAgICAgKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIFJldHVybiBhIHByb21pc2UgZm9yIHRoZSBzY2hlbWEgd2l0aCB0aGUgZ2l2ZW4gbmFtZSwgaW4gUGFyc2UgZm9ybWF0LiBJZlxuICAvLyB0aGlzIGFkYXB0ZXIgZG9lc24ndCBrbm93IGFib3V0IHRoZSBzY2hlbWEsIHJldHVybiBhIHByb21pc2UgdGhhdCByZWplY3RzIHdpdGhcbiAgLy8gdW5kZWZpbmVkIGFzIHRoZSByZWFzb24uXG4gIGdldENsYXNzKGNsYXNzTmFtZTogc3RyaW5nKSB7XG4gICAgZGVidWcoJ2dldENsYXNzJywgY2xhc3NOYW1lKTtcbiAgICByZXR1cm4gdGhpcy5fY2xpZW50XG4gICAgICAuYW55KCdTRUxFQ1QgKiBGUk9NIFwiX1NDSEVNQVwiIFdIRVJFIFwiY2xhc3NOYW1lXCI9JDxjbGFzc05hbWU+Jywge1xuICAgICAgICBjbGFzc05hbWUsXG4gICAgICB9KVxuICAgICAgLnRoZW4ocmVzdWx0ID0+IHtcbiAgICAgICAgaWYgKHJlc3VsdC5sZW5ndGggIT09IDEpIHtcbiAgICAgICAgICB0aHJvdyB1bmRlZmluZWQ7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdFswXS5zY2hlbWE7XG4gICAgICB9KVxuICAgICAgLnRoZW4odG9QYXJzZVNjaGVtYSk7XG4gIH1cblxuICAvLyBUT0RPOiByZW1vdmUgdGhlIG1vbmdvIGZvcm1hdCBkZXBlbmRlbmN5IGluIHRoZSByZXR1cm4gdmFsdWVcbiAgY3JlYXRlT2JqZWN0KGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIG9iamVjdDogYW55KSB7XG4gICAgZGVidWcoJ2NyZWF0ZU9iamVjdCcsIGNsYXNzTmFtZSwgb2JqZWN0KTtcbiAgICBsZXQgY29sdW1uc0FycmF5ID0gW107XG4gICAgY29uc3QgdmFsdWVzQXJyYXkgPSBbXTtcbiAgICBzY2hlbWEgPSB0b1Bvc3RncmVzU2NoZW1hKHNjaGVtYSk7XG4gICAgY29uc3QgZ2VvUG9pbnRzID0ge307XG5cbiAgICBvYmplY3QgPSBoYW5kbGVEb3RGaWVsZHMob2JqZWN0KTtcblxuICAgIHZhbGlkYXRlS2V5cyhvYmplY3QpO1xuXG4gICAgT2JqZWN0LmtleXMob2JqZWN0KS5mb3JFYWNoKGZpZWxkTmFtZSA9PiB7XG4gICAgICBpZiAob2JqZWN0W2ZpZWxkTmFtZV0gPT09IG51bGwpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdmFyIGF1dGhEYXRhTWF0Y2ggPSBmaWVsZE5hbWUubWF0Y2goL15fYXV0aF9kYXRhXyhbYS16QS1aMC05X10rKSQvKTtcbiAgICAgIGlmIChhdXRoRGF0YU1hdGNoKSB7XG4gICAgICAgIHZhciBwcm92aWRlciA9IGF1dGhEYXRhTWF0Y2hbMV07XG4gICAgICAgIG9iamVjdFsnYXV0aERhdGEnXSA9IG9iamVjdFsnYXV0aERhdGEnXSB8fCB7fTtcbiAgICAgICAgb2JqZWN0WydhdXRoRGF0YSddW3Byb3ZpZGVyXSA9IG9iamVjdFtmaWVsZE5hbWVdO1xuICAgICAgICBkZWxldGUgb2JqZWN0W2ZpZWxkTmFtZV07XG4gICAgICAgIGZpZWxkTmFtZSA9ICdhdXRoRGF0YSc7XG4gICAgICB9XG5cbiAgICAgIGNvbHVtbnNBcnJheS5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICBpZiAoIXNjaGVtYS5maWVsZHNbZmllbGROYW1lXSAmJiBjbGFzc05hbWUgPT09ICdfVXNlcicpIHtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIGZpZWxkTmFtZSA9PT0gJ19lbWFpbF92ZXJpZnlfdG9rZW4nIHx8XG4gICAgICAgICAgZmllbGROYW1lID09PSAnX2ZhaWxlZF9sb2dpbl9jb3VudCcgfHxcbiAgICAgICAgICBmaWVsZE5hbWUgPT09ICdfcGVyaXNoYWJsZV90b2tlbicgfHxcbiAgICAgICAgICBmaWVsZE5hbWUgPT09ICdfcGFzc3dvcmRfaGlzdG9yeSdcbiAgICAgICAgKSB7XG4gICAgICAgICAgdmFsdWVzQXJyYXkucHVzaChvYmplY3RbZmllbGROYW1lXSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZmllbGROYW1lID09PSAnX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0Jykge1xuICAgICAgICAgIGlmIChvYmplY3RbZmllbGROYW1lXSkge1xuICAgICAgICAgICAgdmFsdWVzQXJyYXkucHVzaChvYmplY3RbZmllbGROYW1lXS5pc28pO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKG51bGwpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChcbiAgICAgICAgICBmaWVsZE5hbWUgPT09ICdfYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQnIHx8XG4gICAgICAgICAgZmllbGROYW1lID09PSAnX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdCcgfHxcbiAgICAgICAgICBmaWVsZE5hbWUgPT09ICdfcGFzc3dvcmRfY2hhbmdlZF9hdCdcbiAgICAgICAgKSB7XG4gICAgICAgICAgaWYgKG9iamVjdFtmaWVsZE5hbWVdKSB7XG4gICAgICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKG9iamVjdFtmaWVsZE5hbWVdLmlzbyk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZhbHVlc0FycmF5LnB1c2gobnVsbCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHN3aXRjaCAoc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUpIHtcbiAgICAgICAgY2FzZSAnRGF0ZSc6XG4gICAgICAgICAgaWYgKG9iamVjdFtmaWVsZE5hbWVdKSB7XG4gICAgICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKG9iamVjdFtmaWVsZE5hbWVdLmlzbyk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZhbHVlc0FycmF5LnB1c2gobnVsbCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdQb2ludGVyJzpcbiAgICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKG9iamVjdFtmaWVsZE5hbWVdLm9iamVjdElkKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnQXJyYXknOlxuICAgICAgICAgIGlmIChbJ19ycGVybScsICdfd3Blcm0nXS5pbmRleE9mKGZpZWxkTmFtZSkgPj0gMCkge1xuICAgICAgICAgICAgdmFsdWVzQXJyYXkucHVzaChvYmplY3RbZmllbGROYW1lXSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZhbHVlc0FycmF5LnB1c2goSlNPTi5zdHJpbmdpZnkob2JqZWN0W2ZpZWxkTmFtZV0pKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ09iamVjdCc6XG4gICAgICAgIGNhc2UgJ0J5dGVzJzpcbiAgICAgICAgY2FzZSAnU3RyaW5nJzpcbiAgICAgICAgY2FzZSAnTnVtYmVyJzpcbiAgICAgICAgY2FzZSAnQm9vbGVhbic6XG4gICAgICAgICAgdmFsdWVzQXJyYXkucHVzaChvYmplY3RbZmllbGROYW1lXSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ0ZpbGUnOlxuICAgICAgICAgIHZhbHVlc0FycmF5LnB1c2gob2JqZWN0W2ZpZWxkTmFtZV0ubmFtZSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ1BvbHlnb24nOiB7XG4gICAgICAgICAgY29uc3QgdmFsdWUgPSBjb252ZXJ0UG9seWdvblRvU1FMKG9iamVjdFtmaWVsZE5hbWVdLmNvb3JkaW5hdGVzKTtcbiAgICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKHZhbHVlKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjYXNlICdHZW9Qb2ludCc6XG4gICAgICAgICAgLy8gcG9wIHRoZSBwb2ludCBhbmQgcHJvY2VzcyBsYXRlclxuICAgICAgICAgIGdlb1BvaW50c1tmaWVsZE5hbWVdID0gb2JqZWN0W2ZpZWxkTmFtZV07XG4gICAgICAgICAgY29sdW1uc0FycmF5LnBvcCgpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRocm93IGBUeXBlICR7c2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGV9IG5vdCBzdXBwb3J0ZWQgeWV0YDtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbHVtbnNBcnJheSA9IGNvbHVtbnNBcnJheS5jb25jYXQoT2JqZWN0LmtleXMoZ2VvUG9pbnRzKSk7XG4gICAgY29uc3QgaW5pdGlhbFZhbHVlcyA9IHZhbHVlc0FycmF5Lm1hcCgodmFsLCBpbmRleCkgPT4ge1xuICAgICAgbGV0IHRlcm1pbmF0aW9uID0gJyc7XG4gICAgICBjb25zdCBmaWVsZE5hbWUgPSBjb2x1bW5zQXJyYXlbaW5kZXhdO1xuICAgICAgaWYgKFsnX3JwZXJtJywgJ193cGVybSddLmluZGV4T2YoZmllbGROYW1lKSA+PSAwKSB7XG4gICAgICAgIHRlcm1pbmF0aW9uID0gJzo6dGV4dFtdJztcbiAgICAgIH0gZWxzZSBpZiAoXG4gICAgICAgIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXSAmJlxuICAgICAgICBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ0FycmF5J1xuICAgICAgKSB7XG4gICAgICAgIHRlcm1pbmF0aW9uID0gJzo6anNvbmInO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGAkJHtpbmRleCArIDIgKyBjb2x1bW5zQXJyYXkubGVuZ3RofSR7dGVybWluYXRpb259YDtcbiAgICB9KTtcbiAgICBjb25zdCBnZW9Qb2ludHNJbmplY3RzID0gT2JqZWN0LmtleXMoZ2VvUG9pbnRzKS5tYXAoa2V5ID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gZ2VvUG9pbnRzW2tleV07XG4gICAgICB2YWx1ZXNBcnJheS5wdXNoKHZhbHVlLmxvbmdpdHVkZSwgdmFsdWUubGF0aXR1ZGUpO1xuICAgICAgY29uc3QgbCA9IHZhbHVlc0FycmF5Lmxlbmd0aCArIGNvbHVtbnNBcnJheS5sZW5ndGg7XG4gICAgICByZXR1cm4gYFBPSU5UKCQke2x9LCAkJHtsICsgMX0pYDtcbiAgICB9KTtcblxuICAgIGNvbnN0IGNvbHVtbnNQYXR0ZXJuID0gY29sdW1uc0FycmF5XG4gICAgICAubWFwKChjb2wsIGluZGV4KSA9PiBgJCR7aW5kZXggKyAyfTpuYW1lYClcbiAgICAgIC5qb2luKCk7XG4gICAgY29uc3QgdmFsdWVzUGF0dGVybiA9IGluaXRpYWxWYWx1ZXMuY29uY2F0KGdlb1BvaW50c0luamVjdHMpLmpvaW4oKTtcblxuICAgIGNvbnN0IHFzID0gYElOU0VSVCBJTlRPICQxOm5hbWUgKCR7Y29sdW1uc1BhdHRlcm59KSBWQUxVRVMgKCR7dmFsdWVzUGF0dGVybn0pYDtcbiAgICBjb25zdCB2YWx1ZXMgPSBbY2xhc3NOYW1lLCAuLi5jb2x1bW5zQXJyYXksIC4uLnZhbHVlc0FycmF5XTtcbiAgICBkZWJ1ZyhxcywgdmFsdWVzKTtcbiAgICByZXR1cm4gdGhpcy5fY2xpZW50XG4gICAgICAubm9uZShxcywgdmFsdWVzKVxuICAgICAgLnRoZW4oKCkgPT4gKHsgb3BzOiBbb2JqZWN0XSB9KSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlID09PSBQb3N0Z3Jlc1VuaXF1ZUluZGV4VmlvbGF0aW9uRXJyb3IpIHtcbiAgICAgICAgICBjb25zdCBlcnIgPSBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUUsXG4gICAgICAgICAgICAnQSBkdXBsaWNhdGUgdmFsdWUgZm9yIGEgZmllbGQgd2l0aCB1bmlxdWUgdmFsdWVzIHdhcyBwcm92aWRlZCdcbiAgICAgICAgICApO1xuICAgICAgICAgIGVyci51bmRlcmx5aW5nRXJyb3IgPSBlcnJvcjtcbiAgICAgICAgICBpZiAoZXJyb3IuY29uc3RyYWludCkge1xuICAgICAgICAgICAgY29uc3QgbWF0Y2hlcyA9IGVycm9yLmNvbnN0cmFpbnQubWF0Y2goL3VuaXF1ZV8oW2EtekEtWl0rKS8pO1xuICAgICAgICAgICAgaWYgKG1hdGNoZXMgJiYgQXJyYXkuaXNBcnJheShtYXRjaGVzKSkge1xuICAgICAgICAgICAgICBlcnIudXNlckluZm8gPSB7IGR1cGxpY2F0ZWRfZmllbGQ6IG1hdGNoZXNbMV0gfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgZXJyb3IgPSBlcnI7XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9KTtcbiAgfVxuXG4gIC8vIFJlbW92ZSBhbGwgb2JqZWN0cyB0aGF0IG1hdGNoIHRoZSBnaXZlbiBQYXJzZSBRdWVyeS5cbiAgLy8gSWYgbm8gb2JqZWN0cyBtYXRjaCwgcmVqZWN0IHdpdGggT0JKRUNUX05PVF9GT1VORC4gSWYgb2JqZWN0cyBhcmUgZm91bmQgYW5kIGRlbGV0ZWQsIHJlc29sdmUgd2l0aCB1bmRlZmluZWQuXG4gIC8vIElmIHRoZXJlIGlzIHNvbWUgb3RoZXIgZXJyb3IsIHJlamVjdCB3aXRoIElOVEVSTkFMX1NFUlZFUl9FUlJPUi5cbiAgZGVsZXRlT2JqZWN0c0J5UXVlcnkoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgc2NoZW1hOiBTY2hlbWFUeXBlLFxuICAgIHF1ZXJ5OiBRdWVyeVR5cGVcbiAgKSB7XG4gICAgZGVidWcoJ2RlbGV0ZU9iamVjdHNCeVF1ZXJ5JywgY2xhc3NOYW1lLCBxdWVyeSk7XG4gICAgY29uc3QgdmFsdWVzID0gW2NsYXNzTmFtZV07XG4gICAgY29uc3QgaW5kZXggPSAyO1xuICAgIGNvbnN0IHdoZXJlID0gYnVpbGRXaGVyZUNsYXVzZSh7IHNjaGVtYSwgaW5kZXgsIHF1ZXJ5IH0pO1xuICAgIHZhbHVlcy5wdXNoKC4uLndoZXJlLnZhbHVlcyk7XG4gICAgaWYgKE9iamVjdC5rZXlzKHF1ZXJ5KS5sZW5ndGggPT09IDApIHtcbiAgICAgIHdoZXJlLnBhdHRlcm4gPSAnVFJVRSc7XG4gICAgfVxuICAgIGNvbnN0IHFzID0gYFdJVEggZGVsZXRlZCBBUyAoREVMRVRFIEZST00gJDE6bmFtZSBXSEVSRSAke1xuICAgICAgd2hlcmUucGF0dGVyblxuICAgIH0gUkVUVVJOSU5HICopIFNFTEVDVCBjb3VudCgqKSBGUk9NIGRlbGV0ZWRgO1xuICAgIGRlYnVnKHFzLCB2YWx1ZXMpO1xuICAgIHJldHVybiB0aGlzLl9jbGllbnRcbiAgICAgIC5vbmUocXMsIHZhbHVlcywgYSA9PiArYS5jb3VudClcbiAgICAgIC50aGVuKGNvdW50ID0+IHtcbiAgICAgICAgaWYgKGNvdW50ID09PSAwKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCxcbiAgICAgICAgICAgICdPYmplY3Qgbm90IGZvdW5kLidcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiBjb3VudDtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlICE9PSBQb3N0Z3Jlc1JlbGF0aW9uRG9lc05vdEV4aXN0RXJyb3IpIHtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgICAvLyBFTFNFOiBEb24ndCBkZWxldGUgYW55dGhpbmcgaWYgZG9lc24ndCBleGlzdFxuICAgICAgfSk7XG4gIH1cbiAgLy8gUmV0dXJuIHZhbHVlIG5vdCBjdXJyZW50bHkgd2VsbCBzcGVjaWZpZWQuXG4gIGZpbmRPbmVBbmRVcGRhdGUoXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gICAgc2NoZW1hOiBTY2hlbWFUeXBlLFxuICAgIHF1ZXJ5OiBRdWVyeVR5cGUsXG4gICAgdXBkYXRlOiBhbnlcbiAgKTogUHJvbWlzZTxhbnk+IHtcbiAgICBkZWJ1ZygnZmluZE9uZUFuZFVwZGF0ZScsIGNsYXNzTmFtZSwgcXVlcnksIHVwZGF0ZSk7XG4gICAgcmV0dXJuIHRoaXMudXBkYXRlT2JqZWN0c0J5UXVlcnkoY2xhc3NOYW1lLCBzY2hlbWEsIHF1ZXJ5LCB1cGRhdGUpLnRoZW4oXG4gICAgICB2YWwgPT4gdmFsWzBdXG4gICAgKTtcbiAgfVxuXG4gIC8vIEFwcGx5IHRoZSB1cGRhdGUgdG8gYWxsIG9iamVjdHMgdGhhdCBtYXRjaCB0aGUgZ2l2ZW4gUGFyc2UgUXVlcnkuXG4gIHVwZGF0ZU9iamVjdHNCeVF1ZXJ5KFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIHNjaGVtYTogU2NoZW1hVHlwZSxcbiAgICBxdWVyeTogUXVlcnlUeXBlLFxuICAgIHVwZGF0ZTogYW55XG4gICk6IFByb21pc2U8W2FueV0+IHtcbiAgICBkZWJ1ZygndXBkYXRlT2JqZWN0c0J5UXVlcnknLCBjbGFzc05hbWUsIHF1ZXJ5LCB1cGRhdGUpO1xuICAgIGNvbnN0IHVwZGF0ZVBhdHRlcm5zID0gW107XG4gICAgY29uc3QgdmFsdWVzID0gW2NsYXNzTmFtZV07XG4gICAgbGV0IGluZGV4ID0gMjtcbiAgICBzY2hlbWEgPSB0b1Bvc3RncmVzU2NoZW1hKHNjaGVtYSk7XG5cbiAgICBjb25zdCBvcmlnaW5hbFVwZGF0ZSA9IHsgLi4udXBkYXRlIH07XG4gICAgdXBkYXRlID0gaGFuZGxlRG90RmllbGRzKHVwZGF0ZSk7XG4gICAgLy8gUmVzb2x2ZSBhdXRoRGF0YSBmaXJzdCxcbiAgICAvLyBTbyB3ZSBkb24ndCBlbmQgdXAgd2l0aCBtdWx0aXBsZSBrZXkgdXBkYXRlc1xuICAgIGZvciAoY29uc3QgZmllbGROYW1lIGluIHVwZGF0ZSkge1xuICAgICAgY29uc3QgYXV0aERhdGFNYXRjaCA9IGZpZWxkTmFtZS5tYXRjaCgvXl9hdXRoX2RhdGFfKFthLXpBLVowLTlfXSspJC8pO1xuICAgICAgaWYgKGF1dGhEYXRhTWF0Y2gpIHtcbiAgICAgICAgdmFyIHByb3ZpZGVyID0gYXV0aERhdGFNYXRjaFsxXTtcbiAgICAgICAgY29uc3QgdmFsdWUgPSB1cGRhdGVbZmllbGROYW1lXTtcbiAgICAgICAgZGVsZXRlIHVwZGF0ZVtmaWVsZE5hbWVdO1xuICAgICAgICB1cGRhdGVbJ2F1dGhEYXRhJ10gPSB1cGRhdGVbJ2F1dGhEYXRhJ10gfHwge307XG4gICAgICAgIHVwZGF0ZVsnYXV0aERhdGEnXVtwcm92aWRlcl0gPSB2YWx1ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGZpZWxkTmFtZSBpbiB1cGRhdGUpIHtcbiAgICAgIGNvbnN0IGZpZWxkVmFsdWUgPSB1cGRhdGVbZmllbGROYW1lXTtcbiAgICAgIC8vIERyb3AgYW55IHVuZGVmaW5lZCB2YWx1ZXMuXG4gICAgICBpZiAodHlwZW9mIGZpZWxkVmFsdWUgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIGRlbGV0ZSB1cGRhdGVbZmllbGROYW1lXTtcbiAgICAgIH0gZWxzZSBpZiAoZmllbGRWYWx1ZSA9PT0gbnVsbCkge1xuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9IE5VTExgKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lKTtcbiAgICAgICAgaW5kZXggKz0gMTtcbiAgICAgIH0gZWxzZSBpZiAoZmllbGROYW1lID09ICdhdXRoRGF0YScpIHtcbiAgICAgICAgLy8gVGhpcyByZWN1cnNpdmVseSBzZXRzIHRoZSBqc29uX29iamVjdFxuICAgICAgICAvLyBPbmx5IDEgbGV2ZWwgZGVlcFxuICAgICAgICBjb25zdCBnZW5lcmF0ZSA9IChqc29uYjogc3RyaW5nLCBrZXk6IHN0cmluZywgdmFsdWU6IGFueSkgPT4ge1xuICAgICAgICAgIHJldHVybiBganNvbl9vYmplY3Rfc2V0X2tleShDT0FMRVNDRSgke2pzb25ifSwgJ3t9Jzo6anNvbmIpLCAke2tleX0sICR7dmFsdWV9KTo6anNvbmJgO1xuICAgICAgICB9O1xuICAgICAgICBjb25zdCBsYXN0S2V5ID0gYCQke2luZGV4fTpuYW1lYDtcbiAgICAgICAgY29uc3QgZmllbGROYW1lSW5kZXggPSBpbmRleDtcbiAgICAgICAgaW5kZXggKz0gMTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lKTtcbiAgICAgICAgY29uc3QgdXBkYXRlID0gT2JqZWN0LmtleXMoZmllbGRWYWx1ZSkucmVkdWNlKFxuICAgICAgICAgIChsYXN0S2V5OiBzdHJpbmcsIGtleTogc3RyaW5nKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBzdHIgPSBnZW5lcmF0ZShcbiAgICAgICAgICAgICAgbGFzdEtleSxcbiAgICAgICAgICAgICAgYCQke2luZGV4fTo6dGV4dGAsXG4gICAgICAgICAgICAgIGAkJHtpbmRleCArIDF9Ojpqc29uYmBcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBpbmRleCArPSAyO1xuICAgICAgICAgICAgbGV0IHZhbHVlID0gZmllbGRWYWx1ZVtrZXldO1xuICAgICAgICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgICAgICAgIGlmICh2YWx1ZS5fX29wID09PSAnRGVsZXRlJykge1xuICAgICAgICAgICAgICAgIHZhbHVlID0gbnVsbDtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB2YWx1ZSA9IEpTT04uc3RyaW5naWZ5KHZhbHVlKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmFsdWVzLnB1c2goa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICByZXR1cm4gc3RyO1xuICAgICAgICAgIH0sXG4gICAgICAgICAgbGFzdEtleVxuICAgICAgICApO1xuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtmaWVsZE5hbWVJbmRleH06bmFtZSA9ICR7dXBkYXRlfWApO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLl9fb3AgPT09ICdJbmNyZW1lbnQnKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goXG4gICAgICAgICAgYCQke2luZGV4fTpuYW1lID0gQ09BTEVTQ0UoJCR7aW5kZXh9Om5hbWUsIDApICsgJCR7aW5kZXggKyAxfWBcbiAgICAgICAgKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlLmFtb3VudCk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUuX19vcCA9PT0gJ0FkZCcpIHtcbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChcbiAgICAgICAgICBgJCR7aW5kZXh9Om5hbWUgPSBhcnJheV9hZGQoQ09BTEVTQ0UoJCR7aW5kZXh9Om5hbWUsICdbXSc6Ompzb25iKSwgJCR7aW5kZXggK1xuICAgICAgICAgICAgMX06Ompzb25iKWBcbiAgICAgICAgKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBKU09OLnN0cmluZ2lmeShmaWVsZFZhbHVlLm9iamVjdHMpKTtcbiAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgIH0gZWxzZSBpZiAoZmllbGRWYWx1ZS5fX29wID09PSAnRGVsZXRlJykge1xuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX1gKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBudWxsKTtcbiAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgIH0gZWxzZSBpZiAoZmllbGRWYWx1ZS5fX29wID09PSAnUmVtb3ZlJykge1xuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKFxuICAgICAgICAgIGAkJHtpbmRleH06bmFtZSA9IGFycmF5X3JlbW92ZShDT0FMRVNDRSgkJHtpbmRleH06bmFtZSwgJ1tdJzo6anNvbmIpLCAkJHtpbmRleCArXG4gICAgICAgICAgICAxfTo6anNvbmIpYFxuICAgICAgICApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIEpTT04uc3RyaW5naWZ5KGZpZWxkVmFsdWUub2JqZWN0cykpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLl9fb3AgPT09ICdBZGRVbmlxdWUnKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goXG4gICAgICAgICAgYCQke2luZGV4fTpuYW1lID0gYXJyYXlfYWRkX3VuaXF1ZShDT0FMRVNDRSgkJHtpbmRleH06bmFtZSwgJ1tdJzo6anNvbmIpLCAkJHtpbmRleCArXG4gICAgICAgICAgICAxfTo6anNvbmIpYFxuICAgICAgICApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIEpTT04uc3RyaW5naWZ5KGZpZWxkVmFsdWUub2JqZWN0cykpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZE5hbWUgPT09ICd1cGRhdGVkQXQnKSB7XG4gICAgICAgIC8vVE9ETzogc3RvcCBzcGVjaWFsIGNhc2luZyB0aGlzLiBJdCBzaG91bGQgY2hlY2sgZm9yIF9fdHlwZSA9PT0gJ0RhdGUnIGFuZCB1c2UgLmlzb1xuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX1gKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlKTtcbiAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGZpZWxkVmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmICh0eXBlb2YgZmllbGRWYWx1ZSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLl9fdHlwZSA9PT0gJ1BvaW50ZXInKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUub2JqZWN0SWQpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLl9fdHlwZSA9PT0gJ0RhdGUnKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIHRvUG9zdGdyZXNWYWx1ZShmaWVsZFZhbHVlKSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLl9fdHlwZSA9PT0gJ0ZpbGUnKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIHRvUG9zdGdyZXNWYWx1ZShmaWVsZFZhbHVlKSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUuX190eXBlID09PSAnR2VvUG9pbnQnKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goXG4gICAgICAgICAgYCQke2luZGV4fTpuYW1lID0gUE9JTlQoJCR7aW5kZXggKyAxfSwgJCR7aW5kZXggKyAyfSlgXG4gICAgICAgICk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZS5sb25naXR1ZGUsIGZpZWxkVmFsdWUubGF0aXR1ZGUpO1xuICAgICAgICBpbmRleCArPSAzO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLl9fdHlwZSA9PT0gJ1BvbHlnb24nKSB7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gY29udmVydFBvbHlnb25Ub1NRTChmaWVsZFZhbHVlLmNvb3JkaW5hdGVzKTtcbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9Ojpwb2x5Z29uYCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgdmFsdWUpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLl9fdHlwZSA9PT0gJ1JlbGF0aW9uJykge1xuICAgICAgICAvLyBub29wXG4gICAgICB9IGVsc2UgaWYgKHR5cGVvZiBmaWVsZFZhbHVlID09PSAnbnVtYmVyJykge1xuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX1gKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlKTtcbiAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgIH0gZWxzZSBpZiAoXG4gICAgICAgIHR5cGVvZiBmaWVsZFZhbHVlID09PSAnb2JqZWN0JyAmJlxuICAgICAgICBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0gJiZcbiAgICAgICAgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdPYmplY3QnXG4gICAgICApIHtcbiAgICAgICAgLy8gR2F0aGVyIGtleXMgdG8gaW5jcmVtZW50XG4gICAgICAgIGNvbnN0IGtleXNUb0luY3JlbWVudCA9IE9iamVjdC5rZXlzKG9yaWdpbmFsVXBkYXRlKVxuICAgICAgICAgIC5maWx0ZXIoayA9PiB7XG4gICAgICAgICAgICAvLyBjaG9vc2UgdG9wIGxldmVsIGZpZWxkcyB0aGF0IGhhdmUgYSBkZWxldGUgb3BlcmF0aW9uIHNldFxuICAgICAgICAgICAgLy8gTm90ZSB0aGF0IE9iamVjdC5rZXlzIGlzIGl0ZXJhdGluZyBvdmVyIHRoZSAqKm9yaWdpbmFsKiogdXBkYXRlIG9iamVjdFxuICAgICAgICAgICAgLy8gYW5kIHRoYXQgc29tZSBvZiB0aGUga2V5cyBvZiB0aGUgb3JpZ2luYWwgdXBkYXRlIGNvdWxkIGJlIG51bGwgb3IgdW5kZWZpbmVkOlxuICAgICAgICAgICAgLy8gKFNlZSB0aGUgYWJvdmUgY2hlY2sgYGlmIChmaWVsZFZhbHVlID09PSBudWxsIHx8IHR5cGVvZiBmaWVsZFZhbHVlID09IFwidW5kZWZpbmVkXCIpYClcbiAgICAgICAgICAgIGNvbnN0IHZhbHVlID0gb3JpZ2luYWxVcGRhdGVba107XG4gICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICB2YWx1ZSAmJlxuICAgICAgICAgICAgICB2YWx1ZS5fX29wID09PSAnSW5jcmVtZW50JyAmJlxuICAgICAgICAgICAgICBrLnNwbGl0KCcuJykubGVuZ3RoID09PSAyICYmXG4gICAgICAgICAgICAgIGsuc3BsaXQoJy4nKVswXSA9PT0gZmllbGROYW1lXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLm1hcChrID0+IGsuc3BsaXQoJy4nKVsxXSk7XG5cbiAgICAgICAgbGV0IGluY3JlbWVudFBhdHRlcm5zID0gJyc7XG4gICAgICAgIGlmIChrZXlzVG9JbmNyZW1lbnQubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGluY3JlbWVudFBhdHRlcm5zID1cbiAgICAgICAgICAgICcgfHwgJyArXG4gICAgICAgICAgICBrZXlzVG9JbmNyZW1lbnRcbiAgICAgICAgICAgICAgLm1hcChjID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBhbW91bnQgPSBmaWVsZFZhbHVlW2NdLmFtb3VudDtcbiAgICAgICAgICAgICAgICByZXR1cm4gYENPTkNBVCgne1wiJHtjfVwiOicsIENPQUxFU0NFKCQke2luZGV4fTpuYW1lLT4+JyR7Y30nLCcwJyk6OmludCArICR7YW1vdW50fSwgJ30nKTo6anNvbmJgO1xuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAuam9pbignIHx8ICcpO1xuICAgICAgICAgIC8vIFN0cmlwIHRoZSBrZXlzXG4gICAgICAgICAga2V5c1RvSW5jcmVtZW50LmZvckVhY2goa2V5ID0+IHtcbiAgICAgICAgICAgIGRlbGV0ZSBmaWVsZFZhbHVlW2tleV07XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBrZXlzVG9EZWxldGU6IEFycmF5PHN0cmluZz4gPSBPYmplY3Qua2V5cyhvcmlnaW5hbFVwZGF0ZSlcbiAgICAgICAgICAuZmlsdGVyKGsgPT4ge1xuICAgICAgICAgICAgLy8gY2hvb3NlIHRvcCBsZXZlbCBmaWVsZHMgdGhhdCBoYXZlIGEgZGVsZXRlIG9wZXJhdGlvbiBzZXQuXG4gICAgICAgICAgICBjb25zdCB2YWx1ZSA9IG9yaWdpbmFsVXBkYXRlW2tdO1xuICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgdmFsdWUgJiZcbiAgICAgICAgICAgICAgdmFsdWUuX19vcCA9PT0gJ0RlbGV0ZScgJiZcbiAgICAgICAgICAgICAgay5zcGxpdCgnLicpLmxlbmd0aCA9PT0gMiAmJlxuICAgICAgICAgICAgICBrLnNwbGl0KCcuJylbMF0gPT09IGZpZWxkTmFtZVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5tYXAoayA9PiBrLnNwbGl0KCcuJylbMV0pO1xuXG4gICAgICAgIGNvbnN0IGRlbGV0ZVBhdHRlcm5zID0ga2V5c1RvRGVsZXRlLnJlZHVjZShcbiAgICAgICAgICAocDogc3RyaW5nLCBjOiBzdHJpbmcsIGk6IG51bWJlcikgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHAgKyBgIC0gJyQke2luZGV4ICsgMSArIGl9OnZhbHVlJ2A7XG4gICAgICAgICAgfSxcbiAgICAgICAgICAnJ1xuICAgICAgICApO1xuXG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goXG4gICAgICAgICAgYCQke2luZGV4fTpuYW1lID0gKCd7fSc6Ompzb25iICR7ZGVsZXRlUGF0dGVybnN9ICR7aW5jcmVtZW50UGF0dGVybnN9IHx8ICQke2luZGV4ICtcbiAgICAgICAgICAgIDEgK1xuICAgICAgICAgICAga2V5c1RvRGVsZXRlLmxlbmd0aH06Ompzb25iIClgXG4gICAgICAgICk7XG5cbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCAuLi5rZXlzVG9EZWxldGUsIEpTT04uc3RyaW5naWZ5KGZpZWxkVmFsdWUpKTtcbiAgICAgICAgaW5kZXggKz0gMiArIGtleXNUb0RlbGV0ZS5sZW5ndGg7XG4gICAgICB9IGVsc2UgaWYgKFxuICAgICAgICBBcnJheS5pc0FycmF5KGZpZWxkVmFsdWUpICYmXG4gICAgICAgIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXSAmJlxuICAgICAgICBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ0FycmF5J1xuICAgICAgKSB7XG4gICAgICAgIGNvbnN0IGV4cGVjdGVkVHlwZSA9IHBhcnNlVHlwZVRvUG9zdGdyZXNUeXBlKHNjaGVtYS5maWVsZHNbZmllbGROYW1lXSk7XG4gICAgICAgIGlmIChleHBlY3RlZFR5cGUgPT09ICd0ZXh0W10nKSB7XG4gICAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9Ojp0ZXh0W11gKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBsZXQgdHlwZSA9ICd0ZXh0JztcbiAgICAgICAgICBmb3IgKGNvbnN0IGVsdCBvZiBmaWVsZFZhbHVlKSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIGVsdCA9PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgICB0eXBlID0gJ2pzb24nO1xuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChcbiAgICAgICAgICAgIGAkJHtpbmRleH06bmFtZSA9IGFycmF5X3RvX2pzb24oJCR7aW5kZXggKyAxfTo6JHt0eXBlfVtdKTo6anNvbmJgXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZGVidWcoJ05vdCBzdXBwb3J0ZWQgdXBkYXRlJywgZmllbGROYW1lLCBmaWVsZFZhbHVlKTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KFxuICAgICAgICAgIG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLk9QRVJBVElPTl9GT1JCSURERU4sXG4gICAgICAgICAgICBgUG9zdGdyZXMgZG9lc24ndCBzdXBwb3J0IHVwZGF0ZSAke0pTT04uc3RyaW5naWZ5KGZpZWxkVmFsdWUpfSB5ZXRgXG4gICAgICAgICAgKVxuICAgICAgICApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHdoZXJlID0gYnVpbGRXaGVyZUNsYXVzZSh7IHNjaGVtYSwgaW5kZXgsIHF1ZXJ5IH0pO1xuICAgIHZhbHVlcy5wdXNoKC4uLndoZXJlLnZhbHVlcyk7XG5cbiAgICBjb25zdCB3aGVyZUNsYXVzZSA9XG4gICAgICB3aGVyZS5wYXR0ZXJuLmxlbmd0aCA+IDAgPyBgV0hFUkUgJHt3aGVyZS5wYXR0ZXJufWAgOiAnJztcbiAgICBjb25zdCBxcyA9IGBVUERBVEUgJDE6bmFtZSBTRVQgJHt1cGRhdGVQYXR0ZXJucy5qb2luKCl9ICR7d2hlcmVDbGF1c2V9IFJFVFVSTklORyAqYDtcbiAgICBkZWJ1ZygndXBkYXRlOiAnLCBxcywgdmFsdWVzKTtcbiAgICByZXR1cm4gdGhpcy5fY2xpZW50LmFueShxcywgdmFsdWVzKTtcbiAgfVxuXG4gIC8vIEhvcGVmdWxseSwgd2UgY2FuIGdldCByaWQgb2YgdGhpcy4gSXQncyBvbmx5IHVzZWQgZm9yIGNvbmZpZyBhbmQgaG9va3MuXG4gIHVwc2VydE9uZU9iamVjdChcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBzY2hlbWE6IFNjaGVtYVR5cGUsXG4gICAgcXVlcnk6IFF1ZXJ5VHlwZSxcbiAgICB1cGRhdGU6IGFueVxuICApIHtcbiAgICBkZWJ1ZygndXBzZXJ0T25lT2JqZWN0JywgeyBjbGFzc05hbWUsIHF1ZXJ5LCB1cGRhdGUgfSk7XG4gICAgY29uc3QgY3JlYXRlVmFsdWUgPSBPYmplY3QuYXNzaWduKHt9LCBxdWVyeSwgdXBkYXRlKTtcbiAgICByZXR1cm4gdGhpcy5jcmVhdGVPYmplY3QoY2xhc3NOYW1lLCBzY2hlbWEsIGNyZWF0ZVZhbHVlKS5jYXRjaChlcnJvciA9PiB7XG4gICAgICAvLyBpZ25vcmUgZHVwbGljYXRlIHZhbHVlIGVycm9ycyBhcyBpdCdzIHVwc2VydFxuICAgICAgaWYgKGVycm9yLmNvZGUgIT09IFBhcnNlLkVycm9yLkRVUExJQ0FURV9WQUxVRSkge1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0aGlzLmZpbmRPbmVBbmRVcGRhdGUoY2xhc3NOYW1lLCBzY2hlbWEsIHF1ZXJ5LCB1cGRhdGUpO1xuICAgIH0pO1xuICB9XG5cbiAgZmluZChcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBzY2hlbWE6IFNjaGVtYVR5cGUsXG4gICAgcXVlcnk6IFF1ZXJ5VHlwZSxcbiAgICB7IHNraXAsIGxpbWl0LCBzb3J0LCBrZXlzIH06IFF1ZXJ5T3B0aW9uc1xuICApIHtcbiAgICBkZWJ1ZygnZmluZCcsIGNsYXNzTmFtZSwgcXVlcnksIHsgc2tpcCwgbGltaXQsIHNvcnQsIGtleXMgfSk7XG4gICAgY29uc3QgaGFzTGltaXQgPSBsaW1pdCAhPT0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGhhc1NraXAgPSBza2lwICE9PSB1bmRlZmluZWQ7XG4gICAgbGV0IHZhbHVlcyA9IFtjbGFzc05hbWVdO1xuICAgIGNvbnN0IHdoZXJlID0gYnVpbGRXaGVyZUNsYXVzZSh7IHNjaGVtYSwgcXVlcnksIGluZGV4OiAyIH0pO1xuICAgIHZhbHVlcy5wdXNoKC4uLndoZXJlLnZhbHVlcyk7XG5cbiAgICBjb25zdCB3aGVyZVBhdHRlcm4gPVxuICAgICAgd2hlcmUucGF0dGVybi5sZW5ndGggPiAwID8gYFdIRVJFICR7d2hlcmUucGF0dGVybn1gIDogJyc7XG4gICAgY29uc3QgbGltaXRQYXR0ZXJuID0gaGFzTGltaXQgPyBgTElNSVQgJCR7dmFsdWVzLmxlbmd0aCArIDF9YCA6ICcnO1xuICAgIGlmIChoYXNMaW1pdCkge1xuICAgICAgdmFsdWVzLnB1c2gobGltaXQpO1xuICAgIH1cbiAgICBjb25zdCBza2lwUGF0dGVybiA9IGhhc1NraXAgPyBgT0ZGU0VUICQke3ZhbHVlcy5sZW5ndGggKyAxfWAgOiAnJztcbiAgICBpZiAoaGFzU2tpcCkge1xuICAgICAgdmFsdWVzLnB1c2goc2tpcCk7XG4gICAgfVxuXG4gICAgbGV0IHNvcnRQYXR0ZXJuID0gJyc7XG4gICAgaWYgKHNvcnQpIHtcbiAgICAgIGNvbnN0IHNvcnRDb3B5OiBhbnkgPSBzb3J0O1xuICAgICAgY29uc3Qgc29ydGluZyA9IE9iamVjdC5rZXlzKHNvcnQpXG4gICAgICAgIC5tYXAoa2V5ID0+IHtcbiAgICAgICAgICBjb25zdCB0cmFuc2Zvcm1LZXkgPSB0cmFuc2Zvcm1Eb3RGaWVsZFRvQ29tcG9uZW50cyhrZXkpLmpvaW4oJy0+Jyk7XG4gICAgICAgICAgLy8gVXNpbmcgJGlkeCBwYXR0ZXJuIGdpdmVzOiAgbm9uLWludGVnZXIgY29uc3RhbnQgaW4gT1JERVIgQllcbiAgICAgICAgICBpZiAoc29ydENvcHlba2V5XSA9PT0gMSkge1xuICAgICAgICAgICAgcmV0dXJuIGAke3RyYW5zZm9ybUtleX0gQVNDYDtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIGAke3RyYW5zZm9ybUtleX0gREVTQ2A7XG4gICAgICAgIH0pXG4gICAgICAgIC5qb2luKCk7XG4gICAgICBzb3J0UGF0dGVybiA9XG4gICAgICAgIHNvcnQgIT09IHVuZGVmaW5lZCAmJiBPYmplY3Qua2V5cyhzb3J0KS5sZW5ndGggPiAwXG4gICAgICAgICAgPyBgT1JERVIgQlkgJHtzb3J0aW5nfWBcbiAgICAgICAgICA6ICcnO1xuICAgIH1cbiAgICBpZiAod2hlcmUuc29ydHMgJiYgT2JqZWN0LmtleXMoKHdoZXJlLnNvcnRzOiBhbnkpKS5sZW5ndGggPiAwKSB7XG4gICAgICBzb3J0UGF0dGVybiA9IGBPUkRFUiBCWSAke3doZXJlLnNvcnRzLmpvaW4oKX1gO1xuICAgIH1cblxuICAgIGxldCBjb2x1bW5zID0gJyonO1xuICAgIGlmIChrZXlzKSB7XG4gICAgICAvLyBFeGNsdWRlIGVtcHR5IGtleXNcbiAgICAgIC8vIFJlcGxhY2UgQUNMIGJ5IGl0J3Mga2V5c1xuICAgICAga2V5cyA9IGtleXMucmVkdWNlKChtZW1vLCBrZXkpID0+IHtcbiAgICAgICAgaWYgKGtleSA9PT0gJ0FDTCcpIHtcbiAgICAgICAgICBtZW1vLnB1c2goJ19ycGVybScpO1xuICAgICAgICAgIG1lbW8ucHVzaCgnX3dwZXJtJyk7XG4gICAgICAgIH0gZWxzZSBpZiAoa2V5Lmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBtZW1vLnB1c2goa2V5KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbWVtbztcbiAgICAgIH0sIFtdKTtcbiAgICAgIGNvbHVtbnMgPSBrZXlzXG4gICAgICAgIC5tYXAoKGtleSwgaW5kZXgpID0+IHtcbiAgICAgICAgICBpZiAoa2V5ID09PSAnJHNjb3JlJykge1xuICAgICAgICAgICAgcmV0dXJuIGB0c19yYW5rX2NkKHRvX3RzdmVjdG9yKCQkezJ9LCAkJHszfTpuYW1lKSwgdG9fdHNxdWVyeSgkJHs0fSwgJCR7NX0pLCAzMikgYXMgc2NvcmVgO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gYCQke2luZGV4ICsgdmFsdWVzLmxlbmd0aCArIDF9Om5hbWVgO1xuICAgICAgICB9KVxuICAgICAgICAuam9pbigpO1xuICAgICAgdmFsdWVzID0gdmFsdWVzLmNvbmNhdChrZXlzKTtcbiAgICB9XG5cbiAgICBjb25zdCBxcyA9IGBTRUxFQ1QgJHtjb2x1bW5zfSBGUk9NICQxOm5hbWUgJHt3aGVyZVBhdHRlcm59ICR7c29ydFBhdHRlcm59ICR7bGltaXRQYXR0ZXJufSAke3NraXBQYXR0ZXJufWA7XG4gICAgZGVidWcocXMsIHZhbHVlcyk7XG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudFxuICAgICAgLmFueShxcywgdmFsdWVzKVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgLy8gUXVlcnkgb24gbm9uIGV4aXN0aW5nIHRhYmxlLCBkb24ndCBjcmFzaFxuICAgICAgICBpZiAoZXJyb3IuY29kZSAhPT0gUG9zdGdyZXNSZWxhdGlvbkRvZXNOb3RFeGlzdEVycm9yKSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfSlcbiAgICAgIC50aGVuKHJlc3VsdHMgPT5cbiAgICAgICAgcmVzdWx0cy5tYXAob2JqZWN0ID0+XG4gICAgICAgICAgdGhpcy5wb3N0Z3Jlc09iamVjdFRvUGFyc2VPYmplY3QoY2xhc3NOYW1lLCBvYmplY3QsIHNjaGVtYSlcbiAgICAgICAgKVxuICAgICAgKTtcbiAgfVxuXG4gIC8vIENvbnZlcnRzIGZyb20gYSBwb3N0Z3Jlcy1mb3JtYXQgb2JqZWN0IHRvIGEgUkVTVC1mb3JtYXQgb2JqZWN0LlxuICAvLyBEb2VzIG5vdCBzdHJpcCBvdXQgYW55dGhpbmcgYmFzZWQgb24gYSBsYWNrIG9mIGF1dGhlbnRpY2F0aW9uLlxuICBwb3N0Z3Jlc09iamVjdFRvUGFyc2VPYmplY3QoY2xhc3NOYW1lOiBzdHJpbmcsIG9iamVjdDogYW55LCBzY2hlbWE6IGFueSkge1xuICAgIE9iamVjdC5rZXlzKHNjaGVtYS5maWVsZHMpLmZvckVhY2goZmllbGROYW1lID0+IHtcbiAgICAgIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ1BvaW50ZXInICYmIG9iamVjdFtmaWVsZE5hbWVdKSB7XG4gICAgICAgIG9iamVjdFtmaWVsZE5hbWVdID0ge1xuICAgICAgICAgIG9iamVjdElkOiBvYmplY3RbZmllbGROYW1lXSxcbiAgICAgICAgICBfX3R5cGU6ICdQb2ludGVyJyxcbiAgICAgICAgICBjbGFzc05hbWU6IHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50YXJnZXRDbGFzcyxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ1JlbGF0aW9uJykge1xuICAgICAgICBvYmplY3RbZmllbGROYW1lXSA9IHtcbiAgICAgICAgICBfX3R5cGU6ICdSZWxhdGlvbicsXG4gICAgICAgICAgY2xhc3NOYW1lOiBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udGFyZ2V0Q2xhc3MsXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICBpZiAob2JqZWN0W2ZpZWxkTmFtZV0gJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdHZW9Qb2ludCcpIHtcbiAgICAgICAgb2JqZWN0W2ZpZWxkTmFtZV0gPSB7XG4gICAgICAgICAgX190eXBlOiAnR2VvUG9pbnQnLFxuICAgICAgICAgIGxhdGl0dWRlOiBvYmplY3RbZmllbGROYW1lXS55LFxuICAgICAgICAgIGxvbmdpdHVkZTogb2JqZWN0W2ZpZWxkTmFtZV0ueCxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGlmIChvYmplY3RbZmllbGROYW1lXSAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ1BvbHlnb24nKSB7XG4gICAgICAgIGxldCBjb29yZHMgPSBvYmplY3RbZmllbGROYW1lXTtcbiAgICAgICAgY29vcmRzID0gY29vcmRzLnN1YnN0cigyLCBjb29yZHMubGVuZ3RoIC0gNCkuc3BsaXQoJyksKCcpO1xuICAgICAgICBjb29yZHMgPSBjb29yZHMubWFwKHBvaW50ID0+IHtcbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgcGFyc2VGbG9hdChwb2ludC5zcGxpdCgnLCcpWzFdKSxcbiAgICAgICAgICAgIHBhcnNlRmxvYXQocG9pbnQuc3BsaXQoJywnKVswXSksXG4gICAgICAgICAgXTtcbiAgICAgICAgfSk7XG4gICAgICAgIG9iamVjdFtmaWVsZE5hbWVdID0ge1xuICAgICAgICAgIF9fdHlwZTogJ1BvbHlnb24nLFxuICAgICAgICAgIGNvb3JkaW5hdGVzOiBjb29yZHMsXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICBpZiAob2JqZWN0W2ZpZWxkTmFtZV0gJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdGaWxlJykge1xuICAgICAgICBvYmplY3RbZmllbGROYW1lXSA9IHtcbiAgICAgICAgICBfX3R5cGU6ICdGaWxlJyxcbiAgICAgICAgICBuYW1lOiBvYmplY3RbZmllbGROYW1lXSxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICAvL1RPRE86IHJlbW92ZSB0aGlzIHJlbGlhbmNlIG9uIHRoZSBtb25nbyBmb3JtYXQuIERCIGFkYXB0ZXIgc2hvdWxkbid0IGtub3cgdGhlcmUgaXMgYSBkaWZmZXJlbmNlIGJldHdlZW4gY3JlYXRlZCBhdCBhbmQgYW55IG90aGVyIGRhdGUgZmllbGQuXG4gICAgaWYgKG9iamVjdC5jcmVhdGVkQXQpIHtcbiAgICAgIG9iamVjdC5jcmVhdGVkQXQgPSBvYmplY3QuY3JlYXRlZEF0LnRvSVNPU3RyaW5nKCk7XG4gICAgfVxuICAgIGlmIChvYmplY3QudXBkYXRlZEF0KSB7XG4gICAgICBvYmplY3QudXBkYXRlZEF0ID0gb2JqZWN0LnVwZGF0ZWRBdC50b0lTT1N0cmluZygpO1xuICAgIH1cbiAgICBpZiAob2JqZWN0LmV4cGlyZXNBdCkge1xuICAgICAgb2JqZWN0LmV4cGlyZXNBdCA9IHtcbiAgICAgICAgX190eXBlOiAnRGF0ZScsXG4gICAgICAgIGlzbzogb2JqZWN0LmV4cGlyZXNBdC50b0lTT1N0cmluZygpLFxuICAgICAgfTtcbiAgICB9XG4gICAgaWYgKG9iamVjdC5fZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQpIHtcbiAgICAgIG9iamVjdC5fZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQgPSB7XG4gICAgICAgIF9fdHlwZTogJ0RhdGUnLFxuICAgICAgICBpc286IG9iamVjdC5fZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQudG9JU09TdHJpbmcoKSxcbiAgICAgIH07XG4gICAgfVxuICAgIGlmIChvYmplY3QuX2FjY291bnRfbG9ja291dF9leHBpcmVzX2F0KSB7XG4gICAgICBvYmplY3QuX2FjY291bnRfbG9ja291dF9leHBpcmVzX2F0ID0ge1xuICAgICAgICBfX3R5cGU6ICdEYXRlJyxcbiAgICAgICAgaXNvOiBvYmplY3QuX2FjY291bnRfbG9ja291dF9leHBpcmVzX2F0LnRvSVNPU3RyaW5nKCksXG4gICAgICB9O1xuICAgIH1cbiAgICBpZiAob2JqZWN0Ll9wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQpIHtcbiAgICAgIG9iamVjdC5fcGVyaXNoYWJsZV90b2tlbl9leHBpcmVzX2F0ID0ge1xuICAgICAgICBfX3R5cGU6ICdEYXRlJyxcbiAgICAgICAgaXNvOiBvYmplY3QuX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdC50b0lTT1N0cmluZygpLFxuICAgICAgfTtcbiAgICB9XG4gICAgaWYgKG9iamVjdC5fcGFzc3dvcmRfY2hhbmdlZF9hdCkge1xuICAgICAgb2JqZWN0Ll9wYXNzd29yZF9jaGFuZ2VkX2F0ID0ge1xuICAgICAgICBfX3R5cGU6ICdEYXRlJyxcbiAgICAgICAgaXNvOiBvYmplY3QuX3Bhc3N3b3JkX2NoYW5nZWRfYXQudG9JU09TdHJpbmcoKSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBmaWVsZE5hbWUgaW4gb2JqZWN0KSB7XG4gICAgICBpZiAob2JqZWN0W2ZpZWxkTmFtZV0gPT09IG51bGwpIHtcbiAgICAgICAgZGVsZXRlIG9iamVjdFtmaWVsZE5hbWVdO1xuICAgICAgfVxuICAgICAgaWYgKG9iamVjdFtmaWVsZE5hbWVdIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgICAgICBvYmplY3RbZmllbGROYW1lXSA9IHtcbiAgICAgICAgICBfX3R5cGU6ICdEYXRlJyxcbiAgICAgICAgICBpc286IG9iamVjdFtmaWVsZE5hbWVdLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG9iamVjdDtcbiAgfVxuXG4gIC8vIENyZWF0ZSBhIHVuaXF1ZSBpbmRleC4gVW5pcXVlIGluZGV4ZXMgb24gbnVsbGFibGUgZmllbGRzIGFyZSBub3QgYWxsb3dlZC4gU2luY2Ugd2UgZG9uJ3RcbiAgLy8gY3VycmVudGx5IGtub3cgd2hpY2ggZmllbGRzIGFyZSBudWxsYWJsZSBhbmQgd2hpY2ggYXJlbid0LCB3ZSBpZ25vcmUgdGhhdCBjcml0ZXJpYS5cbiAgLy8gQXMgc3VjaCwgd2Ugc2hvdWxkbid0IGV4cG9zZSB0aGlzIGZ1bmN0aW9uIHRvIHVzZXJzIG9mIHBhcnNlIHVudGlsIHdlIGhhdmUgYW4gb3V0LW9mLWJhbmRcbiAgLy8gV2F5IG9mIGRldGVybWluaW5nIGlmIGEgZmllbGQgaXMgbnVsbGFibGUuIFVuZGVmaW5lZCBkb2Vzbid0IGNvdW50IGFnYWluc3QgdW5pcXVlbmVzcyxcbiAgLy8gd2hpY2ggaXMgd2h5IHdlIHVzZSBzcGFyc2UgaW5kZXhlcy5cbiAgZW5zdXJlVW5pcXVlbmVzcyhcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBzY2hlbWE6IFNjaGVtYVR5cGUsXG4gICAgZmllbGROYW1lczogc3RyaW5nW11cbiAgKSB7XG4gICAgLy8gVXNlIHRoZSBzYW1lIG5hbWUgZm9yIGV2ZXJ5IGVuc3VyZVVuaXF1ZW5lc3MgYXR0ZW1wdCwgYmVjYXVzZSBwb3N0Z3Jlc1xuICAgIC8vIFdpbGwgaGFwcGlseSBjcmVhdGUgdGhlIHNhbWUgaW5kZXggd2l0aCBtdWx0aXBsZSBuYW1lcy5cbiAgICBjb25zdCBjb25zdHJhaW50TmFtZSA9IGB1bmlxdWVfJHtmaWVsZE5hbWVzLnNvcnQoKS5qb2luKCdfJyl9YDtcbiAgICBjb25zdCBjb25zdHJhaW50UGF0dGVybnMgPSBmaWVsZE5hbWVzLm1hcChcbiAgICAgIChmaWVsZE5hbWUsIGluZGV4KSA9PiBgJCR7aW5kZXggKyAzfTpuYW1lYFxuICAgICk7XG4gICAgY29uc3QgcXMgPSBgQUxURVIgVEFCTEUgJDE6bmFtZSBBREQgQ09OU1RSQUlOVCAkMjpuYW1lIFVOSVFVRSAoJHtjb25zdHJhaW50UGF0dGVybnMuam9pbigpfSlgO1xuICAgIHJldHVybiB0aGlzLl9jbGllbnRcbiAgICAgIC5ub25lKHFzLCBbY2xhc3NOYW1lLCBjb25zdHJhaW50TmFtZSwgLi4uZmllbGROYW1lc10pXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoXG4gICAgICAgICAgZXJyb3IuY29kZSA9PT0gUG9zdGdyZXNEdXBsaWNhdGVSZWxhdGlvbkVycm9yICYmXG4gICAgICAgICAgZXJyb3IubWVzc2FnZS5pbmNsdWRlcyhjb25zdHJhaW50TmFtZSlcbiAgICAgICAgKSB7XG4gICAgICAgICAgLy8gSW5kZXggYWxyZWFkeSBleGlzdHMuIElnbm9yZSBlcnJvci5cbiAgICAgICAgfSBlbHNlIGlmIChcbiAgICAgICAgICBlcnJvci5jb2RlID09PSBQb3N0Z3Jlc1VuaXF1ZUluZGV4VmlvbGF0aW9uRXJyb3IgJiZcbiAgICAgICAgICBlcnJvci5tZXNzYWdlLmluY2x1ZGVzKGNvbnN0cmFpbnROYW1lKVxuICAgICAgICApIHtcbiAgICAgICAgICAvLyBDYXN0IHRoZSBlcnJvciBpbnRvIHRoZSBwcm9wZXIgcGFyc2UgZXJyb3JcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICBQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUUsXG4gICAgICAgICAgICAnQSBkdXBsaWNhdGUgdmFsdWUgZm9yIGEgZmllbGQgd2l0aCB1bmlxdWUgdmFsdWVzIHdhcyBwcm92aWRlZCdcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgfVxuXG4gIC8vIEV4ZWN1dGVzIGEgY291bnQuXG4gIGNvdW50KGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIHF1ZXJ5OiBRdWVyeVR5cGUpIHtcbiAgICBkZWJ1ZygnY291bnQnLCBjbGFzc05hbWUsIHF1ZXJ5KTtcbiAgICBjb25zdCB2YWx1ZXMgPSBbY2xhc3NOYW1lXTtcbiAgICBjb25zdCB3aGVyZSA9IGJ1aWxkV2hlcmVDbGF1c2UoeyBzY2hlbWEsIHF1ZXJ5LCBpbmRleDogMiB9KTtcbiAgICB2YWx1ZXMucHVzaCguLi53aGVyZS52YWx1ZXMpO1xuXG4gICAgY29uc3Qgd2hlcmVQYXR0ZXJuID1cbiAgICAgIHdoZXJlLnBhdHRlcm4ubGVuZ3RoID4gMCA/IGBXSEVSRSAke3doZXJlLnBhdHRlcm59YCA6ICcnO1xuICAgIGNvbnN0IHFzID0gYFNFTEVDVCBjb3VudCgqKSBGUk9NICQxOm5hbWUgJHt3aGVyZVBhdHRlcm59YDtcbiAgICByZXR1cm4gdGhpcy5fY2xpZW50Lm9uZShxcywgdmFsdWVzLCBhID0+ICthLmNvdW50KS5jYXRjaChlcnJvciA9PiB7XG4gICAgICBpZiAoZXJyb3IuY29kZSAhPT0gUG9zdGdyZXNSZWxhdGlvbkRvZXNOb3RFeGlzdEVycm9yKSB7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfVxuICAgICAgcmV0dXJuIDA7XG4gICAgfSk7XG4gIH1cblxuICBkaXN0aW5jdChcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcbiAgICBzY2hlbWE6IFNjaGVtYVR5cGUsXG4gICAgcXVlcnk6IFF1ZXJ5VHlwZSxcbiAgICBmaWVsZE5hbWU6IHN0cmluZ1xuICApIHtcbiAgICBkZWJ1ZygnZGlzdGluY3QnLCBjbGFzc05hbWUsIHF1ZXJ5KTtcbiAgICBsZXQgZmllbGQgPSBmaWVsZE5hbWU7XG4gICAgbGV0IGNvbHVtbiA9IGZpZWxkTmFtZTtcbiAgICBjb25zdCBpc05lc3RlZCA9IGZpZWxkTmFtZS5pbmRleE9mKCcuJykgPj0gMDtcbiAgICBpZiAoaXNOZXN0ZWQpIHtcbiAgICAgIGZpZWxkID0gdHJhbnNmb3JtRG90RmllbGRUb0NvbXBvbmVudHMoZmllbGROYW1lKS5qb2luKCctPicpO1xuICAgICAgY29sdW1uID0gZmllbGROYW1lLnNwbGl0KCcuJylbMF07XG4gICAgfVxuICAgIGNvbnN0IGlzQXJyYXlGaWVsZCA9XG4gICAgICBzY2hlbWEuZmllbGRzICYmXG4gICAgICBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0gJiZcbiAgICAgIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09PSAnQXJyYXknO1xuICAgIGNvbnN0IGlzUG9pbnRlckZpZWxkID1cbiAgICAgIHNjaGVtYS5maWVsZHMgJiZcbiAgICAgIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXSAmJlxuICAgICAgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdQb2ludGVyJztcbiAgICBjb25zdCB2YWx1ZXMgPSBbZmllbGQsIGNvbHVtbiwgY2xhc3NOYW1lXTtcbiAgICBjb25zdCB3aGVyZSA9IGJ1aWxkV2hlcmVDbGF1c2UoeyBzY2hlbWEsIHF1ZXJ5LCBpbmRleDogNCB9KTtcbiAgICB2YWx1ZXMucHVzaCguLi53aGVyZS52YWx1ZXMpO1xuXG4gICAgY29uc3Qgd2hlcmVQYXR0ZXJuID1cbiAgICAgIHdoZXJlLnBhdHRlcm4ubGVuZ3RoID4gMCA/IGBXSEVSRSAke3doZXJlLnBhdHRlcm59YCA6ICcnO1xuICAgIGNvbnN0IHRyYW5zZm9ybWVyID0gaXNBcnJheUZpZWxkID8gJ2pzb25iX2FycmF5X2VsZW1lbnRzJyA6ICdPTic7XG4gICAgbGV0IHFzID0gYFNFTEVDVCBESVNUSU5DVCAke3RyYW5zZm9ybWVyfSgkMTpuYW1lKSAkMjpuYW1lIEZST00gJDM6bmFtZSAke3doZXJlUGF0dGVybn1gO1xuICAgIGlmIChpc05lc3RlZCkge1xuICAgICAgcXMgPSBgU0VMRUNUIERJU1RJTkNUICR7dHJhbnNmb3JtZXJ9KCQxOnJhdykgJDI6cmF3IEZST00gJDM6bmFtZSAke3doZXJlUGF0dGVybn1gO1xuICAgIH1cbiAgICBkZWJ1ZyhxcywgdmFsdWVzKTtcbiAgICByZXR1cm4gdGhpcy5fY2xpZW50XG4gICAgICAuYW55KHFzLCB2YWx1ZXMpXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IuY29kZSA9PT0gUG9zdGdyZXNNaXNzaW5nQ29sdW1uRXJyb3IpIHtcbiAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9KVxuICAgICAgLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICAgIGlmICghaXNOZXN0ZWQpIHtcbiAgICAgICAgICByZXN1bHRzID0gcmVzdWx0cy5maWx0ZXIob2JqZWN0ID0+IG9iamVjdFtmaWVsZF0gIT09IG51bGwpO1xuICAgICAgICAgIHJldHVybiByZXN1bHRzLm1hcChvYmplY3QgPT4ge1xuICAgICAgICAgICAgaWYgKCFpc1BvaW50ZXJGaWVsZCkge1xuICAgICAgICAgICAgICByZXR1cm4gb2JqZWN0W2ZpZWxkXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgIF9fdHlwZTogJ1BvaW50ZXInLFxuICAgICAgICAgICAgICBjbGFzc05hbWU6IHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50YXJnZXRDbGFzcyxcbiAgICAgICAgICAgICAgb2JqZWN0SWQ6IG9iamVjdFtmaWVsZF0sXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGNoaWxkID0gZmllbGROYW1lLnNwbGl0KCcuJylbMV07XG4gICAgICAgIHJldHVybiByZXN1bHRzLm1hcChvYmplY3QgPT4gb2JqZWN0W2NvbHVtbl1bY2hpbGRdKTtcbiAgICAgIH0pXG4gICAgICAudGhlbihyZXN1bHRzID0+XG4gICAgICAgIHJlc3VsdHMubWFwKG9iamVjdCA9PlxuICAgICAgICAgIHRoaXMucG9zdGdyZXNPYmplY3RUb1BhcnNlT2JqZWN0KGNsYXNzTmFtZSwgb2JqZWN0LCBzY2hlbWEpXG4gICAgICAgIClcbiAgICAgICk7XG4gIH1cblxuICBhZ2dyZWdhdGUoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogYW55LCBwaXBlbGluZTogYW55KSB7XG4gICAgZGVidWcoJ2FnZ3JlZ2F0ZScsIGNsYXNzTmFtZSwgcGlwZWxpbmUpO1xuICAgIGNvbnN0IHZhbHVlcyA9IFtjbGFzc05hbWVdO1xuICAgIGxldCBpbmRleDogbnVtYmVyID0gMjtcbiAgICBsZXQgY29sdW1uczogc3RyaW5nW10gPSBbXTtcbiAgICBsZXQgY291bnRGaWVsZCA9IG51bGw7XG4gICAgbGV0IGdyb3VwVmFsdWVzID0gbnVsbDtcbiAgICBsZXQgd2hlcmVQYXR0ZXJuID0gJyc7XG4gICAgbGV0IGxpbWl0UGF0dGVybiA9ICcnO1xuICAgIGxldCBza2lwUGF0dGVybiA9ICcnO1xuICAgIGxldCBzb3J0UGF0dGVybiA9ICcnO1xuICAgIGxldCBncm91cFBhdHRlcm4gPSAnJztcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBpcGVsaW5lLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICBjb25zdCBzdGFnZSA9IHBpcGVsaW5lW2ldO1xuICAgICAgaWYgKHN0YWdlLiRncm91cCkge1xuICAgICAgICBmb3IgKGNvbnN0IGZpZWxkIGluIHN0YWdlLiRncm91cCkge1xuICAgICAgICAgIGNvbnN0IHZhbHVlID0gc3RhZ2UuJGdyb3VwW2ZpZWxkXTtcbiAgICAgICAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChmaWVsZCA9PT0gJ19pZCcgJiYgdHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyAmJiB2YWx1ZSAhPT0gJycpIHtcbiAgICAgICAgICAgIGNvbHVtbnMucHVzaChgJCR7aW5kZXh9Om5hbWUgQVMgXCJvYmplY3RJZFwiYCk7XG4gICAgICAgICAgICBncm91cFBhdHRlcm4gPSBgR1JPVVAgQlkgJCR7aW5kZXh9Om5hbWVgO1xuICAgICAgICAgICAgdmFsdWVzLnB1c2godHJhbnNmb3JtQWdncmVnYXRlRmllbGQodmFsdWUpKTtcbiAgICAgICAgICAgIGluZGV4ICs9IDE7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKFxuICAgICAgICAgICAgZmllbGQgPT09ICdfaWQnICYmXG4gICAgICAgICAgICB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmXG4gICAgICAgICAgICBPYmplY3Qua2V5cyh2YWx1ZSkubGVuZ3RoICE9PSAwXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICBncm91cFZhbHVlcyA9IHZhbHVlO1xuICAgICAgICAgICAgY29uc3QgZ3JvdXBCeUZpZWxkcyA9IFtdO1xuICAgICAgICAgICAgZm9yIChjb25zdCBhbGlhcyBpbiB2YWx1ZSkge1xuICAgICAgICAgICAgICBjb25zdCBvcGVyYXRpb24gPSBPYmplY3Qua2V5cyh2YWx1ZVthbGlhc10pWzBdO1xuICAgICAgICAgICAgICBjb25zdCBzb3VyY2UgPSB0cmFuc2Zvcm1BZ2dyZWdhdGVGaWVsZCh2YWx1ZVthbGlhc11bb3BlcmF0aW9uXSk7XG4gICAgICAgICAgICAgIGlmIChtb25nb0FnZ3JlZ2F0ZVRvUG9zdGdyZXNbb3BlcmF0aW9uXSkge1xuICAgICAgICAgICAgICAgIGlmICghZ3JvdXBCeUZpZWxkcy5pbmNsdWRlcyhgXCIke3NvdXJjZX1cImApKSB7XG4gICAgICAgICAgICAgICAgICBncm91cEJ5RmllbGRzLnB1c2goYFwiJHtzb3VyY2V9XCJgKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY29sdW1ucy5wdXNoKFxuICAgICAgICAgICAgICAgICAgYEVYVFJBQ1QoJHtcbiAgICAgICAgICAgICAgICAgICAgbW9uZ29BZ2dyZWdhdGVUb1Bvc3RncmVzW29wZXJhdGlvbl1cbiAgICAgICAgICAgICAgICAgIH0gRlJPTSAkJHtpbmRleH06bmFtZSBBVCBUSU1FIFpPTkUgJ1VUQycpIEFTICQke2luZGV4ICtcbiAgICAgICAgICAgICAgICAgICAgMX06bmFtZWBcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIHZhbHVlcy5wdXNoKHNvdXJjZSwgYWxpYXMpO1xuICAgICAgICAgICAgICAgIGluZGV4ICs9IDI7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGdyb3VwUGF0dGVybiA9IGBHUk9VUCBCWSAkJHtpbmRleH06cmF3YDtcbiAgICAgICAgICAgIHZhbHVlcy5wdXNoKGdyb3VwQnlGaWVsZHMuam9pbigpKTtcbiAgICAgICAgICAgIGluZGV4ICs9IDE7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHZhbHVlLiRzdW0pIHtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgdmFsdWUuJHN1bSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgY29sdW1ucy5wdXNoKGBTVU0oJCR7aW5kZXh9Om5hbWUpIEFTICQke2luZGV4ICsgMX06bmFtZWApO1xuICAgICAgICAgICAgICB2YWx1ZXMucHVzaCh0cmFuc2Zvcm1BZ2dyZWdhdGVGaWVsZCh2YWx1ZS4kc3VtKSwgZmllbGQpO1xuICAgICAgICAgICAgICBpbmRleCArPSAyO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgY291bnRGaWVsZCA9IGZpZWxkO1xuICAgICAgICAgICAgICBjb2x1bW5zLnB1c2goYENPVU5UKCopIEFTICQke2luZGV4fTpuYW1lYCk7XG4gICAgICAgICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkKTtcbiAgICAgICAgICAgICAgaW5kZXggKz0gMTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHZhbHVlLiRtYXgpIHtcbiAgICAgICAgICAgIGNvbHVtbnMucHVzaChgTUFYKCQke2luZGV4fTpuYW1lKSBBUyAkJHtpbmRleCArIDF9Om5hbWVgKTtcbiAgICAgICAgICAgIHZhbHVlcy5wdXNoKHRyYW5zZm9ybUFnZ3JlZ2F0ZUZpZWxkKHZhbHVlLiRtYXgpLCBmaWVsZCk7XG4gICAgICAgICAgICBpbmRleCArPSAyO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAodmFsdWUuJG1pbikge1xuICAgICAgICAgICAgY29sdW1ucy5wdXNoKGBNSU4oJCR7aW5kZXh9Om5hbWUpIEFTICQke2luZGV4ICsgMX06bmFtZWApO1xuICAgICAgICAgICAgdmFsdWVzLnB1c2godHJhbnNmb3JtQWdncmVnYXRlRmllbGQodmFsdWUuJG1pbiksIGZpZWxkKTtcbiAgICAgICAgICAgIGluZGV4ICs9IDI7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICh2YWx1ZS4kYXZnKSB7XG4gICAgICAgICAgICBjb2x1bW5zLnB1c2goYEFWRygkJHtpbmRleH06bmFtZSkgQVMgJCR7aW5kZXggKyAxfTpuYW1lYCk7XG4gICAgICAgICAgICB2YWx1ZXMucHVzaCh0cmFuc2Zvcm1BZ2dyZWdhdGVGaWVsZCh2YWx1ZS4kYXZnKSwgZmllbGQpO1xuICAgICAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbHVtbnMucHVzaCgnKicpO1xuICAgICAgfVxuICAgICAgaWYgKHN0YWdlLiRwcm9qZWN0KSB7XG4gICAgICAgIGlmIChjb2x1bW5zLmluY2x1ZGVzKCcqJykpIHtcbiAgICAgICAgICBjb2x1bW5zID0gW107XG4gICAgICAgIH1cbiAgICAgICAgZm9yIChjb25zdCBmaWVsZCBpbiBzdGFnZS4kcHJvamVjdCkge1xuICAgICAgICAgIGNvbnN0IHZhbHVlID0gc3RhZ2UuJHByb2plY3RbZmllbGRdO1xuICAgICAgICAgIGlmICh2YWx1ZSA9PT0gMSB8fCB2YWx1ZSA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgY29sdW1ucy5wdXNoKGAkJHtpbmRleH06bmFtZWApO1xuICAgICAgICAgICAgdmFsdWVzLnB1c2goZmllbGQpO1xuICAgICAgICAgICAgaW5kZXggKz0gMTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChzdGFnZS4kbWF0Y2gpIHtcbiAgICAgICAgY29uc3QgcGF0dGVybnMgPSBbXTtcbiAgICAgICAgY29uc3Qgb3JPckFuZCA9IHN0YWdlLiRtYXRjaC5oYXNPd25Qcm9wZXJ0eSgnJG9yJykgPyAnIE9SICcgOiAnIEFORCAnO1xuXG4gICAgICAgIGlmIChzdGFnZS4kbWF0Y2guJG9yKSB7XG4gICAgICAgICAgY29uc3QgY29sbGFwc2UgPSB7fTtcbiAgICAgICAgICBzdGFnZS4kbWF0Y2guJG9yLmZvckVhY2goZWxlbWVudCA9PiB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBlbGVtZW50KSB7XG4gICAgICAgICAgICAgIGNvbGxhcHNlW2tleV0gPSBlbGVtZW50W2tleV07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgc3RhZ2UuJG1hdGNoID0gY29sbGFwc2U7XG4gICAgICAgIH1cbiAgICAgICAgZm9yIChjb25zdCBmaWVsZCBpbiBzdGFnZS4kbWF0Y2gpIHtcbiAgICAgICAgICBjb25zdCB2YWx1ZSA9IHN0YWdlLiRtYXRjaFtmaWVsZF07XG4gICAgICAgICAgY29uc3QgbWF0Y2hQYXR0ZXJucyA9IFtdO1xuICAgICAgICAgIE9iamVjdC5rZXlzKFBhcnNlVG9Qb3NncmVzQ29tcGFyYXRvcikuZm9yRWFjaChjbXAgPT4ge1xuICAgICAgICAgICAgaWYgKHZhbHVlW2NtcF0pIHtcbiAgICAgICAgICAgICAgY29uc3QgcGdDb21wYXJhdG9yID0gUGFyc2VUb1Bvc2dyZXNDb21wYXJhdG9yW2NtcF07XG4gICAgICAgICAgICAgIG1hdGNoUGF0dGVybnMucHVzaChcbiAgICAgICAgICAgICAgICBgJCR7aW5kZXh9Om5hbWUgJHtwZ0NvbXBhcmF0b3J9ICQke2luZGV4ICsgMX1gXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkLCB0b1Bvc3RncmVzVmFsdWUodmFsdWVbY21wXSkpO1xuICAgICAgICAgICAgICBpbmRleCArPSAyO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGlmIChtYXRjaFBhdHRlcm5zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHBhdHRlcm5zLnB1c2goYCgke21hdGNoUGF0dGVybnMuam9pbignIEFORCAnKX0pYCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgIHNjaGVtYS5maWVsZHNbZmllbGRdICYmXG4gICAgICAgICAgICBzY2hlbWEuZmllbGRzW2ZpZWxkXS50eXBlICYmXG4gICAgICAgICAgICBtYXRjaFBhdHRlcm5zLmxlbmd0aCA9PT0gMFxuICAgICAgICAgICkge1xuICAgICAgICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YCk7XG4gICAgICAgICAgICB2YWx1ZXMucHVzaChmaWVsZCwgdmFsdWUpO1xuICAgICAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgd2hlcmVQYXR0ZXJuID1cbiAgICAgICAgICBwYXR0ZXJucy5sZW5ndGggPiAwID8gYFdIRVJFICR7cGF0dGVybnMuam9pbihgICR7b3JPckFuZH0gYCl9YCA6ICcnO1xuICAgICAgfVxuICAgICAgaWYgKHN0YWdlLiRsaW1pdCkge1xuICAgICAgICBsaW1pdFBhdHRlcm4gPSBgTElNSVQgJCR7aW5kZXh9YDtcbiAgICAgICAgdmFsdWVzLnB1c2goc3RhZ2UuJGxpbWl0KTtcbiAgICAgICAgaW5kZXggKz0gMTtcbiAgICAgIH1cbiAgICAgIGlmIChzdGFnZS4kc2tpcCkge1xuICAgICAgICBza2lwUGF0dGVybiA9IGBPRkZTRVQgJCR7aW5kZXh9YDtcbiAgICAgICAgdmFsdWVzLnB1c2goc3RhZ2UuJHNraXApO1xuICAgICAgICBpbmRleCArPSAxO1xuICAgICAgfVxuICAgICAgaWYgKHN0YWdlLiRzb3J0KSB7XG4gICAgICAgIGNvbnN0IHNvcnQgPSBzdGFnZS4kc29ydDtcbiAgICAgICAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKHNvcnQpO1xuICAgICAgICBjb25zdCBzb3J0aW5nID0ga2V5c1xuICAgICAgICAgIC5tYXAoa2V5ID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHRyYW5zZm9ybWVyID0gc29ydFtrZXldID09PSAxID8gJ0FTQycgOiAnREVTQyc7XG4gICAgICAgICAgICBjb25zdCBvcmRlciA9IGAkJHtpbmRleH06bmFtZSAke3RyYW5zZm9ybWVyfWA7XG4gICAgICAgICAgICBpbmRleCArPSAxO1xuICAgICAgICAgICAgcmV0dXJuIG9yZGVyO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLmpvaW4oKTtcbiAgICAgICAgdmFsdWVzLnB1c2goLi4ua2V5cyk7XG4gICAgICAgIHNvcnRQYXR0ZXJuID1cbiAgICAgICAgICBzb3J0ICE9PSB1bmRlZmluZWQgJiYgc29ydGluZy5sZW5ndGggPiAwID8gYE9SREVSIEJZICR7c29ydGluZ31gIDogJyc7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgcXMgPSBgU0VMRUNUICR7Y29sdW1ucy5qb2luKCl9IEZST00gJDE6bmFtZSAke3doZXJlUGF0dGVybn0gJHtzb3J0UGF0dGVybn0gJHtsaW1pdFBhdHRlcm59ICR7c2tpcFBhdHRlcm59ICR7Z3JvdXBQYXR0ZXJufWA7XG4gICAgZGVidWcocXMsIHZhbHVlcyk7XG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudFxuICAgICAgLm1hcChxcywgdmFsdWVzLCBhID0+XG4gICAgICAgIHRoaXMucG9zdGdyZXNPYmplY3RUb1BhcnNlT2JqZWN0KGNsYXNzTmFtZSwgYSwgc2NoZW1hKVxuICAgICAgKVxuICAgICAgLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICAgIHJlc3VsdHMuZm9yRWFjaChyZXN1bHQgPT4ge1xuICAgICAgICAgIGlmICghcmVzdWx0Lmhhc093blByb3BlcnR5KCdvYmplY3RJZCcpKSB7XG4gICAgICAgICAgICByZXN1bHQub2JqZWN0SWQgPSBudWxsO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoZ3JvdXBWYWx1ZXMpIHtcbiAgICAgICAgICAgIHJlc3VsdC5vYmplY3RJZCA9IHt9O1xuICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gZ3JvdXBWYWx1ZXMpIHtcbiAgICAgICAgICAgICAgcmVzdWx0Lm9iamVjdElkW2tleV0gPSByZXN1bHRba2V5XTtcbiAgICAgICAgICAgICAgZGVsZXRlIHJlc3VsdFtrZXldO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoY291bnRGaWVsZCkge1xuICAgICAgICAgICAgcmVzdWx0W2NvdW50RmllbGRdID0gcGFyc2VJbnQocmVzdWx0W2NvdW50RmllbGRdLCAxMCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHJlc3VsdHM7XG4gICAgICB9KTtcbiAgfVxuXG4gIHBlcmZvcm1Jbml0aWFsaXphdGlvbih7IFZvbGF0aWxlQ2xhc3Nlc1NjaGVtYXMgfTogYW55KSB7XG4gICAgLy8gVE9ETzogVGhpcyBtZXRob2QgbmVlZHMgdG8gYmUgcmV3cml0dGVuIHRvIG1ha2UgcHJvcGVyIHVzZSBvZiBjb25uZWN0aW9ucyAoQHZpdGFseS10KVxuICAgIGRlYnVnKCdwZXJmb3JtSW5pdGlhbGl6YXRpb24nKTtcbiAgICBjb25zdCBwcm9taXNlcyA9IFZvbGF0aWxlQ2xhc3Nlc1NjaGVtYXMubWFwKHNjaGVtYSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5jcmVhdGVUYWJsZShzY2hlbWEuY2xhc3NOYW1lLCBzY2hlbWEpXG4gICAgICAgIC5jYXRjaChlcnIgPT4ge1xuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgIGVyci5jb2RlID09PSBQb3N0Z3Jlc0R1cGxpY2F0ZVJlbGF0aW9uRXJyb3IgfHxcbiAgICAgICAgICAgIGVyci5jb2RlID09PSBQYXJzZS5FcnJvci5JTlZBTElEX0NMQVNTX05BTUVcbiAgICAgICAgICApIHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICB9KVxuICAgICAgICAudGhlbigoKSA9PiB0aGlzLnNjaGVtYVVwZ3JhZGUoc2NoZW1hLmNsYXNzTmFtZSwgc2NoZW1hKSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIFByb21pc2UuYWxsKHByb21pc2VzKVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5fY2xpZW50LnR4KCdwZXJmb3JtLWluaXRpYWxpemF0aW9uJywgdCA9PiB7XG4gICAgICAgICAgcmV0dXJuIHQuYmF0Y2goW1xuICAgICAgICAgICAgdC5ub25lKHNxbC5taXNjLmpzb25PYmplY3RTZXRLZXlzKSxcbiAgICAgICAgICAgIHQubm9uZShzcWwuYXJyYXkuYWRkKSxcbiAgICAgICAgICAgIHQubm9uZShzcWwuYXJyYXkuYWRkVW5pcXVlKSxcbiAgICAgICAgICAgIHQubm9uZShzcWwuYXJyYXkucmVtb3ZlKSxcbiAgICAgICAgICAgIHQubm9uZShzcWwuYXJyYXkuY29udGFpbnNBbGwpLFxuICAgICAgICAgICAgdC5ub25lKHNxbC5hcnJheS5jb250YWluc0FsbFJlZ2V4KSxcbiAgICAgICAgICAgIHQubm9uZShzcWwuYXJyYXkuY29udGFpbnMpLFxuICAgICAgICAgIF0pO1xuICAgICAgICB9KTtcbiAgICAgIH0pXG4gICAgICAudGhlbihkYXRhID0+IHtcbiAgICAgICAgZGVidWcoYGluaXRpYWxpemF0aW9uRG9uZSBpbiAke2RhdGEuZHVyYXRpb259YCk7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgLyogZXNsaW50LWRpc2FibGUgbm8tY29uc29sZSAqL1xuICAgICAgICBjb25zb2xlLmVycm9yKGVycm9yKTtcbiAgICAgIH0pO1xuICB9XG5cbiAgY3JlYXRlSW5kZXhlcyhjbGFzc05hbWU6IHN0cmluZywgaW5kZXhlczogYW55LCBjb25uOiA/YW55KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIChjb25uIHx8IHRoaXMuX2NsaWVudCkudHgodCA9PlxuICAgICAgdC5iYXRjaChcbiAgICAgICAgaW5kZXhlcy5tYXAoaSA9PiB7XG4gICAgICAgICAgcmV0dXJuIHQubm9uZSgnQ1JFQVRFIElOREVYICQxOm5hbWUgT04gJDI6bmFtZSAoJDM6bmFtZSknLCBbXG4gICAgICAgICAgICBpLm5hbWUsXG4gICAgICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgICAgICBpLmtleSxcbiAgICAgICAgICBdKTtcbiAgICAgICAgfSlcbiAgICAgIClcbiAgICApO1xuICB9XG5cbiAgY3JlYXRlSW5kZXhlc0lmTmVlZGVkKFxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxuICAgIGZpZWxkTmFtZTogc3RyaW5nLFxuICAgIHR5cGU6IGFueSxcbiAgICBjb25uOiA/YW55XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiAoY29ubiB8fCB0aGlzLl9jbGllbnQpLm5vbmUoXG4gICAgICAnQ1JFQVRFIElOREVYICQxOm5hbWUgT04gJDI6bmFtZSAoJDM6bmFtZSknLFxuICAgICAgW2ZpZWxkTmFtZSwgY2xhc3NOYW1lLCB0eXBlXVxuICAgICk7XG4gIH1cblxuICBkcm9wSW5kZXhlcyhjbGFzc05hbWU6IHN0cmluZywgaW5kZXhlczogYW55LCBjb25uOiBhbnkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBxdWVyaWVzID0gaW5kZXhlcy5tYXAoaSA9PiAoe1xuICAgICAgcXVlcnk6ICdEUk9QIElOREVYICQxOm5hbWUnLFxuICAgICAgdmFsdWVzOiBpLFxuICAgIH0pKTtcbiAgICByZXR1cm4gKGNvbm4gfHwgdGhpcy5fY2xpZW50KS50eCh0ID0+XG4gICAgICB0Lm5vbmUodGhpcy5fcGdwLmhlbHBlcnMuY29uY2F0KHF1ZXJpZXMpKVxuICAgICk7XG4gIH1cblxuICBnZXRJbmRleGVzKGNsYXNzTmFtZTogc3RyaW5nKSB7XG4gICAgY29uc3QgcXMgPSAnU0VMRUNUICogRlJPTSBwZ19pbmRleGVzIFdIRVJFIHRhYmxlbmFtZSA9ICR7Y2xhc3NOYW1lfSc7XG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudC5hbnkocXMsIHsgY2xhc3NOYW1lIH0pO1xuICB9XG5cbiAgdXBkYXRlU2NoZW1hV2l0aEluZGV4ZXMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnRQb2x5Z29uVG9TUUwocG9seWdvbikge1xuICBpZiAocG9seWdvbi5sZW5ndGggPCAzKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgYFBvbHlnb24gbXVzdCBoYXZlIGF0IGxlYXN0IDMgdmFsdWVzYFxuICAgICk7XG4gIH1cbiAgaWYgKFxuICAgIHBvbHlnb25bMF1bMF0gIT09IHBvbHlnb25bcG9seWdvbi5sZW5ndGggLSAxXVswXSB8fFxuICAgIHBvbHlnb25bMF1bMV0gIT09IHBvbHlnb25bcG9seWdvbi5sZW5ndGggLSAxXVsxXVxuICApIHtcbiAgICBwb2x5Z29uLnB1c2gocG9seWdvblswXSk7XG4gIH1cbiAgY29uc3QgdW5pcXVlID0gcG9seWdvbi5maWx0ZXIoKGl0ZW0sIGluZGV4LCBhcikgPT4ge1xuICAgIGxldCBmb3VuZEluZGV4ID0gLTE7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBhci5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgY29uc3QgcHQgPSBhcltpXTtcbiAgICAgIGlmIChwdFswXSA9PT0gaXRlbVswXSAmJiBwdFsxXSA9PT0gaXRlbVsxXSkge1xuICAgICAgICBmb3VuZEluZGV4ID0gaTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBmb3VuZEluZGV4ID09PSBpbmRleDtcbiAgfSk7XG4gIGlmICh1bmlxdWUubGVuZ3RoIDwgMykge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgIFBhcnNlLkVycm9yLklOVEVSTkFMX1NFUlZFUl9FUlJPUixcbiAgICAgICdHZW9KU09OOiBMb29wIG11c3QgaGF2ZSBhdCBsZWFzdCAzIGRpZmZlcmVudCB2ZXJ0aWNlcydcbiAgICApO1xuICB9XG4gIGNvbnN0IHBvaW50cyA9IHBvbHlnb25cbiAgICAubWFwKHBvaW50ID0+IHtcbiAgICAgIFBhcnNlLkdlb1BvaW50Ll92YWxpZGF0ZShwYXJzZUZsb2F0KHBvaW50WzFdKSwgcGFyc2VGbG9hdChwb2ludFswXSkpO1xuICAgICAgcmV0dXJuIGAoJHtwb2ludFsxXX0sICR7cG9pbnRbMF19KWA7XG4gICAgfSlcbiAgICAuam9pbignLCAnKTtcbiAgcmV0dXJuIGAoJHtwb2ludHN9KWA7XG59XG5cbmZ1bmN0aW9uIHJlbW92ZVdoaXRlU3BhY2UocmVnZXgpIHtcbiAgaWYgKCFyZWdleC5lbmRzV2l0aCgnXFxuJykpIHtcbiAgICByZWdleCArPSAnXFxuJztcbiAgfVxuXG4gIC8vIHJlbW92ZSBub24gZXNjYXBlZCBjb21tZW50c1xuICByZXR1cm4gKFxuICAgIHJlZ2V4XG4gICAgICAucmVwbGFjZSgvKFteXFxcXF0pIy4qXFxuL2dpbSwgJyQxJylcbiAgICAgIC8vIHJlbW92ZSBsaW5lcyBzdGFydGluZyB3aXRoIGEgY29tbWVudFxuICAgICAgLnJlcGxhY2UoL14jLipcXG4vZ2ltLCAnJylcbiAgICAgIC8vIHJlbW92ZSBub24gZXNjYXBlZCB3aGl0ZXNwYWNlXG4gICAgICAucmVwbGFjZSgvKFteXFxcXF0pXFxzKy9naW0sICckMScpXG4gICAgICAvLyByZW1vdmUgd2hpdGVzcGFjZSBhdCB0aGUgYmVnaW5uaW5nIG9mIGEgbGluZVxuICAgICAgLnJlcGxhY2UoL15cXHMrLywgJycpXG4gICAgICAudHJpbSgpXG4gICk7XG59XG5cbmZ1bmN0aW9uIHByb2Nlc3NSZWdleFBhdHRlcm4ocykge1xuICBpZiAocyAmJiBzLnN0YXJ0c1dpdGgoJ14nKSkge1xuICAgIC8vIHJlZ2V4IGZvciBzdGFydHNXaXRoXG4gICAgcmV0dXJuICdeJyArIGxpdGVyYWxpemVSZWdleFBhcnQocy5zbGljZSgxKSk7XG4gIH0gZWxzZSBpZiAocyAmJiBzLmVuZHNXaXRoKCckJykpIHtcbiAgICAvLyByZWdleCBmb3IgZW5kc1dpdGhcbiAgICByZXR1cm4gbGl0ZXJhbGl6ZVJlZ2V4UGFydChzLnNsaWNlKDAsIHMubGVuZ3RoIC0gMSkpICsgJyQnO1xuICB9XG5cbiAgLy8gcmVnZXggZm9yIGNvbnRhaW5zXG4gIHJldHVybiBsaXRlcmFsaXplUmVnZXhQYXJ0KHMpO1xufVxuXG5mdW5jdGlvbiBpc1N0YXJ0c1dpdGhSZWdleCh2YWx1ZSkge1xuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gJ3N0cmluZycgfHwgIXZhbHVlLnN0YXJ0c1dpdGgoJ14nKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGNvbnN0IG1hdGNoZXMgPSB2YWx1ZS5tYXRjaCgvXFxeXFxcXFEuKlxcXFxFLyk7XG4gIHJldHVybiAhIW1hdGNoZXM7XG59XG5cbmZ1bmN0aW9uIGlzQWxsVmFsdWVzUmVnZXhPck5vbmUodmFsdWVzKSB7XG4gIGlmICghdmFsdWVzIHx8ICFBcnJheS5pc0FycmF5KHZhbHVlcykgfHwgdmFsdWVzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgY29uc3QgZmlyc3RWYWx1ZXNJc1JlZ2V4ID0gaXNTdGFydHNXaXRoUmVnZXgodmFsdWVzWzBdLiRyZWdleCk7XG4gIGlmICh2YWx1ZXMubGVuZ3RoID09PSAxKSB7XG4gICAgcmV0dXJuIGZpcnN0VmFsdWVzSXNSZWdleDtcbiAgfVxuXG4gIGZvciAobGV0IGkgPSAxLCBsZW5ndGggPSB2YWx1ZXMubGVuZ3RoOyBpIDwgbGVuZ3RoOyArK2kpIHtcbiAgICBpZiAoZmlyc3RWYWx1ZXNJc1JlZ2V4ICE9PSBpc1N0YXJ0c1dpdGhSZWdleCh2YWx1ZXNbaV0uJHJlZ2V4KSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0cnVlO1xufVxuXG5mdW5jdGlvbiBpc0FueVZhbHVlUmVnZXhTdGFydHNXaXRoKHZhbHVlcykge1xuICByZXR1cm4gdmFsdWVzLnNvbWUoZnVuY3Rpb24odmFsdWUpIHtcbiAgICByZXR1cm4gaXNTdGFydHNXaXRoUmVnZXgodmFsdWUuJHJlZ2V4KTtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUxpdGVyYWxSZWdleChyZW1haW5pbmcpIHtcbiAgcmV0dXJuIHJlbWFpbmluZ1xuICAgIC5zcGxpdCgnJylcbiAgICAubWFwKGMgPT4ge1xuICAgICAgaWYgKGMubWF0Y2goL1swLTlhLXpBLVpdLykgIT09IG51bGwpIHtcbiAgICAgICAgLy8gZG9uJ3QgZXNjYXBlIGFscGhhbnVtZXJpYyBjaGFyYWN0ZXJzXG4gICAgICAgIHJldHVybiBjO1xuICAgICAgfVxuICAgICAgLy8gZXNjYXBlIGV2ZXJ5dGhpbmcgZWxzZSAoc2luZ2xlIHF1b3RlcyB3aXRoIHNpbmdsZSBxdW90ZXMsIGV2ZXJ5dGhpbmcgZWxzZSB3aXRoIGEgYmFja3NsYXNoKVxuICAgICAgcmV0dXJuIGMgPT09IGAnYCA/IGAnJ2AgOiBgXFxcXCR7Y31gO1xuICAgIH0pXG4gICAgLmpvaW4oJycpO1xufVxuXG5mdW5jdGlvbiBsaXRlcmFsaXplUmVnZXhQYXJ0KHM6IHN0cmluZykge1xuICBjb25zdCBtYXRjaGVyMSA9IC9cXFxcUSgoPyFcXFxcRSkuKilcXFxcRSQvO1xuICBjb25zdCByZXN1bHQxOiBhbnkgPSBzLm1hdGNoKG1hdGNoZXIxKTtcbiAgaWYgKHJlc3VsdDEgJiYgcmVzdWx0MS5sZW5ndGggPiAxICYmIHJlc3VsdDEuaW5kZXggPiAtMSkge1xuICAgIC8vIHByb2Nlc3MgcmVnZXggdGhhdCBoYXMgYSBiZWdpbm5pbmcgYW5kIGFuIGVuZCBzcGVjaWZpZWQgZm9yIHRoZSBsaXRlcmFsIHRleHRcbiAgICBjb25zdCBwcmVmaXggPSBzLnN1YnN0cigwLCByZXN1bHQxLmluZGV4KTtcbiAgICBjb25zdCByZW1haW5pbmcgPSByZXN1bHQxWzFdO1xuXG4gICAgcmV0dXJuIGxpdGVyYWxpemVSZWdleFBhcnQocHJlZml4KSArIGNyZWF0ZUxpdGVyYWxSZWdleChyZW1haW5pbmcpO1xuICB9XG5cbiAgLy8gcHJvY2VzcyByZWdleCB0aGF0IGhhcyBhIGJlZ2lubmluZyBzcGVjaWZpZWQgZm9yIHRoZSBsaXRlcmFsIHRleHRcbiAgY29uc3QgbWF0Y2hlcjIgPSAvXFxcXFEoKD8hXFxcXEUpLiopJC87XG4gIGNvbnN0IHJlc3VsdDI6IGFueSA9IHMubWF0Y2gobWF0Y2hlcjIpO1xuICBpZiAocmVzdWx0MiAmJiByZXN1bHQyLmxlbmd0aCA+IDEgJiYgcmVzdWx0Mi5pbmRleCA+IC0xKSB7XG4gICAgY29uc3QgcHJlZml4ID0gcy5zdWJzdHIoMCwgcmVzdWx0Mi5pbmRleCk7XG4gICAgY29uc3QgcmVtYWluaW5nID0gcmVzdWx0MlsxXTtcblxuICAgIHJldHVybiBsaXRlcmFsaXplUmVnZXhQYXJ0KHByZWZpeCkgKyBjcmVhdGVMaXRlcmFsUmVnZXgocmVtYWluaW5nKTtcbiAgfVxuXG4gIC8vIHJlbW92ZSBhbGwgaW5zdGFuY2VzIG9mIFxcUSBhbmQgXFxFIGZyb20gdGhlIHJlbWFpbmluZyB0ZXh0ICYgZXNjYXBlIHNpbmdsZSBxdW90ZXNcbiAgcmV0dXJuIHNcbiAgICAucmVwbGFjZSgvKFteXFxcXF0pKFxcXFxFKS8sICckMScpXG4gICAgLnJlcGxhY2UoLyhbXlxcXFxdKShcXFxcUSkvLCAnJDEnKVxuICAgIC5yZXBsYWNlKC9eXFxcXEUvLCAnJylcbiAgICAucmVwbGFjZSgvXlxcXFxRLywgJycpXG4gICAgLnJlcGxhY2UoLyhbXiddKScvLCBgJDEnJ2ApXG4gICAgLnJlcGxhY2UoL14nKFteJ10pLywgYCcnJDFgKTtcbn1cblxudmFyIEdlb1BvaW50Q29kZXIgPSB7XG4gIGlzVmFsaWRKU09OKHZhbHVlKSB7XG4gICAgcmV0dXJuIChcbiAgICAgIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgdmFsdWUgIT09IG51bGwgJiYgdmFsdWUuX190eXBlID09PSAnR2VvUG9pbnQnXG4gICAgKTtcbiAgfSxcbn07XG5cbmV4cG9ydCBkZWZhdWx0IFBvc3RncmVzU3RvcmFnZUFkYXB0ZXI7XG4iXX0=