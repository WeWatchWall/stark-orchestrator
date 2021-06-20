import { ObjectModel } from "objectmodel"
import { v4 as uuidv4 } from 'uuid';
import generator from 'generate-password';

import { User } from './user';

export class UserUser extends User {
	init(): void {
		this.arg.name = `${uuidv4()}`; // TODO: Decide what a username REGEX is like
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
	
	protected newUserModel = ObjectModel({
		name: String,
		password: String
		
	}).assert(
		newUser => {
			// TODO
			return newUser &&
			
				// Alphanumeric string that may include _ and - having a length of 3 to 20 characters.
				RegExp('^[a-zA-Z0-9-_]{3,50}$').test(newUser.name) &&
				newUser.name.indexOf('nodedb-') === -1 &&
				RegExp('^[a-zA-Z0-9]{8,20}$').test(newUser.key) &&
				RegExp('^[a-zA-Z0-9]{8,20}$').test(newUser.password);
		}
	);
	
}