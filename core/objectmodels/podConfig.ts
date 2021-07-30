import assert from "assert";
import { ObjectModel } from "objectmodel";
import { Availability } from "../../shared/objectmodels/availability";
import { DeploymentMode } from "../../shared/objectmodels/deploymentMode";
import { ProvisionStatus } from "../../shared/objectmodels/provisionStatus";

export class PodConfig {
  db: any;
  
  arg: any;
  argValid: any;
  state: any;
  validate: boolean;
  
  string: string;
  
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

  init() { throw new Error("This method is not implemented."); }
  
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

    this.state = (await this.argValid.userDb.find({
      selector: {
        "_id": {"$regex": "^packageConfig"},
        data: {
          'availability': Availability.Any,
          'mode': this.argValid.mode
        }
      }
    })).docs;
    this.state = await this.argValid.userDb.rel.parseRelDocs('packageConfig', this.state);
    this.state = this.state.packageConfigs;
    this.validateState();

    for (let packageConfig of this.state) {
      packageConfig.attachment = await this.argValid.userDb.rel.getAttachment('packageConfig', packageConfig.id, 'package.zip.pgp');
    }
  }

  async save() {
    if (!this.state) { await this.load(); } // TODO: USE THIS PATTERN!

    let read = this.state;  
    this.state = [];

    let result;
    for (let packageConfig of read) {
      result = await this.db.rel.save('podConfig', {
        ...packageConfig, ...{
          id: undefined,
          rev: undefined,
          attachment: undefined,
          attachments: undefined,
          
          availability: undefined, 
          security: undefined,
          tags: undefined,
          status: ProvisionStatus.Init,
          maxPods: undefined,
          node: this.argValid.node,
          numPods: 1,
          error: 'empty'
        }
      });
      await this.db.rel.putAttachment('podConfig', result, 'package.zip.pgp', packageConfig.attachment, 'text/plain');
      this.state.push(result);
    }

    this.validateState();
  }

  toString() {
    this.string = JSON.stringify(this.state);
  }
  
  async delete() {
    throw new Error("This method is not implemented.");
  }

  private newDeployConfigModel = ObjectModel({
    userDb: Object,
    mode: [DeploymentMode.Core, DeploymentMode.Edge, DeploymentMode.Browser],
    node: String
  });

  private validateNew() {
    this.argValid = this.validate ? new this.newDeployConfigModel(this.arg) : this.arg;
  }

  private validateState() {
    assert(!!this.state);
    assert(!!this.state.length);
  }
  
}