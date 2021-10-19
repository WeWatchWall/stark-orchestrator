import createError from 'http-errors';
import express from 'express';
import compress from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import * as bodyparser from 'body-parser';

// Monitoring.
// const logger = require('morgan');
const health = require('@cloudnative/health-connect');

import { NodeBootstrap } from './services/nodeBootstrap';
import { PodManager } from './services/podManager';
import { PodConfigManager } from '../shared/services/podConfigManager';
import { UserAuth } from '../edge/objectmodels/userAuth';
import { PodNumManager } from '../shared/services/podNumManager';
import { NodeUserLean } from '../edge/objectmodels/nodeUserLean';
import { Database } from '../shared/objectmodels/database';
import { UserConfig } from '../shared/objectmodels/userConfig';
import { NodeConfig } from './objectmodels/nodeConfig';

// import { Router } from '../shared/services/router';
// import { RequestManager } from '../shared/services/requestManager';
// import { Requester } from '../shared/services/requester';
// import { RequestMode } from '../shared/objectmodels/requestMode';

var edge = express();

async function Main() {

  edge.use(compress());
  edge.use(express.json());
  edge.use(express.urlencoded({ extended: false }));
  edge.use(cookieParser());

  let healthcheck = new health.HealthChecker();
  edge.use('/health', health.LivenessEndpoint(healthcheck));

  // here we are adding middleware to parse all incoming requests as JSON 
  edge.use(bodyparser.json());
  // here we are adding middleware to allow cross-origin requests
  edge.use(cors());
  // The logger goes after CORS.
  //edge.use(logger('dev'));


  // edge.use(express.static(path.join(__dirname, 'public')));

  // here we are adding the UserRoutes to our array,
  // after sending the Express.js application object to have the routes added to our app!
  // new UsersRoutes(edge);
  // new NodesRoutes(edge); // On users+databases(renamed? < set up differ3ntly(harder))

  // catch 404 and forward to error handler
  edge.use(function (req, res, next) {
    next(createError(404));
  });

  // error handler
  edge.use(function (err, req, res, next) {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    // render the error page
    res.status(err.status || 500);
    res.render('error');
  });

  // TODO: Use Dependency Injection.

  /* #region  Declare the schemas. */
  let userDbSchema = [
    { singular: 'packageConfig', plural: 'packageConfigs' },
    {
      singular: 'userConfig', plural: 'userConfigs',
      relations: {
        nodeConfigs: { hasMany: 'nodeConfig' }
      }
    },
    { singular: 'nodeConfig', plural: 'nodeConfigs', relations: { userConfig: { belongsTo: 'userConfig' } } }
  ];
  let nodeDbSchema = [
    { singular: 'podConfig', plural: 'podConfigs' },
    { singular: 'nodeConfig', plural: 'nodeConfigs' }
  ];
  let serviceDbSchema = [
    { singular: 'request', plural: 'requests' },
    { singular: 'response', plural: 'responses' }
  ];
  /* #endregion */

  /* #region  Initializing the environment properties. */
  let nodeBootstrapService = new NodeBootstrap();
  await nodeBootstrapService.init();

  let dbServer = process.env.STARK_DB_HOST;

  // TODO: Security problem, please make the "trusted services" handle multiple nodes.
  let user = new UserAuth({
    server: undefined,
    arg: undefined
  }, true);
  await user.load();

  let userDb = new Database({
    arg: { username: user.state.name, dbServer: dbServer },
    username: user.state.name,
    password: user.state.password
  });
  await userDb.load();
  userDb.state.setSchema(userDbSchema);

  let userConfig = new UserConfig({ db: userDb.state, arg: { name: user.state.name } });
  await userConfig.init();

  let userServiceDb = new Database({
    arg: { username: `services-${user.state.name}`, dbServer: dbServer },
    username: user.state.name,
    password: user.state.password
  });
  await userServiceDb.load();
  userServiceDb.state.setSchema(serviceDbSchema);

  let nodeUser = new NodeUserLean({
    server: undefined,
    arg: {}
  },
    true
  );
  nodeUser.init();

  let nodeDb = new Database({
    arg: { username: nodeUser.argValid.name, dbServer: dbServer },
    username: nodeUser.argValid.name,
    password: nodeUser.argValid.password
  });
  await nodeDb.load();
  nodeDb.state.setSchema(nodeDbSchema);

  let nodeConfig = new NodeConfig(
    {
      db: nodeDb.state,
      arg: {}
    },
    true
  );
  nodeConfig.init();
  await nodeConfig.load();

  let nodeServiceUser = {
    state: {
      name: process.env.STARK_SERVICES_NODE_NAME,
      password: process.env.STARK_SERVICES_NODE_PASSWORD
    }
  };

  let serviceNodeDb = new Database({
    arg: { username: nodeServiceUser.state.name, dbServer },
    username: user.state.name,
    password: user.state.password
  });
  await serviceNodeDb.load();
  serviceNodeDb.state.setSchema(serviceDbSchema);
  /* #endregion */

  // Can also use DI instead when there are too many dependencies.
  /* #region  Initializing the users' "trusted" orchestrator services. */
  let deployManagerService = new PodManager(nodeBootstrapService);
  await deployManagerService.init();

  let podConfigService = new PodConfigManager(userDb, userConfig, nodeConfig, nodeDb);
  await podConfigService.init();

  let podNumService = new PodNumManager(userDb, userConfig, nodeDb, nodeConfig);
  await podNumService.init();
  /* #endregion */

  /* #region  Testing the request pipeline, has to set the package.isService = true. */
  // TODO: Use in a service
  // let router = new Router(user, dbServer, userDb, userConfig, userServiceDb, nodeConfig);
  // await router.init();

  // let requestManager = new RequestManager({
  //   user: nodeServiceUser,
  //   name: 'stark-core-config',
  //   podIndex: 0
  // },
  // serviceNodeDb);
  // await requestManager.init();
  // requestManager.add(async request => {
  //   return request.arg;
  // });

  // let requester = new Requester({
  //   serviceUser: nodeServiceUser,
  //   name: 'stark-core-config',
  //   services: ['stark-core-config'],
  //   podIndex: 0
  // }, nodeDb, nodeConfig, serviceNodeDb);
  // await requester.init();

  // let response = await requester.add({
  //   service: 'stark-core-config',
  //   mode: RequestMode.Single,
  //   isRemote: true,  // Also important to test: false,
  //   arg: 'HELLO WORLD!!!'
  // });
  // console.log(`The request was successful. Result: ${response.result}`);
  /* #endregion */
}
Main();

module.exports = edge;
