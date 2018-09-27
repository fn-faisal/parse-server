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
      if (config.stopOnBadgeUpdateError) return badgeUpdate();
      _logger.logger.info(`Badge update error will be ignored for push status ${pushStatus.objectId}`);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9QdXNoQ29udHJvbGxlci5qcyJdLCJuYW1lcyI6WyJQdXNoQ29udHJvbGxlciIsInNlbmRQdXNoIiwiYm9keSIsIndoZXJlIiwiY29uZmlnIiwiYXV0aCIsIm9uUHVzaFN0YXR1c1NhdmVkIiwibm93IiwiRGF0ZSIsImhhc1B1c2hTdXBwb3J0IiwiUGFyc2UiLCJFcnJvciIsIlBVU0hfTUlTQ09ORklHVVJFRCIsImV4cGlyYXRpb25fdGltZSIsImdldEV4cGlyYXRpb25UaW1lIiwiZXhwaXJhdGlvbl9pbnRlcnZhbCIsImdldEV4cGlyYXRpb25JbnRlcnZhbCIsImhhc093blByb3BlcnR5IiwidHRsTXMiLCJ2YWx1ZU9mIiwicHVzaFRpbWUiLCJnZXRQdXNoVGltZSIsImRhdGUiLCJmb3JtYXRQdXNoVGltZSIsImJhZGdlVXBkYXRlIiwiUHJvbWlzZSIsInJlc29sdmUiLCJkYXRhIiwiYmFkZ2UiLCJyZXN0VXBkYXRlIiwidG9Mb3dlckNhc2UiLCJfX29wIiwiYW1vdW50IiwiTnVtYmVyIiwidXBkYXRlV2hlcmUiLCJyZXN0UXVlcnkiLCJSZXN0UXVlcnkiLCJyZXN0V2hlcmUiLCJkZXZpY2VUb2tlbiIsIiRuZSIsImJ1aWxkUmVzdFdoZXJlIiwidGhlbiIsIndyaXRlIiwiUmVzdFdyaXRlIiwicnVuT3B0aW9ucyIsIm1hbnkiLCJleGVjdXRlIiwicHVzaFN0YXR1cyIsInNldEluaXRpYWwiLCJvYmplY3RJZCIsInN0b3BPbkJhZGdlVXBkYXRlRXJyb3IiLCJsb2dnZXIiLCJpbmZvIiwiYXVkaWVuY2VfaWQiLCJhdWRpZW5jZUlkIiwidXBkYXRlQXVkaWVuY2UiLCJsYXN0VXNlZCIsIl9fdHlwZSIsImlzbyIsInRvSVNPU3RyaW5nIiwidGltZXNVc2VkIiwiaGFzUHVzaFNjaGVkdWxlZFN1cHBvcnQiLCJwdXNoQ29udHJvbGxlclF1ZXVlIiwiZW5xdWV1ZSIsImNhdGNoIiwiZXJyIiwiZmFpbCIsImhhc0V4cGlyYXRpb25UaW1lIiwiZXhwaXJhdGlvblRpbWVQYXJhbSIsImV4cGlyYXRpb25UaW1lIiwiaXNGaW5pdGUiLCJoYXNFeHBpcmF0aW9uSW50ZXJ2YWwiLCJleHBpcmF0aW9uSW50ZXJ2YWxQYXJhbSIsImhhc1B1c2hUaW1lIiwicHVzaFRpbWVQYXJhbSIsImlzTG9jYWxUaW1lIiwicHVzaFRpbWVIYXNUaW1lem9uZUNvbXBvbmVudCIsIm9mZnNldFBhdHRlcm4iLCJpbmRleE9mIiwibGVuZ3RoIiwidGVzdCIsImlzb1N0cmluZyIsInN1YnN0cmluZyJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUFBOztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7OztBQUVPLE1BQU1BLGNBQU4sQ0FBcUI7O0FBRTFCQyxXQUFTQyxPQUFPLEVBQWhCLEVBQW9CQyxRQUFRLEVBQTVCLEVBQWdDQyxNQUFoQyxFQUF3Q0MsSUFBeEMsRUFBOENDLG9CQUFvQixNQUFNLENBQUUsQ0FBMUUsRUFBNEVDLE1BQU0sSUFBSUMsSUFBSixFQUFsRixFQUE4RjtBQUM1RixRQUFJLENBQUNKLE9BQU9LLGNBQVosRUFBNEI7QUFDMUIsWUFBTSxJQUFJQyxZQUFNQyxLQUFWLENBQWdCRCxZQUFNQyxLQUFOLENBQVlDLGtCQUE1QixFQUNKLDRCQURJLENBQU47QUFFRDs7QUFFRDtBQUNBVixTQUFLVyxlQUFMLEdBQXVCYixlQUFlYyxpQkFBZixDQUFpQ1osSUFBakMsQ0FBdkI7QUFDQUEsU0FBS2EsbUJBQUwsR0FBMkJmLGVBQWVnQixxQkFBZixDQUFxQ2QsSUFBckMsQ0FBM0I7QUFDQSxRQUFJQSxLQUFLVyxlQUFMLElBQXdCWCxLQUFLYSxtQkFBakMsRUFBc0Q7QUFDcEQsWUFBTSxJQUFJTCxZQUFNQyxLQUFWLENBQ0pELFlBQU1DLEtBQU4sQ0FBWUMsa0JBRFIsRUFFSiw0REFGSSxDQUFOO0FBR0Q7O0FBRUQ7QUFDQSxRQUFJVixLQUFLYSxtQkFBTCxJQUE0QixDQUFDYixLQUFLZSxjQUFMLENBQW9CLFdBQXBCLENBQWpD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QU9DLDRCQUFQLENBQW9DRixhQUFwQyxFQUFvRTtBQUNsRSxVQUFNRyxnQkFBZ0Isc0JBQXRCO0FBQ0EsV0FBT0gsY0FBY0ksT0FBZCxDQUFzQixHQUF0QixNQUErQkosY0FBY0ssTUFBZCxHQUF1QixDQUF0RCxDQUF3RDtBQUF4RCxPQUNGRixjQUFjRyxJQUFkLENBQW1CTixhQUFuQixDQURMLENBRmtFLENBRzFCO0FBQ3pDOztBQUVEOzs7Ozs7QUFNQSxTQUFPbkQsY0FBUCxDQUFzQixFQUFFRCxJQUFGLEVBQVFxRCxXQUFSLEVBQXRCLEVBQW1GO0FBQ2pGLFFBQUlBLFdBQUosRUFBaUI7QUFBRTtBQUNqQixZQUFNTSxZQUFZM0QsS0FBS3FDLFdBQUwsRUFBbEI7QUFDQSxhQUFPc0IsVUFBVUMsU0FBVixDQUFvQixDQUFwQixFQUF1QkQsVUFBVUgsT0FBVixDQUFrQixHQUFsQixDQUF2QixDQUFQO0FBQ0Q7QUFDRCxXQUFPeEQsS0FBS3FDLFdBQUwsRUFBUDtBQUNEO0FBcE15Qjs7UUFBZjNELGMsR0FBQUEsYztrQkF1TUVBLGMiLCJmaWxlIjoiUHVzaENvbnRyb2xsZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBQYXJzZSB9ICAgICAgICAgICAgICBmcm9tICdwYXJzZS9ub2RlJztcbmltcG9ydCBSZXN0UXVlcnkgICAgICAgICAgICAgIGZyb20gJy4uL1Jlc3RRdWVyeSc7XG5pbXBvcnQgUmVzdFdyaXRlICAgICAgICAgICAgICBmcm9tICcuLi9SZXN0V3JpdGUnO1xuaW1wb3J0IHsgbWFzdGVyIH0gICAgICAgICAgICAgZnJvbSAnLi4vQXV0aCc7XG5pbXBvcnQgeyBwdXNoU3RhdHVzSGFuZGxlciB9ICBmcm9tICcuLi9TdGF0dXNIYW5kbGVyJztcbmltcG9ydCB7IGFwcGx5RGV2aWNlVG9rZW5FeGlzdHMgfSBmcm9tICcuLi9QdXNoL3V0aWxzJztcbmltcG9ydCB7IGxvZ2dlciB9ICAgICAgICAgICAgICAgZnJvbSAnLi4vbG9nZ2VyJztcblxuZXhwb3J0IGNsYXNzIFB1c2hDb250cm9sbGVyIHtcblxuICBzZW5kUHVzaChib2R5ID0ge30sIHdoZXJlID0ge30sIGNvbmZpZywgYXV0aCwgb25QdXNoU3RhdHVzU2F2ZWQgPSAoKSA9PiB7fSwgbm93ID0gbmV3IERhdGUoKSkge1xuICAgIGlmICghY29uZmlnLmhhc1B1c2hTdXBwb3J0KSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuUFVTSF9NSVNDT05GSUdVUkVELFxuICAgICAgICAnTWlzc2luZyBwdXNoIGNvbmZpZ3VyYXRpb24nKTtcbiAgICB9XG5cbiAgICAvLyBSZXBsYWNlIHRoZSBleHBpcmF0aW9uX3RpbWUgYW5kIHB1c2hfdGltZSB3aXRoIGEgdmFsaWQgVW5peCBlcG9jaCBtaWxsaXNlY29uZHMgdGltZVxuICAgIGJvZHkuZXhwaXJhdGlvbl90aW1lID0gUHVzaENvbnRyb2xsZXIuZ2V0RXhwaXJhdGlvblRpbWUoYm9keSk7XG4gICAgYm9keS5leHBpcmF0aW9uX2ludGVydmFsID0gUHVzaENvbnRyb2xsZXIuZ2V0RXhwaXJhdGlvbkludGVydmFsKGJvZHkpO1xuICAgIGlmIChib2R5LmV4cGlyYXRpb25fdGltZSAmJiBib2R5LmV4cGlyYXRpb25faW50ZXJ2YWwpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuUFVTSF9NSVNDT05GSUdVUkVELFxuICAgICAgICAnQm90aCBleHBpcmF0aW9uX3RpbWUgYW5kIGV4cGlyYXRpb25faW50ZXJ2YWwgY2Fubm90IGJlIHNldCcpO1xuICAgIH1cblxuICAgIC8vIEltbWVkaWF0ZSBwdXNoXG4gICAgaWYgKGJvZHkuZXhwaXJhdGlvbl9pbnRlcnZhbCAmJiAhYm9keS5oYXNPd25Qcm9wZXJ0eSgncHVzaF90aW1lJykpIHtcbiAgICAgIGNvbnN0IHR0bE1zID0gYm9keS5leHBpcmF0aW9uX2ludGVydmFsICogMTAwMDtcbiAgICAgIGJvZHkuZXhwaXJhdGlvbl90aW1lID0gKG5ldyBEYXRlKG5vdy52YWx1ZU9mKCkgKyB0dGxNcykpLnZhbHVlT2YoKTtcbiAgICB9XG5cbiAgICBjb25zdCBwdXNoVGltZSA9IFB1c2hDb250cm9sbGVyLmdldFB1c2hUaW1lKGJvZHkpO1xuICAgIGlmIChwdXNoVGltZSAmJiBwdXNoVGltZS5kYXRlICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgYm9keVsncHVzaF90aW1lJ10gPSBQdXNoQ29udHJvbGxlci5mb3JtYXRQdXNoVGltZShwdXNoVGltZSk7XG4gICAgfVxuXG4gICAgLy8gVE9ETzogSWYgdGhlIHJlcSBjYW4gcGFzcyB0aGUgY2hlY2tpbmcsIHdlIHJldHVybiBpbW1lZGlhdGVseSBpbnN0ZWFkIG9mIHdhaXRpbmdcbiAgICAvLyBwdXNoZXMgdG8gYmUgc2VudC4gV2UgcHJvYmFibHkgY2hhbmdlIHRoaXMgYmVoYXZpb3VyIGluIHRoZSBmdXR1cmUuXG4gICAgbGV0IGJhZGdlVXBkYXRlID0gKCkgPT4ge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cblxuICAgIGlmIChib2R5LmRhdGEgJiYgYm9keS5kYXRhLmJhZGdlKSB7XG4gICAgICBjb25zdCBiYWRnZSA9IGJvZHkuZGF0YS5iYWRnZTtcbiAgICAgIGxldCByZXN0VXBkYXRlID0ge307XG4gICAgICBpZiAodHlwZW9mIGJhZGdlID09ICdzdHJpbmcnICYmIGJhZGdlLnRvTG93ZXJDYXNlKCkgPT09ICdpbmNyZW1lbnQnKSB7XG4gICAgICAgIHJlc3RVcGRhdGUgPSB7IGJhZGdlOiB7IF9fb3A6ICdJbmNyZW1lbnQnLCBhbW91bnQ6IDEgfSB9XG4gICAgICB9IGVsc2UgaWYgKHR5cGVvZiBiYWRnZSA9PSAnb2JqZWN0JyAmJiB0eXBlb2YgYmFkZ2UuX19vcCA9PSAnc3RyaW5nJyAmJlxuICAgICAgICAgICAgICAgICBiYWRnZS5fX29wLnRvTG93ZXJDYXNlKCkgPT0gJ2luY3JlbWVudCcgJiYgTnVtYmVyKGJhZGdlLmFtb3VudCkpIHtcbiAgICAgICAgcmVzdFVwZGF0ZSA9IHsgYmFkZ2U6IHsgX19vcDogJ0luY3JlbWVudCcsIGFtb3VudDogYmFkZ2UuYW1vdW50IH0gfVxuICAgICAgfSBlbHNlIGlmIChOdW1iZXIoYmFkZ2UpKSB7XG4gICAgICAgIHJlc3RVcGRhdGUgPSB7IGJhZGdlOiBiYWRnZSB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBcIkludmFsaWQgdmFsdWUgZm9yIGJhZGdlLCBleHBlY3RlZCBudW1iZXIgb3IgJ0luY3JlbWVudCcgb3Ige2luY3JlbWVudDogbnVtYmVyfVwiO1xuICAgICAgfVxuXG4gICAgICAvLyBGb3JjZSBmaWx0ZXJpbmcgb24gb25seSB2YWxpZCBkZXZpY2UgdG9rZW5zXG4gICAgICBjb25zdCB1cGRhdGVXaGVyZSA9IGFwcGx5RGV2aWNlVG9rZW5FeGlzdHMod2hlcmUpO1xuICAgICAgYmFkZ2VVcGRhdGUgPSAoKSA9PiB7XG4gICAgICAgIC8vIEJ1aWxkIGEgcmVhbCBSZXN0UXVlcnkgc28gd2UgY2FuIHVzZSBpdCBpbiBSZXN0V3JpdGVcbiAgICAgICAgY29uc3QgcmVzdFF1ZXJ5ID0gbmV3IFJlc3RRdWVyeShjb25maWcsIG1hc3Rlcihjb25maWcpLCAnX0luc3RhbGxhdGlvbicsIHVwZGF0ZVdoZXJlKTtcbiAgICAgICAgLy8gY2hhbmdlICRleGlzdHMgZm9yICRuZSBudWxsIGZvciBiZXR0ZXIgcGVyZm9ybWFuY2VcbiAgICAgICAgaWYgKHJlc3RRdWVyeS5yZXN0V2hlcmUgJiYgcmVzdFF1ZXJ5LnJlc3RXaGVyZS5kZXZpY2VUb2tlbiAmJiByZXN0UXVlcnkucmVzdFdoZXJlLmRldmljZVRva2VuWyckZXhpc3RzJ10pIHJlc3RRdWVyeS5yZXN0V2hlcmUuZGV2aWNlVG9rZW4gPSB7JG5lOiBudWxsfVxuICAgICAgICByZXR1cm4gcmVzdFF1ZXJ5LmJ1aWxkUmVzdFdoZXJlKCkudGhlbigoKSA9PiB7XG4gICAgICAgICAgY29uc3Qgd3JpdGUgPSBuZXcgUmVzdFdyaXRlKGNvbmZpZywgbWFzdGVyKGNvbmZpZyksICdfSW5zdGFsbGF0aW9uJywgcmVzdFF1ZXJ5LnJlc3RXaGVyZSwgcmVzdFVwZGF0ZSk7XG4gICAgICAgICAgd3JpdGUucnVuT3B0aW9ucy5tYW55ID0gdHJ1ZTtcbiAgICAgICAgICByZXR1cm4gd3JpdGUuZXhlY3V0ZSgpO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgcHVzaFN0YXR1cyA9IHB1c2hTdGF0dXNIYW5kbGVyKGNvbmZpZyk7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHB1c2hTdGF0dXMuc2V0SW5pdGlhbChib2R5LCB3aGVyZSk7XG4gICAgfSkudGhlbigoKSA9PiB7XG4gICAgICBvblB1c2hTdGF0dXNTYXZlZChwdXNoU3RhdHVzLm9iamVjdElkKTtcbiAgICAgIGlmIChjb25maWcuc3RvcE9uQmFkZ2VVcGRhdGVFcnJvcikgcmV0dXJuIGJhZGdlVXBkYXRlKCk7XG4gICAgICBsb2dnZXIuaW5mbyhgQmFkZ2UgdXBkYXRlIGVycm9yIHdpbGwgYmUgaWdub3JlZCBmb3IgcHVzaCBzdGF0dXMgJHtwdXNoU3RhdHVzLm9iamVjdElkfWApO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH0pLnRoZW4oKCkgPT4ge1xuICAgICAgLy8gVXBkYXRlIGF1ZGllbmNlIGxhc3RVc2VkIGFuZCB0aW1lc1VzZWRcbiAgICAgIGlmIChib2R5LmF1ZGllbmNlX2lkKSB7XG4gICAgICAgIGNvbnN0IGF1ZGllbmNlSWQgPSBib2R5LmF1ZGllbmNlX2lkO1xuXG4gICAgICAgIHZhciB1cGRhdGVBdWRpZW5jZSA9IHtcbiAgICAgICAgICBsYXN0VXNlZDogeyBfX3R5cGU6IFwiRGF0ZVwiLCBpc286IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSB9LFxuICAgICAgICAgIHRpbWVzVXNlZDogeyBfX29wOiBcIkluY3JlbWVudFwiLCBcImFtb3VudFwiOiAxIH1cbiAgICAgICAgfTtcbiAgICAgICAgY29uc3Qgd3JpdGUgPSBuZXcgUmVzdFdyaXRlKGNvbmZpZywgbWFzdGVyKGNvbmZpZyksICdfQXVkaWVuY2UnLCB7b2JqZWN0SWQ6IGF1ZGllbmNlSWR9LCB1cGRhdGVBdWRpZW5jZSk7XG4gICAgICAgIHdyaXRlLmV4ZWN1dGUoKTtcbiAgICAgIH1cbiAgICAgIC8vIERvbid0IHdhaXQgZm9yIHRoZSBhdWRpZW5jZSB1cGRhdGUgcHJvbWlzZSB0byByZXNvbHZlLlxuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH0pLnRoZW4oKCkgPT4ge1xuICAgICAgaWYgKGJvZHkuaGFzT3duUHJvcGVydHkoJ3B1c2hfdGltZScpICYmIGNvbmZpZy5oYXNQdXNoU2NoZWR1bGVkU3VwcG9ydCkge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gY29uZmlnLnB1c2hDb250cm9sbGVyUXVldWUuZW5xdWV1ZShib2R5LCB3aGVyZSwgY29uZmlnLCBhdXRoLCBwdXNoU3RhdHVzKTtcbiAgICB9KS5jYXRjaCgoZXJyKSA9PiB7XG4gICAgICByZXR1cm4gcHVzaFN0YXR1cy5mYWlsKGVycikudGhlbigoKSA9PiB7XG4gICAgICAgIHRocm93IGVycjtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBleHBpcmF0aW9uIHRpbWUgZnJvbSB0aGUgcmVxdWVzdCBib2R5LlxuICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCBBIHJlcXVlc3Qgb2JqZWN0XG4gICAqIEByZXR1cm5zIHtOdW1iZXJ8dW5kZWZpbmVkfSBUaGUgZXhwaXJhdGlvbiB0aW1lIGlmIGl0IGV4aXN0cyBpbiB0aGUgcmVxdWVzdFxuICAgKi9cbiAgc3RhdGljIGdldEV4cGlyYXRpb25UaW1lKGJvZHkgPSB7fSkge1xuICAgIHZhciBoYXNFeHBpcmF0aW9uVGltZSA9IGJvZHkuaGFzT3duUHJvcGVydHkoJ2V4cGlyYXRpb25fdGltZScpO1xuICAgIGlmICghaGFzRXhwaXJhdGlvblRpbWUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIGV4cGlyYXRpb25UaW1lUGFyYW0gPSBib2R5WydleHBpcmF0aW9uX3RpbWUnXTtcbiAgICB2YXIgZXhwaXJhdGlvblRpbWU7XG4gICAgaWYgKHR5cGVvZiBleHBpcmF0aW9uVGltZVBhcmFtID09PSAnbnVtYmVyJykge1xuICAgICAgZXhwaXJhdGlvblRpbWUgPSBuZXcgRGF0ZShleHBpcmF0aW9uVGltZVBhcmFtICogMTAwMCk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZXhwaXJhdGlvblRpbWVQYXJhbSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIGV4cGlyYXRpb25UaW1lID0gbmV3IERhdGUoZXhwaXJhdGlvblRpbWVQYXJhbSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgIGJvZHlbJ2V4cGlyYXRpb25fdGltZSddICsgJyBpcyBub3QgdmFsaWQgdGltZS4nKTtcbiAgICB9XG4gICAgLy8gQ2hlY2sgZXhwaXJhdGlvblRpbWUgaXMgdmFsaWQgb3Igbm90LCBpZiBpdCBpcyBub3QgdmFsaWQsIGV4cGlyYXRpb25UaW1lIGlzIE5hTlxuICAgIGlmICghaXNGaW5pdGUoZXhwaXJhdGlvblRpbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuUFVTSF9NSVNDT05GSUdVUkVELFxuICAgICAgICBib2R5WydleHBpcmF0aW9uX3RpbWUnXSArICcgaXMgbm90IHZhbGlkIHRpbWUuJyk7XG4gICAgfVxuICAgIHJldHVybiBleHBpcmF0aW9uVGltZS52YWx1ZU9mKCk7XG4gIH1cblxuICBzdGF0aWMgZ2V0RXhwaXJhdGlvbkludGVydmFsKGJvZHkgPSB7fSkge1xuICAgIGNvbnN0IGhhc0V4cGlyYXRpb25JbnRlcnZhbCA9IGJvZHkuaGFzT3duUHJvcGVydHkoJ2V4cGlyYXRpb25faW50ZXJ2YWwnKTtcbiAgICBpZiAoIWhhc0V4cGlyYXRpb25JbnRlcnZhbCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBleHBpcmF0aW9uSW50ZXJ2YWxQYXJhbSA9IGJvZHlbJ2V4cGlyYXRpb25faW50ZXJ2YWwnXTtcbiAgICBpZiAodHlwZW9mIGV4cGlyYXRpb25JbnRlcnZhbFBhcmFtICE9PSAnbnVtYmVyJyB8fCBleHBpcmF0aW9uSW50ZXJ2YWxQYXJhbSA8PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuUFVTSF9NSVNDT05GSUdVUkVELFxuICAgICAgICBgZXhwaXJhdGlvbl9pbnRlcnZhbCBtdXN0IGJlIGEgbnVtYmVyIGdyZWF0ZXIgdGhhbiAwYCk7XG4gICAgfVxuICAgIHJldHVybiBleHBpcmF0aW9uSW50ZXJ2YWxQYXJhbTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgcHVzaCB0aW1lIGZyb20gdGhlIHJlcXVlc3QgYm9keS5cbiAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgQSByZXF1ZXN0IG9iamVjdFxuICAgKiBAcmV0dXJucyB7TnVtYmVyfHVuZGVmaW5lZH0gVGhlIHB1c2ggdGltZSBpZiBpdCBleGlzdHMgaW4gdGhlIHJlcXVlc3RcbiAgICovXG4gIHN0YXRpYyBnZXRQdXNoVGltZShib2R5ID0ge30pIHtcbiAgICB2YXIgaGFzUHVzaFRpbWUgPSBib2R5Lmhhc093blByb3BlcnR5KCdwdXNoX3RpbWUnKTtcbiAgICBpZiAoIWhhc1B1c2hUaW1lKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciBwdXNoVGltZVBhcmFtID0gYm9keVsncHVzaF90aW1lJ107XG4gICAgdmFyIGRhdGU7XG4gICAgdmFyIGlzTG9jYWxUaW1lID0gdHJ1ZTtcblxuICAgIGlmICh0eXBlb2YgcHVzaFRpbWVQYXJhbSA9PT0gJ251bWJlcicpIHtcbiAgICAgIGRhdGUgPSBuZXcgRGF0ZShwdXNoVGltZVBhcmFtICogMTAwMCk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgcHVzaFRpbWVQYXJhbSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIGlzTG9jYWxUaW1lID0gIVB1c2hDb250cm9sbGVyLnB1c2hUaW1lSGFzVGltZXpvbmVDb21wb25lbnQocHVzaFRpbWVQYXJhbSk7XG4gICAgICBkYXRlID0gbmV3IERhdGUocHVzaFRpbWVQYXJhbSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgIGJvZHlbJ3B1c2hfdGltZSddICsgJyBpcyBub3QgdmFsaWQgdGltZS4nKTtcbiAgICB9XG4gICAgLy8gQ2hlY2sgcHVzaFRpbWUgaXMgdmFsaWQgb3Igbm90LCBpZiBpdCBpcyBub3QgdmFsaWQsIHB1c2hUaW1lIGlzIE5hTlxuICAgIGlmICghaXNGaW5pdGUoZGF0ZSkpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgIGJvZHlbJ3B1c2hfdGltZSddICsgJyBpcyBub3QgdmFsaWQgdGltZS4nKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgZGF0ZSxcbiAgICAgIGlzTG9jYWxUaW1lLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIGlmIGEgSVNPODYwMSBmb3JtYXR0ZWQgZGF0ZSBjb250YWlucyBhIHRpbWV6b25lIGNvbXBvbmVudFxuICAgKiBAcGFyYW0gcHVzaFRpbWVQYXJhbSB7c3RyaW5nfVxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn1cbiAgICovXG4gIHN0YXRpYyBwdXNoVGltZUhhc1RpbWV6b25lQ29tcG9uZW50KHB1c2hUaW1lUGFyYW06IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IG9mZnNldFBhdHRlcm4gPSAvKC4rKShbKy1dKVxcZFxcZDpcXGRcXGQkLztcbiAgICByZXR1cm4gcHVzaFRpbWVQYXJhbS5pbmRleE9mKCdaJykgPT09IHB1c2hUaW1lUGFyYW0ubGVuZ3RoIC0gMSAvLyAyMDA3LTA0LTA1VDEyOjMwWlxuICAgICAgfHwgb2Zmc2V0UGF0dGVybi50ZXN0KHB1c2hUaW1lUGFyYW0pOyAvLyAyMDA3LTA0LTA1VDEyOjMwLjAwMCswMjowMCwgMjAwNy0wNC0wNVQxMjozMC4wMDAtMDI6MDBcbiAgfVxuXG4gIC8qKlxuICAgKiBDb252ZXJ0cyBhIGRhdGUgdG8gSVNPIGZvcm1hdCBpbiBVVEMgdGltZSBhbmQgc3RyaXBzIHRoZSB0aW1lem9uZSBpZiBgaXNMb2NhbFRpbWVgIGlzIHRydWVcbiAgICogQHBhcmFtIGRhdGUge0RhdGV9XG4gICAqIEBwYXJhbSBpc0xvY2FsVGltZSB7Ym9vbGVhbn1cbiAgICogQHJldHVybnMge3N0cmluZ31cbiAgICovXG4gIHN0YXRpYyBmb3JtYXRQdXNoVGltZSh7IGRhdGUsIGlzTG9jYWxUaW1lIH06IHsgZGF0ZTogRGF0ZSwgaXNMb2NhbFRpbWU6IGJvb2xlYW4gfSkge1xuICAgIGlmIChpc0xvY2FsVGltZSkgeyAvLyBTdHJpcCAnWidcbiAgICAgIGNvbnN0IGlzb1N0cmluZyA9IGRhdGUudG9JU09TdHJpbmcoKTtcbiAgICAgIHJldHVybiBpc29TdHJpbmcuc3Vic3RyaW5nKDAsIGlzb1N0cmluZy5pbmRleE9mKCdaJykpO1xuICAgIH1cbiAgICByZXR1cm4gZGF0ZS50b0lTT1N0cmluZygpO1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IFB1c2hDb250cm9sbGVyO1xuIl19