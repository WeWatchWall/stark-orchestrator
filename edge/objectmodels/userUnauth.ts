import { ObjectModel } from "objectmodel";

import { User } from "./user";

export class UserUnauth extends User {
  init(): void {
    this.arg = {
      name: process.env.STARK_USER_NAME,
            password: process.env.STARK_USER_PASSWORD
    };
    this.validateNew();
  }
  
  protected newUserModel = ObjectModel({
    name: String,
    password: [String],
    key: [String]
  }).assert(
    newUser => {
      // TODO
      return newUser &&
      
        // Alphanumeric string that may include _ and - having a length of 3 to 20 characters.
        RegExp('^[a-zA-Z0-9-_]{3,75}$').test(newUser.name) &&
        newUser.name.indexOf('nodedb-') === -1;
        // TODO: CONDITIONAL IF THERE IS A PASSWORD RegExp('^[a-zA-Z0-9]{8,20}$').test(newUser.password)
    }
  );

  protected stateUserModel = ObjectModel({
    name: String,
    password: [String],
    key: String
  }).assert(
    newUser => {
      // TODO
      return newUser &&
      
        // Alphanumeric string that may include _ and - having a length of 3 to 20 characters.
        RegExp('^[a-zA-Z0-9-_]{3,75}$').test(newUser.name) &&
        newUser.name.indexOf('nodedb-') === -1 &&
        RegExp('^[a-zA-Z0-9]{8,20}$').test(newUser.key);
        // TODO: CONDITIONAL IF THERE IS A PASSWORD RegExp('^[a-zA-Z0-9]{8,20}$').test(newUser.password)
    }
  );
}