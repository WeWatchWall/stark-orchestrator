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
  podConfigsId = {};

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
    let prePodConfigs = (
      await this.nodeDb.state.find({
        selector: {
          _id: { $regex: "^podConfig" },
          data: {
            mode: this.nodeConfig.state.mode,
          },
        },
      })
    ).docs;

    for (let prePodConfig of prePodConfigs) {
      await this.add(prePodConfig._id, prePodConfig.data.name);
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
          _id: { $regex: "^packageConfig" },
        },
      })
      .on("change", async function (change) {
        if (change.deleted) {
          self.delete(change.doc._id);
          return;
        }

        let newPodName = change.doc.data.name;
        let newPodId = change.doc._id;
        if (!self.podConfigs[newPodName] && change.doc._attachments) {
          self.add(newPodId, newPodName);
        }
      });
    /* #endregion */
  }

  // Internally used on watching
  async add(podId: string, podName: string) {
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
    this.podConfigsId[podId] = podConfig;
    this.podConfigs[podName] = podConfig;

    await podConfig.save();
  }

  // TODO: Retrieve by Id.
  async delete(podId: string) {
    let podConfig = this.podConfigsId[podId];
    let podName = podConfig.arg.name;

    podConfig.delete();

    this.podConfigsId[podId] = undefined;
    this.podConfigs[podName] = undefined;
  }
}
