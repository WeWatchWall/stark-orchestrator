import { PodBalancer } from "../objectmodels/podBalancer";

export class PodNumManager {
  arg;
  podBalancers = {};
  addWatcher: any;

  constructor(userDb, userConfig, nodeDb, nodeConfig) {
    this.arg = {userDb, userConfig, nodeDb, nodeConfig};
  }

  async init() {
    /* #region  Get pre-existing pods */
    let prePodConfigs = (
      await this.arg.nodeDb.state.find({
        selector: {
          _id: { $regex: "^podConfig" },
          data: {
            mode: this.arg.nodeConfig.state.mode
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
    this.addWatcher = this.arg.nodeDb.state
      .changes({
        since: "now",
        live: true,
        retry: true,
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
        userDb: this.arg.userDb.state,
        nodeDb: this.arg.nodeDb.state
      },
      arg: {
        userConfig: this.arg.userConfig,
        nodeConfig: this.arg.nodeConfig,
        id: podDoc._id,
        name: podDoc.data.name,
        mode: podDoc.data.mode
      }
    });

    var self = this;
    balancer.eventEmitter.on('delete', async () => {
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
}