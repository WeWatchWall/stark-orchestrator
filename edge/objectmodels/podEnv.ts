import dotenv from 'dotenv';
import assert from "assert";
import { ArrayModel, ObjectModel } from "objectmodel";

import path from 'path';
import fs from 'fs-extra';
const { NodeVM } = require('vm2');

// TODO: cleanup and secure the endpoints
import events from 'events';
import performanceNow from 'performance-now';

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

    // TODO: SANDBOX WITH (SCAFFOLD FILES) + (SEPARATE PROCESS OR THREAD) + (ARGUMENTS for VM2)
    const vm = new NodeVM({
      console: 'inherit',
      sandbox: {},
      sourceExtensions: ['js', 'cjs'],
      require: {
        // import: ['objectmodel'], outside the border...
        external: {
          modules: ['*'],
          transitive: true
        },
        builtin: ['*'],
        context: "sandbox",
        root: `${path.join(this.packageDir)}`,
        mock: {
          objectmodel: { ArrayModel, ObjectModel },
          events: events,
          'performance-now': performanceNow
        }
      }
    });

    let functionInSandbox = vm.run(
      `
      module.exports = function(arg) {
        console.log(process.cwd());
        
        const app = require('./dist/index.js');
        app(arg);
      }            
      `,
      path.join(this.packageDir, 'stark_bootstrap.js')
    );

    functionInSandbox({
      package: this.argValid.name,
      pod: podIndex,
      arg: this.argValid.arg,
      config: dotenv.config().parsed
    });
  }

  toString() {
    this.string = JSON.stringify(this.state);
  }
    
    // TODO!! Store the sandbox so that I can cancel that while I'm scaling down!!
    // If I reach 0, and I call delete again, then I delete the install package,
    // So that I can call load automatically again...:()
    async delete() {
  }

  private newPodEnvModel = ObjectModel({
    name: String,
    arg: [Object]
  });

  private validateNew() {
    this.argValid = this.validate ? new this.newPodEnvModel(this.arg) : this.arg;
  }

  private validateState() {
    assert(!!this.state);
  }
  
}