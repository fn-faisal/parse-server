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
            pushStatus.fail(errors[0]);
          } else {
            pushStatus.setRunning(maxPages - errors.length);
          }
        }
      });
    });
  }
}
exports.PushQueue = PushQueue;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9QdXNoL1B1c2hRdWV1ZS5qcyJdLCJuYW1lcyI6WyJQVVNIX0NIQU5ORUwiLCJERUZBVUxUX0JBVENIX1NJWkUiLCJQdXNoUXVldWUiLCJjb25zdHJ1Y3RvciIsImNvbmZpZyIsImNoYW5uZWwiLCJkZWZhdWx0UHVzaENoYW5uZWwiLCJiYXRjaFNpemUiLCJwYXJzZVB1Ymxpc2hlciIsIlBhcnNlTWVzc2FnZVF1ZXVlIiwiY3JlYXRlUHVibGlzaGVyIiwiUGFyc2UiLCJhcHBsaWNhdGlvbklkIiwiZW5xdWV1ZSIsImJvZHkiLCJ3aGVyZSIsImF1dGgiLCJwdXNoU3RhdHVzIiwibGltaXQiLCJQcm9taXNlIiwicmVzb2x2ZSIsInRoZW4iLCJyZXN0IiwiZmluZCIsImNvdW50IiwicmVzdWx0cyIsImNvbXBsZXRlIiwibWF4UGFnZXMiLCJNYXRoIiwiY2VpbCIsInNldFJ1bm5pbmciLCJza2lwIiwicGFnZSIsInByb21pc2VzIiwiX2lkIiwib2JqZWN0SWQiLCJxdWVyeSIsInB1c2hXb3JrSXRlbSIsInByb21pc2UiLCJwdWJsaXNoIiwiSlNPTiIsInN0cmluZ2lmeSIsImNhdGNoIiwiZXJyIiwibG9nIiwiZXJyb3IiLCJtZXNzYWdlIiwic3RhY2siLCJwdXNoIiwiYWxsIiwiZXJyb3JzIiwiZmlsdGVyIiwiciIsIkVycm9yIiwibGVuZ3RoIiwiZmFpbCJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUFBOztBQUNBOzs7O0FBQ0E7O0FBQ0E7Ozs7QUFDQTs7Ozs7O0FBRUEsTUFBTUEsZUFBZSxtQkFBckI7QUFDQSxNQUFNQyxxQkFBcUIsR0FBM0I7O0FBRU8sTUFBTUMsU0FBTixDQUFnQjs7QUFLckI7QUFDQTtBQUNBQyxjQUFZQyxTQUFjLEVBQTFCLEVBQThCO0FBQzVCLFNBQUtDLE9BQUwsR0FBZUQsT0FBT0MsT0FBUCxJQUFrQkgsVUFBVUksa0JBQVYsRUFBakM7QUFDQSxTQUFLQyxTQUFMLEdBQWlCSCxPQUFPRyxTQUFQLElBQW9CTixrQkFB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dWUgfSAgICAgIGZyb20gJy4uL1BhcnNlTWVzc2FnZVF1ZXVlJztcbmltcG9ydCByZXN0ICAgICAgICAgICAgICAgICAgICAgICBmcm9tICcuLi9yZXN0JztcbmltcG9ydCB7IGFwcGx5RGV2aWNlVG9rZW5FeGlzdHMsIGdldElkSW50ZXJ2YWwgfSBmcm9tICcuL3V0aWxzJztcbmltcG9ydCBQYXJzZSBmcm9tICdwYXJzZS9ub2RlJztcbmltcG9ydCBsb2cgZnJvbSAnLi4vbG9nZ2VyJztcblxuY29uc3QgUFVTSF9DSEFOTkVMID0gJ3BhcnNlLXNlcnZlci1wdXNoJztcbmNvbnN0IERFRkFVTFRfQkFUQ0hfU0laRSA9IDEwMDtcblxuZXhwb3J0IGNsYXNzIFB1c2hRdWV1ZSB7XG4gIHBhcnNlUHVibGlzaGVyOiBPYmplY3Q7XG4gIGNoYW5uZWw6IFN0cmluZztcbiAgYmF0Y2hTaXplOiBOdW1iZXI7XG5cbiAgLy8gY29uZmlnIG9iamVjdCBvZiB0aGUgcHVibGlzaGVyLCByaWdodCBub3cgaXQgb25seSBjb250YWlucyB0aGUgcmVkaXNVUkwsXG4gIC8vIGJ1dCB3ZSBtYXkgZXh0ZW5kIGl0IGxhdGVyLlxuICBjb25zdHJ1Y3Rvcihjb25maWc6IGFueSA9IHt9KSB7XG4gICAgdGhpcy5jaGFubmVsID0gY29uZmlnLmNoYW5uZWwgfHwgUHVzaFF1ZXVlLmRlZmF1bHRQdXNoQ2hhbm5lbCgpO1xuICAgIHRoaXMuYmF0Y2hTaXplID0gY29uZmlnLmJhdGNoU2l6ZSB8fCBERUZBVUxUX0JBVENIX1NJWkU7XG4gICAgdGhpcy5wYXJzZVB1Ymxpc2hlciA9IFBhcnNlTWVzc2FnZVF1ZXVlLmNyZWF0ZVB1Ymxpc2hlcihjb25maWcpO1xuICB9XG5cbiAgc3RhdGljIGRlZmF1bHRQdXNoQ2hhbm5lbCgpIHtcbiAgICByZXR1cm4gYCR7UGFyc2UuYXBwbGljYXRpb25JZH0tJHtQVVNIX0NIQU5ORUx9YDtcbiAgfVxuXG4gIGVucXVldWUoYm9keSwgd2hlcmUsIGNvbmZpZywgYXV0aCwgcHVzaFN0YXR1cykge1xuICAgIGNvbnN0IGxpbWl0ID0gdGhpcy5iYXRjaFNpemU7XG5cbiAgICB3aGVyZSA9IGFwcGx5RGV2aWNlVG9rZW5FeGlzdHMod2hlcmUpO1xuXG4gICAgLy8gT3JkZXIgYnkgb2JqZWN0SWQgc28gbm8gaW1wYWN0IG9uIHRoZSBEQlxuICAgIC8vIGNvbnN0IG9yZGVyID0gJ29iamVjdElkJztcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gcmVzdC5maW5kKGNvbmZpZyxcbiAgICAgICAgYXV0aCxcbiAgICAgICAgJ19JbnN0YWxsYXRpb24nLFxuICAgICAgICB3aGVyZSxcbiAgICAgICAge2xpbWl0OiAwLCBjb3VudDogdHJ1ZX0pO1xuICAgIH0pLnRoZW4oKHtyZXN1bHRzLCBjb3VudH0pID0+IHtcbiAgICAgIGlmICghcmVzdWx0cyB8fCBjb3VudCA9PSAwKSB7XG4gICAgICAgIHJldHVybiBwdXNoU3RhdHVzLmNvbXBsZXRlKCk7XG4gICAgICB9XG4gICAgICBjb25zdCBtYXhQYWdlcyA9IE1hdGguY2VpbChjb3VudCAvIGxpbWl0KVxuICAgICAgcHVzaFN0YXR1cy5zZXRSdW5uaW5nKG1heFBhZ2VzKTtcbiAgICAgIGxldCBza2lwID0gMCwgcGFnZSA9IDA7XG4gICAgICBjb25zdCBwcm9taXNlcyA9IFtdXG4gICAgICB3aGlsZSAoc2tpcCA8IGNvdW50KSB7XG4gICAgICAgIGNvbnN0IF9pZCA9IGdldElkSW50ZXJ2YWwocGFnZSwgbWF4UGFnZXMpXG4gICAgICAgIGlmIChfaWQpIHdoZXJlLm9iamVjdElkID0gX2lkXG4gICAgICAgIGNvbnN0IHF1ZXJ5ID0geyB3aGVyZSB9O1xuICAgICAgICAvLyBjb25zdCBxdWVyeSA9IHsgd2hlcmUsXG4gICAgICAgIC8vICAgbGltaXQsXG4gICAgICAgIC8vICAgc2tpcCxcbiAgICAgICAgLy8gICBvcmRlciB9O1xuXG4gICAgICAgIGNvbnN0IHB1c2hXb3JrSXRlbSA9IHtcbiAgICAgICAgICBib2R5LFxuICAgICAgICAgIHF1ZXJ5LFxuICAgICAgICAgIHB1c2hTdGF0dXM6IHsgb2JqZWN0SWQ6IHB1c2hTdGF0dXMub2JqZWN0SWQgfSxcbiAgICAgICAgICBhcHBsaWNhdGlvbklkOiBjb25maWcuYXBwbGljYXRpb25JZFxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHByb21pc2UgPSBQcm9taXNlLnJlc29sdmUodGhpcy5wYXJzZVB1Ymxpc2hlci5wdWJsaXNoKHRoaXMuY2hhbm5lbCwgSlNPTi5zdHJpbmdpZnkocHVzaFdvcmtJdGVtKSkpLmNhdGNoKGVyciA9PiB7XG4gICAgICAgICAgbG9nLmVycm9yKGVyci5tZXNzYWdlKVxuICAgICAgICAgIGxvZy5lcnJvcihlcnIuc3RhY2spXG4gICAgICAgICAgcmV0dXJuIGVyclxuICAgICAgICB9KVxuICAgICAgICBwcm9taXNlcy5wdXNoKHByb21pc2UpO1xuICAgICAgICBza2lwICs9IGxpbWl0O1xuICAgICAgICBwYWdlICsrO1xuICAgICAgfVxuICAgICAgLy8gaWYgc29tZSBlcnJvcnMgb2NjdXJzIHNldCBydW5uaW5nIHRvIG1heFBhZ2VzIC0gZXJyb3JzLmxlbmd0aFxuICAgICAgcmV0dXJuIFByb21pc2UuYWxsKHByb21pc2VzKS50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgICBjb25zdCBlcnJvcnMgPSByZXN1bHRzLmZpbHRlcihyID0+IHIgaW5zdGFuY2VvZiBFcnJvcilcbiAgICAgICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgaWYgKG1heFBhZ2VzIC0gZXJyb3JzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgcHVzaFN0YXR1cy5mYWlsKGVycm9yc1swXSlcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcHVzaFN0YXR1cy5zZXRSdW5uaW5nKG1heFBhZ2VzIC0gZXJyb3JzLmxlbmd0aCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxufVxuIl19