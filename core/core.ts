import createError from 'http-errors';
import express from 'express';
import compress from 'compression';
import path from 'path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import * as bodyparser from 'body-parser';

// Monitoring.
// const logger = require('morgan');
const health = require('@cloudnative/health-connect');

import { UsersRoutes } from './routes/users.routes.config';
import { NodesRoutes } from './routes/nodes.routes.config';

import { UserRegistration } from './services/userRegistration';
import { NodeRegistration } from './services/nodeRegistration';
import { PackageRegistration } from '../cli/services/packageRegistration';

// Dynamic code loading.
//require('../assets/npm-bundle.js');

var core = express();

async function Main() {

  core.use(compress());
  core.use(express.json());
  core.use(express.urlencoded({ extended: false }));
  core.use(cookieParser());
  
  let healthcheck = new health.HealthChecker();
  core.use('/health', health.LivenessEndpoint(healthcheck));
  
  // here we are adding middleware to parse all incoming requests as JSON 
  core.use(bodyparser.json());
  // here we are adding middleware to allow cross-origin requests
  core.use(cors());
  // The logger goes after CORS.
  //core.use(logger('dev'));
  
  
  core.use(express.static(path.join(__dirname, 'public')));
  
  // USE DEPENDENCY INJECTION WHEN THIS GETS UNRULY :P

  // Service bootstraping
  // TODO: VOLUMES/SERVICES SETUP?
  let packageRegistrationService = new PackageRegistration();
  await packageRegistrationService.init();

  let userRegistrationService = new UserRegistration(packageRegistrationService);
  await userRegistrationService.init();

  let nodeRegistrationService = new NodeRegistration();
  await nodeRegistrationService.init();

  // let nodeDeploymentService = new 
  // TODO: Watch for the node so that I can deploy admin pods?
  // Create or load a local node on the edge that will pass along my configuration (that it's core)
  // bootstrap PodService here

  // here we are adding the UserRoutes to our array,
  // after sending the Express.js application object to have the routes added to our app!
  new UsersRoutes(core, userRegistrationService);
  new NodesRoutes(core, nodeRegistrationService); // On users+databases(renamed? < set up differ3ntly(harder))
  
  // catch 404 and forward to error handler
  core.use(function(req, res, next) {
    next(createError(404));
  });
  
  // error handler
  core.use(function(err, req, res, next) {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};
  
    // render the error page
    res.status(err.status || 500);
    res.render('error');
  });
  
}
Main();


module.exports = core;
