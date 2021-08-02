import PouchDB from 'pouchdb';
PouchDB.plugin(require('pouchdb-authentication'));

import { UserAdmin } from '../objectmodels/userAdmin';
import { NodeUser } from '../objectmodels/nodeUser';
import { Database } from '../../shared/objectmodels/database';
import { Replication } from '../objectmodels/replication';
import { NodeConfig } from '../objectmodels/nodeConfig';
import { UserConfig } from '../objectmodels/userConfig';
import { DatabaseSecurity } from '../objectmodels/databaseSecurity';
import { PodConfig } from '../objectmodels/podConfig';
import { DesignDocument } from '../objectmodels/designDocument';

// TODO EDGE: BOOTSTRAP by asking for the user name and their deploy password
// True even for cases where I don't really care about copying the value of the user key because any browser will sign into the user.
// Ephemeral login ? maybe not ? could be the CLI through isomorphic JS

// TODO: Update with "Auth to register" admin/user setting

/**
 * Node
 * Depends on having previously initialized the admin data.
 * TODO: Make a node(object!) and SOLID the sub-types NodeUser and NodeConfig...
 */
export class NodeRegistration {
  
  async init() {

  }

  async add(arg) { 
    let userDatabase = new Database({ arg: { username: arg.username }, username: process.env.STARK_USER_NAME, password: process.env.STARK_USER_PASSWORD });
        
    let adminDatabase = new Database({ arg: { username: UserAdmin.AdminName }, username: process.env.STARK_USER_NAME, password: process.env.STARK_USER_PASSWORD });
    await adminDatabase.load();
    adminDatabase.state.setSchema(this.userDbSchema);
    
    let adminConfig = new UserConfig({ db: adminDatabase.state, arg: { name: UserAdmin.AdminName} });
    await adminConfig.load();

    if (!adminConfig.state.enableAllNodes) { return; }
    
    await userDatabase.load();
    userDatabase.state.setSchema(this.userDbSchema);

    let userConfig = new UserConfig({ db: userDatabase.state, arg: { name: arg.username } });
    await userConfig.load();

    if (!userConfig.state.enableNodes) { return; }

    let usersDb = new PouchDB(`http://${process.env.STARK_USER_NAME}:${process.env.STARK_USER_PASSWORD}@${process.env.STARK_DB_HOST}:5984/_users`, {
      skip_setup: true
    });

    let nodeUser = new NodeUser(
      {
        db: usersDb,
        arg: arg
      },
      true
    );
    await nodeUser.save();

    let nodeDatabase = new Database({ arg: { username: nodeUser.argValid.name }, username: process.env.STARK_USER_NAME, password: process.env.STARK_USER_PASSWORD });
    await nodeDatabase.load();
    nodeDatabase.state.setSchema(this.nodeDbSchema);
    
    let designDocument = new DesignDocument(
        {
            db: nodeDatabase.state,
            arg: undefined
        },
        true
    );
    designDocument.init();
    await designDocument.save();    

    let databaseReplication = new Replication(
      {
        source: nodeDatabase.dbName,
        target: userDatabase.dbName,
        filter: "replicate/hasTypes",
        query_params: {
          types: [
            "nodeConfig"
          ]
        }
      },
      true
    );
    await databaseReplication.save();

    let nodeConfig = new NodeConfig(
      {
        db: nodeDatabase.state,
        userConfig: userConfig,
        arg: {
          ...arg, ...{
            password: undefined, 
            userConfig: userConfig.state.id,
            dbName: nodeDatabase.dbName,
            replication: {
              id: databaseReplication.state.id,
              rev: databaseReplication.state.rev
            }
          }
        }
      },
      true
    );
    await nodeConfig.save();

    // Open security rights from each user to the resource.
    let databaseSecurity = new DatabaseSecurity({
      db: nodeDatabase.state,
      arg: {
        username: arg.username,
        nodeUsername: nodeUser.argValid.name
      }
    }, true);
    await databaseSecurity.load();
    await databaseSecurity.save();

    // TODO: Bootstrap packages from OWN USER!
    // On the edge, get own nodeConfig, install, and report status
    // The service can watch for changes so the bootstrap is a 1-time
    // version of the bootstraped pod from Admin.
    //
    // INFO: Only Availability.Any gets deployed here, means bootstrap only.
    let podConfig = new PodConfig({
      db: nodeDatabase.state,
      arg: {
        userDb: userDatabase.state,
        mode: arg.mode
      }
    }, true);
    await podConfig.load();

    // Update the deployed packages!
    let deploys = new Set();
    for (let pod of podConfig.state) { 
      deploys.add(pod.name);
    }
    nodeConfig.state.podConfigs = Array.from(deploys);
    await nodeConfig.save();
    // Frees the memory here and saves the packages to the DB.
    await podConfig.save();

    
    /* #region  Setup services databases. */
    
    // TODO: Move routers to trusted core/edge pod, reset when status -> 0, update per core/edge pod num;
    userConfig.state.numRouters += 1;
    await userConfig.save();

    let nodeServices = new NodeUser({
        db: usersDb,
        arg: {...arg, ...{ name: `services-${arg.name}` }}
      },
      true
    );
    await nodeServices.save();

    let servicesDatabase = new Database({ arg: { username: nodeServices.argValid.name }, username: process.env.STARK_USER_NAME, password: process.env.STARK_USER_PASSWORD });
    await servicesDatabase.load();

    let servicesDesignDocument = new DesignDocument({
        db: servicesDatabase.state,
        arg: undefined
      },
      true
    );
    servicesDesignDocument.init();
    await servicesDesignDocument.save();

    let servicesDatabaseSecurity = new DatabaseSecurity({
      db: servicesDatabase.state,
      arg: {
        username: arg.username,
        nodeUsername: nodeServices.argValid.name
      }
    }, true);
    await servicesDatabaseSecurity.load();
    await servicesDatabaseSecurity.save();

    let servicesUserDatabase = new Database({ arg: { username: `services-${arg.username}` }, username: process.env.STARK_USER_NAME, password: process.env.STARK_USER_PASSWORD });
    await  servicesUserDatabase.load();

    let requestsReplication = new Replication(
      {
        source: servicesDatabase.dbName,
        target: servicesUserDatabase.dbName,
        filter: "replicate/hasTypesSrcRemote",
        query_params: {
          types: [
            "request"
          ],
          source: servicesDatabase.dbName
        }
      },
      true
    );
    await requestsReplication.save();

    
    let responseSrcReplication = new Replication(
      {
        source: servicesDatabase.dbName,
        target: servicesUserDatabase.dbName,
        filter: "replicate/hasTypesSrcRemote",
        query_params: {
          types: [
            "response"
          ],
          source: servicesDatabase.dbName
        }
      },
      true
    );
    await responseSrcReplication.save();

    let responseEndReplication = new Replication(
      {
        source: servicesUserDatabase.dbName,
        target: servicesDatabase.dbName,
        filter: "replicate/hasTypesDest",
        query_params: {
          types: [
            "response"
          ],
          target: servicesDatabase.dbName
        }
      },
      true
    );
    await responseEndReplication.save();
    /* #endregion */

  }
  
  private userDbSchema = [
    { singular: 'packageConfig', plural: 'packageConfigs' },
    {
      singular: 'userConfig', plural: 'userConfigs', 
      relations: {
        nodeConfigs: {hasMany: 'nodeConfig'}
      }
    },
    {singular: 'nodeConfig', plural: 'nodeConfigs', relations: {userConfig: {belongsTo: 'userConfig'}}}
  ];
  private nodeDbSchema = [
    { singular: 'podConfig', plural: 'podConfigs' },
    {
      singular: 'userConfig', plural: 'userConfigs', 
      relations: {
        nodeConfigs: {hasMany: 'nodeConfig'}
      }
    },
    {singular: 'nodeConfig', plural: 'nodeConfigs', relations: {userConfig: {belongsTo: 'userConfig'}}}
  ];
}