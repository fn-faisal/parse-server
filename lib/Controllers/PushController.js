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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9QdXNoQ29udHJvbGxlci5qcyJdLCJuYW1lcyI6WyJQdXNoQ29udHJvbGxlciIsInNlbmRQdXNoIiwiYm9keSIsIndoZXJlIiwiY29uZmlnIiwiYXV0aCIsIm9uUHVzaFN0YXR1c1NhdmVkIiwibm93IiwiRGF0ZSIsImhhc1B1c2hTdXBwb3J0IiwiUGFyc2UiLCJFcnJvciIsIlBVU0hfTUlTQ09ORklHVVJFRCIsImV4cGlyYXRpb25fdGltZSIsImdldEV4cGlyYXRpb25UaW1lIiwiZXhwaXJhdGlvbl9pbnRlcnZhbCIsImdldEV4cGlyYXRpb25JbnRlcnZhbCIsImhhc093blByb3BlcnR5IiwidHRsTXMiLCJ2YWx1ZU9mIiwicHVzaFRpbWUiLCJnZXRQdXNoVGltZSIsImRhdGUiLCJmb3JtYXRQdXNoVGltZSIsImJhZGdlVXBkYXRlIiwiUHJvbWlzZSIsInJlc29sdmUiLCJkYXRhIiwiYmFkZ2UiLCJyZXN0VXBkYXRlIiwidG9Mb3dlckNhc2UiLCJfX29wIiwiYW1vdW50IiwiTnVtYmVyIiwidXBkYXRlV2hlcmUiLCJyZXN0UXVlcnkiLCJSZXN0UXVlcnkiLCJidWlsZFJlc3RXaGVyZSIsInRoZW4iLCJ3cml0ZSIsIlJlc3RXcml0ZSIsInJlc3RXaGVyZSIsInJ1bk9wdGlvbnMiLCJtYW55IiwiZXhlY3V0ZSIsInB1c2hTdGF0dXMiLCJzZXRJbml0aWFsIiwib2JqZWN0SWQiLCJjYXRjaCIsImVyciIsInN0b3BPbkJhZGdlVXBkYXRlRXJyb3IiLCJsb2dnZXIiLCJpbmZvIiwic3RhY2siLCJ0b1N0cmluZyIsIm1lc3NhZ2UiLCJhdWRpZW5jZV9pZCIsImF1ZGllbmNlSWQiLCJ1cGRhdGVBdWRpZW5jZSIsImxhc3RVc2VkIiwiX190eXBlIiwiaXNvIiwidG9JU09TdHJpbmciLCJ0aW1lc1VzZWQiLCJoYXNQdXNoU2NoZWR1bGVkU3VwcG9ydCIsInB1c2hDb250cm9sbGVyUXVldWUiLCJlbnF1ZXVlIiwiZmFpbCIsImhhc0V4cGlyYXRpb25UaW1lIiwiZXhwaXJhdGlvblRpbWVQYXJhbSIsImV4cGlyYXRpb25UaW1lIiwiaXNGaW5pdGUiLCJoYXNFeHBpcmF0aW9uSW50ZXJ2YWwiLCJleHBpcmF0aW9uSW50ZXJ2YWxQYXJhbSIsImhhc1B1c2hUaW1lIiwicHVzaFRpbWVQYXJhbSIsImlzTG9jYWxUaW1lIiwicHVzaFRpbWVIYXNUaW1lem9uZUNvbXBvbmVudCIsIm9mZnNldFBhdHRlcm4iLCJpbmRleE9mIiwibGVuZ3RoIiwidGVzdCIsImlzb1N0cmluZyIsInN1YnN0cmluZyJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUFBOztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7OztBQUVPLE1BQU1BLGNBQU4sQ0FBcUI7O0FBRTFCQyxXQUFTQyxPQUFPLEVBQWhCLEVBQW9CQyxRQUFRLEVBQTVCLEVBQWdDQyxNQUFoQyxFQUF3Q0MsSUFBeEMsRUFBOENDLG9CQUFvQixNQUFNLENBQUUsQ0FBMUUsRUFBNEVDLE1BQU0sSUFBSUMsSUFBSixFQUFsRixFQUE4RjtBQUM1RixRQUFJLENBQUNKLE9BQU9LLGNBQVosRUFBNEI7QUFDMUIsWUFBTSxJQUFJQyxZQUFNQyxLQUFWLENBQWdCRCxZQUFNQyxLQUFOLENBQVlDLGtCQUE1QixFQUNKLDRCQURJLENBQU47QUFFRDs7QUFFRDtBQUNBVixTQUFLVyxlQUFMLEdBQXVCYixlQUFlYyxpQkFBZixDQUFpQ1osSUFBakMsQ0FBdkI7QUFDQUEsU0FBS2EsbUJBQUwsR0FBMkJmLGVBQWVnQixxQkFBZixDQUFxQ2QsSUFBckMsQ0FBM0I7QUFDQSxRQUFJQSxLQUFLVyxlQUFMLElBQXdCWCxLQUFLYSxtQkFBakMsRUFBc0Q7QUFDcEQsWUFBTSxJQUFJTCxZQUFNQyxLQUFWLENBQ0pELFlBQU1DLEtBQU4sQ0FBWUMsa0JBRFIsRUFFSiw0REFGSSxDQUFOO0FBR0Q7O0FBRUQ7QUFDQSxRQUFJVixLQUFLYSxtQkFBTCxJQUE0QixDQUFDYixLQUFLZSxjQUFMLENBQW9CLFdB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SUQ7O0FBRUQ7Ozs7O0FBS0EsU0FBT0MsNEJBQVAsQ0FBb0NGLGFBQXBDLEVBQW9FO0FBQ2xFLFVBQU1HLGdCQUFnQixzQkFBdEI7QUFDQSxXQUFPSCxjQUFjSSxPQUFkLENBQXNCLEdBQXRCLE1BQStCSixjQUFjSyxNQUFkLEdBQXVCLENBQXRELENBQXdEO0FBQXhELE9BQ0ZGLGNBQWNHLElBQWQsQ0FBbUJOLGFBQW5CLENBREwsQ0FGa0UsQ0FHMUI7QUFDekM7O0FBRUQ7Ozs7OztBQU1BLFNBQU9wRCxjQUFQLENBQXNCLEVBQUVELElBQUYsRUFBUXNELFdBQVIsRUFBdEIsRUFBbUY7QUFDakYsUUFBSUEsV0FBSixFQUFpQjtBQUFFO0FBQ2pCLFlBQU1NLFlBQVk1RCxLQUFLd0MsV0FBTCxFQUFsQjtBQUNBLGFBQU9vQixVQUFVQyxTQUFWLENBQW9CLENBQXBCLEVBQXVCRCxVQUFVSCxPQUFWLENBQWtCLEdBQWxCLENBQXZCLENBQVA7QUFDRDtBQUNELFdBQU96RCxLQUFLd0MsV0FBTCxFQUFQO0FBQ0Q7QUF0TXlCOztRQUFmOUQsYyxHQUFBQSxjO2tCQXlNRUEsYyIsImZpbGUiOiJQdXNoQ29udHJvbGxlci5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFBhcnNlIH0gICAgICAgICAgICAgIGZyb20gJ3BhcnNlL25vZGUnO1xuaW1wb3J0IFJlc3RRdWVyeSAgICAgICAgICAgICAgZnJvbSAnLi4vUmVzdFF1ZXJ5JztcbmltcG9ydCBSZXN0V3JpdGUgICAgICAgICAgICAgIGZyb20gJy4uL1Jlc3RXcml0ZSc7XG5pbXBvcnQgeyBtYXN0ZXIgfSAgICAgICAgICAgICBmcm9tICcuLi9BdXRoJztcbmltcG9ydCB7IHB1c2hTdGF0dXNIYW5kbGVyIH0gIGZyb20gJy4uL1N0YXR1c0hhbmRsZXInO1xuaW1wb3J0IHsgYXBwbHlEZXZpY2VUb2tlbkV4aXN0cyB9IGZyb20gJy4uL1B1c2gvdXRpbHMnO1xuaW1wb3J0IHsgbG9nZ2VyIH0gICAgICAgICAgICAgICBmcm9tICcuLi9sb2dnZXInO1xuXG5leHBvcnQgY2xhc3MgUHVzaENvbnRyb2xsZXIge1xuXG4gIHNlbmRQdXNoKGJvZHkgPSB7fSwgd2hlcmUgPSB7fSwgY29uZmlnLCBhdXRoLCBvblB1c2hTdGF0dXNTYXZlZCA9ICgpID0+IHt9LCBub3cgPSBuZXcgRGF0ZSgpKSB7XG4gICAgaWYgKCFjb25maWcuaGFzUHVzaFN1cHBvcnQpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgICdNaXNzaW5nIHB1c2ggY29uZmlndXJhdGlvbicpO1xuICAgIH1cblxuICAgIC8vIFJlcGxhY2UgdGhlIGV4cGlyYXRpb25fdGltZSBhbmQgcHVzaF90aW1lIHdpdGggYSB2YWxpZCBVbml4IGVwb2NoIG1pbGxpc2Vjb25kcyB0aW1lXG4gICAgYm9keS5leHBpcmF0aW9uX3RpbWUgPSBQdXNoQ29udHJvbGxlci5nZXRFeHBpcmF0aW9uVGltZShib2R5KTtcbiAgICBib2R5LmV4cGlyYXRpb25faW50ZXJ2YWwgPSBQdXNoQ29udHJvbGxlci5nZXRFeHBpcmF0aW9uSW50ZXJ2YWwoYm9keSk7XG4gICAgaWYgKGJvZHkuZXhwaXJhdGlvbl90aW1lICYmIGJvZHkuZXhwaXJhdGlvbl9pbnRlcnZhbCkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgICdCb3RoIGV4cGlyYXRpb25fdGltZSBhbmQgZXhwaXJhdGlvbl9pbnRlcnZhbCBjYW5ub3QgYmUgc2V0Jyk7XG4gICAgfVxuXG4gICAgLy8gSW1tZWRpYXRlIHB1c2hcbiAgICBpZiAoYm9keS5leHBpcmF0aW9uX2ludGVydmFsICYmICFib2R5Lmhhc093blByb3BlcnR5KCdwdXNoX3RpbWUnKSkge1xuICAgICAgY29uc3QgdHRsTXMgPSBib2R5LmV4cGlyYXRpb25faW50ZXJ2YWwgKiAxMDAwO1xuICAgICAgYm9keS5leHBpcmF0aW9uX3RpbWUgPSAobmV3IERhdGUobm93LnZhbHVlT2YoKSArIHR0bE1zKSkudmFsdWVPZigpO1xuICAgIH1cblxuICAgIGNvbnN0IHB1c2hUaW1lID0gUHVzaENvbnRyb2xsZXIuZ2V0UHVzaFRpbWUoYm9keSk7XG4gICAgaWYgKHB1c2hUaW1lICYmIHB1c2hUaW1lLmRhdGUgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBib2R5WydwdXNoX3RpbWUnXSA9IFB1c2hDb250cm9sbGVyLmZvcm1hdFB1c2hUaW1lKHB1c2hUaW1lKTtcbiAgICB9XG5cbiAgICAvLyBUT0RPOiBJZiB0aGUgcmVxIGNhbiBwYXNzIHRoZSBjaGVja2luZywgd2UgcmV0dXJuIGltbWVkaWF0ZWx5IGluc3RlYWQgb2Ygd2FpdGluZ1xuICAgIC8vIHB1c2hlcyB0byBiZSBzZW50LiBXZSBwcm9iYWJseSBjaGFuZ2UgdGhpcyBiZWhhdmlvdXIgaW4gdGhlIGZ1dHVyZS5cbiAgICBsZXQgYmFkZ2VVcGRhdGUgPSAoKSA9PiB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuXG4gICAgaWYgKGJvZHkuZGF0YSAmJiBib2R5LmRhdGEuYmFkZ2UpIHtcbiAgICAgIGNvbnN0IGJhZGdlID0gYm9keS5kYXRhLmJhZGdlO1xuICAgICAgbGV0IHJlc3RVcGRhdGUgPSB7fTtcbiAgICAgIGlmICh0eXBlb2YgYmFkZ2UgPT0gJ3N0cmluZycgJiYgYmFkZ2UudG9Mb3dlckNhc2UoKSA9PT0gJ2luY3JlbWVudCcpIHtcbiAgICAgICAgcmVzdFVwZGF0ZSA9IHsgYmFkZ2U6IHsgX19vcDogJ0luY3JlbWVudCcsIGFtb3VudDogMSB9IH1cbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGJhZGdlID09ICdvYmplY3QnICYmIHR5cGVvZiBiYWRnZS5fX29wID09ICdzdHJpbmcnICYmXG4gICAgICAgICAgICAgICAgIGJhZGdlLl9fb3AudG9Mb3dlckNhc2UoKSA9PSAnaW5jcmVtZW50JyAmJiBOdW1iZXIoYmFkZ2UuYW1vdW50KSkge1xuICAgICAgICByZXN0VXBkYXRlID0geyBiYWRnZTogeyBfX29wOiAnSW5jcmVtZW50JywgYW1vdW50OiBiYWRnZS5hbW91bnQgfSB9XG4gICAgICB9IGVsc2UgaWYgKE51bWJlcihiYWRnZSkpIHtcbiAgICAgICAgcmVzdFVwZGF0ZSA9IHsgYmFkZ2U6IGJhZGdlIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IFwiSW52YWxpZCB2YWx1ZSBmb3IgYmFkZ2UsIGV4cGVjdGVkIG51bWJlciBvciAnSW5jcmVtZW50JyBvciB7aW5jcmVtZW50OiBudW1iZXJ9XCI7XG4gICAgICB9XG5cbiAgICAgIC8vIEZvcmNlIGZpbHRlcmluZyBvbiBvbmx5IHZhbGlkIGRldmljZSB0b2tlbnNcbiAgICAgIGNvbnN0IHVwZGF0ZVdoZXJlID0gYXBwbHlEZXZpY2VUb2tlbkV4aXN0cyh3aGVyZSk7XG4gICAgICBiYWRnZVVwZGF0ZSA9ICgpID0+IHtcbiAgICAgICAgLy8gQnVpbGQgYSByZWFsIFJlc3RRdWVyeSBzbyB3ZSBjYW4gdXNlIGl0IGluIFJlc3RXcml0ZVxuICAgICAgICBjb25zdCByZXN0UXVlcnkgPSBuZXcgUmVzdFF1ZXJ5KGNvbmZpZywgbWFzdGVyKGNvbmZpZyksICdfSW5zdGFsbGF0aW9uJywgdXBkYXRlV2hlcmUpO1xuICAgICAgICByZXR1cm4gcmVzdFF1ZXJ5LmJ1aWxkUmVzdFdoZXJlKCkudGhlbigoKSA9PiB7XG4gICAgICAgICAgY29uc3Qgd3JpdGUgPSBuZXcgUmVzdFdyaXRlKGNvbmZpZywgbWFzdGVyKGNvbmZpZyksICdfSW5zdGFsbGF0aW9uJywgcmVzdFF1ZXJ5LnJlc3RXaGVyZSwgcmVzdFVwZGF0ZSk7XG4gICAgICAgICAgd3JpdGUucnVuT3B0aW9ucy5tYW55ID0gdHJ1ZTtcbiAgICAgICAgICByZXR1cm4gd3JpdGUuZXhlY3V0ZSgpO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgcHVzaFN0YXR1cyA9IHB1c2hTdGF0dXNIYW5kbGVyKGNvbmZpZyk7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHB1c2hTdGF0dXMuc2V0SW5pdGlhbChib2R5LCB3aGVyZSk7XG4gICAgfSkudGhlbigoKSA9PiB7XG4gICAgICBvblB1c2hTdGF0dXNTYXZlZChwdXNoU3RhdHVzLm9iamVjdElkKTtcbiAgICAgIHJldHVybiBiYWRnZVVwZGF0ZSgpLmNhdGNoKGVyciA9PiB7XG4gICAgICAgIC8vIGFkZCB0aGlzIHRvIGlnbm9yZSBiYWRnZSB1cGRhdGUgZXJyb3JzIGFzIGRlZmF1bHRcbiAgICAgICAgaWYgKGNvbmZpZy5zdG9wT25CYWRnZVVwZGF0ZUVycm9yKSB0aHJvdyBlcnI7XG4gICAgICAgIGxvZ2dlci5pbmZvKGBCYWRnZSB1cGRhdGUgZXJyb3Igd2lsbCBiZSBpZ25vcmVkIGZvciBwdXNoIHN0YXR1cyAke3B1c2hTdGF0dXMub2JqZWN0SWR9YCk7XG4gICAgICAgIGxvZ2dlci5pbmZvKGVyciAmJiBlcnIuc3RhY2sgJiYgZXJyLnN0YWNrLnRvU3RyaW5nKCkgfHwgZXJyICYmIGVyci5tZXNzYWdlIHx8IGVyci50b1N0cmluZygpKTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgfSk7XG4gICAgfSkudGhlbigoKSA9PiB7XG4gICAgICAvLyBVcGRhdGUgYXVkaWVuY2UgbGFzdFVzZWQgYW5kIHRpbWVzVXNlZFxuICAgICAgaWYgKGJvZHkuYXVkaWVuY2VfaWQpIHtcbiAgICAgICAgY29uc3QgYXVkaWVuY2VJZCA9IGJvZHkuYXVkaWVuY2VfaWQ7XG5cbiAgICAgICAgdmFyIHVwZGF0ZUF1ZGllbmNlID0ge1xuICAgICAgICAgIGxhc3RVc2VkOiB7IF9fdHlwZTogXCJEYXRlXCIsIGlzbzogbmV3IERhdGUoKS50b0lTT1N0cmluZygpIH0sXG4gICAgICAgICAgdGltZXNVc2VkOiB7IF9fb3A6IFwiSW5jcmVtZW50XCIsIFwiYW1vdW50XCI6IDEgfVxuICAgICAgICB9O1xuICAgICAgICBjb25zdCB3cml0ZSA9IG5ldyBSZXN0V3JpdGUoY29uZmlnLCBtYXN0ZXIoY29uZmlnKSwgJ19BdWRpZW5jZScsIHtvYmplY3RJZDogYXVkaWVuY2VJZH0sIHVwZGF0ZUF1ZGllbmNlKTtcbiAgICAgICAgd3JpdGUuZXhlY3V0ZSgpO1xuICAgICAgfVxuICAgICAgLy8gRG9uJ3Qgd2FpdCBmb3IgdGhlIGF1ZGllbmNlIHVwZGF0ZSBwcm9taXNlIHRvIHJlc29sdmUuXG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfSkudGhlbigoKSA9PiB7XG4gICAgICBpZiAoYm9keS5oYXNPd25Qcm9wZXJ0eSgncHVzaF90aW1lJykgJiYgY29uZmlnLmhhc1B1c2hTY2hlZHVsZWRTdXBwb3J0KSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBjb25maWcucHVzaENvbnRyb2xsZXJRdWV1ZS5lbnF1ZXVlKGJvZHksIHdoZXJlLCBjb25maWcsIGF1dGgsIHB1c2hTdGF0dXMpO1xuICAgIH0pLmNhdGNoKChlcnIpID0+IHtcbiAgICAgIHJldHVybiBwdXNoU3RhdHVzLmZhaWwoZXJyKS50aGVuKCgpID0+IHtcbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGV4cGlyYXRpb24gdGltZSBmcm9tIHRoZSByZXF1ZXN0IGJvZHkuXG4gICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IEEgcmVxdWVzdCBvYmplY3RcbiAgICogQHJldHVybnMge051bWJlcnx1bmRlZmluZWR9IFRoZSBleHBpcmF0aW9uIHRpbWUgaWYgaXQgZXhpc3RzIGluIHRoZSByZXF1ZXN0XG4gICAqL1xuICBzdGF0aWMgZ2V0RXhwaXJhdGlvblRpbWUoYm9keSA9IHt9KSB7XG4gICAgdmFyIGhhc0V4cGlyYXRpb25UaW1lID0gYm9keS5oYXNPd25Qcm9wZXJ0eSgnZXhwaXJhdGlvbl90aW1lJyk7XG4gICAgaWYgKCFoYXNFeHBpcmF0aW9uVGltZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgZXhwaXJhdGlvblRpbWVQYXJhbSA9IGJvZHlbJ2V4cGlyYXRpb25fdGltZSddO1xuICAgIHZhciBleHBpcmF0aW9uVGltZTtcbiAgICBpZiAodHlwZW9mIGV4cGlyYXRpb25UaW1lUGFyYW0gPT09ICdudW1iZXInKSB7XG4gICAgICBleHBpcmF0aW9uVGltZSA9IG5ldyBEYXRlKGV4cGlyYXRpb25UaW1lUGFyYW0gKiAxMDAwKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBleHBpcmF0aW9uVGltZVBhcmFtID09PSAnc3RyaW5nJykge1xuICAgICAgZXhwaXJhdGlvblRpbWUgPSBuZXcgRGF0ZShleHBpcmF0aW9uVGltZVBhcmFtKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlBVU0hfTUlTQ09ORklHVVJFRCxcbiAgICAgICAgYm9keVsnZXhwaXJhdGlvbl90aW1lJ10gKyAnIGlzIG5vdCB2YWxpZCB0aW1lLicpO1xuICAgIH1cbiAgICAvLyBDaGVjayBleHBpcmF0aW9uVGltZSBpcyB2YWxpZCBvciBub3QsIGlmIGl0IGlzIG5vdCB2YWxpZCwgZXhwaXJhdGlvblRpbWUgaXMgTmFOXG4gICAgaWYgKCFpc0Zpbml0ZShleHBpcmF0aW9uVGltZSkpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgIGJvZHlbJ2V4cGlyYXRpb25fdGltZSddICsgJyBpcyBub3QgdmFsaWQgdGltZS4nKTtcbiAgICB9XG4gICAgcmV0dXJuIGV4cGlyYXRpb25UaW1lLnZhbHVlT2YoKTtcbiAgfVxuXG4gIHN0YXRpYyBnZXRFeHBpcmF0aW9uSW50ZXJ2YWwoYm9keSA9IHt9KSB7XG4gICAgY29uc3QgaGFzRXhwaXJhdGlvbkludGVydmFsID0gYm9keS5oYXNPd25Qcm9wZXJ0eSgnZXhwaXJhdGlvbl9pbnRlcnZhbCcpO1xuICAgIGlmICghaGFzRXhwaXJhdGlvbkludGVydmFsKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGV4cGlyYXRpb25JbnRlcnZhbFBhcmFtID0gYm9keVsnZXhwaXJhdGlvbl9pbnRlcnZhbCddO1xuICAgIGlmICh0eXBlb2YgZXhwaXJhdGlvbkludGVydmFsUGFyYW0gIT09ICdudW1iZXInIHx8IGV4cGlyYXRpb25JbnRlcnZhbFBhcmFtIDw9IDApIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgIGBleHBpcmF0aW9uX2ludGVydmFsIG11c3QgYmUgYSBudW1iZXIgZ3JlYXRlciB0aGFuIDBgKTtcbiAgICB9XG4gICAgcmV0dXJuIGV4cGlyYXRpb25JbnRlcnZhbFBhcmFtO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBwdXNoIHRpbWUgZnJvbSB0aGUgcmVxdWVzdCBib2R5LlxuICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCBBIHJlcXVlc3Qgb2JqZWN0XG4gICAqIEByZXR1cm5zIHtOdW1iZXJ8dW5kZWZpbmVkfSBUaGUgcHVzaCB0aW1lIGlmIGl0IGV4aXN0cyBpbiB0aGUgcmVxdWVzdFxuICAgKi9cbiAgc3RhdGljIGdldFB1c2hUaW1lKGJvZHkgPSB7fSkge1xuICAgIHZhciBoYXNQdXNoVGltZSA9IGJvZHkuaGFzT3duUHJvcGVydHkoJ3B1c2hfdGltZScpO1xuICAgIGlmICghaGFzUHVzaFRpbWUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIHB1c2hUaW1lUGFyYW0gPSBib2R5WydwdXNoX3RpbWUnXTtcbiAgICB2YXIgZGF0ZTtcbiAgICB2YXIgaXNMb2NhbFRpbWUgPSB0cnVlO1xuXG4gICAgaWYgKHR5cGVvZiBwdXNoVGltZVBhcmFtID09PSAnbnVtYmVyJykge1xuICAgICAgZGF0ZSA9IG5ldyBEYXRlKHB1c2hUaW1lUGFyYW0gKiAxMDAwKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBwdXNoVGltZVBhcmFtID09PSAnc3RyaW5nJykge1xuICAgICAgaXNMb2NhbFRpbWUgPSAhUHVzaENvbnRyb2xsZXIucHVzaFRpbWVIYXNUaW1lem9uZUNvbXBvbmVudChwdXNoVGltZVBhcmFtKTtcbiAgICAgIGRhdGUgPSBuZXcgRGF0ZShwdXNoVGltZVBhcmFtKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlBVU0hfTUlTQ09ORklHVVJFRCxcbiAgICAgICAgYm9keVsncHVzaF90aW1lJ10gKyAnIGlzIG5vdCB2YWxpZCB0aW1lLicpO1xuICAgIH1cbiAgICAvLyBDaGVjayBwdXNoVGltZSBpcyB2YWxpZCBvciBub3QsIGlmIGl0IGlzIG5vdCB2YWxpZCwgcHVzaFRpbWUgaXMgTmFOXG4gICAgaWYgKCFpc0Zpbml0ZShkYXRlKSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlBVU0hfTUlTQ09ORklHVVJFRCxcbiAgICAgICAgYm9keVsncHVzaF90aW1lJ10gKyAnIGlzIG5vdCB2YWxpZCB0aW1lLicpO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBkYXRlLFxuICAgICAgaXNMb2NhbFRpbWUsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3MgaWYgYSBJU084NjAxIGZvcm1hdHRlZCBkYXRlIGNvbnRhaW5zIGEgdGltZXpvbmUgY29tcG9uZW50XG4gICAqIEBwYXJhbSBwdXNoVGltZVBhcmFtIHtzdHJpbmd9XG4gICAqIEByZXR1cm5zIHtib29sZWFufVxuICAgKi9cbiAgc3RhdGljIHB1c2hUaW1lSGFzVGltZXpvbmVDb21wb25lbnQocHVzaFRpbWVQYXJhbTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgY29uc3Qgb2Zmc2V0UGF0dGVybiA9IC8oLispKFsrLV0pXFxkXFxkOlxcZFxcZCQvO1xuICAgIHJldHVybiBwdXNoVGltZVBhcmFtLmluZGV4T2YoJ1onKSA9PT0gcHVzaFRpbWVQYXJhbS5sZW5ndGggLSAxIC8vIDIwMDctMDQtMDVUMTI6MzBaXG4gICAgICB8fCBvZmZzZXRQYXR0ZXJuLnRlc3QocHVzaFRpbWVQYXJhbSk7IC8vIDIwMDctMDQtMDVUMTI6MzAuMDAwKzAyOjAwLCAyMDA3LTA0LTA1VDEyOjMwLjAwMC0wMjowMFxuICB9XG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIGEgZGF0ZSB0byBJU08gZm9ybWF0IGluIFVUQyB0aW1lIGFuZCBzdHJpcHMgdGhlIHRpbWV6b25lIGlmIGBpc0xvY2FsVGltZWAgaXMgdHJ1ZVxuICAgKiBAcGFyYW0gZGF0ZSB7RGF0ZX1cbiAgICogQHBhcmFtIGlzTG9jYWxUaW1lIHtib29sZWFufVxuICAgKiBAcmV0dXJucyB7c3RyaW5nfVxuICAgKi9cbiAgc3RhdGljIGZvcm1hdFB1c2hUaW1lKHsgZGF0ZSwgaXNMb2NhbFRpbWUgfTogeyBkYXRlOiBEYXRlLCBpc0xvY2FsVGltZTogYm9vbGVhbiB9KSB7XG4gICAgaWYgKGlzTG9jYWxUaW1lKSB7IC8vIFN0cmlwICdaJ1xuICAgICAgY29uc3QgaXNvU3RyaW5nID0gZGF0ZS50b0lTT1N0cmluZygpO1xuICAgICAgcmV0dXJuIGlzb1N0cmluZy5zdWJzdHJpbmcoMCwgaXNvU3RyaW5nLmluZGV4T2YoJ1onKSk7XG4gICAgfVxuICAgIHJldHVybiBkYXRlLnRvSVNPU3RyaW5nKCk7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgUHVzaENvbnRyb2xsZXI7XG4iXX0=