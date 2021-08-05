import { ObjectModel } from "objectmodel";

export class Response {
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
    this.state = await this.db.rel.parseRelDocs('response', this.state);
    this.state = this.state.responses[0];

    this.validateState();
  }

  async save() {
    this.validateNew();
    this.state = this.state || this.arg;
    this.state = { ...this.state, ...await this.db.rel.save('response', this.state) };
    
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
        type: 'response'
      }),
      this.state.rev
    );
  }

  private newResponseModel = ObjectModel({
    source: String,
    target: String,
    targetPod: Number,
    time: Number,
    isRemote: Boolean,
    isDeleted: [Boolean],
    requestId: [String]
  });

  protected validateNew() {
    this.argValid = this.validate ? new this.newResponseModel(this.arg) : this.arg;
  }

  protected validateState() {
    new this.newResponseModel(this.state);
  }
  
}