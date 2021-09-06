// TODO: Remove import FlatPromise from "flat-promise";
import { ArrayModel, ObjectModel } from 'objectmodel';
import assert from "assert";
import { DeploymentMode } from '../../shared/objectmodels/deploymentMode';
import { Security } from '../../shared/objectmodels/security';
import { Availability } from '../../shared/objectmodels/availability';
import { ProvisionStatus } from '../../shared/objectmodels/provisionStatus';
import { Sandbox } from '../../shared/objectmodels/sandbox';
import { Runtime } from '../../shared/objectmodels/runtime';

export class PackageConfig {
  db: any;
  
  arg: any;
  argValid: any;
  state: any;
  validate: boolean;

  string: string;
  attachment: Buffer;
  
  /**
   * Creates an instance of user.
   * @param [arg.db]
   * @param [arg.arg]
   * @param [validate] Is necessary because the arg could be used to load (future).
   */
  constructor(arg = { db: undefined, arg: undefined},  validate = false) {
    this.db = arg.db;
    this.arg = arg.arg;
    this.attachment = arg.arg.attachment; // Extra, data-filtered property! for memory?
    this.validate = validate;
  }

  init(): void { throw new Error("This method is not implemented."); }
  
  /**
   * Parses user.
   * @param arg 
   */
  parse(arg: string) {
    this.arg = JSON.parse(arg);
    this.validateNew();
  }
  
  async load() {
    if (this.state) { return; }
    this.validateNew();

    this.state = (await this.db.find({
      selector: { data: {name: this.argValid.name} },
      limit: 1
    })).docs;
    this.state = await this.db.rel.parseRelDocs('packageConfig', this.state);
    this.state = this.state.packageConfigs[0];
        
    this.validateState();
    
    this.attachment = await this.db.rel.getAttachment('packageConfig', this.state.id, 'package.zip.pgp');
  }
  
  async save() {
    this.validateNew();

    this.state = await this.db.rel.save('packageConfig', this.state || this.argValid);
    
    await this.db.rel.putAttachment('packageConfig', this.state, 'package.zip.pgp', this.attachment || this.arg.attachment, 'text/plain');

    this.validateState();
  }

  toString() {
    this.validateState();
    this.string = JSON.stringify(this.state);
  }
  
  async delete() {
  }

  // :() Constructor type?
  protected newUserModel = ObjectModel({
    // Relational
    name: String,
    
    // Config
    mode: [DeploymentMode.Core, DeploymentMode.Edge, DeploymentMode.Browser],
    availability: [Availability.Off, Availability.Tag, Availability.Any],
    security: [Security.Private, Security.Friends, Security.Public],
    tags: ArrayModel(String),
    maxPods: Number,
    numPods: Number,
    status: [ProvisionStatus.Init, ProvisionStatus.Up, ProvisionStatus.Error, ProvisionStatus.Stop],
    isService: Boolean,
    services: ArrayModel(String),
    nodePods: Object,
    arg: Object,
    sandbox: [Sandbox.Default, Sandbox.Admin, Sandbox.UI],
    runtime: [Runtime.Thread, Runtime.Process, Runtime.None]
  }).defaultTo({
    // Require name
    // Require mode
    availability: Availability.Any,
    security: Security.Private,
    tags: [],
    maxPods: 0,
    numPods: 0,
    status: ProvisionStatus.Init,
    isService: false,
    services: [],
    nodePods: {},
    arg: {},
    sandbox: Sandbox.Default,
    runtime: Runtime.Thread
  }).assert(
    newUser => {
      // TODO
      return newUser &&
      
        // Alphanumeric string that may include _ and - having a length of 3 to 20 characters.
        RegExp('^[a-zA-Z0-9-_]{3,75}$').test(newUser.name);
    }
  );

  protected validateNew() {
    this.argValid = this.validate ? new this.newUserModel(this.arg) : this.arg;
  }

  protected validateState() {
    assert(!!this.state);
  }

  // TODO: STATE MODEL
}