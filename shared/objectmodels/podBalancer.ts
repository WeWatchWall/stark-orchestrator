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
	validate: boolean;
  state: { podConfig: any, packageConfig: any };
  change: any;
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
    this.state.packageConfig.eventEmitter.on('change', async function (change) {
      await Util.retry(async (retry) => {
        if (self.isDeletedPackage) { return; }

        try {
          await self.changeNumPods(change);
        } catch (error) {
          retry(error)
        }
      }, 8);
    });
    
    this.state.podConfig.eventEmitter.on('delete', function () {
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
      while (!await this.save()) { }
    }
  }
  
	/**
	 * Parses user.
	 * @param arg 
	 */
	parse(arg: string) {
		this.arg = JSON.parse(arg);
		if (this.validate) { this.validateNew(); }
	}
	
  async load() {
    if (this.state) { return; }
    if (this.validate) { this.validateNew(); }

    let podConfig = new PodConfig(
      {
        db: this.dbs.nodeDb,
        arg: {
          id: this.arg.id
        },
      },
      true
    );
    await podConfig.init();
    await podConfig.load();

    let packageConfig = new PackageConfig(
      {
        db: this.dbs.userDb,
        arg: {
          name: this.arg.name,
          mode: this.arg.mode
        },
      },
      true
    );
    await packageConfig.init();
    await packageConfig.load();

    this.state = {
      podConfig: podConfig,
      packageConfig: packageConfig
    };

    this.validateState();

    await Util.retry(async (retry) => {
      try {
        await this.state.packageConfig.load();
        this.state.packageConfig.state.numPods += this.state.podConfig.state.numPods;
        await this.state.packageConfig.save();
      } catch (error) {
        retry(error)
      }
    }, 8);

    await this.changeNumPods({numPods: true});
  }

  private isAvailable(): boolean {
    if (!this.arg.userConfig.state.enablePods) { return false; }
    if (!this.state.packageConfig.state.attachments) { return false; }
    if (!this.state.packageConfig.state.availability) { return false; }
    if (!this.state.packageConfig.state.maxPods) { return false; }

    return true;
  }

  async save(): Promise<boolean> {
    if (this.validate) { this.validateNew(); }
    if (!this.state) { await this.init(); }

    let numPods = this.state.packageConfig.state.numPods;
    let maxPods = this.state.packageConfig.state.maxPods;
    let pods =  this.state.podConfig.state.numPods;
    let increment = numPods < maxPods ? 1 : -1;

    if (numPods === maxPods) { return true; }
    if (pods === 0 && increment === -1) { return true; }
    if (pods === 1 && increment === -1) { await Util.delay(3000); }
    if (pods > 1 && increment === 1) { await Util.delay(3000); }

    try {
      this.state.packageConfig.state.numPods += increment;
      await this.state.packageConfig.save();
    } catch (error) {
      this.state.packageConfig.state.numPods -= increment;
      throw error;
    }

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
    if (!this.arg.userConfig.state.enablePods) { return; }
    if (!this.state.packageConfig.state.availability) { return; }
    if (this.state.packageConfig.state.maxPods) { return; }
    if (this.state.podConfig.state.numPods) { return; }
    
    await Util.retry(async (retry) => {
      try {
        await this.state.podConfig.load();
        this.state.podConfig.state.numPods = 1;
        await this.state.podConfig.save();
      } catch (error) {
        retry(error)
      }
    }, 8);

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
    id: String,
    name: String,
    mode: [DeploymentMode.Core, DeploymentMode.Edge, DeploymentMode.Browser]
  });

  private validateNew() {
      this.arg = new this.newDeployConfigModel(this.arg);
  }

  private validateState() {
    assert(!!this.state.podConfig);
    assert(!!this.state.packageConfig);
  }
}