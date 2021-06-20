import PouchDB from 'pouchdb';
PouchDB.plugin(require('pouchdb-authentication'));

import updateDotenv from 'update-dotenv';
import FlatPromise from 'flat-promise';

import { UserAdmin } from '../objectmodels/userAdmin';
import { UserUser } from '../objectmodels/userUser';
import { Database } from '../../shared/objectmodels/database';
import { UserConfig } from '../objectmodels/userConfig';
import { PackageRegistration } from '../../cli/services/packageRegistration';
import { DeploymentMode } from '../../shared/objectmodels/deploymentMode';
import { Availability } from '../../shared/objectmodels/availability';
import { Security } from '../../shared/objectmodels/security';
import { DesignDocument } from '../objectmodels/designDocument';
// import { Replication } from '../objectmodels/replication';


export class UserRegistration {
    status = false;
    isInit = false;
    static db = new PouchDB(`http://${process.env.STARK_USER_NAME}:${process.env.STARK_USER_PASSWORD}@${process.env.STARK_DB_HOST}:5984/_users`, {
        skip_setup: true
    });
    packageRegistrationService: PackageRegistration;

	constructor(packageRegistrationService: PackageRegistration) {
		this.packageRegistrationService = packageRegistrationService;
	}

    async init() { 
        if (this.status) { return; }

        /* #region  ADMIN USER */
        let adminUser = new UserAdmin();
        adminUser.init();
        
        try {
            // 2. initialize the admin user with its own deployment key
            await this.add(adminUser.arg);
            this.isInit = true;
        } catch (error) {
            if (error.status !== 409) {
                throw error;
            }

            // OK to timeout
            let promise = new FlatPromise();
            setTimeout(() => { 
                promise.resolve();
            }, 3e3);
            await promise.promise;
            
        }
        /* #endregion */

        /* #region  ADMIN KEY */
        let adminDatabase = new Database({ arg: { username: UserAdmin.AdminName }, username: process.env.STARK_USER_NAME, password: process.env.STARK_USER_PASSWORD });
        await adminDatabase.load();
        // Might load before it exists but after the DB becomes available, but not likely!!
        let adminConfig = new UserConfig({ db: adminDatabase.state, arg: { name: UserAdmin.AdminName} });
        await adminConfig.load();

        await updateDotenv({
            STARK_USER_KEY: adminConfig.state.key
        });
        /* #endregion */

        if (!this.isInit) { return; }
        /* #region BOOTSTRAP ADMIN PACKAGES */
		let pack; // : PackageDb (not : PackageDb | PackageLocal)
		for (let adminEdgeConfig of adminConfig.state.packageConfigs) { 
			pack = await this.packageRegistrationService.add({
                db: adminDatabase.state,
                username: process.env.STARK_USER_NAME,
				arg: {
                    name: adminEdgeConfig,
                    mode: DeploymentMode.Edge,
                    security: Security.Public
				}
            });
            await pack.save();
			await pack.delete();
		}

		for (let adminCoreConfig of adminConfig.state.corePackageConfigs) { 
			pack = await this.packageRegistrationService.add({
                db: adminDatabase.state,
                username: process.env.STARK_USER_NAME,
                arg: {
					name: adminCoreConfig,
					mode: DeploymentMode.Core,
                    security: Security.Public
				}
            });
            await pack.save();
			await pack.delete();
		}
        /* #endregion */
        
        this.status = true;        
    }

    async add(arg): Promise<void> {
        let adminDatabase;
        let adminConfig;

        /* #region  CREATE USER */
        if (arg.name !== UserAdmin.AdminName) {
            adminDatabase = new Database({ arg: { username: UserAdmin.AdminName }, username: process.env.STARK_USER_NAME, password: process.env.STARK_USER_PASSWORD });
            await adminDatabase.load();

            adminConfig = new UserConfig({ db: adminDatabase.state, arg: { name: UserAdmin.AdminName} });
            await adminConfig.load();
            
            if (!adminConfig.state.enableUsers) { return; }    
        }
        
        let user = new UserUser(
            {
                db: UserRegistration.db,
                arg: arg
            },
            true
        );
        await user.save();
        /* #endregion */

        /* #region  SAVE USER CONFIG */
        let database = new Database({ arg: { username: user.arg.name }, username: process.env.STARK_USER_NAME, password: process.env.STARK_USER_PASSWORD });
        await database.load();

        let designDocument = new DesignDocument(
            {
                db: database.state,
                arg: undefined
            },
            true
        );
        designDocument.init();
        await designDocument.save();    

        let userConfig = new UserConfig(
            {
                db: database.state,
                arg: { ...arg, ...{password: undefined, dbName: database.dbName} }
            },
            true
        );
        await userConfig.save();
        await userConfig.load(); // Might merge with save, shrug...
        /* #endregion */

        if (arg.name === UserAdmin.AdminName) { return; }
        /* #region  BOOTSTRAP ADMIN TO USER PACKAGES */
        let adminPack;
        let pack;
        // This solution is the only workable way because with replicated
        // packages, I cannot provide a different public key/password(for now)
        // for each user
        for (let adminEdgeConfig of adminConfig.state.packageConfigs) {

            // Make these packages private!
            adminPack = await this.packageRegistrationService.get({
                db: adminDatabase.state,
                userKey: userConfig.state.key,
                arg: {
					name: adminEdgeConfig                                       
				}
            });

            if (adminPack.arg.packageConfig.state.availability !== Availability.Any) { continue; }
            if (adminPack.arg.packageConfig.state.security !== Security.Public) { continue; }
            if (adminPack.arg.packageConfig.state.mode === DeploymentMode.Core) { continue; }

            pack = await this.packageRegistrationService.add({
                db: database.state,
                isAdmin: true,
                username: user.arg.name,
                arg: {
					name: adminEdgeConfig,
                    security: Security.Private,
                    mode: adminPack.arg.packageConfig.state.mode,
                    state: adminPack.state
				}
            });
            pack.save();
        }
        /* #endregion */
        
        
        /* #region  TODO: CLEANUP */
        //     if (arg.name === UserAdmin.AdminName) { return; }

        //     let databaseReplication = new Replication(
        //         {
        //             source: database.dbName,
        //             target: adminDatabase.dbName
        //         },
        //         true
        //     );
        //     await databaseReplication.save();

        //     await userConfig.load();
        //     userConfig.state.replication = {
        //         id: databaseReplication.state.id,
        //         rev: databaseReplication.state.rev
        //     };
            
        //     await userConfig.save();
        /* #endregion */
    }

}