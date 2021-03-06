import { ObjectModel } from 'objectmodel';

import _ from 'lodash';
import FlatPromise from 'flat-promise';
import fs from 'fs-extra';
import chokidar from 'chokidar';

import { PackageServer } from "./packageServer";
import { PackageConfig } from "./packageConfig";
import { DeploymentMode } from '../../shared/objectmodels/deploymentMode';

export class PackageLocalDb extends PackageServer { 
  db: any;
  packageConfig: any;

  async load() { 
    if (this.watcher) { return; }
    this.validateNew();

    this.packageDir = `${PackageServer.PackagesDir}/${this.argValid.name}`;
    if (this.argValid.packageConfig.arg.mode === DeploymentMode.Browser) {
      this.packageDir = `${this.packageDir}/dist`;
    }
    !(await fs.exists(this.packageDir)) && (await fs.mkdir(this.packageDir));
    
    this.watcher = chokidar.watch(this.packageDir,
    {
      ignored: /^\./,
      persistent: true,
      awaitWriteFinish: true
    });
    
    let promise = new FlatPromise();

    var self = this;
    let debounced = _.debounce(async () => {
      await self._load();
      self.argValid.packageConfig.attachment = self.state.buffer;
      await self.save();
      promise.resolve();
    }, 2000);
    // (event, path)
    this.watcher.on('all', debounced);
    
    await promise.promise;
  }

  async save() {
    this.validateState();
    await this.argValid.packageConfig.save();
  }

  protected newPackageModel = ObjectModel({
    name: String,
    packageConfig: PackageConfig
  }).assert(newPackageModel => {
    return !!newPackageModel;
  });
} 