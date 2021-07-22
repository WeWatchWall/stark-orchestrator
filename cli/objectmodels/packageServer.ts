import { ObjectModel } from "objectmodel";
import assert from "assert";

import path from 'path';
import fs from 'fs-extra';
import JSZip from 'jszip';
const openpgp = require('openpgp'); // Only works with require :(

// TODO: USE PATH!!!
// TODO: CLI VERSION FOR BROWSER
// TODO: Use a JSON config file for these features:
// - deployment config - could be done in code for a start
// - ignore folders/files
export abstract class PackageServer { 
  // TODO: Make these defaults, and if there's optional arguments then I can override...
  static PackagesDir = `./packages`;
  static OutDir = `./packages-dist`;

  arg;
  argValid;
  state;
  validate: boolean;
  
  packageDir: string;
  watcher;
  string: string;

  constructor(arg = { arg: undefined }, validate = false) { 
    this.arg = arg.arg;
    this.validate = validate;
  }

  init(): void { throw new Error("This method is not implemented."); }
	
	/**
	 * Parses user.
	 * @param arg 
	 */
	parse(arg: string) {
		this.arg = JSON.parse(arg);
		this.validateNew();
	}
  
  // ABSTRACT
	async load() {
		throw new Error("This method is not implemented."); 
	}
    
  protected async _load() {
    this.validateNew();

    // From https://github.com/Stuk/jszip/issues/386
    this.state = PackageServer.getZipOfFolder(this.packageDir);
    this.state = await this.state.generateAsync({ type: "uint8array" });
    const { message } = (await openpgp.encrypt({
        message: openpgp.message.fromBinary(this.state), // input as Message object
        passwords: [process.env.STARK_USER_KEY],          // multiple passwords possible
        armor: false                                      // don't ASCII armor (for Uint8Array output)
    }));

    this.state = message.packets.write();
  }

  // ABSTRACT
  async save() {
    throw new Error("This method is not implemented.");
	}

  toString() {
      this.validateState();
      return JSON.stringify({
          isWatch: !!this.watcher,
          isLoaded: !!this.state
      });
	}

  async delete() {
    if (!this.state) { return; }
    await this.watcher.close();
  }
  
  protected validateNew() {
    this.argValid = this.validate ? new this.newPackageModel(this.arg) : this.arg;
	}

  protected newPackageModel = ObjectModel({
      name: String
  }).assert(newPackageModel => {
      return !!newPackageModel;
  });

  protected validateState() {
    assert(!!this.state);
  }
  
  private static getFilePathsRecursively(dir: string): string[] {
      // if (isBrowser()) {
      //   throw new Error('getFilePathsRecursively is not supported in browser');
      // }
    
      // returns a flat array of absolute paths of all files recursively contained in the dir
      let states: string[] = [];
      let list = fs.readdirSync(dir);
    
      var pending = list.length;
      if (!pending) return states;
    
      for (let file of list) {
        file = path.resolve(dir, file);
    
        let stat = fs.lstatSync(file);
    
        if (stat && stat.isDirectory()) {
          states = states.concat(PackageServer.getFilePathsRecursively(file));
        } else {
          states.push(file);
        }
    
        if (!--pending) return states;
      }
    
      return states;
    }
    
    private static getZipOfFolder (dir: string): JSZip {
      // if (isBrowser()) {
      //   throw new Error('getZipOfFolder is not supported in browser');
      // }
    
      // returns a JSZip instance filled with contents of dir.
    
      let allPaths = PackageServer.getFilePathsRecursively(dir);
    
      let zip = new JSZip();
      for (let filePath of allPaths) {
        // let addPath = path.relative(path.join(dir, '..'), filePath); // use this instead if you want the source folder itself in the zip
        let addPath = path.relative(dir, filePath); // use this instead if you don't want the source folder itself in the zip
        let data = fs.readFileSync(filePath);
        let stat = fs.lstatSync(filePath);
        let permissions = stat.mode;
    
        if (stat.isSymbolicLink()) {
          zip.file(addPath, fs.readlinkSync(filePath), {
            unixPermissions: parseInt('120755', 8), // This permission can be more permissive than necessary for non-executables but we don't mind.
            dir: stat.isDirectory()
          });
        } else {
          zip.file(addPath, data, {
            unixPermissions: permissions,
            dir: stat.isDirectory()
          });
        }
      }
    
      return zip;
    };
}