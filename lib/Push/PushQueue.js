'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PushQueue = undefined;

var _ParseMessageQueue = require('../ParseMessageQueue');

var _rest = require('../rest');

var _rest2 = _interopRequireDefault(_rest);

var _utils = require('./utils');

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

var _logger = require('../logger');

var _logger2 = _interopRequireDefault(_logger);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const PUSH_CHANNEL = 'parse-server-push';
const DEFAULT_BATCH_SIZE = 100;

class PushQueue {

  // config object of the publisher, right now it only contains the redisURL,
  // but we may extend it later.
  constructor(config = {}) {
    this.channel = config.channel || PushQueue.defaultPushChannel();
    this.batchSize = config.batchSize || DEFAULT_BATCH_SIZE;
    this.parsePublisher = _ParseMessageQueue.ParseMessageQueue.createPublisher(config);
  }

  static defaultPushChannel() {
    return `${_node2.default.applicationId}-${PUSH_CHANNEL}`;
  }

  enqueue(body, where, config, auth, pushStatus) {
    const limit = this.batchSize;

    where = (0, _utils.applyDeviceTokenExists)(where);

    // Order by objectId so no impact on the DB
    // const order = 'objectId';
    return Promise.resolve().then(() => {
      return _rest2.default.find(config, auth, '_Installation', where, { limit: 0, count: true });
    }).then(({ results, count }) => {
      if (!results || count == 0) {
        return pushStatus.complete();
      }
      const maxPages = Math.ceil(count / limit);
      pushStatus.setRunning(maxPages);
      let skip = 0,
          page = 0;
      const promises = [];
      while (skip < count) {
        const _id = (0, _utils.getIdInterval)(page, maxPages);
        if (_id) where.objectId = _id;
        const query = { where };
        // const query = { where,
        //   limit,
        //   skip,
        //   order };

        const pushWorkItem = {
          body,
          query,
          pushStatus: { objectId: pushStatus.objectId },
          applicationId: config.applicationId
        };
        const promise = Promise.resolve(this.parsePublisher.publish(this.channel, JSON.stringify(pushWorkItem))).catch(err => {
          _logger2.default.error(err.message);
          _logger2.default.error(err.stack);
          return err;
        });
        promises.push(promise);
        skip += limit;
        page++;
      }
      // if some errors occurs set running to maxPages - errors.length
      return Promise.all(promises).then(results => {
        const errors = results.filter(r => r instanceof Error);
        if (errors.length > 0) {
          if (maxPages - errors.length === 0) {
            throw `No package was sent: ${errors[0].message}\n${errors[0].stack}`;
          } else {
            pushStatus.setRunning(maxPages - errors.length);
          }
        }
      });
    });
  }
}
exports.PushQueue = PushQueue;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9QdXNoL1B1c2hRdWV1ZS5qcyJdLCJuYW1lcyI6WyJQVVNIX0NIQU5ORUwiLCJERUZBVUxUX0JBVENIX1NJWkUiLCJQdXNoUXVldWUiLCJjb25zdHJ1Y3RvciIsImNvbmZpZyIsImNoYW5uZWwiLCJkZWZhdWx0UHVzaENoYW5uZWwiLCJiYXRjaFNpemUiLCJwYXJzZVB1Ymxpc2hlciIsIlBhcnNlTWVzc2FnZVF1ZXVlIiwiY3JlYXRlUHVibGlzaGVyIiwiUGFyc2UiLCJhcHBsaWNhdGlvbklkIiwiZW5xdWV1ZSIsImJvZHkiLCJ3aGVyZSIsImF1dGgiLCJwdXNoU3RhdHVzIiwibGltaXQiLCJQcm9taXNlIiwicmVzb2x2ZSIsInRoZW4iLCJyZXN0IiwiZmluZCIsImNvdW50IiwicmVzdWx0cyIsImNvbXBsZXRlIiwibWF4UGFnZXMiLCJNYXRoIiwiY2VpbCIsInNldFJ1bm5pbmciLCJza2lwIiwicGFnZSIsInByb21pc2VzIiwiX2lkIiwib2JqZWN0SWQiLCJxdWVyeSIsInB1c2hXb3JrSXRlbSIsInByb21pc2UiLCJwdWJsaXNoIiwiSlNPTiIsInN0cmluZ2lmeSIsImNhdGNoIiwiZXJyIiwibG9nIiwiZXJyb3IiLCJtZXNzYWdlIiwic3RhY2siLCJwdXNoIiwiYWxsIiwiZXJyb3JzIiwiZmlsdGVyIiwiciIsIkVycm9yIiwibGVuZ3RoIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQUE7O0FBQ0E7Ozs7QUFDQTs7QUFDQTs7OztBQUNBOzs7Ozs7QUFFQSxNQUFNQSxlQUFlLG1CQUFyQjtBQUNBLE1BQU1DLHFCQUFxQixHQUEzQjs7QUFFTyxNQUFNQyxTQUFOLENBQWdCOztBQUtyQjtBQUNBO0FBQ0FDLGNBQVlDLFNBQWMsRUFBMUIsRUFBOEI7QUFDNUIsU0FBS0MsT0FBTCxHQUFlRCxPQUFPQyxPQUFQLElBQWtCSCxVQUFVSSxrQkFBVixFQUFqQztBQUNBLFNBQUtDLFNBQUwsR0FBaUJILE9BQU9HLFNBQVAsSUFBb0JOLGtCQUFyQztBQUNB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bXBvcnQgeyBQYXJzZU1lc3NhZ2VRdWV1ZSB9ICAgICAgZnJvbSAnLi4vUGFyc2VNZXNzYWdlUXVldWUnO1xuaW1wb3J0IHJlc3QgICAgICAgICAgICAgICAgICAgICAgIGZyb20gJy4uL3Jlc3QnO1xuaW1wb3J0IHsgYXBwbHlEZXZpY2VUb2tlbkV4aXN0cywgZ2V0SWRJbnRlcnZhbCB9IGZyb20gJy4vdXRpbHMnO1xuaW1wb3J0IFBhcnNlIGZyb20gJ3BhcnNlL25vZGUnO1xuaW1wb3J0IGxvZyBmcm9tICcuLi9sb2dnZXInO1xuXG5jb25zdCBQVVNIX0NIQU5ORUwgPSAncGFyc2Utc2VydmVyLXB1c2gnO1xuY29uc3QgREVGQVVMVF9CQVRDSF9TSVpFID0gMTAwO1xuXG5leHBvcnQgY2xhc3MgUHVzaFF1ZXVlIHtcbiAgcGFyc2VQdWJsaXNoZXI6IE9iamVjdDtcbiAgY2hhbm5lbDogU3RyaW5nO1xuICBiYXRjaFNpemU6IE51bWJlcjtcblxuICAvLyBjb25maWcgb2JqZWN0IG9mIHRoZSBwdWJsaXNoZXIsIHJpZ2h0IG5vdyBpdCBvbmx5IGNvbnRhaW5zIHRoZSByZWRpc1VSTCxcbiAgLy8gYnV0IHdlIG1heSBleHRlbmQgaXQgbGF0ZXIuXG4gIGNvbnN0cnVjdG9yKGNvbmZpZzogYW55ID0ge30pIHtcbiAgICB0aGlzLmNoYW5uZWwgPSBjb25maWcuY2hhbm5lbCB8fCBQdXNoUXVldWUuZGVmYXVsdFB1c2hDaGFubmVsKCk7XG4gICAgdGhpcy5iYXRjaFNpemUgPSBjb25maWcuYmF0Y2hTaXplIHx8IERFRkFVTFRfQkFUQ0hfU0laRTtcbiAgICB0aGlzLnBhcnNlUHVibGlzaGVyID0gUGFyc2VNZXNzYWdlUXVldWUuY3JlYXRlUHVibGlzaGVyKGNvbmZpZyk7XG4gIH1cblxuICBzdGF0aWMgZGVmYXVsdFB1c2hDaGFubmVsKCkge1xuICAgIHJldHVybiBgJHtQYXJzZS5hcHBsaWNhdGlvbklkfS0ke1BVU0hfQ0hBTk5FTH1gO1xuICB9XG5cbiAgZW5xdWV1ZShib2R5LCB3aGVyZSwgY29uZmlnLCBhdXRoLCBwdXNoU3RhdHVzKSB7XG4gICAgY29uc3QgbGltaXQgPSB0aGlzLmJhdGNoU2l6ZTtcblxuICAgIHdoZXJlID0gYXBwbHlEZXZpY2VUb2tlbkV4aXN0cyh3aGVyZSk7XG5cbiAgICAvLyBPcmRlciBieSBvYmplY3RJZCBzbyBubyBpbXBhY3Qgb24gdGhlIERCXG4gICAgLy8gY29uc3Qgb3JkZXIgPSAnb2JqZWN0SWQnO1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiByZXN0LmZpbmQoY29uZmlnLFxuICAgICAgICBhdXRoLFxuICAgICAgICAnX0luc3RhbGxhdGlvbicsXG4gICAgICAgIHdoZXJlLFxuICAgICAgICB7bGltaXQ6IDAsIGNvdW50OiB0cnVlfSk7XG4gICAgfSkudGhlbigoe3Jlc3VsdHMsIGNvdW50fSkgPT4ge1xuICAgICAgaWYgKCFyZXN1bHRzIHx8IGNvdW50ID09IDApIHtcbiAgICAgICAgcmV0dXJuIHB1c2hTdGF0dXMuY29tcGxldGUoKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IG1heFBhZ2VzID0gTWF0aC5jZWlsKGNvdW50IC8gbGltaXQpXG4gICAgICBwdXNoU3RhdHVzLnNldFJ1bm5pbmcobWF4UGFnZXMpO1xuICAgICAgbGV0IHNraXAgPSAwLCBwYWdlID0gMDtcbiAgICAgIGNvbnN0IHByb21pc2VzID0gW11cbiAgICAgIHdoaWxlIChza2lwIDwgY291bnQpIHtcbiAgICAgICAgY29uc3QgX2lkID0gZ2V0SWRJbnRlcnZhbChwYWdlLCBtYXhQYWdlcylcbiAgICAgICAgaWYgKF9pZCkgd2hlcmUub2JqZWN0SWQgPSBfaWRcbiAgICAgICAgY29uc3QgcXVlcnkgPSB7IHdoZXJlIH07XG4gICAgICAgIC8vIGNvbnN0IHF1ZXJ5ID0geyB3aGVyZSxcbiAgICAgICAgLy8gICBsaW1pdCxcbiAgICAgICAgLy8gICBza2lwLFxuICAgICAgICAvLyAgIG9yZGVyIH07XG5cbiAgICAgICAgY29uc3QgcHVzaFdvcmtJdGVtID0ge1xuICAgICAgICAgIGJvZHksXG4gICAgICAgICAgcXVlcnksXG4gICAgICAgICAgcHVzaFN0YXR1czogeyBvYmplY3RJZDogcHVzaFN0YXR1cy5vYmplY3RJZCB9LFxuICAgICAgICAgIGFwcGxpY2F0aW9uSWQ6IGNvbmZpZy5hcHBsaWNhdGlvbklkXG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSh0aGlzLnBhcnNlUHVibGlzaGVyLnB1Ymxpc2godGhpcy5jaGFubmVsLCBKU09OLnN0cmluZ2lmeShwdXNoV29ya0l0ZW0pKSkuY2F0Y2goZXJyID0+IHtcbiAgICAgICAgICBsb2cuZXJyb3IoZXJyLm1lc3NhZ2UpXG4gICAgICAgICAgbG9nLmVycm9yKGVyci5zdGFjaylcbiAgICAgICAgICByZXR1cm4gZXJyXG4gICAgICAgIH0pXG4gICAgICAgIHByb21pc2VzLnB1c2gocHJvbWlzZSk7XG4gICAgICAgIHNraXAgKz0gbGltaXQ7XG4gICAgICAgIHBhZ2UgKys7XG4gICAgICB9XG4gICAgICAvLyBpZiBzb21lIGVycm9ycyBvY2N1cnMgc2V0IHJ1bm5pbmcgdG8gbWF4UGFnZXMgLSBlcnJvcnMubGVuZ3RoXG4gICAgICByZXR1cm4gUHJvbWlzZS5hbGwocHJvbWlzZXMpLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICAgIGNvbnN0IGVycm9ycyA9IHJlc3VsdHMuZmlsdGVyKHIgPT4gciBpbnN0YW5jZW9mIEVycm9yKVxuICAgICAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBpZiAobWF4UGFnZXMgLSBlcnJvcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICB0aHJvdyBgTm8gcGFja2FnZSB3YXMgc2VudDogJHtlcnJvcnNbMF0ubWVzc2FnZX1cXG4ke2Vycm9yc1swXS5zdGFja31gXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHB1c2hTdGF0dXMuc2V0UnVubmluZyhtYXhQYWdlcyAtIGVycm9ycy5sZW5ndGgpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==