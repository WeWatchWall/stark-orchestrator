import { ObjectModel } from 'objectmodel';

import _ from 'lodash';
import FlatPromise from 'flat-promise';
import fs from 'fs-extra';
import chokidar from 'chokidar';

import { PackageServer } from "./packageServer";
import { PackageConfig } from "./packageConfig";

export class PackageLocalDb extends PackageServer { 
    db: any;
    packageConfig: any;

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
        
        
        let promise = new FlatPromise();
        // (event, path)
        this.watcher.on('all',  _.debounce(async () => {
            await this._load();
            promise.resolve();
        }, 2000));

        await promise.promise;
        this.arg.packageConfig.arg.attachment = this.state.buffer;
    }

    async save() {
        this.validateState();       
        await this.arg.packageConfig.save();
    }

    protected newPackageModel = ObjectModel({
        name: String,
        packageConfig: PackageConfig
    }).assert(newPackageModel => {
        return !!newPackageModel;
    });
} 