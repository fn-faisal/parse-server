"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _Options = require("./Options");

var _defaults = _interopRequireDefault(require("./defaults"));

var logging = _interopRequireWildcard(require("./logger"));

var _Config = _interopRequireDefault(require("./Config"));

var _PromiseRouter = _interopRequireDefault(require("./PromiseRouter"));

var _requiredParameter = _interopRequireDefault(require("./requiredParameter"));

var _AnalyticsRouter = require("./Routers/AnalyticsRouter");

var _ClassesRouter = require("./Routers/ClassesRouter");

var _FeaturesRouter = require("./Routers/FeaturesRouter");

var _FilesRouter = require("./Routers/FilesRouter");

var _FunctionsRouter = require("./Routers/FunctionsRouter");

var _GlobalConfigRouter = require("./Routers/GlobalConfigRouter");

var _HooksRouter = require("./Routers/HooksRouter");

var _IAPValidationRouter = require("./Routers/IAPValidationRouter");

var _InstallationsRouter = require("./Routers/InstallationsRouter");

var _LogsRouter = require("./Routers/LogsRouter");

var _ParseLiveQueryServer = require("./LiveQuery/ParseLiveQueryServer");

var _PublicAPIRouter = require("./Routers/PublicAPIRouter");

var _PushRouter = require("./Routers/PushRouter");

var _CloudCodeRouter = require("./Routers/CloudCodeRouter");

var _RolesRouter = require("./Routers/RolesRouter");

var _SchemasRouter = require("./Routers/SchemasRouter");

var _SessionsRouter = require("./Routers/SessionsRouter");

var _UsersRouter = require("./Routers/UsersRouter");

var _PurgeRouter = require("./Routers/PurgeRouter");

var _AudiencesRouter = require("./Routers/AudiencesRouter");

var _AggregateRouter = require("./Routers/AggregateRouter");

var _ExportRouter = require("./Routers/ExportRouter");

var _ParseServerRESTController = require("./ParseServerRESTController");

var controllers = _interopRequireWildcard(require("./Controllers"));

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = Object.defineProperty && Object.getOwnPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : {}; if (desc.get || desc.set) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// ParseServer - open-source compatible API Server for Parse apps
var batch = require('./batch'),
    bodyParser = require('body-parser'),
    express = require('express'),
    middlewares = require('./middlewares'),
    Parse = require('parse/node').Parse,
    path = require('path');

// Mutate the Parse object to add the Cloud Code handlers
addParseCloud(); // ParseServer works like a constructor of an express app.
// The args that we understand are:
// "analyticsAdapter": an adapter class for analytics
// "filesAdapter": a class like GridFSBucketAdapter providing create, get,
//                 and delete
// "loggerAdapter": a class like WinstonLoggerAdapter providing info, error,
//                 and query
// "jsonLogs": log as structured JSON objects
// "databaseURI": a uri like mongodb://localhost:27017/dbname to tell us
//          what database this Parse API connects to.
// "cloud": relative location to cloud code to require, or a function
//          that is given an instance of Parse as a parameter.  Use this instance of Parse
//          to register your cloud code hooks and functions.
// "appId": the application id to host
// "masterKey": the master key for requests to this app
// "collectionPrefix": optional prefix for database collection names
// "fileKey": optional key from Parse dashboard for supporting older files
//            hosted by Parse
// "clientKey": optional key from Parse dashboard
// "dotNetKey": optional key from Parse dashboard
// "restAPIKey": optional key from Parse dashboard
// "webhookKey": optional key from Parse dashboard
// "javascriptKey": optional key from Parse dashboard
// "push": optional key from configure push
// "sessionLength": optional length in seconds for how long Sessions should be valid for
// "maxLimit": optional upper bound for what can be specified for the 'limit' parameter on queries

class ParseServer {
  /**
   * @constructor
   * @param {ParseServerOptions} options the parse server initialization options
   */
  constructor(options) {
    injectDefaults(options);
    const {
      appId = (0, _requiredParameter.default)('You must provide an appId!'),
      masterKey = (0, _requiredParameter.default)('You must provide a masterKey!'),
      cloud,
      javascriptKey,
      serverURL = (0, _requiredParameter.default)('You must provide a serverURL!'),
      __indexBuildCompletionCallbackForTests = () => {}
    } = options; // Initialize the node client SDK automatically

    Parse.initialize(appId, javascriptKey || 'unused', masterKey);
    Parse.serverURL = serverURL;
    const allControllers = controllers.getControllers(options);
    const {
      loggerController,
      databaseController,
      hooksController
    } = allControllers;
    this.config = _Config.default.put(Object.assign({}, options, allControllers));
    logging.setLogger(loggerController);
    const dbInitPromise = databaseController.performInitialization();
    hooksController.load(); // Note: Tests will start to fail if any validation happens after this is called.

    if (process.env.TESTING) {
      __indexBuildCompletionCallbackForTests(dbInitPromise);
    }

    if (cloud) {
      addParseCloud();

      if (typeof cloud === 'function') {
        cloud(Parse);
      } else if (typeof cloud === 'string') {
        require(path.resolve(process.cwd(), cloud));
      } else {
        throw "argument 'cloud' must either be a string or a function";
      }
    }
  }

  get app() {
    if (!this._app) {
      this._app = ParseServer.app(this.config);
    }

    return this._app;
  }

  handleShutdown() {
    const {
      adapter
    } = this.config.databaseController;

    if (adapter && typeof adapter.handleShutdown === 'function') {
      adapter.handleShutdown();
    }
  }
  /**
   * @static
   * Create an express app for the parse server
   * @param {Object} options let you specify the maxUploadSize when creating the express app  */


  static app({
    maxUploadSize = '20mb',
    appId
  }) {
    // This app serves the Parse API directly.
    // It's the equivalent of https://api.parse.com/1 in the hosted Parse API.
    var api = express(); //api.use("/apps", express.static(__dirname + "/public"));
    // File handling needs to be before default middlewares are applied

    api.use('/', middlewares.allowCrossDomain, new _FilesRouter.FilesRouter().expressRouter({
      maxUploadSize: maxUploadSize
    }));
    api.use('/health', function (req, res) {
      res.json({
        status: 'ok'
      });
    });
    api.use('/', bodyParser.urlencoded({
      extended: false
    }), new _PublicAPIRouter.PublicAPIRouter().expressRouter());
    api.use(bodyParser.json({
      type: '*/*',
      limit: maxUploadSize
    }));
    api.use(middlewares.allowCrossDomain);
    api.use(middlewares.allowMethodOverride);
    api.use(middlewares.handleParseHeaders);
    const appRouter = ParseServer.promiseRouter({
      appId
    });
    api.use(appRouter.expressRouter());
    api.use(middlewares.handleParseErrors); // run the following when not testing

    if (!process.env.TESTING) {
      //This causes tests to spew some useless warnings, so disable in test

      /* istanbul ignore next */
      process.on('uncaughtException', err => {
        if (err.code === 'EADDRINUSE') {
          // user-friendly message for this common error
          process.stderr.write(`Unable to listen on port ${err.port}. The port is already in use.`);
          process.exit(0);
        } else {
          throw err;
        }
      }); // verify the server url after a 'mount' event is received

      /* istanbul ignore next */

      api.on('mount', function () {
        ParseServer.verifyServerUrl();
      });
    }

    if (process.env.PARSE_SERVER_ENABLE_EXPERIMENTAL_DIRECT_ACCESS === '1') {
      Parse.CoreManager.setRESTController((0, _ParseServerRESTController.ParseServerRESTController)(appId, appRouter));
    }

    return api;
  }

  static promiseRouter({
    appId
  }) {
    const routers = [new _ClassesRouter.ClassesRouter(), new _UsersRouter.UsersRouter(), new _SessionsRouter.SessionsRouter(), new _RolesRouter.RolesRouter(), new _AnalyticsRouter.AnalyticsRouter(), new _InstallationsRouter.InstallationsRouter(), new _FunctionsRouter.FunctionsRouter(), new _SchemasRouter.SchemasRouter(), new _PushRouter.PushRouter(), new _LogsRouter.LogsRouter(), new _IAPValidationRouter.IAPValidationRouter(), new _FeaturesRouter.FeaturesRouter(), new _GlobalConfigRouter.GlobalConfigRouter(), new _PurgeRouter.PurgeRouter(), new _HooksRouter.HooksRouter(), new _CloudCodeRouter.CloudCodeRouter(), new _AudiencesRouter.AudiencesRouter(), new _AggregateRouter.AggregateRouter(), new _ExportRouter.ExportRouter()];
    const routes = routers.reduce((memo, router) => {
      return memo.concat(router.routes);
    }, []);
    const appRouter = new _PromiseRouter.default(routes, appId);
    batch.mountOnto(appRouter);
    return appRouter;
  }
  /**
   * starts the parse server's express app
   * @param {ParseServerOptions} options to use to start the server
   * @param {Function} callback called when the server has started
   * @returns {ParseServer} the parse server instance
   */


  start(options, callback) {
    const app = express();

    if (options.middleware) {
      let middleware;

      if (typeof options.middleware == 'string') {
        middleware = require(path.resolve(process.cwd(), options.middleware));
      } else {
        middleware = options.middleware; // use as-is let express fail
      }

      app.use(middleware);
    }

    app.use(options.mountPath, this.app);
    const server = app.listen(options.port, options.host, callback);
    this.server = server;

    if (options.startLiveQueryServer || options.liveQueryServerOptions) {
      this.liveQueryServer = ParseServer.createLiveQueryServer(server, options.liveQueryServerOptions);
    }
    /* istanbul ignore next */


    if (!process.env.TESTING) {
      configureListeners(this);
    }

    this.expressApp = app;
    return this;
  }
  /**
   * Creates a new ParseServer and starts it.
   * @param {ParseServerOptions} options used to start the server
   * @param {Function} callback called when the server has started
   * @returns {ParseServer} the parse server instance
   */


  static start(options, callback) {
    const parseServer = new ParseServer(options);
    return parseServer.start(options, callback);
  }
  /**
   * Helper method to create a liveQuery server
   * @static
   * @param {Server} httpServer an optional http server to pass
   * @param {LiveQueryServerOptions} config options fot he liveQueryServer
   * @returns {ParseLiveQueryServer} the live query server instance
   */


  static createLiveQueryServer(httpServer, config) {
    if (!httpServer || config && config.port) {
      var app = express();
      httpServer = require('http').createServer(app);
      httpServer.listen(config.port);
    }

    return new _ParseLiveQueryServer.ParseLiveQueryServer(httpServer, config);
  }

  static verifyServerUrl(callback) {
    // perform a health check on the serverURL value
    if (Parse.serverURL) {
      const request = require('./request');

      request({
        url: Parse.serverURL.replace(/\/$/, '') + '/health'
      }).catch(response => response).then(response => {
        const json = response.data || null;

        if (response.status !== 200 || !json || json && json.status !== 'ok') {
          /* eslint-disable no-console */
          console.warn(`\nWARNING, Unable to connect to '${Parse.serverURL}'.` + ` Cloud code and push notifications may be unavailable!\n`);
          /* eslint-enable no-console */

          if (callback) {
            callback(false);
          }
        } else {
          if (callback) {
            callback(true);
          }
        }
      });
    }
  }

}

function addParseCloud() {
  const ParseCloud = require('./cloud-code/Parse.Cloud');

  Object.assign(Parse.Cloud, ParseCloud);
  global.Parse = Parse;
}

function injectDefaults(options) {
  Object.keys(_defaults.default).forEach(key => {
    if (!options.hasOwnProperty(key)) {
      options[key] = _defaults.default[key];
    }
  });

  if (!options.hasOwnProperty('serverURL')) {
    options.serverURL = `http://localhost:${options.port}${options.mountPath}`;
  }

  options.userSensitiveFields = Array.from(new Set(options.userSensitiveFields.concat(_defaults.default.userSensitiveFields, options.userSensitiveFields)));
  options.masterKeyIps = Array.from(new Set(options.masterKeyIps.concat(_defaults.default.masterKeyIps, options.masterKeyIps)));
} // Those can't be tested as it requires a subprocess

/* istanbul ignore next */


function configureListeners(parseServer) {
  const server = parseServer.server;
  const sockets = {};
  /* Currently, express doesn't shut down immediately after receiving SIGINT/SIGTERM if it has client connections that haven't timed out. (This is a known issue with node - https://github.com/nodejs/node/issues/2642)
    This function, along with `destroyAliveConnections()`, intend to fix this behavior such that parse server will close all open connections and initiate the shutdown process as soon as it receives a SIGINT/SIGTERM signal. */

  server.on('connection', socket => {
    const socketId = socket.remoteAddress + ':' + socket.remotePort;
    sockets[socketId] = socket;
    socket.on('close', () => {
      delete sockets[socketId];
    });
  });

  const destroyAliveConnections = function () {
    for (const socketId in sockets) {
      try {
        sockets[socketId].destroy();
      } catch (e) {
        /* */
      }
    }
  };

  const handleShutdown = function () {
    process.stdout.write('Termination signal received. Shutting down.');
    destroyAliveConnections();
    server.close();
    parseServer.handleShutdown();
  };

  process.on('SIGTERM', handleShutdown);
  process.on('SIGINT', handleShutdown);
}

var _default = ParseServer;
exports.default = _default;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9QYXJzZVNlcnZlci5qcyJdLCJuYW1lcyI6WyJiYXRjaCIsInJlcXVpcmUiLCJib2R5UGFyc2VyIiwiZXhwcmVzcyIsIm1pZGRsZXdhcmVzIiwiUGFyc2UiLCJwYXRoIiwiYWRkUGFyc2VDbG91ZCIsIlBhcnNlU2VydmVyIiwiY29uc3RydWN0b3IiLCJvcHRpb25zIiwiaW5qZWN0RGVmYXVsdHMiLCJhcHBJZCIsIm1hc3RlcktleSIsImNsb3VkIiwiamF2YXNjcmlwdEtleSIsInNlcnZlclVSTCIsIl9faW5kZXhCdWlsZENvbXBsZXRpb25DYWxsYmFja0ZvclRlc3RzIiwiaW5pdGlhbGl6ZSIsImFsbENvbnRyb2xsZXJzIiwiY29udHJvbGxlcnMiLCJnZXRDb250cm9sbGVycyIsImxvZ2dlckNvbnRyb2xsZXIiLCJkYXRhYmFzZUNvbnRyb2xsZXIiLCJob29rc0NvbnRyb2xsZXIiLCJjb25maWciLCJDb25maWciLCJwdXQiLCJPYmplY3QiLCJhc3NpZ24iLCJsb2dnaW5nIiwic2V0TG9nZ2VyIiwiZGJJbml0UHJvbWlzZSIsInBlcmZvcm1Jbml0aWFsaXphdGlvbiIsImxvYWQiLCJwcm9jZXNzIiwiZW52IiwiVEVTVElORyIsInJlc29sdmUiLCJjd2QiLCJhcHAiLCJfYXBwIiwiaGFuZGxlU2h1dGRvd24iLCJhZGFwdGVyIiwibWF4VXBsb2FkU2l6ZSIsImFwaSIsInVzZSIsImFsbG93Q3Jvc3NEb21haW4iLCJGaWxlc1JvdXRlciIsImV4cHJlc3NSb3V0ZXIiLCJyZXEiLCJyZXMiLCJqc29uIiwic3RhdHVzIiwidXJsZW5jb2RlZCIsImV4dGVuZGVkIiwiUHVibGljQVBJUm91dGVyIiwidHlwZSIsImxpbWl0IiwiYWxsb3dNZXRob2RPdmVycmlkZSIsImhhbmRsZVBhcnNlSGVhZGVycyIsImFwcFJvdXRlciIsInByb21pc2VSb3V0ZXIiLCJoYW5kbGVQYXJzZUVycm9ycyIsIm9uIiwiZXJyIiwiY29kZSIsInN0ZGVyciIsIndyaXRlIiwicG9ydCIsImV4aXQiLCJ2ZXJpZnlTZXJ2ZXJVcmwiLCJQQVJTRV9TRVJWRVJfRU5BQkxFX0VYUEVSSU1FTlRBTF9ESVJFQ1RfQUNDRVNTIiwiQ29yZU1hbmFnZXIiLCJzZXRSRVNUQ29udHJvbGxlciIsInJvdXRlcnMiLCJDbGFzc2VzUm91dGVyIiwiVXNlcnNSb3V0ZXIiLCJTZXNzaW9uc1JvdXRlciIsIlJvbGVzUm91dGVyIiwiQW5hbHl0aWNzUm91dGVyIiwiSW5zdGFsbGF0aW9uc1JvdXRlciIsIkZ1bmN0aW9uc1JvdXRlciIsIlNjaGVtYXNSb3V0ZXIiLCJQdXNoUm91dGVyIiwiTG9nc1JvdXRlciIsIklBUFZhbGlkYXRpb25Sb3V0ZXIiLCJGZWF0dXJlc1JvdXRlciIsIkdsb2JhbENvbmZpZ1JvdXRlciIsIlB1cmdlUm91dGVyIiwiSG9va3NSb3V0ZXIiLCJDbG91ZENvZGVSb3V0ZXIiLCJBdWRpZW5jZXNSb3V0ZXIiLCJBZ2dyZWdhdGVSb3V0ZXIiLCJFeHBvcnRSb3V0ZXIiLCJyb3V0ZXMiLCJyZWR1Y2UiLCJtZW1vIiwicm91dGVyIiwiY29uY2F0IiwiUHJvbWlzZVJvdXRlciIsIm1vdW50T250byIsInN0YXJ0IiwiY2FsbGJhY2siLCJtaWRkbGV3YXJlIiwibW91bnRQYXRoIiwic2VydmVyIiwibGlzdGVuIiwiaG9zdCIsInN0YXJ0TGl2ZVF1ZXJ5U2VydmVyIiwibGl2ZVF1ZXJ5U2VydmVyT3B0aW9ucyIsImxpdmVRdWVyeVNlcnZlciIsImNyZWF0ZUxpdmVRdWVyeVNlcnZlciIsImNvbmZpZ3VyZUxpc3RlbmVycyIsImV4cHJlc3NBcHAiLCJwYXJzZVNlcnZlciIsImh0dHBTZXJ2ZXIiLCJjcmVhdGVTZXJ2ZXIiLCJQYXJzZUxpdmVRdWVyeVNlcnZlciIsInJlcXVlc3QiLCJ1cmwiLCJyZXBsYWNlIiwiY2F0Y2giLCJyZXNwb25zZSIsInRoZW4iLCJkYXRhIiwiY29uc29sZSIsIndhcm4iLCJQYXJzZUNsb3VkIiwiQ2xvdWQiLCJnbG9iYWwiLCJrZXlzIiwiZGVmYXVsdHMiLCJmb3JFYWNoIiwia2V5IiwiaGFzT3duUHJvcGVydHkiLCJ1c2VyU2Vuc2l0aXZlRmllbGRzIiwiQXJyYXkiLCJmcm9tIiwiU2V0IiwibWFzdGVyS2V5SXBzIiwic29ja2V0cyIsInNvY2tldCIsInNvY2tldElkIiwicmVtb3RlQWRkcmVzcyIsInJlbW90ZVBvcnQiLCJkZXN0cm95QWxpdmVDb25uZWN0aW9ucyIsImRlc3Ryb3kiLCJlIiwic3Rkb3V0IiwiY2xvc2UiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFTQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFFQTs7QUFDQTs7Ozs7O0FBdkNBO0FBRUEsSUFBSUEsS0FBSyxHQUFHQyxPQUFPLENBQUMsU0FBRCxDQUFuQjtBQUFBLElBQ0VDLFVBQVUsR0FBR0QsT0FBTyxDQUFDLGFBQUQsQ0FEdEI7QUFBQSxJQUVFRSxPQUFPLEdBQUdGLE9BQU8sQ0FBQyxTQUFELENBRm5CO0FBQUEsSUFHRUcsV0FBVyxHQUFHSCxPQUFPLENBQUMsZUFBRCxDQUh2QjtBQUFBLElBSUVJLEtBQUssR0FBR0osT0FBTyxDQUFDLFlBQUQsQ0FBUCxDQUFzQkksS0FKaEM7QUFBQSxJQUtFQyxJQUFJLEdBQUdMLE9BQU8sQ0FBQyxNQUFELENBTGhCOztBQXNDQTtBQUNBTSxhQUFhLEcsQ0FFYjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1DLFdBQU4sQ0FBa0I7QUFDaEI7Ozs7QUFJQUMsRUFBQUEsV0FBVyxDQUFDQyxPQUFELEVBQThCO0FBQ3ZD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VCxNQUEzQjtBQUNBLFFBQU1tQyxPQUFPLEdBQUcsRUFBaEI7QUFDQTs7O0FBRUFuQyxFQUFBQSxNQUFNLENBQUMxQyxFQUFQLENBQVUsWUFBVixFQUF3QjhFLE1BQU0sSUFBSTtBQUNoQyxVQUFNQyxRQUFRLEdBQUdELE1BQU0sQ0FBQ0UsYUFBUCxHQUF1QixHQUF2QixHQUE2QkYsTUFBTSxDQUFDRyxVQUFyRDtBQUNBSixJQUFBQSxPQUFPLENBQUNFLFFBQUQsQ0FBUCxHQUFvQkQsTUFBcEI7QUFDQUEsSUFBQUEsTUFBTSxDQUFDOUUsRUFBUCxDQUFVLE9BQVYsRUFBbUIsTUFBTTtBQUN2QixhQUFPNkUsT0FBTyxDQUFDRSxRQUFELENBQWQ7QUFDRCxLQUZEO0FBR0QsR0FORDs7QUFRQSxRQUFNRyx1QkFBdUIsR0FBRyxZQUFXO0FBQ3pDLFNBQUssTUFBTUgsUUFBWCxJQUF1QkYsT0FBdkIsRUFBZ0M7QUFDOUIsVUFBSTtBQUNGQSxRQUFBQSxPQUFPLENBQUNFLFFBQUQsQ0FBUCxDQUFrQkksT0FBbEI7QUFDRCxPQUZELENBRUUsT0FBT0MsQ0FBUCxFQUFVO0FBQ1Y7QUFDRDtBQUNGO0FBQ0YsR0FSRDs7QUFVQSxRQUFNMUcsY0FBYyxHQUFHLFlBQVc7QUFDaENQLElBQUFBLE9BQU8sQ0FBQ2tILE1BQVIsQ0FBZWpGLEtBQWYsQ0FBcUIsNkNBQXJCO0FBQ0E4RSxJQUFBQSx1QkFBdUI7QUFDdkJ4QyxJQUFBQSxNQUFNLENBQUM0QyxLQUFQO0FBQ0FuQyxJQUFBQSxXQUFXLENBQUN6RSxjQUFaO0FBQ0QsR0FMRDs7QUFNQVAsRUFBQUEsT0FBTyxDQUFDNkIsRUFBUixDQUFXLFNBQVgsRUFBc0J0QixjQUF0QjtBQUNBUCxFQUFBQSxPQUFPLENBQUM2QixFQUFSLENBQVcsUUFBWCxFQUFxQnRCLGNBQXJCO0FBQ0Q7O2VBRWNsQyxXIiwic291cmNlc0NvbnRlbnQiOlsiLy8gUGFyc2VTZXJ2ZXIgLSBvcGVuLXNvdXJjZSBjb21wYXRpYmxlIEFQSSBTZXJ2ZXIgZm9yIFBhcnNlIGFwcHNcblxudmFyIGJhdGNoID0gcmVxdWlyZSgnLi9iYXRjaCcpLFxuICBib2R5UGFyc2VyID0gcmVxdWlyZSgnYm9keS1wYXJzZXInKSxcbiAgZXhwcmVzcyA9IHJlcXVpcmUoJ2V4cHJlc3MnKSxcbiAgbWlkZGxld2FyZXMgPSByZXF1aXJlKCcuL21pZGRsZXdhcmVzJyksXG4gIFBhcnNlID0gcmVxdWlyZSgncGFyc2Uvbm9kZScpLlBhcnNlLFxuICBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xuXG5pbXBvcnQgeyBQYXJzZVNlcnZlck9wdGlvbnMsIExpdmVRdWVyeVNlcnZlck9wdGlvbnMgfSBmcm9tICcuL09wdGlvbnMnO1xuaW1wb3J0IGRlZmF1bHRzIGZyb20gJy4vZGVmYXVsdHMnO1xuaW1wb3J0ICogYXMgbG9nZ2luZyBmcm9tICcuL2xvZ2dlcic7XG5pbXBvcnQgQ29uZmlnIGZyb20gJy4vQ29uZmlnJztcbmltcG9ydCBQcm9taXNlUm91dGVyIGZyb20gJy4vUHJvbWlzZVJvdXRlcic7XG5pbXBvcnQgcmVxdWlyZWRQYXJhbWV0ZXIgZnJvbSAnLi9yZXF1aXJlZFBhcmFtZXRlcic7XG5pbXBvcnQgeyBBbmFseXRpY3NSb3V0ZXIgfSBmcm9tICcuL1JvdXRlcnMvQW5hbHl0aWNzUm91dGVyJztcbmltcG9ydCB7IENsYXNzZXNSb3V0ZXIgfSBmcm9tICcuL1JvdXRlcnMvQ2xhc3Nlc1JvdXRlcic7XG5pbXBvcnQgeyBGZWF0dXJlc1JvdXRlciB9IGZyb20gJy4vUm91dGVycy9GZWF0dXJlc1JvdXRlcic7XG5pbXBvcnQgeyBGaWxlc1JvdXRlciB9IGZyb20gJy4vUm91dGVycy9GaWxlc1JvdXRlcic7XG5pbXBvcnQgeyBGdW5jdGlvbnNSb3V0ZXIgfSBmcm9tICcuL1JvdXRlcnMvRnVuY3Rpb25zUm91dGVyJztcbmltcG9ydCB7IEdsb2JhbENvbmZpZ1JvdXRlciB9IGZyb20gJy4vUm91dGVycy9HbG9iYWxDb25maWdSb3V0ZXInO1xuaW1wb3J0IHsgSG9va3NSb3V0ZXIgfSBmcm9tICcuL1JvdXRlcnMvSG9va3NSb3V0ZXInO1xuaW1wb3J0IHsgSUFQVmFsaWRhdGlvblJvdXRlciB9IGZyb20gJy4vUm91dGVycy9JQVBWYWxpZGF0aW9uUm91dGVyJztcbmltcG9ydCB7IEluc3RhbGxhdGlvbnNSb3V0ZXIgfSBmcm9tICcuL1JvdXRlcnMvSW5zdGFsbGF0aW9uc1JvdXRlcic7XG5pbXBvcnQgeyBMb2dzUm91dGVyIH0gZnJvbSAnLi9Sb3V0ZXJzL0xvZ3NSb3V0ZXInO1xuaW1wb3J0IHsgUGFyc2VMaXZlUXVlcnlTZXJ2ZXIgfSBmcm9tICcuL0xpdmVRdWVyeS9QYXJzZUxpdmVRdWVyeVNlcnZlcic7XG5pbXBvcnQgeyBQdWJsaWNBUElSb3V0ZXIgfSBmcm9tICcuL1JvdXRlcnMvUHVibGljQVBJUm91dGVyJztcbmltcG9ydCB7IFB1c2hSb3V0ZXIgfSBmcm9tICcuL1JvdXRlcnMvUHVzaFJvdXRlcic7XG5pbXBvcnQgeyBDbG91ZENvZGVSb3V0ZXIgfSBmcm9tICcuL1JvdXRlcnMvQ2xvdWRDb2RlUm91dGVyJztcbmltcG9ydCB7IFJvbGVzUm91dGVyIH0gZnJvbSAnLi9Sb3V0ZXJzL1JvbGVzUm91dGVyJztcbmltcG9ydCB7IFNjaGVtYXNSb3V0ZXIgfSBmcm9tICcuL1JvdXRlcnMvU2NoZW1hc1JvdXRlcic7XG5pbXBvcnQgeyBTZXNzaW9uc1JvdXRlciB9IGZyb20gJy4vUm91dGVycy9TZXNzaW9uc1JvdXRlcic7XG5pbXBvcnQgeyBVc2Vyc1JvdXRlciB9IGZyb20gJy4vUm91dGVycy9Vc2Vyc1JvdXRlcic7XG5pbXBvcnQgeyBQdXJnZVJvdXRlciB9IGZyb20gJy4vUm91dGVycy9QdXJnZVJvdXRlcic7XG5pbXBvcnQgeyBBdWRpZW5jZXNSb3V0ZXIgfSBmcm9tICcuL1JvdXRlcnMvQXVkaWVuY2VzUm91dGVyJztcbmltcG9ydCB7IEFnZ3JlZ2F0ZVJvdXRlciB9IGZyb20gJy4vUm91dGVycy9BZ2dyZWdhdGVSb3V0ZXInO1xuaW1wb3J0IHsgRXhwb3J0Um91dGVyIH0gZnJvbSAnLi9Sb3V0ZXJzL0V4cG9ydFJvdXRlcic7XG5cbmltcG9ydCB7IFBhcnNlU2VydmVyUkVTVENvbnRyb2xsZXIgfSBmcm9tICcuL1BhcnNlU2VydmVyUkVTVENvbnRyb2xsZXInO1xuaW1wb3J0ICogYXMgY29udHJvbGxlcnMgZnJvbSAnLi9Db250cm9sbGVycyc7XG4vLyBNdXRhdGUgdGhlIFBhcnNlIG9iamVjdCB0byBhZGQgdGhlIENsb3VkIENvZGUgaGFuZGxlcnNcbmFkZFBhcnNlQ2xvdWQoKTtcblxuLy8gUGFyc2VTZXJ2ZXIgd29ya3MgbGlrZSBhIGNvbnN0cnVjdG9yIG9mIGFuIGV4cHJlc3MgYXBwLlxuLy8gVGhlIGFyZ3MgdGhhdCB3ZSB1bmRlcnN0YW5kIGFyZTpcbi8vIFwiYW5hbHl0aWNzQWRhcHRlclwiOiBhbiBhZGFwdGVyIGNsYXNzIGZvciBhbmFseXRpY3Ncbi8vIFwiZmlsZXNBZGFwdGVyXCI6IGEgY2xhc3MgbGlrZSBHcmlkRlNCdWNrZXRBZGFwdGVyIHByb3ZpZGluZyBjcmVhdGUsIGdldCxcbi8vICAgICAgICAgICAgICAgICBhbmQgZGVsZXRlXG4vLyBcImxvZ2dlckFkYXB0ZXJcIjogYSBjbGFzcyBsaWtlIFdpbnN0b25Mb2dnZXJBZGFwdGVyIHByb3ZpZGluZyBpbmZvLCBlcnJvcixcbi8vICAgICAgICAgICAgICAgICBhbmQgcXVlcnlcbi8vIFwianNvbkxvZ3NcIjogbG9nIGFzIHN0cnVjdHVyZWQgSlNPTiBvYmplY3RzXG4vLyBcImRhdGFiYXNlVVJJXCI6IGEgdXJpIGxpa2UgbW9uZ29kYjovL2xvY2FsaG9zdDoyNzAxNy9kYm5hbWUgdG8gdGVsbCB1c1xuLy8gICAgICAgICAgd2hhdCBkYXRhYmFzZSB0aGlzIFBhcnNlIEFQSSBjb25uZWN0cyB0by5cbi8vIFwiY2xvdWRcIjogcmVsYXRpdmUgbG9jYXRpb24gdG8gY2xvdWQgY29kZSB0byByZXF1aXJlLCBvciBhIGZ1bmN0aW9uXG4vLyAgICAgICAgICB0aGF0IGlzIGdpdmVuIGFuIGluc3RhbmNlIG9mIFBhcnNlIGFzIGEgcGFyYW1ldGVyLiAgVXNlIHRoaXMgaW5zdGFuY2Ugb2YgUGFyc2Vcbi8vICAgICAgICAgIHRvIHJlZ2lzdGVyIHlvdXIgY2xvdWQgY29kZSBob29rcyBhbmQgZnVuY3Rpb25zLlxuLy8gXCJhcHBJZFwiOiB0aGUgYXBwbGljYXRpb24gaWQgdG8gaG9zdFxuLy8gXCJtYXN0ZXJLZXlcIjogdGhlIG1hc3RlciBrZXkgZm9yIHJlcXVlc3RzIHRvIHRoaXMgYXBwXG4vLyBcImNvbGxlY3Rpb25QcmVmaXhcIjogb3B0aW9uYWwgcHJlZml4IGZvciBkYXRhYmFzZSBjb2xsZWN0aW9uIG5hbWVzXG4vLyBcImZpbGVLZXlcIjogb3B0aW9uYWwga2V5IGZyb20gUGFyc2UgZGFzaGJvYXJkIGZvciBzdXBwb3J0aW5nIG9sZGVyIGZpbGVzXG4vLyAgICAgICAgICAgIGhvc3RlZCBieSBQYXJzZVxuLy8gXCJjbGllbnRLZXlcIjogb3B0aW9uYWwga2V5IGZyb20gUGFyc2UgZGFzaGJvYXJkXG4vLyBcImRvdE5ldEtleVwiOiBvcHRpb25hbCBrZXkgZnJvbSBQYXJzZSBkYXNoYm9hcmRcbi8vIFwicmVzdEFQSUtleVwiOiBvcHRpb25hbCBrZXkgZnJvbSBQYXJzZSBkYXNoYm9hcmRcbi8vIFwid2ViaG9va0tleVwiOiBvcHRpb25hbCBrZXkgZnJvbSBQYXJzZSBkYXNoYm9hcmRcbi8vIFwiamF2YXNjcmlwdEtleVwiOiBvcHRpb25hbCBrZXkgZnJvbSBQYXJzZSBkYXNoYm9hcmRcbi8vIFwicHVzaFwiOiBvcHRpb25hbCBrZXkgZnJvbSBjb25maWd1cmUgcHVzaFxuLy8gXCJzZXNzaW9uTGVuZ3RoXCI6IG9wdGlvbmFsIGxlbmd0aCBpbiBzZWNvbmRzIGZvciBob3cgbG9uZyBTZXNzaW9ucyBzaG91bGQgYmUgdmFsaWQgZm9yXG4vLyBcIm1heExpbWl0XCI6IG9wdGlvbmFsIHVwcGVyIGJvdW5kIGZvciB3aGF0IGNhbiBiZSBzcGVjaWZpZWQgZm9yIHRoZSAnbGltaXQnIHBhcmFtZXRlciBvbiBxdWVyaWVzXG5cbmNsYXNzIFBhcnNlU2VydmVyIHtcbiAgLyoqXG4gICAqIEBjb25zdHJ1Y3RvclxuICAgKiBAcGFyYW0ge1BhcnNlU2VydmVyT3B0aW9uc30gb3B0aW9ucyB0aGUgcGFyc2Ugc2VydmVyIGluaXRpYWxpemF0aW9uIG9wdGlvbnNcbiAgICovXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IFBhcnNlU2VydmVyT3B0aW9ucykge1xuICAgIGluamVjdERlZmF1bHRzKG9wdGlvbnMpO1xuICAgIGNvbnN0IHtcbiAgICAgIGFwcElkID0gcmVxdWlyZWRQYXJhbWV0ZXIoJ1lvdSBtdXN0IHByb3ZpZGUgYW4gYXBwSWQhJyksXG4gICAgICBtYXN0ZXJLZXkgPSByZXF1aXJlZFBhcmFtZXRlcignWW91IG11c3QgcHJvdmlkZSBhIG1hc3RlcktleSEnKSxcbiAgICAgIGNsb3VkLFxuICAgICAgamF2YXNjcmlwdEtleSxcbiAgICAgIHNlcnZlclVSTCA9IHJlcXVpcmVkUGFyYW1ldGVyKCdZb3UgbXVzdCBwcm92aWRlIGEgc2VydmVyVVJMIScpLFxuICAgICAgX19pbmRleEJ1aWxkQ29tcGxldGlvbkNhbGxiYWNrRm9yVGVzdHMgPSAoKSA9PiB7fSxcbiAgICB9ID0gb3B0aW9ucztcbiAgICAvLyBJbml0aWFsaXplIHRoZSBub2RlIGNsaWVudCBTREsgYXV0b21hdGljYWxseVxuICAgIFBhcnNlLmluaXRpYWxpemUoYXBwSWQsIGphdmFzY3JpcHRLZXkgfHwgJ3VudXNlZCcsIG1hc3RlcktleSk7XG4gICAgUGFyc2Uuc2VydmVyVVJMID0gc2VydmVyVVJMO1xuXG4gICAgY29uc3QgYWxsQ29udHJvbGxlcnMgPSBjb250cm9sbGVycy5nZXRDb250cm9sbGVycyhvcHRpb25zKTtcblxuICAgIGNvbnN0IHtcbiAgICAgIGxvZ2dlckNvbnRyb2xsZXIsXG4gICAgICBkYXRhYmFzZUNvbnRyb2xsZXIsXG4gICAgICBob29rc0NvbnRyb2xsZXIsXG4gICAgfSA9IGFsbENvbnRyb2xsZXJzO1xuICAgIHRoaXMuY29uZmlnID0gQ29uZmlnLnB1dChPYmplY3QuYXNzaWduKHt9LCBvcHRpb25zLCBhbGxDb250cm9sbGVycykpO1xuXG4gICAgbG9nZ2luZy5zZXRMb2dnZXIobG9nZ2VyQ29udHJvbGxlcik7XG4gICAgY29uc3QgZGJJbml0UHJvbWlzZSA9IGRhdGFiYXNlQ29udHJvbGxlci5wZXJmb3JtSW5pdGlhbGl6YXRpb24oKTtcbiAgICBob29rc0NvbnRyb2xsZXIubG9hZCgpO1xuXG4gICAgLy8gTm90ZTogVGVzdHMgd2lsbCBzdGFydCB0byBmYWlsIGlmIGFueSB2YWxpZGF0aW9uIGhhcHBlbnMgYWZ0ZXIgdGhpcyBpcyBjYWxsZWQuXG4gICAgaWYgKHByb2Nlc3MuZW52LlRFU1RJTkcpIHtcbiAgICAgIF9faW5kZXhCdWlsZENvbXBsZXRpb25DYWxsYmFja0ZvclRlc3RzKGRiSW5pdFByb21pc2UpO1xuICAgIH1cblxuICAgIGlmIChjbG91ZCkge1xuICAgICAgYWRkUGFyc2VDbG91ZCgpO1xuICAgICAgaWYgKHR5cGVvZiBjbG91ZCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBjbG91ZChQYXJzZSk7XG4gICAgICB9IGVsc2UgaWYgKHR5cGVvZiBjbG91ZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgcmVxdWlyZShwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgY2xvdWQpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IFwiYXJndW1lbnQgJ2Nsb3VkJyBtdXN0IGVpdGhlciBiZSBhIHN0cmluZyBvciBhIGZ1bmN0aW9uXCI7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZ2V0IGFwcCgpIHtcbiAgICBpZiAoIXRoaXMuX2FwcCkge1xuICAgICAgdGhpcy5fYXBwID0gUGFyc2VTZXJ2ZXIuYXBwKHRoaXMuY29uZmlnKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuX2FwcDtcbiAgfVxuXG4gIGhhbmRsZVNodXRkb3duKCkge1xuICAgIGNvbnN0IHsgYWRhcHRlciB9ID0gdGhpcy5jb25maWcuZGF0YWJhc2VDb250cm9sbGVyO1xuICAgIGlmIChhZGFwdGVyICYmIHR5cGVvZiBhZGFwdGVyLmhhbmRsZVNodXRkb3duID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBhZGFwdGVyLmhhbmRsZVNodXRkb3duKCk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEBzdGF0aWNcbiAgICogQ3JlYXRlIGFuIGV4cHJlc3MgYXBwIGZvciB0aGUgcGFyc2Ugc2VydmVyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIGxldCB5b3Ugc3BlY2lmeSB0aGUgbWF4VXBsb2FkU2l6ZSB3aGVuIGNyZWF0aW5nIHRoZSBleHByZXNzIGFwcCAgKi9cbiAgc3RhdGljIGFwcCh7IG1heFVwbG9hZFNpemUgPSAnMjBtYicsIGFwcElkIH0pIHtcbiAgICAvLyBUaGlzIGFwcCBzZXJ2ZXMgdGhlIFBhcnNlIEFQSSBkaXJlY3RseS5cbiAgICAvLyBJdCdzIHRoZSBlcXVpdmFsZW50IG9mIGh0dHBzOi8vYXBpLnBhcnNlLmNvbS8xIGluIHRoZSBob3N0ZWQgUGFyc2UgQVBJLlxuICAgIHZhciBhcGkgPSBleHByZXNzKCk7XG4gICAgLy9hcGkudXNlKFwiL2FwcHNcIiwgZXhwcmVzcy5zdGF0aWMoX19kaXJuYW1lICsgXCIvcHVibGljXCIpKTtcbiAgICAvLyBGaWxlIGhhbmRsaW5nIG5lZWRzIHRvIGJlIGJlZm9yZSBkZWZhdWx0IG1pZGRsZXdhcmVzIGFyZSBhcHBsaWVkXG4gICAgYXBpLnVzZShcbiAgICAgICcvJyxcbiAgICAgIG1pZGRsZXdhcmVzLmFsbG93Q3Jvc3NEb21haW4sXG4gICAgICBuZXcgRmlsZXNSb3V0ZXIoKS5leHByZXNzUm91dGVyKHtcbiAgICAgICAgbWF4VXBsb2FkU2l6ZTogbWF4VXBsb2FkU2l6ZSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIGFwaS51c2UoJy9oZWFsdGgnLCBmdW5jdGlvbihyZXEsIHJlcykge1xuICAgICAgcmVzLmpzb24oe1xuICAgICAgICBzdGF0dXM6ICdvaycsXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGFwaS51c2UoXG4gICAgICAnLycsXG4gICAgICBib2R5UGFyc2VyLnVybGVuY29kZWQoeyBleHRlbmRlZDogZmFsc2UgfSksXG4gICAgICBuZXcgUHVibGljQVBJUm91dGVyKCkuZXhwcmVzc1JvdXRlcigpXG4gICAgKTtcblxuICAgIGFwaS51c2UoYm9keVBhcnNlci5qc29uKHsgdHlwZTogJyovKicsIGxpbWl0OiBtYXhVcGxvYWRTaXplIH0pKTtcbiAgICBhcGkudXNlKG1pZGRsZXdhcmVzLmFsbG93Q3Jvc3NEb21haW4pO1xuICAgIGFwaS51c2UobWlkZGxld2FyZXMuYWxsb3dNZXRob2RPdmVycmlkZSk7XG4gICAgYXBpLnVzZShtaWRkbGV3YXJlcy5oYW5kbGVQYXJzZUhlYWRlcnMpO1xuXG4gICAgY29uc3QgYXBwUm91dGVyID0gUGFyc2VTZXJ2ZXIucHJvbWlzZVJvdXRlcih7IGFwcElkIH0pO1xuICAgIGFwaS51c2UoYXBwUm91dGVyLmV4cHJlc3NSb3V0ZXIoKSk7XG5cbiAgICBhcGkudXNlKG1pZGRsZXdhcmVzLmhhbmRsZVBhcnNlRXJyb3JzKTtcblxuICAgIC8vIHJ1biB0aGUgZm9sbG93aW5nIHdoZW4gbm90IHRlc3RpbmdcbiAgICBpZiAoIXByb2Nlc3MuZW52LlRFU1RJTkcpIHtcbiAgICAgIC8vVGhpcyBjYXVzZXMgdGVzdHMgdG8gc3BldyBzb21lIHVzZWxlc3Mgd2FybmluZ3MsIHNvIGRpc2FibGUgaW4gdGVzdFxuICAgICAgLyogaXN0YW5idWwgaWdub3JlIG5leHQgKi9cbiAgICAgIHByb2Nlc3Mub24oJ3VuY2F1Z2h0RXhjZXB0aW9uJywgZXJyID0+IHtcbiAgICAgICAgaWYgKGVyci5jb2RlID09PSAnRUFERFJJTlVTRScpIHtcbiAgICAgICAgICAvLyB1c2VyLWZyaWVuZGx5IG1lc3NhZ2UgZm9yIHRoaXMgY29tbW9uIGVycm9yXG4gICAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoXG4gICAgICAgICAgICBgVW5hYmxlIHRvIGxpc3RlbiBvbiBwb3J0ICR7ZXJyLnBvcnR9LiBUaGUgcG9ydCBpcyBhbHJlYWR5IGluIHVzZS5gXG4gICAgICAgICAgKTtcbiAgICAgICAgICBwcm9jZXNzLmV4aXQoMCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIC8vIHZlcmlmeSB0aGUgc2VydmVyIHVybCBhZnRlciBhICdtb3VudCcgZXZlbnQgaXMgcmVjZWl2ZWRcbiAgICAgIC8qIGlzdGFuYnVsIGlnbm9yZSBuZXh0ICovXG4gICAgICBhcGkub24oJ21vdW50JywgZnVuY3Rpb24oKSB7XG4gICAgICAgIFBhcnNlU2VydmVyLnZlcmlmeVNlcnZlclVybCgpO1xuICAgICAgfSk7XG4gICAgfVxuICAgIGlmIChwcm9jZXNzLmVudi5QQVJTRV9TRVJWRVJfRU5BQkxFX0VYUEVSSU1FTlRBTF9ESVJFQ1RfQUNDRVNTID09PSAnMScpIHtcbiAgICAgIFBhcnNlLkNvcmVNYW5hZ2VyLnNldFJFU1RDb250cm9sbGVyKFxuICAgICAgICBQYXJzZVNlcnZlclJFU1RDb250cm9sbGVyKGFwcElkLCBhcHBSb3V0ZXIpXG4gICAgICApO1xuICAgIH1cbiAgICByZXR1cm4gYXBpO1xuICB9XG5cbiAgc3RhdGljIHByb21pc2VSb3V0ZXIoeyBhcHBJZCB9KSB7XG4gICAgY29uc3Qgcm91dGVycyA9IFtcbiAgICAgIG5ldyBDbGFzc2VzUm91dGVyKCksXG4gICAgICBuZXcgVXNlcnNSb3V0ZXIoKSxcbiAgICAgIG5ldyBTZXNzaW9uc1JvdXRlcigpLFxuICAgICAgbmV3IFJvbGVzUm91dGVyKCksXG4gICAgICBuZXcgQW5hbHl0aWNzUm91dGVyKCksXG4gICAgICBuZXcgSW5zdGFsbGF0aW9uc1JvdXRlcigpLFxuICAgICAgbmV3IEZ1bmN0aW9uc1JvdXRlcigpLFxuICAgICAgbmV3IFNjaGVtYXNSb3V0ZXIoKSxcbiAgICAgIG5ldyBQdXNoUm91dGVyKCksXG4gICAgICBuZXcgTG9nc1JvdXRlcigpLFxuICAgICAgbmV3IElBUFZhbGlkYXRpb25Sb3V0ZXIoKSxcbiAgICAgIG5ldyBGZWF0dXJlc1JvdXRlcigpLFxuICAgICAgbmV3IEdsb2JhbENvbmZpZ1JvdXRlcigpLFxuICAgICAgbmV3IFB1cmdlUm91dGVyKCksXG4gICAgICBuZXcgSG9va3NSb3V0ZXIoKSxcbiAgICAgIG5ldyBDbG91ZENvZGVSb3V0ZXIoKSxcbiAgICAgIG5ldyBBdWRpZW5jZXNSb3V0ZXIoKSxcbiAgICAgIG5ldyBBZ2dyZWdhdGVSb3V0ZXIoKSxcbiAgICAgIG5ldyBFeHBvcnRSb3V0ZXIoKSxcbiAgICBdO1xuXG4gICAgY29uc3Qgcm91dGVzID0gcm91dGVycy5yZWR1Y2UoKG1lbW8sIHJvdXRlcikgPT4ge1xuICAgICAgcmV0dXJuIG1lbW8uY29uY2F0KHJvdXRlci5yb3V0ZXMpO1xuICAgIH0sIFtdKTtcblxuICAgIGNvbnN0IGFwcFJvdXRlciA9IG5ldyBQcm9taXNlUm91dGVyKHJvdXRlcywgYXBwSWQpO1xuXG4gICAgYmF0Y2gubW91bnRPbnRvKGFwcFJvdXRlcik7XG4gICAgcmV0dXJuIGFwcFJvdXRlcjtcbiAgfVxuXG4gIC8qKlxuICAgKiBzdGFydHMgdGhlIHBhcnNlIHNlcnZlcidzIGV4cHJlc3MgYXBwXG4gICAqIEBwYXJhbSB7UGFyc2VTZXJ2ZXJPcHRpb25zfSBvcHRpb25zIHRvIHVzZSB0byBzdGFydCB0aGUgc2VydmVyXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrIGNhbGxlZCB3aGVuIHRoZSBzZXJ2ZXIgaGFzIHN0YXJ0ZWRcbiAgICogQHJldHVybnMge1BhcnNlU2VydmVyfSB0aGUgcGFyc2Ugc2VydmVyIGluc3RhbmNlXG4gICAqL1xuICBzdGFydChvcHRpb25zOiBQYXJzZVNlcnZlck9wdGlvbnMsIGNhbGxiYWNrOiA/KCkgPT4gdm9pZCkge1xuICAgIGNvbnN0IGFwcCA9IGV4cHJlc3MoKTtcbiAgICBpZiAob3B0aW9ucy5taWRkbGV3YXJlKSB7XG4gICAgICBsZXQgbWlkZGxld2FyZTtcbiAgICAgIGlmICh0eXBlb2Ygb3B0aW9ucy5taWRkbGV3YXJlID09ICdzdHJpbmcnKSB7XG4gICAgICAgIG1pZGRsZXdhcmUgPSByZXF1aXJlKHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCBvcHRpb25zLm1pZGRsZXdhcmUpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG1pZGRsZXdhcmUgPSBvcHRpb25zLm1pZGRsZXdhcmU7IC8vIHVzZSBhcy1pcyBsZXQgZXhwcmVzcyBmYWlsXG4gICAgICB9XG4gICAgICBhcHAudXNlKG1pZGRsZXdhcmUpO1xuICAgIH1cblxuICAgIGFwcC51c2Uob3B0aW9ucy5tb3VudFBhdGgsIHRoaXMuYXBwKTtcbiAgICBjb25zdCBzZXJ2ZXIgPSBhcHAubGlzdGVuKG9wdGlvbnMucG9ydCwgb3B0aW9ucy5ob3N0LCBjYWxsYmFjayk7XG4gICAgdGhpcy5zZXJ2ZXIgPSBzZXJ2ZXI7XG5cbiAgICBpZiAob3B0aW9ucy5zdGFydExpdmVRdWVyeVNlcnZlciB8fCBvcHRpb25zLmxpdmVRdWVyeVNlcnZlck9wdGlvbnMpIHtcbiAgICAgIHRoaXMubGl2ZVF1ZXJ5U2VydmVyID0gUGFyc2VTZXJ2ZXIuY3JlYXRlTGl2ZVF1ZXJ5U2VydmVyKFxuICAgICAgICBzZXJ2ZXIsXG4gICAgICAgIG9wdGlvbnMubGl2ZVF1ZXJ5U2VydmVyT3B0aW9uc1xuICAgICAgKTtcbiAgICB9XG4gICAgLyogaXN0YW5idWwgaWdub3JlIG5leHQgKi9cbiAgICBpZiAoIXByb2Nlc3MuZW52LlRFU1RJTkcpIHtcbiAgICAgIGNvbmZpZ3VyZUxpc3RlbmVycyh0aGlzKTtcbiAgICB9XG4gICAgdGhpcy5leHByZXNzQXBwID0gYXBwO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBuZXcgUGFyc2VTZXJ2ZXIgYW5kIHN0YXJ0cyBpdC5cbiAgICogQHBhcmFtIHtQYXJzZVNlcnZlck9wdGlvbnN9IG9wdGlvbnMgdXNlZCB0byBzdGFydCB0aGUgc2VydmVyXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrIGNhbGxlZCB3aGVuIHRoZSBzZXJ2ZXIgaGFzIHN0YXJ0ZWRcbiAgICogQHJldHVybnMge1BhcnNlU2VydmVyfSB0aGUgcGFyc2Ugc2VydmVyIGluc3RhbmNlXG4gICAqL1xuICBzdGF0aWMgc3RhcnQob3B0aW9uczogUGFyc2VTZXJ2ZXJPcHRpb25zLCBjYWxsYmFjazogPygpID0+IHZvaWQpIHtcbiAgICBjb25zdCBwYXJzZVNlcnZlciA9IG5ldyBQYXJzZVNlcnZlcihvcHRpb25zKTtcbiAgICByZXR1cm4gcGFyc2VTZXJ2ZXIuc3RhcnQob3B0aW9ucywgY2FsbGJhY2spO1xuICB9XG5cbiAgLyoqXG4gICAqIEhlbHBlciBtZXRob2QgdG8gY3JlYXRlIGEgbGl2ZVF1ZXJ5IHNlcnZlclxuICAgKiBAc3RhdGljXG4gICAqIEBwYXJhbSB7U2VydmVyfSBodHRwU2VydmVyIGFuIG9wdGlvbmFsIGh0dHAgc2VydmVyIHRvIHBhc3NcbiAgICogQHBhcmFtIHtMaXZlUXVlcnlTZXJ2ZXJPcHRpb25zfSBjb25maWcgb3B0aW9ucyBmb3QgaGUgbGl2ZVF1ZXJ5U2VydmVyXG4gICAqIEByZXR1cm5zIHtQYXJzZUxpdmVRdWVyeVNlcnZlcn0gdGhlIGxpdmUgcXVlcnkgc2VydmVyIGluc3RhbmNlXG4gICAqL1xuICBzdGF0aWMgY3JlYXRlTGl2ZVF1ZXJ5U2VydmVyKGh0dHBTZXJ2ZXIsIGNvbmZpZzogTGl2ZVF1ZXJ5U2VydmVyT3B0aW9ucykge1xuICAgIGlmICghaHR0cFNlcnZlciB8fCAoY29uZmlnICYmIGNvbmZpZy5wb3J0KSkge1xuICAgICAgdmFyIGFwcCA9IGV4cHJlc3MoKTtcbiAgICAgIGh0dHBTZXJ2ZXIgPSByZXF1aXJlKCdodHRwJykuY3JlYXRlU2VydmVyKGFwcCk7XG4gICAgICBodHRwU2VydmVyLmxpc3Rlbihjb25maWcucG9ydCk7XG4gICAgfVxuICAgIHJldHVybiBuZXcgUGFyc2VMaXZlUXVlcnlTZXJ2ZXIoaHR0cFNlcnZlciwgY29uZmlnKTtcbiAgfVxuXG4gIHN0YXRpYyB2ZXJpZnlTZXJ2ZXJVcmwoY2FsbGJhY2spIHtcbiAgICAvLyBwZXJmb3JtIGEgaGVhbHRoIGNoZWNrIG9uIHRoZSBzZXJ2ZXJVUkwgdmFsdWVcbiAgICBpZiAoUGFyc2Uuc2VydmVyVVJMKSB7XG4gICAgICBjb25zdCByZXF1ZXN0ID0gcmVxdWlyZSgnLi9yZXF1ZXN0Jyk7XG4gICAgICByZXF1ZXN0KHsgdXJsOiBQYXJzZS5zZXJ2ZXJVUkwucmVwbGFjZSgvXFwvJC8sICcnKSArICcvaGVhbHRoJyB9KVxuICAgICAgICAuY2F0Y2gocmVzcG9uc2UgPT4gcmVzcG9uc2UpXG4gICAgICAgIC50aGVuKHJlc3BvbnNlID0+IHtcbiAgICAgICAgICBjb25zdCBqc29uID0gcmVzcG9uc2UuZGF0YSB8fCBudWxsO1xuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgIHJlc3BvbnNlLnN0YXR1cyAhPT0gMjAwIHx8XG4gICAgICAgICAgICAhanNvbiB8fFxuICAgICAgICAgICAgKGpzb24gJiYganNvbi5zdGF0dXMgIT09ICdvaycpXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICAvKiBlc2xpbnQtZGlzYWJsZSBuby1jb25zb2xlICovXG4gICAgICAgICAgICBjb25zb2xlLndhcm4oXG4gICAgICAgICAgICAgIGBcXG5XQVJOSU5HLCBVbmFibGUgdG8gY29ubmVjdCB0byAnJHtQYXJzZS5zZXJ2ZXJVUkx9Jy5gICtcbiAgICAgICAgICAgICAgICBgIENsb3VkIGNvZGUgYW5kIHB1c2ggbm90aWZpY2F0aW9ucyBtYXkgYmUgdW5hdmFpbGFibGUhXFxuYFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIC8qIGVzbGludC1lbmFibGUgbm8tY29uc29sZSAqL1xuICAgICAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgICAgIGNhbGxiYWNrKGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgICAgIGNhbGxiYWNrKHRydWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGFkZFBhcnNlQ2xvdWQoKSB7XG4gIGNvbnN0IFBhcnNlQ2xvdWQgPSByZXF1aXJlKCcuL2Nsb3VkLWNvZGUvUGFyc2UuQ2xvdWQnKTtcbiAgT2JqZWN0LmFzc2lnbihQYXJzZS5DbG91ZCwgUGFyc2VDbG91ZCk7XG4gIGdsb2JhbC5QYXJzZSA9IFBhcnNlO1xufVxuXG5mdW5jdGlvbiBpbmplY3REZWZhdWx0cyhvcHRpb25zOiBQYXJzZVNlcnZlck9wdGlvbnMpIHtcbiAgT2JqZWN0LmtleXMoZGVmYXVsdHMpLmZvckVhY2goa2V5ID0+IHtcbiAgICBpZiAoIW9wdGlvbnMuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgb3B0aW9uc1trZXldID0gZGVmYXVsdHNba2V5XTtcbiAgICB9XG4gIH0pO1xuXG4gIGlmICghb3B0aW9ucy5oYXNPd25Qcm9wZXJ0eSgnc2VydmVyVVJMJykpIHtcbiAgICBvcHRpb25zLnNlcnZlclVSTCA9IGBodHRwOi8vbG9jYWxob3N0OiR7b3B0aW9ucy5wb3J0fSR7b3B0aW9ucy5tb3VudFBhdGh9YDtcbiAgfVxuXG4gIG9wdGlvbnMudXNlclNlbnNpdGl2ZUZpZWxkcyA9IEFycmF5LmZyb20oXG4gICAgbmV3IFNldChcbiAgICAgIG9wdGlvbnMudXNlclNlbnNpdGl2ZUZpZWxkcy5jb25jYXQoXG4gICAgICAgIGRlZmF1bHRzLnVzZXJTZW5zaXRpdmVGaWVsZHMsXG4gICAgICAgIG9wdGlvbnMudXNlclNlbnNpdGl2ZUZpZWxkc1xuICAgICAgKVxuICAgIClcbiAgKTtcblxuICBvcHRpb25zLm1hc3RlcktleUlwcyA9IEFycmF5LmZyb20oXG4gICAgbmV3IFNldChcbiAgICAgIG9wdGlvbnMubWFzdGVyS2V5SXBzLmNvbmNhdChkZWZhdWx0cy5tYXN0ZXJLZXlJcHMsIG9wdGlvbnMubWFzdGVyS2V5SXBzKVxuICAgIClcbiAgKTtcbn1cblxuLy8gVGhvc2UgY2FuJ3QgYmUgdGVzdGVkIGFzIGl0IHJlcXVpcmVzIGEgc3VicHJvY2Vzc1xuLyogaXN0YW5idWwgaWdub3JlIG5leHQgKi9cbmZ1bmN0aW9uIGNvbmZpZ3VyZUxpc3RlbmVycyhwYXJzZVNlcnZlcikge1xuICBjb25zdCBzZXJ2ZXIgPSBwYXJzZVNlcnZlci5zZXJ2ZXI7XG4gIGNvbnN0IHNvY2tldHMgPSB7fTtcbiAgLyogQ3VycmVudGx5LCBleHByZXNzIGRvZXNuJ3Qgc2h1dCBkb3duIGltbWVkaWF0ZWx5IGFmdGVyIHJlY2VpdmluZyBTSUdJTlQvU0lHVEVSTSBpZiBpdCBoYXMgY2xpZW50IGNvbm5lY3Rpb25zIHRoYXQgaGF2ZW4ndCB0aW1lZCBvdXQuIChUaGlzIGlzIGEga25vd24gaXNzdWUgd2l0aCBub2RlIC0gaHR0cHM6Ly9naXRodWIuY29tL25vZGVqcy9ub2RlL2lzc3Vlcy8yNjQyKVxuICAgIFRoaXMgZnVuY3Rpb24sIGFsb25nIHdpdGggYGRlc3Ryb3lBbGl2ZUNvbm5lY3Rpb25zKClgLCBpbnRlbmQgdG8gZml4IHRoaXMgYmVoYXZpb3Igc3VjaCB0aGF0IHBhcnNlIHNlcnZlciB3aWxsIGNsb3NlIGFsbCBvcGVuIGNvbm5lY3Rpb25zIGFuZCBpbml0aWF0ZSB0aGUgc2h1dGRvd24gcHJvY2VzcyBhcyBzb29uIGFzIGl0IHJlY2VpdmVzIGEgU0lHSU5UL1NJR1RFUk0gc2lnbmFsLiAqL1xuICBzZXJ2ZXIub24oJ2Nvbm5lY3Rpb24nLCBzb2NrZXQgPT4ge1xuICAgIGNvbnN0IHNvY2tldElkID0gc29ja2V0LnJlbW90ZUFkZHJlc3MgKyAnOicgKyBzb2NrZXQucmVtb3RlUG9ydDtcbiAgICBzb2NrZXRzW3NvY2tldElkXSA9IHNvY2tldDtcbiAgICBzb2NrZXQub24oJ2Nsb3NlJywgKCkgPT4ge1xuICAgICAgZGVsZXRlIHNvY2tldHNbc29ja2V0SWRdO1xuICAgIH0pO1xuICB9KTtcblxuICBjb25zdCBkZXN0cm95QWxpdmVDb25uZWN0aW9ucyA9IGZ1bmN0aW9uKCkge1xuICAgIGZvciAoY29uc3Qgc29ja2V0SWQgaW4gc29ja2V0cykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgc29ja2V0c1tzb2NrZXRJZF0uZGVzdHJveSgpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAvKiAqL1xuICAgICAgfVxuICAgIH1cbiAgfTtcblxuICBjb25zdCBoYW5kbGVTaHV0ZG93biA9IGZ1bmN0aW9uKCkge1xuICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKCdUZXJtaW5hdGlvbiBzaWduYWwgcmVjZWl2ZWQuIFNodXR0aW5nIGRvd24uJyk7XG4gICAgZGVzdHJveUFsaXZlQ29ubmVjdGlvbnMoKTtcbiAgICBzZXJ2ZXIuY2xvc2UoKTtcbiAgICBwYXJzZVNlcnZlci5oYW5kbGVTaHV0ZG93bigpO1xuICB9O1xuICBwcm9jZXNzLm9uKCdTSUdURVJNJywgaGFuZGxlU2h1dGRvd24pO1xuICBwcm9jZXNzLm9uKCdTSUdJTlQnLCBoYW5kbGVTaHV0ZG93bik7XG59XG5cbmV4cG9ydCBkZWZhdWx0IFBhcnNlU2VydmVyO1xuIl19