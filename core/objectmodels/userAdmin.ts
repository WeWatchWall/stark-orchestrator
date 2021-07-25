import { ObjectModel, ArrayModel } from "objectmodel"
import { User } from './user';
import generator from 'generate-password';
import validator from "email-validator";

// TODO: 
//  Generate a key here like this useless password...
//  Write new.env settings to the shared value(key) accross this core service!!! 
// EASIER IMPLEMENTED HERE: Generate it first, put in config, and just use it... 
export class UserAdmin extends User {
  static AdminName = 'admin';  // TODO: Move to .env file

  init(): void {
    this.arg = {
      name: UserAdmin.AdminName,
      password: generator.generate({ // Never gets used because it is overwritten in the login process 
        length: 10,
        numbers: true,
        symbols: false
      }),
      key: generator.generate({ // Never gets used because on the edge because then I'm sharing the admin key(sage advice)
        length: 10,
        numbers: true,
        symbols: false
      }),
      email: process.env.STARK_EMAIL_USERNAME
    };
    
    super.validateNew();
  }
  
  protected newUserModel = ObjectModel({
    name: String,
    password: String,
    key: String,
    email: String,
    enableUsers: Boolean,
    enableFriends: Boolean,
    enableNodes: Boolean,  
    enableAllNodes: Boolean,
    enablePods: Boolean,
    corePackageConfigs: ArrayModel(String),
    packageConfigs: ArrayModel(String)
  }).defaultTo({
    enableUsers: true,
    enableFriends: false,
    enableNodes: true,
    enableAllNodes: true,
    enablePods: true,
    corePackageConfigs: ['stark-core-config'],
    packageConfigs: ['stark-edge-config']
  }).assert(
    newUser => {
      // TODO
      return newUser &&
        
        newUser.name === UserAdmin.AdminName &&
        validator.validate(newUser.email) &&
        RegExp('^[a-zA-Z0-9]{8,20}$').test(newUser.key) &&
        RegExp('^[a-zA-Z0-9]{8,20}$').test(newUser.password);
    }
  );
  
}