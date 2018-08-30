'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.createSubscriber = exports.createPublisher = exports.RedisPubSub = undefined;

var _redis = require('redis');

var _redis2 = _interopRequireDefault(_redis);

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function createPublisher({ redisURL }) {
  var redisCli = _redis2.default.createClient(redisURL, { no_ready_check: true });

  if (redisCli) {
    redisCli.publish2 = redisCli.publish;

    redisCli.publish = function (channel, body) {
      var bodyObject;
      try {
        bodyObject = JSON.parse(body);
      } catch (e) {
        bodyObject = {};
      }
      if (bodyObject && bodyObject.pushStatus) {
        redisCli.multi([['sadd', bodyObject.applicationId + ':push', body]]).exec();
      }
      return redisCli.publish2(channel, body);
    };
  }

  return redisCli;
}

function createSubscriber({ redisURL }) {
  var redisCli = _redis2.default.createClient(redisURL, { no_ready_check: true });
  var secondaryClient = _redis2.default.createClient(redisURL, { no_ready_check: true });
  if (redisCli) {
    redisCli.run = function (workItem) {
      return new _node2.default.Promise(function (resolve) {
        secondaryClient.multi([['spop', workItem.applicationId + ':push']]).exec(function (err, rep) {
          if (!err && rep && rep[0]) {
            resolve(JSON.parse(rep[0]));
          } else {
            resolve();
          }
        });
      });
    };
  }

  return redisCli;
}

const RedisPubSub = {
  createPublisher,
  createSubscriber
};

exports.RedisPubSub = RedisPubSub;
exports.createPublisher = createPublisher;
exports.createSubscriber = createSubscriber;