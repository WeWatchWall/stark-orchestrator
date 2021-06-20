import _ from 'lodash';
import fs from 'fs-extra';
import chokidar from 'chokidar';

import { PackageServer } from "./packageServer";

export class PackageLocal extends PackageServer { 
  async load() {
		if (this.watcher) { return; }
		if (this.validate) { this.validateNew(); }

    this.packageDir = `${PackageServer.PackagesDir}/${this.arg.name}`;
    !(await fs.exists(this.packageDir)) && (await fs.mkdir(this.packageDir));
    
    this.watcher = chokidar.watch(this.packageDir,
        {
            ignored: /^\./,
            persistent: true,
            awaitWriteFinish: true
        });
    
    // (event, path)
    this.watcher.on('all',  _.debounce(async () => {
      await this._load();
      await this.save();
    }, 2000));
                
	}
  
  async save() {
    this.validateState();
    
    await fs.writeFile(`${PackageServer.OutDir}/${this.arg.name}.zip.pgp`, this.state);
  }
} 