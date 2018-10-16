'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FeaturesRouter = undefined;

var _package = require('../../package.json');

var _PromiseRouter = require('../PromiseRouter');

var _PromiseRouter2 = _interopRequireDefault(_PromiseRouter);

var _middlewares = require('../middlewares');

var middleware = _interopRequireWildcard(_middlewares);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class FeaturesRouter extends _PromiseRouter2.default {
  mountRoutes() {
    this.route('GET', '/serverInfo', middleware.promiseEnforceMasterKeyAccess, req => {
      const features = {
        globalConfig: {
          create: true,
          read: true,
          update: true,
          delete: true
        },
        hooks: {
          create: true,
          read: true,
          update: true,
          delete: true
        },
        cloudCode: {
          jobs: true
        },
        logs: {
          level: true,
          size: true,
          order: true,
          until: true,
          from: true
        },
        push: {
          immediatePush: req.config.hasPushSupport,
          scheduledPush: req.config.hasPushScheduledSupport,
          storedPushData: req.config.hasPushSupport,
          pushAudiences: true,
          localization: true
        },
        schemas: {
          addField: true,
          removeField: true,
          addClass: true,
          removeClass: true,
          clearAllDataFromClass: true,
          import: true,
          exportClass: true,
          editClassLevelPermissions: true,
          editPointerPermissions: true
        }
      };

      return { response: {
          features: features,
          parseServerVersion: _package.version
        } };
    });
  }
}
exports.FeaturesRouter = FeaturesRouter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL0ZlYXR1cmVzUm91dGVyLmpzIl0sIm5hbWVzIjpbIm1pZGRsZXdhcmUiLCJGZWF0dXJlc1JvdXRlciIsIlByb21pc2VSb3V0ZXIiLCJtb3VudFJvdXRlcyIsInJvdXRlIiwicHJvbWlzZUVuZm9yY2VNYXN0ZXJLZXlBY2Nlc3MiLCJyZXEiLCJmZWF0dXJlcyIsImdsb2JhbENvbmZpZyIsImNyZWF0ZSIsInJlYWQiLCJ1cGRhdGUiLCJkZWxldGUiLCJob29rcyIsImNsb3VkQ29kZSIsImpvYnMiLCJsb2dzIiwibGV2ZWwiLCJzaXplIiwib3JkZXIiLCJ1bnRpbCIsImZyb20iLCJwdXNoIiwiaW1tZWRpYXRlUHVzaCIsImNvbmZpZyIsImhhc1B1c2hTdXBwb3J0Iiwic2NoZWR1bGVkUHVzaCIsImhhc1B1c2hTY2hlZHVsZWRTdXBwb3J0Iiwic3RvcmVkUHVzaERhdGEiLCJwdXNoQXVkaWVuY2VzIiwibG9jYWxpemF0aW9uIiwic2NoZW1hcyIsImFkZEZpZWxkIiwicmVtb3ZlRmllbGQiLCJhZGRDbGFzcyIsInJlbW92ZUNsYXNzIiwiY2xlYXJBbGxEYXRhRnJvbUNsYXNzIiwiaW1wb3J0IiwiZXhwb3J0Q2xhc3MiLCJlZGl0Q2xhc3NMZXZlbFBlcm1pc3Npb25zIiwiZWRpdFBvaW50ZXJQZXJtaXNzaW9ucyIsInJlc3BvbnNlIiwicGFyc2VTZXJ2ZXJWZXJzaW9uIiwidmVyc2lvbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUFBOztBQUNBOzs7O0FBQ0E7O0lBQVlBLFU7Ozs7OztBQUVMLE1BQU1DLGNBQU4sU0FBNkJDLHVCQUE3QixDQUEyQztBQUNoREMsZ0JBQWM7QUFDWixTQUFLQyxLQUFMLENBQVcsS0FBWCxFQUFpQixhQUFqQixFQUFnQ0osV0FBV0ssNkJBQTNDLEVBQTBFQyxPQUFPO0FBQy9FLFlBQU1DLFdBQVc7QUFDZkMsc0JBQWM7QUFDWkMsa0JBQVEsSUFESTtBQUVaQyxnQkFBTSxJQUZNO0FBR1pDLGtCQUFRLElBSEk7QUFJWkMsa0JBQVE7QUFKSSxTQURDO0FBT2ZDLGVBQU87QUFDTEosa0JBQVEsSUFESDtBQUVMQyxnQkFBTSxJQUZEO0FBR0xDLGtCQUFRLElBSEg7QUFJTEMsa0JBQVE7QUFKSCxTQVBRO0FBYWZFLG1CQUFXO0FBQ1RDLGdCQUFNO0FBREcsU0FiSTtBQWdCZkMsY0FBTTtBQUNKQyxpQkFBTyxJQURIO0FBRUpDLGdCQUFNLElBRkY7QUFHSkMsaUJBQU8sSUFISDtBQUlKQyxpQkFBTyxJQUpIO0FBS0pDLGdCQUFNO0FBTEYsU0FoQlM7QUF1QmZDLGNBQU07QUFDSkMseUJBQWVqQixJQUFJa0IsTUFBSixDQUFXQyxjQUR0QjtBQUVKQyx5QkFBZXBCLElBQUlrQixNQUFKLENBQVdHLHVCQUZ0QjtBQUdKQywwQkFBZ0J0QixJQUFJa0IsTUFBSixDQUFXQyxjQUh2QjtBQUlKSSx5QkFBZSxJQUpYO0FBS0pDLHdCQUFjO0FBTFYsU0F2QlM7QUE4QmZDLGlCQUFTO0FBQ1BDLG9CQUFVLElBREg7QUFFUEMsdUJBQWEsSUFGTjtBQUdQQyxvQkFBVSxJQUhIO0FBSVBDLHVCQUFhLElBSk47QUFLUEMsaUNBQXVCLElBTGhCO0FBTVBDLGtCQUFRLElBTkQ7QUFPUEMsdUJBQWEsSUFQTjtBQVFQQyxxQ0FBMkIsSUFScEI7QUFTUEMsa0NBQXdCO0FBVGpCO0FBOUJNLE9BQWpCOztBQTJDQSxhQUFPLEVBQUVDLFVBQVU7QUFDakJsQyxvQkFBVUEsUUFETztBQUVqQm1DLDhCQUFvQkM7QUFGSCxTQUFaLEVBQVA7QUFJRCxLQWhERDtBQWlERDtBQW5EK0M7UUFBckMxQyxjLEdBQUFBLGMiLCJmaWxlIjoiRmVhdHVyZXNSb3V0ZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyB2ZXJzaW9uIH0gICAgIGZyb20gJy4uLy4uL3BhY2thZ2UuanNvbic7XG5pbXBvcnQgUHJvbWlzZVJvdXRlciAgIGZyb20gJy4uL1Byb21pc2VSb3V0ZXInO1xuaW1wb3J0ICogYXMgbWlkZGxld2FyZSBmcm9tIFwiLi4vbWlkZGxld2FyZXNcIjtcblxuZXhwb3J0IGNsYXNzIEZlYXR1cmVzUm91dGVyIGV4dGVuZHMgUHJvbWlzZVJvdXRlciB7XG4gIG1vdW50Um91dGVzKCkge1xuICAgIHRoaXMucm91dGUoJ0dFVCcsJy9zZXJ2ZXJJbmZvJywgbWlkZGxld2FyZS5wcm9taXNlRW5mb3JjZU1hc3RlcktleUFjY2VzcywgcmVxID0+IHtcbiAgICAgIGNvbnN0IGZlYXR1cmVzID0ge1xuICAgICAgICBnbG9iYWxDb25maWc6IHtcbiAgICAgICAgICBjcmVhdGU6IHRydWUsXG4gICAgICAgICAgcmVhZDogdHJ1ZSxcbiAgICAgICAgICB1cGRhdGU6IHRydWUsXG4gICAgICAgICAgZGVsZXRlOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICBob29rczoge1xuICAgICAgICAgIGNyZWF0ZTogdHJ1ZSxcbiAgICAgICAgICByZWFkOiB0cnVlLFxuICAgICAgICAgIHVwZGF0ZTogdHJ1ZSxcbiAgICAgICAgICBkZWxldGU6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIGNsb3VkQ29kZToge1xuICAgICAgICAgIGpvYnM6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIGxvZ3M6IHtcbiAgICAgICAgICBsZXZlbDogdHJ1ZSxcbiAgICAgICAgICBzaXplOiB0cnVlLFxuICAgICAgICAgIG9yZGVyOiB0cnVlLFxuICAgICAgICAgIHVudGlsOiB0cnVlLFxuICAgICAgICAgIGZyb206IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIHB1c2g6IHtcbiAgICAgICAgICBpbW1lZGlhdGVQdXNoOiByZXEuY29uZmlnLmhhc1B1c2hTdXBwb3J0LFxuICAgICAgICAgIHNjaGVkdWxlZFB1c2g6IHJlcS5jb25maWcuaGFzUHVzaFNjaGVkdWxlZFN1cHBvcnQsXG4gICAgICAgICAgc3RvcmVkUHVzaERhdGE6IHJlcS5jb25maWcuaGFzUHVzaFN1cHBvcnQsXG4gICAgICAgICAgcHVzaEF1ZGllbmNlczogdHJ1ZSxcbiAgICAgICAgICBsb2NhbGl6YXRpb246IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIHNjaGVtYXM6IHtcbiAgICAgICAgICBhZGRGaWVsZDogdHJ1ZSxcbiAgICAgICAgICByZW1vdmVGaWVsZDogdHJ1ZSxcbiAgICAgICAgICBhZGRDbGFzczogdHJ1ZSxcbiAgICAgICAgICByZW1vdmVDbGFzczogdHJ1ZSxcbiAgICAgICAgICBjbGVhckFsbERhdGFGcm9tQ2xhc3M6IHRydWUsXG4gICAgICAgICAgaW1wb3J0OiB0cnVlLFxuICAgICAgICAgIGV4cG9ydENsYXNzOiB0cnVlLFxuICAgICAgICAgIGVkaXRDbGFzc0xldmVsUGVybWlzc2lvbnM6IHRydWUsXG4gICAgICAgICAgZWRpdFBvaW50ZXJQZXJtaXNzaW9uczogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgIH07XG5cbiAgICAgIHJldHVybiB7IHJlc3BvbnNlOiB7XG4gICAgICAgIGZlYXR1cmVzOiBmZWF0dXJlcyxcbiAgICAgICAgcGFyc2VTZXJ2ZXJWZXJzaW9uOiB2ZXJzaW9uLFxuICAgICAgfSB9O1xuICAgIH0pO1xuICB9XG59XG4iXX0=