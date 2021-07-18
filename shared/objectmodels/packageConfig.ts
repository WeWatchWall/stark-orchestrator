import { EventEmitter } from 'events';
import assert from "assert";
import { ObjectModel } from "objectmodel";
import { diff } from 'deep-object-diff';

import { DeploymentMode } from "./deploymentMode";

export class PackageConfig {
	db: any;
	arg: any;
	validate: boolean;
    state: any;
    change: any;
    isSaved = false;
	string: string;
    watcher: any;
    eventEmitter = new EventEmitter();
    
	/**
	 * Creates an instance of user.
	 * @param [arg.db]
	 * @param [arg.arg]
	 * @param [validate] Is necessary because the arg could be used to load (future).
	 */
	constructor(arg = { db: undefined, arg: undefined},  validate = false) {
		this.db = arg.db;
		this.arg = arg.arg;
		this.validate = validate;
	}

    // Fragile, could change before load but don't want it to run before load. should be easy with a flag :)
    async init() {
        await this.load();

        var self = this;
        this.watcher = this.db.changes({
            since: 'now',
            live: true,
            include_docs: true,
            selector: {
                "_id": this.db.rel.makeDocID({
                    id: this.state.id,
                    type: 'packageConfig'
				})
            }
        }).on('change', async function (change) {
            if (change.deleted) {
                // TODO: self-destruct?
                this.eventEmitter.emit("delete");
                return;
            }

            let saved;
            saved = [change.doc];
            self.db.setSchema(self.packageConfigSchema);
            saved = await self.db.rel.parseRelDocs('packageConfig', saved);
            saved = saved.packageConfigs[0];
            self.change = diff(self.state, saved);
            self.state = saved;
            
            self.validateState();            
            self.eventEmitter.emit('change', self.change);
        });
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

        this.db.setSchema(this.packageConfigSchema);
        
		this.state = (await this.db.find({
            selector: {
                "_id": {"$regex": "^packageConfig"},
                data: {
                    'mode': this.arg.mode,
                    'name': this.arg.name
                }
            },
            limit: 1
		})).docs;
		this.state = await this.db.rel.parseRelDocs('packageConfig', this.state);
		this.state = this.state.packageConfigs[0];
        this.validateState();
	}

    async save() {
        if (this.validate) { this.validateNew(); }
		if (!this.state) { this.init(); }

		this.db.setSchema(this.packageConfigSchema);
		this.state = { ...this.state, ...await this.db.rel.save('packageConfig', this.state) };

		this.validateState();
	}

	toString() {
		this.string = JSON.stringify(this.state);
    }
    
    async delete(numPods: number) {
        this.state.numPods -= numPods;
        await this.save();
	}

    private newDeployConfigModel = ObjectModel({
        mode: [DeploymentMode.Core, DeploymentMode.Edge, DeploymentMode.Browser],
        name: String
    });

    private validateNew() {
        this.arg = new this.newDeployConfigModel(this.arg);
    }

    private packageConfigSchema = [{ singular: 'packageConfig', plural: 'packageConfigs' }];

    private validateState() {
        assert(!!this.state);
    }
	
}