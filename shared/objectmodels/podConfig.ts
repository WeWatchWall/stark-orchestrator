import { EventEmitter } from 'events';
import assert from "assert";
import { ObjectModel } from "objectmodel";
import { diff } from 'deep-object-diff';

export class PodConfig {
  db: any;
  
  arg: any;
  argValid: any;
  state: any;
  change: any;
  validate: boolean;
  
  isSaved = false;
  string: string;
  watcher: any;
  eventEmitter = new EventEmitter();
    
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

  // Fragile, could change before load but don't want it to run before load. should be easy with a flag :)
  async init() {
    await this.load();

    var self = this;
    this.watcher = this.db.changes({
      since: 'now',
      live: true,
      include_docs: true,
      selector: {
        "_id": this.argValid.id
      }
    }).on('change', async function (change) {
      if (change.deleted) {
        // TODO: self-destruct?
        self.eventEmitter.emit("delete");
        self.delete();
        return;
      }

      let saved;
      saved = [change.doc];
      saved = await self.db.rel.parseRelDocs('podConfig', saved);
      saved = saved.podConfigs[0];
      self.change = diff(self.state, saved);
      self.state = saved;
      
      self.validateState();            
      self.eventEmitter.emit('change', self.change);
    });
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
    
    let  saved = (await this.db.find({
      selector: {
        "_id": this.argValid.id
      },
      limit: 1
    })).docs;
    saved = await this.db.rel.parseRelDocs('podConfig', saved);
    this.state = saved.podConfigs[0];
    this.validateState();
  }

  async save() {
    this.validateNew();
    if (!this.state) { this.init(); }
        
    this.state = { ...this.state, ...await this.db.rel.save('podConfig', this.state) };

    this.validateState();
  }

  toString() {
    this.string = JSON.stringify(this.state);
  }

  async delete() {
    // NOOP
  }

  private newDeployConfigModel = ObjectModel({
    id: String
  });

  private validateNew() {
    this.argValid = this.validate ? new this.newDeployConfigModel(this.arg) : this.arg;
  }

  private validateState() {
    assert(!!this.state);
  }
  
}