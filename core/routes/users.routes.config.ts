import {CommonRoutesConfig} from '../../common.routes.config';
import express from 'express';
import { UserRegistration } from '../services/userRegistration';

// ONLY ON CORE NOT EXTERNAL SERVER
// Respond to the admin settings accordingly in this signUp API.
// ADMIN NEW USER ALLOWED OPTION Refactor my routes into re-usable "interface" perhaps in objectmodel.
// TODO: a setup script in core.ts that creates the ADMIN data.
// Side-load admin -- it can be edited which is probably
export class UsersRoutes extends CommonRoutesConfig {
  userService: UserRegistration;

  constructor(app: express.Application, userService: UserRegistration) {
    super(app, 'UsersRoutes');
    this.userService = userService;
    }

    configureRoutes() {

    this.app.route(`/users/:userId`)
      .all((req: express.Request, res: express.Response, next: express.NextFunction) => {
        // this middleware function runs before any request to /users/:userId
        // but it doesn't accomplish anything just yet---
        // it simply passes control to the next applicable function below using next()
        next();
      })
      
      // TODO: Request password change email for user
      // http://sahatyalkabov.com/how-to-implement-password-reset-in-nodejs/
      // .get((req: express.Request, res: express.Response) => {
        // res.status(200).json(`GET requested for id ${req.params.nodeId}`);
      // })

      // Only Admin/root disables this. Auto-disabled for non-core mode
      // If this is deactivated for the Nodes, 
      // Then the database is logged in through a previously registered prepared node/user.
      .put(async (req: express.Request, res: express.Response) => {
        try {
          await this.userService.add(req.body);
          res.status(201).json();
        }
        catch (error) { 
          if ([404, 409].includes(error.status)) {
            res.status(error.status).json(error);
            return;
          }

          res.status(500).json();
        }

        // TODO
        // https://nodemailer.com/about/
        // Send the user an email with their username 
        // Users just make new account, expire the old databases 

        
      });
      
      // TODO: Verify user by email with different TOKEN...
      // TODO: Set new password for user with TOKEN (crypto.randomBytes(20))  
      // .patch((req: express.Request, res: express.Response) => {
        // res.status(200).json(`PATCH requested for id ${req.params.nodeId}`);
      // })
    
      // TODO AUTH WITH DB CREDENTIALS
      // .delete((req: express.Request, res: express.Response) => {
        // let user = new User(req.body);
        // await user.delete();
        // res.status(200).json();
      // });

    return this.app;
    }

}