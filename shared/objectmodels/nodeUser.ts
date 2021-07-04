import { ObjectModel } from "objectmodel"

import { User } from '../../shared/objectmodels/user';

export class NodeUser extends User {

    /**
	 * Creates an instance of user.
	 * @param [arg.db]
	 * @param [arg.arg]
	 * @param [validate] Is necessary because the arg could be used to load (future).
	 */
	constructor(arg = { server: undefined, arg: undefined},  validate = false) {
        super(arg, validate);
	}
    
    init(): void {
        this.arg = {
            name: process.env.STARK_NODE_NAME,
            password: process.env.STARK_NODE_PASSWORD
        }

        if (this.validate) { super.validateNew() };
    }

	async load() {
		if (this.state) {return;}

        // TODO: load nodeUser through the database...

        this.validateState();
	}

    async save() {
        // TODO: update nodeUser through the database...
	}

    toString() {
        this.validateState();
		this.string = JSON.stringify(this.state);
	}
    
    // TODO: Not sure if needed
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
                RegExp('^[a-zA-Z0-9_-]{3,50}$').test(newUser.name) &&
                newUser.name.indexOf(`nodeDb-`) > -1 &&
                RegExp('^[a-zA-Z0-9]{8,20}$').test(newUser.password);
        }
    );
    
    protected stateUserModel = this.newUserModel;
}