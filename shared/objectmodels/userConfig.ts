import { ObjectModel, ArrayModel } from "objectmodel";
import assert from "assert"
import validator from "email-validator";

export class UserConfig {
	arg: any;
	validate: boolean;
	db: any;
	string: string;
	state: any;
		
	constructor(arg = { db: undefined, arg: undefined},  validate = false) {
		this.db = arg.db;
		this.arg = arg.arg;
		this.validate = validate;
	}
	
	init(): void { throw new Error("This method is not implemented."); }

	parse(arg: string) {
		this.arg = JSON.parse(arg);
	}
	
	// NOTE: This is assumed to be called first!
	async load() {		
		this.db.setSchema(this.userConfigSchema);
		this.state = (await this.db.find({
			selector: { data: this.arg },
			limit: 1
		})).docs;
		this.state = await this.db.rel.parseRelDocs('userConfig', this.state);
		this.state = this.state.userConfigs[0];
		this.validateState();
	}

	async save() {
		if (this.validate) { this.validateNew(); }
		
		this.db.setSchema(this.userConfigSchema);
		this.state = { ...this.state, ...await this.db.rel.save('userConfig', this.state) }; // TODO: USE THIS PATTERN!
		this.validateState();
	}
	
	toString() {
		this.validateState();
		this.string = JSON.stringify(this.state);
	}
	
	// NOOP
	async delete() {
	}
	
	// TODO: Not allowed. Will validate args later...
	private newUserConfigInstance;
		
	private validateNew() {		
		assert(!!this.state);
	}
	
	private userConfigSchema:any = [
		{
			singular: 'userConfig', plural: 'userConfigs', 
			relations: {
				nodeConfigs: {hasMany: 'nodeConfig'}
			}
		},
		{singular: 'nodeConfig', plural: 'nodeConfigs', relations: {userConfig: {belongsTo: 'userConfig'}}}
	];

	private stateUserConfigInstance = ObjectModel({
		id: String,
		rev: String,
		dbName: String,
		name: String,
		password: undefined,
		key: String,
		email: String,
		// replication: [ObjectModel({
		// 	id: String,
		// 	rev: String
		// })],
		
		// Admin settings
		enableUsers: [Boolean],
		enableAllNodes: [Boolean],

		// User Settings
		notifications: ArrayModel(String),
		enableFriends: Boolean,
		friends: ArrayModel(String),
		enableNodes: Boolean,
		enablePods: Boolean,

		// Pods
		nodeConfigs: ArrayModel(String),
		corePackageConfigs: [ArrayModel(String)],
		packageConfigs: ArrayModel(String),
		
		// sharedReads: [ArrayModel(String)],
		// sharedWrites: [ArrayModel(String)]		
	}).assert(
		newUserConfig => {
		
			return newUserConfig &&
				// Alphanumeric string that may include _ and - having a length of 3 to 20 characters.
				RegExp('^[a-zA-Z0-9_-]{3,20}$').test(newUserConfig.name) &&
				RegExp('^[a-zA-Z0-9]{8,20}$').test(newUserConfig.key) &&
				validator.validate(newUserConfig.email) &&
				newUserConfig.dbName.indexOf('userdb-') > -1;
			
		}
	);

	private validateState() {
		this.state = new this.stateUserConfigInstance(this.state);
	}

}