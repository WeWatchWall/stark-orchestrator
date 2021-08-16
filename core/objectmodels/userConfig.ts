import { ObjectModel, ArrayModel } from "objectmodel";
import assert from "assert";
import validator from "email-validator";

export class UserConfig {
  db: any;

  arg: any;
  argValid: any;
  state: any;
  validate: boolean;
  
  string: string;
    
  constructor(arg = { db: undefined, arg: undefined},  validate = false) {
    this.db = arg.db;
    this.arg = arg.arg;
    this.validate = validate;
  }
  
  init(): void { throw new Error("This method is not implemented."); }

  parse(arg: string) {
    this.arg = JSON.parse(arg);
    this.validateNew();
  }
  
  async load() {
    // ValidateLoad?
    // this.validateNew();
    
    this.state = (await this.db.find({
      selector: { data: this.arg },
      limit: 1
    })).docs;
    // Interesting: this query gives me the two related entities?
    this.state = await this.db.rel.parseRelDocs('userConfig', this.state);
    this.state = this.state.userConfigs[0];
    this.validateState();
  }
    
  async save() {
    this.validateNew();

    this.state = { ...this.state, ...await this.db.rel.save('userConfig', this.state || this.argValid) };
    this.validateState();
  }
  
  toString() {
    this.validateState();
    this.string = JSON.stringify(this.state);
  }
  
  // NOOP
  async delete() {
  }
  
  private newUserConfigInstance = ObjectModel({
    dbName: String,
    name: String,
    password: undefined,
    key: String,
    email: String,
    // replication: [ObjectModel({
    //   id: String,
    //   rev: String
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
    numRouters: Number
    // sharedReads: [ArrayModel(String)],
    // sharedWrites: [ArrayModel(String)]    
  })
  .defaultTo({
    notifications: [],
    friends: [],

    enableFriends: true,
    enableNodes: true,
    enablePods: true,
    
    nodeConfigs: [],
    packageConfigs: ['stark-edge-config', 'stark-browser-config'],
    numRouters: 0
    // sharedReads: [],
    // sharedWrites: []
  })
  .assert(
    newUserConfig => {
      
      return newUserConfig &&
        // Alphanumeric string that may include _ and - having a length of 3 to 20 characters.
        RegExp('^[a-zA-Z0-9_-]{3,20}$').test(newUserConfig.name) &&  
        RegExp('^[a-zA-Z0-9]{8,20}$').test(newUserConfig.key) &&
        validator.validate(newUserConfig.email) &&
        newUserConfig.dbName.indexOf('userdb-') > -1;
        
    }
  );
    
  private validateNew() {
    this.argValid = this.validate ? new this.newUserConfigInstance(this.arg) : this.arg;
  }

  private validateState() {
    assert(!!this.state);
  }

}