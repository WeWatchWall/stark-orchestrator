import FlatPromise from "flat-promise";
import { ArrayModel, ObjectModel } from "objectmodel"
import { Response } from "../objectmodels/response"; // TODO?
import { Request } from "../objectmodels/request";
import { Util } from "../util";
import { PodConfig } from "../objectmodels/podConfig";

const defaultTimeout = 10e3;

// TODO: attachments
// TODO: request helper to fill in the simple details -- e.g.: isNew: true, sourceDB, SourcePpod, time
export class Requester {
  arg;
  argValid;
  responseWatcher: any;

  podConfig;
  currentRequests = {};
  currentServiceRoutes = {};

  constructor(arg, nodeDb, nodeConfig, serviceNodeDb) {
    this.arg = { arg, nodeDb, nodeConfig, serviceNodeDb };
    this.validateNew(arg);
  }

  async init() {
    /* #region  Initializing the environment properties. */
    this.podConfig = new PodConfig(
      {
        db: this.arg.nodeDb.state,
        arg: {
          data: { name: this.argValid.name }
        },
      }
    );
    await this.podConfig.init();
    /* #endregion */

    /* #region  Initialize the router's Response state and updates. */
    // TODO: Watch for changes before or after load???
    var self = this;
    this.responseWatcher = this.arg.serviceNodeDb.state.changes({
      since: 'now',
      live: true,
      retry: true,
      include_docs: true,
      selector: {
        "_id": { "$regex": "^response" },
        data: {
          target: this.arg.serviceNodeDb.dbName,
          targetPod: this.argValid.podIndex
        }
      }
    }).on('change', async function (change) {
      if (change.doc.data.isDeleted) { await self.deleteResponse(change.doc); return; }
      await self.responseAdd(change.doc);
    });

    let preResponses = (await this.arg.serviceNodeDb.state.find({
      selector: {
        "_id": { "$regex": "^response" },
        data: {
          target: this.arg.serviceNodeDb.dbName,
          targetPod: this.argValid.podIndex
        }
      }
    })).docs;

    // Not waiting for async on purpose.
    preResponses.forEach(async response => {
      if (response.data.isDeleted) { await this.deleteResponse(response.doc); return; }
      await this.responseAdd(response);
    });
    /* #endregion */
  }

  async add(request) {
    if (this.argValid.services.indexOf(request.service) === -1) { throw new Error("The service dependency is not declared."); }

    request.isNew = true;
    request.source = this.arg.serviceNodeDb.dbName;
    request.sourcePod = this.argValid.podIndex;
    request.timeNew = Date.now();

    return await this.requestArg(request);
  }

  private async requestArg(request) {
    let remoteArgs = {
      isRemote: this.arg.nodeConfig.state.podConfigs.indexOf(request.service) === -1 || request.isRemote,
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
        remoteArgs.isLocalTimeout = true;
      }
    }

    return await this.requestInternal(request, remoteArgs);
  }

  async requestInternal(requestDoc, remoteArgs) {
    requestDoc.isRemote = remoteArgs.isRemote || remoteArgs.isLocalTimeout;
    requestDoc.id = undefined;

    let request = new Request({ db: this.arg.serviceNodeDb.state, arg: requestDoc }, true);

    /* #region  Non-balanced and local routing. */
    let knownRoute = this.currentServiceRoutes[request.argValid.service];
    if (!request.argValid.isBalanced && knownRoute) {
      request.arg.isNew = knownRoute.isNew;
      request.arg.isRemote = knownRoute.isRemote;
      request.arg.target = knownRoute.target;
      request.arg.targetPod = knownRoute.targetPod;
    } else if (!requestDoc.isRemote) {
      request.arg.isNew = false;
      request.arg.target = requestDoc.source;
      request.arg.targetPod = Math.floor(Math.random() * this.podConfig.state.numPods);
    }
    /* #endregion */

    /* #region  Store request in the DB and its breadcrumbs in memory. */
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
    /* #endregion */

    try {
      return await result.promise;
    } catch (error) {
      if (!requestDoc.isBalanced) { this.currentServiceRoutes[requestDoc.service] = undefined; }
      await this.delete(requestDoc);
      throw error;
    }

  }

  async responseAdd(responseDoc) {
    try {
      let requestId = this.arg.serviceNodeDb.state.rel.parseDocID(responseDoc.data.requestId).id;
      let request = this.currentRequests[requestId];
      this.currentRequests[requestId] = undefined;
      clearTimeout(request.timeout);
      request.promise.resolve(responseDoc.data);

      await this.delete({
        id: requestId,
        responseId: responseDoc._id
      });
    } catch { // WARNING.
    }
  }

  async delete(request) {
    /* #region  Keep the old route if necessary. */
    let result = new Request({
      db: this.arg.serviceNodeDb.state,
      arg: {
        _id: this.arg.serviceNodeDb.state.rel.makeDocID({
          id: request.id,
          type: 'request'
        })
      }
    });
    await result.load();

    let knownRoute = this.currentServiceRoutes[result.state.service];
    if (!result.state.isBalanced && !knownRoute) {
      this.currentServiceRoutes[result.state.service] = {
        isNew: false,
        isRemote: result.state.isRemote,
        target: result.state.target,
        targetPod: result.state.targetPod
      };
    }

    result.state.isDeleted = true;
    result.state.responseId = request.responseId;
    await result.save();
    /* #endregion */

    try {
      await result.delete();
    } catch { // WARNING.
    }

  }

  private async deleteResponse(responseDoc) {
    try {
      await this.arg.serviceNodeDb.state.remove(responseDoc._id, responseDoc._rev);
    } catch { // WARNING.
    }
  }

  private newRequester = ObjectModel({
    serviceUser: Object,
    name: String,
    services: ArrayModel(String),
    podIndex: Number
  });

  private validateNew(arg) {
    this.argValid = new this.newRequester(arg);
  }
}