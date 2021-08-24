import _ from 'lodash';
import fs from 'fs-extra';
import chokidar from 'chokidar';

import { PackageServer } from "./packageServer";

export class PackageLocal extends PackageServer { 
  async load() {
    if (this.watcher) { return; }
    this.validateNew();

    this.packageDir = `${PackageServer.PackagesDir}/${this.argValid.name}`;
    !(await fs.exists(this.packageDir)) && (await fs.mkdir(this.packageDir));
    
    this.watcher = chokidar.watch(this.packageDir,
        {
            ignored: /^\./,
            persistent: true,
            awaitWriteFinish: true
        });
    
    var self = this;
    let debounced = _.debounce(async () => {
      await self._load();
      await self.save();
    }, 2000);
    // (event, path)
    this.watcher.on('all',  debounced);
                
  }
  
  async save() {
    this.validateState();
    
    await fs.writeFile(`${PackageServer.OutDir}/${this.argValid.name}.zip.pgp`, this.state);
  }
} 