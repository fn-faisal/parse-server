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
        this.parsePublisher.publish(this.channel, JSON.stringify(pushWorkItem));
        skip += limit;
        page++;
      }
    });
  }
}
exports.PushQueue = PushQueue;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9QdXNoL1B1c2hRdWV1ZS5qcyJdLCJuYW1lcyI6WyJQVVNIX0NIQU5ORUwiLCJERUZBVUxUX0JBVENIX1NJWkUiLCJQdXNoUXVldWUiLCJjb25zdHJ1Y3RvciIsImNvbmZpZyIsImNoYW5uZWwiLCJkZWZhdWx0UHVzaENoYW5uZWwiLCJiYXRjaFNpemUiLCJwYXJzZVB1Ymxpc2hlciIsIlBhcnNlTWVzc2FnZVF1ZXVlIiwiY3JlYXRlUHVibGlzaGVyIiwiUGFyc2UiLCJhcHBsaWNhdGlvbklkIiwiZW5xdWV1ZSIsImJvZHkiLCJ3aGVyZSIsImF1dGgiLCJwdXNoU3RhdHVzIiwibGltaXQiLCJQcm9taXNlIiwicmVzb2x2ZSIsInRoZW4iLCJyZXN0IiwiZmluZCIsImNvdW50IiwicmVzdWx0cyIsImNvbXBsZXRlIiwibWF4UGFnZXMiLCJNYXRoIiwiY2VpbCIsInNldFJ1bm5pbmciLCJza2lwIiwicGFnZSIsIl9pZCIsIm9iamVjdElkIiwicXVlcnkiLCJwdXNoV29ya0l0ZW0iLCJwdWJsaXNoIiwiSlNPTiIsInN0cmluZ2lmeSJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUFBOztBQUNBOzs7O0FBQ0E7O0FBQ0E7Ozs7OztBQUVBLE1BQU1BLGVBQWUsbUJBQXJCO0FBQ0EsTUFBTUMscUJBQXFCLEdBQTNCOztBQUVPLE1BQU1DLFNBQU4sQ0FBZ0I7O0FBS3JCO0FBQ0E7QUFDQUMsY0FBWUMsU0FBYyxFQUExQixFQUE4QjtBQUM1QixTQUFLQyxPQUFMLEdBQWVELE9BQU9DLE9BQVAsSUFBa0JILFVBQVVJLGtCQUFWLEVBQWpDO0FBQ0EsU0FBS0MsU0FBTCxHQUFpQkgsT0FBT0csU0FBUCxJQUFvQk4sa0JBQXJDO0FBQ0EsU0FBS08sY0FBTCxHQUFzQkMscUNBQWtCQyxlQUFsQixDQUFrQ04sTUFBbEMsQ0FBdEI7QUFDRDs7QUFFRCxTQUFPRSxrQkFBUCxHQUE0QjtBQUMxQixXQUFRLEdBQUVLLGVBQU1DLGFBQWMsSUFBR1osWUFBYSxFQUE5QztBQUNEOztBQUVEYSxVQUFRQyxJQUFSLEVBQWNDLEtBQWQsRUFBcUJYLE1BQXJCLEVBQTZCWSxJQUE3QixFQUFtQ0MsVUFBbkMsRUFBK0M7QUFDN0MsVUFBTUMsUUFBUSxLQUFLWCxTQUFuQjs7QUFFQVEsWUFBUSxtQ0FBdUJBLEtBQXZCLENBQVI7O0FBRUE7QUFDQTtBQUNBLFdBQU9JLFFBQVFDLE9BQVIsR0FBa0JDLElBQWxCLENBQXVCLE1BQU07QUFDbEMsYUFBT0MsZUFBS0MsSUFBTCxDQUFVbkIsTUFBVixFQUNMWSxJQURLLEVBRUwsZUFGSyxFQUdMRCxLQUhLLEVBSUwsRUFBQ0csT0FBTyxDQUFSLEVBQVdNLE9BQU8sSUFBbEIsRUFKSyxDQUFQO0FBS0QsS0FOTSxFQU1KSCxJQU5JLENBTUMsQ0FBQyxFQUFDSSxPQUFELEVBQVVELEtBQVYsRUFBRCxLQUFzQjtBQUM1QixVQUFJLENBQUNDLE9BQUQsSUFBWUQsU0FBUyxDQUF6QixFQUE0QjtBQUMxQixlQUFPUCxXQUFXUyxRQUFYLEVBQVA7QUFDRDtBQUNELFlBQU1DLFdBQVdDLEtBQUtDLElBQUwsQ0FBVUwsUUFBUU4sS0FBbEIsQ0FBakI7QUFDQUQsaUJBQVdhLFVBQVgsQ0FBc0JILFFBQXRCO0FBQ0EsVUFBSUksT0FBTyxDQUFYO0FBQUEsVUFBY0MsT0FBTyxDQUFyQjtBQUNBLGFBQU9ELE9BQU9QLEtBQWQsRUFBcUI7QUFDbkIsY0FBTVMsTUFBTSwwQkFBY0QsSUFBZCxFQUFvQkwsUUFBcEIsQ0FBWjtBQUNBLFlBQUlNLEdBQUosRUFBU2xCLE1BQU1tQixRQUFOLEdBQWlCRCxHQUFqQjtBQUNULGNBQU1FLFFBQVEsRUFBRXBCLEtBQUYsRUFBZDtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLGNBQU1xQixlQUFlO0FBQ25CdEIsY0FEbUI7QUFFbkJxQixlQUZtQjtBQUduQmxCLHNCQUFZLEVBQUVpQixVQUFVakIsV0FBV2lCLFFBQXZCLEVBSE87QUFJbkJ0Qix5QkFBZVIsT0FBT1E7QUFKSCxTQUFyQjtBQU1BLGFBQUtKLGNBQUwsQ0FBb0I2QixPQUFwQixDQUE0QixLQUFLaEMsT0FBakMsRUFBMENpQyxLQUFLQyxTQUFMLENBQWVILFlBQWYsQ0FBMUM7QUFDQUwsZ0JBQVFiLEtBQVI7QUFDQWM7QUFDRDtBQUNGLEtBaENNLENBQVA7QUFpQ0Q7QUF6RG9CO1FBQVY5QixTLEdBQUFBLFMiLCJmaWxlIjoiUHVzaFF1ZXVlLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgUGFyc2VNZXNzYWdlUXVldWUgfSAgICAgIGZyb20gJy4uL1BhcnNlTWVzc2FnZVF1ZXVlJztcbmltcG9ydCByZXN0ICAgICAgICAgICAgICAgICAgICAgICBmcm9tICcuLi9yZXN0JztcbmltcG9ydCB7IGFwcGx5RGV2aWNlVG9rZW5FeGlzdHMsIGdldElkSW50ZXJ2YWwgfSBmcm9tICcuL3V0aWxzJztcbmltcG9ydCBQYXJzZSBmcm9tICdwYXJzZS9ub2RlJztcblxuY29uc3QgUFVTSF9DSEFOTkVMID0gJ3BhcnNlLXNlcnZlci1wdXNoJztcbmNvbnN0IERFRkFVTFRfQkFUQ0hfU0laRSA9IDEwMDtcblxuZXhwb3J0IGNsYXNzIFB1c2hRdWV1ZSB7XG4gIHBhcnNlUHVibGlzaGVyOiBPYmplY3Q7XG4gIGNoYW5uZWw6IFN0cmluZztcbiAgYmF0Y2hTaXplOiBOdW1iZXI7XG5cbiAgLy8gY29uZmlnIG9iamVjdCBvZiB0aGUgcHVibGlzaGVyLCByaWdodCBub3cgaXQgb25seSBjb250YWlucyB0aGUgcmVkaXNVUkwsXG4gIC8vIGJ1dCB3ZSBtYXkgZXh0ZW5kIGl0IGxhdGVyLlxuICBjb25zdHJ1Y3Rvcihjb25maWc6IGFueSA9IHt9KSB7XG4gICAgdGhpcy5jaGFubmVsID0gY29uZmlnLmNoYW5uZWwgfHwgUHVzaFF1ZXVlLmRlZmF1bHRQdXNoQ2hhbm5lbCgpO1xuICAgIHRoaXMuYmF0Y2hTaXplID0gY29uZmlnLmJhdGNoU2l6ZSB8fCBERUZBVUxUX0JBVENIX1NJWkU7XG4gICAgdGhpcy5wYXJzZVB1Ymxpc2hlciA9IFBhcnNlTWVzc2FnZVF1ZXVlLmNyZWF0ZVB1Ymxpc2hlcihjb25maWcpO1xuICB9XG5cbiAgc3RhdGljIGRlZmF1bHRQdXNoQ2hhbm5lbCgpIHtcbiAgICByZXR1cm4gYCR7UGFyc2UuYXBwbGljYXRpb25JZH0tJHtQVVNIX0NIQU5ORUx9YDtcbiAgfVxuXG4gIGVucXVldWUoYm9keSwgd2hlcmUsIGNvbmZpZywgYXV0aCwgcHVzaFN0YXR1cykge1xuICAgIGNvbnN0IGxpbWl0ID0gdGhpcy5iYXRjaFNpemU7XG5cbiAgICB3aGVyZSA9IGFwcGx5RGV2aWNlVG9rZW5FeGlzdHMod2hlcmUpO1xuXG4gICAgLy8gT3JkZXIgYnkgb2JqZWN0SWQgc28gbm8gaW1wYWN0IG9uIHRoZSBEQlxuICAgIC8vIGNvbnN0IG9yZGVyID0gJ29iamVjdElkJztcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gcmVzdC5maW5kKGNvbmZpZyxcbiAgICAgICAgYXV0aCxcbiAgICAgICAgJ19JbnN0YWxsYXRpb24nLFxuICAgICAgICB3aGVyZSxcbiAgICAgICAge2xpbWl0OiAwLCBjb3VudDogdHJ1ZX0pO1xuICAgIH0pLnRoZW4oKHtyZXN1bHRzLCBjb3VudH0pID0+IHtcbiAgICAgIGlmICghcmVzdWx0cyB8fCBjb3VudCA9PSAwKSB7XG4gICAgICAgIHJldHVybiBwdXNoU3RhdHVzLmNvbXBsZXRlKCk7XG4gICAgICB9XG4gICAgICBjb25zdCBtYXhQYWdlcyA9IE1hdGguY2VpbChjb3VudCAvIGxpbWl0KVxuICAgICAgcHVzaFN0YXR1cy5zZXRSdW5uaW5nKG1heFBhZ2VzKTtcbiAgICAgIGxldCBza2lwID0gMCwgcGFnZSA9IDA7XG4gICAgICB3aGlsZSAoc2tpcCA8IGNvdW50KSB7XG4gICAgICAgIGNvbnN0IF9pZCA9IGdldElkSW50ZXJ2YWwocGFnZSwgbWF4UGFnZXMpXG4gICAgICAgIGlmIChfaWQpIHdoZXJlLm9iamVjdElkID0gX2lkXG4gICAgICAgIGNvbnN0IHF1ZXJ5ID0geyB3aGVyZSB9O1xuICAgICAgICAvLyBjb25zdCBxdWVyeSA9IHsgd2hlcmUsXG4gICAgICAgIC8vICAgbGltaXQsXG4gICAgICAgIC8vICAgc2tpcCxcbiAgICAgICAgLy8gICBvcmRlciB9O1xuXG4gICAgICAgIGNvbnN0IHB1c2hXb3JrSXRlbSA9IHtcbiAgICAgICAgICBib2R5LFxuICAgICAgICAgIHF1ZXJ5LFxuICAgICAgICAgIHB1c2hTdGF0dXM6IHsgb2JqZWN0SWQ6IHB1c2hTdGF0dXMub2JqZWN0SWQgfSxcbiAgICAgICAgICBhcHBsaWNhdGlvbklkOiBjb25maWcuYXBwbGljYXRpb25JZFxuICAgICAgICB9XG4gICAgICAgIHRoaXMucGFyc2VQdWJsaXNoZXIucHVibGlzaCh0aGlzLmNoYW5uZWwsIEpTT04uc3RyaW5naWZ5KHB1c2hXb3JrSXRlbSkpO1xuICAgICAgICBza2lwICs9IGxpbWl0O1xuICAgICAgICBwYWdlICsrO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG59XG4iXX0=