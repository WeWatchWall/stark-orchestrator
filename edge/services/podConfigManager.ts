import { Database } from "../../shared/objectmodels/database";
import { NodeUser } from "../../shared/objectmodels/nodeUser";
import { NodeConfig } from "../objectmodels/nodeConfig";
import { PodConfig } from "../objectmodels/podConfig";

export class PodConfigManager {
  user: any;
  userDb: any;

  nodeUser: any;
  nodeConfig: any;
  nodeDb: any;

  podConfigs = {};
  packConfigsId = {};

  addWatcher: any;

  constructor(user: any) {
    this.user = user;
  }

  async init() {
    /* #region  Initializing the environment properties. */
    this.userDb = new Database({
      arg: { username: this.user.state.name },
      username: this.user.state.name,
      password: this.user.state.password,
    });
    await this.userDb.load();

    this.nodeUser = new NodeUser(
      {
        server: undefined,
        arg: {},
      },
      true
    );
    this.nodeUser.init();

    this.nodeDb = new Database({
      arg: { username: this.nodeUser.arg.name },
      username: this.nodeUser.arg.name,
      password: this.nodeUser.arg.password,
    });
    await this.nodeDb.load();

    this.nodeConfig = new NodeConfig(
      {
        db: this.nodeDb.state,
        arg: {},
      },
      true
    );
    this.nodeConfig.init();
    await this.nodeConfig.load();
    /* #endregion */

    /* #region  Get pre-existing pods */
    // TODO: I HAVE TO CHECK THE LOGIC FOR SECURITY, AVAILABILITY, TAGS, ... AND ALSO NUMBER OF NODES, MAX NODES SOON
    let prePackConfigs = (
      await this.userDb.state.find({
        selector: {
          _id: { $regex: "^packageConfig" },
          data: {
            mode: this.nodeConfig.state.mode,
          }
        }
      })
    ).docs;

    for (let prePackConfig of prePackConfigs) {
      await this.add(prePackConfig._id, prePackConfig.data.name);
    }
    /* #endregion */

    /* #region  Watch the user's DB for changes to the package. */
    // TODO: I HAVE TO CHECK THE LOGIC FOR SECURITY, AVAILABILITY, TAGS, ... AND ALSO NUMBER OF NODES, MAX NODES SOON
    var self = this;
    this.addWatcher = this.userDb.state
      .changes({
        since: "now",
        live: true,
        include_docs: true,
        selector: {
          _id: { $regex: "^packageConfig" }
        }
      })
      .on('change', async function (change) {
        if (change.deleted) {
          self.delete(change.doc._id);
          return;
        }

        let newPodName = change.doc.data.name;
        let newPackId = change.doc._id;
        if (!self.podConfigs[newPodName] && change.doc._attachments) {
          self.add(newPackId, newPodName);
        }
      });
    /* #endregion */
  }

  // Internally used on watching
  async add(podId: string, podName: string) {
    /* #region  Create and save the PodConfig. */
    let podConfig = new PodConfig(
      {
        db: this.nodeDb.state,
        arg: {
          userDb: this.userDb.state,
          name: podName,
          mode: this.nodeConfig.state.mode,
        },
      },
      true
    );
    await podConfig.save();
    
    this.packConfigsId[podId] = podConfig;
    this.podConfigs[podName] = podConfig;

    /* #endregion */

    /* #region  Get, add pod name, and save the NodeConfig. */
    await this.nodeConfig.load();
    let podConfigs = new Set(this.nodeConfig.state.podConfigs);
    podConfigs.add(podName);
    this.nodeConfig.state.podConfigs = Array.from(podConfigs);
    await this.nodeConfig.save();
    /* #endregion */
  }

  // TODO: Retrieve by Id.
  async delete(podId: string) {
    /* #region  Get pod by Id and retrieve its name. */
    let podConfig = this.packConfigsId[podId];
    let podName = podConfig.arg.name;
    /* #endregion */

    /* #region  Get, remove pod name, and save the NodeConfig. */
    await this.nodeConfig.load();
    let podConfigs = new Set(this.nodeConfig.state.podConfigs);
    podConfigs.delete(podName);
    this.nodeConfig.state.podConfigs = Array.from(podConfigs);
    await this.nodeConfig.save();
    /* #endregion */

    podConfig.delete();

    /* #region  Accounting. */
    this.packConfigsId[podId] = undefined;
    this.podConfigs[podName] = undefined;
    /* #endregion */
  }
}
