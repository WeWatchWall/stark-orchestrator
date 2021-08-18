import { Util } from "../util";
import { Availability } from "../objectmodels/availability";
import { PodConfigTransfer } from "../objectmodels/podConfigTransfer";

export class PodConfigManager {
  arg;
  podConfigs = {};
  podConfigsId = {};

  addWatcher: any;

  constructor(userDb, userConfig, nodeConfig, nodeDb) {
    this.arg = {userDb, userConfig, nodeConfig, nodeDb};
  }

  async init() {
    /* #region  Get pre-existing pods */
    let prePackConfigs = (
      await this.arg.userDb.state.find({
        selector: {
          _id: { $regex: "^packageConfig" },
          data: {
            mode: this.arg.nodeConfig.state.mode,
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
    this.addWatcher = this.arg.userDb.state
      .changes({
        since: "now",
        live: true,
        retry: true,
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
          self.podConfigsId[doc._id] = 'init';
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

    this.arg.nodeConfig.eventEmitter.on('delete', async () => {
      await self.deleteAll();
    });
  }

  // Internally used on watching
  async add(packageDoc) {
    let podId = packageDoc._id;
    let podName = packageDoc.data.name;

    /* #region  Create and save the PodConfig. */
    let podConfig = new PodConfigTransfer(
      {
        db: this.arg.nodeDb.state,
        arg: {
          userDb: this.arg.userDb.state,
          name: podName,
          mode: this.arg.nodeConfig.state.mode
        },
      },
      true
    );
    await podConfig.save();
    
    this.podConfigsId[podId] = podConfig;
    this.podConfigs[podName] = podConfig;

    /* #endregion */

    /* #region  Get, add pod name, and save the NodeConfig. */
    // TODO: Replace with upsert: https://pouchdb.com/guides/conflicts.html#two-types-of-conflicts
    await Util.retry(async (retry) => {
      try {
        await this.arg.nodeConfig.load();
        let podConfigs = new Set(this.arg.nodeConfig.state.podConfigs);
        podConfigs.add(podName);
        this.arg.nodeConfig.state.podConfigs = Array.from(podConfigs);
        await this.arg.nodeConfig.save();
      } catch (error) {
        retry(error)
      }
    }, 8);
    /* #endregion */
  }

  private isAvailable(packageDoc): boolean {
    if (!this.arg.userConfig.state.enablePods) { return false; }
    if (!this.arg.nodeConfig.state.availability) { return false; }

    if (!packageDoc._attachments) { return false; }
    if (packageDoc.data.mode !== this.arg.nodeConfig.state.mode) { return false; }
    if (!packageDoc.data.availability) { return false; }

    if (packageDoc.data.availability === Availability.Tag) {
      let nodeDoc = this.arg.nodeConfig.state;

      packageDoc.data.tags.forEach(tag => {
        if (nodeDoc.tags.indexOf(tag) === -1) { return false; }
        return true;
      });
      
      return true;
    }

    return true;
  }

  async delete(podId: string) {
    /* #region  Get pod by Id and retrieve its name. */
    let podConfig = this.podConfigsId[podId];
    let podName = podConfig.argValid.name;
    /* #endregion */

    /* #region  Get, remove pod name, and save the NodeConfig. */
    // TODO: Replace with upsert: https://pouchdb.com/guides/conflicts.html#two-types-of-conflicts
    await Util.retry(async (retry) => {
      try {
        await this.arg.nodeConfig.load();
        let podConfigs = new Set(this.arg.nodeConfig.state.podConfigs);
        podConfigs.delete(podName);
        this.arg.nodeConfig.state.podConfigs = Array.from(podConfigs);
        await this.arg.nodeConfig.save();
      } catch (error) {
        retry(error)
      }
    }, 8);
    /* #endregion */

    await podConfig.delete();

    /* #region  Accounting. */
    this.podConfigsId[podId] = undefined;
    this.podConfigs[podName] = undefined;
    /* #endregion */
  }

  private async deleteAll() {
    let packIds = [...Object.keys(this.podConfigsId)]; // Copying an array with the spread operator :)

    packIds.forEach(async (packId) => {
      await this.delete(packId);
    });
  }
}
