import fs from 'fs-extra';
import { PackageServer } from '../objectmodels/packageServer';
import { PackageLocal } from '../objectmodels/packageLocal';
import { PackageLocalDb } from '../objectmodels/packageLocalDb';
import { PackageConfig } from '../objectmodels/packageConfig';
import { UserConfig } from '../../shared/objectmodels/userConfig';
import { PackageAdminDb } from '../objectmodels/packageAdminDb';
import { DeploymentMode } from '../../shared/objectmodels/deploymentMode';
import { Database } from '../../shared/objectmodels/database';
const execShellCommand = require("../execShellCommand");

export class PackageRegistration {
  static PackagesDir = `./packages`;
  static OutDir = `./packages-dist`;

  async init() { 
    !(await fs.exists(PackageServer.PackagesDir)) && (await fs.mkdir(PackageServer.PackagesDir));
    !(await fs.exists(PackageServer.OutDir)) && (await fs.mkdir(PackageServer.OutDir));
  }
    
  // NOTE: Assumes that the returned package calls save() either by itself(when local files change)
  // or after the call.
  async add(arg) {
    await this._adjustForDb(arg);

    return arg.db ? await this._addDb(arg) : await this._addLocal(arg);
  }


  async get(arg) {
    let packageConfig = new PackageConfig(arg, false);
    let packageDb = new PackageAdminDb(arg, true);
    packageDb.arg.packageConfig = packageConfig;
    await packageDb.load();
    return packageDb;
  }

  async _addDb(arg) {        
    let packageConfig = new PackageConfig(arg, true);

    try {
      await packageConfig.load();
    } catch (error) {            
      let userConfig = new UserConfig({ db: arg.db, arg: { name: arg.username} });
      await userConfig.init();
      let packageConfigs = new Set(userConfig.state.packageConfigs);
      packageConfigs.add(arg.arg.name);
      userConfig.state.packageConfigs = Array.from(packageConfigs);
      await userConfig.save();
    }
    
    let packageDb = arg.isAdmin ? new PackageAdminDb(arg, true) : new PackageLocalDb(arg, true);
    packageDb.arg.packageConfig = packageConfig;
    
    await packageDb.load();
    return packageDb;
  }

  async _addLocal(arg) { 
    let result = new PackageLocal(arg, true);
    await result.load();
    return result;
  }

  async _adjustForDb(arg) {
    let hasEnv = process.env.STARK_USER_NAME && process.env.STARK_USER_PASSWORD;
    let dirPath = `${process.cwd()}/packages/${arg.arg.name}`;
    let configPath = `${dirPath}/stark-config.js`;
    let hasConfig = await fs.exists(configPath);

    if (!arg.arg.db && hasEnv) {
      let database = new Database({ arg: { username: process.env.STARK_USER_NAME, dbServer: process.env.STARK_DB_HOST }, username: process.env.STARK_USER_NAME, password: process.env.STARK_USER_PASSWORD });
      await database.load();
      database.state.setSchema(this.userDbSchema);
      arg.db = database.state;
      arg.isAdmin = false;
      arg.username = process.env.STARK_USER_NAME;
    }

    if (!hasConfig) { return; }

    let packConfig = (await import(configPath)).default;
    arg.arg = { ...arg.arg, ...packConfig };
    if (packConfig.mode === DeploymentMode.Browser) {
      await execShellCommand(`cd ${dirPath} && npm install`);
    }
  }

  private userDbSchema = [
    { singular: 'packageConfig', plural: 'packageConfigs' },
    {
      singular: 'userConfig', plural: 'userConfigs',
      relations: {
        nodeConfigs: { hasMany: 'nodeConfig' }
      }
    },
    { singular: 'nodeConfig', plural: 'nodeConfigs', relations: { userConfig: { belongsTo: 'userConfig' } } }
  ];
}