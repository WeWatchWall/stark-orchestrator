import { CommonRoutesConfig } from '../../common.routes.config';
import express from 'express';
import { NodeRegistration } from '../services/nodeRegistration';

// ONLY ON CORE NOT EXTERNAL SERVER
// TODO: MAKE AUTH VERSION for this.
// Respond to the admin and per-user settings accordingly in this signUp API.
export class NodesRoutes extends CommonRoutesConfig {
  nodeService: NodeRegistration;
  
  constructor(app: express.Application, nodeService: NodeRegistration) {
    super(app, 'NodesRoutes');
    this.nodeService = nodeService;
    }

    configureRoutes() {

    this.app.route(`/nodes/:nodeId`)
      .all((req: express.Request, res: express.Response, next: express.NextFunction) => {
        // this middleware function runs before any request to /nodes/:nodeId
        // but it doesn't accomplish anything just yet---
        // it simply passes control to the next applicable function below using next()
        next();
      })
      
      
      // If this is deactivated for the Nodes, 
      // Then the database is logged in through a previously registered prepared node/user.
      // But not for non-core server...
      .put(async (req: express.Request, res: express.Response) => {
        try { 
          await this.nodeService.add(req.body);
          res.status(201).json();
        }
        catch (error) { 
          if ([404, 409].includes(error.status)) {
            res.status(error.status).json(error);
            return;
          }

          res.status(500).json();
        }
        
      });

    // TODO: Easier is to delete old nodes automatically and they have to be recreated.

    return this.app;
    }

}