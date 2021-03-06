import FlatPromise from "flat-promise";
import assert from "assert";

export abstract class User {
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

  abstract init(): void;
  
  /**
   * Parses user.
   * @param arg 
   */
  parse(arg: string) {
    this.arg = JSON.parse(arg);
    this.validateNew();
  }
  
  async load() {
    if (this.state) {return;}
    //  this.validateNew();
    
    this.state = await this.db.getUser(this.arg.name);
    this.validateState();
  }
  
  async save() {
    // Won't work if I load -> then I save but this doesn't happen...
    this.validateNew();

    let savestate = new FlatPromise();
    this.state = this.db.signUp(this.argValid.name, this.argValid.password, (err, state) => { 
      if (err) {
        savestate.reject(err);
        return;
      }

      savestate.resolve(state);
    });

    // Resolved before the database is added
    return savestate.promise;
  }

  toString() {
    this.validateState();
    this.string = JSON.stringify(this.state);
  }
  
  // AUTHENTICATED
  async delete() {
    let savestate = new FlatPromise();
    this.state = await this.db.deleteUser(this.arg.name, (err, state) => { 
      if (err) {
        savestate.reject(err);
        return;
      }

      savestate.resolve(state);
    });

    return savestate.promise;
  }

  // :() Constructor type?
  protected abstract newUserModel: new (arg0: any) => any;

  protected validateNew() {
    this.argValid = this.validate ? new this.newUserModel(this.arg) : this.arg;
  }

  protected validateState() {
    assert(!!this.state);
  }
  
}