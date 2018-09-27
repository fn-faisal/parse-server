'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PushController = undefined;

var _node = require('parse/node');

var _RestQuery = require('../RestQuery');

var _RestQuery2 = _interopRequireDefault(_RestQuery);

var _RestWrite = require('../RestWrite');

var _RestWrite2 = _interopRequireDefault(_RestWrite);

var _Auth = require('../Auth');

var _StatusHandler = require('../StatusHandler');

var _utils = require('../Push/utils');

var _logger = require('../logger');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class PushController {

  sendPush(body = {}, where = {}, config, auth, onPushStatusSaved = () => {}, now = new Date()) {
    if (!config.hasPushSupport) {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, 'Missing push configuration');
    }

    // Replace the expiration_time and push_time with a valid Unix epoch milliseconds time
    body.expiration_time = PushController.getExpirationTime(body);
    body.expiration_interval = PushController.getExpirationInterval(body);
    if (body.expiration_time && body.expiration_interval) {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, 'Both expiration_time and expiration_interval cannot be set');
    }

    // Immediate push
    if (body.expiration_interval && !body.hasOwnProperty('push_time')) {
      const ttlMs = body.expiration_interval * 1000;
      body.expiration_time = new Date(now.valueOf() + ttlMs).valueOf();
    }

    const pushTime = PushController.getPushTime(body);
    if (pushTime && pushTime.date !== 'undefined') {
      body['push_time'] = PushController.formatPushTime(pushTime);
    }

    // TODO: If the req can pass the checking, we return immediately instead of waiting
    // pushes to be sent. We probably change this behaviour in the future.
    let badgeUpdate = () => {
      return Promise.resolve();
    };

    if (body.data && body.data.badge) {
      const badge = body.data.badge;
      let restUpdate = {};
      if (typeof badge == 'string' && badge.toLowerCase() === 'increment') {
        restUpdate = { badge: { __op: 'Increment', amount: 1 } };
      } else if (typeof badge == 'object' && typeof badge.__op == 'string' && badge.__op.toLowerCase() == 'increment' && Number(badge.amount)) {
        restUpdate = { badge: { __op: 'Increment', amount: badge.amount } };
      } else if (Number(badge)) {
        restUpdate = { badge: badge };
      } else {
        throw "Invalid value for badge, expected number or 'Increment' or {increment: number}";
      }

      // Force filtering on only valid device tokens
      const updateWhere = (0, _utils.applyDeviceTokenExists)(where);
      badgeUpdate = () => {
        // Build a real RestQuery so we can use it in RestWrite
        const restQuery = new _RestQuery2.default(config, (0, _Auth.master)(config), '_Installation', updateWhere);
        // change $exists for $ne null for better performance
        if (restQuery.restWhere && restQuery.restWhere.deviceToken && restQuery.restWhere.deviceToken['$exists']) restQuery.restWhere.deviceToken = { $ne: null };
        return restQuery.buildRestWhere().then(() => {
          const write = new _RestWrite2.default(config, (0, _Auth.master)(config), '_Installation', restQuery.restWhere, restUpdate);
          write.runOptions.many = true;
          return write.execute();
        });
      };
    }
    const pushStatus = (0, _StatusHandler.pushStatusHandler)(config);
    return Promise.resolve().then(() => {
      return pushStatus.setInitial(body, where);
    }).then(() => {
      onPushStatusSaved(pushStatus.objectId);
      return badgeUpdate();
    }).catch(err => {
      // add this to ignore badge update errors as default
      if (config.stopOnBadgeUpdateError) throw err;
      _logger.logger.info(`Badge update error will be ignored for push status ${pushStatus.objectId}`);
      _logger.logger.info(err && err.stack && err.stack.toString() || err && err.message || err.toString());
      return Promise.resolve();
    }).then(() => {
      // Update audience lastUsed and timesUsed
      if (body.audience_id) {
        const audienceId = body.audience_id;

        var updateAudience = {
          lastUsed: { __type: "Date", iso: new Date().toISOString() },
          timesUsed: { __op: "Increment", "amount": 1 }
        };
        const write = new _RestWrite2.default(config, (0, _Auth.master)(config), '_Audience', { objectId: audienceId }, updateAudience);
        write.execute();
      }
      // Don't wait for the audience update promise to resolve.
      return Promise.resolve();
    }).then(() => {
      if (body.hasOwnProperty('push_time') && config.hasPushScheduledSupport) {
        return Promise.resolve();
      }
      return config.pushControllerQueue.enqueue(body, where, config, auth, pushStatus);
    }).catch(err => {
      return pushStatus.fail(err).then(() => {
        throw err;
      });
    });
  }

  /**
   * Get expiration time from the request body.
   * @param {Object} request A request object
   * @returns {Number|undefined} The expiration time if it exists in the request
   */
  static getExpirationTime(body = {}) {
    var hasExpirationTime = body.hasOwnProperty('expiration_time');
    if (!hasExpirationTime) {
      return;
    }
    var expirationTimeParam = body['expiration_time'];
    var expirationTime;
    if (typeof expirationTimeParam === 'number') {
      expirationTime = new Date(expirationTimeParam * 1000);
    } else if (typeof expirationTimeParam === 'string') {
      expirationTime = new Date(expirationTimeParam);
    } else {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, body['expiration_time'] + ' is not valid time.');
    }
    // Check expirationTime is valid or not, if it is not valid, expirationTime is NaN
    if (!isFinite(expirationTime)) {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, body['expiration_time'] + ' is not valid time.');
    }
    return expirationTime.valueOf();
  }

  static getExpirationInterval(body = {}) {
    const hasExpirationInterval = body.hasOwnProperty('expiration_interval');
    if (!hasExpirationInterval) {
      return;
    }

    var expirationIntervalParam = body['expiration_interval'];
    if (typeof expirationIntervalParam !== 'number' || expirationIntervalParam <= 0) {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, `expiration_interval must be a number greater than 0`);
    }
    return expirationIntervalParam;
  }

  /**
   * Get push time from the request body.
   * @param {Object} request A request object
   * @returns {Number|undefined} The push time if it exists in the request
   */
  static getPushTime(body = {}) {
    var hasPushTime = body.hasOwnProperty('push_time');
    if (!hasPushTime) {
      return;
    }
    var pushTimeParam = body['push_time'];
    var date;
    var isLocalTime = true;

    if (typeof pushTimeParam === 'number') {
      date = new Date(pushTimeParam * 1000);
    } else if (typeof pushTimeParam === 'string') {
      isLocalTime = !PushController.pushTimeHasTimezoneComponent(pushTimeParam);
      date = new Date(pushTimeParam);
    } else {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, body['push_time'] + ' is not valid time.');
    }
    // Check pushTime is valid or not, if it is not valid, pushTime is NaN
    if (!isFinite(date)) {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, body['push_time'] + ' is not valid time.');
    }

    return {
      date,
      isLocalTime
    };
  }

  /**
   * Checks if a ISO8601 formatted date contains a timezone component
   * @param pushTimeParam {string}
   * @returns {boolean}
   */
  static pushTimeHasTimezoneComponent(pushTimeParam) {
    const offsetPattern = /(.+)([+-])\d\d:\d\d$/;
    return pushTimeParam.indexOf('Z') === pushTimeParam.length - 1 // 2007-04-05T12:30Z
    || offsetPattern.test(pushTimeParam); // 2007-04-05T12:30.000+02:00, 2007-04-05T12:30.000-02:00
  }

  /**
   * Converts a date to ISO format in UTC time and strips the timezone if `isLocalTime` is true
   * @param date {Date}
   * @param isLocalTime {boolean}
   * @returns {string}
   */
  static formatPushTime({ date, isLocalTime }) {
    if (isLocalTime) {
      // Strip 'Z'
      const isoString = date.toISOString();
      return isoString.substring(0, isoString.indexOf('Z'));
    }
    return date.toISOString();
  }
}

exports.PushController = PushController;
exports.default = PushController;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9QdXNoQ29udHJvbGxlci5qcyJdLCJuYW1lcyI6WyJQdXNoQ29udHJvbGxlciIsInNlbmRQdXNoIiwiYm9keSIsIndoZXJlIiwiY29uZmlnIiwiYXV0aCIsIm9uUHVzaFN0YXR1c1NhdmVkIiwibm93IiwiRGF0ZSIsImhhc1B1c2hTdXBwb3J0IiwiUGFyc2UiLCJFcnJvciIsIlBVU0hfTUlTQ09ORklHVVJFRCIsImV4cGlyYXRpb25fdGltZSIsImdldEV4cGlyYXRpb25UaW1lIiwiZXhwaXJhdGlvbl9pbnRlcnZhbCIsImdldEV4cGlyYXRpb25JbnRlcnZhbCIsImhhc093blByb3BlcnR5IiwidHRsTXMiLCJ2YWx1ZU9mIiwicHVzaFRpbWUiLCJnZXRQdXNoVGltZSIsImRhdGUiLCJmb3JtYXRQdXNoVGltZSIsImJhZGdlVXBkYXRlIiwiUHJvbWlzZSIsInJlc29sdmUiLCJkYXRhIiwiYmFkZ2UiLCJyZXN0VXBkYXRlIiwidG9Mb3dlckNhc2UiLCJfX29wIiwiYW1vdW50IiwiTnVtYmVyIiwidXBkYXRlV2hlcmUiLCJyZXN0UXVlcnkiLCJSZXN0UXVlcnkiLCJyZXN0V2hlcmUiLCJkZXZpY2VUb2tlbiIsIiRuZSIsImJ1aWxkUmVzdFdoZXJlIiwidGhlbiIsIndyaXRlIiwiUmVzdFdyaXRlIiwicnVuT3B0aW9ucyIsIm1hbnkiLCJleGVjdXRlIiwicHVzaFN0YXR1cyIsInNldEluaXRpYWwiLCJvYmplY3RJZCIsImNhdGNoIiwiZXJyIiwic3RvcE9uQmFkZ2VVcGRhdGVFcnJvciIsImxvZ2dlciIsImluZm8iLCJzdGFjayIsInRvU3RyaW5nIiwibWVzc2FnZSIsImF1ZGllbmNlX2lkIiwiYXVkaWVuY2VJZCIsInVwZGF0ZUF1ZGllbmNlIiwibGFzdFVzZWQiLCJfX3R5cGUiLCJpc28iLCJ0b0lTT1N0cmluZyIsInRpbWVzVXNlZCIsImhhc1B1c2hTY2hlZHVsZWRTdXBwb3J0IiwicHVzaENvbnRyb2xsZXJRdWV1ZSIsImVucXVldWUiLCJmYWlsIiwiaGFzRXhwaXJhdGlvblRpbWUiLCJleHBpcmF0aW9uVGltZVBhcmFtIiwiZXhwaXJhdGlvblRpbWUiLCJpc0Zpbml0ZSIsImhhc0V4cGlyYXRpb25JbnRlcnZhbCIsImV4cGlyYXRpb25JbnRlcnZhbFBhcmFtIiwiaGFzUHVzaFRpbWUiLCJwdXNoVGltZVBhcmFtIiwiaXNMb2NhbFRpbWUiLCJwdXNoVGltZUhhc1RpbWV6b25lQ29tcG9uZW50Iiwib2Zmc2V0UGF0dGVybiIsImluZGV4T2YiLCJsZW5ndGgiLCJ0ZXN0IiwiaXNvU3RyaW5nIiwic3Vic3RyaW5nIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQUE7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOztBQUNBOztBQUNBOztBQUNBOzs7O0FBRU8sTUFBTUEsY0FBTixDQUFxQjs7QUFFMUJDLFdBQVNDLE9BQU8sRUFBaEIsRUFBb0JDLFFBQVEsRUFBNUIsRUFBZ0NDLE1BQWhDLEVBQXdDQyxJQUF4QyxFQUE4Q0Msb0JBQW9CLE1BQU0sQ0FBRSxDQUExRSxFQUE0RUMsTUFBTSxJQUFJQyxJQUFKLEVBQWxGLEVBQThGO0FBQzVGLFFBQUksQ0FBQ0osT0FBT0ssY0FBWixFQUE0QjtBQUMxQixZQUFNLElBQUlDLFlBQU1DLEtBQVYsQ0FBZ0JELFlBQU1DLEtBQU4sQ0FBWUMsa0JBQTVCLEVBQ0osNEJBREksQ0FBTjtBQUVEOztBQUVEO0FBQ0FWLFNBQUtXLGVBQUwsR0FBdUJiLGVBQWVjLGlCQUFmLENBQWlDWixJQUFqQyxDQUF2QjtBQUNBQSxTQUFLYSxtQkFBTCxHQUEyQmYsZUFBZWdCLHFCQUFmLENBQXFDZCxJQUFyQyxDQUEzQjtBQUNBLFFBQUlBLEtBQUtXLGVBQUwsSUFBd0JYLEtBQUthLG1CQUFqQyxFQUFzRDtBQUNwRCxZQUFNLElBQUlMLFlBQU1DLEtBQVYsQ0FDSkQsWUFBTUMsS0FBTixDQUFZQyxrQkFEUixFQUVKLDREQUZJLENBQU47QUFHRDs7QUFFRDtBQUNBLFFBQUlWLEtBQUthLG1CQUFMLElBQTRCLENBQUNi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QUFDRDtBQUNBLFFBQUksQ0FBQ3VFLFNBQVNuRCxJQUFULENBQUwsRUFBcUI7QUFDbkIsWUFBTSxJQUFJWixZQUFNQyxLQUFWLENBQWdCRCxZQUFNQyxLQUFOLENBQVlDLGtCQUE1QixFQUNKVixLQUFLLFdBQUwsSUFBb0IscUJBRGhCLENBQU47QUFFRDs7QUFFRCxXQUFPO0FBQ0xvQixVQURLO0FBRUx3RDtBQUZLLEtBQVA7QUFJRDs7QUFFRDs7Ozs7QUFLQSxTQUFPQyw0QkFBUCxDQUFvQ0YsYUFBcEMsRUFBb0U7QUFDbEUsVUFBTUcsZ0JBQWdCLHNCQUF0QjtBQUNBLFdBQU9ILGNBQWNJLE9BQWQsQ0FBc0IsR0FBdEIsTUFBK0JKLGNBQWNLLE1BQWQsR0FBdUIsQ0FBdEQsQ0FBd0Q7QUFBeEQsT0FDRkYsY0FBY0csSUFBZCxDQUFtQk4sYUFBbkIsQ0FETCxDQUZrRSxDQUcxQjtBQUN6Qzs7QUFFRDs7Ozs7O0FBTUEsU0FBT3RELGNBQVAsQ0FBc0IsRUFBRUQsSUFBRixFQUFRd0QsV0FBUixFQUF0QixFQUFtRjtBQUNqRixRQUFJQSxXQUFKLEVBQWlCO0FBQUU7QUFDakIsWUFBTU0sWUFBWTlELEtBQUswQyxXQUFMLEVBQWxCO0FBQ0EsYUFBT29CLFVBQVVDLFNBQVYsQ0FBb0IsQ0FBcEIsRUFBdUJELFVBQVVILE9BQVYsQ0FBa0IsR0FBbEIsQ0FBdkIsQ0FBUDtBQUNEO0FBQ0QsV0FBTzNELEtBQUswQyxXQUFMLEVBQVA7QUFDRDtBQXhNeUI7O1FBQWZoRSxjLEdBQUFBLGM7a0JBMk1FQSxjIiwiZmlsZSI6IlB1c2hDb250cm9sbGVyLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgUGFyc2UgfSAgICAgICAgICAgICAgZnJvbSAncGFyc2Uvbm9kZSc7XG5pbXBvcnQgUmVzdFF1ZXJ5ICAgICAgICAgICAgICBmcm9tICcuLi9SZXN0UXVlcnknO1xuaW1wb3J0IFJlc3RXcml0ZSAgICAgICAgICAgICAgZnJvbSAnLi4vUmVzdFdyaXRlJztcbmltcG9ydCB7IG1hc3RlciB9ICAgICAgICAgICAgIGZyb20gJy4uL0F1dGgnO1xuaW1wb3J0IHsgcHVzaFN0YXR1c0hhbmRsZXIgfSAgZnJvbSAnLi4vU3RhdHVzSGFuZGxlcic7XG5pbXBvcnQgeyBhcHBseURldmljZVRva2VuRXhpc3RzIH0gZnJvbSAnLi4vUHVzaC91dGlscyc7XG5pbXBvcnQgeyBsb2dnZXIgfSAgICAgICAgICAgICAgIGZyb20gJy4uL2xvZ2dlcic7XG5cbmV4cG9ydCBjbGFzcyBQdXNoQ29udHJvbGxlciB7XG5cbiAgc2VuZFB1c2goYm9keSA9IHt9LCB3aGVyZSA9IHt9LCBjb25maWcsIGF1dGgsIG9uUHVzaFN0YXR1c1NhdmVkID0gKCkgPT4ge30sIG5vdyA9IG5ldyBEYXRlKCkpIHtcbiAgICBpZiAoIWNvbmZpZy5oYXNQdXNoU3VwcG9ydCkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlBVU0hfTUlTQ09ORklHVVJFRCxcbiAgICAgICAgJ01pc3NpbmcgcHVzaCBjb25maWd1cmF0aW9uJyk7XG4gICAgfVxuXG4gICAgLy8gUmVwbGFjZSB0aGUgZXhwaXJhdGlvbl90aW1lIGFuZCBwdXNoX3RpbWUgd2l0aCBhIHZhbGlkIFVuaXggZXBvY2ggbWlsbGlzZWNvbmRzIHRpbWVcbiAgICBib2R5LmV4cGlyYXRpb25fdGltZSA9IFB1c2hDb250cm9sbGVyLmdldEV4cGlyYXRpb25UaW1lKGJvZHkpO1xuICAgIGJvZHkuZXhwaXJhdGlvbl9pbnRlcnZhbCA9IFB1c2hDb250cm9sbGVyLmdldEV4cGlyYXRpb25JbnRlcnZhbChib2R5KTtcbiAgICBpZiAoYm9keS5leHBpcmF0aW9uX3RpbWUgJiYgYm9keS5leHBpcmF0aW9uX2ludGVydmFsKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgIFBhcnNlLkVycm9yLlBVU0hfTUlTQ09ORklHVVJFRCxcbiAgICAgICAgJ0JvdGggZXhwaXJhdGlvbl90aW1lIGFuZCBleHBpcmF0aW9uX2ludGVydmFsIGNhbm5vdCBiZSBzZXQnKTtcbiAgICB9XG5cbiAgICAvLyBJbW1lZGlhdGUgcHVzaFxuICAgIGlmIChib2R5LmV4cGlyYXRpb25faW50ZXJ2YWwgJiYgIWJvZHkuaGFzT3duUHJvcGVydHkoJ3B1c2hfdGltZScpKSB7XG4gICAgICBjb25zdCB0dGxNcyA9IGJvZHkuZXhwaXJhdGlvbl9pbnRlcnZhbCAqIDEwMDA7XG4gICAgICBib2R5LmV4cGlyYXRpb25fdGltZSA9IChuZXcgRGF0ZShub3cudmFsdWVPZigpICsgdHRsTXMpKS52YWx1ZU9mKCk7XG4gICAgfVxuXG4gICAgY29uc3QgcHVzaFRpbWUgPSBQdXNoQ29udHJvbGxlci5nZXRQdXNoVGltZShib2R5KTtcbiAgICBpZiAocHVzaFRpbWUgJiYgcHVzaFRpbWUuZGF0ZSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIGJvZHlbJ3B1c2hfdGltZSddID0gUHVzaENvbnRyb2xsZXIuZm9ybWF0UHVzaFRpbWUocHVzaFRpbWUpO1xuICAgIH1cblxuICAgIC8vIFRPRE86IElmIHRoZSByZXEgY2FuIHBhc3MgdGhlIGNoZWNraW5nLCB3ZSByZXR1cm4gaW1tZWRpYXRlbHkgaW5zdGVhZCBvZiB3YWl0aW5nXG4gICAgLy8gcHVzaGVzIHRvIGJlIHNlbnQuIFdlIHByb2JhYmx5IGNoYW5nZSB0aGlzIGJlaGF2aW91ciBpbiB0aGUgZnV0dXJlLlxuICAgIGxldCBiYWRnZVVwZGF0ZSA9ICgpID0+IHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG5cbiAgICBpZiAoYm9keS5kYXRhICYmIGJvZHkuZGF0YS5iYWRnZSkge1xuICAgICAgY29uc3QgYmFkZ2UgPSBib2R5LmRhdGEuYmFkZ2U7XG4gICAgICBsZXQgcmVzdFVwZGF0ZSA9IHt9O1xuICAgICAgaWYgKHR5cGVvZiBiYWRnZSA9PSAnc3RyaW5nJyAmJiBiYWRnZS50b0xvd2VyQ2FzZSgpID09PSAnaW5jcmVtZW50Jykge1xuICAgICAgICByZXN0VXBkYXRlID0geyBiYWRnZTogeyBfX29wOiAnSW5jcmVtZW50JywgYW1vdW50OiAxIH0gfVxuICAgICAgfSBlbHNlIGlmICh0eXBlb2YgYmFkZ2UgPT0gJ29iamVjdCcgJiYgdHlwZW9mIGJhZGdlLl9fb3AgPT0gJ3N0cmluZycgJiZcbiAgICAgICAgICAgICAgICAgYmFkZ2UuX19vcC50b0xvd2VyQ2FzZSgpID09ICdpbmNyZW1lbnQnICYmIE51bWJlcihiYWRnZS5hbW91bnQpKSB7XG4gICAgICAgIHJlc3RVcGRhdGUgPSB7IGJhZGdlOiB7IF9fb3A6ICdJbmNyZW1lbnQnLCBhbW91bnQ6IGJhZGdlLmFtb3VudCB9IH1cbiAgICAgIH0gZWxzZSBpZiAoTnVtYmVyKGJhZGdlKSkge1xuICAgICAgICByZXN0VXBkYXRlID0geyBiYWRnZTogYmFkZ2UgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgXCJJbnZhbGlkIHZhbHVlIGZvciBiYWRnZSwgZXhwZWN0ZWQgbnVtYmVyIG9yICdJbmNyZW1lbnQnIG9yIHtpbmNyZW1lbnQ6IG51bWJlcn1cIjtcbiAgICAgIH1cblxuICAgICAgLy8gRm9yY2UgZmlsdGVyaW5nIG9uIG9ubHkgdmFsaWQgZGV2aWNlIHRva2Vuc1xuICAgICAgY29uc3QgdXBkYXRlV2hlcmUgPSBhcHBseURldmljZVRva2VuRXhpc3RzKHdoZXJlKTtcbiAgICAgIGJhZGdlVXBkYXRlID0gKCkgPT4ge1xuICAgICAgICAvLyBCdWlsZCBhIHJlYWwgUmVzdFF1ZXJ5IHNvIHdlIGNhbiB1c2UgaXQgaW4gUmVzdFdyaXRlXG4gICAgICAgIGNvbnN0IHJlc3RRdWVyeSA9IG5ldyBSZXN0UXVlcnkoY29uZmlnLCBtYXN0ZXIoY29uZmlnKSwgJ19JbnN0YWxsYXRpb24nLCB1cGRhdGVXaGVyZSk7XG4gICAgICAgIC8vIGNoYW5nZSAkZXhpc3RzIGZvciAkbmUgbnVsbCBmb3IgYmV0dGVyIHBlcmZvcm1hbmNlXG4gICAgICAgIGlmIChyZXN0UXVlcnkucmVzdFdoZXJlICYmIHJlc3RRdWVyeS5yZXN0V2hlcmUuZGV2aWNlVG9rZW4gJiYgcmVzdFF1ZXJ5LnJlc3RXaGVyZS5kZXZpY2VUb2tlblsnJGV4aXN0cyddKSByZXN0UXVlcnkucmVzdFdoZXJlLmRldmljZVRva2VuID0geyRuZTogbnVsbH1cbiAgICAgICAgcmV0dXJuIHJlc3RRdWVyeS5idWlsZFJlc3RXaGVyZSgpLnRoZW4oKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IHdyaXRlID0gbmV3IFJlc3RXcml0ZShjb25maWcsIG1hc3Rlcihjb25maWcpLCAnX0luc3RhbGxhdGlvbicsIHJlc3RRdWVyeS5yZXN0V2hlcmUsIHJlc3RVcGRhdGUpO1xuICAgICAgICAgIHdyaXRlLnJ1bk9wdGlvbnMubWFueSA9IHRydWU7XG4gICAgICAgICAgcmV0dXJuIHdyaXRlLmV4ZWN1dGUoKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IHB1c2hTdGF0dXMgPSBwdXNoU3RhdHVzSGFuZGxlcihjb25maWcpO1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiBwdXNoU3RhdHVzLnNldEluaXRpYWwoYm9keSwgd2hlcmUpO1xuICAgIH0pLnRoZW4oKCkgPT4ge1xuICAgICAgb25QdXNoU3RhdHVzU2F2ZWQocHVzaFN0YXR1cy5vYmplY3RJZCk7XG4gICAgICByZXR1cm4gYmFkZ2VVcGRhdGUoKTtcbiAgICB9KS5jYXRjaChlcnIgPT4ge1xuICAgICAgLy8gYWRkIHRoaXMgdG8gaWdub3JlIGJhZGdlIHVwZGF0ZSBlcnJvcnMgYXMgZGVmYXVsdFxuICAgICAgaWYgKGNvbmZpZy5zdG9wT25CYWRnZVVwZGF0ZUVycm9yKSB0aHJvdyBlcnI7XG4gICAgICBsb2dnZXIuaW5mbyhgQmFkZ2UgdXBkYXRlIGVycm9yIHdpbGwgYmUgaWdub3JlZCBmb3IgcHVzaCBzdGF0dXMgJHtwdXNoU3RhdHVzLm9iamVjdElkfWApO1xuICAgICAgbG9nZ2VyLmluZm8oZXJyICYmIGVyci5zdGFjayAmJiBlcnIuc3RhY2sudG9TdHJpbmcoKSB8fCBlcnIgJiYgZXJyLm1lc3NhZ2UgfHwgZXJyLnRvU3RyaW5nKCkpO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH0pLnRoZW4oKCkgPT4ge1xuICAgICAgLy8gVXBkYXRlIGF1ZGllbmNlIGxhc3RVc2VkIGFuZCB0aW1lc1VzZWRcbiAgICAgIGlmIChib2R5LmF1ZGllbmNlX2lkKSB7XG4gICAgICAgIGNvbnN0IGF1ZGllbmNlSWQgPSBib2R5LmF1ZGllbmNlX2lkO1xuXG4gICAgICAgIHZhciB1cGRhdGVBdWRpZW5jZSA9IHtcbiAgICAgICAgICBsYXN0VXNlZDogeyBfX3R5cGU6IFwiRGF0ZVwiLCBpc286IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSB9LFxuICAgICAgICAgIHRpbWVzVXNlZDogeyBfX29wOiBcIkluY3JlbWVudFwiLCBcImFtb3VudFwiOiAxIH1cbiAgICAgICAgfTtcbiAgICAgICAgY29uc3Qgd3JpdGUgPSBuZXcgUmVzdFdyaXRlKGNvbmZpZywgbWFzdGVyKGNvbmZpZyksICdfQXVkaWVuY2UnLCB7b2JqZWN0SWQ6IGF1ZGllbmNlSWR9LCB1cGRhdGVBdWRpZW5jZSk7XG4gICAgICAgIHdyaXRlLmV4ZWN1dGUoKTtcbiAgICAgIH1cbiAgICAgIC8vIERvbid0IHdhaXQgZm9yIHRoZSBhdWRpZW5jZSB1cGRhdGUgcHJvbWlzZSB0byByZXNvbHZlLlxuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH0pLnRoZW4oKCkgPT4ge1xuICAgICAgaWYgKGJvZHkuaGFzT3duUHJvcGVydHkoJ3B1c2hfdGltZScpICYmIGNvbmZpZy5oYXNQdXNoU2NoZWR1bGVkU3VwcG9ydCkge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gY29uZmlnLnB1c2hDb250cm9sbGVyUXVldWUuZW5xdWV1ZShib2R5LCB3aGVyZSwgY29uZmlnLCBhdXRoLCBwdXNoU3RhdHVzKTtcbiAgICB9KS5jYXRjaCgoZXJyKSA9PiB7XG4gICAgICByZXR1cm4gcHVzaFN0YXR1cy5mYWlsKGVycikudGhlbigoKSA9PiB7XG4gICAgICAgIHRocm93IGVycjtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBleHBpcmF0aW9uIHRpbWUgZnJvbSB0aGUgcmVxdWVzdCBib2R5LlxuICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCBBIHJlcXVlc3Qgb2JqZWN0XG4gICAqIEByZXR1cm5zIHtOdW1iZXJ8dW5kZWZpbmVkfSBUaGUgZXhwaXJhdGlvbiB0aW1lIGlmIGl0IGV4aXN0cyBpbiB0aGUgcmVxdWVzdFxuICAgKi9cbiAgc3RhdGljIGdldEV4cGlyYXRpb25UaW1lKGJvZHkgPSB7fSkge1xuICAgIHZhciBoYXNFeHBpcmF0aW9uVGltZSA9IGJvZHkuaGFzT3duUHJvcGVydHkoJ2V4cGlyYXRpb25fdGltZScpO1xuICAgIGlmICghaGFzRXhwaXJhdGlvblRpbWUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIGV4cGlyYXRpb25UaW1lUGFyYW0gPSBib2R5WydleHBpcmF0aW9uX3RpbWUnXTtcbiAgICB2YXIgZXhwaXJhdGlvblRpbWU7XG4gICAgaWYgKHR5cGVvZiBleHBpcmF0aW9uVGltZVBhcmFtID09PSAnbnVtYmVyJykge1xuICAgICAgZXhwaXJhdGlvblRpbWUgPSBuZXcgRGF0ZShleHBpcmF0aW9uVGltZVBhcmFtICogMTAwMCk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZXhwaXJhdGlvblRpbWVQYXJhbSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIGV4cGlyYXRpb25UaW1lID0gbmV3IERhdGUoZXhwaXJhdGlvblRpbWVQYXJhbSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgIGJvZHlbJ2V4cGlyYXRpb25fdGltZSddICsgJyBpcyBub3QgdmFsaWQgdGltZS4nKTtcbiAgICB9XG4gICAgLy8gQ2hlY2sgZXhwaXJhdGlvblRpbWUgaXMgdmFsaWQgb3Igbm90LCBpZiBpdCBpcyBub3QgdmFsaWQsIGV4cGlyYXRpb25UaW1lIGlzIE5hTlxuICAgIGlmICghaXNGaW5pdGUoZXhwaXJhdGlvblRpbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuUFVTSF9NSVNDT05GSUdVUkVELFxuICAgICAgICBib2R5WydleHBpcmF0aW9uX3RpbWUnXSArICcgaXMgbm90IHZhbGlkIHRpbWUuJyk7XG4gICAgfVxuICAgIHJldHVybiBleHBpcmF0aW9uVGltZS52YWx1ZU9mKCk7XG4gIH1cblxuICBzdGF0aWMgZ2V0RXhwaXJhdGlvbkludGVydmFsKGJvZHkgPSB7fSkge1xuICAgIGNvbnN0IGhhc0V4cGlyYXRpb25JbnRlcnZhbCA9IGJvZHkuaGFzT3duUHJvcGVydHkoJ2V4cGlyYXRpb25faW50ZXJ2YWwnKTtcbiAgICBpZiAoIWhhc0V4cGlyYXRpb25JbnRlcnZhbCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBleHBpcmF0aW9uSW50ZXJ2YWxQYXJhbSA9IGJvZHlbJ2V4cGlyYXRpb25faW50ZXJ2YWwnXTtcbiAgICBpZiAodHlwZW9mIGV4cGlyYXRpb25JbnRlcnZhbFBhcmFtICE9PSAnbnVtYmVyJyB8fCBleHBpcmF0aW9uSW50ZXJ2YWxQYXJhbSA8PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuUFVTSF9NSVNDT05GSUdVUkVELFxuICAgICAgICBgZXhwaXJhdGlvbl9pbnRlcnZhbCBtdXN0IGJlIGEgbnVtYmVyIGdyZWF0ZXIgdGhhbiAwYCk7XG4gICAgfVxuICAgIHJldHVybiBleHBpcmF0aW9uSW50ZXJ2YWxQYXJhbTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgcHVzaCB0aW1lIGZyb20gdGhlIHJlcXVlc3QgYm9keS5cbiAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgQSByZXF1ZXN0IG9iamVjdFxuICAgKiBAcmV0dXJucyB7TnVtYmVyfHVuZGVmaW5lZH0gVGhlIHB1c2ggdGltZSBpZiBpdCBleGlzdHMgaW4gdGhlIHJlcXVlc3RcbiAgICovXG4gIHN0YXRpYyBnZXRQdXNoVGltZShib2R5ID0ge30pIHtcbiAgICB2YXIgaGFzUHVzaFRpbWUgPSBib2R5Lmhhc093blByb3BlcnR5KCdwdXNoX3RpbWUnKTtcbiAgICBpZiAoIWhhc1B1c2hUaW1lKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciBwdXNoVGltZVBhcmFtID0gYm9keVsncHVzaF90aW1lJ107XG4gICAgdmFyIGRhdGU7XG4gICAgdmFyIGlzTG9jYWxUaW1lID0gdHJ1ZTtcblxuICAgIGlmICh0eXBlb2YgcHVzaFRpbWVQYXJhbSA9PT0gJ251bWJlcicpIHtcbiAgICAgIGRhdGUgPSBuZXcgRGF0ZShwdXNoVGltZVBhcmFtICogMTAwMCk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgcHVzaFRpbWVQYXJhbSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIGlzTG9jYWxUaW1lID0gIVB1c2hDb250cm9sbGVyLnB1c2hUaW1lSGFzVGltZXpvbmVDb21wb25lbnQocHVzaFRpbWVQYXJhbSk7XG4gICAgICBkYXRlID0gbmV3IERhdGUocHVzaFRpbWVQYXJhbSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgIGJvZHlbJ3B1c2hfdGltZSddICsgJyBpcyBub3QgdmFsaWQgdGltZS4nKTtcbiAgICB9XG4gICAgLy8gQ2hlY2sgcHVzaFRpbWUgaXMgdmFsaWQgb3Igbm90LCBpZiBpdCBpcyBub3QgdmFsaWQsIHB1c2hUaW1lIGlzIE5hTlxuICAgIGlmICghaXNGaW5pdGUoZGF0ZSkpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgIGJvZHlbJ3B1c2hfdGltZSddICsgJyBpcyBub3QgdmFsaWQgdGltZS4nKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgZGF0ZSxcbiAgICAgIGlzTG9jYWxUaW1lLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIGlmIGEgSVNPODYwMSBmb3JtYXR0ZWQgZGF0ZSBjb250YWlucyBhIHRpbWV6b25lIGNvbXBvbmVudFxuICAgKiBAcGFyYW0gcHVzaFRpbWVQYXJhbSB7c3RyaW5nfVxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn1cbiAgICovXG4gIHN0YXRpYyBwdXNoVGltZUhhc1RpbWV6b25lQ29tcG9uZW50KHB1c2hUaW1lUGFyYW06IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IG9mZnNldFBhdHRlcm4gPSAvKC4rKShbKy1dKVxcZFxcZDpcXGRcXGQkLztcbiAgICByZXR1cm4gcHVzaFRpbWVQYXJhbS5pbmRleE9mKCdaJykgPT09IHB1c2hUaW1lUGFyYW0ubGVuZ3RoIC0gMSAvLyAyMDA3LTA0LTA1VDEyOjMwWlxuICAgICAgfHwgb2Zmc2V0UGF0dGVybi50ZXN0KHB1c2hUaW1lUGFyYW0pOyAvLyAyMDA3LTA0LTA1VDEyOjMwLjAwMCswMjowMCwgMjAwNy0wNC0wNVQxMjozMC4wMDAtMDI6MDBcbiAgfVxuXG4gIC8qKlxuICAgKiBDb252ZXJ0cyBhIGRhdGUgdG8gSVNPIGZvcm1hdCBpbiBVVEMgdGltZSBhbmQgc3RyaXBzIHRoZSB0aW1lem9uZSBpZiBgaXNMb2NhbFRpbWVgIGlzIHRydWVcbiAgICogQHBhcmFtIGRhdGUge0RhdGV9XG4gICAqIEBwYXJhbSBpc0xvY2FsVGltZSB7Ym9vbGVhbn1cbiAgICogQHJldHVybnMge3N0cmluZ31cbiAgICovXG4gIHN0YXRpYyBmb3JtYXRQdXNoVGltZSh7IGRhdGUsIGlzTG9jYWxUaW1lIH06IHsgZGF0ZTogRGF0ZSwgaXNMb2NhbFRpbWU6IGJvb2xlYW4gfSkge1xuICAgIGlmIChpc0xvY2FsVGltZSkgeyAvLyBTdHJpcCAnWidcbiAgICAgIGNvbnN0IGlzb1N0cmluZyA9IGRhdGUudG9JU09TdHJpbmcoKTtcbiAgICAgIHJldHVybiBpc29TdHJpbmcuc3Vic3RyaW5nKDAsIGlzb1N0cmluZy5pbmRleE9mKCdaJykpO1xuICAgIH1cbiAgICByZXR1cm4gZGF0ZS50b0lTT1N0cmluZygpO1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IFB1c2hDb250cm9sbGVyO1xuIl19