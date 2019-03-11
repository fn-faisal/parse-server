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
      _logger2.default.info(`All ${maxPages} packages were enqueued for PushStatus ${pushStatus.objectId}`);
      // while (page < maxPages) {
      // changes request/limit/orderBy by id range intervals for better performance
      // https://docs.mongodb.com/manual/reference/method/cursor.skip/
      // Range queries can use indexes to avoid scanning unwanted documents,
      // typically yielding better performance as the offset grows compared
      // to using cursor.skip() for pagination.
      const query = { where };

      const pushWorkItem = {
        body,
        query,
        maxPages,
        pushStatus: { objectId: pushStatus.objectId },
        applicationId: config.applicationId
      };
      const publishResult = Promise.resolve(this.parsePublisher.publish(this.channel, JSON.stringify(pushWorkItem)));
      return publishResult.then(reponse => {
        const result = reponse.data || reponse;
        _logger2.default.info(`All ${maxPages} packages were enqueued for PushStatus ${pushStatus.objectId}`, result);
        return result;
      });
    }).catch(err => {
      _logger2.default.info(`Can't count installations for PushStatus ${pushStatus.objectId}: ${err.message}`);
      throw err;
    });
  }
}
exports.PushQueue = PushQueue;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9QdXNoL1B1c2hRdWV1ZS5qcyJdLCJuYW1lcyI6WyJQVVNIX0NIQU5ORUwiLCJERUZBVUxUX0JBVENIX1NJWkUiLCJQdXNoUXVldWUiLCJjb25zdHJ1Y3RvciIsImNvbmZpZyIsImNoYW5uZWwiLCJkZWZhdWx0UHVzaENoYW5uZWwiLCJiYXRjaFNpemUiLCJwYXJzZVB1Ymxpc2hlciIsIlBhcnNlTWVzc2FnZVF1ZXVlIiwiY3JlYXRlUHVibGlzaGVyIiwiUGFyc2UiLCJhcHBsaWNhdGlvbklkIiwiZW5xdWV1ZSIsImJvZHkiLCJ3aGVyZSIsImF1dGgiLCJwdXNoU3RhdHVzIiwibGltaXQiLCJQcm9taXNlIiwicmVzb2x2ZSIsInRoZW4iLCJyZXN0IiwiZmluZCIsImNvdW50IiwicmVzdWx0cyIsImNvbXBsZXRlIiwibWF4UGFnZXMiLCJNYXRoIiwiY2VpbCIsInNldFJ1bm5pbmciLCJsb2ciLCJpbmZvIiwib2JqZWN0SWQiLCJxdWVyeSIsInB1c2hXb3JrSXRlbSIsInB1Ymxpc2hSZXN1bHQiLCJwdWJsaXNoIiwiSlNPTiIsInN0cmluZ2lmeSIsInJlcG9uc2UiLCJyZXN1bHQiLCJkYXRhIiwiY2F0Y2giLCJlcnIiLCJtZXNzYWdlIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQUE7O0FBQ0E7Ozs7QUFDQTs7QUFDQTs7OztBQUNBOzs7Ozs7QUFFQSxNQUFNQSxlQUFlLG1CQUFyQjtBQUNBLE1BQU1DLHFCQUFxQixHQUEzQjs7QUFFTyxNQUFNQyxTQUFOLENBQWdCOztBQUtyQjtBQUNBO0FBQ0FDLGNBQVlDLFNBQWMsRUFBMUIsRUFBOEI7QUFDNUIsU0FBS0MsT0FBTCxHQUFlRCxPQUFPQyxPQUFQLElBQWtCSCxVQUFVSSxrQkFBVixFQUFqQztBQUNBLFNBQUtDLFNBQUwsR0FBaUJILE9BQU9HLFNBQVAsSUFBb0JOLGtCQUFyQztBQUNBLFNBQUtPLGNBQUwsR0FBc0JDLHFDQUFrQkMsZUFBbEIsQ0FBa0NOLE1BQWxDLENBQXRCO0FBQ0Q7O0FBRUQsU0FBT0Usa0JBQVAsR0FBNEI7QUFDMUIsV0FBUSxHQUFFSyxlQUFNQyxhQUFjLElBQUdaLFlBQWEsRUFBOUM7QUFDRDs7QUFFRGEsVUFBUUMsSUFBUixFQUFjQyxLQUFkLEVBQXFCWCxNQUFyQixFQUE2QlksSUFBN0IsRUFBbUNDLFVBQW5DLEVBQStDO0FBQzdDLFVBQU1DLFFBQVEsS0FBS1gsU0FBbkI7O0FBRUFRLFlBQVEsbUNBQXVCQSxLQUF2QixDQUFSOztBQUVBO0FBQ0E7QUFDQSxXQUFPSSxRQUFRQyxPQUFSLEdBQWtCQyxJQUFsQixDQUF1QixNQUFNO0FBQ2xDLGFBQU9DLGVBQUtDLElBQUwsQ0FBVW5CLE1BQVYsRUFDTFksSUFESyxFQUVMLGVBRkssRUFHTEQsS0FISyxFQUlMLEVBQUNHLE9BQU8sQ0FBUixFQUFXTSxPQUFPLElBQWxCLEVBSkssQ0FBUDtBQUtELEtBTk0sRUFNSkgsSUFOSSxDQU1DLENBQUMsRUFBQ0ksT0FBRCxFQUFVRCxLQUFWLEVBQUQsS0FBc0I7QUFDNUIsVUFBSSxDQUFDQyxPQUFELElBQVlELFNBQVMsQ0FBekIsRUFBNEI7QUFDMUIsZUFBT1AsV0FBV1MsUUFBWCxFQUFQO0FBQ0Q7QUFDRCxZQUFNQyxXQUFXQyxLQUFLQyxJQUFMLENBQVVMLFFBQVFOLEtBQWxCLENBQWpCO0FBQ0FELGlCQUFXYSxVQUFYLENBQXNCSCxRQUF0QjtBQUNBSSx1QkFBSUMsSUFBSixDQUFVLE9BQU1MLFFBQVMsMENBQXlDVixXQUFXZ0IsUUFBUyxFQUF0RjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFlBQU1DLFFBQVEsRUFBRW5CLEtBQUYsRUFBZDs7QUFFQSxZQUFNb0IsZUFBZTtBQUNuQnJCLFlBRG1CO0FBRW5Cb0IsYUFGbUI7QUFHbkJQLGdCQUhtQjtBQUluQlYsb0JBQVksRUFBRWdCLFVBQVVoQixXQUFXZ0IsUUFBdkIsRUFKTztBQUtuQnJCLHVCQUFlUixPQUFPUTtBQUxILE9BQXJCO0FBT0EsWUFBTXdCLGdCQUFnQmpCLFFBQVFDLE9BQVIsQ0FBZ0IsS0FBS1osY0FBTCxDQUFvQjZCLE9BQXBCLENBQTRCLEtBQUtoQyxPQUFqQyxFQUEwQ2lDLEtBQUtDLFNBQUwsQ0FBZUosWUFBZixDQUExQyxDQUFoQixDQUF0QjtBQUNBLGFBQU9DLGNBQWNmLElBQWQsQ0FBbUJtQixXQUFXO0FBQ25DLGNBQU1DLFNBQVNELFFBQVFFLElBQVIsSUFBZ0JGLE9BQS9CO0FBQ0FULHlCQUFJQyxJQUFKLENBQVUsT0FBTUwsUUFBUywwQ0FBeUNWLFdBQVdnQixRQUFTLEVBQXRGLEVBQXlGUSxNQUF6RjtBQUNBLGVBQU9BLE1BQVA7QUFDRCxPQUpNLENBQVA7QUFLRCxLQWxDTSxFQWtDSkUsS0FsQ0ksQ0FrQ0VDLE9BQU87QUFDZGIsdUJBQUlDLElBQUosQ0FBVSw0Q0FBMkNmLFdBQVdnQixRQUFTLEtBQUlXLElBQUlDLE9BQVEsRUFBekY7QUFDQSxZQUFNRCxHQUFOO0FBQ0QsS0FyQ00sQ0FBUDtBQXNDRDtBQTlEb0I7UUFBVjFDLFMsR0FBQUEsUyIsImZpbGUiOiJQdXNoUXVldWUuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBQYXJzZU1lc3NhZ2VRdWV1ZSB9ICAgICAgZnJvbSAnLi4vUGFyc2VNZXNzYWdlUXVldWUnO1xuaW1wb3J0IHJlc3QgICAgICAgICAgICAgICAgICAgICAgIGZyb20gJy4uL3Jlc3QnO1xuaW1wb3J0IHsgYXBwbHlEZXZpY2VUb2tlbkV4aXN0cyB9IGZyb20gJy4vdXRpbHMnO1xuaW1wb3J0IFBhcnNlIGZyb20gJ3BhcnNlL25vZGUnO1xuaW1wb3J0IGxvZyBmcm9tICcuLi9sb2dnZXInO1xuXG5jb25zdCBQVVNIX0NIQU5ORUwgPSAncGFyc2Utc2VydmVyLXB1c2gnO1xuY29uc3QgREVGQVVMVF9CQVRDSF9TSVpFID0gMTAwO1xuXG5leHBvcnQgY2xhc3MgUHVzaFF1ZXVlIHtcbiAgcGFyc2VQdWJsaXNoZXI6IE9iamVjdDtcbiAgY2hhbm5lbDogU3RyaW5nO1xuICBiYXRjaFNpemU6IE51bWJlcjtcblxuICAvLyBjb25maWcgb2JqZWN0IG9mIHRoZSBwdWJsaXNoZXIsIHJpZ2h0IG5vdyBpdCBvbmx5IGNvbnRhaW5zIHRoZSByZWRpc1VSTCxcbiAgLy8gYnV0IHdlIG1heSBleHRlbmQgaXQgbGF0ZXIuXG4gIGNvbnN0cnVjdG9yKGNvbmZpZzogYW55ID0ge30pIHtcbiAgICB0aGlzLmNoYW5uZWwgPSBjb25maWcuY2hhbm5lbCB8fCBQdXNoUXVldWUuZGVmYXVsdFB1c2hDaGFubmVsKCk7XG4gICAgdGhpcy5iYXRjaFNpemUgPSBjb25maWcuYmF0Y2hTaXplIHx8IERFRkFVTFRfQkFUQ0hfU0laRTtcbiAgICB0aGlzLnBhcnNlUHVibGlzaGVyID0gUGFyc2VNZXNzYWdlUXVldWUuY3JlYXRlUHVibGlzaGVyKGNvbmZpZyk7XG4gIH1cblxuICBzdGF0aWMgZGVmYXVsdFB1c2hDaGFubmVsKCkge1xuICAgIHJldHVybiBgJHtQYXJzZS5hcHBsaWNhdGlvbklkfS0ke1BVU0hfQ0hBTk5FTH1gO1xuICB9XG5cbiAgZW5xdWV1ZShib2R5LCB3aGVyZSwgY29uZmlnLCBhdXRoLCBwdXNoU3RhdHVzKSB7XG4gICAgY29uc3QgbGltaXQgPSB0aGlzLmJhdGNoU2l6ZTtcblxuICAgIHdoZXJlID0gYXBwbHlEZXZpY2VUb2tlbkV4aXN0cyh3aGVyZSk7XG5cbiAgICAvLyBPcmRlciBieSBvYmplY3RJZCBzbyBubyBpbXBhY3Qgb24gdGhlIERCXG4gICAgLy8gY29uc3Qgb3JkZXIgPSAnb2JqZWN0SWQnO1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiByZXN0LmZpbmQoY29uZmlnLFxuICAgICAgICBhdXRoLFxuICAgICAgICAnX0luc3RhbGxhdGlvbicsXG4gICAgICAgIHdoZXJlLFxuICAgICAgICB7bGltaXQ6IDAsIGNvdW50OiB0cnVlfSk7XG4gICAgfSkudGhlbigoe3Jlc3VsdHMsIGNvdW50fSkgPT4ge1xuICAgICAgaWYgKCFyZXN1bHRzIHx8IGNvdW50ID09IDApIHtcbiAgICAgICAgcmV0dXJuIHB1c2hTdGF0dXMuY29tcGxldGUoKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IG1heFBhZ2VzID0gTWF0aC5jZWlsKGNvdW50IC8gbGltaXQpXG4gICAgICBwdXNoU3RhdHVzLnNldFJ1bm5pbmcobWF4UGFnZXMpO1xuICAgICAgbG9nLmluZm8oYEFsbCAke21heFBhZ2VzfSBwYWNrYWdlcyB3ZXJlIGVucXVldWVkIGZvciBQdXNoU3RhdHVzICR7cHVzaFN0YXR1cy5vYmplY3RJZH1gKTtcbiAgICAgIC8vIHdoaWxlIChwYWdlIDwgbWF4UGFnZXMpIHtcbiAgICAgIC8vIGNoYW5nZXMgcmVxdWVzdC9saW1pdC9vcmRlckJ5IGJ5IGlkIHJhbmdlIGludGVydmFscyBmb3IgYmV0dGVyIHBlcmZvcm1hbmNlXG4gICAgICAvLyBodHRwczovL2RvY3MubW9uZ29kYi5jb20vbWFudWFsL3JlZmVyZW5jZS9tZXRob2QvY3Vyc29yLnNraXAvXG4gICAgICAvLyBSYW5nZSBxdWVyaWVzIGNhbiB1c2UgaW5kZXhlcyB0byBhdm9pZCBzY2FubmluZyB1bndhbnRlZCBkb2N1bWVudHMsXG4gICAgICAvLyB0eXBpY2FsbHkgeWllbGRpbmcgYmV0dGVyIHBlcmZvcm1hbmNlIGFzIHRoZSBvZmZzZXQgZ3Jvd3MgY29tcGFyZWRcbiAgICAgIC8vIHRvIHVzaW5nIGN1cnNvci5za2lwKCkgZm9yIHBhZ2luYXRpb24uXG4gICAgICBjb25zdCBxdWVyeSA9IHsgd2hlcmUgfTtcblxuICAgICAgY29uc3QgcHVzaFdvcmtJdGVtID0ge1xuICAgICAgICBib2R5LFxuICAgICAgICBxdWVyeSxcbiAgICAgICAgbWF4UGFnZXMsXG4gICAgICAgIHB1c2hTdGF0dXM6IHsgb2JqZWN0SWQ6IHB1c2hTdGF0dXMub2JqZWN0SWQgfSxcbiAgICAgICAgYXBwbGljYXRpb25JZDogY29uZmlnLmFwcGxpY2F0aW9uSWRcbiAgICAgIH1cbiAgICAgIGNvbnN0IHB1Ymxpc2hSZXN1bHQgPSBQcm9taXNlLnJlc29sdmUodGhpcy5wYXJzZVB1Ymxpc2hlci5wdWJsaXNoKHRoaXMuY2hhbm5lbCwgSlNPTi5zdHJpbmdpZnkocHVzaFdvcmtJdGVtKSkpXG4gICAgICByZXR1cm4gcHVibGlzaFJlc3VsdC50aGVuKHJlcG9uc2UgPT4ge1xuICAgICAgICBjb25zdCByZXN1bHQgPSByZXBvbnNlLmRhdGEgfHwgcmVwb25zZVxuICAgICAgICBsb2cuaW5mbyhgQWxsICR7bWF4UGFnZXN9IHBhY2thZ2VzIHdlcmUgZW5xdWV1ZWQgZm9yIFB1c2hTdGF0dXMgJHtwdXNoU3RhdHVzLm9iamVjdElkfWAsIHJlc3VsdCk7XG4gICAgICAgIHJldHVybiByZXN1bHRcbiAgICAgIH0pXG4gICAgfSkuY2F0Y2goZXJyID0+IHtcbiAgICAgIGxvZy5pbmZvKGBDYW4ndCBjb3VudCBpbnN0YWxsYXRpb25zIGZvciBQdXNoU3RhdHVzICR7cHVzaFN0YXR1cy5vYmplY3RJZH06ICR7ZXJyLm1lc3NhZ2V9YCk7XG4gICAgICB0aHJvdyBlcnJcbiAgICB9KTtcbiAgfVxufVxuIl19