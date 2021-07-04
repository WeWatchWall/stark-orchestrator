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
  edge.use(function(req, res, next) {
    next(createError(404));
  });
  
  // error handler
  edge.use(function(err, req, res, next) {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};
  
    // render the error page
    res.status(err.status || 500);
    res.render('error');
  });

  // Set up services, there are no services for these routes....for now ;)
  // TODO: Finish Edge objectmodel+services https://www.npmjs.com/package/update-dotenv
  
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

}
Main();

module.exports = edge;
