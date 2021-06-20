import FlatPromise from "flat-promise";
import { ObjectModel } from 'objectmodel';
import PouchDB from 'pouchdb';
import find from 'pouchdb-find';
import rel from 'relational-pouch';
import assert from 'assert';
import promiseRetry from 'promise-retry';
import nano from 'nano';

PouchDB
  // .plugin(someadapter)
  .plugin(require('pouchdb-security-helper')) 
  .plugin(require('pouchdb-authentication'))
  .plugin(find)
  .plugin(rel);

export class Database {
	arg: any;
	username: String;
	password: String;
	validate: boolean;
    dbName: string;
	state: any;
	string: string;
	
	constructor(arg = { arg: {}, username: undefined, password: undefined},  validate = false) {
		this.arg = arg.arg;
		this.username = arg.username;
		this.password = arg.password;
		this.validate = validate;
	}
		
	init(): void { 
		throw new Error("This method is not implemented.");
	}
	
	parse(arg: string) {
		this.arg = JSON.parse(arg);
		this.validateNew();
	}
	
	async load() { 
		if (this.validate) {
			this.validateNew();
		}
		let dbName = `userdb-${Buffer.from(this.arg.username, 'utf8').toString('hex')}`;
		this.dbName = dbName;
		
		// skip_setup: true, auth: { username: "admin", password: "mLHhxiForA1ebt7V1lT1" }
		let address = `http://${this.username}:${this.password}@${process.env.STARK_DB_HOST}:5984`;
		let server = nano(address);

		let promise = new FlatPromise();
		promiseRetry(
			function (retry) {
				return server.db.get(dbName).catch(retry); // Maybe use nano.use??
			},
			{retries: 7}
		).then(
			() => {
				promise.resolve()
			},
			(error) => {
				promise.reject(error);
			}
		);
		await promise.promise;

		this.state = new PouchDB(`${address}/${this.dbName}`, {
			skip_setup: true
		});
		this.validateState();
	}
    
    // NOOP
	async save() {
	}

	toString() {
		this.string = JSON.stringify(this.state);
	}
    
    // NOOP, just DELETE THE USER...
    async delete() {
	}

	private newDatabaseModel = ObjectModel({
		username: String
    }).assert(
		newDatabase => {
			// TODO
            return newDatabase
                && RegExp('^[a-z0-9_-]{3,50}$').test(newDatabase.username);
				
		}
	);
	
	private validateNew() {		
		this.arg = new this.newDatabaseModel(this.arg);
	}
	
	private validateState() {
		assert(this.state);
	}
	
}