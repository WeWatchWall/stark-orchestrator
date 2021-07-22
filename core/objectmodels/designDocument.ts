import { ObjectModel } from "objectmodel";
import assert from "assert";

export class DesignDocument {
  db: any;

  arg: any;
  argValid: any;
  state: any;
  validate: boolean;
	
	string: string;
		
	constructor(arg = { db: undefined, arg: undefined},  validate = false) {
		this.db = arg.db;
		this.arg = arg.arg;
		this.validate = validate;
	}
	
    init(): void {
        this.arg = {
            _id: "_design/replicate",
            filters: {
                "hasTypes": "function (doc, req) {    var delimiterIndex = doc._id.substr(0, doc._id.indexOf('_'));    if (doc._id.indexOf('_design') > -1 || delimiterIndex === -1) {        return false;    }    if (req.query.types.indexOf(delimiterIndex) === -1) {        return !!req.query.isNegative;    }    return !req.query.isNegative;}"
            }
        };
    }

	parse(arg: string) {
		this.arg = JSON.parse(arg);
		this.validateNew();
	}
	
	// Maybe using nano instead of pouch.find: https://github.com/apache/couchdb-nano
	async load() { throw new Error("This method is not implemented."); }
		
	async save() {
		this.validateNew();
    let current = this.state || this.argValid;

    this.state = { ...current, ...await this.db.put(current) };
    // Fixed. Clearly this saves id to the wrong property. id -> _id.
    this.state = { ...this.state, ...{_id: this.state.id, id: undefined}};
		this.validateState();
	}
	
	toString() {
		this.validateState();
		this.string = JSON.stringify(this.state);
	}
	
	// NOOP
	async delete() {
	}
	
	private newDesignDocumentInstance = ObjectModel({
		filters: Object
	})
	.assert(
		newDesignDocument => {
			
			return newDesignDocument &&
                newDesignDocument._id &&
                newDesignDocument._id.startsWith('_design/');
				
		}
	);
		
  private validateNew() {
    this.argValid = this.validate ? new this.newDesignDocumentInstance(this.arg) : this.arg;
	}

	private validateState() {
		assert(!!this.state);
	}

}