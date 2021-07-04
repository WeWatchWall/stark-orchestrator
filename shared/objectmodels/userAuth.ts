import { ObjectModel } from "objectmodel";
import { v4 as uuidv4 } from 'uuid';
import generator from 'generate-password';
import validator from "email-validator";

import { UserUnauth } from "./userUnauth";

export class UserAuth extends UserUnauth {

	init(email?: String): void {
		this.arg.name = `${uuidv4()}`; // TODO: Decide what a username REGEX is like
		this.arg.email = email;
		this.arg.password = generator.generate({
			length: 10,
			numbers: true,
			symbols: false
		});
		this.arg.key = generator.generate({
			length: 10,
			numbers: true,
			symbols: false
		});
		super.validateNew();
	}

	async save() { 
		if (this.validate) { this.validateNew(); }
        // TODO through PUT server/user/userId OPTIONAL AUTH
	}
	
	
	async delete() {
		this.validateState();
		// Through Auth!
		// TODO through DEL server/user/userId
	}

	protected newUserModel = ObjectModel({
		name: String,
		password: String,
		key: String
		
	}).assert(
		newUser => {
			// TODO
			return newUser &&
			
				// Alphanumeric string that may include _ and - having a length of 3 to 20 characters.
				RegExp('^[a-zA-Z0-9-_]{3,50}$').test(newUser.name) &&
				newUser.name !== 'admin' &&
				newUser.name.indexOf('nodedb-') === -1 &&
				validator.validate(newUser.email) &&
				RegExp('^[a-zA-Z0-9]{8,20}$').test(newUser.password) &&
				RegExp('^[a-zA-Z0-9]{8,20}$').test(newUser.key);
		}
	);

	protected stateUserModel = ObjectModel({
		name: String,
		password: String,
		key: String
		
	}).assert(
		newUser => {
			// TODO
			return newUser &&
			
				// Alphanumeric string that may include _ and - having a length of 3 to 20 characters.
				RegExp('^[a-zA-Z0-9-_]{3,20}$').test(newUser.name) &&
				newUser.name.indexOf('nodedb-') === -1 &&
				RegExp('^[a-zA-Z0-9]{8,20}$').test(newUser.key) &&
				RegExp('^[a-zA-Z0-9]{8,20}$').test(newUser.password);
		}
	);
}