import { ObjectModel } from "objectmodel";

export class DatabaseSecurity {
	db: any;
	arg: any;
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
		this.validate = validate;
	}

    init() { throw new Error("This method is not implemented."); }
	
	/**
	 * Parses user.
	 * @param arg 
	 */
	parse(arg: string) {
		this.arg = JSON.parse(arg);
		if (this.validate) { this.validateNew(); }
	}
	
    async load() {
        if (this.state) { return; }
        if (this.validate) { this.validateNew(); }

        // TODO: FAILS? NP for now!
        await this.db.security().fetch();
        this.state = this.db.security();

        // Just re-create it using the available info :()
        this.state.admins.add({
            names: [this.arg.nodeUsername]
        });
        this.state.members.add({
            names: [this.arg.nodeUsername]
        });
	}

    async save() {
        this.state.members.add({
            names: [this.arg.username]
        });

        await this.state.save();
	}

	toString() {
		this.string = JSON.stringify(this.state);
	}
	
    async delete() {
        throw new Error("This method is not implemented.");
	}

    private newDatabaseSecurityModel = ObjectModel({
        username: String,
        nodeUsername: String
    });

    private validateNew() {
        this.arg = new this.newDatabaseSecurityModel(this.arg);
    }
	
}