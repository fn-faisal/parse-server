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
      return this.parsePublisher.publish(this.channel, JSON.stringify(pushWorkItem)).then(reponse => {
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9QdXNoL1B1c2hRdWV1ZS5qcyJdLCJuYW1lcyI6WyJQVVNIX0NIQU5ORUwiLCJERUZBVUxUX0JBVENIX1NJWkUiLCJQdXNoUXVldWUiLCJjb25zdHJ1Y3RvciIsImNvbmZpZyIsImNoYW5uZWwiLCJkZWZhdWx0UHVzaENoYW5uZWwiLCJiYXRjaFNpemUiLCJwYXJzZVB1Ymxpc2hlciIsIlBhcnNlTWVzc2FnZVF1ZXVlIiwiY3JlYXRlUHVibGlzaGVyIiwiUGFyc2UiLCJhcHBsaWNhdGlvbklkIiwiZW5xdWV1ZSIsImJvZHkiLCJ3aGVyZSIsImF1dGgiLCJwdXNoU3RhdHVzIiwibGltaXQiLCJQcm9taXNlIiwicmVzb2x2ZSIsInRoZW4iLCJyZXN0IiwiZmluZCIsImNvdW50IiwicmVzdWx0cyIsImNvbXBsZXRlIiwibWF4UGFnZXMiLCJNYXRoIiwiY2VpbCIsInNldFJ1bm5pbmciLCJsb2ciLCJpbmZvIiwib2JqZWN0SWQiLCJxdWVyeSIsInB1c2hXb3JrSXRlbSIsInB1Ymxpc2giLCJKU09OIiwic3RyaW5naWZ5IiwicmVwb25zZSIsInJlc3VsdCIsImRhdGEiLCJjYXRjaCIsImVyciIsIm1lc3NhZ2UiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFBQTs7QUFDQTs7OztBQUNBOztBQUNBOzs7O0FBQ0E7Ozs7OztBQUVBLE1BQU1BLGVBQWUsbUJBQXJCO0FBQ0EsTUFBTUMscUJBQXFCLEdBQTNCOztBQUVPLE1BQU1DLFNBQU4sQ0FBZ0I7O0FBS3JCO0FBQ0E7QUFDQUMsY0FBWUMsU0FBYyxFQUExQixFQUE4QjtBQUM1QixTQUFLQyxPQUFMLEdBQWVELE9BQU9DLE9BQVAsSUFBa0JILFVBQVVJLGtCQUFWLEVBQWpDO0FBQ0EsU0FBS0MsU0FBTCxHQUFpQkgsT0FBT0csU0FBUCxJQUFvQk4sa0JBQXJDO0FBQ0EsU0FBS08sY0FBTCxHQUFzQkMscUNBQWtCQyxlQUFsQixDQUFrQ04sTUFBbEMsQ0FBdEI7QUFDRDs7QUFFRCxTQUFPRSxrQkFBUCxHQUE0QjtBQUMxQixXQUFRLEdBQUVLLGVBQU1DLGFBQWMsSUFBR1osWUFBYSxFQUE5QztBQUNEOztBQUVEYSxVQUFRQyxJQUFSLEVBQWNDLEtBQWQsRUFBcUJYLE1BQXJCLEVBQTZCWSxJQUE3QixFQUFtQ0MsVUFBbkMsRUFBK0M7QUFDN0MsVUFBTUMsUUFBUSxLQUFLWCxTQUFuQjs7QUFFQVEsWUFBUSxtQ0FBdUJBLEtBQXZCLENBQVI7O0FBRUE7QUFDQTtBQUNBLFdBQU9JLFFBQVFDLE9BQVIsR0FBa0JDLElBQWxCLENBQXVCLE1BQU07QUFDbEMsYUFBT0MsZUFBS0MsSUFBTCxDQUFVbkIsTUFBVixFQUNMWSxJQURLLEVBRUwsZUFGSyxFQUdMRCxLQUhLLEVBSUwsRUFBQ0csT0FBTyxDQUFSLEVBQVdNLE9BQU8sSUFBbEIsRUFKSyxDQUFQO0FBS0QsS0FOTSxFQU1KSCxJQU5JLENBTUMsQ0FBQyxFQUFDSSxPQUFELEVBQVVELEtBQVYsRUFBRCxLQUFzQjtBQUM1QixVQUFJLENBQUNDLE9BQUQsSUFBWUQsU0FBUyxDQUF6QixFQUE0QjtBQUMxQixlQUFPUCxXQUFXUyxRQUFYLEVBQVA7QUFDRDtBQUNELFlBQU1DLFdBQVdDLEtBQUtDLElBQUwsQ0FBVUwsUUFBUU4sS0FBbEIsQ0FBakI7QUFDQUQsaUJBQVdhLFVBQVgsQ0FBc0JILFFBQXRCO0FBQ0FJLHVCQUFJQyxJQUFKLENBQVUsT0FBTUwsUUFBUywwQ0FBeUNWLFdBQVdnQixRQUFTLEVBQXRGO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsWUFBTUMsUUFBUSxFQUFFbkIsS0FBRixFQUFkOztBQUVBLFlBQU1vQixlQUFlO0FBQ25CckIsWUFEbUI7QUFFbkJvQixhQUZtQjtBQUduQlAsZ0JBSG1CO0FBSW5CVixvQkFBWSxFQUFFZ0IsVUFBVWhCLFdBQVdnQixRQUF2QixFQUpPO0FBS25CckIsdUJBQWVSLE9BQU9RO0FBTEgsT0FBckI7QUFPQSxhQUFPLEtBQUtKLGNBQUwsQ0FBb0I0QixPQUFwQixDQUE0QixLQUFLL0IsT0FBakMsRUFBMENnQyxLQUFLQyxTQUFMLENBQWVILFlBQWYsQ0FBMUMsRUFBd0VkLElBQXhFLENBQTZFa0IsV0FBVztBQUM3RixjQUFNQyxTQUFTRCxRQUFRRSxJQUFSLElBQWdCRixPQUEvQjtBQUNBUix5QkFBSUMsSUFBSixDQUFVLE9BQU1MLFFBQVMsMENBQXlDVixXQUFXZ0IsUUFBUyxFQUF0RixFQUF5Rk8sTUFBekY7QUFDQSxlQUFPQSxNQUFQO0FBQ0QsT0FKTSxDQUFQO0FBS0QsS0FqQ00sRUFpQ0pFLEtBakNJLENBaUNFQyxPQUFPO0FBQ2RaLHVCQUFJQyxJQUFKLENBQVUsNENBQTJDZixXQUFXZ0IsUUFBUyxLQUFJVSxJQUFJQyxPQUFRLEVBQXpGO0FBQ0EsWUFBTUQsR0FBTjtBQUNELEtBcENNLENBQVA7QUFxQ0Q7QUE3RG9CO1FBQVZ6QyxTLEdBQUFBLFMiLCJmaWxlIjoiUHVzaFF1ZXVlLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgUGFyc2VNZXNzYWdlUXVldWUgfSAgICAgIGZyb20gJy4uL1BhcnNlTWVzc2FnZVF1ZXVlJztcbmltcG9ydCByZXN0ICAgICAgICAgICAgICAgICAgICAgICBmcm9tICcuLi9yZXN0JztcbmltcG9ydCB7IGFwcGx5RGV2aWNlVG9rZW5FeGlzdHMgfSBmcm9tICcuL3V0aWxzJztcbmltcG9ydCBQYXJzZSBmcm9tICdwYXJzZS9ub2RlJztcbmltcG9ydCBsb2cgZnJvbSAnLi4vbG9nZ2VyJztcblxuY29uc3QgUFVTSF9DSEFOTkVMID0gJ3BhcnNlLXNlcnZlci1wdXNoJztcbmNvbnN0IERFRkFVTFRfQkFUQ0hfU0laRSA9IDEwMDtcblxuZXhwb3J0IGNsYXNzIFB1c2hRdWV1ZSB7XG4gIHBhcnNlUHVibGlzaGVyOiBPYmplY3Q7XG4gIGNoYW5uZWw6IFN0cmluZztcbiAgYmF0Y2hTaXplOiBOdW1iZXI7XG5cbiAgLy8gY29uZmlnIG9iamVjdCBvZiB0aGUgcHVibGlzaGVyLCByaWdodCBub3cgaXQgb25seSBjb250YWlucyB0aGUgcmVkaXNVUkwsXG4gIC8vIGJ1dCB3ZSBtYXkgZXh0ZW5kIGl0IGxhdGVyLlxuICBjb25zdHJ1Y3Rvcihjb25maWc6IGFueSA9IHt9KSB7XG4gICAgdGhpcy5jaGFubmVsID0gY29uZmlnLmNoYW5uZWwgfHwgUHVzaFF1ZXVlLmRlZmF1bHRQdXNoQ2hhbm5lbCgpO1xuICAgIHRoaXMuYmF0Y2hTaXplID0gY29uZmlnLmJhdGNoU2l6ZSB8fCBERUZBVUxUX0JBVENIX1NJWkU7XG4gICAgdGhpcy5wYXJzZVB1Ymxpc2hlciA9IFBhcnNlTWVzc2FnZVF1ZXVlLmNyZWF0ZVB1Ymxpc2hlcihjb25maWcpO1xuICB9XG5cbiAgc3RhdGljIGRlZmF1bHRQdXNoQ2hhbm5lbCgpIHtcbiAgICByZXR1cm4gYCR7UGFyc2UuYXBwbGljYXRpb25JZH0tJHtQVVNIX0NIQU5ORUx9YDtcbiAgfVxuXG4gIGVucXVldWUoYm9keSwgd2hlcmUsIGNvbmZpZywgYXV0aCwgcHVzaFN0YXR1cykge1xuICAgIGNvbnN0IGxpbWl0ID0gdGhpcy5iYXRjaFNpemU7XG5cbiAgICB3aGVyZSA9IGFwcGx5RGV2aWNlVG9rZW5FeGlzdHMod2hlcmUpO1xuXG4gICAgLy8gT3JkZXIgYnkgb2JqZWN0SWQgc28gbm8gaW1wYWN0IG9uIHRoZSBEQlxuICAgIC8vIGNvbnN0IG9yZGVyID0gJ29iamVjdElkJztcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gcmVzdC5maW5kKGNvbmZpZyxcbiAgICAgICAgYXV0aCxcbiAgICAgICAgJ19JbnN0YWxsYXRpb24nLFxuICAgICAgICB3aGVyZSxcbiAgICAgICAge2xpbWl0OiAwLCBjb3VudDogdHJ1ZX0pO1xuICAgIH0pLnRoZW4oKHtyZXN1bHRzLCBjb3VudH0pID0+IHtcbiAgICAgIGlmICghcmVzdWx0cyB8fCBjb3VudCA9PSAwKSB7XG4gICAgICAgIHJldHVybiBwdXNoU3RhdHVzLmNvbXBsZXRlKCk7XG4gICAgICB9XG4gICAgICBjb25zdCBtYXhQYWdlcyA9IE1hdGguY2VpbChjb3VudCAvIGxpbWl0KVxuICAgICAgcHVzaFN0YXR1cy5zZXRSdW5uaW5nKG1heFBhZ2VzKTtcbiAgICAgIGxvZy5pbmZvKGBBbGwgJHttYXhQYWdlc30gcGFja2FnZXMgd2VyZSBlbnF1ZXVlZCBmb3IgUHVzaFN0YXR1cyAke3B1c2hTdGF0dXMub2JqZWN0SWR9YCk7XG4gICAgICAvLyB3aGlsZSAocGFnZSA8IG1heFBhZ2VzKSB7XG4gICAgICAvLyBjaGFuZ2VzIHJlcXVlc3QvbGltaXQvb3JkZXJCeSBieSBpZCByYW5nZSBpbnRlcnZhbHMgZm9yIGJldHRlciBwZXJmb3JtYW5jZVxuICAgICAgLy8gaHR0cHM6Ly9kb2NzLm1vbmdvZGIuY29tL21hbnVhbC9yZWZlcmVuY2UvbWV0aG9kL2N1cnNvci5za2lwL1xuICAgICAgLy8gUmFuZ2UgcXVlcmllcyBjYW4gdXNlIGluZGV4ZXMgdG8gYXZvaWQgc2Nhbm5pbmcgdW53YW50ZWQgZG9jdW1lbnRzLFxuICAgICAgLy8gdHlwaWNhbGx5IHlpZWxkaW5nIGJldHRlciBwZXJmb3JtYW5jZSBhcyB0aGUgb2Zmc2V0IGdyb3dzIGNvbXBhcmVkXG4gICAgICAvLyB0byB1c2luZyBjdXJzb3Iuc2tpcCgpIGZvciBwYWdpbmF0aW9uLlxuICAgICAgY29uc3QgcXVlcnkgPSB7IHdoZXJlIH07XG5cbiAgICAgIGNvbnN0IHB1c2hXb3JrSXRlbSA9IHtcbiAgICAgICAgYm9keSxcbiAgICAgICAgcXVlcnksXG4gICAgICAgIG1heFBhZ2VzLFxuICAgICAgICBwdXNoU3RhdHVzOiB7IG9iamVjdElkOiBwdXNoU3RhdHVzLm9iamVjdElkIH0sXG4gICAgICAgIGFwcGxpY2F0aW9uSWQ6IGNvbmZpZy5hcHBsaWNhdGlvbklkXG4gICAgICB9XG4gICAgICByZXR1cm4gdGhpcy5wYXJzZVB1Ymxpc2hlci5wdWJsaXNoKHRoaXMuY2hhbm5lbCwgSlNPTi5zdHJpbmdpZnkocHVzaFdvcmtJdGVtKSkudGhlbihyZXBvbnNlID0+IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gcmVwb25zZS5kYXRhIHx8IHJlcG9uc2VcbiAgICAgICAgbG9nLmluZm8oYEFsbCAke21heFBhZ2VzfSBwYWNrYWdlcyB3ZXJlIGVucXVldWVkIGZvciBQdXNoU3RhdHVzICR7cHVzaFN0YXR1cy5vYmplY3RJZH1gLCByZXN1bHQpO1xuICAgICAgICByZXR1cm4gcmVzdWx0XG4gICAgICB9KVxuICAgIH0pLmNhdGNoKGVyciA9PiB7XG4gICAgICBsb2cuaW5mbyhgQ2FuJ3QgY291bnQgaW5zdGFsbGF0aW9ucyBmb3IgUHVzaFN0YXR1cyAke3B1c2hTdGF0dXMub2JqZWN0SWR9OiAke2Vyci5tZXNzYWdlfWApO1xuICAgICAgdGhyb3cgZXJyXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==