import { Database } from "../objectmodels/database";
import { RequestMode } from "../objectmodels/requestMode";

const numMsWait = 500;

export class Router {
  arg: any;
  
  nodeConfigWatcher: any;
  packConfigWatcher: any;
  addRequestWatcher: any;
  deleteResponseWatcher: any;

  numRouters: number;
  routerIndex: number;

  serviceDbsId = {}; // nodeId, nodeName 
  serviceDbs = {}; // nodeName, nodeServiceDbs
  sourceNodes = {}; // nodeServiceDbs, nodeName

  packId = {}  // packId, packName 
  packRoundRobin = {}; // package(service), node(skippable),  Tuple<podNum, currentPod> - currentPod >= pod ===> currentPod = 0 

  constructor( user, dbServer, userDb, userConfig, userServiceDb, nodeConfig) {
    this.arg = { user, dbServer, userDb, userConfig, userServiceDb, nodeConfig }; // TODO: USE THIS!!!
  }

  async init() {

    var self = this;
    self.updateBalancingStats();
    this.arg.userConfig.eventEmitter.on('change', async () => {
      self.updateBalancingStats();
    });

    /* #region  Initialize the router's Node state and updates. */
    // TODO: filter only status = 1 nodes.
    // TODO: Watch for changes before or after load???
    this.nodeConfigWatcher = this.arg.userDb.state.changes({
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

      let nodeConfigs = await self.arg.userDb.state.rel.parseRelDocs('nodeConfig', [change.doc]);
      nodeConfigs = nodeConfigs.nodeConfigs;
      await self.addNode(nodeConfigs[0]);
    });

    let nodeConfigs = (await this.arg.userDb.state.find({
      selector: {
        "_id": {"$regex": "^nodeConfig"}
      }
    })).docs;
    nodeConfigs = await this.arg.userDb.state.rel.parseRelDocs('nodeConfig', nodeConfigs);
    nodeConfigs = nodeConfigs.nodeConfigs;

    nodeConfigs.forEach(async nodeConfig => {
      await self.addNode(nodeConfig);
    });
    /* #endregion */

    /* #region  Initialize the router's PackageConfig state and updates. */
    // TODO: Watch for changes before or after load???
    this.packConfigWatcher = this.arg.userDb.state.changes({
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

      let packConfig = await self.arg.userDb.state.rel.parseRelDocs('packageConfig', [change.doc]);
      packConfig = packConfig.packageConfigs[0];
      if (await self.addPack(packConfig)) { return; }

      // Update the pod assignment.
      self.packRoundRobin[packConfig.name] = self.getPackState(packConfig.nodePods);
    });

    let packConfigs = (await this.arg.userDb.state.find({
      selector: {
        "_id": { "$regex": "^packageConfig" },
        data: { isService: true }
      }
    })).docs;
    packConfigs = await this.arg.userDb.state.rel.parseRelDocs('packageConfig', packConfigs);
    packConfigs = packConfigs.packageConfigs;

    packConfigs.forEach(async packConfig => {
      await self.addPack(packConfig);
    });
    /* #endregion */

    /* #region  Initialize the router's Request state and updates. */
    // TODO: Watch for changes before or after load???
    this.addRequestWatcher = this.arg.userServiceDb.state.changes({
      since: 'now',
      live: true,
      retry: true,
      include_docs: true,
      selector: {
        "_id": {"$regex": "^request"},
        data: {
          "$or": [
            { isNew: true },
            { isDeleted: true }
          ],
          mode: RequestMode.Single
        }
      }
    }).on('change', async function (change) {
      let request = await self.arg.userServiceDb.state.rel.parseRelDocs('request', [change.doc]);
      request = request.requests[0];

      if (request.isDeleted) { return await self.delete(request); }
      await self.add(request);
    });

    let preRequests = (await this.arg.userServiceDb.state.find({
      selector: {
        "_id": { "$regex": "^request" },
        data: {
          "$or": [
            { isNew: true },
            { isDeleted: true }
          ],
          mode: RequestMode.Single
        }
      }
    })).docs;
    preRequests = await this.arg.userServiceDb.state.rel.parseRelDocs('request', preRequests);
    preRequests = preRequests.requests;

    preRequests.forEach(async request => {
      if (request.isDeleted) { return await this.delete(request); }
      await this.add(request);
    });
    /* #endregion */
  
    /* #region  Initialize the router's deleted Response state and updates. */
    // TODO: Watch for changes before or after load???
    this.deleteResponseWatcher = this.arg.userServiceDb.state.changes({
      since: 'now',
      live: true,
      retry: true,
      include_docs: true,
      selector: {
        "_id": {"$regex": "^response"},
        data: {isDeleted: true}
      }
    }).on('change', async function (change) {
      if (!self.isBalanceAvailable(change.doc.data.time)) { return; }
      await self.deleteResponse(change.doc);
    });

    let preResponses = (await this.arg.userServiceDb.state.find({
      selector: {
        "_id": { "$regex": "^response" },
        data: {isDeleted: true}
      }
    })).docs;

    preResponses.forEach(async response => {
      if (!this.isBalanceAvailable(response.data.time)) { return; }
      await self.deleteResponse(response);
    });
    /* #endregion */
  }

  private updateBalancingStats() {
    this.numRouters = this.arg.userConfig.state.numRouters;
    this.routerIndex = this.arg.userConfig.state.nodeConfigs.indexOf(this.arg.nodeConfig.state.id);
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
    requestDoc.timeRoute = Date.now();

    // Save request.
    try {
      await this.serviceDbs[this.sourceNodes[requestDoc.source]].state.rel.save('request', requestDoc);
    } catch { // WARNING.
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

    // WARNING. Maybe when it's got nothing available?
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

  async delete(request) {
    if (!this.isBalanceAvailable(request.timeNew)) { return; }
    try {
      await this.arg.userServiceDb.state.remove(
        this.arg.userServiceDb.state.rel.makeDocID({
          id: request.id,
          type: 'request'
        }),
        request.rev
      );
    } catch { // WARNING.
    }
  }

  private async deleteResponse(responseDoc) {
    try {
      await this.arg.userServiceDb.state.remove( responseDoc._id, responseDoc._rev);
    } catch { // WARNING.
    }
  }

  // Internally used on watching
  private async addNode(nodeConfigDoc) {
    if (this.serviceDbsId[nodeConfigDoc.id]) { return; }
    this.serviceDbsId[nodeConfigDoc.id] = 'init';

    let serviceNodeDb = new Database({
      arg: { username: `services-${nodeConfigDoc.name}`, dbServer: this.arg.dbServer },
      username: this.arg.user.state.name,
      password: this.arg.user.state.password
    });
    await serviceNodeDb.load();
    serviceNodeDb.state.setSchema(this.serviceDbSchema);

    this.serviceDbsId[nodeConfigDoc.id] = nodeConfigDoc.name;
    this.serviceDbs[nodeConfigDoc.name] = serviceNodeDb;
    this.sourceNodes[serviceNodeDb.dbName] = nodeConfigDoc.name;
  }

  private async deleteNode(nodeConfigDoc) {
    let id = this.arg.userDb.rel.parseDocID(nodeConfigDoc._id).id;
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
    let id = this.arg.userDb.rel.parseDocID(packConfigDoc._id).id;
    let packName = this.packId[id];
    this.packId[id] = undefined;
    this.packRoundRobin[packName] = undefined;
  }

  private serviceDbSchema = [
    { singular: 'request', plural: 'requests' },
    { singular: 'response', plural: 'responses' }
  ];
}