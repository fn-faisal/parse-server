'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _Options = require('./Options');

var _defaults = require('./defaults');

var _defaults2 = _interopRequireDefault(_defaults);

var _logger = require('./logger');

var logging = _interopRequireWildcard(_logger);

var _Config = require('./Config');

var _Config2 = _interopRequireDefault(_Config);

var _PromiseRouter = require('./PromiseRouter');

var _PromiseRouter2 = _interopRequireDefault(_PromiseRouter);

var _requiredParameter = require('./requiredParameter');

var _requiredParameter2 = _interopRequireDefault(_requiredParameter);

var _AnalyticsRouter = require('./Routers/AnalyticsRouter');

var _ClassesRouter = require('./Routers/ClassesRouter');

var _FeaturesRouter = require('./Routers/FeaturesRouter');

var _FilesRouter = require('./Routers/FilesRouter');

var _FunctionsRouter = require('./Routers/FunctionsRouter');

var _GlobalConfigRouter = require('./Routers/GlobalConfigRouter');

var _HooksRouter = require('./Routers/HooksRouter');

var _IAPValidationRouter = require('./Routers/IAPValidationRouter');

var _InstallationsRouter = require('./Routers/InstallationsRouter');

var _LogsRouter = require('./Routers/LogsRouter');

var _ParseLiveQueryServer = require('./LiveQuery/ParseLiveQueryServer');

var _PublicAPIRouter = require('./Routers/PublicAPIRouter');

var _PushRouter = require('./Routers/PushRouter');

var _CloudCodeRouter = require('./Routers/CloudCodeRouter');

var _RolesRouter = require('./Routers/RolesRouter');

var _SchemasRouter = require('./Routers/SchemasRouter');

var _SessionsRouter = require('./Routers/SessionsRouter');

var _UsersRouter = require('./Routers/UsersRouter');

var _PurgeRouter = require('./Routers/PurgeRouter');

var _AudiencesRouter = require('./Routers/AudiencesRouter');

var _AggregateRouter = require('./Routers/AggregateRouter');

var _ImportRouter = require('./Routers/ImportRouter');

var _ExportRouter = require('./Routers/ExportRouter');

var _ParseServerRESTController = require('./ParseServerRESTController');

var _Controllers = require('./Controllers');

var controllers = _interopRequireWildcard(_Controllers);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// ParseServer - open-source compatible API Server for Parse apps

var batch = require('./batch'),
    bodyParser = require('body-parser'),
    express = require('express'),
    middlewares = require('./middlewares'),
    Parse = require('parse/node').Parse,
    path = require('path');

// Mutate the Parse object to add the Cloud Code handlers
addParseCloud();

// ParseServer works like a constructor of an express app.
// The args that we understand are:
// "analyticsAdapter": an adapter class for analytics
// "filesAdapter": a class like GridStoreAdapter providing create, get,
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

  constructor(options) {
    injectDefaults(options);
    const {
      appId = (0, _requiredParameter2.default)('You must provide an appId!'),
      masterKey = (0, _requiredParameter2.default)('You must provide a masterKey!'),
      cloud,
      javascriptKey,
      serverURL = (0, _requiredParameter2.default)('You must provide a serverURL!'),
      __indexBuildCompletionCallbackForTests = () => {}
    } = options;
    // Initialize the node client SDK automatically
    Parse.initialize(appId, javascriptKey || 'unused', masterKey);
    Parse.serverURL = serverURL;

    const allControllers = controllers.getControllers(options);

    const {
      loggerController,
      databaseController,
      hooksController
    } = allControllers;
    this.config = _Config2.default.put(Object.assign({}, options, allControllers));

    logging.setLogger(loggerController);
    const dbInitPromise = databaseController.performInitialization();
    hooksController.load();

    // Note: Tests will start to fail if any validation happens after this is called.
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
    const { adapter } = this.config.databaseController;
    if (adapter && typeof adapter.handleShutdown === 'function') {
      adapter.handleShutdown();
    }
  }

  static app({ maxUploadSize = '20mb', appId }) {
    // This app serves the Parse API directly.
    // It's the equivalent of https://api.parse.com/1 in the hosted Parse API.
    var api = express();
    //api.use("/apps", express.static(__dirname + "/public"));
    // File handling needs to be before default middlewares are applied
    api.use('/', middlewares.allowCrossDomain, new _FilesRouter.FilesRouter().expressRouter({
      maxUploadSize: maxUploadSize
    }));

    api.use('/health', function (req, res) {
      res.json({
        status: 'ok'
      });
    });

    api.use('/', bodyParser.urlencoded({ extended: false }), new _PublicAPIRouter.PublicAPIRouter().expressRouter());

    api.use('/', middlewares.allowCrossDomain, new _ImportRouter.ImportRouter().expressRouter());
    api.use(bodyParser.json({ 'type': '*/*', limit: maxUploadSize }));
    api.use(middlewares.allowCrossDomain);
    api.use(middlewares.allowMethodOverride);
    api.use(middlewares.handleParseHeaders);

    const appRouter = ParseServer.promiseRouter({ appId });
    api.use(appRouter.expressRouter());

    api.use(middlewares.handleParseErrors);

    // run the following when not testing
    if (!process.env.TESTING) {
      //This causes tests to spew some useless warnings, so disable in test
      /* istanbul ignore next */
      process.on('uncaughtException', err => {
        if (err.code === "EADDRINUSE") {
          // user-friendly message for this common error
          process.stderr.write(`Unable to listen on port ${err.port}. The port is already in use.`);
          process.exit(0);
        } else {
          throw err;
        }
      });
      // verify the server url after a 'mount' event is received
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

  static promiseRouter({ appId }) {
    const routers = [new _ClassesRouter.ClassesRouter(), new _UsersRouter.UsersRouter(), new _SessionsRouter.SessionsRouter(), new _RolesRouter.RolesRouter(), new _AnalyticsRouter.AnalyticsRouter(), new _InstallationsRouter.InstallationsRouter(), new _FunctionsRouter.FunctionsRouter(), new _SchemasRouter.SchemasRouter(), new _PushRouter.PushRouter(), new _LogsRouter.LogsRouter(), new _IAPValidationRouter.IAPValidationRouter(), new _FeaturesRouter.FeaturesRouter(), new _GlobalConfigRouter.GlobalConfigRouter(), new _PurgeRouter.PurgeRouter(), new _ExportRouter.ExportRouter(), new _HooksRouter.HooksRouter(), new _CloudCodeRouter.CloudCodeRouter(), new _AudiencesRouter.AudiencesRouter(), new _AggregateRouter.AggregateRouter()];

    const routes = routers.reduce((memo, router) => {
      return memo.concat(router.routes);
    }, []);

    const appRouter = new _PromiseRouter2.default(routes, appId);

    batch.mountOnto(appRouter);
    return appRouter;
  }

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

  static start(options, callback) {
    const parseServer = new ParseServer(options);
    return parseServer.start(options, callback);
  }

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
      const request = require('request');
      request(Parse.serverURL.replace(/\/$/, "") + "/health", function (error, response, body) {
        let json;
        try {
          json = JSON.parse(body);
        } catch (e) {
          json = null;
        }
        if (error || response.statusCode !== 200 || !json || json && json.status !== 'ok') {
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
  const ParseCloud = require("./cloud-code/Parse.Cloud");
  Object.assign(Parse.Cloud, ParseCloud);
  global.Parse = Parse;
}

function injectDefaults(options) {
  Object.keys(_defaults2.default).forEach(key => {
    if (!options.hasOwnProperty(key)) {
      options[key] = _defaults2.default[key];
    }
  });

  if (!options.hasOwnProperty('serverURL')) {
    options.serverURL = `http://localhost:${options.port}${options.mountPath}`;
  }

  options.userSensitiveFields = Array.from(new Set(options.userSensitiveFields.concat(_defaults2.default.userSensitiveFields, options.userSensitiveFields)));

  options.masterKeyIps = Array.from(new Set(options.masterKeyIps.concat(_defaults2.default.masterKeyIps, options.masterKeyIps)));
}

// Those can't be tested as it requires a subprocess
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
      } catch (e) {/* */}
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

exports.default = ParseServer;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9QYXJzZVNlcnZlci5qcyJdLCJuYW1lcyI6WyJsb2dnaW5nIiwiY29udHJvbGxlcnMiLCJiYXRjaCIsInJlcXVpcmUiLCJib2R5UGFyc2VyIiwiZXhwcmVzcyIsIm1pZGRsZXdhcmVzIiwiUGFyc2UiLCJwYXRoIiwiYWRkUGFyc2VDbG91ZCIsIlBhcnNlU2VydmVyIiwiY29uc3RydWN0b3IiLCJvcHRpb25zIiwiaW5qZWN0RGVmYXVsdHMiLCJhcHBJZCIsIm1hc3RlcktleSIsImNsb3VkIiwiamF2YXNjcmlwdEtleSIsInNlcnZlclVSTCIsIl9faW5kZXhCdWlsZENvbXBsZXRpb25DYWxsYmFja0ZvclRlc3RzIiwiaW5pdGlhbGl6ZSIsImFsbENvbnRyb2xsZXJzIiwiZ2V0Q29udHJvbGxlcnMiLCJsb2dnZXJDb250cm9sbGVyIiwiZGF0YWJhc2VDb250cm9sbGVyIiwiaG9va3NDb250cm9sbGVyIiwiY29uZmlnIiwiQ29uZmlnIiwicHV0IiwiT2JqZWN0IiwiYXNzaWduIiwic2V0TG9nZ2VyIiwiZGJJbml0UHJvbWlzZSIsInBlcmZvcm1Jbml0aWFsaXphdGlvbiIsImxvYWQiLCJwcm9jZXNzIiwiZW52IiwiVEVTVElORyIsInJlc29sdmUiLCJjd2QiLCJhcHAiLCJfYXBwIiwiaGFuZGxlU2h1dGRvd24iLCJhZGFwdGVyIiwibWF4VXBsb2FkU2l6ZSIsImFwaSIsInVzZSIsImFsbG93Q3Jvc3NEb21haW4iLCJGaWxlc1JvdXRlciIsImV4cHJlc3NSb3V0ZXIiLCJyZXEiLCJyZXMiLCJqc29uIiwic3RhdHVzIiwidXJsZW5jb2RlZCIsImV4dGVuZGVkIiwiUHVibGljQVBJUm91dGVyIiwiSW1wb3J0Um91dGVyIiwibGltaXQiLCJhbGxvd01ldGhvZE92ZXJyaWRlIiwiaGFuZGxlUGFyc2VIZWFkZXJzIiwiYXBwUm91dGVyIiwicHJvbWlzZVJvdXRlciIsImhhbmRsZVBhcnNlRXJyb3JzIiwib24iLCJlcnIiLCJjb2RlIiwic3RkZXJyIiwid3JpdGUiLCJwb3J0IiwiZXhpdCIsInZlcmlmeVNlcnZlclVybCIsIlBBUlNFX1NFUlZFUl9FTkFCTEVfRVhQRVJJTUVOVEFMX0RJUkVDVF9BQ0NFU1MiLCJDb3JlTWFuYWdlciIsInNldFJFU1RDb250cm9sbGVyIiwicm91dGVycyIsIkNsYXNzZXNSb3V0ZXIiLCJVc2Vyc1JvdXRlciIsIlNlc3Npb25zUm91dGVyIiwiUm9sZXNSb3V0ZXIiLCJBbmFseXRpY3NSb3V0ZXIiLCJJbnN0YWxsYXRpb25zUm91dGVyIiwiRnVuY3Rpb25zUm91dGVyIiwiU2NoZW1hc1JvdXRlciIsIlB1c2hSb3V0ZXIiLCJMb2dzUm91dGVyIiwiSUFQVmFsaWRhdGlvblJvdXRlciIsIkZlYXR1cmVzUm91dGVyIiwiR2xvYmFsQ29uZmlnUm91dGVyIiwiUHVyZ2VSb3V0ZXIiLCJFeHBvcnRSb3V0ZXIiLCJIb29rc1JvdXRlciIsIkNsb3VkQ29kZVJvdXRlciIsIkF1ZGllbmNlc1JvdXRlciIsIkFnZ3JlZ2F0ZVJvdXRlciIsInJvdXRlcyIsInJlZHVjZSIsIm1lbW8iLCJyb3V0ZXIiLCJjb25jYXQiLCJQcm9taXNlUm91dGVyIiwibW91bnRPbnRvIiwic3RhcnQiLCJjYWxsYmFjayIsIm1pZGRsZXdhcmUiLCJtb3VudFBhdGgiLCJzZXJ2ZXIiLCJsaXN0ZW4iLCJob3N0Iiwic3RhcnRMaXZlUXVlcnlTZXJ2ZXIiLCJsaXZlUXVlcnlTZXJ2ZXJPcHRpb25zIiwibGl2ZVF1ZXJ5U2VydmVyIiwiY3JlYXRlTGl2ZVF1ZXJ5U2VydmVyIiwiY29uZmlndXJlTGlzdGVuZXJzIiwiZXhwcmVzc0FwcCIsInBhcnNlU2VydmVyIiwiaHR0cFNlcnZlciIsImNyZWF0ZVNlcnZlciIsIlBhcnNlTGl2ZVF1ZXJ5U2VydmVyIiwicmVxdWVzdCIsInJlcGxhY2UiLCJlcnJvciIsInJlc3BvbnNlIiwiYm9keSIsIkpTT04iLCJwYXJzZSIsImUiLCJzdGF0dXNDb2RlIiwiY29uc29sZSIsIndhcm4iLCJQYXJzZUNsb3VkIiwiQ2xvdWQiLCJnbG9iYWwiLCJrZXlzIiwiZGVmYXVsdHMiLCJmb3JFYWNoIiwia2V5IiwiaGFzT3duUHJvcGVydHkiLCJ1c2VyU2Vuc2l0aXZlRmllbGRzIiwiQXJyYXkiLCJmcm9tIiwiU2V0IiwibWFzdGVyS2V5SXBzIiwic29ja2V0cyIsInNvY2tldCIsInNvY2tldElkIiwicmVtb3RlQWRkcmVzcyIsInJlbW90ZVBvcnQiLCJkZXN0cm95QWxpdmVDb25uZWN0aW9ucyIsImRlc3Ryb3kiLCJzdGRvdXQiLCJjbG9zZSJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBU0E7O0FBRUE7Ozs7QUFDQTs7SUFBWUEsTzs7QUFDWjs7OztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFFQTs7QUFDQTs7SUFBWUMsVzs7Ozs7O0FBekNaOztBQUVBLElBQUlDLFFBQVFDLFFBQVEsU0FBUixDQUFaO0FBQUEsSUFDRUMsYUFBYUQsUUFBUSxhQUFSLENBRGY7QUFBQSxJQUVFRSxVQUFVRixRQUFRLFNBQVIsQ0FGWjtBQUFBLElBR0VHLGNBQWNILFFBQVEsZUFBUixDQUhoQjtBQUFBLElBSUVJLFFBQVFKLFFBQVEsWUFBUixFQUFzQkksS0FKaEM7QUFBQSxJQUtFQyxPQUFPTCxRQUFRLE1BQVIsQ0FMVDs7QUF3Q0E7QUFDQU07O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNQyxXQUFOLENBQWtCOztBQUVoQkMsY0FBWUMsT0FBWixFQUF5QztBQUN2Q0MsbUJBQWVELE9BQWY7QUFDQSxVQUFNO0FBQ0pFLGNBQVEsaUNB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YUFBTytFLFFBQVFFLFFBQVIsQ0FBUDtBQUNELEtBRkQ7QUFHRCxHQU5EOztBQVFBLFFBQU1HLDBCQUEwQixZQUFXO0FBQ3pDLFNBQUssTUFBTUgsUUFBWCxJQUF1QkYsT0FBdkIsRUFBZ0M7QUFDOUIsVUFBSTtBQUNGQSxnQkFBUUUsUUFBUixFQUFrQkksT0FBbEI7QUFDRCxPQUZELENBRUUsT0FBT3ZCLENBQVAsRUFBVSxDQUFFLEtBQU87QUFDdEI7QUFDRixHQU5EOztBQVFBLFFBQU1wRixpQkFBaUIsWUFBVztBQUNoQ1AsWUFBUW1ILE1BQVIsQ0FBZWxGLEtBQWYsQ0FBcUIsNkNBQXJCO0FBQ0FnRjtBQUNBMUMsV0FBTzZDLEtBQVA7QUFDQXBDLGdCQUFZekUsY0FBWjtBQUNELEdBTEQ7QUFNQVAsVUFBUTZCLEVBQVIsQ0FBVyxTQUFYLEVBQXNCdEIsY0FBdEI7QUFDQVAsVUFBUTZCLEVBQVIsQ0FBVyxRQUFYLEVBQXFCdEIsY0FBckI7QUFDRDs7a0JBRWNoQyxXIiwiZmlsZSI6IlBhcnNlU2VydmVyLmpzIiwic291cmNlc0NvbnRlbnQiOlsiLy8gUGFyc2VTZXJ2ZXIgLSBvcGVuLXNvdXJjZSBjb21wYXRpYmxlIEFQSSBTZXJ2ZXIgZm9yIFBhcnNlIGFwcHNcblxudmFyIGJhdGNoID0gcmVxdWlyZSgnLi9iYXRjaCcpLFxuICBib2R5UGFyc2VyID0gcmVxdWlyZSgnYm9keS1wYXJzZXInKSxcbiAgZXhwcmVzcyA9IHJlcXVpcmUoJ2V4cHJlc3MnKSxcbiAgbWlkZGxld2FyZXMgPSByZXF1aXJlKCcuL21pZGRsZXdhcmVzJyksXG4gIFBhcnNlID0gcmVxdWlyZSgncGFyc2Uvbm9kZScpLlBhcnNlLFxuICBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xuXG5pbXBvcnQgeyBQYXJzZVNlcnZlck9wdGlvbnMsXG4gIExpdmVRdWVyeVNlcnZlck9wdGlvbnMgfSAgICAgIGZyb20gJy4vT3B0aW9ucyc7XG5pbXBvcnQgZGVmYXVsdHMgICAgICAgICAgICAgICAgIGZyb20gJy4vZGVmYXVsdHMnO1xuaW1wb3J0ICogYXMgbG9nZ2luZyAgICAgICAgICAgICBmcm9tICcuL2xvZ2dlcic7XG5pbXBvcnQgQ29uZmlnICAgICAgICAgICAgICAgICAgIGZyb20gJy4vQ29uZmlnJztcbmltcG9ydCBQcm9taXNlUm91dGVyICAgICAgICAgICAgZnJvbSAnLi9Qcm9taXNlUm91dGVyJztcbmltcG9ydCByZXF1aXJlZFBhcmFtZXRlciAgICAgICAgZnJvbSAnLi9yZXF1aXJlZFBhcmFtZXRlcic7XG5pbXBvcnQgeyBBbmFseXRpY3NSb3V0ZXIgfSAgICAgIGZyb20gJy4vUm91dGVycy9BbmFseXRpY3NSb3V0ZXInO1xuaW1wb3J0IHsgQ2xhc3Nlc1JvdXRlciB9ICAgICAgICBmcm9tICcuL1JvdXRlcnMvQ2xhc3Nlc1JvdXRlcic7XG5pbXBvcnQgeyBGZWF0dXJlc1JvdXRlciB9ICAgICAgIGZyb20gJy4vUm91dGVycy9GZWF0dXJlc1JvdXRlcic7XG5pbXBvcnQgeyBGaWxlc1JvdXRlciB9ICAgICAgICAgIGZyb20gJy4vUm91dGVycy9GaWxlc1JvdXRlcic7XG5pbXBvcnQgeyBGdW5jdGlvbnNSb3V0ZXIgfSAgICAgIGZyb20gJy4vUm91dGVycy9GdW5jdGlvbnNSb3V0ZXInO1xuaW1wb3J0IHsgR2xvYmFsQ29uZmlnUm91dGVyIH0gICBmcm9tICcuL1JvdXRlcnMvR2xvYmFsQ29uZmlnUm91dGVyJztcbmltcG9ydCB7IEhvb2tzUm91dGVyIH0gICAgICAgICAgZnJvbSAnLi9Sb3V0ZXJzL0hvb2tzUm91dGVyJztcbmltcG9ydCB7IElBUFZhbGlkYXRpb25Sb3V0ZXIgfSAgZnJvbSAnLi9Sb3V0ZXJzL0lBUFZhbGlkYXRpb25Sb3V0ZXInO1xuaW1wb3J0IHsgSW5zdGFsbGF0aW9uc1JvdXRlciB9ICBmcm9tICcuL1JvdXRlcnMvSW5zdGFsbGF0aW9uc1JvdXRlcic7XG5pbXBvcnQgeyBMb2dzUm91dGVyIH0gICAgICAgICAgIGZyb20gJy4vUm91dGVycy9Mb2dzUm91dGVyJztcbmltcG9ydCB7IFBhcnNlTGl2ZVF1ZXJ5U2VydmVyIH0gZnJvbSAnLi9MaXZlUXVlcnkvUGFyc2VMaXZlUXVlcnlTZXJ2ZXInO1xuaW1wb3J0IHsgUHVibGljQVBJUm91dGVyIH0gICAgICBmcm9tICcuL1JvdXRlcnMvUHVibGljQVBJUm91dGVyJztcbmltcG9ydCB7IFB1c2hSb3V0ZXIgfSAgICAgICAgICAgZnJvbSAnLi9Sb3V0ZXJzL1B1c2hSb3V0ZXInO1xuaW1wb3J0IHsgQ2xvdWRDb2RlUm91dGVyIH0gICAgICBmcm9tICcuL1JvdXRlcnMvQ2xvdWRDb2RlUm91dGVyJztcbmltcG9ydCB7IFJvbGVzUm91dGVyIH0gICAgICAgICAgZnJvbSAnLi9Sb3V0ZXJzL1JvbGVzUm91dGVyJztcbmltcG9ydCB7IFNjaGVtYXNSb3V0ZXIgfSAgICAgICAgZnJvbSAnLi9Sb3V0ZXJzL1NjaGVtYXNSb3V0ZXInO1xuaW1wb3J0IHsgU2Vzc2lvbnNSb3V0ZXIgfSAgICAgICBmcm9tICcuL1JvdXRlcnMvU2Vzc2lvbnNSb3V0ZXInO1xuaW1wb3J0IHsgVXNlcnNSb3V0ZXIgfSAgICAgICAgICBmcm9tICcuL1JvdXRlcnMvVXNlcnNSb3V0ZXInO1xuaW1wb3J0IHsgUHVyZ2VSb3V0ZXIgfSAgICAgICAgICBmcm9tICcuL1JvdXRlcnMvUHVyZ2VSb3V0ZXInO1xuaW1wb3J0IHsgQXVkaWVuY2VzUm91dGVyIH0gICAgICBmcm9tICcuL1JvdXRlcnMvQXVkaWVuY2VzUm91dGVyJztcbmltcG9ydCB7IEFnZ3JlZ2F0ZVJvdXRlciB9ICAgICAgZnJvbSAnLi9Sb3V0ZXJzL0FnZ3JlZ2F0ZVJvdXRlcic7XG5pbXBvcnQgeyBJbXBvcnRSb3V0ZXIgfSAgICAgIGZyb20gJy4vUm91dGVycy9JbXBvcnRSb3V0ZXInO1xuaW1wb3J0IHsgRXhwb3J0Um91dGVyIH0gICAgICBmcm9tICcuL1JvdXRlcnMvRXhwb3J0Um91dGVyJztcblxuaW1wb3J0IHsgUGFyc2VTZXJ2ZXJSRVNUQ29udHJvbGxlciB9IGZyb20gJy4vUGFyc2VTZXJ2ZXJSRVNUQ29udHJvbGxlcic7XG5pbXBvcnQgKiBhcyBjb250cm9sbGVycyBmcm9tICcuL0NvbnRyb2xsZXJzJztcbi8vIE11dGF0ZSB0aGUgUGFyc2Ugb2JqZWN0IHRvIGFkZCB0aGUgQ2xvdWQgQ29kZSBoYW5kbGVyc1xuYWRkUGFyc2VDbG91ZCgpO1xuXG4vLyBQYXJzZVNlcnZlciB3b3JrcyBsaWtlIGEgY29uc3RydWN0b3Igb2YgYW4gZXhwcmVzcyBhcHAuXG4vLyBUaGUgYXJncyB0aGF0IHdlIHVuZGVyc3RhbmQgYXJlOlxuLy8gXCJhbmFseXRpY3NBZGFwdGVyXCI6IGFuIGFkYXB0ZXIgY2xhc3MgZm9yIGFuYWx5dGljc1xuLy8gXCJmaWxlc0FkYXB0ZXJcIjogYSBjbGFzcyBsaWtlIEdyaWRTdG9yZUFkYXB0ZXIgcHJvdmlkaW5nIGNyZWF0ZSwgZ2V0LFxuLy8gICAgICAgICAgICAgICAgIGFuZCBkZWxldGVcbi8vIFwibG9nZ2VyQWRhcHRlclwiOiBhIGNsYXNzIGxpa2UgV2luc3RvbkxvZ2dlckFkYXB0ZXIgcHJvdmlkaW5nIGluZm8sIGVycm9yLFxuLy8gICAgICAgICAgICAgICAgIGFuZCBxdWVyeVxuLy8gXCJqc29uTG9nc1wiOiBsb2cgYXMgc3RydWN0dXJlZCBKU09OIG9iamVjdHNcbi8vIFwiZGF0YWJhc2VVUklcIjogYSB1cmkgbGlrZSBtb25nb2RiOi8vbG9jYWxob3N0OjI3MDE3L2RibmFtZSB0byB0ZWxsIHVzXG4vLyAgICAgICAgICB3aGF0IGRhdGFiYXNlIHRoaXMgUGFyc2UgQVBJIGNvbm5lY3RzIHRvLlxuLy8gXCJjbG91ZFwiOiByZWxhdGl2ZSBsb2NhdGlvbiB0byBjbG91ZCBjb2RlIHRvIHJlcXVpcmUsIG9yIGEgZnVuY3Rpb25cbi8vICAgICAgICAgIHRoYXQgaXMgZ2l2ZW4gYW4gaW5zdGFuY2Ugb2YgUGFyc2UgYXMgYSBwYXJhbWV0ZXIuICBVc2UgdGhpcyBpbnN0YW5jZSBvZiBQYXJzZVxuLy8gICAgICAgICAgdG8gcmVnaXN0ZXIgeW91ciBjbG91ZCBjb2RlIGhvb2tzIGFuZCBmdW5jdGlvbnMuXG4vLyBcImFwcElkXCI6IHRoZSBhcHBsaWNhdGlvbiBpZCB0byBob3N0XG4vLyBcIm1hc3RlcktleVwiOiB0aGUgbWFzdGVyIGtleSBmb3IgcmVxdWVzdHMgdG8gdGhpcyBhcHBcbi8vIFwiY29sbGVjdGlvblByZWZpeFwiOiBvcHRpb25hbCBwcmVmaXggZm9yIGRhdGFiYXNlIGNvbGxlY3Rpb24gbmFtZXNcbi8vIFwiZmlsZUtleVwiOiBvcHRpb25hbCBrZXkgZnJvbSBQYXJzZSBkYXNoYm9hcmQgZm9yIHN1cHBvcnRpbmcgb2xkZXIgZmlsZXNcbi8vICAgICAgICAgICAgaG9zdGVkIGJ5IFBhcnNlXG4vLyBcImNsaWVudEtleVwiOiBvcHRpb25hbCBrZXkgZnJvbSBQYXJzZSBkYXNoYm9hcmRcbi8vIFwiZG90TmV0S2V5XCI6IG9wdGlvbmFsIGtleSBmcm9tIFBhcnNlIGRhc2hib2FyZFxuLy8gXCJyZXN0QVBJS2V5XCI6IG9wdGlvbmFsIGtleSBmcm9tIFBhcnNlIGRhc2hib2FyZFxuLy8gXCJ3ZWJob29rS2V5XCI6IG9wdGlvbmFsIGtleSBmcm9tIFBhcnNlIGRhc2hib2FyZFxuLy8gXCJqYXZhc2NyaXB0S2V5XCI6IG9wdGlvbmFsIGtleSBmcm9tIFBhcnNlIGRhc2hib2FyZFxuLy8gXCJwdXNoXCI6IG9wdGlvbmFsIGtleSBmcm9tIGNvbmZpZ3VyZSBwdXNoXG4vLyBcInNlc3Npb25MZW5ndGhcIjogb3B0aW9uYWwgbGVuZ3RoIGluIHNlY29uZHMgZm9yIGhvdyBsb25nIFNlc3Npb25zIHNob3VsZCBiZSB2YWxpZCBmb3Jcbi8vIFwibWF4TGltaXRcIjogb3B0aW9uYWwgdXBwZXIgYm91bmQgZm9yIHdoYXQgY2FuIGJlIHNwZWNpZmllZCBmb3IgdGhlICdsaW1pdCcgcGFyYW1ldGVyIG9uIHF1ZXJpZXNcblxuY2xhc3MgUGFyc2VTZXJ2ZXIge1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IFBhcnNlU2VydmVyT3B0aW9ucykge1xuICAgIGluamVjdERlZmF1bHRzKG9wdGlvbnMpO1xuICAgIGNvbnN0IHtcbiAgICAgIGFwcElkID0gcmVxdWlyZWRQYXJhbWV0ZXIoJ1lvdSBtdXN0IHByb3ZpZGUgYW4gYXBwSWQhJyksXG4gICAgICBtYXN0ZXJLZXkgPSByZXF1aXJlZFBhcmFtZXRlcignWW91IG11c3QgcHJvdmlkZSBhIG1hc3RlcktleSEnKSxcbiAgICAgIGNsb3VkLFxuICAgICAgamF2YXNjcmlwdEtleSxcbiAgICAgIHNlcnZlclVSTCA9IHJlcXVpcmVkUGFyYW1ldGVyKCdZb3UgbXVzdCBwcm92aWRlIGEgc2VydmVyVVJMIScpLFxuICAgICAgX19pbmRleEJ1aWxkQ29tcGxldGlvbkNhbGxiYWNrRm9yVGVzdHMgPSAoKSA9PiB7fSxcbiAgICB9ID0gb3B0aW9ucztcbiAgICAvLyBJbml0aWFsaXplIHRoZSBub2RlIGNsaWVudCBTREsgYXV0b21hdGljYWxseVxuICAgIFBhcnNlLmluaXRpYWxpemUoYXBwSWQsIGphdmFzY3JpcHRLZXkgfHwgJ3VudXNlZCcsIG1hc3RlcktleSk7XG4gICAgUGFyc2Uuc2VydmVyVVJMID0gc2VydmVyVVJMO1xuXG4gICAgY29uc3QgYWxsQ29udHJvbGxlcnMgPSBjb250cm9sbGVycy5nZXRDb250cm9sbGVycyhvcHRpb25zKTtcblxuICAgIGNvbnN0IHtcbiAgICAgIGxvZ2dlckNvbnRyb2xsZXIsXG4gICAgICBkYXRhYmFzZUNvbnRyb2xsZXIsXG4gICAgICBob29rc0NvbnRyb2xsZXIsXG4gICAgfSA9IGFsbENvbnRyb2xsZXJzO1xuICAgIHRoaXMuY29uZmlnID0gQ29uZmlnLnB1dChPYmplY3QuYXNzaWduKHt9LCBvcHRpb25zLCBhbGxDb250cm9sbGVycykpO1xuXG4gICAgbG9nZ2luZy5zZXRMb2dnZXIobG9nZ2VyQ29udHJvbGxlcik7XG4gICAgY29uc3QgZGJJbml0UHJvbWlzZSA9IGRhdGFiYXNlQ29udHJvbGxlci5wZXJmb3JtSW5pdGlhbGl6YXRpb24oKTtcbiAgICBob29rc0NvbnRyb2xsZXIubG9hZCgpO1xuXG4gICAgLy8gTm90ZTogVGVzdHMgd2lsbCBzdGFydCB0byBmYWlsIGlmIGFueSB2YWxpZGF0aW9uIGhhcHBlbnMgYWZ0ZXIgdGhpcyBpcyBjYWxsZWQuXG4gICAgaWYgKHByb2Nlc3MuZW52LlRFU1RJTkcpIHtcbiAgICAgIF9faW5kZXhCdWlsZENvbXBsZXRpb25DYWxsYmFja0ZvclRlc3RzKGRiSW5pdFByb21pc2UpO1xuICAgIH1cblxuICAgIGlmIChjbG91ZCkge1xuICAgICAgYWRkUGFyc2VDbG91ZCgpO1xuICAgICAgaWYgKHR5cGVvZiBjbG91ZCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBjbG91ZChQYXJzZSlcbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGNsb3VkID09PSAnc3RyaW5nJykge1xuICAgICAgICByZXF1aXJlKHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCBjbG91ZCkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgXCJhcmd1bWVudCAnY2xvdWQnIG11c3QgZWl0aGVyIGJlIGEgc3RyaW5nIG9yIGEgZnVuY3Rpb25cIjtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBnZXQgYXBwKCkge1xuICAgIGlmICghdGhpcy5fYXBwKSB7XG4gICAgICB0aGlzLl9hcHAgPSBQYXJzZVNlcnZlci5hcHAodGhpcy5jb25maWcpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5fYXBwO1xuICB9XG5cbiAgaGFuZGxlU2h1dGRvd24oKSB7XG4gICAgY29uc3QgeyBhZGFwdGVyIH0gPSB0aGlzLmNvbmZpZy5kYXRhYmFzZUNvbnRyb2xsZXI7XG4gICAgaWYgKGFkYXB0ZXIgJiYgdHlwZW9mIGFkYXB0ZXIuaGFuZGxlU2h1dGRvd24gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGFkYXB0ZXIuaGFuZGxlU2h1dGRvd24oKTtcbiAgICB9XG4gIH1cblxuICBzdGF0aWMgYXBwKHttYXhVcGxvYWRTaXplID0gJzIwbWInLCBhcHBJZH0pIHtcbiAgICAvLyBUaGlzIGFwcCBzZXJ2ZXMgdGhlIFBhcnNlIEFQSSBkaXJlY3RseS5cbiAgICAvLyBJdCdzIHRoZSBlcXVpdmFsZW50IG9mIGh0dHBzOi8vYXBpLnBhcnNlLmNvbS8xIGluIHRoZSBob3N0ZWQgUGFyc2UgQVBJLlxuICAgIHZhciBhcGkgPSBleHByZXNzKCk7XG4gICAgLy9hcGkudXNlKFwiL2FwcHNcIiwgZXhwcmVzcy5zdGF0aWMoX19kaXJuYW1lICsgXCIvcHVibGljXCIpKTtcbiAgICAvLyBGaWxlIGhhbmRsaW5nIG5lZWRzIHRvIGJlIGJlZm9yZSBkZWZhdWx0IG1pZGRsZXdhcmVzIGFyZSBhcHBsaWVkXG4gICAgYXBpLnVzZSgnLycsIG1pZGRsZXdhcmVzLmFsbG93Q3Jvc3NEb21haW4sIG5ldyBGaWxlc1JvdXRlcigpLmV4cHJlc3NSb3V0ZXIoe1xuICAgICAgbWF4VXBsb2FkU2l6ZTogbWF4VXBsb2FkU2l6ZVxuICAgIH0pKTtcblxuICAgIGFwaS51c2UoJy9oZWFsdGgnLCAoZnVuY3Rpb24ocmVxLCByZXMpIHtcbiAgICAgIHJlcy5qc29uKHtcbiAgICAgICAgc3RhdHVzOiAnb2snXG4gICAgICB9KTtcbiAgICB9KSk7XG5cbiAgICBhcGkudXNlKCcvJywgYm9keVBhcnNlci51cmxlbmNvZGVkKHtleHRlbmRlZDogZmFsc2V9KSwgbmV3IFB1YmxpY0FQSVJvdXRlcigpLmV4cHJlc3NSb3V0ZXIoKSk7XG5cbiAgICBhcGkudXNlKCcvJywgbWlkZGxld2FyZXMuYWxsb3dDcm9zc0RvbWFpbiwgbmV3IEltcG9ydFJvdXRlcigpLmV4cHJlc3NSb3V0ZXIoKSk7XG4gICAgYXBpLnVzZShib2R5UGFyc2VyLmpzb24oeyAndHlwZSc6ICcqLyonICwgbGltaXQ6IG1heFVwbG9hZFNpemUgfSkpO1xuICAgIGFwaS51c2UobWlkZGxld2FyZXMuYWxsb3dDcm9zc0RvbWFpbik7XG4gICAgYXBpLnVzZShtaWRkbGV3YXJlcy5hbGxvd01ldGhvZE92ZXJyaWRlKTtcbiAgICBhcGkudXNlKG1pZGRsZXdhcmVzLmhhbmRsZVBhcnNlSGVhZGVycyk7XG5cbiAgICBjb25zdCBhcHBSb3V0ZXIgPSBQYXJzZVNlcnZlci5wcm9taXNlUm91dGVyKHsgYXBwSWQgfSk7XG4gICAgYXBpLnVzZShhcHBSb3V0ZXIuZXhwcmVzc1JvdXRlcigpKTtcblxuICAgIGFwaS51c2UobWlkZGxld2FyZXMuaGFuZGxlUGFyc2VFcnJvcnMpO1xuXG4gICAgLy8gcnVuIHRoZSBmb2xsb3dpbmcgd2hlbiBub3QgdGVzdGluZ1xuICAgIGlmICghcHJvY2Vzcy5lbnYuVEVTVElORykge1xuICAgICAgLy9UaGlzIGNhdXNlcyB0ZXN0cyB0byBzcGV3IHNvbWUgdXNlbGVzcyB3YXJuaW5ncywgc28gZGlzYWJsZSBpbiB0ZXN0XG4gICAgICAvKiBpc3RhbmJ1bCBpZ25vcmUgbmV4dCAqL1xuICAgICAgcHJvY2Vzcy5vbigndW5jYXVnaHRFeGNlcHRpb24nLCAoZXJyKSA9PiB7XG4gICAgICAgIGlmIChlcnIuY29kZSA9PT0gXCJFQUREUklOVVNFXCIpIHsgLy8gdXNlci1mcmllbmRseSBtZXNzYWdlIGZvciB0aGlzIGNvbW1vbiBlcnJvclxuICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGBVbmFibGUgdG8gbGlzdGVuIG9uIHBvcnQgJHtlcnIucG9ydH0uIFRoZSBwb3J0IGlzIGFscmVhZHkgaW4gdXNlLmApO1xuICAgICAgICAgIHByb2Nlc3MuZXhpdCgwKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgLy8gdmVyaWZ5IHRoZSBzZXJ2ZXIgdXJsIGFmdGVyIGEgJ21vdW50JyBldmVudCBpcyByZWNlaXZlZFxuICAgICAgLyogaXN0YW5idWwgaWdub3JlIG5leHQgKi9cbiAgICAgIGFwaS5vbignbW91bnQnLCBmdW5jdGlvbigpIHtcbiAgICAgICAgUGFyc2VTZXJ2ZXIudmVyaWZ5U2VydmVyVXJsKCk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgaWYgKHByb2Nlc3MuZW52LlBBUlNFX1NFUlZFUl9FTkFCTEVfRVhQRVJJTUVOVEFMX0RJUkVDVF9BQ0NFU1MgPT09ICcxJykge1xuICAgICAgUGFyc2UuQ29yZU1hbmFnZXIuc2V0UkVTVENvbnRyb2xsZXIoUGFyc2VTZXJ2ZXJSRVNUQ29udHJvbGxlcihhcHBJZCwgYXBwUm91dGVyKSk7XG4gICAgfVxuICAgIHJldHVybiBhcGk7XG4gIH1cblxuICBzdGF0aWMgcHJvbWlzZVJvdXRlcih7YXBwSWR9KSB7XG4gICAgY29uc3Qgcm91dGVycyA9IFtcbiAgICAgIG5ldyBDbGFzc2VzUm91dGVyKCksXG4gICAgICBuZXcgVXNlcnNSb3V0ZXIoKSxcbiAgICAgIG5ldyBTZXNzaW9uc1JvdXRlcigpLFxuICAgICAgbmV3IFJvbGVzUm91dGVyKCksXG4gICAgICBuZXcgQW5hbHl0aWNzUm91dGVyKCksXG4gICAgICBuZXcgSW5zdGFsbGF0aW9uc1JvdXRlcigpLFxuICAgICAgbmV3IEZ1bmN0aW9uc1JvdXRlcigpLFxuICAgICAgbmV3IFNjaGVtYXNSb3V0ZXIoKSxcbiAgICAgIG5ldyBQdXNoUm91dGVyKCksXG4gICAgICBuZXcgTG9nc1JvdXRlcigpLFxuICAgICAgbmV3IElBUFZhbGlkYXRpb25Sb3V0ZXIoKSxcbiAgICAgIG5ldyBGZWF0dXJlc1JvdXRlcigpLFxuICAgICAgbmV3IEdsb2JhbENvbmZpZ1JvdXRlcigpLFxuICAgICAgbmV3IFB1cmdlUm91dGVyKCksXG4gICAgICBuZXcgRXhwb3J0Um91dGVyKCksXG4gICAgICBuZXcgSG9va3NSb3V0ZXIoKSxcbiAgICAgIG5ldyBDbG91ZENvZGVSb3V0ZXIoKSxcbiAgICAgIG5ldyBBdWRpZW5jZXNSb3V0ZXIoKSxcbiAgICAgIG5ldyBBZ2dyZWdhdGVSb3V0ZXIoKVxuICAgIF07XG5cbiAgICBjb25zdCByb3V0ZXMgPSByb3V0ZXJzLnJlZHVjZSgobWVtbywgcm91dGVyKSA9PiB7XG4gICAgICByZXR1cm4gbWVtby5jb25jYXQocm91dGVyLnJvdXRlcyk7XG4gICAgfSwgW10pO1xuXG4gICAgY29uc3QgYXBwUm91dGVyID0gbmV3IFByb21pc2VSb3V0ZXIocm91dGVzLCBhcHBJZCk7XG5cbiAgICBiYXRjaC5tb3VudE9udG8oYXBwUm91dGVyKTtcbiAgICByZXR1cm4gYXBwUm91dGVyO1xuICB9XG5cbiAgc3RhcnQob3B0aW9uczogUGFyc2VTZXJ2ZXJPcHRpb25zLCBjYWxsYmFjazogPygpPT52b2lkKSB7XG4gICAgY29uc3QgYXBwID0gZXhwcmVzcygpO1xuICAgIGlmIChvcHRpb25zLm1pZGRsZXdhcmUpIHtcbiAgICAgIGxldCBtaWRkbGV3YXJlO1xuICAgICAgaWYgKHR5cGVvZiBvcHRpb25zLm1pZGRsZXdhcmUgPT0gJ3N0cmluZycpIHtcbiAgICAgICAgbWlkZGxld2FyZSA9IHJlcXVpcmUocGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksIG9wdGlvbnMubWlkZGxld2FyZSkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbWlkZGxld2FyZSA9IG9wdGlvbnMubWlkZGxld2FyZTsgLy8gdXNlIGFzLWlzIGxldCBleHByZXNzIGZhaWxcbiAgICAgIH1cbiAgICAgIGFwcC51c2UobWlkZGxld2FyZSk7XG4gICAgfVxuXG4gICAgYXBwLnVzZShvcHRpb25zLm1vdW50UGF0aCwgdGhpcy5hcHApO1xuICAgIGNvbnN0IHNlcnZlciA9IGFwcC5saXN0ZW4ob3B0aW9ucy5wb3J0LCBvcHRpb25zLmhvc3QsIGNhbGxiYWNrKTtcbiAgICB0aGlzLnNlcnZlciA9IHNlcnZlcjtcblxuICAgIGlmIChvcHRpb25zLnN0YXJ0TGl2ZVF1ZXJ5U2VydmVyIHx8IG9wdGlvbnMubGl2ZVF1ZXJ5U2VydmVyT3B0aW9ucykge1xuICAgICAgdGhpcy5saXZlUXVlcnlTZXJ2ZXIgPSBQYXJzZVNlcnZlci5jcmVhdGVMaXZlUXVlcnlTZXJ2ZXIoc2VydmVyLCBvcHRpb25zLmxpdmVRdWVyeVNlcnZlck9wdGlvbnMpO1xuICAgIH1cbiAgICAvKiBpc3RhbmJ1bCBpZ25vcmUgbmV4dCAqL1xuICAgIGlmICghcHJvY2Vzcy5lbnYuVEVTVElORykge1xuICAgICAgY29uZmlndXJlTGlzdGVuZXJzKHRoaXMpO1xuICAgIH1cbiAgICB0aGlzLmV4cHJlc3NBcHAgPSBhcHA7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBzdGF0aWMgc3RhcnQob3B0aW9uczogUGFyc2VTZXJ2ZXJPcHRpb25zLCBjYWxsYmFjazogPygpPT52b2lkKSB7XG4gICAgY29uc3QgcGFyc2VTZXJ2ZXIgPSBuZXcgUGFyc2VTZXJ2ZXIob3B0aW9ucyk7XG4gICAgcmV0dXJuIHBhcnNlU2VydmVyLnN0YXJ0KG9wdGlvbnMsIGNhbGxiYWNrKTtcbiAgfVxuXG4gIHN0YXRpYyBjcmVhdGVMaXZlUXVlcnlTZXJ2ZXIoaHR0cFNlcnZlciwgY29uZmlnOiBMaXZlUXVlcnlTZXJ2ZXJPcHRpb25zKSB7XG4gICAgaWYgKCFodHRwU2VydmVyIHx8IChjb25maWcgJiYgY29uZmlnLnBvcnQpKSB7XG4gICAgICB2YXIgYXBwID0gZXhwcmVzcygpO1xuICAgICAgaHR0cFNlcnZlciA9IHJlcXVpcmUoJ2h0dHAnKS5jcmVhdGVTZXJ2ZXIoYXBwKTtcbiAgICAgIGh0dHBTZXJ2ZXIubGlzdGVuKGNvbmZpZy5wb3J0KTtcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBQYXJzZUxpdmVRdWVyeVNlcnZlcihodHRwU2VydmVyLCBjb25maWcpO1xuICB9XG5cbiAgc3RhdGljIHZlcmlmeVNlcnZlclVybChjYWxsYmFjaykge1xuICAgIC8vIHBlcmZvcm0gYSBoZWFsdGggY2hlY2sgb24gdGhlIHNlcnZlclVSTCB2YWx1ZVxuICAgIGlmKFBhcnNlLnNlcnZlclVSTCkge1xuICAgICAgY29uc3QgcmVxdWVzdCA9IHJlcXVpcmUoJ3JlcXVlc3QnKTtcbiAgICAgIHJlcXVlc3QoUGFyc2Uuc2VydmVyVVJMLnJlcGxhY2UoL1xcLyQvLCBcIlwiKSArIFwiL2hlYWx0aFwiLCBmdW5jdGlvbiAoZXJyb3IsIHJlc3BvbnNlLCBib2R5KSB7XG4gICAgICAgIGxldCBqc29uO1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGpzb24gPSBKU09OLnBhcnNlKGJvZHkpO1xuICAgICAgICB9IGNhdGNoKGUpIHtcbiAgICAgICAgICBqc29uID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZXJyb3IgfHwgcmVzcG9uc2Uuc3RhdHVzQ29kZSAhPT0gMjAwIHx8ICFqc29uIHx8IGpzb24gJiYganNvbi5zdGF0dXMgIT09ICdvaycpIHtcbiAgICAgICAgICAvKiBlc2xpbnQtZGlzYWJsZSBuby1jb25zb2xlICovXG4gICAgICAgICAgY29uc29sZS53YXJuKGBcXG5XQVJOSU5HLCBVbmFibGUgdG8gY29ubmVjdCB0byAnJHtQYXJzZS5zZXJ2ZXJVUkx9Jy5gICtcbiAgICAgICAgICAgIGAgQ2xvdWQgY29kZSBhbmQgcHVzaCBub3RpZmljYXRpb25zIG1heSBiZSB1bmF2YWlsYWJsZSFcXG5gKTtcbiAgICAgICAgICAvKiBlc2xpbnQtZW5hYmxlIG5vLWNvbnNvbGUgKi9cbiAgICAgICAgICBpZihjYWxsYmFjaykge1xuICAgICAgICAgICAgY2FsbGJhY2soZmFsc2UpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBpZihjYWxsYmFjaykge1xuICAgICAgICAgICAgY2FsbGJhY2sodHJ1ZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gYWRkUGFyc2VDbG91ZCgpIHtcbiAgY29uc3QgUGFyc2VDbG91ZCA9IHJlcXVpcmUoXCIuL2Nsb3VkLWNvZGUvUGFyc2UuQ2xvdWRcIik7XG4gIE9iamVjdC5hc3NpZ24oUGFyc2UuQ2xvdWQsIFBhcnNlQ2xvdWQpO1xuICBnbG9iYWwuUGFyc2UgPSBQYXJzZTtcbn1cblxuZnVuY3Rpb24gaW5qZWN0RGVmYXVsdHMob3B0aW9uczogUGFyc2VTZXJ2ZXJPcHRpb25zKSB7XG4gIE9iamVjdC5rZXlzKGRlZmF1bHRzKS5mb3JFYWNoKChrZXkpID0+IHtcbiAgICBpZiAoIW9wdGlvbnMuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgb3B0aW9uc1trZXldID0gZGVmYXVsdHNba2V5XTtcbiAgICB9XG4gIH0pO1xuXG4gIGlmICghb3B0aW9ucy5oYXNPd25Qcm9wZXJ0eSgnc2VydmVyVVJMJykpIHtcbiAgICBvcHRpb25zLnNlcnZlclVSTCA9IGBodHRwOi8vbG9jYWxob3N0OiR7b3B0aW9ucy5wb3J0fSR7b3B0aW9ucy5tb3VudFBhdGh9YDtcbiAgfVxuXG4gIG9wdGlvbnMudXNlclNlbnNpdGl2ZUZpZWxkcyA9IEFycmF5LmZyb20obmV3IFNldChvcHRpb25zLnVzZXJTZW5zaXRpdmVGaWVsZHMuY29uY2F0KFxuICAgIGRlZmF1bHRzLnVzZXJTZW5zaXRpdmVGaWVsZHMsXG4gICAgb3B0aW9ucy51c2VyU2Vuc2l0aXZlRmllbGRzXG4gICkpKTtcblxuICBvcHRpb25zLm1hc3RlcktleUlwcyA9IEFycmF5LmZyb20obmV3IFNldChvcHRpb25zLm1hc3RlcktleUlwcy5jb25jYXQoXG4gICAgZGVmYXVsdHMubWFzdGVyS2V5SXBzLFxuICAgIG9wdGlvbnMubWFzdGVyS2V5SXBzXG4gICkpKTtcbn1cblxuLy8gVGhvc2UgY2FuJ3QgYmUgdGVzdGVkIGFzIGl0IHJlcXVpcmVzIGEgc3VicHJvY2Vzc1xuLyogaXN0YW5idWwgaWdub3JlIG5leHQgKi9cbmZ1bmN0aW9uIGNvbmZpZ3VyZUxpc3RlbmVycyhwYXJzZVNlcnZlcikge1xuICBjb25zdCBzZXJ2ZXIgPSBwYXJzZVNlcnZlci5zZXJ2ZXI7XG4gIGNvbnN0IHNvY2tldHMgPSB7fTtcbiAgLyogQ3VycmVudGx5LCBleHByZXNzIGRvZXNuJ3Qgc2h1dCBkb3duIGltbWVkaWF0ZWx5IGFmdGVyIHJlY2VpdmluZyBTSUdJTlQvU0lHVEVSTSBpZiBpdCBoYXMgY2xpZW50IGNvbm5lY3Rpb25zIHRoYXQgaGF2ZW4ndCB0aW1lZCBvdXQuIChUaGlzIGlzIGEga25vd24gaXNzdWUgd2l0aCBub2RlIC0gaHR0cHM6Ly9naXRodWIuY29tL25vZGVqcy9ub2RlL2lzc3Vlcy8yNjQyKVxuICAgIFRoaXMgZnVuY3Rpb24sIGFsb25nIHdpdGggYGRlc3Ryb3lBbGl2ZUNvbm5lY3Rpb25zKClgLCBpbnRlbmQgdG8gZml4IHRoaXMgYmVoYXZpb3Igc3VjaCB0aGF0IHBhcnNlIHNlcnZlciB3aWxsIGNsb3NlIGFsbCBvcGVuIGNvbm5lY3Rpb25zIGFuZCBpbml0aWF0ZSB0aGUgc2h1dGRvd24gcHJvY2VzcyBhcyBzb29uIGFzIGl0IHJlY2VpdmVzIGEgU0lHSU5UL1NJR1RFUk0gc2lnbmFsLiAqL1xuICBzZXJ2ZXIub24oJ2Nvbm5lY3Rpb24nLCAoc29ja2V0KSA9PiB7XG4gICAgY29uc3Qgc29ja2V0SWQgPSBzb2NrZXQucmVtb3RlQWRkcmVzcyArICc6JyArIHNvY2tldC5yZW1vdGVQb3J0O1xuICAgIHNvY2tldHNbc29ja2V0SWRdID0gc29ja2V0O1xuICAgIHNvY2tldC5vbignY2xvc2UnLCAoKSA9PiB7XG4gICAgICBkZWxldGUgc29ja2V0c1tzb2NrZXRJZF07XG4gICAgfSk7XG4gIH0pO1xuXG4gIGNvbnN0IGRlc3Ryb3lBbGl2ZUNvbm5lY3Rpb25zID0gZnVuY3Rpb24oKSB7XG4gICAgZm9yIChjb25zdCBzb2NrZXRJZCBpbiBzb2NrZXRzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBzb2NrZXRzW3NvY2tldElkXS5kZXN0cm95KCk7XG4gICAgICB9IGNhdGNoIChlKSB7IC8qICovIH1cbiAgICB9XG4gIH1cblxuICBjb25zdCBoYW5kbGVTaHV0ZG93biA9IGZ1bmN0aW9uKCkge1xuICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKCdUZXJtaW5hdGlvbiBzaWduYWwgcmVjZWl2ZWQuIFNodXR0aW5nIGRvd24uJyk7XG4gICAgZGVzdHJveUFsaXZlQ29ubmVjdGlvbnMoKTtcbiAgICBzZXJ2ZXIuY2xvc2UoKTtcbiAgICBwYXJzZVNlcnZlci5oYW5kbGVTaHV0ZG93bigpO1xuICB9O1xuICBwcm9jZXNzLm9uKCdTSUdURVJNJywgaGFuZGxlU2h1dGRvd24pO1xuICBwcm9jZXNzLm9uKCdTSUdJTlQnLCBoYW5kbGVTaHV0ZG93bik7XG59XG5cbmV4cG9ydCBkZWZhdWx0IFBhcnNlU2VydmVyO1xuIl19