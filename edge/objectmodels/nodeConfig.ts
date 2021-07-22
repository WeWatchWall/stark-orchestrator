// import assert from "assert"
import { EventEmitter } from 'events';
import { ObjectModel, ArrayModel } from "objectmodel";

import { ProvisionStatus } from '../../shared/objectmodels/provisionStatus';
import { DeploymentMode } from '../../shared/objectmodels/deploymentMode'
import { Availability } from "../../shared/objectmodels/availability";
import { Security } from "../../shared/objectmodels/security";

export class NodeConfig {
  db: any;
  
  arg: any;
  argValid: any;
	state: any;
  validate: boolean;
	
	string: string;
	watcher: any;
	eventEmitter = new EventEmitter();
	
	constructor(arg = { db: undefined, arg: undefined}, validate = false) {
		this.db = arg.db;
		this.arg = arg.arg;
		this.validate = validate;
	}
	
	init(): void { 
		this.arg.username = process.env.STARK_USER_NAME;
		let mode = JSON.parse(process.env.STARK_MODES);
		this.arg.mode = mode[0] ? DeploymentMode.Core : DeploymentMode.Edge; // Browser will be hard-coded?;
        
		this.validateNew();
	}
	
	parse(arg: string) {
		this.arg = JSON.parse(arg);
		this.validateNew();
	}

  async load() {
		this.state = (await this.db.find({
			selector: { data: this.arg },
			limit: 1
		})).docs;
		this.state = await this.db.rel.parseRelDocs('nodeConfig', this.state);
		this.state = this.state.nodeConfigs[0];
		this.validateState();

		var self = this;
		this.watcher = this.db.changes({
			since: 'now',
			live: true,
			include_docs: true,
			selector: {
				"_id": self.db.rel.makeDocID({
          id: self.state.id,
          type: 'nodeConfig'
				})
			}
		}).on('change', async function (change) {
			if (change.deleted) {
        await self.delete();
        return;
			}

			let parsedChange = await self.db.rel.parseRelDocs('nodeConfig', [change.doc]);
			parsedChange = parsedChange.nodeConfigs[0];
			self.state = parsedChange;
			self.validateState();

			self.eventEmitter.emit('change', self.state);
		});
	}
	
	async save() {
		this.validateNew();
		if (this.state) { this.validateState(); }

		this.state = { ...this.state, ...await this.db.rel.save('nodeConfig', this.state) };

		this.validateState();
	}
	
    toString() {
    this.validateState();
		this.string = JSON.stringify(this.state);
	}
	
	// TODO
	async delete() {
	}
	
	private newNodeConfigModel = ObjectModel({
		username: String,
		mode: [
			DeploymentMode.Core,
			DeploymentMode.Edge,
			DeploymentMode.Browser
		]
		
	}).assert(
		newNodeConfig => {
			return newNodeConfig &&
				RegExp('^[a-zA-Z0-9_-]{3,50}$').test(newNodeConfig.username);
			
		}
	);

  private validateNew() {
    this.argValid = this.validate ? new this.newNodeConfigModel(this.arg) : this.arg;
	}
    	
	private stateNodeConfigModel = ObjectModel({
		id: String,
		rev: String,
		username: String,
		name: String,
		password: undefined,

		// Relational
		userConfig: String,
		dbName: String,
		replication: ObjectModel({
			id: String,
			rev: String
		}),
		
		// Config
		mode: [
			DeploymentMode.Core,
			DeploymentMode.Edge,
			DeploymentMode.Browser
		],
		availability: [Availability.Off, Availability.Tag, Availability.Any],
		security: [Security.Private, Security.Friends, Security.Public],
		tags: ArrayModel(String),

		// Pods
		status: [
			ProvisionStatus.Init,
			ProvisionStatus.Up,
			ProvisionStatus.Error,
			ProvisionStatus.Error
		],
		podConfigs: ArrayModel(String)
		
	}).assert(
		newNodeConfig => {
			return newNodeConfig &&
				RegExp('^[a-zA-Z0-9_-]{3,50}$').test(newNodeConfig.username) &&	
				RegExp('^[a-zA-Z0-9_-]{3,50}$').test(newNodeConfig.name) &&	
				newNodeConfig.name.indexOf('nodeDb-') > -1 &&
				newNodeConfig.dbName.indexOf('userdb-') > -1;
			
		}
	);
    
	private validateState() {
		new this.stateNodeConfigModel(this.state);
	}
}