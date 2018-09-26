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
      const promise = badgeUpdate();
      // add this to ignore badge update errors as default
      if (!config.stopOnBadgeUpdateError) {
        promise.catch(err => {
          _logger.logger.info(`Badge update error will be ignored for push status ${pushStatus.objectId}`);
          _logger.logger.error(err);
        });
      }
      return promise;
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9QdXNoQ29udHJvbGxlci5qcyJdLCJuYW1lcyI6WyJQdXNoQ29udHJvbGxlciIsInNlbmRQdXNoIiwiYm9keSIsIndoZXJlIiwiY29uZmlnIiwiYXV0aCIsIm9uUHVzaFN0YXR1c1NhdmVkIiwibm93IiwiRGF0ZSIsImhhc1B1c2hTdXBwb3J0IiwiUGFyc2UiLCJFcnJvciIsIlBVU0hfTUlTQ09ORklHVVJFRCIsImV4cGlyYXRpb25fdGltZSIsImdldEV4cGlyYXRpb25UaW1lIiwiZXhwaXJhdGlvbl9pbnRlcnZhbCIsImdldEV4cGlyYXRpb25JbnRlcnZhbCIsImhhc093blByb3BlcnR5IiwidHRsTXMiLCJ2YWx1ZU9mIiwicHVzaFRpbWUiLCJnZXRQdXNoVGltZSIsImRhdGUiLCJmb3JtYXRQdXNoVGltZSIsImJhZGdlVXBkYXRlIiwiUHJvbWlzZSIsInJlc29sdmUiLCJkYXRhIiwiYmFkZ2UiLCJyZXN0VXBkYXRlIiwidG9Mb3dlckNhc2UiLCJfX29wIiwiYW1vdW50IiwiTnVtYmVyIiwidXBkYXRlV2hlcmUiLCJyZXN0UXVlcnkiLCJSZXN0UXVlcnkiLCJyZXN0V2hlcmUiLCJkZXZpY2VUb2tlbiIsIiRuZSIsImJ1aWxkUmVzdFdoZXJlIiwidGhlbiIsIndyaXRlIiwiUmVzdFdyaXRlIiwicnVuT3B0aW9ucyIsIm1hbnkiLCJleGVjdXRlIiwicHVzaFN0YXR1cyIsInNldEluaXRpYWwiLCJvYmplY3RJZCIsInByb21pc2UiLCJzdG9wT25CYWRnZVVwZGF0ZUVycm9yIiwiY2F0Y2giLCJlcnIiLCJsb2dnZXIiLCJpbmZvIiwiZXJyb3IiLCJhdWRpZW5jZV9pZCIsImF1ZGllbmNlSWQiLCJ1cGRhdGVBdWRpZW5jZSIsImxhc3RVc2VkIiwiX190eXBlIiwiaXNvIiwidG9JU09TdHJpbmciLCJ0aW1lc1VzZWQiLCJoYXNQdXNoU2NoZWR1bGVkU3VwcG9ydCIsInB1c2hDb250cm9sbGVyUXVldWUiLCJlbnF1ZXVlIiwiZmFpbCIsImhhc0V4cGlyYXRpb25UaW1lIiwiZXhwaXJhdGlvblRpbWVQYXJhbSIsImV4cGlyYXRpb25UaW1lIiwiaXNGaW5pdGUiLCJoYXNFeHBpcmF0aW9uSW50ZXJ2YWwiLCJleHBpcmF0aW9uSW50ZXJ2YWxQYXJhbSIsImhhc1B1c2hUaW1lIiwicHVzaFRpbWVQYXJhbSIsImlzTG9jYWxUaW1lIiwicHVzaFRpbWVIYXNUaW1lem9uZUNvbXBvbmVudCIsIm9mZnNldFBhdHRlcm4iLCJpbmRleE9mIiwibGVuZ3RoIiwidGVzdCIsImlzb1N0cmluZyIsInN1YnN0cmluZyJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUFBOztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7OztBQUVPLE1BQU1BLGNBQU4sQ0FBcUI7O0FBRTFCQyxXQUFTQyxPQUFPLEVBQWhCLEVBQW9CQyxRQUFRLEVBQTVCLEVBQWdDQyxNQUFoQyxFQUF3Q0MsSUFBeEMsRUFBOENDLG9CQUFvQixNQUFNLENBQUUsQ0FBMUUsRUFBNEVDLE1BQU0sSUFBSUMsSUFBSixFQUFsRixFQUE4RjtBQUM1RixRQUFJLENBQUNKLE9BQU9LLGNBQVosRUFBNEI7QUFDMUIsWUFBTSxJQUFJQyxZQUFNQyxLQUFWLENBQWdCRCxZQUFNQyxLQUFOLENBQVlDLGtCQUE1QixFQUNKLDRCQURJLENBQU47QUFFRDs7QUFFRDtBQUNBVixTQUFLVyxlQUFMLEdBQXVCYixlQUFlYyxpQkFBZixDQUFpQ1osSUFBakMsQ0FBdkI7QUFDQUEsU0FBS2EsbUJBQUwsR0FBMkJmLGVBQWVnQixxQkFBZixDQUFxQ2QsSUFBckMsQ0FBM0I7QUFDQSxRQUFJQSxLQUFLVyxlQUFMLElBQXdCWCxLQUFLYSxtQkFBakMsRUFBc0Q7QUFDcEQsWUFBTSxJQUFJTCxZQUFNQyxLQUFWLENBQ0pELFlBQU1DLEtBQU4sQ0FBWUMsa0JBRFIsRUFFSiw0REFGSSxDQUFOO0FBR0Q7O0FBRUQ7QUFDQSxRQUFJVixLQUFLYSxtQkFBTCxJQUE0QixDQUFDYixLQUFLZSxjQUFM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SlYsS0FBSyxXQUFMLElBQW9CLHFCQURoQixDQUFOO0FBRUQ7O0FBRUQsV0FBTztBQUNMb0IsVUFESztBQUVMdUQ7QUFGSyxLQUFQO0FBSUQ7O0FBRUQ7Ozs7O0FBS0EsU0FBT0MsNEJBQVAsQ0FBb0NGLGFBQXBDLEVBQW9FO0FBQ2xFLFVBQU1HLGdCQUFnQixzQkFBdEI7QUFDQSxXQUFPSCxjQUFjSSxPQUFkLENBQXNCLEdBQXRCLE1BQStCSixjQUFjSyxNQUFkLEdBQXVCLENBQXRELENBQXdEO0FBQXhELE9BQ0ZGLGNBQWNHLElBQWQsQ0FBbUJOLGFBQW5CLENBREwsQ0FGa0UsQ0FHMUI7QUFDekM7O0FBRUQ7Ozs7OztBQU1BLFNBQU9yRCxjQUFQLENBQXNCLEVBQUVELElBQUYsRUFBUXVELFdBQVIsRUFBdEIsRUFBbUY7QUFDakYsUUFBSUEsV0FBSixFQUFpQjtBQUFFO0FBQ2pCLFlBQU1NLFlBQVk3RCxLQUFLeUMsV0FBTCxFQUFsQjtBQUNBLGFBQU9vQixVQUFVQyxTQUFWLENBQW9CLENBQXBCLEVBQXVCRCxVQUFVSCxPQUFWLENBQWtCLEdBQWxCLENBQXZCLENBQVA7QUFDRDtBQUNELFdBQU8xRCxLQUFLeUMsV0FBTCxFQUFQO0FBQ0Q7QUExTXlCOztRQUFmL0QsYyxHQUFBQSxjO2tCQTZNRUEsYyIsImZpbGUiOiJQdXNoQ29udHJvbGxlci5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFBhcnNlIH0gICAgICAgICAgICAgIGZyb20gJ3BhcnNlL25vZGUnO1xuaW1wb3J0IFJlc3RRdWVyeSAgICAgICAgICAgICAgZnJvbSAnLi4vUmVzdFF1ZXJ5JztcbmltcG9ydCBSZXN0V3JpdGUgICAgICAgICAgICAgIGZyb20gJy4uL1Jlc3RXcml0ZSc7XG5pbXBvcnQgeyBtYXN0ZXIgfSAgICAgICAgICAgICBmcm9tICcuLi9BdXRoJztcbmltcG9ydCB7IHB1c2hTdGF0dXNIYW5kbGVyIH0gIGZyb20gJy4uL1N0YXR1c0hhbmRsZXInO1xuaW1wb3J0IHsgYXBwbHlEZXZpY2VUb2tlbkV4aXN0cyB9IGZyb20gJy4uL1B1c2gvdXRpbHMnO1xuaW1wb3J0IHsgbG9nZ2VyIH0gICAgICAgICAgICAgICBmcm9tICcuLi9sb2dnZXInO1xuXG5leHBvcnQgY2xhc3MgUHVzaENvbnRyb2xsZXIge1xuXG4gIHNlbmRQdXNoKGJvZHkgPSB7fSwgd2hlcmUgPSB7fSwgY29uZmlnLCBhdXRoLCBvblB1c2hTdGF0dXNTYXZlZCA9ICgpID0+IHt9LCBub3cgPSBuZXcgRGF0ZSgpKSB7XG4gICAgaWYgKCFjb25maWcuaGFzUHVzaFN1cHBvcnQpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgICdNaXNzaW5nIHB1c2ggY29uZmlndXJhdGlvbicpO1xuICAgIH1cblxuICAgIC8vIFJlcGxhY2UgdGhlIGV4cGlyYXRpb25fdGltZSBhbmQgcHVzaF90aW1lIHdpdGggYSB2YWxpZCBVbml4IGVwb2NoIG1pbGxpc2Vjb25kcyB0aW1lXG4gICAgYm9keS5leHBpcmF0aW9uX3RpbWUgPSBQdXNoQ29udHJvbGxlci5nZXRFeHBpcmF0aW9uVGltZShib2R5KTtcbiAgICBib2R5LmV4cGlyYXRpb25faW50ZXJ2YWwgPSBQdXNoQ29udHJvbGxlci5nZXRFeHBpcmF0aW9uSW50ZXJ2YWwoYm9keSk7XG4gICAgaWYgKGJvZHkuZXhwaXJhdGlvbl90aW1lICYmIGJvZHkuZXhwaXJhdGlvbl9pbnRlcnZhbCkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgICdCb3RoIGV4cGlyYXRpb25fdGltZSBhbmQgZXhwaXJhdGlvbl9pbnRlcnZhbCBjYW5ub3QgYmUgc2V0Jyk7XG4gICAgfVxuXG4gICAgLy8gSW1tZWRpYXRlIHB1c2hcbiAgICBpZiAoYm9keS5leHBpcmF0aW9uX2ludGVydmFsICYmICFib2R5Lmhhc093blByb3BlcnR5KCdwdXNoX3RpbWUnKSkge1xuICAgICAgY29uc3QgdHRsTXMgPSBib2R5LmV4cGlyYXRpb25faW50ZXJ2YWwgKiAxMDAwO1xuICAgICAgYm9keS5leHBpcmF0aW9uX3RpbWUgPSAobmV3IERhdGUobm93LnZhbHVlT2YoKSArIHR0bE1zKSkudmFsdWVPZigpO1xuICAgIH1cblxuICAgIGNvbnN0IHB1c2hUaW1lID0gUHVzaENvbnRyb2xsZXIuZ2V0UHVzaFRpbWUoYm9keSk7XG4gICAgaWYgKHB1c2hUaW1lICYmIHB1c2hUaW1lLmRhdGUgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBib2R5WydwdXNoX3RpbWUnXSA9IFB1c2hDb250cm9sbGVyLmZvcm1hdFB1c2hUaW1lKHB1c2hUaW1lKTtcbiAgICB9XG5cbiAgICAvLyBUT0RPOiBJZiB0aGUgcmVxIGNhbiBwYXNzIHRoZSBjaGVja2luZywgd2UgcmV0dXJuIGltbWVkaWF0ZWx5IGluc3RlYWQgb2Ygd2FpdGluZ1xuICAgIC8vIHB1c2hlcyB0byBiZSBzZW50LiBXZSBwcm9iYWJseSBjaGFuZ2UgdGhpcyBiZWhhdmlvdXIgaW4gdGhlIGZ1dHVyZS5cbiAgICBsZXQgYmFkZ2VVcGRhdGUgPSAoKSA9PiB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuXG4gICAgaWYgKGJvZHkuZGF0YSAmJiBib2R5LmRhdGEuYmFkZ2UpIHtcbiAgICAgIGNvbnN0IGJhZGdlID0gYm9keS5kYXRhLmJhZGdlO1xuICAgICAgbGV0IHJlc3RVcGRhdGUgPSB7fTtcbiAgICAgIGlmICh0eXBlb2YgYmFkZ2UgPT0gJ3N0cmluZycgJiYgYmFkZ2UudG9Mb3dlckNhc2UoKSA9PT0gJ2luY3JlbWVudCcpIHtcbiAgICAgICAgcmVzdFVwZGF0ZSA9IHsgYmFkZ2U6IHsgX19vcDogJ0luY3JlbWVudCcsIGFtb3VudDogMSB9IH1cbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGJhZGdlID09ICdvYmplY3QnICYmIHR5cGVvZiBiYWRnZS5fX29wID09ICdzdHJpbmcnICYmXG4gICAgICAgICAgICAgICAgIGJhZGdlLl9fb3AudG9Mb3dlckNhc2UoKSA9PSAnaW5jcmVtZW50JyAmJiBOdW1iZXIoYmFkZ2UuYW1vdW50KSkge1xuICAgICAgICByZXN0VXBkYXRlID0geyBiYWRnZTogeyBfX29wOiAnSW5jcmVtZW50JywgYW1vdW50OiBiYWRnZS5hbW91bnQgfSB9XG4gICAgICB9IGVsc2UgaWYgKE51bWJlcihiYWRnZSkpIHtcbiAgICAgICAgcmVzdFVwZGF0ZSA9IHsgYmFkZ2U6IGJhZGdlIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IFwiSW52YWxpZCB2YWx1ZSBmb3IgYmFkZ2UsIGV4cGVjdGVkIG51bWJlciBvciAnSW5jcmVtZW50JyBvciB7aW5jcmVtZW50OiBudW1iZXJ9XCI7XG4gICAgICB9XG5cbiAgICAgIC8vIEZvcmNlIGZpbHRlcmluZyBvbiBvbmx5IHZhbGlkIGRldmljZSB0b2tlbnNcbiAgICAgIGNvbnN0IHVwZGF0ZVdoZXJlID0gYXBwbHlEZXZpY2VUb2tlbkV4aXN0cyh3aGVyZSk7XG4gICAgICBiYWRnZVVwZGF0ZSA9ICgpID0+IHtcbiAgICAgICAgLy8gQnVpbGQgYSByZWFsIFJlc3RRdWVyeSBzbyB3ZSBjYW4gdXNlIGl0IGluIFJlc3RXcml0ZVxuICAgICAgICBjb25zdCByZXN0UXVlcnkgPSBuZXcgUmVzdFF1ZXJ5KGNvbmZpZywgbWFzdGVyKGNvbmZpZyksICdfSW5zdGFsbGF0aW9uJywgdXBkYXRlV2hlcmUpO1xuICAgICAgICAvLyBjaGFuZ2UgJGV4aXN0cyBmb3IgJG5lIG51bGwgZm9yIGJldHRlciBwZXJmb3JtYW5jZVxuICAgICAgICBpZiAocmVzdFF1ZXJ5LnJlc3RXaGVyZSAmJiByZXN0UXVlcnkucmVzdFdoZXJlLmRldmljZVRva2VuICYmIHJlc3RRdWVyeS5yZXN0V2hlcmUuZGV2aWNlVG9rZW5bJyRleGlzdHMnXSkgcmVzdFF1ZXJ5LnJlc3RXaGVyZS5kZXZpY2VUb2tlbiA9IHskbmU6IG51bGx9XG4gICAgICAgIHJldHVybiByZXN0UXVlcnkuYnVpbGRSZXN0V2hlcmUoKS50aGVuKCgpID0+IHtcbiAgICAgICAgICBjb25zdCB3cml0ZSA9IG5ldyBSZXN0V3JpdGUoY29uZmlnLCBtYXN0ZXIoY29uZmlnKSwgJ19JbnN0YWxsYXRpb24nLCByZXN0UXVlcnkucmVzdFdoZXJlLCByZXN0VXBkYXRlKTtcbiAgICAgICAgICB3cml0ZS5ydW5PcHRpb25zLm1hbnkgPSB0cnVlO1xuICAgICAgICAgIHJldHVybiB3cml0ZS5leGVjdXRlKCk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBwdXNoU3RhdHVzID0gcHVzaFN0YXR1c0hhbmRsZXIoY29uZmlnKTtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gcHVzaFN0YXR1cy5zZXRJbml0aWFsKGJvZHksIHdoZXJlKTtcbiAgICB9KS50aGVuKCgpID0+IHtcbiAgICAgIG9uUHVzaFN0YXR1c1NhdmVkKHB1c2hTdGF0dXMub2JqZWN0SWQpO1xuICAgICAgY29uc3QgcHJvbWlzZSA9IGJhZGdlVXBkYXRlKCk7XG4gICAgICAvLyBhZGQgdGhpcyB0byBpZ25vcmUgYmFkZ2UgdXBkYXRlIGVycm9ycyBhcyBkZWZhdWx0XG4gICAgICBpZiAoIWNvbmZpZy5zdG9wT25CYWRnZVVwZGF0ZUVycm9yKSB7XG4gICAgICAgIHByb21pc2UuY2F0Y2goZXJyID0+IHtcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgQmFkZ2UgdXBkYXRlIGVycm9yIHdpbGwgYmUgaWdub3JlZCBmb3IgcHVzaCBzdGF0dXMgJHtwdXNoU3RhdHVzLm9iamVjdElkfWApXG4gICAgICAgICAgbG9nZ2VyLmVycm9yKGVycilcbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICAgIHJldHVybiBwcm9taXNlXG4gICAgfSkudGhlbigoKSA9PiB7XG4gICAgICAvLyBVcGRhdGUgYXVkaWVuY2UgbGFzdFVzZWQgYW5kIHRpbWVzVXNlZFxuICAgICAgaWYgKGJvZHkuYXVkaWVuY2VfaWQpIHtcbiAgICAgICAgY29uc3QgYXVkaWVuY2VJZCA9IGJvZHkuYXVkaWVuY2VfaWQ7XG5cbiAgICAgICAgdmFyIHVwZGF0ZUF1ZGllbmNlID0ge1xuICAgICAgICAgIGxhc3RVc2VkOiB7IF9fdHlwZTogXCJEYXRlXCIsIGlzbzogbmV3IERhdGUoKS50b0lTT1N0cmluZygpIH0sXG4gICAgICAgICAgdGltZXNVc2VkOiB7IF9fb3A6IFwiSW5jcmVtZW50XCIsIFwiYW1vdW50XCI6IDEgfVxuICAgICAgICB9O1xuICAgICAgICBjb25zdCB3cml0ZSA9IG5ldyBSZXN0V3JpdGUoY29uZmlnLCBtYXN0ZXIoY29uZmlnKSwgJ19BdWRpZW5jZScsIHtvYmplY3RJZDogYXVkaWVuY2VJZH0sIHVwZGF0ZUF1ZGllbmNlKTtcbiAgICAgICAgd3JpdGUuZXhlY3V0ZSgpO1xuICAgICAgfVxuICAgICAgLy8gRG9uJ3Qgd2FpdCBmb3IgdGhlIGF1ZGllbmNlIHVwZGF0ZSBwcm9taXNlIHRvIHJlc29sdmUuXG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfSkudGhlbigoKSA9PiB7XG4gICAgICBpZiAoYm9keS5oYXNPd25Qcm9wZXJ0eSgncHVzaF90aW1lJykgJiYgY29uZmlnLmhhc1B1c2hTY2hlZHVsZWRTdXBwb3J0KSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBjb25maWcucHVzaENvbnRyb2xsZXJRdWV1ZS5lbnF1ZXVlKGJvZHksIHdoZXJlLCBjb25maWcsIGF1dGgsIHB1c2hTdGF0dXMpO1xuICAgIH0pLmNhdGNoKChlcnIpID0+IHtcbiAgICAgIHJldHVybiBwdXNoU3RhdHVzLmZhaWwoZXJyKS50aGVuKCgpID0+IHtcbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGV4cGlyYXRpb24gdGltZSBmcm9tIHRoZSByZXF1ZXN0IGJvZHkuXG4gICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IEEgcmVxdWVzdCBvYmplY3RcbiAgICogQHJldHVybnMge051bWJlcnx1bmRlZmluZWR9IFRoZSBleHBpcmF0aW9uIHRpbWUgaWYgaXQgZXhpc3RzIGluIHRoZSByZXF1ZXN0XG4gICAqL1xuICBzdGF0aWMgZ2V0RXhwaXJhdGlvblRpbWUoYm9keSA9IHt9KSB7XG4gICAgdmFyIGhhc0V4cGlyYXRpb25UaW1lID0gYm9keS5oYXNPd25Qcm9wZXJ0eSgnZXhwaXJhdGlvbl90aW1lJyk7XG4gICAgaWYgKCFoYXNFeHBpcmF0aW9uVGltZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgZXhwaXJhdGlvblRpbWVQYXJhbSA9IGJvZHlbJ2V4cGlyYXRpb25fdGltZSddO1xuICAgIHZhciBleHBpcmF0aW9uVGltZTtcbiAgICBpZiAodHlwZW9mIGV4cGlyYXRpb25UaW1lUGFyYW0gPT09ICdudW1iZXInKSB7XG4gICAgICBleHBpcmF0aW9uVGltZSA9IG5ldyBEYXRlKGV4cGlyYXRpb25UaW1lUGFyYW0gKiAxMDAwKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBleHBpcmF0aW9uVGltZVBhcmFtID09PSAnc3RyaW5nJykge1xuICAgICAgZXhwaXJhdGlvblRpbWUgPSBuZXcgRGF0ZShleHBpcmF0aW9uVGltZVBhcmFtKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlBVU0hfTUlTQ09ORklHVVJFRCxcbiAgICAgICAgYm9keVsnZXhwaXJhdGlvbl90aW1lJ10gKyAnIGlzIG5vdCB2YWxpZCB0aW1lLicpO1xuICAgIH1cbiAgICAvLyBDaGVjayBleHBpcmF0aW9uVGltZSBpcyB2YWxpZCBvciBub3QsIGlmIGl0IGlzIG5vdCB2YWxpZCwgZXhwaXJhdGlvblRpbWUgaXMgTmFOXG4gICAgaWYgKCFpc0Zpbml0ZShleHBpcmF0aW9uVGltZSkpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgIGJvZHlbJ2V4cGlyYXRpb25fdGltZSddICsgJyBpcyBub3QgdmFsaWQgdGltZS4nKTtcbiAgICB9XG4gICAgcmV0dXJuIGV4cGlyYXRpb25UaW1lLnZhbHVlT2YoKTtcbiAgfVxuXG4gIHN0YXRpYyBnZXRFeHBpcmF0aW9uSW50ZXJ2YWwoYm9keSA9IHt9KSB7XG4gICAgY29uc3QgaGFzRXhwaXJhdGlvbkludGVydmFsID0gYm9keS5oYXNPd25Qcm9wZXJ0eSgnZXhwaXJhdGlvbl9pbnRlcnZhbCcpO1xuICAgIGlmICghaGFzRXhwaXJhdGlvbkludGVydmFsKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGV4cGlyYXRpb25JbnRlcnZhbFBhcmFtID0gYm9keVsnZXhwaXJhdGlvbl9pbnRlcnZhbCddO1xuICAgIGlmICh0eXBlb2YgZXhwaXJhdGlvbkludGVydmFsUGFyYW0gIT09ICdudW1iZXInIHx8IGV4cGlyYXRpb25JbnRlcnZhbFBhcmFtIDw9IDApIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgIGBleHBpcmF0aW9uX2ludGVydmFsIG11c3QgYmUgYSBudW1iZXIgZ3JlYXRlciB0aGFuIDBgKTtcbiAgICB9XG4gICAgcmV0dXJuIGV4cGlyYXRpb25JbnRlcnZhbFBhcmFtO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBwdXNoIHRpbWUgZnJvbSB0aGUgcmVxdWVzdCBib2R5LlxuICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCBBIHJlcXVlc3Qgb2JqZWN0XG4gICAqIEByZXR1cm5zIHtOdW1iZXJ8dW5kZWZpbmVkfSBUaGUgcHVzaCB0aW1lIGlmIGl0IGV4aXN0cyBpbiB0aGUgcmVxdWVzdFxuICAgKi9cbiAgc3RhdGljIGdldFB1c2hUaW1lKGJvZHkgPSB7fSkge1xuICAgIHZhciBoYXNQdXNoVGltZSA9IGJvZHkuaGFzT3duUHJvcGVydHkoJ3B1c2hfdGltZScpO1xuICAgIGlmICghaGFzUHVzaFRpbWUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIHB1c2hUaW1lUGFyYW0gPSBib2R5WydwdXNoX3RpbWUnXTtcbiAgICB2YXIgZGF0ZTtcbiAgICB2YXIgaXNMb2NhbFRpbWUgPSB0cnVlO1xuXG4gICAgaWYgKHR5cGVvZiBwdXNoVGltZVBhcmFtID09PSAnbnVtYmVyJykge1xuICAgICAgZGF0ZSA9IG5ldyBEYXRlKHB1c2hUaW1lUGFyYW0gKiAxMDAwKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBwdXNoVGltZVBhcmFtID09PSAnc3RyaW5nJykge1xuICAgICAgaXNMb2NhbFRpbWUgPSAhUHVzaENvbnRyb2xsZXIucHVzaFRpbWVIYXNUaW1lem9uZUNvbXBvbmVudChwdXNoVGltZVBhcmFtKTtcbiAgICAgIGRhdGUgPSBuZXcgRGF0ZShwdXNoVGltZVBhcmFtKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlBVU0hfTUlTQ09ORklHVVJFRCxcbiAgICAgICAgYm9keVsncHVzaF90aW1lJ10gKyAnIGlzIG5vdCB2YWxpZCB0aW1lLicpO1xuICAgIH1cbiAgICAvLyBDaGVjayBwdXNoVGltZSBpcyB2YWxpZCBvciBub3QsIGlmIGl0IGlzIG5vdCB2YWxpZCwgcHVzaFRpbWUgaXMgTmFOXG4gICAgaWYgKCFpc0Zpbml0ZShkYXRlKSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlBVU0hfTUlTQ09ORklHVVJFRCxcbiAgICAgICAgYm9keVsncHVzaF90aW1lJ10gKyAnIGlzIG5vdCB2YWxpZCB0aW1lLicpO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBkYXRlLFxuICAgICAgaXNMb2NhbFRpbWUsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3MgaWYgYSBJU084NjAxIGZvcm1hdHRlZCBkYXRlIGNvbnRhaW5zIGEgdGltZXpvbmUgY29tcG9uZW50XG4gICAqIEBwYXJhbSBwdXNoVGltZVBhcmFtIHtzdHJpbmd9XG4gICAqIEByZXR1cm5zIHtib29sZWFufVxuICAgKi9cbiAgc3RhdGljIHB1c2hUaW1lSGFzVGltZXpvbmVDb21wb25lbnQocHVzaFRpbWVQYXJhbTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgY29uc3Qgb2Zmc2V0UGF0dGVybiA9IC8oLispKFsrLV0pXFxkXFxkOlxcZFxcZCQvO1xuICAgIHJldHVybiBwdXNoVGltZVBhcmFtLmluZGV4T2YoJ1onKSA9PT0gcHVzaFRpbWVQYXJhbS5sZW5ndGggLSAxIC8vIDIwMDctMDQtMDVUMTI6MzBaXG4gICAgICB8fCBvZmZzZXRQYXR0ZXJuLnRlc3QocHVzaFRpbWVQYXJhbSk7IC8vIDIwMDctMDQtMDVUMTI6MzAuMDAwKzAyOjAwLCAyMDA3LTA0LTA1VDEyOjMwLjAwMC0wMjowMFxuICB9XG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIGEgZGF0ZSB0byBJU08gZm9ybWF0IGluIFVUQyB0aW1lIGFuZCBzdHJpcHMgdGhlIHRpbWV6b25lIGlmIGBpc0xvY2FsVGltZWAgaXMgdHJ1ZVxuICAgKiBAcGFyYW0gZGF0ZSB7RGF0ZX1cbiAgICogQHBhcmFtIGlzTG9jYWxUaW1lIHtib29sZWFufVxuICAgKiBAcmV0dXJucyB7c3RyaW5nfVxuICAgKi9cbiAgc3RhdGljIGZvcm1hdFB1c2hUaW1lKHsgZGF0ZSwgaXNMb2NhbFRpbWUgfTogeyBkYXRlOiBEYXRlLCBpc0xvY2FsVGltZTogYm9vbGVhbiB9KSB7XG4gICAgaWYgKGlzTG9jYWxUaW1lKSB7IC8vIFN0cmlwICdaJ1xuICAgICAgY29uc3QgaXNvU3RyaW5nID0gZGF0ZS50b0lTT1N0cmluZygpO1xuICAgICAgcmV0dXJuIGlzb1N0cmluZy5zdWJzdHJpbmcoMCwgaXNvU3RyaW5nLmluZGV4T2YoJ1onKSk7XG4gICAgfVxuICAgIHJldHVybiBkYXRlLnRvSVNPU3RyaW5nKCk7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgUHVzaENvbnRyb2xsZXI7XG4iXX0=