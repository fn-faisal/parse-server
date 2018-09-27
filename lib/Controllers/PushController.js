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
      return badgeUpdate().catch(err => {
        // add this to ignore badge update errors as default
        if (config.stopOnBadgeUpdateError) throw err;
        _logger.logger.info(`Badge update error will be ignored for push status ${pushStatus.objectId}`);
        _logger.logger.info(err && err.stack && err.stack.toString() || err && err.message || err.toString());
        return Promise.resolve();
      });
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9QdXNoQ29udHJvbGxlci5qcyJdLCJuYW1lcyI6WyJQdXNoQ29udHJvbGxlciIsInNlbmRQdXNoIiwiYm9keSIsIndoZXJlIiwiY29uZmlnIiwiYXV0aCIsIm9uUHVzaFN0YXR1c1NhdmVkIiwibm93IiwiRGF0ZSIsImhhc1B1c2hTdXBwb3J0IiwiUGFyc2UiLCJFcnJvciIsIlBVU0hfTUlTQ09ORklHVVJFRCIsImV4cGlyYXRpb25fdGltZSIsImdldEV4cGlyYXRpb25UaW1lIiwiZXhwaXJhdGlvbl9pbnRlcnZhbCIsImdldEV4cGlyYXRpb25JbnRlcnZhbCIsImhhc093blByb3BlcnR5IiwidHRsTXMiLCJ2YWx1ZU9mIiwicHVzaFRpbWUiLCJnZXRQdXNoVGltZSIsImRhdGUiLCJmb3JtYXRQdXNoVGltZSIsImJhZGdlVXBkYXRlIiwiUHJvbWlzZSIsInJlc29sdmUiLCJkYXRhIiwiYmFkZ2UiLCJyZXN0VXBkYXRlIiwidG9Mb3dlckNhc2UiLCJfX29wIiwiYW1vdW50IiwiTnVtYmVyIiwidXBkYXRlV2hlcmUiLCJyZXN0UXVlcnkiLCJSZXN0UXVlcnkiLCJyZXN0V2hlcmUiLCJkZXZpY2VUb2tlbiIsIiRuZSIsImJ1aWxkUmVzdFdoZXJlIiwidGhlbiIsIndyaXRlIiwiUmVzdFdyaXRlIiwicnVuT3B0aW9ucyIsIm1hbnkiLCJleGVjdXRlIiwicHVzaFN0YXR1cyIsInNldEluaXRpYWwiLCJvYmplY3RJZCIsImNhdGNoIiwiZXJyIiwic3RvcE9uQmFkZ2VVcGRhdGVFcnJvciIsImxvZ2dlciIsImluZm8iLCJzdGFjayIsInRvU3RyaW5nIiwibWVzc2FnZSIsImF1ZGllbmNlX2lkIiwiYXVkaWVuY2VJZCIsInVwZGF0ZUF1ZGllbmNlIiwibGFzdFVzZWQiLCJfX3R5cGUiLCJpc28iLCJ0b0lTT1N0cmluZyIsInRpbWVzVXNlZCIsImhhc1B1c2hTY2hlZHVsZWRTdXBwb3J0IiwicHVzaENvbnRyb2xsZXJRdWV1ZSIsImVucXVldWUiLCJmYWlsIiwiaGFzRXhwaXJhdGlvblRpbWUiLCJleHBpcmF0aW9uVGltZVBhcmFtIiwiZXhwaXJhdGlvblRpbWUiLCJpc0Zpbml0ZSIsImhhc0V4cGlyYXRpb25JbnRlcnZhbCIsImV4cGlyYXRpb25JbnRlcnZhbFBhcmFtIiwiaGFzUHVzaFRpbWUiLCJwdXNoVGltZVBhcmFtIiwiaXNMb2NhbFRpbWUiLCJwdXNoVGltZUhhc1RpbWV6b25lQ29tcG9uZW50Iiwib2Zmc2V0UGF0dGVybiIsImluZGV4T2YiLCJsZW5ndGgiLCJ0ZXN0IiwiaXNvU3RyaW5nIiwic3Vic3RyaW5nIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQUE7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOztBQUNBOztBQUNBOztBQUNBOzs7O0FBRU8sTUFBTUEsY0FBTixDQUFxQjs7QUFFMUJDLFdBQVNDLE9BQU8sRUFBaEIsRUFBb0JDLFFBQVEsRUFBNUIsRUFBZ0NDLE1BQWhDLEVBQXdDQyxJQUF4QyxFQUE4Q0Msb0JBQW9CLE1BQU0sQ0FBRSxDQUExRSxFQUE0RUMsTUFBTSxJQUFJQyxJQUFKLEVBQWxGLEVBQThGO0FBQzVGLFFBQUksQ0FBQ0osT0FBT0ssY0FBWixFQUE0QjtBQUMxQixZQUFNLElBQUlDLFlBQU1DLEtBQVYsQ0FBZ0JELFlBQU1DLEtBQU4sQ0FBWUMsa0JBQTVCLEVBQ0osNEJBREksQ0FBTjtBQUVEOztBQUVEO0FBQ0FWLFNBQUtXLGVBQUwsR0FBdUJiLGVBQWVjLGlCQUFmLENBQWlDWixJQUFqQyxDQUF2QjtBQUNBQSxTQUFLYSxtQkFBTCxHQUEyQmYsZUFBZWdCLHFCQUFmLENBQXFDZCxJQUFyQyxDQUEzQjtBQUNBLFFBQUlBLEtBQUtXLGVBQUwsSUFBd0JYLEtBQUthLG1CQUFqQyxFQUFzRDtBQUNwRCxZQUFNLElBQUlMLFlBQU1DLEtBQVYsQ0FDSkQsWUFBTUMsS0FBTixDQUFZQyxrQkFEUixFQUVKLDREQUZJLENBQU47QUFHRDs7QUFFRDtBQUNBLFFBQUlWLEtBQUthLG1CQUFMLElBQTRCLENBQUNi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RDtBQUNEO0FBQ0EsUUFBSSxDQUFDdUUsU0FBU25ELElBQVQsQ0FBTCxFQUFxQjtBQUNuQixZQUFNLElBQUlaLFlBQU1DLEtBQVYsQ0FBZ0JELFlBQU1DLEtBQU4sQ0FBWUMsa0JBQTVCLEVBQ0pWLEtBQUssV0FBTCxJQUFvQixxQkFEaEIsQ0FBTjtBQUVEOztBQUVELFdBQU87QUFDTG9CLFVBREs7QUFFTHdEO0FBRkssS0FBUDtBQUlEOztBQUVEOzs7OztBQUtBLFNBQU9DLDRCQUFQLENBQW9DRixhQUFwQyxFQUFvRTtBQUNsRSxVQUFNRyxnQkFBZ0Isc0JBQXRCO0FBQ0EsV0FBT0gsY0FBY0ksT0FBZCxDQUFzQixHQUF0QixNQUErQkosY0FBY0ssTUFBZCxHQUF1QixDQUF0RCxDQUF3RDtBQUF4RCxPQUNGRixjQUFjRyxJQUFkLENBQW1CTixhQUFuQixDQURMLENBRmtFLENBRzFCO0FBQ3pDOztBQUVEOzs7Ozs7QUFNQSxTQUFPdEQsY0FBUCxDQUFzQixFQUFFRCxJQUFGLEVBQVF3RCxXQUFSLEVBQXRCLEVBQW1GO0FBQ2pGLFFBQUlBLFdBQUosRUFBaUI7QUFBRTtBQUNqQixZQUFNTSxZQUFZOUQsS0FBSzBDLFdBQUwsRUFBbEI7QUFDQSxhQUFPb0IsVUFBVUMsU0FBVixDQUFvQixDQUFwQixFQUF1QkQsVUFBVUgsT0FBVixDQUFrQixHQUFsQixDQUF2QixDQUFQO0FBQ0Q7QUFDRCxXQUFPM0QsS0FBSzBDLFdBQUwsRUFBUDtBQUNEO0FBeE15Qjs7UUFBZmhFLGMsR0FBQUEsYztrQkEyTUVBLGMiLCJmaWxlIjoiUHVzaENvbnRyb2xsZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBQYXJzZSB9ICAgICAgICAgICAgICBmcm9tICdwYXJzZS9ub2RlJztcbmltcG9ydCBSZXN0UXVlcnkgICAgICAgICAgICAgIGZyb20gJy4uL1Jlc3RRdWVyeSc7XG5pbXBvcnQgUmVzdFdyaXRlICAgICAgICAgICAgICBmcm9tICcuLi9SZXN0V3JpdGUnO1xuaW1wb3J0IHsgbWFzdGVyIH0gICAgICAgICAgICAgZnJvbSAnLi4vQXV0aCc7XG5pbXBvcnQgeyBwdXNoU3RhdHVzSGFuZGxlciB9ICBmcm9tICcuLi9TdGF0dXNIYW5kbGVyJztcbmltcG9ydCB7IGFwcGx5RGV2aWNlVG9rZW5FeGlzdHMgfSBmcm9tICcuLi9QdXNoL3V0aWxzJztcbmltcG9ydCB7IGxvZ2dlciB9ICAgICAgICAgICAgICAgZnJvbSAnLi4vbG9nZ2VyJztcblxuZXhwb3J0IGNsYXNzIFB1c2hDb250cm9sbGVyIHtcblxuICBzZW5kUHVzaChib2R5ID0ge30sIHdoZXJlID0ge30sIGNvbmZpZywgYXV0aCwgb25QdXNoU3RhdHVzU2F2ZWQgPSAoKSA9PiB7fSwgbm93ID0gbmV3IERhdGUoKSkge1xuICAgIGlmICghY29uZmlnLmhhc1B1c2hTdXBwb3J0KSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuUFVTSF9NSVNDT05GSUdVUkVELFxuICAgICAgICAnTWlzc2luZyBwdXNoIGNvbmZpZ3VyYXRpb24nKTtcbiAgICB9XG5cbiAgICAvLyBSZXBsYWNlIHRoZSBleHBpcmF0aW9uX3RpbWUgYW5kIHB1c2hfdGltZSB3aXRoIGEgdmFsaWQgVW5peCBlcG9jaCBtaWxsaXNlY29uZHMgdGltZVxuICAgIGJvZHkuZXhwaXJhdGlvbl90aW1lID0gUHVzaENvbnRyb2xsZXIuZ2V0RXhwaXJhdGlvblRpbWUoYm9keSk7XG4gICAgYm9keS5leHBpcmF0aW9uX2ludGVydmFsID0gUHVzaENvbnRyb2xsZXIuZ2V0RXhwaXJhdGlvbkludGVydmFsKGJvZHkpO1xuICAgIGlmIChib2R5LmV4cGlyYXRpb25fdGltZSAmJiBib2R5LmV4cGlyYXRpb25faW50ZXJ2YWwpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuUFVTSF9NSVNDT05GSUdVUkVELFxuICAgICAgICAnQm90aCBleHBpcmF0aW9uX3RpbWUgYW5kIGV4cGlyYXRpb25faW50ZXJ2YWwgY2Fubm90IGJlIHNldCcpO1xuICAgIH1cblxuICAgIC8vIEltbWVkaWF0ZSBwdXNoXG4gICAgaWYgKGJvZHkuZXhwaXJhdGlvbl9pbnRlcnZhbCAmJiAhYm9keS5oYXNPd25Qcm9wZXJ0eSgncHVzaF90aW1lJykpIHtcbiAgICAgIGNvbnN0IHR0bE1zID0gYm9keS5leHBpcmF0aW9uX2ludGVydmFsICogMTAwMDtcbiAgICAgIGJvZHkuZXhwaXJhdGlvbl90aW1lID0gKG5ldyBEYXRlKG5vdy52YWx1ZU9mKCkgKyB0dGxNcykpLnZhbHVlT2YoKTtcbiAgICB9XG5cbiAgICBjb25zdCBwdXNoVGltZSA9IFB1c2hDb250cm9sbGVyLmdldFB1c2hUaW1lKGJvZHkpO1xuICAgIGlmIChwdXNoVGltZSAmJiBwdXNoVGltZS5kYXRlICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgYm9keVsncHVzaF90aW1lJ10gPSBQdXNoQ29udHJvbGxlci5mb3JtYXRQdXNoVGltZShwdXNoVGltZSk7XG4gICAgfVxuXG4gICAgLy8gVE9ETzogSWYgdGhlIHJlcSBjYW4gcGFzcyB0aGUgY2hlY2tpbmcsIHdlIHJldHVybiBpbW1lZGlhdGVseSBpbnN0ZWFkIG9mIHdhaXRpbmdcbiAgICAvLyBwdXNoZXMgdG8gYmUgc2VudC4gV2UgcHJvYmFibHkgY2hhbmdlIHRoaXMgYmVoYXZpb3VyIGluIHRoZSBmdXR1cmUuXG4gICAgbGV0IGJhZGdlVXBkYXRlID0gKCkgPT4ge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cblxuICAgIGlmIChib2R5LmRhdGEgJiYgYm9keS5kYXRhLmJhZGdlKSB7XG4gICAgICBjb25zdCBiYWRnZSA9IGJvZHkuZGF0YS5iYWRnZTtcbiAgICAgIGxldCByZXN0VXBkYXRlID0ge307XG4gICAgICBpZiAodHlwZW9mIGJhZGdlID09ICdzdHJpbmcnICYmIGJhZGdlLnRvTG93ZXJDYXNlKCkgPT09ICdpbmNyZW1lbnQnKSB7XG4gICAgICAgIHJlc3RVcGRhdGUgPSB7IGJhZGdlOiB7IF9fb3A6ICdJbmNyZW1lbnQnLCBhbW91bnQ6IDEgfSB9XG4gICAgICB9IGVsc2UgaWYgKHR5cGVvZiBiYWRnZSA9PSAnb2JqZWN0JyAmJiB0eXBlb2YgYmFkZ2UuX19vcCA9PSAnc3RyaW5nJyAmJlxuICAgICAgICAgICAgICAgICBiYWRnZS5fX29wLnRvTG93ZXJDYXNlKCkgPT0gJ2luY3JlbWVudCcgJiYgTnVtYmVyKGJhZGdlLmFtb3VudCkpIHtcbiAgICAgICAgcmVzdFVwZGF0ZSA9IHsgYmFkZ2U6IHsgX19vcDogJ0luY3JlbWVudCcsIGFtb3VudDogYmFkZ2UuYW1vdW50IH0gfVxuICAgICAgfSBlbHNlIGlmIChOdW1iZXIoYmFkZ2UpKSB7XG4gICAgICAgIHJlc3RVcGRhdGUgPSB7IGJhZGdlOiBiYWRnZSB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBcIkludmFsaWQgdmFsdWUgZm9yIGJhZGdlLCBleHBlY3RlZCBudW1iZXIgb3IgJ0luY3JlbWVudCcgb3Ige2luY3JlbWVudDogbnVtYmVyfVwiO1xuICAgICAgfVxuXG4gICAgICAvLyBGb3JjZSBmaWx0ZXJpbmcgb24gb25seSB2YWxpZCBkZXZpY2UgdG9rZW5zXG4gICAgICBjb25zdCB1cGRhdGVXaGVyZSA9IGFwcGx5RGV2aWNlVG9rZW5FeGlzdHMod2hlcmUpO1xuICAgICAgYmFkZ2VVcGRhdGUgPSAoKSA9PiB7XG4gICAgICAgIC8vIEJ1aWxkIGEgcmVhbCBSZXN0UXVlcnkgc28gd2UgY2FuIHVzZSBpdCBpbiBSZXN0V3JpdGVcbiAgICAgICAgY29uc3QgcmVzdFF1ZXJ5ID0gbmV3IFJlc3RRdWVyeShjb25maWcsIG1hc3Rlcihjb25maWcpLCAnX0luc3RhbGxhdGlvbicsIHVwZGF0ZVdoZXJlKTtcbiAgICAgICAgLy8gY2hhbmdlICRleGlzdHMgZm9yICRuZSBudWxsIGZvciBiZXR0ZXIgcGVyZm9ybWFuY2VcbiAgICAgICAgaWYgKHJlc3RRdWVyeS5yZXN0V2hlcmUgJiYgcmVzdFF1ZXJ5LnJlc3RXaGVyZS5kZXZpY2VUb2tlbiAmJiByZXN0UXVlcnkucmVzdFdoZXJlLmRldmljZVRva2VuWyckZXhpc3RzJ10pIHJlc3RRdWVyeS5yZXN0V2hlcmUuZGV2aWNlVG9rZW4gPSB7JG5lOiBudWxsfVxuICAgICAgICByZXR1cm4gcmVzdFF1ZXJ5LmJ1aWxkUmVzdFdoZXJlKCkudGhlbigoKSA9PiB7XG4gICAgICAgICAgY29uc3Qgd3JpdGUgPSBuZXcgUmVzdFdyaXRlKGNvbmZpZywgbWFzdGVyKGNvbmZpZyksICdfSW5zdGFsbGF0aW9uJywgcmVzdFF1ZXJ5LnJlc3RXaGVyZSwgcmVzdFVwZGF0ZSk7XG4gICAgICAgICAgd3JpdGUucnVuT3B0aW9ucy5tYW55ID0gdHJ1ZTtcbiAgICAgICAgICByZXR1cm4gd3JpdGUuZXhlY3V0ZSgpO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgcHVzaFN0YXR1cyA9IHB1c2hTdGF0dXNIYW5kbGVyKGNvbmZpZyk7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHB1c2hTdGF0dXMuc2V0SW5pdGlhbChib2R5LCB3aGVyZSk7XG4gICAgfSkudGhlbigoKSA9PiB7XG4gICAgICBvblB1c2hTdGF0dXNTYXZlZChwdXNoU3RhdHVzLm9iamVjdElkKTtcbiAgICAgIHJldHVybiBiYWRnZVVwZGF0ZSgpLmNhdGNoKGVyciA9PiB7XG4gICAgICAgIC8vIGFkZCB0aGlzIHRvIGlnbm9yZSBiYWRnZSB1cGRhdGUgZXJyb3JzIGFzIGRlZmF1bHRcbiAgICAgICAgaWYgKGNvbmZpZy5zdG9wT25CYWRnZVVwZGF0ZUVycm9yKSB0aHJvdyBlcnI7XG4gICAgICAgIGxvZ2dlci5pbmZvKGBCYWRnZSB1cGRhdGUgZXJyb3Igd2lsbCBiZSBpZ25vcmVkIGZvciBwdXNoIHN0YXR1cyAke3B1c2hTdGF0dXMub2JqZWN0SWR9YCk7XG4gICAgICAgIGxvZ2dlci5pbmZvKGVyciAmJiBlcnIuc3RhY2sgJiYgZXJyLnN0YWNrLnRvU3RyaW5nKCkgfHwgZXJyICYmIGVyci5tZXNzYWdlIHx8IGVyci50b1N0cmluZygpKTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgfSk7XG4gICAgfSkudGhlbigoKSA9PiB7XG4gICAgICAvLyBVcGRhdGUgYXVkaWVuY2UgbGFzdFVzZWQgYW5kIHRpbWVzVXNlZFxuICAgICAgaWYgKGJvZHkuYXVkaWVuY2VfaWQpIHtcbiAgICAgICAgY29uc3QgYXVkaWVuY2VJZCA9IGJvZHkuYXVkaWVuY2VfaWQ7XG5cbiAgICAgICAgdmFyIHVwZGF0ZUF1ZGllbmNlID0ge1xuICAgICAgICAgIGxhc3RVc2VkOiB7IF9fdHlwZTogXCJEYXRlXCIsIGlzbzogbmV3IERhdGUoKS50b0lTT1N0cmluZygpIH0sXG4gICAgICAgICAgdGltZXNVc2VkOiB7IF9fb3A6IFwiSW5jcmVtZW50XCIsIFwiYW1vdW50XCI6IDEgfVxuICAgICAgICB9O1xuICAgICAgICBjb25zdCB3cml0ZSA9IG5ldyBSZXN0V3JpdGUoY29uZmlnLCBtYXN0ZXIoY29uZmlnKSwgJ19BdWRpZW5jZScsIHtvYmplY3RJZDogYXVkaWVuY2VJZH0sIHVwZGF0ZUF1ZGllbmNlKTtcbiAgICAgICAgd3JpdGUuZXhlY3V0ZSgpO1xuICAgICAgfVxuICAgICAgLy8gRG9uJ3Qgd2FpdCBmb3IgdGhlIGF1ZGllbmNlIHVwZGF0ZSBwcm9taXNlIHRvIHJlc29sdmUuXG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfSkudGhlbigoKSA9PiB7XG4gICAgICBpZiAoYm9keS5oYXNPd25Qcm9wZXJ0eSgncHVzaF90aW1lJykgJiYgY29uZmlnLmhhc1B1c2hTY2hlZHVsZWRTdXBwb3J0KSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBjb25maWcucHVzaENvbnRyb2xsZXJRdWV1ZS5lbnF1ZXVlKGJvZHksIHdoZXJlLCBjb25maWcsIGF1dGgsIHB1c2hTdGF0dXMpO1xuICAgIH0pLmNhdGNoKChlcnIpID0+IHtcbiAgICAgIHJldHVybiBwdXNoU3RhdHVzLmZhaWwoZXJyKS50aGVuKCgpID0+IHtcbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGV4cGlyYXRpb24gdGltZSBmcm9tIHRoZSByZXF1ZXN0IGJvZHkuXG4gICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IEEgcmVxdWVzdCBvYmplY3RcbiAgICogQHJldHVybnMge051bWJlcnx1bmRlZmluZWR9IFRoZSBleHBpcmF0aW9uIHRpbWUgaWYgaXQgZXhpc3RzIGluIHRoZSByZXF1ZXN0XG4gICAqL1xuICBzdGF0aWMgZ2V0RXhwaXJhdGlvblRpbWUoYm9keSA9IHt9KSB7XG4gICAgdmFyIGhhc0V4cGlyYXRpb25UaW1lID0gYm9keS5oYXNPd25Qcm9wZXJ0eSgnZXhwaXJhdGlvbl90aW1lJyk7XG4gICAgaWYgKCFoYXNFeHBpcmF0aW9uVGltZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgZXhwaXJhdGlvblRpbWVQYXJhbSA9IGJvZHlbJ2V4cGlyYXRpb25fdGltZSddO1xuICAgIHZhciBleHBpcmF0aW9uVGltZTtcbiAgICBpZiAodHlwZW9mIGV4cGlyYXRpb25UaW1lUGFyYW0gPT09ICdudW1iZXInKSB7XG4gICAgICBleHBpcmF0aW9uVGltZSA9IG5ldyBEYXRlKGV4cGlyYXRpb25UaW1lUGFyYW0gKiAxMDAwKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBleHBpcmF0aW9uVGltZVBhcmFtID09PSAnc3RyaW5nJykge1xuICAgICAgZXhwaXJhdGlvblRpbWUgPSBuZXcgRGF0ZShleHBpcmF0aW9uVGltZVBhcmFtKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlBVU0hfTUlTQ09ORklHVVJFRCxcbiAgICAgICAgYm9keVsnZXhwaXJhdGlvbl90aW1lJ10gKyAnIGlzIG5vdCB2YWxpZCB0aW1lLicpO1xuICAgIH1cbiAgICAvLyBDaGVjayBleHBpcmF0aW9uVGltZSBpcyB2YWxpZCBvciBub3QsIGlmIGl0IGlzIG5vdCB2YWxpZCwgZXhwaXJhdGlvblRpbWUgaXMgTmFOXG4gICAgaWYgKCFpc0Zpbml0ZShleHBpcmF0aW9uVGltZSkpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgIGJvZHlbJ2V4cGlyYXRpb25fdGltZSddICsgJyBpcyBub3QgdmFsaWQgdGltZS4nKTtcbiAgICB9XG4gICAgcmV0dXJuIGV4cGlyYXRpb25UaW1lLnZhbHVlT2YoKTtcbiAgfVxuXG4gIHN0YXRpYyBnZXRFeHBpcmF0aW9uSW50ZXJ2YWwoYm9keSA9IHt9KSB7XG4gICAgY29uc3QgaGFzRXhwaXJhdGlvbkludGVydmFsID0gYm9keS5oYXNPd25Qcm9wZXJ0eSgnZXhwaXJhdGlvbl9pbnRlcnZhbCcpO1xuICAgIGlmICghaGFzRXhwaXJhdGlvbkludGVydmFsKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGV4cGlyYXRpb25JbnRlcnZhbFBhcmFtID0gYm9keVsnZXhwaXJhdGlvbl9pbnRlcnZhbCddO1xuICAgIGlmICh0eXBlb2YgZXhwaXJhdGlvbkludGVydmFsUGFyYW0gIT09ICdudW1iZXInIHx8IGV4cGlyYXRpb25JbnRlcnZhbFBhcmFtIDw9IDApIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgIGBleHBpcmF0aW9uX2ludGVydmFsIG11c3QgYmUgYSBudW1iZXIgZ3JlYXRlciB0aGFuIDBgKTtcbiAgICB9XG4gICAgcmV0dXJuIGV4cGlyYXRpb25JbnRlcnZhbFBhcmFtO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBwdXNoIHRpbWUgZnJvbSB0aGUgcmVxdWVzdCBib2R5LlxuICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCBBIHJlcXVlc3Qgb2JqZWN0XG4gICAqIEByZXR1cm5zIHtOdW1iZXJ8dW5kZWZpbmVkfSBUaGUgcHVzaCB0aW1lIGlmIGl0IGV4aXN0cyBpbiB0aGUgcmVxdWVzdFxuICAgKi9cbiAgc3RhdGljIGdldFB1c2hUaW1lKGJvZHkgPSB7fSkge1xuICAgIHZhciBoYXNQdXNoVGltZSA9IGJvZHkuaGFzT3duUHJvcGVydHkoJ3B1c2hfdGltZScpO1xuICAgIGlmICghaGFzUHVzaFRpbWUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIHB1c2hUaW1lUGFyYW0gPSBib2R5WydwdXNoX3RpbWUnXTtcbiAgICB2YXIgZGF0ZTtcbiAgICB2YXIgaXNMb2NhbFRpbWUgPSB0cnVlO1xuXG4gICAgaWYgKHR5cGVvZiBwdXNoVGltZVBhcmFtID09PSAnbnVtYmVyJykge1xuICAgICAgZGF0ZSA9IG5ldyBEYXRlKHB1c2hUaW1lUGFyYW0gKiAxMDAwKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBwdXNoVGltZVBhcmFtID09PSAnc3RyaW5nJykge1xuICAgICAgaXNMb2NhbFRpbWUgPSAhUHVzaENvbnRyb2xsZXIucHVzaFRpbWVIYXNUaW1lem9uZUNvbXBvbmVudChwdXNoVGltZVBhcmFtKTtcbiAgICAgIGRhdGUgPSBuZXcgRGF0ZShwdXNoVGltZVBhcmFtKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlBVU0hfTUlTQ09ORklHVVJFRCxcbiAgICAgICAgYm9keVsncHVzaF90aW1lJ10gKyAnIGlzIG5vdCB2YWxpZCB0aW1lLicpO1xuICAgIH1cbiAgICAvLyBDaGVjayBwdXNoVGltZSBpcyB2YWxpZCBvciBub3QsIGlmIGl0IGlzIG5vdCB2YWxpZCwgcHVzaFRpbWUgaXMgTmFOXG4gICAgaWYgKCFpc0Zpbml0ZShkYXRlKSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlBVU0hfTUlTQ09ORklHVVJFRCxcbiAgICAgICAgYm9keVsncHVzaF90aW1lJ10gKyAnIGlzIG5vdCB2YWxpZCB0aW1lLicpO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBkYXRlLFxuICAgICAgaXNMb2NhbFRpbWUsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3MgaWYgYSBJU084NjAxIGZvcm1hdHRlZCBkYXRlIGNvbnRhaW5zIGEgdGltZXpvbmUgY29tcG9uZW50XG4gICAqIEBwYXJhbSBwdXNoVGltZVBhcmFtIHtzdHJpbmd9XG4gICAqIEByZXR1cm5zIHtib29sZWFufVxuICAgKi9cbiAgc3RhdGljIHB1c2hUaW1lSGFzVGltZXpvbmVDb21wb25lbnQocHVzaFRpbWVQYXJhbTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgY29uc3Qgb2Zmc2V0UGF0dGVybiA9IC8oLispKFsrLV0pXFxkXFxkOlxcZFxcZCQvO1xuICAgIHJldHVybiBwdXNoVGltZVBhcmFtLmluZGV4T2YoJ1onKSA9PT0gcHVzaFRpbWVQYXJhbS5sZW5ndGggLSAxIC8vIDIwMDctMDQtMDVUMTI6MzBaXG4gICAgICB8fCBvZmZzZXRQYXR0ZXJuLnRlc3QocHVzaFRpbWVQYXJhbSk7IC8vIDIwMDctMDQtMDVUMTI6MzAuMDAwKzAyOjAwLCAyMDA3LTA0LTA1VDEyOjMwLjAwMC0wMjowMFxuICB9XG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIGEgZGF0ZSB0byBJU08gZm9ybWF0IGluIFVUQyB0aW1lIGFuZCBzdHJpcHMgdGhlIHRpbWV6b25lIGlmIGBpc0xvY2FsVGltZWAgaXMgdHJ1ZVxuICAgKiBAcGFyYW0gZGF0ZSB7RGF0ZX1cbiAgICogQHBhcmFtIGlzTG9jYWxUaW1lIHtib29sZWFufVxuICAgKiBAcmV0dXJucyB7c3RyaW5nfVxuICAgKi9cbiAgc3RhdGljIGZvcm1hdFB1c2hUaW1lKHsgZGF0ZSwgaXNMb2NhbFRpbWUgfTogeyBkYXRlOiBEYXRlLCBpc0xvY2FsVGltZTogYm9vbGVhbiB9KSB7XG4gICAgaWYgKGlzTG9jYWxUaW1lKSB7IC8vIFN0cmlwICdaJ1xuICAgICAgY29uc3QgaXNvU3RyaW5nID0gZGF0ZS50b0lTT1N0cmluZygpO1xuICAgICAgcmV0dXJuIGlzb1N0cmluZy5zdWJzdHJpbmcoMCwgaXNvU3RyaW5nLmluZGV4T2YoJ1onKSk7XG4gICAgfVxuICAgIHJldHVybiBkYXRlLnRvSVNPU3RyaW5nKCk7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgUHVzaENvbnRyb2xsZXI7XG4iXX0=