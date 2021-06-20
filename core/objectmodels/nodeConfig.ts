// import assert from "assert";
import { ObjectModel, ArrayModel } from "objectmodel";
import { UserConfig } from './userConfig';
import { ProvisionStatus } from '../../shared/objectmodels/provisionStatus';
import { DeploymentMode } from '../../shared/objectmodels/deploymentMode'
import { Availability } from "../../shared/objectmodels/availability";
import { Security } from "../../shared/objectmodels/security";

export class NodeConfig {
	db: any;
	userConfig: UserConfig;
	arg: any;
	validate: boolean;
	state: any;
	string: string;
	
	constructor(arg = { db: undefined, userConfig: undefined, arg: undefined}, validate = false) {
		this.db = arg.db;
		this.userConfig = arg.userConfig;
		this.arg = arg.arg;
		this.validate = validate;
	}
	
	init(): void { throw new Error("This method is not implemented."); }
	
	parse(arg: string) {
		this.arg = JSON.parse(arg);
		this.validateNew();
	}
	
	// NOOP
	async load() {
	}
	
	async save() {
		if (this.validate) { this.validateNew() };

		this.db.setSchema(this.nodeConfigSchema);
		let arg = this.state || this.arg;
		this.state = { ...arg, ...await this.db.rel.save('nodeConfig', arg) };	
		
		// Accounting for the users' nodeConfigs.
		this.userConfig.load();

		let userNodeConfigs = new Set(this.userConfig.state.nodeConfigs);
		userNodeConfigs.add(this.state.id);
		this.userConfig.state.nodeConfigs = Array.from(userNodeConfigs);

		this.userConfig.save();
	}
	
	toString() {
		this.string = JSON.stringify(this.state);
	}
	
	// TODO
	async delete() {
	}
	
	private newNodeConfigModel = ObjectModel({
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
		
	}).defaultTo({
		// Config
		// Pass in mode!
		availability: Availability.Any,
		security: Security.Private,
		tags: [],

		// Pods
		status: ProvisionStatus.Init,
		podConfigs: ['stark-edge-config'], // TODO: Replace for browser in the deployer service!	
	}).assert(
		newNodeConfig => {
			return newNodeConfig &&
				RegExp('^[a-zA-Z0-9_-]{3,50}$').test(newNodeConfig.username) &&	
				RegExp('^[a-zA-Z0-9_-]{3,50}$').test(newNodeConfig.name) &&	
				newNodeConfig.name.indexOf('nodeDb-') > -1 &&
				newNodeConfig.dbName.indexOf('userdb-') > -1;
			
		}
	);

	private validateNew() {
		this.arg = new this.newNodeConfigModel(this.arg);
	}

	
	private nodeConfigSchema = [
		{
			singular: 'userConfig', plural: 'userConfigs', 
			relations: {
				nodeConfigs: {hasMany: 'nodeConfig'}
			}
		},
		{singular: 'nodeConfig', plural: 'nodeConfigs', relations: {userConfig: {belongsTo: 'userConfig'}}}
	];

	private validateState() {
		// assert(this.state);
	}
}