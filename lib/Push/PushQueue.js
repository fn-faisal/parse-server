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
        if (errorMessages.length === 0) {
          _logger2.default.warn(`All ${maxPages} packages were enqueued for PushStatus ${pushStatus.objectId}`);
        } else {
          const errors = _lodash2.default.countBy(errorMessages) || {};
          const errorsString = JSON.stringify(errors);
          const packagesSent = maxPages - errorMessages.length;
          if (packagesSent === 0) {
            const errorMessage = `No one push package was enqueued for PushStatus ${pushStatus.objectId}: ${errorsString}`;
            _logger2.default.error(errorMessage);
            // throwing error will set status to error
            throw errorMessage;
          } else {
            _logger2.default.warn(`${packagesSent} packages where enqueued and some errors happened for PushStatus ${pushStatus.objectId}: ${errorsString}`);
            pushStatus.setRunning(maxPages - errors.length);
          }
        }
      });
    });
  }
}
exports.PushQueue = PushQueue;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9QdXNoL1B1c2hRdWV1ZS5qcyJdLCJuYW1lcyI6WyJQVVNIX0NIQU5ORUwiLCJERUZBVUxUX0JBVENIX1NJWkUiLCJQdXNoUXVldWUiLCJjb25zdHJ1Y3RvciIsImNvbmZpZyIsImNoYW5uZWwiLCJkZWZhdWx0UHVzaENoYW5uZWwiLCJiYXRjaFNpemUiLCJwYXJzZVB1Ymxpc2hlciIsIlBhcnNlTWVzc2FnZVF1ZXVlIiwiY3JlYXRlUHVibGlzaGVyIiwiUGFyc2UiLCJhcHBsaWNhdGlvbklkIiwiZW5xdWV1ZSIsImJvZHkiLCJ3aGVyZSIsImF1dGgiLCJwdXNoU3RhdHVzIiwibGltaXQiLCJQcm9taXNlIiwicmVzb2x2ZSIsInRoZW4iLCJyZXN0IiwiZmluZCIsImNvdW50IiwicmVzdWx0cyIsImNvbXBsZXRlIiwibWF4UGFnZXMiLCJNYXRoIiwiY2VpbCIsInNldFJ1bm5pbmciLCJwYWdlIiwicHJvbWlzZXMiLCJpZFJhbmdlIiwib2JqZWN0SWQiLCJxdWVyeSIsInB1c2hXb3JrSXRlbSIsInB1Ymxpc2hSZXN1bHQiLCJwdWJsaXNoIiwiSlNPTiIsInN0cmluZ2lmeSIsInByb21pc2UiLCJjYXRjaCIsImVyciIsInB1c2giLCJhbGwiLCJlcnJvck1lc3NhZ2VzIiwiZmlsdGVyIiwiciIsIkVycm9yIiwibWFwIiwiZSIsIm1lc3NhZ2UiLCJsZW5ndGgiLCJsb2ciLCJ3YXJuIiwiZXJyb3JzIiwiXyIsImNvdW50QnkiLCJlcnJvcnNTdHJpbmciLCJwYWNrYWdlc1NlbnQiLCJlcnJvck1lc3NhZ2UiLCJlcnJvciJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUFBOztBQUNBOzs7O0FBQ0E7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7Ozs7QUFFQSxNQUFNQSxlQUFlLG1CQUFyQjtBQUNBLE1BQU1DLHFCQUFxQixHQUEzQjs7QUFFTyxNQUFNQyxTQUFOLENBQWdCOztBQUtyQjtBQUNBO0FBQ0FDLGNBQVlDLFNBQWMsRUFBMUIsRUFBOEI7QUFDNUIs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LEVBQXdCO0FBQ3RCLGtCQUFNQyxlQUFnQixtREFBa0Q1QyxXQUFXaUIsUUFBUyxLQUFJeUIsWUFBYSxFQUE3RztBQUNBTCw2QkFBSVEsS0FBSixDQUFVRCxZQUFWO0FBQ0E7QUFDQSxrQkFBTUEsWUFBTjtBQUNELFdBTEQsTUFLTztBQUNMUCw2QkFBSUMsSUFBSixDQUFVLEdBQUVLLFlBQWEsb0VBQW1FM0MsV0FBV2lCLFFBQVMsS0FBSXlCLFlBQWEsRUFBakk7QUFDQTFDLHVCQUFXYSxVQUFYLENBQXNCSCxXQUFXNkIsT0FBT0gsTUFBeEM7QUFDRDtBQUNGO0FBQ0YsT0FsQk0sQ0FBUDtBQW1CRCxLQXZETSxDQUFQO0FBd0REO0FBaEZvQjtRQUFWbkQsUyxHQUFBQSxTIiwiZmlsZSI6IlB1c2hRdWV1ZS5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFBhcnNlTWVzc2FnZVF1ZXVlIH0gICAgICBmcm9tICcuLi9QYXJzZU1lc3NhZ2VRdWV1ZSc7XG5pbXBvcnQgcmVzdCAgICAgICAgICAgICAgICAgICAgICAgZnJvbSAnLi4vcmVzdCc7XG5pbXBvcnQgeyBhcHBseURldmljZVRva2VuRXhpc3RzLCBnZXRJZFJhbmdlIH0gZnJvbSAnLi91dGlscyc7XG5pbXBvcnQgUGFyc2UgZnJvbSAncGFyc2Uvbm9kZSc7XG5pbXBvcnQgbG9nIGZyb20gJy4uL2xvZ2dlcic7XG5pbXBvcnQgXyBmcm9tICdsb2Rhc2gnXG5cbmNvbnN0IFBVU0hfQ0hBTk5FTCA9ICdwYXJzZS1zZXJ2ZXItcHVzaCc7XG5jb25zdCBERUZBVUxUX0JBVENIX1NJWkUgPSAxMDA7XG5cbmV4cG9ydCBjbGFzcyBQdXNoUXVldWUge1xuICBwYXJzZVB1Ymxpc2hlcjogT2JqZWN0O1xuICBjaGFubmVsOiBTdHJpbmc7XG4gIGJhdGNoU2l6ZTogTnVtYmVyO1xuXG4gIC8vIGNvbmZpZyBvYmplY3Qgb2YgdGhlIHB1Ymxpc2hlciwgcmlnaHQgbm93IGl0IG9ubHkgY29udGFpbnMgdGhlIHJlZGlzVVJMLFxuICAvLyBidXQgd2UgbWF5IGV4dGVuZCBpdCBsYXRlci5cbiAgY29uc3RydWN0b3IoY29uZmlnOiBhbnkgPSB7fSkge1xuICAgIHRoaXMuY2hhbm5lbCA9IGNvbmZpZy5jaGFubmVsIHx8IFB1c2hRdWV1ZS5kZWZhdWx0UHVzaENoYW5uZWwoKTtcbiAgICB0aGlzLmJhdGNoU2l6ZSA9IGNvbmZpZy5iYXRjaFNpemUgfHwgREVGQVVMVF9CQVRDSF9TSVpFO1xuICAgIHRoaXMucGFyc2VQdWJsaXNoZXIgPSBQYXJzZU1lc3NhZ2VRdWV1ZS5jcmVhdGVQdWJsaXNoZXIoY29uZmlnKTtcbiAgfVxuXG4gIHN0YXRpYyBkZWZhdWx0UHVzaENoYW5uZWwoKSB7XG4gICAgcmV0dXJuIGAke1BhcnNlLmFwcGxpY2F0aW9uSWR9LSR7UFVTSF9DSEFOTkVMfWA7XG4gIH1cblxuICBlbnF1ZXVlKGJvZHksIHdoZXJlLCBjb25maWcsIGF1dGgsIHB1c2hTdGF0dXMpIHtcbiAgICBjb25zdCBsaW1pdCA9IHRoaXMuYmF0Y2hTaXplO1xuXG4gICAgd2hlcmUgPSBhcHBseURldmljZVRva2VuRXhpc3RzKHdoZXJlKTtcblxuICAgIC8vIE9yZGVyIGJ5IG9iamVjdElkIHNvIG5vIGltcGFjdCBvbiB0aGUgREJcbiAgICAvLyBjb25zdCBvcmRlciA9ICdvYmplY3RJZCc7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHJlc3QuZmluZChjb25maWcsXG4gICAgICAgIGF1dGgsXG4gICAgICAgICdfSW5zdGFsbGF0aW9uJyxcbiAgICAgICAgd2hlcmUsXG4gICAgICAgIHtsaW1pdDogMCwgY291bnQ6IHRydWV9KTtcbiAgICB9KS50aGVuKCh7cmVzdWx0cywgY291bnR9KSA9PiB7XG4gICAgICBpZiAoIXJlc3VsdHMgfHwgY291bnQgPT0gMCkge1xuICAgICAgICByZXR1cm4gcHVzaFN0YXR1cy5jb21wbGV0ZSgpO1xuICAgICAgfVxuICAgICAgY29uc3QgbWF4UGFnZXMgPSBNYXRoLmNlaWwoY291bnQgLyBsaW1pdClcbiAgICAgIHB1c2hTdGF0dXMuc2V0UnVubmluZyhtYXhQYWdlcyk7XG4gICAgICBsZXQgcGFnZSA9IDA7XG4gICAgICBjb25zdCBwcm9taXNlcyA9IFtdO1xuICAgICAgd2hpbGUgKHBhZ2UgPCBtYXhQYWdlcykge1xuICAgICAgICAvLyBjaGFuZ2VzIHJlcXVlc3QvbGltaXQvb3JkZXJCeSBieSBpZCByYW5nZSBpbnRlcnZhbHMgZm9yIGJldHRlciBwZXJmb3JtYW5jZVxuICAgICAgICAvLyBodHRwczovL2RvY3MubW9uZ29kYi5jb20vbWFudWFsL3JlZmVyZW5jZS9tZXRob2QvY3Vyc29yLnNraXAvXG4gICAgICAgIC8vIFJhbmdlIHF1ZXJpZXMgY2FuIHVzZSBpbmRleGVzIHRvIGF2b2lkIHNjYW5uaW5nIHVud2FudGVkIGRvY3VtZW50cyxcbiAgICAgICAgLy8gdHlwaWNhbGx5IHlpZWxkaW5nIGJldHRlciBwZXJmb3JtYW5jZSBhcyB0aGUgb2Zmc2V0IGdyb3dzIGNvbXBhcmVkXG4gICAgICAgIC8vIHRvIHVzaW5nIGN1cnNvci5za2lwKCkgZm9yIHBhZ2luYXRpb24uXG4gICAgICAgIGNvbnN0IGlkUmFuZ2UgPSBnZXRJZFJhbmdlKHBhZ2UsIG1heFBhZ2VzKVxuICAgICAgICBpZiAoaWRSYW5nZSkgd2hlcmUub2JqZWN0SWQgPSBpZFJhbmdlXG4gICAgICAgIGNvbnN0IHF1ZXJ5ID0geyB3aGVyZSB9O1xuXG4gICAgICAgIGNvbnN0IHB1c2hXb3JrSXRlbSA9IHtcbiAgICAgICAgICBib2R5LFxuICAgICAgICAgIHF1ZXJ5LFxuICAgICAgICAgIHB1c2hTdGF0dXM6IHsgb2JqZWN0SWQ6IHB1c2hTdGF0dXMub2JqZWN0SWQgfSxcbiAgICAgICAgICBhcHBsaWNhdGlvbklkOiBjb25maWcuYXBwbGljYXRpb25JZFxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHB1Ymxpc2hSZXN1bHQgPSB0aGlzLnBhcnNlUHVibGlzaGVyLnB1Ymxpc2godGhpcy5jaGFubmVsLCBKU09OLnN0cmluZ2lmeShwdXNoV29ya0l0ZW0pKVxuICAgICAgICBjb25zdCBwcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKHB1Ymxpc2hSZXN1bHQpLmNhdGNoKGVyciA9PiBlcnIpXG4gICAgICAgIHByb21pc2VzLnB1c2gocHJvbWlzZSk7XG4gICAgICAgIHBhZ2UgKys7XG4gICAgICB9XG4gICAgICAvLyBpZiBzb21lIGVycm9ycyBvY2N1cnMgc2V0IHJ1bm5pbmcgdG8gbWF4UGFnZXMgLSBlcnJvcnMubGVuZ3RoXG4gICAgICByZXR1cm4gUHJvbWlzZS5hbGwocHJvbWlzZXMpLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZXMgPSByZXN1bHRzLmZpbHRlcihyID0+IHIgaW5zdGFuY2VvZiBFcnJvcikubWFwKGUgPT4gZS5tZXNzYWdlIHx8IGUpO1xuICAgICAgICBpZiAoZXJyb3JNZXNzYWdlcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICBsb2cud2FybihgQWxsICR7bWF4UGFnZXN9IHBhY2thZ2VzIHdlcmUgZW5xdWV1ZWQgZm9yIFB1c2hTdGF0dXMgJHtwdXNoU3RhdHVzLm9iamVjdElkfWApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnN0IGVycm9ycyA9IF8uY291bnRCeShlcnJvck1lc3NhZ2VzKSB8fCB7fTtcbiAgICAgICAgICBjb25zdCBlcnJvcnNTdHJpbmcgPSBKU09OLnN0cmluZ2lmeShlcnJvcnMpO1xuICAgICAgICAgIGNvbnN0IHBhY2thZ2VzU2VudCA9IG1heFBhZ2VzIC0gZXJyb3JNZXNzYWdlcy5sZW5ndGg7XG4gICAgICAgICAgaWYgKHBhY2thZ2VzU2VudCA9PT0gMCkge1xuICAgICAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gYE5vIG9uZSBwdXNoIHBhY2thZ2Ugd2FzIGVucXVldWVkIGZvciBQdXNoU3RhdHVzICR7cHVzaFN0YXR1cy5vYmplY3RJZH06ICR7ZXJyb3JzU3RyaW5nfWA7XG4gICAgICAgICAgICBsb2cuZXJyb3IoZXJyb3JNZXNzYWdlKTtcbiAgICAgICAgICAgIC8vIHRocm93aW5nIGVycm9yIHdpbGwgc2V0IHN0YXR1cyB0byBlcnJvclxuICAgICAgICAgICAgdGhyb3cgZXJyb3JNZXNzYWdlO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBsb2cud2FybihgJHtwYWNrYWdlc1NlbnR9IHBhY2thZ2VzIHdoZXJlIGVucXVldWVkIGFuZCBzb21lIGVycm9ycyBoYXBwZW5lZCBmb3IgUHVzaFN0YXR1cyAke3B1c2hTdGF0dXMub2JqZWN0SWR9OiAke2Vycm9yc1N0cmluZ31gKTtcbiAgICAgICAgICAgIHB1c2hTdGF0dXMuc2V0UnVubmluZyhtYXhQYWdlcyAtIGVycm9ycy5sZW5ndGgpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==