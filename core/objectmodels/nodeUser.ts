import { ObjectModel } from "objectmodel"
import { User } from './user';
import { v4 as uuidv4 } from 'uuid'; // Through Nano?
import generator from 'generate-password';

export class NodeUser extends User {
	init(): void {
		this.arg.name = `nodeDb-${uuidv4()}`;
		this.arg.password = generator.generate({
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
				RegExp('^[a-zA-Z0-9_-]{3,50}$').test(newUser.name) &&
				newUser.name.indexOf(`nodeDb-`) > -1 &&
				RegExp('^[a-zA-Z0-9]{8,20}$').test(newUser.password);
		}
	);
	
}