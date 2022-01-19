import dotenv from 'dotenv';
import assert from "assert";
import { ArrayModel, ObjectModel } from "objectmodel";

import path from 'path';
import fs from 'fs-extra';

import { Runtime } from '../../shared/objectmodels/runtime';
import workerProcess from '../workerProcess';
import workerThread from '../workerThread';

// TODO: SCALING UP+DOWN with UPDATE

export class PodEnv {
  static PackagesDir = `./packages-run`;
  db: any;

  arg: any;
  argValid: any;
  validate: boolean;
  state: any;
  
  string: string;
  packageDir: any;
  processes = [];
    
  constructor(arg = { arg: undefined},  validate = false) {
    this.arg = arg.arg;
    this.validate = validate;
  }

  init() { throw new Error("This method is not implemented."); }

  parse(arg: string) {
    this.arg = JSON.parse(arg);
    this.validateNew();
  }
  
  async load() {
    if (this.state) { return; }
    this.validateNew();
    this.packageDir = `${PodEnv.PackagesDir}/${this.argValid.name}`;

    if (!(await fs.exists(this.packageDir))) {
      throw new Error(`Input Error. The specified package does not exist in ${this.packageDir}`);
    }

    this.state = true;
  }

  async save(podIndex) {
    if (!this.state) { await this.load(); } // TODO: USE THIS PATTERN!
    this.validateState();

    let sandbox;
    if (this.state.runtime === Runtime.Process) {
      sandbox = workerProcess.init();
    } else { 
      sandbox = workerThread.init();
    }
   
    let result = sandbox.execute({
      file: path.resolve(`${this.packageDir}/dist/index`),
      arg: {
        package: this.argValid.name,
        pod: podIndex,
        arg: this.argValid.arg,
        config: dotenv.config().parsed
      }
    });

    this.processes.push(sandbox.worker);
  }

  toString() {
    this.string = JSON.stringify(this.state);
  }

  async delete() {
    let worker = this.processes.pop();
    worker.terminate();
  }

  private newPodEnvModel = ObjectModel({
    name: String,
    arg: [Object],
    runtime: [Runtime.Thread, Runtime.Process, Runtime.None]
  });

  private validateNew() {
    this.argValid = this.validate ? new this.newPodEnvModel(this.arg) : this.arg;
  }

  private validateState() {
    assert(!!this.state);
  }
  
}