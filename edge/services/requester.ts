import FlatPromise from "flat-promise";
import { ArrayModel, ObjectModel } from "objectmodel"
import { Database } from "../../shared/objectmodels/database";
import { Response } from "../../shared/objectmodels/response"; // TODO?
import { Request } from "../../shared/objectmodels/request";
import { NodeConfig } from "../objectmodels/nodeConfig";
import { Util } from "../../shared/util";
import { PodConfig } from "../../shared/objectmodels/podConfig";

const defaultTimeout = 10e3;

// TODO: attachments
// TODO: request helper to fill in the simple details -- e.g.: isNew: true, sourceDB, SourcePpod, time
export class Requester {
  argValid;
  responseWatcher: any;
  
  nodeDb;
  nodeConfig;
  podConfig;

  serviceNodeDb;
 
  currentRequests = {};

  constructor(arg) {
    this.validateNew(arg);
  }

  async init() { 
    /* #region  Initializing the environment properties. */
    this.nodeDb = new Database({
      arg: { username: this.argValid.nodeUser.argValid.name },
      username: this.argValid.nodeUser.argValid.name,
      password: this.argValid.nodeUser.argValid.password
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

    this.podConfig = new PodConfig(
      {
        db: this.nodeDb.state,
        arg: {
          data: {name: this.argValid.name}
        },
      }
    );
    await this.podConfig.init();

    this.serviceNodeDb = new Database({
      arg: { username: this.argValid.serviceUser.state.name },
      username: this.argValid.serviceUser.state.name,
      password: this.argValid.serviceUser.state.password
    });
    await this.serviceNodeDb.load();
    this.serviceNodeDb.state.setSchema(this.serviceDbSchema);
    /* #endregion */

    /* #region  Initialize the router's Response state and updates. */
    // TODO: Watch for changes before or after load???
    var self = this;
    this.responseWatcher = this.serviceNodeDb.state.changes({
      since: 'now',
      live: true,
      retry: true,
      include_docs: true,
      selector: {
        "_id": {"$regex": "^response"},
        data: {
          target: this.serviceNodeDb.dbName,
          targetPod: this.argValid.podIndex
        }
      }
    }).on('change', async function (change) {
      if (change.doc.data.isDeleted) { await self.deleteResponse(change.doc); return; }
      await self.responseAdd(change.doc);
    });

    let preResponses = (await this.serviceNodeDb.state.find({
      selector: {
        "_id": { "$regex": "^response" },
        data: {
          target: this.serviceNodeDb.dbName,
          targetPod: this.argValid.podIndex
        }
      }
    })).docs;

    preResponses.forEach(async response => {
      if (response.data.isDeleted) { await this.deleteResponse(response.doc); return; }
      await this.responseAdd(response);
    });
    /* #endregion */
  }

  async add(request) {
    if (this.argValid.services.indexOf(request.service) === -1) { throw new Error("The service dependency is not declared."); }
    let remoteArgs = {
      isRemote: this.nodeConfig.state.podConfigs.indexOf(request.service) === -1 || request.isRemote,
      isLocalTimeout: false
    };
    
    if (request.retry) {
      var result;
      await Util.retry(async (retry) => {
        try {
          result = await this.requestLocal(request, remoteArgs);
        } catch (error) {
          retry(error)
        }
      }, 10e6);
      return result;
    }
    
    return await this.requestLocal(request, remoteArgs);
  }

  async requestLocal(request, remoteArgs) {
    if (!remoteArgs.isRemote && !remoteArgs.isLocalTimeout) {
      try {
        return await this.requestInternal(request, remoteArgs);
      } catch (error) {
        debugger;
        remoteArgs.isLocalTimeout = true;
      }
    }

    return await this.requestInternal(request, remoteArgs);
  }

  async requestInternal(requestDoc, remoteArgs) {
    requestDoc.isRemote = remoteArgs.isRemote || remoteArgs.isLocalTimeout;
    requestDoc.id = undefined;

    let request = new Request({ db: this.serviceNodeDb.state, arg: requestDoc }, true);
    if (!requestDoc.isRemote) {
      request.arg.isNew = false;
      request.arg.target = requestDoc.source;
      request.arg.targetPod = Math.floor(Math.random() * this.podConfig.state.numPods);
    }

    await request.save();
    requestDoc.id = request.state.id;

    let result = new FlatPromise();
    this.currentRequests[request.state.id] = {
      promise: result,
      timeout: setTimeout(() => {
        let timeoutRequest = this.currentRequests[request.state.id];
        if (timeoutRequest) { timeoutRequest.promise.reject(new Error(`Timeout on request: ${JSON.stringify(requestDoc)}`)); }
      }, requestDoc.timeout || defaultTimeout)
    };

    try {
      return await result.promise;
    } catch (error) {
      await this.delete(requestDoc);
      throw error;
    }
    
  }

  async responseAdd(responseDoc) {
    try {
      let requestId = this.serviceNodeDb.state.rel.parseDocID(responseDoc.data.requestId).id;
      let request = this.currentRequests[requestId];
      this.currentRequests[requestId] = undefined;
      clearTimeout(request.timeout);
      request.promise.resolve(responseDoc.data.result);

      await this.delete({
        id: requestId,
        responseId: responseDoc._id
      });
    } catch (error) {
      debugger;
    }
  }

  async delete(request) {
    let result = new Request({
      db: this.serviceNodeDb.state,
      arg: {
        _id: this.serviceNodeDb.state.rel.makeDocID({
          id: request.id,
          type: 'request'
        })
      }
    });
    await result.load();
    result.state.isDeleted = true;
    result.state.responseId = request.responseId;
    await result.save();

    try {
      await result.delete();
    } catch (error) {
      debugger;
    }
    
  }

  private async deleteResponse(responseDoc) {
    try {
      await this.serviceNodeDb.state.remove( responseDoc._id, responseDoc._rev);
    } catch (error) {
      // TODO?
      debugger;
    }
  }

  private newRequester = ObjectModel({
    nodeUser: Object,
    serviceUser: Object,
    name: String,
    services: ArrayModel(String),
    podIndex: Number
  });

  private validateNew(arg) {
    this.argValid = new this.newRequester(arg);
  }

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