import { ObjectModel } from "objectmodel";
import { RequestMode } from "./requestMode";

export class Request {
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

    this.validateNew();
  }
  
  /**
   * Parses user.
   * @param arg 
   */
  parse(arg: string) {
    this.arg = JSON.parse(arg);
    this.validateNew();
  }
  
  async load() {
    this.validateNew();

    this.state = (await this.db.find({
      selector: this.arg,
      limit: 1
    })).docs;
    this.state = await this.db.rel.parseRelDocs('request', this.state);
    this.state = this.state.requests[0];

    this.validateState();
  }

  async save() {
    this.validateNew();
    this.state = this.state || this.arg;
    this.state = { ...this.state, ...await this.db.rel.save('request', this.state) };
    
    this.validateState();
  }

  toString() {
    this.string = JSON.stringify(this.state);
  }
  
  async delete() {
    this.validateState();
    
    await this.db.remove(
      this.db.rel.makeDocID({
        id: this.state.id,
        type: 'request'
      }),
      this.state.rev
    );
  }

  private newRequestModel = ObjectModel({
    service: String,
    isNew: Boolean,
    mode: [RequestMode.Single, RequestMode.Broadcast],
    timeNew: Number,
    source: String,
    isBalanced: [Boolean],
    timeRoute: [Number],
    target: [String],
    targetPod: [Number],
    responseId: [String],
    isDeleted: [Boolean]
  });

  protected validateNew() {
    this.argValid = this.validate ? new this.newRequestModel(this.arg) : this.arg;
  }

  protected validateState() {
    new this.newRequestModel(this.state);
  }
  
}