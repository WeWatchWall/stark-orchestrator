import { request } from "express";
import { Database } from "../../shared/objectmodels/database";
import { NodeUser } from "../../shared/objectmodels/nodeUser";
import { UserConfig } from "../../shared/objectmodels/userConfig";
import { NodeConfig } from "../objectmodels/nodeConfig";

const numMsWait = 500;

export class Router {
  user: any;
  userDb: any;
  userConfig: any;
  userServiceDb: any;
  
  nodeUser: any;
  nodeConfig: any;
  nodeDb: any;

  nodeConfigWatcher: any;
  packConfigWatcher: any;
  addRequestWatcher: any;

  numRouters: number;
  routerIndex: number;

  serviceDbsId = {}; // nodeId, nodeName 
  serviceDbs = {}; // nodeName, nodeServiceDbs
  sourceNodes = {}; // nodeServiceDbs, nodeName

  packId = {}  // packId, packName 
  packRoundRobin = {}; // package(service), node(skippable),  Tuple<podNum, currentPod> - currentPod >= pod ===> currentPod = 0 

  constructor(user: any) {
    this.user = user;
  }

  async init() {
    /* #region  Initializing the environment properties. */
    this.userDb = new Database({
      arg: { username: this.user.state.name },
      username: this.user.state.name,
      password: this.user.state.password
    });
    await this.userDb.load();
    this.userDb.state.setSchema(this.userDbSchema);

    this.userConfig = new UserConfig({ db: this.userDb.state, arg: { name: this.user.state.name } });
    await this.userConfig.init();

    this.userServiceDb = new Database({
      arg: { username: `services-${this.user.state.name}` },
      username: this.user.state.name,
      password: this.user.state.password
    });
    await this.userServiceDb.load();
    this.userServiceDb.state.setSchema(this.serviceDbSchema);

    this.nodeUser = new NodeUser({
      server: undefined,
      arg: {}
    },
      true
    );
    this.nodeUser.init();

    this.nodeDb = new Database({
      arg: { username: this.nodeUser.argValid.name },
      username: this.nodeUser.argValid.name,
      password: this.nodeUser.argValid.password
    });
    await this.nodeDb.load();
    this.nodeDb.state.setSchema(this.nodeDbSchema);

    this.nodeConfig = new NodeConfig(
      {
        db: this.nodeDb.state,
        arg: {}
      },
      true
    );
    this.nodeConfig.init();
    await this.nodeConfig.load();
    /* #endregion */

    var self = this;
    self.updateBalancingStats();
    this.userConfig.eventEmitter.on('change', async () => {
      self.updateBalancingStats();
    });

    /* #region  Initialize the router's Node state and updates. */
    // TODO: filter only status = 1 nodes.
    // TODO: Watch for changes before or after load???
    this.nodeConfigWatcher = this.userDb.state.changes({
      since: 'now',
      live: true,
      retry: true,
      include_docs: true,
      selector: {
        "_id": {"$regex": "^nodeConfig"}
      }
    }).on('change', async function (change) {
      if (change.deleted) {
        await self.deleteNode(change.doc);
        return;
      }

      let nodeConfigs = await self.userDb.state.rel.parseRelDocs('nodeConfig', [change.doc]);
      nodeConfigs = nodeConfigs.nodeConfigs;
      await self.addNode(nodeConfigs[0]);
    });

    let nodeConfigs = (await this.userDb.state.find({
      selector: {
        "_id": {"$regex": "^nodeConfig"}
      }
    })).docs;
    nodeConfigs = await this.userDb.state.rel.parseRelDocs('nodeConfig', nodeConfigs);
    nodeConfigs = nodeConfigs.nodeConfigs;

    nodeConfigs.forEach(async nodeConfig => {
      await self.addNode(nodeConfig);
    });
    /* #endregion */

    /* #region  Initialize the router's PackageConfig state and updates. */
    // TODO: filter only status = 1 nodes.
    // TODO: Watch for changes before or after load???
    this.packConfigWatcher = this.userDb.state.changes({
      since: 'now',
      live: true,
      retry: true,
      include_docs: true,
      selector: {
        "_id": { "$regex": "^packageConfig" }
      }
    }).on('change', async function (change) {
      if (change.deleted) {
        await self.deletePack(change.doc);
        return;
      }

      let packConfig = await self.userDb.state.rel.parseRelDocs('packageConfig', [change.doc]);
      packConfig = packConfig.packageConfigs[0];
      if (await self.addPack(packConfig)) { return; }

      // Update the pod assignment.
      self.packRoundRobin[packConfig.name] = self.getPackState(packConfig.nodePods);
    });

    let packConfigs = (await this.userDb.state.find({
      selector: {
        "_id": { "$regex": "^packageConfig" },
        data: { isService: true }
      }
    })).docs;
    packConfigs = await this.userDb.state.rel.parseRelDocs('packageConfig', packConfigs);
    packConfigs = packConfigs.packageConfigs;

    packConfigs.forEach(async packConfig => {
      await self.addPack(packConfig);
    });
    /* #endregion */

    /* #region  Initialize the router's Request state and updates. */
    // TODO: filter only status = 1 nodes.
    // TODO: Watch for changes before or after load???
    this.addRequestWatcher = this.userServiceDb.state.changes({
      since: 'now',
      live: true,
      retry: true,
      include_docs: true,
      selector: {
        "_id": {"$regex": "^request"}
      }
    }).on('change', async function (change) {
      if (change.deleted) { return; }

      let request = await self.userServiceDb.state.rel.parseRelDocs('request', [change.doc]);
      request = request.requests[0];

      if (request.isDeleted) { return await self.delete(request); }
      await self.add(request);
    });

    let preRequests = (await this.userServiceDb.state.find({
      selector: {
        "_id": { "$regex": "^request" },
        data: {isNew: true}
      }
    })).docs;
    preRequests = await this.userServiceDb.state.rel.parseRelDocs('request', preRequests);
    preRequests = preRequests.requests;

    preRequests.forEach(async request => {
      await this.add(request);
    });
    /* #endregion */
  }

  private updateBalancingStats() {
    this.numRouters = this.userConfig.state.numRouters;
    this.routerIndex = this.userConfig.state.nodeConfigs.indexOf(this.nodeConfig.state.id);
  }

  async add(requestDoc) {
    if (!requestDoc.isRemote) { debugger; return; } // Should never happen.
    if (requestDoc.hasAttachment && !requestDoc.attachments) { return; }
    if (!requestDoc.isNew) { return; }
    if (!this.isBalanceAvailable(requestDoc.timeNew)) { return; }
  
    // Determine node.
    let target = this.getNextPod(requestDoc.service);
    if (!target) { return; }
    requestDoc.target = this.serviceDbs[target.node].dbName;
    requestDoc.targetPod = target.pod;
    requestDoc.isNew = false;
    requestDoc.timeRoute = new Date().getTime();

    // Save request.
    try {
      await this.serviceDbs[this.sourceNodes[requestDoc.source]].state.rel.save('request', requestDoc);
    } catch (error) {
      debugger;
    }
  }

  private isBalanceAvailable(requestTime): boolean {
    if (this.numRouters < 0) { return false; }
    return Math.round(requestTime % numMsWait * (this.numRouters - 1) / numMsWait) === this.routerIndex;
  }

  private getNextPod(serviceName) {
    if (!this.packRoundRobin[serviceName]) { return; }
    let serviceState = this.packRoundRobin[serviceName];
    let result;

    while (!result) {
      Object.keys(this.serviceDbs).forEach(nodeName => {
        let nodeState = serviceState[nodeName];
        if (!nodeState) { return; }
        if (nodeState.curPod >= nodeState.numPods) { nodeState.curPod = 0; return; }

        result = {
          node: nodeName,
          pod: nodeState.curPod
        };

        nodeState.curPod++;
      });
    }

    return result;
  }

  async delete(requestDoc) {
    try {
      this.userServiceDb.state.remove(
        this.userServiceDb.state.rel.makeDocID({
          id: requestDoc.id,
          type: 'request'
        }),
        requestDoc.rev
      );
    } catch (error) {
      // TODO?
      debugger;
    }
  }

  // Internally used on watching
  private async addNode(nodeConfigDoc) {
    if (this.serviceDbsId[nodeConfigDoc.id]) { return; }
    this.serviceDbsId[nodeConfigDoc.id] = 'init';

    let serviceNodeDb = new Database({
      arg: { username: `services-${nodeConfigDoc.name}` },
      username: this.user.state.name,
      password: this.user.state.password
    });
    await serviceNodeDb.load();
    serviceNodeDb.state.setSchema(this.serviceDbSchema);

    this.serviceDbsId[nodeConfigDoc.id] = nodeConfigDoc.name;
    this.serviceDbs[nodeConfigDoc.name] = serviceNodeDb;
    this.sourceNodes[serviceNodeDb.dbName] = nodeConfigDoc.name;
  }

  private async deleteNode(nodeConfigDoc) {
    let id = this.userDb.rel.parseDocID(nodeConfigDoc._id).id;
    let nodeName = this.serviceDbsId[id];
    let nodeServiceDb = this.serviceDbs[nodeName].dbName;

    this.serviceDbsId[id] = undefined;
    this.serviceDbs[nodeName] = undefined;
    this.sourceNodes[nodeServiceDb] = undefined;
  }

  // Internally used on watching
  // package(service), node(skippable),  Tuple<podNum, currentPod>
  private async addPack(packConfigDoc) : Promise<boolean> {
    if (this.packId[packConfigDoc.id]) { return false; }
    if (!packConfigDoc.isService) { return false; }

    this.packId[packConfigDoc.id] = packConfigDoc.id;
    this.packRoundRobin[packConfigDoc.name] = this.getPackState(packConfigDoc.nodePods);

    return true;
  }

  private getPackState(nodePods) {
    let result = {};
    
    Object.keys(nodePods).forEach(nodePodName => {
      result[nodePodName] = {
        numPods: nodePods[nodePodName],
        curPod: 0
      };
    });

    return result;
  }

  private async deletePack(packConfigDoc) {
    let id = this.userDb.rel.parseDocID(packConfigDoc._id).id;
    let packName = this.packId[id];
    this.packId[id] = undefined;
    this.packRoundRobin[packName] = undefined;
  }


  private userDbSchema = [
    { singular: 'packageConfig', plural: 'packageConfigs' },
    {
      singular: 'userConfig', plural: 'userConfigs',
      relations: {
        nodeConfigs: { hasMany: 'nodeConfig' }
      }
    },
    { singular: 'nodeConfig', plural: 'nodeConfigs', relations: { userConfig: { belongsTo: 'userConfig' } } }
  ];
  private nodeDbSchema = [
    { singular: 'podConfig', plural: 'podConfigs' },
    {
      singular: 'userConfig', plural: 'userConfigs',
      relations: {
        nodeConfigs: { hasMany: 'nodeConfig' }
      }
    },
    { singular: 'nodeConfig', plural: 'nodeConfigs', relations: { userConfig: { belongsTo: 'userConfig' } } }
  ];
  private serviceDbSchema = [
    { singular: 'request', plural: 'requests' },
    { singular: 'response', plural: 'responses' }
  ];
}