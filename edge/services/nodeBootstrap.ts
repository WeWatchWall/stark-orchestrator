import { NodeConfig } from "../objectmodels/nodeConfig";
import { NodeUser } from "../objectmodels/nodeUser";
import { Database } from "../../shared/objectmodels/database";
import { UserUnauth } from "../../shared/objectmodels/userUnauth";

export class NodeBootstrap {
    nodeConfig: NodeConfig;
    user: UserUnauth;
    nodeUser: NodeUser;
    database: Database;

    async init() { 
        this.nodeConfig = new NodeConfig({
            db: undefined,
            arg: {}
        }, true)
        this.nodeConfig.init();

        this.user = new UserUnauth({
            server: undefined,
            arg: undefined
        }, true);
        this.user.init();

        this.nodeUser = new NodeUser({
            server: `${process.env.STARK_HOST}`,
            nodeConfig: this.nodeConfig.arg,
            arg: {}
        }, true);

        await this.nodeUser.load();        
        
        // The admin key should exist on the core node after I add the node. 
        // this.user.state.key
        this.user.load();

        this.database = new Database({ arg: { username: this.nodeUser.state.name }, username: process.env.STARK_NODE_NAME, password: process.env.STARK_NODE_PASSWORD });
        await this.database.load();
        
        this.nodeConfig.db = this.database.state;
        await this.nodeConfig.load();
    }
    
}