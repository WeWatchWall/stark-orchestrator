import { ObjectModel } from "objectmodel";
import assert from "assert";

import nano from 'nano';
// import * as Nano from 'nano';
import PouchDB from 'pouchdb';
PouchDB.plugin(require('pouchdb-authentication'));

export class Replication {
	arg: any;
  argValid: any;
  state: any;
  validate: boolean;

  isLoaded: boolean;
	string: string;
	
	
	constructor(arg = {}, validate = false) {
		this.arg = arg;
		this.isLoaded = false;
		this.validate = validate;
	}
	
	init(): void { throw new Error("This method is not implemented."); }

	parse(arg: string) {
		this.arg = JSON.parse(arg);
		this.validateNew();
	}
		
	async load() {
		// if (this.isLoaded) {return;}
		this.validateNew();

		let db = new PouchDB(`http://${process.env.STARK_USER_NAME}:${process.env.STARK_USER_PASSWORD}@${process.env.STARK_DB_HOST}:5984/_replicator`, {
			skip_setup: true
		});

		let selector = this.argValid.id ? 
			{
				_id: this.argValid.id,
				_rev: this.argValid.rev
			} :
			{
				source: { $regex: this.argValid.source },
				target: { $regex: this.argValid.target }
			};

		let state = (await db.find({
			selector: selector,
			limit: 1
		})).docs[0];

		this.state = {
			id: state._id,
			rev: state._rev
		};

		this.isLoaded = true;
		this.validateState();
	}
	
	async save() {
		// Prevent duplicates.
		try {
			await this.load();
			await this.delete();
		} catch {
		}

		let server = nano(`http://${process.env.STARK_USER_NAME}:${process.env.STARK_USER_PASSWORD}@${process.env.STARK_DB_HOST}:5984`);

		// This is the task which can be cancelled :P
		this.state = await server.db.replication.enable(
			this.argValid.source,
			this.argValid.target,
			{
				...{
					continuous: true,
					source: undefined,
					target: undefined
				},
				...this.argValid
			}
		);
		
	}
	
	// NOOP
	toString() {
		this.string = JSON.stringify(this.state);
	}
	
	async delete() {
		this.validateState();
		let server = nano(`http://${process.env.STARK_USER_NAME}:${process.env.STARK_USER_PASSWORD}@${process.env.STARK_DB_HOST}:5984`);
		await server.db.replication.disable(this.state.id, this.state.rev, null);
	}

	private newReplicationModel = ObjectModel({
		id: [String],
		rev: [String],		
		source: [String],
		target: [String],
		filter: [String],
		query_params: [Object]
		
	}).assert(
		newDatabaseReplication => {

			return !!(newDatabaseReplication &&
				(newDatabaseReplication.id ?
					newDatabaseReplication.id && newDatabaseReplication.rev : 
					newDatabaseReplication.source && newDatabaseReplication.target
				));				
		}
	);
	
  private validateNew() {
    this.argValid = this.validate ? new this.newReplicationModel(this.arg) : this.arg;
	}

	private validateState() {
		assert(this.isLoaded);
		assert(this.state);
	}
}