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
import { PodConfigManager } from './services/podConfigManager';
import { UserAuth } from '../shared/objectmodels/userAuth';
import { PodNumManager } from './services/podNumManager';
import { Router } from './services/router';
import { RequestManager } from './services/requestManager';
import { Requester } from './services/requester';
import { NodeUser } from '../shared/objectmodels/nodeUser';

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

  let nodeUser = new NodeUser({
      server: undefined,
      arg: {}
    },
    true
  );
  nodeUser.init();


  // TODO: Use DI instead when there are too many dependencies.
  let nodeBootstrapService = new NodeBootstrap();
  await nodeBootstrapService.init();

  let deployManagerService = new PodManager(nodeBootstrapService);
  await deployManagerService.init();

  // TODO: Security problem, please make the PodConfigManager handle multiple nodes.
  let user = new UserAuth({
    server: undefined,
    arg: undefined
  }, true);
  await user.load();

  let podConfigService = new PodConfigManager(user);
  await podConfigService.init();

  let podNumService = new PodNumManager(user);
  await podNumService.init();

  let router = new Router(user);
  await router.init();

  /* #region  Testing the request pipeline, has to set the package.isService = true. */
  let serviceUser = {
    state: {
      name: process.env.STARK_SERVICES_NODE_NAME,
      password: process.env.STARK_SERVICES_NODE_PASSWORD
    }
  };

  // TODO: Use in a service
  let requestManager = new RequestManager({
    user: serviceUser,
    name: 'stark-core-config',
    podIndex: 0
  });
  await requestManager.init();
  requestManager.add(async request => {
    return request.arg;
  });

  let requester = new Requester({
    nodeUser: nodeUser,
    serviceUser: serviceUser,
    name: 'stark-core-config',
    services: ['stark-core-config'],
    podIndex: 0
  });
  await requester.init();
  
  let result = await requester.add({
    service: 'stark-core-config',
    isNew: true,
    isRemote: true,  // Also important to test: false,
    source: requester.serviceNodeDb.dbName,
    sourcePod: 0,
    timeNew: new Date().getTime(),
    arg: 'HELLO WORLD!!!'
  });
  console.log(`The request was successful. Result: ${result}`);
  /* #endregion */
}
Main();

module.exports = edge;
