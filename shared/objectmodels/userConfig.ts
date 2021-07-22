import { EventEmitter } from 'events';
import { ObjectModel, ArrayModel } from "objectmodel";
import assert from "assert"
import validator from "email-validator";

export class UserConfig {
  db: any;
  
  arg: any;
  argValid: any;
  state: any;
	validate: boolean;
	
	string: string;
	watcher: any;
	eventEmitter = new EventEmitter();

	constructor(arg = { db: undefined, arg: undefined},  validate = false) {
		this.db = arg.db;
		this.arg = arg.arg;
		this.validate = validate;
	}
	
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
					type: 'userConfig'
				})
			}
		}).on('change', async function (change) {
			if (change.deleted) {
				this.eventEmitter.emit("delete");
				return;
			}

			let parsedChange = await self.db.rel.parseRelDocs('userConfig', [change.doc]);
			parsedChange = parsedChange.userConfigs[0];
			self.state = parsedChange;
			self.validateState();

			self.eventEmitter.emit('change', self.state);
		});
	}

	parse(arg: string) {
		this.arg = JSON.parse(arg);
	}
	
	async load() {
		if (this.state) { return; }
		this.validateNew();

		this.state = (await this.db.find({
			selector: { data: this.arg },
			limit: 1
		})).docs;
		this.state = await this.db.rel.parseRelDocs('userConfig', this.state);
		this.state = this.state.userConfigs[0];

		this.validateState();
	}

	async save() {
		this.validateNew();
		
		this.state = { ...this.state, ...await this.db.rel.save('userConfig', this.state) }; // TODO: USE THIS PATTERN!
		this.validateState();
	}
	
	toString() {
		this.validateState();
		this.string = JSON.stringify(this.state);
	}
	
	// TODO: NEVER CALLED?
	async delete() {
		
	}
	
	// TODO: Not allowed. Will validate args later...
	private newUserConfigInstance;
		
  private validateNew() {
    if (this.validate) { assert(!!this.state); }
    this.argValid = this.arg;
	}

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
		assert(!!this.state);
		// TODO: use this: new this.stateUserConfigInstance(this.state);
	}

}