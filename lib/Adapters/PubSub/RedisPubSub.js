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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9BZGFwdGVycy9QdWJTdWIvUmVkaXNQdWJTdWIuanMiXSwibmFtZXMiOlsiY3JlYXRlUHVibGlzaGVyIiwicmVkaXNVUkwiLCJyZWRpc0NsaSIsInJlZGlzIiwiY3JlYXRlQ2xpZW50Iiwibm9fcmVhZHlfY2hlY2siLCJwdWJsaXNoMiIsInB1Ymxpc2giLCJjaGFubmVsIiwiYm9keSIsImJvZHlPYmplY3QiLCJKU09OIiwicGFyc2UiLCJlIiwicHVzaFN0YXR1cyIsIm11bHRpIiwiYXBwbGljYXRpb25JZCIsImV4ZWMiLCJjcmVhdGVTdWJzY3JpYmVyIiwic2Vjb25kYXJ5Q2xpZW50IiwicnVuIiwid29ya0l0ZW0iLCJQYXJzZSIsIlByb21pc2UiLCJyZXNvbHZlIiwiZXJyIiwicmVwIiwiUmVkaXNQdWJTdWIiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFBQTs7OztBQUNBOzs7Ozs7QUFFQSxTQUFTQSxlQUFULENBQXlCLEVBQUNDLFFBQUQsRUFBekIsRUFBMEM7QUFDeEMsTUFBSUMsV0FBV0MsZ0JBQU1DLFlBQU4sQ0FBbUJILFFBQW5CLEVBQTZCLEVBQUVJLGdCQUFnQixJQUFsQixFQUE3QixDQUFmOztBQUVBLE1BQUlILFFBQUosRUFBYztBQUNaQSxhQUFTSSxRQUFULEdBQW9CSixTQUFTSyxPQUE3Qjs7QUFFQUwsYUFBU0ssT0FBVCxHQUFtQixVQUFVQyxPQUFWLEVBQW1CQyxJQUFuQixFQUF5QjtBQUMxQyxVQUFJQyxVQUFKO0FBQ0EsVUFBSTtBQUNGQSxxQkFBYUMsS0FBS0MsS0FBTCxDQUFXSCxJQUFYLENBQWI7QUFDRCxPQUZELENBRUUsT0FBT0ksQ0FBUCxFQUFVO0FBQ1ZILHFCQUFhLEVBQWI7QUFDRDtBQUNELFVBQUlBLGNBQWNBLFdBQVdJLFVBQTdCLEVBQXlDO0FBQ3ZDWixpQkFBU2EsS0FBVCxDQUFlLENBQ2IsQ0FBQyxNQUFELEVBQVNMLFdBQVdNLGFBQVgsR0FBMkIsT0FBcEMsRUFBNkNQLElBQTdDLENBRGEsQ0FBZixFQUVHUSxJQUZIO0FBR0Q7QUFDRCxhQUFPZixTQUFTSSxRQUFULENBQWtCRSxPQUFsQixFQUEyQkMsSUFBM0IsQ0FBUDtBQUNELEtBYkQ7QUFjRDs7QUFFRCxTQUFPUCxRQUFQO0FBQ0Q7O0FBRUQsU0FBU2dCLGdCQUFULENBQTBCLEVBQUNqQixRQUFELEVBQTFCLEVBQTJDO0FBQ3pDLE1BQUlDLFdBQVdDLGdCQUFNQyxZQUFOLENBQW1CSCxRQUFuQixFQUE2QixFQUFFSSxnQkFBZ0IsSUFBbEIsRUFBN0IsQ0FBZjtBQUNBLE1BQUljLGtCQUFrQmhCLGdCQUFNQyxZQUFOLENBQW1CSCxRQUFuQixFQUE2QixFQUFFSSxnQkFBZ0IsSUFBbEIsRUFBN0IsQ0FBdEI7QUFDQSxNQUFJSCxRQUFKLEVBQWM7QUFDWkEsYUFBU2tCLEdBQVQsR0FBZSxVQUFVQyxRQUFWLEVBQW9CO0FBQ2pDLGFBQU8sSUFBSUMsZUFBTUMsT0FBVixDQUFrQixVQUFVQyxPQUFWLEVBQW1CO0FBQzFDTCx3QkFDR0osS0FESCxDQUNTLENBQ0wsQ0FBQyxNQUFELEVBQVNNLFNBQVNMLGFBQVQsR0FBeUIsT0FBbEMsQ0FESyxDQURULEVBSUdDLElBSkgsQ0FJUSxVQUFVUSxHQUFWLEVBQWVDLEdBQWYsRUFBb0I7QUFDeEIsY0FBSSxDQUFDRCxHQUFELElBQVFDLEdBQVIsSUFBZUEsSUFBSSxDQUFKLENBQW5CLEVBQTJCO0FBQ3pCRixvQkFBUWIsS0FBS0MsS0FBTCxDQUFXYyxJQUFJLENBQUosQ0FBWCxDQUFSO0FBQ0QsV0FGRCxNQUVPO0FBQ0xGO0FBQ0Q7QUFDRixTQVZIO0FBV0QsT0FaTSxDQUFQO0FBYUQsS0FkRDtBQWVEOztBQUVELFNBQU90QixRQUFQO0FBQ0Q7O0FBRUQsTUFBTXlCLGNBQWM7QUFDbEIzQixpQkFEa0I7QUFFbEJrQjtBQUZrQixDQUFwQjs7UUFNRVMsVyxHQUFBQSxXO1FBQ0EzQixlLEdBQUFBLGU7UUFDQWtCLGdCLEdBQUFBLGdCIiwiZmlsZSI6IlJlZGlzUHViU3ViLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHJlZGlzIGZyb20gJ3JlZGlzJztcbmltcG9ydCBQYXJzZSBmcm9tICdwYXJzZS9ub2RlJztcblxuZnVuY3Rpb24gY3JlYXRlUHVibGlzaGVyKHtyZWRpc1VSTH0pOiBhbnkge1xuICB2YXIgcmVkaXNDbGkgPSByZWRpcy5jcmVhdGVDbGllbnQocmVkaXNVUkwsIHsgbm9fcmVhZHlfY2hlY2s6IHRydWUgfSk7XG5cbiAgaWYgKHJlZGlzQ2xpKSB7XG4gICAgcmVkaXNDbGkucHVibGlzaDIgPSByZWRpc0NsaS5wdWJsaXNoO1xuXG4gICAgcmVkaXNDbGkucHVibGlzaCA9IGZ1bmN0aW9uIChjaGFubmVsLCBib2R5KSB7XG4gICAgICB2YXIgYm9keU9iamVjdDtcbiAgICAgIHRyeSB7XG4gICAgICAgIGJvZHlPYmplY3QgPSBKU09OLnBhcnNlKGJvZHkpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBib2R5T2JqZWN0ID0ge307XG4gICAgICB9XG4gICAgICBpZiAoYm9keU9iamVjdCAmJiBib2R5T2JqZWN0LnB1c2hTdGF0dXMpIHtcbiAgICAgICAgcmVkaXNDbGkubXVsdGkoW1xuICAgICAgICAgIFsnc2FkZCcsIGJvZHlPYmplY3QuYXBwbGljYXRpb25JZCArICc6cHVzaCcsIGJvZHldXG4gICAgICAgIF0pLmV4ZWMoKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiByZWRpc0NsaS5wdWJsaXNoMihjaGFubmVsLCBib2R5KTtcbiAgICB9O1xuICB9XG5cbiAgcmV0dXJuIHJlZGlzQ2xpO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVTdWJzY3JpYmVyKHtyZWRpc1VSTH0pOiBhbnkge1xuICB2YXIgcmVkaXNDbGkgPSByZWRpcy5jcmVhdGVDbGllbnQocmVkaXNVUkwsIHsgbm9fcmVhZHlfY2hlY2s6IHRydWUgfSk7XG4gIHZhciBzZWNvbmRhcnlDbGllbnQgPSByZWRpcy5jcmVhdGVDbGllbnQocmVkaXNVUkwsIHsgbm9fcmVhZHlfY2hlY2s6IHRydWUgfSk7XG4gIGlmIChyZWRpc0NsaSkge1xuICAgIHJlZGlzQ2xpLnJ1biA9IGZ1bmN0aW9uICh3b3JrSXRlbSkge1xuICAgICAgcmV0dXJuIG5ldyBQYXJzZS5Qcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlKSB7XG4gICAgICAgIHNlY29uZGFyeUNsaWVudFxuICAgICAgICAgIC5tdWx0aShbXG4gICAgICAgICAgICBbJ3Nwb3AnLCB3b3JrSXRlbS5hcHBsaWNhdGlvbklkICsgJzpwdXNoJ11cbiAgICAgICAgICBdKVxuICAgICAgICAgIC5leGVjKGZ1bmN0aW9uIChlcnIsIHJlcCkge1xuICAgICAgICAgICAgaWYgKCFlcnIgJiYgcmVwICYmIHJlcFswXSkge1xuICAgICAgICAgICAgICByZXNvbHZlKEpTT04ucGFyc2UocmVwWzBdKSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcbiAgICAgIH0pO1xuICAgIH07XG4gIH1cblxuICByZXR1cm4gcmVkaXNDbGk7XG59XG5cbmNvbnN0IFJlZGlzUHViU3ViID0ge1xuICBjcmVhdGVQdWJsaXNoZXIsXG4gIGNyZWF0ZVN1YnNjcmliZXJcbn07XG5cbmV4cG9ydCB7XG4gIFJlZGlzUHViU3ViLFxuICBjcmVhdGVQdWJsaXNoZXIsXG4gIGNyZWF0ZVN1YnNjcmliZXJcbn1cbiJdfQ==