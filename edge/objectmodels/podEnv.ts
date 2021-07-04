import assert from "assert";
import { ObjectModel } from "objectmodel";

import path from 'path';
import fs from 'fs-extra';
const { NodeVM } = require('vm2');


// TODO: SCALING UP+DOWN with UPDATE

export class PodEnv {
    static PackagesDir = `./packages-run`;
    db: any;
	arg: any;
	validate: boolean;
	state: any;
	string: string;
    packageDir: any;
    
	constructor(arg = { arg: undefined},  validate = false) {
		this.arg = arg.arg;
		this.validate = validate;
	}

    init() { throw new Error("This method is not implemented."); }

	parse(arg: string) {
		this.arg = JSON.parse(arg);
		if (this.validate) { this.validateNew(); }
	}
	
    async load() {
        if (this.state) { return; }
        if (this.validate) { this.validateNew(); }
        this.packageDir = `${PodEnv.PackagesDir}/${this.arg.name}`;

        if (!(await fs.exists(this.packageDir))) {
            throw new Error(`Input Error. The specified package does not exist in ${this.packageDir}`);
        }

        this.state = true;
	}

    async save() {
        if (!this.state) { await this.load(); } // TODO: USE THIS PATTERN!
        this.validateState();

        
        // TODO: SANDBOX WITH (SCAFFOLD FILES) + (SEPARATE PROCESS OR THREAD) + (ARGUMENTS for VM2)
        const vm = new NodeVM({
            console: 'inherit',
            sandbox: {},
            require: {
                external: {
                    modules: ['*'],
                    transitive: true
                },
                builtin: ['*'],
                root: `${path.join(this.packageDir)}`,
                mock: {
                    fs: {
                        readFileSync() { return 'Nice try!'; }
                    }
                }
            }
        });

        let functionInSandbox = vm.run(
            `
                module.exports = function(arg) {
                    console.log(process.cwd());
                    const app = require('./dist/index.js');
                    app(arg);
                }            
            `,
            path.join(this.packageDir, 'stark_bootstrap.js')
        );
        functionInSandbox(this.arg.name);
	}

	toString() {
		this.string = JSON.stringify(this.state);
	}
    
    // TODO!! Store the sandbox so that I can cancel that while I'm scaling down!!
    // If I reach 0, and I call delete again, then I delete the install package,
    // So that I can call load automatically again...:()
    async delete() {
	}

    private newPodEnvModel = ObjectModel({
        name: String
    });

    private validateNew() {
        this.arg = new this.newPodEnvModel(this.arg);
    }

    private validateState() {
        assert(!!this.state);
    }
	
}