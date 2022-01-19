import { EventEmitter } from 'events';
import assert from "assert";
import { ObjectModel } from "objectmodel";

import path from 'path';
import fs from 'fs-extra';
const openpgp = require('openpgp'); // Only works with require :(
import JSZip from 'jszip';
const execShellCommand = require("../../cli/execShellCommand");

import { DeploymentMode } from '../../shared/objectmodels/deploymentMode';
import { ProvisionStatus } from "../../shared/objectmodels/provisionStatus";
import { PodEnv } from './podEnv';
import { Util } from '../../shared/util';

export class Pod { 
  db: any;
  
  arg: any;
  argValid: any;
  validate: boolean;
  state: any;
  
  env;
  numProcesses = 0;

  watcher: any;
  eventEmitter = new EventEmitter();
  isSaveConfig = false;
  packageDir: string;

  constructor(arg = { db: undefined, arg: undefined},  validate = false) {
    this.db = arg.db;
    this.arg = arg.arg;
    this.validate = validate;
  }

  parse(arg: string) {
    this.arg = JSON.parse(arg);
    this.validateNew();
  }

  init() { throw new Error("This method is not implemented."); }

  async load() {
    if (this.state) { return; }
    this.validateNew();

    this.packageDir = path.join(`./packages-run`, this.argValid.name);

    // Get the initial state.
    this.state = (await this.db.find({
      selector: { data: this.argValid },
      limit: 1
    })).docs;
    let podId = this.state[0]._id;
    this.state = await this.db.rel.parseRelDocs('podConfig', this.state);
    this.state = this.state.podConfigs[0];
    
    await this.saveConfig({ status: ProvisionStatus.Init });
    await this.saveInstall();
    await this.save();
    
    var self = this;
    this.watcher = this.db.changes({
      since: 'now',
      live: true,
      retry: true,
      include_docs: true,
      selector: {
          "_id": podId
      }
    }).on('change', async function (change) {
      if (change.deleted) {
        await self.delete(true);
        return;
      }

      let parsedChange = await self.db.rel.parseRelDocs('podConfig', [change.doc]);
      parsedChange = parsedChange.podConfigs[0];
      let prevState = self.state;
      self.state = parsedChange;

      if (
        prevState.attachments["package.zip.pgp"].revpos !== parsedChange.attachments["package.zip.pgp"].revpos ||
        prevState.runtime !== parsedChange.runtime
      ) {
        await self.delete();
        await self.saveInstall();
      }

      await self.save();
    });
  }

  // NOTE: Is called by load, when the podConfig changes.
  async save() {
    this.validateState();

    if (this.state.status === ProvisionStatus.Stop) { await this.delete(); return; }

    if (this.numProcesses > this.state.numPods) {
      for (let i = 0; i < this.numProcesses - this.state.numPods; i++) {
        this.numProcesses--;
        await this.env.delete();
      }
    } else if (this.state.numPods > this.numProcesses) {
      for (let i = 0; i < this.state.numPods - this.numProcesses; i++) {
        let processEnv = this.env || new PodEnv({
          arg: {
            name: this.state.name,
            arg: this.state.arg,
            runtime: this.state.runtime
          }
        }, true);
        this.env = processEnv;

        try {
          var self = this;

          processEnv.save();
          await self.saveConfig({ status: ProvisionStatus.Up });
          this.numProcesses++;
        } catch (error) {
          await this.saveConfig({ status: ProvisionStatus.Error, error: error });
        }
      }
    }
  }

  private async saveConfig(overwrite) {
    
    // TODO: Replace with upsert: https://pouchdb.com/guides/conflicts.html#two-types-of-conflicts
    await Util.retry(async (retry) => {
      try {
        this.state = {
          ...this.state,
          ...(await this.db.rel.save('podConfig', {
              ...this.state, ...overwrite
          }))
        };
      } catch (error) {
        retry(error)
      }
    }, 8);
  }

  private async saveInstall() {
    let attachment = await this.db.rel.getAttachment('podConfig', this.state.id, 'package.zip.pgp');
    let key = process.env.STARK_USER_KEY;

    // Decrypt the deployment.
    let { data: decrypted } = await openpgp.decrypt({
      message: await openpgp.message.read(attachment), // parse encrypted bytes
      passwords: [key],        // decrypt with password
      format: 'binary'                                // output as Uint8Array
    });
    attachment = decrypted;
    decrypted = undefined;

    // Save the package.
    await fs.remove(this.packageDir);
    let zip = new JSZip();
    zip = await zip.loadAsync(attachment);
    attachment = undefined;

    for(let filename of Object.keys(zip.files)) { 
      let file = await ((zip.file(filename)).async('uint8array'));
      let dest = path.join(this.packageDir, filename);
      fs.outputFileSync(dest, file);
    }
    zip = undefined;

    await execShellCommand(`cd ./${this.packageDir} && npm install`);
    // NPM 7 has the bug wht doesn't navigate directories due to env_var so I have to:
    // await execShellCommand(`cd ./${packageDir} && tsc`); // TODO: clean this somehow??
  }

  // NOTE: Is called by load, when the podConfig changes.
  async delete(isFull = false) {
    if (isFull) { this.watcher.cancel(); }
    
    for (let index = 0; index < this.numProcesses; index++) {
      await this.env.delete();
    }

    this.numProcesses = 0;
    delete this.env;

    if (isFull) {
      this.eventEmitter.emit('delete', this.state.name);
      await fs.remove(this.packageDir);
      this.state = undefined;
    }
  }

  private newPodConfigModel = ObjectModel({
    name: String,
    mode: [DeploymentMode.Core, DeploymentMode.Edge, DeploymentMode.Browser]
  });

  private validateNew() {
    this.argValid = this.validate ? new this.newPodConfigModel(this.arg) : this.arg;
  }
    
  private validateState() {
    assert(!!this.state);
  }
}