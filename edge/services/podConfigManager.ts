import { Availability } from "../../shared/objectmodels/availability";
import { Database } from "../../shared/objectmodels/database";
import { NodeUser } from "../../shared/objectmodels/nodeUser";
import { UserConfig } from "../../shared/objectmodels/userConfig";
import { Util } from "../../shared/util";
import { NodeConfig } from "../objectmodels/nodeConfig";
import { PodConfig } from "../objectmodels/podConfig";

export class PodConfigManager {
  user: any;
  userDb: any;
  userConfig: any;

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
      password: this.user.state.password
    });
    await this.userDb.load();
    this.userDb.state.setSchema(this.userDbSchema);

    this.userConfig = new UserConfig({ db: this.userDb.state, arg: { name: this.user.state.name} });
    await this.userConfig.init();

    this.nodeUser = new NodeUser(
      {
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
    let prePackConfigs = (
      await this.userDb.state.find({
        selector: {
          _id: { $regex: "^packageConfig" },
          data: {
            mode: this.nodeConfig.state.mode,
            $or: [
              {availability: Availability.Any}, {availability: Availability.Tag}
            ]
          }
        }
      })
    ).docs;

    for (let prePackConfig of prePackConfigs) {
      await this.add(prePackConfig);
    }
    /* #endregion */

    /* #region  Watch the user's DB for changes to the package. */
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
        let doc = change.doc;

        if (change.deleted) {
          await self.delete(doc._id);
          return;
        }

        let newPodName = doc.data.name;
        if (!self.podConfigs[newPodName] && self.isAvailable(doc)) {
          self.packConfigsId[doc._id] = 'init';
          self.podConfigs[doc.data.name] = 'init';

          await self.add(doc);
          return;
        }

        if (self.podConfigs[newPodName] && !self.isAvailable(doc)) {
          await self.delete(doc._id);
          return;
        }
      });
    /* #endregion */

    this.nodeConfig.eventEmitter.on('delete', async () => {
      await self.deleteAll();
    });
  }

  // Internally used on watching
  async add(packageDoc) {
    let podId = packageDoc._id;
    let podName = packageDoc.data.name;

    /* #region  Create and save the PodConfig. */
    let podConfig = new PodConfig(
      {
        db: this.nodeDb.state,
        arg: {
          userDb: this.userDb.state,
          name: podName,
          mode: this.nodeConfig.state.mode,
          node: this.nodeConfig.state.name
        },
      },
      true
    );
    await podConfig.save();
    
    this.packConfigsId[podId] = podConfig;
    this.podConfigs[podName] = podConfig;

    /* #endregion */

    /* #region  Get, add pod name, and save the NodeConfig. */
    // TODO: Replace with upsert: https://pouchdb.com/guides/conflicts.html#two-types-of-conflicts
    await Util.retry(async (retry) => {
      try {
        await this.nodeConfig.load();
        let podConfigs = new Set(this.nodeConfig.state.podConfigs);
        podConfigs.add(podName);
        this.nodeConfig.state.podConfigs = Array.from(podConfigs);
        await this.nodeConfig.save();
      } catch (error) {
        retry(error)
      }
    }, 8);
    /* #endregion */
  }

  private isAvailable(packageDoc): boolean {
    if (!this.userConfig.state.enablePods) { return false; }
    if (!this.nodeConfig.state.availability) { return false; }

    if (!packageDoc._attachments) { return false; }
    if (packageDoc.data.mode !== this.nodeConfig.state.mode) { return false; }
    if (!packageDoc.data.availability) { return false; }

    if (packageDoc.data.availability === Availability.Tag) {
      let nodeDoc = this.nodeConfig.state;

      packageDoc.data.tags.forEach(tag => {
        if (nodeDoc.tags.indexOf(tag) === -1) { return false; }
      });
      
      return true;
    }

    return true;
  }

  // TODO: Retrieve by Id.
  async delete(podId: string) {
    /* #region  Get pod by Id and retrieve its name. */
    let podConfig = this.packConfigsId[podId];
    let podName = podConfig.argValid.name;
    /* #endregion */

    /* #region  Get, remove pod name, and save the NodeConfig. */
    // TODO: Replace with upsert: https://pouchdb.com/guides/conflicts.html#two-types-of-conflicts
    await Util.retry(async (retry) => {
      try {
        await this.nodeConfig.load();
        let podConfigs = new Set(this.nodeConfig.state.podConfigs);
        podConfigs.delete(podName);
        this.nodeConfig.state.podConfigs = Array.from(podConfigs);
        await this.nodeConfig.save();
      } catch (error) {
        retry(error)
      }
    }, 8);
    /* #endregion */

    await podConfig.delete();

    /* #region  Accounting. */
    this.packConfigsId[podId] = undefined;
    this.podConfigs[podName] = undefined;
    /* #endregion */
  }

  private async deleteAll() {
    let packIds = [...Object.keys(this.packConfigsId)]; // Copying an array with the spread operator :)

    packIds.forEach(async (packId) => {
      await this.delete(packId);
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
