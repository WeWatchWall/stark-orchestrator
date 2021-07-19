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
    validate: boolean;
    state: any;
    processes: Array<PodEnv> = [];
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
		if (this.validate) { this.validateNew(); }
	}

  init() { throw new Error("This method is not implemented."); }

  async load() {
    if (this.state) { return; }
    if (this.validate) { this.validateNew(); }

    this.packageDir = path.join(`./packages-run`, this.arg.name);

    // Get the initial state.
    this.state = (await this.db.find({
      selector: { data: this.arg },
      limit: 1
    })).docs;
    let podId = this.state[0]._id;
    this.state = await this.db.rel.parseRelDocs('podConfig', this.state);
    this.state = this.state.podConfigs[0];
    
    await this.saveConfig({ status: ProvisionStatus.Init });
    await this.saveInstall();
    await this.save(this.state);

    var self = this;
    this.watcher = this.db.changes({
      since: 'now',
      live: true,
      include_docs: true,
      selector: {
          "_id": podId
      }
    }).on('change', async function (change) {
      if (change.deleted) {
          await self.delete(true);
          return;
      }

      if (self.isSaveConfig) { return; }

      let parsedChange = await self.db.rel.parseRelDocs('podConfig', [change.doc]);
      parsedChange = parsedChange.podConfigs[0];
      await self.save(parsedChange);
    });
  }

  // NOTE: Is called by load, when the podConfig changes.
  async save(update) {
    this.validateState();

    if (this.state.attachments["package.zip.pgp"].revpos !== update.attachments["package.zip.pgp"].revpos) {
      await this.delete();
      await this.saveInstall();
    }
    this.state = update;

    if (this.state.status === ProvisionStatus.Stop) { await this.delete(); return; }

    if (this.processes.length > this.state.numPods) {
      for (let i = 0; i < this.processes.length - this.state.numPods; i++) {
        let processEnv = this.processes.pop();
        // await processEnv.delete();
      }
    } else if (this.state.numPods > this.processes.length) {
      for (let i = 0; i < this.state.numPods - this.processes.length; i++) {
        let processEnv = new PodEnv({ arg: { name: this.state.name } }, true);
        this.processes.push(processEnv);

        try {
          var self = this;
          process.on('uncaughtException', async (error) => { // DO SOME ERROR CHECKING SAME POD?
              await self.saveConfig({status: ProvisionStatus.Error, error: error});
          });

          await processEnv.save();
          await this.saveConfig({status: ProvisionStatus.Up});
        } catch (error) {
          await this.saveConfig({ status: ProvisionStatus.Error, error: error });
        }
          
      }
    }
  }

  private async saveConfig(overwrite) {
    this.isSaveConfig = true;
    
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
    }, 7);

    this.isSaveConfig = false;
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

    await execShellCommand(`npm --prefix ./${this.packageDir} install ./${this.packageDir}`);
    // NPM 7 has the bug wht doesn't navigate directories due to env_var so I have to:
    // await execShellCommand(`cd ./${packageDir} && tsc`); // TODO: clean this somehow??
  }

  // NOTE: Is called by load, when the podConfig changes.
  async delete(isFull = false) {
    if (isFull) { this.watcher.cancel(); }
    
    for (let processEnv of this.processes) {
      await processEnv.delete();
    }

    if (isFull) {
      this.eventEmitter.emit('delete', this.state.name);
      await fs.remove(this.packageDir);
    }

    this.processes = [];
    this.state = undefined;
  }

  private newPodConfigModel = ObjectModel({
    name: String,
    mode: [DeploymentMode.Core, DeploymentMode.Edge, DeploymentMode.Browser]
  });

  private validateNew() {
    this.arg = new this.newPodConfigModel(this.arg);
  }
    
  private validateState() {
    assert(!!this.state);
  }
}