import assert from "assert";
import { ObjectModel } from "objectmodel";
import { Availability } from "../../shared/objectmodels/availability"; // TODO
import { DeploymentMode } from "../../shared/objectmodels/deploymentMode";
import { ProvisionStatus } from "../../shared/objectmodels/provisionStatus";

export class PodConfig {
  db: any;
  
  arg: any;
  argValid: any;
  state: any;
  validate: boolean;
  

  isSaved = false;
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
          'mode': this.argValid.mode,
          'name': this.argValid.name
        }
      },
      limit: 1
    })).docs;
    this.state = await this.argValid.userDb.rel.parseRelDocs('packageConfig', this.state);
    this.state = this.state.packageConfigs[0];
    this.validateState();

    let  saved = (await this.db.find({
      selector: {
        "_id": {"$regex": "^podConfig"},
        data: {
          'mode': this.argValid.mode,
          'name': this.argValid.name
        }
      },
      limit: 1
    })).docs;
    saved = await this.db.rel.parseRelDocs('podConfig', saved);
    this.isSaved = !!saved.podConfigs[0];

    if (this.isSaved) {
      this.state = saved.podConfigs[0];
      return;
    }

    this.state.attachment = await this.argValid.userDb.rel.getAttachment('packageConfig', this.state.id, 'package.zip.pgp');
  }

  async save() {
    if (!this.state) { await this.load(); } // TODO: USE THIS PATTERN!
    if (this.isSaved) { return; }

    let read = this.state;    
    this.state = undefined;

    let result;
    result = await this.db.rel.save('podConfig', {
      ...read, ...{
        id: undefined,
        rev: undefined,
        attachment: undefined,
        attachments: undefined,
        
        availability: undefined, 
        security: undefined,
        tags: undefined,
        status: ProvisionStatus.Init,
        maxPods: undefined,
        nodePods: undefined,
        numPods: 1,
        error: 'empty'
      }
    });
    await this.db.rel.putAttachment('podConfig', result, 'package.zip.pgp', read.attachment, 'text/plain');
    this.state = result;

    this.validateState();
    this.isSaved = true;
  }

  toString() {
    this.string = JSON.stringify(this.state);
  }

  async delete() {
    this.state = await this.db.get(this.db.rel.makeDocID({
      id: this.state.id,
      type: 'podConfig'
    }));
    await this.db.remove(this.state);
  }

  private newDeployConfigModel = ObjectModel({
    userDb: Object,
    mode: [DeploymentMode.Core, DeploymentMode.Edge, DeploymentMode.Browser],
    name: String
  });

  private validateNew() {
    this.argValid = this.validate ? new this.newDeployConfigModel(this.arg) : this.arg;
  }

  private validateState() {
    assert(!!this.state);
  }
  
}