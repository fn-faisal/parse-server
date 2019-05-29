"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PushQueue = void 0;

var _ParseMessageQueue = require("../ParseMessageQueue");

var _rest = _interopRequireDefault(require("../rest"));

var _utils = require("./utils");

var _node = _interopRequireDefault(require("parse/node"));

var _logger = _interopRequireDefault(require("../logger"));

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
    return `${_node.default.applicationId}-${PUSH_CHANNEL}`;
  }

  enqueue(body, where, config, auth, pushStatus) {
    const limit = this.batchSize;
    where = (0, _utils.applyDeviceTokenExists)(where); // Order by objectId so no impact on the DB
    // const order = 'objectId';

    return Promise.resolve().then(() => {
      return _rest.default.find(config, auth, '_Installation', where, {
        limit: 0,
        count: true
      });
    }).then(({
      results,
      count
    }) => {
      if (!results || count == 0) {
        return pushStatus.complete();
      }

      const maxPages = Math.ceil(count / limit);
      pushStatus.setRunning(maxPages);

      _logger.default.info(`All ${maxPages} packages were enqueued for PushStatus ${pushStatus.objectId}`); // while (page < maxPages) {
      // changes request/limit/orderBy by id range intervals for better performance
      // https://docs.mongodb.com/manual/reference/method/cursor.skip/
      // Range queries can use indexes to avoid scanning unwanted documents,
      // typically yielding better performance as the offset grows compared
      // to using cursor.skip() for pagination.


      const query = {
        where
      };
      const pushWorkItem = {
        body,
        query,
        maxPages,
        pushStatus: {
          objectId: pushStatus.objectId
        },
        applicationId: config.applicationId
      };
      const publishResult = Promise.resolve(this.parsePublisher.publish(this.channel, JSON.stringify(pushWorkItem)));
      return publishResult.then(reponse => {
        const result = reponse.data || reponse;

        _logger.default.info(`All ${maxPages} packages were enqueued for PushStatus ${pushStatus.objectId}`, result);

        return result;
      });
    }).catch(err => {
      _logger.default.info(`Can't count installations for PushStatus ${pushStatus.objectId}: ${err.message}`);

      throw err;
    });
  }

}

exports.PushQueue = PushQueue;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9QdXNoL1B1c2hRdWV1ZS5qcyJdLCJuYW1lcyI6WyJQVVNIX0NIQU5ORUwiLCJERUZBVUxUX0JBVENIX1NJWkUiLCJQdXNoUXVldWUiLCJjb25zdHJ1Y3RvciIsImNvbmZpZyIsImNoYW5uZWwiLCJkZWZhdWx0UHVzaENoYW5uZWwiLCJiYXRjaFNpemUiLCJwYXJzZVB1Ymxpc2hlciIsIlBhcnNlTWVzc2FnZVF1ZXVlIiwiY3JlYXRlUHVibGlzaGVyIiwiUGFyc2UiLCJhcHBsaWNhdGlvbklkIiwiZW5xdWV1ZSIsImJvZHkiLCJ3aGVyZSIsImF1dGgiLCJwdXNoU3RhdHVzIiwibGltaXQiLCJQcm9taXNlIiwicmVzb2x2ZSIsInRoZW4iLCJyZXN0IiwiZmluZCIsImNvdW50IiwicmVzdWx0cyIsImNvbXBsZXRlIiwibWF4UGFnZXMiLCJNYXRoIiwiY2VpbCIsInNldFJ1bm5pbmciLCJsb2ciLCJpbmZvIiwib2JqZWN0SWQiLCJxdWVyeSIsInB1c2hXb3JrSXRlbSIsInB1Ymxpc2hSZXN1bHQiLCJwdWJsaXNoIiwiSlNPTiIsInN0cmluZ2lmeSIsInJlcG9uc2UiLCJyZXN1bHQiLCJkYXRhIiwiY2F0Y2giLCJlcnIiLCJtZXNzYWdlIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQUE7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7Ozs7QUFFQSxNQUFNQSxZQUFZLEdBQUcsbUJBQXJCO0FBQ0EsTUFBTUMsa0JBQWtCLEdBQUcsR0FBM0I7O0FBRU8sTUFBTUMsU0FBTixDQUFnQjtBQUtyQjtBQUNBO0FBQ0FDLEVBQUFBLFdBQVcsQ0FBQ0MsTUFBVyxHQUFHLEVBQWYsRUFBbUI7QUFDNUIsU0FBS0MsT0FBTCxHQUFlRCxNQUFNLENBQUNDLE9BQVAsSUFBa0JILFNBQVMsQ0FBQ0ksa0JBQVYsRUFBakM7QUFDQSxTQUFLQyxTQUFMLEdBQWlCSCxNQUFNLENBQUNHLFNBQVAsSUFBb0JOLGtCQUFyQztBQUNBLFNBQUtPLGNBQUwsR0FBc0JDLHFDQUFrQkMsZUFBbEIsQ0FBa0NOLE1BQWxDLENBQXRCO0FBQ0Q7O0FBRUQsU0FBT0Usa0JBQVAsR0FBNEI7QUFDMUIsV0FBUSxHQUFFSyxjQUFNQyxhQUFjLElBQUdaLFlBQWEsRUFBOUM7QUFDRDs7QUFFRGEsRUFBQUEsT0FBTyxDQUFDQyxJQUFELEVBQU9DLEtBQVAsRUFBY1gsTUFBZCxFQUFzQlksSUFBdEIsRUFBNEJDLFVBQTVCLEVBQXdDO0FBQzdDLFVBQU1DLEtBQUssR0FBRyxLQUFLWCxTQUFuQjtBQUVBUSxJQUFBQSxLQUFLLEdBQUcsbUNBQXVCQSxLQUF2QixDQUFSLENBSDZDLENBSzdDO0FBQ0E7O0FBQ0EsV0FBT0ksT0FBTyxDQUFDQyxPQUFSLEdBQWtCQyxJQUFsQixDQUF1QixNQUFNO0FBQ2xDLGFBQU9DLGNBQUtDLElBQUwsQ0FBVW5CLE1BQVYsRUFDTFksSUFESyxFQUVMLGVBRkssRUFHTEQsS0FISyxFQUlMO0FBQUNHLFFBQUFBLEtBQUssRUFBRSxDQUFSO0FBQVdNLFFBQUFBLEtBQUssRUFBRTtBQUFsQixPQUpLLENBQVA7QUFLRCxLQU5NLEVBTUpILElBTkksQ0FNQyxDQUFDO0FBQUNJLE1BQUFBLE9BQUQ7QUFBVUQsTUFBQUE7QUFBVixLQUFELEtBQXNCO0FBQzVCLFVBQUksQ0FBQ0MsT0FBRCxJQUFZRCxLQUFLLElBQUksQ0FBekIsRUFBNEI7QUFDMUIsZUFBT1AsVUFBVSxDQUFDUyxRQUFYLEVBQVA7QUFDRDs7QUFDRCxZQUFNQyxRQUFRLEdBQUdDLElBQUksQ0FBQ0MsSUFBTCxDQUFVTCxLQUFLLEdBQUdOLEtBQWxCLENBQWpCO0FBQ0FELE1BQUFBLFVBQVUsQ0FBQ2EsVUFBWCxDQUFzQkgsUUFBdEI7O0FBQ0FJLHNCQUFJQyxJQUFKLENBQVUsT0FBTUwsUUFBUywwQ0FBeUNWLFVBQVUsQ0FBQ2dCLFFBQVMsRUFBdEYsRUFONEIsQ0FPNUI7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUFDQSxZQUFNQyxLQUFLLEdBQUc7QUFBRW5CLFFBQUFBO0FBQUYsT0FBZDtBQUVBLFlBQU1vQixZQUFZLEdBQUc7QUFDbkJyQixRQUFBQSxJQURtQjtBQUVuQm9CLFFBQUFBLEtBRm1CO0FBR25CUCxRQUFBQSxRQUhtQjtBQUluQlYsUUFBQUEsVUFBVSxFQUFFO0FBQUVnQixVQUFBQSxRQUFRLEVBQUVoQixVQUFVLENBQUNnQjtBQUF2QixTQUpPO0FBS25CckIsUUFBQUEsYUFBYSxFQUFFUixNQUFNLENBQUNRO0FBTEgsT0FBckI7QUFPQSxZQUFNd0IsYUFBYSxHQUFHakIsT0FBTyxDQUFDQyxPQUFSLENBQWdCLEtBQUtaLGNBQUwsQ0FBb0I2QixPQUFwQixDQUE0QixLQUFLaEMsT0FBakMsRUFBMENpQyxJQUFJLENBQUNDLFNBQUwsQ0FBZUosWUFBZixDQUExQyxDQUFoQixDQUF0QjtBQUNBLGFBQU9DLGFBQWEsQ0FBQ2YsSUFBZCxDQUFtQm1CLE9BQU8sSUFBSTtBQUNuQyxjQUFNQyxNQUFNLEdBQUdELE9BQU8sQ0FBQ0UsSUFBUixJQUFnQkYsT0FBL0I7O0FBQ0FULHdCQUFJQyxJQUFKLENBQVUsT0FBTUwsUUFBUywwQ0FBeUNWLFVBQVUsQ0FBQ2dCLFFBQVMsRUFBdEYsRUFBeUZRLE1BQXpGOztBQUNBLGVBQU9BLE1BQVA7QUFDRCxPQUpNLENBQVA7QUFLRCxLQWxDTSxFQWtDSkUsS0FsQ0ksQ0FrQ0VDLEdBQUcsSUFBSTtBQUNkYixzQkFBSUMsSUFBSixDQUFVLDRDQUEyQ2YsVUFBVSxDQUFDZ0IsUUFBUyxLQUFJVyxHQUFHLENBQUNDLE9BQVEsRUFBekY7O0FBQ0EsWUFBTUQsR0FBTjtBQUNELEtBckNNLENBQVA7QUFzQ0Q7O0FBOURvQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFBhcnNlTWVzc2FnZVF1ZXVlIH0gZnJvbSAnLi4vUGFyc2VNZXNzYWdlUXVldWUnO1xuaW1wb3J0IHJlc3QgZnJvbSAnLi4vcmVzdCc7XG5pbXBvcnQgeyBhcHBseURldmljZVRva2VuRXhpc3RzIH0gZnJvbSAnLi91dGlscyc7XG5pbXBvcnQgUGFyc2UgZnJvbSAncGFyc2Uvbm9kZSc7XG5pbXBvcnQgbG9nIGZyb20gJy4uL2xvZ2dlcic7XG5cbmNvbnN0IFBVU0hfQ0hBTk5FTCA9ICdwYXJzZS1zZXJ2ZXItcHVzaCc7XG5jb25zdCBERUZBVUxUX0JBVENIX1NJWkUgPSAxMDA7XG5cbmV4cG9ydCBjbGFzcyBQdXNoUXVldWUge1xuICBwYXJzZVB1Ymxpc2hlcjogT2JqZWN0O1xuICBjaGFubmVsOiBTdHJpbmc7XG4gIGJhdGNoU2l6ZTogTnVtYmVyO1xuXG4gIC8vIGNvbmZpZyBvYmplY3Qgb2YgdGhlIHB1Ymxpc2hlciwgcmlnaHQgbm93IGl0IG9ubHkgY29udGFpbnMgdGhlIHJlZGlzVVJMLFxuICAvLyBidXQgd2UgbWF5IGV4dGVuZCBpdCBsYXRlci5cbiAgY29uc3RydWN0b3IoY29uZmlnOiBhbnkgPSB7fSkge1xuICAgIHRoaXMuY2hhbm5lbCA9IGNvbmZpZy5jaGFubmVsIHx8IFB1c2hRdWV1ZS5kZWZhdWx0UHVzaENoYW5uZWwoKTtcbiAgICB0aGlzLmJhdGNoU2l6ZSA9IGNvbmZpZy5iYXRjaFNpemUgfHwgREVGQVVMVF9CQVRDSF9TSVpFO1xuICAgIHRoaXMucGFyc2VQdWJsaXNoZXIgPSBQYXJzZU1lc3NhZ2VRdWV1ZS5jcmVhdGVQdWJsaXNoZXIoY29uZmlnKTtcbiAgfVxuXG4gIHN0YXRpYyBkZWZhdWx0UHVzaENoYW5uZWwoKSB7XG4gICAgcmV0dXJuIGAke1BhcnNlLmFwcGxpY2F0aW9uSWR9LSR7UFVTSF9DSEFOTkVMfWA7XG4gIH1cblxuICBlbnF1ZXVlKGJvZHksIHdoZXJlLCBjb25maWcsIGF1dGgsIHB1c2hTdGF0dXMpIHtcbiAgICBjb25zdCBsaW1pdCA9IHRoaXMuYmF0Y2hTaXplO1xuXG4gICAgd2hlcmUgPSBhcHBseURldmljZVRva2VuRXhpc3RzKHdoZXJlKTtcblxuICAgIC8vIE9yZGVyIGJ5IG9iamVjdElkIHNvIG5vIGltcGFjdCBvbiB0aGUgREJcbiAgICAvLyBjb25zdCBvcmRlciA9ICdvYmplY3RJZCc7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHJlc3QuZmluZChjb25maWcsXG4gICAgICAgIGF1dGgsXG4gICAgICAgICdfSW5zdGFsbGF0aW9uJyxcbiAgICAgICAgd2hlcmUsXG4gICAgICAgIHtsaW1pdDogMCwgY291bnQ6IHRydWV9KTtcbiAgICB9KS50aGVuKCh7cmVzdWx0cywgY291bnR9KSA9PiB7XG4gICAgICBpZiAoIXJlc3VsdHMgfHwgY291bnQgPT0gMCkge1xuICAgICAgICByZXR1cm4gcHVzaFN0YXR1cy5jb21wbGV0ZSgpO1xuICAgICAgfVxuICAgICAgY29uc3QgbWF4UGFnZXMgPSBNYXRoLmNlaWwoY291bnQgLyBsaW1pdClcbiAgICAgIHB1c2hTdGF0dXMuc2V0UnVubmluZyhtYXhQYWdlcyk7XG4gICAgICBsb2cuaW5mbyhgQWxsICR7bWF4UGFnZXN9IHBhY2thZ2VzIHdlcmUgZW5xdWV1ZWQgZm9yIFB1c2hTdGF0dXMgJHtwdXNoU3RhdHVzLm9iamVjdElkfWApO1xuICAgICAgLy8gd2hpbGUgKHBhZ2UgPCBtYXhQYWdlcykge1xuICAgICAgLy8gY2hhbmdlcyByZXF1ZXN0L2xpbWl0L29yZGVyQnkgYnkgaWQgcmFuZ2UgaW50ZXJ2YWxzIGZvciBiZXR0ZXIgcGVyZm9ybWFuY2VcbiAgICAgIC8vIGh0dHBzOi8vZG9jcy5tb25nb2RiLmNvbS9tYW51YWwvcmVmZXJlbmNlL21ldGhvZC9jdXJzb3Iuc2tpcC9cbiAgICAgIC8vIFJhbmdlIHF1ZXJpZXMgY2FuIHVzZSBpbmRleGVzIHRvIGF2b2lkIHNjYW5uaW5nIHVud2FudGVkIGRvY3VtZW50cyxcbiAgICAgIC8vIHR5cGljYWxseSB5aWVsZGluZyBiZXR0ZXIgcGVyZm9ybWFuY2UgYXMgdGhlIG9mZnNldCBncm93cyBjb21wYXJlZFxuICAgICAgLy8gdG8gdXNpbmcgY3Vyc29yLnNraXAoKSBmb3IgcGFnaW5hdGlvbi5cbiAgICAgIGNvbnN0IHF1ZXJ5ID0geyB3aGVyZSB9O1xuXG4gICAgICBjb25zdCBwdXNoV29ya0l0ZW0gPSB7XG4gICAgICAgIGJvZHksXG4gICAgICAgIHF1ZXJ5LFxuICAgICAgICBtYXhQYWdlcyxcbiAgICAgICAgcHVzaFN0YXR1czogeyBvYmplY3RJZDogcHVzaFN0YXR1cy5vYmplY3RJZCB9LFxuICAgICAgICBhcHBsaWNhdGlvbklkOiBjb25maWcuYXBwbGljYXRpb25JZFxuICAgICAgfVxuICAgICAgY29uc3QgcHVibGlzaFJlc3VsdCA9IFByb21pc2UucmVzb2x2ZSh0aGlzLnBhcnNlUHVibGlzaGVyLnB1Ymxpc2godGhpcy5jaGFubmVsLCBKU09OLnN0cmluZ2lmeShwdXNoV29ya0l0ZW0pKSlcbiAgICAgIHJldHVybiBwdWJsaXNoUmVzdWx0LnRoZW4ocmVwb25zZSA9PiB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHJlcG9uc2UuZGF0YSB8fCByZXBvbnNlXG4gICAgICAgIGxvZy5pbmZvKGBBbGwgJHttYXhQYWdlc30gcGFja2FnZXMgd2VyZSBlbnF1ZXVlZCBmb3IgUHVzaFN0YXR1cyAke3B1c2hTdGF0dXMub2JqZWN0SWR9YCwgcmVzdWx0KTtcbiAgICAgICAgcmV0dXJuIHJlc3VsdFxuICAgICAgfSlcbiAgICB9KS5jYXRjaChlcnIgPT4ge1xuICAgICAgbG9nLmluZm8oYENhbid0IGNvdW50IGluc3RhbGxhdGlvbnMgZm9yIFB1c2hTdGF0dXMgJHtwdXNoU3RhdHVzLm9iamVjdElkfTogJHtlcnIubWVzc2FnZX1gKTtcbiAgICAgIHRocm93IGVyclxuICAgIH0pO1xuICB9XG59XG4iXX0=