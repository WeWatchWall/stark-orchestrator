import { Database } from "../../shared/objectmodels/database";
import { NodeUser } from "../../shared/objectmodels/nodeUser";
import { PodBalancer } from "../../shared/objectmodels/podBalancer";
import { UserConfig } from "../../shared/objectmodels/userConfig"; 
import { NodeConfig } from "../objectmodels/nodeConfig";

export class PodNumManager {
  user: any;
  userDb: any;
  userConfig: any;

  nodeUser: any;
  nodeConfig: any;
  nodeDb: any;

  podBalancers = {};

  addWatcher: any;
  isDeleting = false;

  constructor(user: any) {
    this.user = user;
  }

  async init() {
    /* #region  Initializing the environment properties. */
    this.userDb = new Database({
        arg: { username: this.user.state.name },
        username: this.user.state.name,
        password: this.user.state.password
      });
    await this.userDb.load();
    this.userDb.state.setSchema(this.userDbSchema);

    this.userConfig = new UserConfig({ db: this.userDb.state, arg: { name: this.user.state.name} });
    await this.userConfig.init();

    this.nodeUser = new NodeUser({
        server: undefined,
        arg: {}
      },
      true
    );
    this.nodeUser.init();

    this.nodeDb = new Database({
        arg: { username: this.nodeUser.argValid.name },
        username: this.nodeUser.argValid.name,
        password: this.nodeUser.argValid.password
    });
    await this.nodeDb.load();
    this.nodeDb.state.setSchema(this.nodeDbSchema);

    this.nodeConfig = new NodeConfig(
      {
        db: this.nodeDb.state,
        arg: {}
      },
      true
    );
    this.nodeConfig.init();
    await this.nodeConfig.load();
    /* #endregion */

    /* #region  Get pre-existing pods */
    let prePodConfigs = (
      await this.nodeDb.state.find({
        selector: {
          _id: { $regex: "^podConfig" },
          data: {
            mode: this.nodeConfig.state.mode
          }
        }
      })
    ).docs;

    for (let prePodConfig of prePodConfigs) {
      await this.add(prePodConfig);
    }
    /* #endregion */
      
    /* #region  Watch the user's DB for changes to the pod. */
    var self = this;
    this.addWatcher = this.nodeDb.state
      .changes({
        since: "now",
        live: true,
        include_docs: true,
        selector: {
          _id: { $regex: "^podConfig" }
        }
      })
      .on('change', async function (change) {
        let doc = change.doc;

        if (change.deleted || !change.doc._attachments) {
          return;
        }

        let newPodName = doc.data.name;
        if (!self.podBalancers[newPodName]) {
          self.podBalancers[newPodName] = 'init';
          await self.add(doc);
          return;
        }
      });
    /* #endregion */
  }

  // Internally used on watching
  async add(podDoc) {
    let balancer = new PodBalancer({
      dbs: {
        userDb: this.userDb.state,
        nodeDb: this.nodeDb.state
      },
      arg: {
        userConfig: this.userConfig,
        id: podDoc._id,
        name: podDoc.data.name,
        mode: podDoc.data.mode
      }
    });

    var self = this;
    balancer.eventEmitter.on('delete', async function () {
      await self.delete(balancer.argValid.name);
    });

    await balancer.init();
    this.podBalancers[podDoc.data.name] = balancer;
  }
  
  async delete(podName) {
    let podBalancer = this.podBalancers[podName];
    await podBalancer.delete();
    this.podBalancers[podName] = undefined;
  }
    
  private async deleteAll() {
    let packNames = [...Object.keys(this.podBalancers)]; // Copying an array with the spread operator :)

    packNames.forEach(packName => {
      this.delete(packName);
    });
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