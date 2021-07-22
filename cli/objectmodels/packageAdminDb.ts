import { ObjectModel } from "objectmodel";
const openpgp = require('openpgp'); // Only works with require :(

import { PackageConfig } from "./packageConfig";
import { PackageLocalDb } from "./packageLocalDb";

export class PackageAdminDb extends PackageLocalDb {
  username: any;
  userKey: any; 

  constructor(arg = { arg: undefined, userKey: undefined }, validate = false) { 
    super(arg, validate);
    this.userKey = arg.userKey;
  }
  
  async load() {
    if (!!this.arg.state) {
      this.state = this.arg.state;
      this.arg.packageConfig.arg.attachment = this.state.buffer;
      return;
    }

    await this.arg.packageConfig.load();
    this.state = this.arg.packageConfig.state.attachment;
    const { data: decrypted } = await openpgp.decrypt({
      message: await openpgp.message.read(this.state), // parse encrypted bytes
      passwords: [process.env.STARK_USER_KEY],        // decrypt with password
      format: 'binary'                                // output as Uint8Array
    });

    const { message } = (await openpgp.encrypt({
      message: openpgp.message.fromBinary(decrypted), // input as Message object
      passwords: [this.userKey],          // multiple passwords possible
      armor: false                                      // don't ASCII armor (for Uint8Array output)
    }));
  
    this.state = message.packets.write();
  }

  protected newPackageModel = ObjectModel({
    name: String,
    packageConfig: PackageConfig,
    state: [Object]
  }).assert(newPackageModel => {
    return !!newPackageModel;
  });
}