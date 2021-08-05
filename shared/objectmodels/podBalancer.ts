import { EventEmitter } from 'events';

import assert from "assert";
import { ObjectModel } from "objectmodel";

import { DeploymentMode } from './deploymentMode';
import { PodConfig } from './podConfig';
import { PackageConfig } from './packageConfig';
import { Util } from '../util';

export class PodBalancer {
  dbs: any;

  arg: any;
  argValid: any;
  state: { podConfig: any, packageConfig: any };
  change: any;
  validate: boolean;

  isDeletedPackage = false;
  string: string;  
  eventEmitter = new EventEmitter();
    
  /**
   * Creates an instance of user.
   * @param [arg.db]
   * @param [arg.arg]
   * @param [validate] Is necessary because the arg could be used to load (future).
   */
  constructor(arg = { dbs: undefined, arg: undefined},  validate = false) {
    this.dbs = {
      userDb: arg.dbs.userDb,
      nodeDb: arg.dbs.nodeDb
    };
    
    this.arg = arg.arg;
    this.validate = validate;
  }

  async init() {
    await this.load();

    var self = this;
    this.state.packageConfig.eventEmitter.on('change', async (change) => {
      // TODO: Replace with upsert: https://pouchdb.com/guides/conflicts.html#two-types-of-conflicts
      await Util.retry(async (retry) => {
        if (self.isDeletedPackage) { return; }

        try {
          await self.changeNumPods(change);
        } catch (error) {
          retry(error)
        }
      }, 8);
    });
    
    this.state.podConfig.eventEmitter.on('delete', () => {
      self.eventEmitter.emit("delete");
    });
  }
  
  private async changeNumPods(change) {
    if (change.deleted) {
      // TODO: self-destruct?
      this.isDeletedPackage = true;
      this.eventEmitter.emit("delete");
      return;
    }

    if (!this.isAvailable()) {
      await this.adjustPositiveAvailability();
      return;
    }

    if (change.hasOwnProperty('maxPods') || change.hasOwnProperty('numPods')) {
      while (!await this.save()) {  }
    }
  }
  
  /**
   * Parses user.
   * @param arg 
   */
  parse(arg: string) {
    this.arg = JSON.parse(arg);
    this.validateNew();
  }
  
  async load() {
    if (this.state) { return; }
    this.validateNew();

    let podConfig = new PodConfig(
      {
        db: this.dbs.nodeDb,
        arg: {
          _id: this.argValid.id
        },
      },
      true
    );
    await podConfig.init();

    let packageConfig = new PackageConfig(
      {
        db: this.dbs.userDb,
        arg: {
          name: this.argValid.name,
          mode: this.argValid.mode
        },
      },
      true
    );
    await packageConfig.init();

    this.state = {
      podConfig: podConfig,
      packageConfig: packageConfig
    };

    this.validateState();

    // TODO: Replace with upsert: https://pouchdb.com/guides/conflicts.html#two-types-of-conflicts
    await Util.retry(async (retry) => {
      try {
        await this.state.packageConfig.load();
        this.state.packageConfig.state.nodePods[this.argValid.nodeConfig.state.name] = this.state.podConfig.state.numPods;
        this.state.packageConfig.updateNumPods();
        await this.state.packageConfig.save();
      } catch (error) {
        retry(error)
      }
    }, 8);

    await this.changeNumPods({numPods: true});
  }

  private isAvailable(): boolean {
    if (!this.argValid.userConfig.state.enablePods) { return false; }
    if (!this.argValid.nodeConfig.state.availability) { return false; }
    if (!this.state.packageConfig.state.availability) { return false; }
    if (!this.state.packageConfig.state.attachments) { return false; }
    if (!this.state.packageConfig.state.maxPods) { return false; }

    return true;
  }

  async save(): Promise<boolean> {
    this.validateNew();
    if (!this.state) { await this.init(); }

    let numPods = this.state.packageConfig.state.numPods;
    let maxPods = this.state.packageConfig.state.maxPods;
    let pods =  this.state.podConfig.state.numPods;
    let increment = numPods < maxPods ? 1 : -1;

    if (numPods === maxPods) { return true; }
    if (pods === 0 && increment === -1) { return true; }
    if (pods === 1 && increment === -1) { await Util.delay(3e3); }
    if (pods > 1 && increment === 1) { await Util.delay(3e3); }

    try {
      await this.state.packageConfig.load();
      this.state.packageConfig.state.nodePods[this.argValid.nodeConfig.state.name] += increment;
      this.state.packageConfig.updateNumPods();
      await this.state.packageConfig.save();
    } catch (error) {
      await this.state.packageConfig.load();
      throw error;
    }

    // TODO: Replace with upsert: https://pouchdb.com/guides/conflicts.html#two-types-of-conflicts
    await Util.retry(async (retry) => {
      try {
        await this.state.podConfig.load();
        this.state.podConfig.state.numPods += increment;
        await this.state.podConfig.save();
      } catch (error) {
        retry(error)
      }
    }, 8);
    
    this.validateState();
    return false;
  }

  private async adjustPositiveAvailability() {
    if (!this.argValid.userConfig.state.enablePods) { return; }
    if (!this.argValid.nodeConfig.state.availability) { return; }
    if (!this.state.packageConfig.state.availability) { return; }
    if (this.state.packageConfig.state.maxPods) { return; }
    if (this.state.podConfig.state.numPods) { return; }
    
    // TODO: Replace with upsert: https://pouchdb.com/guides/conflicts.html#two-types-of-conflicts
    await Util.retry(async (retry) => {
      try {
        await this.state.podConfig.load();
        this.state.podConfig.state.numPods = 1;
        await this.state.podConfig.save();
      } catch (error) {
        retry(error)
      }
    }, 8);

    // TODO: Replace with upsert: https://pouchdb.com/guides/conflicts.html#two-types-of-conflicts
    await Util.retry(async (retry) => {
      try {
        await this.state.packageConfig.load();
        this.state.packageConfig.state.numPods++;
        await this.state.packageConfig.save();
      } catch (error) {
        retry(error)
      }
    }, 8);
  }

  toString() {
    this.string = JSON.stringify(this.state);
  }

  async delete() {
    if (this.isDeletedPackage) { return; }

    let numPods = this.state.podConfig.state.numPods;
    await this.state.packageConfig.delete(numPods);
  }

  private newDeployConfigModel = ObjectModel({
    userConfig: Object,
    nodeConfig: Object,
    id: String,
    name: String,
    mode: [DeploymentMode.Core, DeploymentMode.Edge, DeploymentMode.Browser]
  });

  private validateNew() {
    this.argValid = this.validate ? new this.newDeployConfigModel(this.arg) : this.arg;
  }

  private validateState() {
    assert(!!this.state.podConfig);
    assert(!!this.state.packageConfig);
  }
}