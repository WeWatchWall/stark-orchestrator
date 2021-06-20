// TODO: Remove import FlatPromise from "flat-promise";
import { ArrayModel, ObjectModel } from 'objectmodel';
import assert from "assert";
import { DeploymentMode } from '../../shared/objectmodels/deploymentMode';
import { Security } from '../../shared/objectmodels/security';
import { Availability } from '../../shared/objectmodels/availability';

export class PackageConfig {
	db: any;
    arg: any;
    attachment: Buffer;
	validate: boolean;
	state: any;
	string: string;
	
	/**
	 * Creates an instance of user.
	 * @param [arg.db]
	 * @param [arg.arg]
	 * @param [validate] Is necessary because the arg could be used to load (future).
	 */
	constructor(arg = { db: undefined, arg: undefined},  validate = false) {
		this.db = arg.db;
        this.arg = arg.arg;
        this.attachment = arg.arg.attachment; // Extra, data-filtered property!
		this.validate = validate;
	}

    init(): void { throw new Error("This method is not implemented."); }
	
	/**
	 * Parses user.
	 * @param arg 
	 */
	parse(arg: string) {
		this.arg = JSON.parse(arg);
        if (this.validate) { this.validateNew(); }
	}
	
	async load() {
		if (this.state) {return;}
        if (this.validate) { this.validateNew(); }

        this.db.setSchema(this.packageConfigSchema);
		this.state = (await this.db.find({
			selector: { data: {name: this.arg.name} },
			limit: 1
		})).docs;
		this.state = await this.db.rel.parseRelDocs('packageConfig', this.state);
		this.state = this.state.packageConfigs[0];
        
        this.validateState();
        
        this.state.attachment = await this.db.rel.getAttachment('packageConfig', this.state.id, 'package.zip.pgp');
	}
	
	async save() {
        if (this.validate) { this.validateNew(); }

		this.db.setSchema(this.packageConfigSchema);
        this.state = await this.db.rel.save('packageConfig', this.state || this.arg);
        
        await this.db.rel.putAttachment('packageConfig', this.state, 'package.zip.pgp', this.arg.attachment, 'text/plain');

		this.validateState();
	}

	toString() {
        this.validateState();
        this.string = JSON.stringify(this.state);
	}
	
	async delete() {
		
	}

	// :() Constructor type?
	protected newUserModel = ObjectModel({
        // Relational
        name: String,
        
        // Config
        mode: [DeploymentMode.Core, DeploymentMode.Edge, DeploymentMode.Browser],
        availability: [Availability.Off, Availability.Tag, Availability.Any],
        security: [Security.Private, Security.Friends, Security.Public],
		tags: ArrayModel(String),
		maxPods: Number,
		numPods: Number
		
    }).defaultTo({
        // Require name
        // Require mode
        availability: Availability.Any,
        security: Security.Private,
		tags: [],
		maxPods: 0,
		numPods: -1
    }).assert(
		newUser => {
			// TODO
			return newUser &&
			
				// Alphanumeric string that may include _ and - having a length of 3 to 20 characters.
				RegExp('^[a-zA-Z0-9-_]{3,50}$').test(newUser.name);
		}
	);

	protected validateNew() {		
		this.arg = new this.newUserModel(this.arg);
	}

    private packageConfigSchema = [{ singular: 'packageConfig', plural: 'packageConfigs' }];

	protected validateState() {
		assert(!!this.state);
	}

	// TODO: STATE MODEL
}