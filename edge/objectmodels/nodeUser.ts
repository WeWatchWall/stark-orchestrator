// TODO:
// TODO: The only really non-shareable class in here; because of the request(https)(use the mode flag) and proxy {config}->import('update-dotenv').
// Validate load()
// If it cannot find its configuration in load() first
// Save config in the Save() function :P Which will use the PUT server/node/nodeid

import { ObjectModel } from "objectmodel"
import { v4 as uuidv4 } from 'uuid';
import generator from 'generate-password-browser';
import fetch from 'node-fetch';
import https from 'https';
import assert from 'assert';
import updateDotenv from 'update-dotenv';

import { User } from './user';
import { Util } from "../../shared/util";

export class NodeUser extends User {
    nodeConfig: any;

    /**
   * Creates an instance of user.
   * @param [arg.db]
   * @param [arg.arg]
   * @param [validate] Is necessary because the arg could be used to load (future).
   */
  constructor(arg = { server: undefined, nodeConfig: undefined, arg: undefined},  validate = false) {
    super(arg, validate);
    this.nodeConfig = arg.nodeConfig;
  }
    
  init(): void {
    this.arg.name = `nodeDb-${uuidv4()}`;
    this.arg.password = generator.generate({
        length: 10,
        numbers: true,
        symbols: false
    });

    super.validateNew();
  }

  // This might fail on the edge because the server isn't up yet...
  // So retry this function until it succeeds.
  async load() {
    await Util.retry(async (retry) => {
      try {
        await this.loadInternal();
      } catch (error) {
        retry(error)
      }
    }, 8);
  }

  private async loadInternal() {
    if (this.state) {return;}

    let loaded = false;
    try {
      this.state = {
          name: process.env.STARK_NODE_NAME,
          password: process.env.STARK_NODE_PASSWORD
      }
      
      this.validateState();
      loaded = true;
    } catch (error) {
      this.state = undefined;
    }
    
    if (!loaded) {
      this.init();
      await this.save();
    }
  }

  async save() {
    const result = await fetch(`https://${this.server}:${process.env.STARK_PORT}/nodes/nodeDb`, {
      method: 'put',
      body: JSON.stringify({...this.argValid, ...this.nodeConfig}),
      headers: { 'Content-Type': 'application/json' },
      agent: new https.Agent({
          rejectUnauthorized: false,
      })
    });
    
    assert(result.status === 201);

    this.state = {
      name: this.argValid.name,
      password: this.argValid.password
    };

    this.validateState();
    await updateDotenv({
      STARK_NODE_NAME: this.argValid.name,
      STARK_NODE_PASSWORD: this.argValid.password
    });

    await updateDotenv({
      STARK_SERVICES_NODE_NAME: `services-${this.argValid.name}`,
      STARK_SERVICES_NODE_PASSWORD: this.argValid.password
    });
  }

  toString() {
    this.validateState();
    this.string = JSON.stringify(this.state);
  }
    
    // AUTH!! Or through a database...
    async delete() {
        throw new Error("This method is not implemented.");
  }

    protected newUserModel = ObjectModel({
      name: String,
      password: String
    }).assert(
      newUser => {
        // TODO
        return newUser &&
          // Alphanumeric string that may include _ and - having a length of 3 to 20 characters.
          RegExp('^[a-zA-Z0-9_-]{3,75}$').test(newUser.name) &&
          newUser.name.indexOf(`nodeDb-`) > -1 &&
          RegExp('^[a-zA-Z0-9]{8,20}$').test(newUser.password);
      }
    );
    
    protected stateUserModel = this.newUserModel;
}