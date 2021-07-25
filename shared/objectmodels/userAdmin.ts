import { ObjectModel } from "objectmodel"
import { UserAuth } from './userAuth';

// TODO: 
//  Generate a key here like this useless password...
//  Write new.env settings to the shared value(key) accross this core service!!! 
// EASIER IMPLEMENTED HERE: Generate it first, put in config, and just use it... 
export class UserAdmin extends UserAuth {
  static AdminName = 'admin';
  validate = false;

  init(): void {
    throw new Error("This method is not implemented.");
  }
  
  async save() { 
    throw new Error("This method is not implemented.");
  }

  async delete() { 
    throw new Error("This method is not implemented.");
  }
  
  protected newUserModel;
    
  protected stateUserModel = ObjectModel({
    name: UserAdmin.AdminName,
    password: String,
    key: String
    }).assert(
    newUser => {
      // TODO
      return newUser &&
      
        // Alphanumeric string that may include _ and - having a length of 3 to 20 characters.
        newUser.name === UserAdmin.AdminName &&
        RegExp('^[a-zA-Z0-9]{8,20}$').test(newUser.password) &&
        RegExp('^[a-zA-Z0-9]{8,20}$').test(newUser.key);
          
    }
  );
}