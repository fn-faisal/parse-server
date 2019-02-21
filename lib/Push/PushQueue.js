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
        if (errors.length) {
          pushStatus.setRunning(maxPages - errors.length);
        }
      });
    });
  }
}
exports.PushQueue = PushQueue;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9QdXNoL1B1c2hRdWV1ZS5qcyJdLCJuYW1lcyI6WyJQVVNIX0NIQU5ORUwiLCJERUZBVUxUX0JBVENIX1NJWkUiLCJQdXNoUXVldWUiLCJjb25zdHJ1Y3RvciIsImNvbmZpZyIsImNoYW5uZWwiLCJkZWZhdWx0UHVzaENoYW5uZWwiLCJiYXRjaFNpemUiLCJwYXJzZVB1Ymxpc2hlciIsIlBhcnNlTWVzc2FnZVF1ZXVlIiwiY3JlYXRlUHVibGlzaGVyIiwiUGFyc2UiLCJhcHBsaWNhdGlvbklkIiwiZW5xdWV1ZSIsImJvZHkiLCJ3aGVyZSIsImF1dGgiLCJwdXNoU3RhdHVzIiwibGltaXQiLCJQcm9taXNlIiwicmVzb2x2ZSIsInRoZW4iLCJyZXN0IiwiZmluZCIsImNvdW50IiwicmVzdWx0cyIsImNvbXBsZXRlIiwibWF4UGFnZXMiLCJNYXRoIiwiY2VpbCIsInNldFJ1bm5pbmciLCJza2lwIiwicGFnZSIsInByb21pc2VzIiwiX2lkIiwib2JqZWN0SWQiLCJxdWVyeSIsInB1c2hXb3JrSXRlbSIsInByb21pc2UiLCJwdWJsaXNoIiwiSlNPTiIsInN0cmluZ2lmeSIsImNhdGNoIiwiZXJyIiwibG9nIiwiZXJyb3IiLCJtZXNzYWdlIiwic3RhY2siLCJwdXNoIiwiYWxsIiwiZXJyb3JzIiwiZmlsdGVyIiwiciIsIkVycm9yIiwibGVuZ3RoIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQUE7O0FBQ0E7Ozs7QUFDQTs7QUFDQTs7OztBQUNBOzs7Ozs7QUFFQSxNQUFNQSxlQUFlLG1CQUFyQjtBQUNBLE1BQU1DLHFCQUFxQixHQUEzQjs7QUFFTyxNQUFNQyxTQUFOLENBQWdCOztBQUtyQjtBQUNBO0FBQ0FDLGNBQVlDLFNBQWMsRUFBMUIsRUFBOEI7QUFDNUIsU0FBS0MsT0FBTCxHQUFlRCxPQUFPQyxPQUFQLElBQWtCSCxVQUFVSSxrQkFBVixFQUFqQztBQUNBLFNBQUtDLFNBQUwsR0FBaUJILE9BQU9HLFNBQVAsSUFBb0JOLGtCQUFyQztBQUNBLFNBQUtPLGNBQUwsR0FBc0JDLHFDQUFrQkMsZUFBbEIsQ0FBa0NOLE1BQWxDLENBQXRCO0FBQ0Q7O0FBRUQsU0FBT0Usa0JBQVAsR0FBNEI7QUFDMUIsV0FBUSxHQUFFSyxlQUFNQyxhQUFjLElBQUdaLFlBQWEsRUFBOUM7QUFDRDs7QUFFRGEsVUFBUUMsSUFBUixFQUFjQyxLQUFkLEVBQXFCWCxNQUFyQixFQUE2QlksSUFBN0IsRUFBbUNDLFVBQW5DLEVBQStDO0FBQzdDLFVBQU1DLFFBQVEsS0FBS1gsU0FBbkI7O0FBRUFRLFlBQVEsbUNBQXVCQSxLQUF2QixDQUFSOztBQUVBO0FBQ0E7QUFDQSxXQUFPSSxRQUFRQyxPQUFSLEdBQWtCQyxJQUFsQixDQUF1QixNQUFNO0FBQ2xDLGFBQU9DLGVBQUtDLElBQUwsQ0FBVW5CLE1BQVYsRUFDTFksSUFESyxFQUVMLGVBRkssRUFHTEQsS0FISyxFQUlMLEVBQUNHLE9BQU8sQ0FBUixFQUFXTSxPQUFPLElBQWxCLEVBSkssQ0FBUDtBQUtELEtBTk0sRUFNSkgsSUFOSSxDQU1DLENBQUMsRUFBQ0ksT0FBRCxFQUFVRCxLQUFWLEVBQUQsS0FBc0I7QUFDNUIsVUFBSSxDQUFDQyxPQUFELElBQVlELFNBQVMsQ0FBekIsRUFBNEI7QUFDMUIsZUFBT1AsV0FBV1MsUUFBWCxFQUFQO0FBQ0Q7QUFDRCxZQUFNQyxXQUFXQyxLQUFLQyxJQUFMLENBQVVMLFFBQVFOLEtBQWxCLENBQWpCO0FBQ0FELGlCQUFXYSxVQUFYLENBQXNCSCxRQUF0QjtBQUNBLFVBQUlJLE9BQU8sQ0FBWDtBQUFBLFVBQWNDLE9BQU8sQ0FBckI7QUFDQSxZQUFNQyxXQUFXLEVBQWpCO0FBQ0EsYUFBT0YsT0FBT1AsS0FBZCxFQUFxQjtBQUNuQixjQUFNVSxNQUFNLDBCQUFjRixJQUFkLEVBQW9CTCxRQUFwQixDQUFaO0FBQ0EsWUFBSU8sR0FBSixFQUFTbkIsTUFBTW9CLFFBQU4sR0FBaUJELEdBQWpCO0FBQ1QsY0FBTUUsUUFBUSxFQUFFckIsS0FBRixFQUFkO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsY0FBTXNCLGVBQWU7QUFDbkJ2QixjQURtQjtBQUVuQnNCLGVBRm1CO0FBR25CbkIsc0JBQVksRUFBRWtCLFVBQVVsQixXQUFXa0IsUUFBdkIsRUFITztBQUluQnZCLHlCQUFlUixPQUFPUTtBQUpILFNBQXJCO0FBTUEsY0FBTTBCLFVBQVVuQixRQUFRQyxPQUFSLENBQWdCLEtBQUtaLGNBQUwsQ0FBb0IrQixPQUFwQixDQUE0QixLQUFLbEMsT0FBakMsRUFBMENtQyxLQUFLQyxTQUFMLENBQWVKLFlBQWYsQ0FBMUMsQ0FBaEIsRUFBeUZLLEtBQXpGLENBQStGQyxPQUFPO0FBQ3BIQywyQkFBSUMsS0FBSixDQUFVRixJQUFJRyxPQUFkO0FBQ0FGLDJCQUFJQyxLQUFKLENBQVVGLElBQUlJLEtBQWQ7QUFDQSxpQkFBT0osR0FBUDtBQUNELFNBSmUsQ0FBaEI7QUFLQVYsaUJBQVNlLElBQVQsQ0FBY1YsT0FBZDtBQUNBUCxnQkFBUWIsS0FBUjtBQUNBYztBQUNEO0FBQ0Q7QUFDQSxhQUFPYixRQUFROEIsR0FBUixDQUFZaEIsUUFBWixFQUFzQlosSUFBdEIsQ0FBMkJJLFdBQVc7QUFDM0MsY0FBTXlCLFNBQVN6QixRQUFRMEIsTUFBUixDQUFlQyxLQUFLQSxhQUFhQyxLQUFqQyxDQUFmO0FBQ0EsWUFBSUgsT0FBT0ksTUFBWCxFQUFtQjtBQUNqQnJDLHFCQUFXYSxVQUFYLENBQXNCSCxXQUFXdUIsT0FBT0ksTUFBeEM7QUFDRDtBQUNGLE9BTE0sQ0FBUDtBQU1ELEtBN0NNLENBQVA7QUE4Q0Q7QUF0RW9CO1FBQVZwRCxTLEdBQUFBLFMiLCJmaWxlIjoiUHVzaFF1ZXVlLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgUGFyc2VNZXNzYWdlUXVldWUgfSAgICAgIGZyb20gJy4uL1BhcnNlTWVzc2FnZVF1ZXVlJztcbmltcG9ydCByZXN0ICAgICAgICAgICAgICAgICAgICAgICBmcm9tICcuLi9yZXN0JztcbmltcG9ydCB7IGFwcGx5RGV2aWNlVG9rZW5FeGlzdHMsIGdldElkSW50ZXJ2YWwgfSBmcm9tICcuL3V0aWxzJztcbmltcG9ydCBQYXJzZSBmcm9tICdwYXJzZS9ub2RlJztcbmltcG9ydCBsb2cgZnJvbSAnLi4vbG9nZ2VyJztcblxuY29uc3QgUFVTSF9DSEFOTkVMID0gJ3BhcnNlLXNlcnZlci1wdXNoJztcbmNvbnN0IERFRkFVTFRfQkFUQ0hfU0laRSA9IDEwMDtcblxuZXhwb3J0IGNsYXNzIFB1c2hRdWV1ZSB7XG4gIHBhcnNlUHVibGlzaGVyOiBPYmplY3Q7XG4gIGNoYW5uZWw6IFN0cmluZztcbiAgYmF0Y2hTaXplOiBOdW1iZXI7XG5cbiAgLy8gY29uZmlnIG9iamVjdCBvZiB0aGUgcHVibGlzaGVyLCByaWdodCBub3cgaXQgb25seSBjb250YWlucyB0aGUgcmVkaXNVUkwsXG4gIC8vIGJ1dCB3ZSBtYXkgZXh0ZW5kIGl0IGxhdGVyLlxuICBjb25zdHJ1Y3Rvcihjb25maWc6IGFueSA9IHt9KSB7XG4gICAgdGhpcy5jaGFubmVsID0gY29uZmlnLmNoYW5uZWwgfHwgUHVzaFF1ZXVlLmRlZmF1bHRQdXNoQ2hhbm5lbCgpO1xuICAgIHRoaXMuYmF0Y2hTaXplID0gY29uZmlnLmJhdGNoU2l6ZSB8fCBERUZBVUxUX0JBVENIX1NJWkU7XG4gICAgdGhpcy5wYXJzZVB1Ymxpc2hlciA9IFBhcnNlTWVzc2FnZVF1ZXVlLmNyZWF0ZVB1Ymxpc2hlcihjb25maWcpO1xuICB9XG5cbiAgc3RhdGljIGRlZmF1bHRQdXNoQ2hhbm5lbCgpIHtcbiAgICByZXR1cm4gYCR7UGFyc2UuYXBwbGljYXRpb25JZH0tJHtQVVNIX0NIQU5ORUx9YDtcbiAgfVxuXG4gIGVucXVldWUoYm9keSwgd2hlcmUsIGNvbmZpZywgYXV0aCwgcHVzaFN0YXR1cykge1xuICAgIGNvbnN0IGxpbWl0ID0gdGhpcy5iYXRjaFNpemU7XG5cbiAgICB3aGVyZSA9IGFwcGx5RGV2aWNlVG9rZW5FeGlzdHMod2hlcmUpO1xuXG4gICAgLy8gT3JkZXIgYnkgb2JqZWN0SWQgc28gbm8gaW1wYWN0IG9uIHRoZSBEQlxuICAgIC8vIGNvbnN0IG9yZGVyID0gJ29iamVjdElkJztcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gcmVzdC5maW5kKGNvbmZpZyxcbiAgICAgICAgYXV0aCxcbiAgICAgICAgJ19JbnN0YWxsYXRpb24nLFxuICAgICAgICB3aGVyZSxcbiAgICAgICAge2xpbWl0OiAwLCBjb3VudDogdHJ1ZX0pO1xuICAgIH0pLnRoZW4oKHtyZXN1bHRzLCBjb3VudH0pID0+IHtcbiAgICAgIGlmICghcmVzdWx0cyB8fCBjb3VudCA9PSAwKSB7XG4gICAgICAgIHJldHVybiBwdXNoU3RhdHVzLmNvbXBsZXRlKCk7XG4gICAgICB9XG4gICAgICBjb25zdCBtYXhQYWdlcyA9IE1hdGguY2VpbChjb3VudCAvIGxpbWl0KVxuICAgICAgcHVzaFN0YXR1cy5zZXRSdW5uaW5nKG1heFBhZ2VzKTtcbiAgICAgIGxldCBza2lwID0gMCwgcGFnZSA9IDA7XG4gICAgICBjb25zdCBwcm9taXNlcyA9IFtdXG4gICAgICB3aGlsZSAoc2tpcCA8IGNvdW50KSB7XG4gICAgICAgIGNvbnN0IF9pZCA9IGdldElkSW50ZXJ2YWwocGFnZSwgbWF4UGFnZXMpXG4gICAgICAgIGlmIChfaWQpIHdoZXJlLm9iamVjdElkID0gX2lkXG4gICAgICAgIGNvbnN0IHF1ZXJ5ID0geyB3aGVyZSB9O1xuICAgICAgICAvLyBjb25zdCBxdWVyeSA9IHsgd2hlcmUsXG4gICAgICAgIC8vICAgbGltaXQsXG4gICAgICAgIC8vICAgc2tpcCxcbiAgICAgICAgLy8gICBvcmRlciB9O1xuXG4gICAgICAgIGNvbnN0IHB1c2hXb3JrSXRlbSA9IHtcbiAgICAgICAgICBib2R5LFxuICAgICAgICAgIHF1ZXJ5LFxuICAgICAgICAgIHB1c2hTdGF0dXM6IHsgb2JqZWN0SWQ6IHB1c2hTdGF0dXMub2JqZWN0SWQgfSxcbiAgICAgICAgICBhcHBsaWNhdGlvbklkOiBjb25maWcuYXBwbGljYXRpb25JZFxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHByb21pc2UgPSBQcm9taXNlLnJlc29sdmUodGhpcy5wYXJzZVB1Ymxpc2hlci5wdWJsaXNoKHRoaXMuY2hhbm5lbCwgSlNPTi5zdHJpbmdpZnkocHVzaFdvcmtJdGVtKSkpLmNhdGNoKGVyciA9PiB7XG4gICAgICAgICAgbG9nLmVycm9yKGVyci5tZXNzYWdlKVxuICAgICAgICAgIGxvZy5lcnJvcihlcnIuc3RhY2spXG4gICAgICAgICAgcmV0dXJuIGVyclxuICAgICAgICB9KVxuICAgICAgICBwcm9taXNlcy5wdXNoKHByb21pc2UpO1xuICAgICAgICBza2lwICs9IGxpbWl0O1xuICAgICAgICBwYWdlICsrO1xuICAgICAgfVxuICAgICAgLy8gaWYgc29tZSBlcnJvcnMgb2NjdXJzIHNldCBydW5uaW5nIHRvIG1heFBhZ2VzIC0gZXJyb3JzLmxlbmd0aFxuICAgICAgcmV0dXJuIFByb21pc2UuYWxsKHByb21pc2VzKS50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgICBjb25zdCBlcnJvcnMgPSByZXN1bHRzLmZpbHRlcihyID0+IHIgaW5zdGFuY2VvZiBFcnJvcilcbiAgICAgICAgaWYgKGVycm9ycy5sZW5ndGgpIHtcbiAgICAgICAgICBwdXNoU3RhdHVzLnNldFJ1bm5pbmcobWF4UGFnZXMgLSBlcnJvcnMubGVuZ3RoKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==