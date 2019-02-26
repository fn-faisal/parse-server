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

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

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
      let page = 0;
      const promises = [];
      while (page < maxPages) {
        // changes request/limit/orderBy by id range intervals for better performance
        // https://docs.mongodb.com/manual/reference/method/cursor.skip/
        // Range queries can use indexes to avoid scanning unwanted documents,
        // typically yielding better performance as the offset grows compared
        // to using cursor.skip() for pagination.
        const idRange = (0, _utils.getIdRange)(page, maxPages);
        if (idRange) where.objectId = idRange;
        const query = { where };

        const pushWorkItem = {
          body,
          query,
          pushStatus: { objectId: pushStatus.objectId },
          applicationId: config.applicationId
        };
        const publishResult = this.parsePublisher.publish(this.channel, JSON.stringify(pushWorkItem));
        const promise = Promise.resolve(publishResult).catch(err => err);
        promises.push(promise);
        page++;
      }
      // if some errors occurs set running to maxPages - errors.length
      return Promise.all(promises).then(results => {
        const errorMessages = results.filter(r => r instanceof Error).map(e => e.message || e);
        const errors = _lodash2.default.countBy(errorMessages) || {};
        if (errorMessages.length > 0) {
          const errorsString = JSON.stringify(errors);
          const packagesSent = maxPages - errorMessages.length;
          if (packagesSent === 0) {
            const errorMessage = `No one push package was sent for PushStatus ${pushStatus.objectId}: ${errorsString}`;
            _logger2.default.error(errorMessage);
            // throwing error will set status to error
            throw errorMessage;
          } else {
            _logger2.default.warn(`${packagesSent} packages was sent and some errors happened for PushStatus ${pushStatus.objectId}: ${errorsString}`);
            pushStatus.setRunning(maxPages - errors.length);
          }
        }
      });
    });
  }
}
exports.PushQueue = PushQueue;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9QdXNoL1B1c2hRdWV1ZS5qcyJdLCJuYW1lcyI6WyJQVVNIX0NIQU5ORUwiLCJERUZBVUxUX0JBVENIX1NJWkUiLCJQdXNoUXVldWUiLCJjb25zdHJ1Y3RvciIsImNvbmZpZyIsImNoYW5uZWwiLCJkZWZhdWx0UHVzaENoYW5uZWwiLCJiYXRjaFNpemUiLCJwYXJzZVB1Ymxpc2hlciIsIlBhcnNlTWVzc2FnZVF1ZXVlIiwiY3JlYXRlUHVibGlzaGVyIiwiUGFyc2UiLCJhcHBsaWNhdGlvbklkIiwiZW5xdWV1ZSIsImJvZHkiLCJ3aGVyZSIsImF1dGgiLCJwdXNoU3RhdHVzIiwibGltaXQiLCJQcm9taXNlIiwicmVzb2x2ZSIsInRoZW4iLCJyZXN0IiwiZmluZCIsImNvdW50IiwicmVzdWx0cyIsImNvbXBsZXRlIiwibWF4UGFnZXMiLCJNYXRoIiwiY2VpbCIsInNldFJ1bm5pbmciLCJwYWdlIiwicHJvbWlzZXMiLCJpZFJhbmdlIiwib2JqZWN0SWQiLCJxdWVyeSIsInB1c2hXb3JrSXRlbSIsInB1Ymxpc2hSZXN1bHQiLCJwdWJsaXNoIiwiSlNPTiIsInN0cmluZ2lmeSIsInByb21pc2UiLCJjYXRjaCIsImVyciIsInB1c2giLCJhbGwiLCJlcnJvck1lc3NhZ2VzIiwiZmlsdGVyIiwiciIsIkVycm9yIiwibWFwIiwiZSIsIm1lc3NhZ2UiLCJlcnJvcnMiLCJfIiwiY291bnRCeSIsImxlbmd0aCIsImVycm9yc1N0cmluZyIsInBhY2thZ2VzU2VudCIsImVycm9yTWVzc2FnZSIsImxvZyIsImVycm9yIiwid2FybiJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUFBOztBQUNBOzs7O0FBQ0E7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7Ozs7QUFFQSxNQUFNQSxlQUFlLG1CQUFyQjtBQUNBLE1BQU1DLHFCQUFxQixHQUEzQjs7QUFFTyxNQUFNQyxTQUFOLENBQWdCOztBQUtyQjtBQUNBO0FBQ0FDLGNBQVlDLFNBQWMsRUFBMUIsRUFBOEI7QUFDNUIs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QUFKLENBQVVGLFlBQVY7QUFDQTtBQUNBLGtCQUFNQSxZQUFOO0FBQ0QsV0FMRCxNQUtPO0FBQ0xDLDZCQUFJRSxJQUFKLENBQVUsR0FBRUosWUFBYSw4REFBNkR6QyxXQUFXaUIsUUFBUyxLQUFJdUIsWUFBYSxFQUEzSDtBQUNBeEMsdUJBQVdhLFVBQVgsQ0FBc0JILFdBQVcwQixPQUFPRyxNQUF4QztBQUNEO0FBQ0Y7QUFDRixPQWhCTSxDQUFQO0FBaUJELEtBckRNLENBQVA7QUFzREQ7QUE5RW9CO1FBQVZ0RCxTLEdBQUFBLFMiLCJmaWxlIjoiUHVzaFF1ZXVlLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgUGFyc2VNZXNzYWdlUXVldWUgfSAgICAgIGZyb20gJy4uL1BhcnNlTWVzc2FnZVF1ZXVlJztcbmltcG9ydCByZXN0ICAgICAgICAgICAgICAgICAgICAgICBmcm9tICcuLi9yZXN0JztcbmltcG9ydCB7IGFwcGx5RGV2aWNlVG9rZW5FeGlzdHMsIGdldElkUmFuZ2UgfSBmcm9tICcuL3V0aWxzJztcbmltcG9ydCBQYXJzZSBmcm9tICdwYXJzZS9ub2RlJztcbmltcG9ydCBsb2cgZnJvbSAnLi4vbG9nZ2VyJztcbmltcG9ydCBfIGZyb20gJ2xvZGFzaCdcblxuY29uc3QgUFVTSF9DSEFOTkVMID0gJ3BhcnNlLXNlcnZlci1wdXNoJztcbmNvbnN0IERFRkFVTFRfQkFUQ0hfU0laRSA9IDEwMDtcblxuZXhwb3J0IGNsYXNzIFB1c2hRdWV1ZSB7XG4gIHBhcnNlUHVibGlzaGVyOiBPYmplY3Q7XG4gIGNoYW5uZWw6IFN0cmluZztcbiAgYmF0Y2hTaXplOiBOdW1iZXI7XG5cbiAgLy8gY29uZmlnIG9iamVjdCBvZiB0aGUgcHVibGlzaGVyLCByaWdodCBub3cgaXQgb25seSBjb250YWlucyB0aGUgcmVkaXNVUkwsXG4gIC8vIGJ1dCB3ZSBtYXkgZXh0ZW5kIGl0IGxhdGVyLlxuICBjb25zdHJ1Y3Rvcihjb25maWc6IGFueSA9IHt9KSB7XG4gICAgdGhpcy5jaGFubmVsID0gY29uZmlnLmNoYW5uZWwgfHwgUHVzaFF1ZXVlLmRlZmF1bHRQdXNoQ2hhbm5lbCgpO1xuICAgIHRoaXMuYmF0Y2hTaXplID0gY29uZmlnLmJhdGNoU2l6ZSB8fCBERUZBVUxUX0JBVENIX1NJWkU7XG4gICAgdGhpcy5wYXJzZVB1Ymxpc2hlciA9IFBhcnNlTWVzc2FnZVF1ZXVlLmNyZWF0ZVB1Ymxpc2hlcihjb25maWcpO1xuICB9XG5cbiAgc3RhdGljIGRlZmF1bHRQdXNoQ2hhbm5lbCgpIHtcbiAgICByZXR1cm4gYCR7UGFyc2UuYXBwbGljYXRpb25JZH0tJHtQVVNIX0NIQU5ORUx9YDtcbiAgfVxuXG4gIGVucXVldWUoYm9keSwgd2hlcmUsIGNvbmZpZywgYXV0aCwgcHVzaFN0YXR1cykge1xuICAgIGNvbnN0IGxpbWl0ID0gdGhpcy5iYXRjaFNpemU7XG5cbiAgICB3aGVyZSA9IGFwcGx5RGV2aWNlVG9rZW5FeGlzdHMod2hlcmUpO1xuXG4gICAgLy8gT3JkZXIgYnkgb2JqZWN0SWQgc28gbm8gaW1wYWN0IG9uIHRoZSBEQlxuICAgIC8vIGNvbnN0IG9yZGVyID0gJ29iamVjdElkJztcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gcmVzdC5maW5kKGNvbmZpZyxcbiAgICAgICAgYXV0aCxcbiAgICAgICAgJ19JbnN0YWxsYXRpb24nLFxuICAgICAgICB3aGVyZSxcbiAgICAgICAge2xpbWl0OiAwLCBjb3VudDogdHJ1ZX0pO1xuICAgIH0pLnRoZW4oKHtyZXN1bHRzLCBjb3VudH0pID0+IHtcbiAgICAgIGlmICghcmVzdWx0cyB8fCBjb3VudCA9PSAwKSB7XG4gICAgICAgIHJldHVybiBwdXNoU3RhdHVzLmNvbXBsZXRlKCk7XG4gICAgICB9XG4gICAgICBjb25zdCBtYXhQYWdlcyA9IE1hdGguY2VpbChjb3VudCAvIGxpbWl0KVxuICAgICAgcHVzaFN0YXR1cy5zZXRSdW5uaW5nKG1heFBhZ2VzKTtcbiAgICAgIGxldCBwYWdlID0gMDtcbiAgICAgIGNvbnN0IHByb21pc2VzID0gW107XG4gICAgICB3aGlsZSAocGFnZSA8IG1heFBhZ2VzKSB7XG4gICAgICAgIC8vIGNoYW5nZXMgcmVxdWVzdC9saW1pdC9vcmRlckJ5IGJ5IGlkIHJhbmdlIGludGVydmFscyBmb3IgYmV0dGVyIHBlcmZvcm1hbmNlXG4gICAgICAgIC8vIGh0dHBzOi8vZG9jcy5tb25nb2RiLmNvbS9tYW51YWwvcmVmZXJlbmNlL21ldGhvZC9jdXJzb3Iuc2tpcC9cbiAgICAgICAgLy8gUmFuZ2UgcXVlcmllcyBjYW4gdXNlIGluZGV4ZXMgdG8gYXZvaWQgc2Nhbm5pbmcgdW53YW50ZWQgZG9jdW1lbnRzLFxuICAgICAgICAvLyB0eXBpY2FsbHkgeWllbGRpbmcgYmV0dGVyIHBlcmZvcm1hbmNlIGFzIHRoZSBvZmZzZXQgZ3Jvd3MgY29tcGFyZWRcbiAgICAgICAgLy8gdG8gdXNpbmcgY3Vyc29yLnNraXAoKSBmb3IgcGFnaW5hdGlvbi5cbiAgICAgICAgY29uc3QgaWRSYW5nZSA9IGdldElkUmFuZ2UocGFnZSwgbWF4UGFnZXMpXG4gICAgICAgIGlmIChpZFJhbmdlKSB3aGVyZS5vYmplY3RJZCA9IGlkUmFuZ2VcbiAgICAgICAgY29uc3QgcXVlcnkgPSB7IHdoZXJlIH07XG5cbiAgICAgICAgY29uc3QgcHVzaFdvcmtJdGVtID0ge1xuICAgICAgICAgIGJvZHksXG4gICAgICAgICAgcXVlcnksXG4gICAgICAgICAgcHVzaFN0YXR1czogeyBvYmplY3RJZDogcHVzaFN0YXR1cy5vYmplY3RJZCB9LFxuICAgICAgICAgIGFwcGxpY2F0aW9uSWQ6IGNvbmZpZy5hcHBsaWNhdGlvbklkXG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcHVibGlzaFJlc3VsdCA9IHRoaXMucGFyc2VQdWJsaXNoZXIucHVibGlzaCh0aGlzLmNoYW5uZWwsIEpTT04uc3RyaW5naWZ5KHB1c2hXb3JrSXRlbSkpXG4gICAgICAgIGNvbnN0IHByb21pc2UgPSBQcm9taXNlLnJlc29sdmUocHVibGlzaFJlc3VsdCkuY2F0Y2goZXJyID0+IGVycilcbiAgICAgICAgcHJvbWlzZXMucHVzaChwcm9taXNlKTtcbiAgICAgICAgcGFnZSArKztcbiAgICAgIH1cbiAgICAgIC8vIGlmIHNvbWUgZXJyb3JzIG9jY3VycyBzZXQgcnVubmluZyB0byBtYXhQYWdlcyAtIGVycm9ycy5sZW5ndGhcbiAgICAgIHJldHVybiBQcm9taXNlLmFsbChwcm9taXNlcykudGhlbihyZXN1bHRzID0+IHtcbiAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlcyA9IHJlc3VsdHMuZmlsdGVyKHIgPT4gciBpbnN0YW5jZW9mIEVycm9yKS5tYXAoZSA9PiBlLm1lc3NhZ2UgfHwgZSk7XG4gICAgICAgIGNvbnN0IGVycm9ycyA9IF8uY291bnRCeShlcnJvck1lc3NhZ2VzKSB8fCB7fTtcbiAgICAgICAgaWYgKGVycm9yTWVzc2FnZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNvbnN0IGVycm9yc1N0cmluZyA9IEpTT04uc3RyaW5naWZ5KGVycm9ycyk7XG4gICAgICAgICAgY29uc3QgcGFja2FnZXNTZW50ID0gbWF4UGFnZXMgLSBlcnJvck1lc3NhZ2VzLmxlbmd0aDtcbiAgICAgICAgICBpZiAocGFja2FnZXNTZW50ID09PSAwKSB7XG4gICAgICAgICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBgTm8gb25lIHB1c2ggcGFja2FnZSB3YXMgc2VudCBmb3IgUHVzaFN0YXR1cyAke3B1c2hTdGF0dXMub2JqZWN0SWR9OiAke2Vycm9yc1N0cmluZ31gO1xuICAgICAgICAgICAgbG9nLmVycm9yKGVycm9yTWVzc2FnZSk7XG4gICAgICAgICAgICAvLyB0aHJvd2luZyBlcnJvciB3aWxsIHNldCBzdGF0dXMgdG8gZXJyb3JcbiAgICAgICAgICAgIHRocm93IGVycm9yTWVzc2FnZTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbG9nLndhcm4oYCR7cGFja2FnZXNTZW50fSBwYWNrYWdlcyB3YXMgc2VudCBhbmQgc29tZSBlcnJvcnMgaGFwcGVuZWQgZm9yIFB1c2hTdGF0dXMgJHtwdXNoU3RhdHVzLm9iamVjdElkfTogJHtlcnJvcnNTdHJpbmd9YCk7XG4gICAgICAgICAgICBwdXNoU3RhdHVzLnNldFJ1bm5pbmcobWF4UGFnZXMgLSBlcnJvcnMubGVuZ3RoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG59XG4iXX0=