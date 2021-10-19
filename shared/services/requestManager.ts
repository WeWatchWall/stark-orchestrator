import { ObjectModel } from "objectmodel"
import { Response } from "../objectmodels/response";

export class RequestManager {
  arg;
  argValid;
  addWatcher: any;
  addCallback;
  deleteCallback;

  constructor(arg, serviceNodeDb) {
    this.arg = {arg, serviceNodeDb};
    this.validateNew(arg);
    this.addCallback = async () => { };
    this.deleteCallback = async () => { };
  }

  async init() { 
    
    /* #region  Initialize the router's Request state and updates. */
    // TODO: Watch for changes before or after load???
    var self = this;
    this.addWatcher = this.arg.serviceNodeDb.state.changes({
      since: 'now',
      live: true,
      retry: true,
      include_docs: true,
      selector: {
        "_id": {"$regex": "^request"},
        data: {
          isNew: false,
          service: this.argValid.name,
          target: this.arg.serviceNodeDb.dbName,
          targetPod: this.argValid.podIndex
        }
      }
    }).on('change', async function (change) {
      let request = await self.arg.serviceNodeDb.state.rel.parseRelDocs('request', [change.doc]);
      request = request.requests[0];

      if (request.isDeleted) { return await self.deleteHandler(request); }
      await self.addHandler(request);
    });

    let preRequests = (await this.arg.serviceNodeDb.state.find({
      selector: {
        "_id": { "$regex": "^request" },
        data: {
          isNew: false,
          service: this.argValid.name,
          target: this.arg.serviceNodeDb.dbName,
          targetPod: this.argValid.podIndex
        }
      }
    })).docs;
    preRequests = await this.arg.serviceNodeDb.state.rel.parseRelDocs('request', preRequests);
    preRequests = preRequests.requests;

    preRequests.forEach(async request => {
      await this.addHandler(request);
    });
    /* #endregion */
  }

  async add(asyncCallback) {
    this.addCallback = asyncCallback;
  }

  async delete(asyncCallback) {
    this.deleteCallback = asyncCallback;
  }

  private async addHandler(request) {
    let result = new Response({
      db: this.arg.serviceNodeDb.state,
      arg: {
        source: request.target,
        target: request.source,
        isRemote: request.isRemote,
        targetPod: request.sourcePod,
        result: await this.addCallback(request),
        time: Date.now(),
        requestId: this.arg.serviceNodeDb.state.rel.makeDocID({
          id: request.id,
          type: 'request'
        })
      }
    },
    true);
    
    await result.save();
  }

  private async deleteHandler(request) {
    // TODO: cancel waiting internally?
    let response = new Response({
      db: this.arg.serviceNodeDb.state,
      arg: {
        _id: request.responseId
      }
    });
    await response.load();
    response.state.isDeleted = true;
    await response.save();
    
    try {
      await this.arg.serviceNodeDb.state.remove(
        this.arg.serviceNodeDb.state.rel.makeDocID({
          id: request.id,
          type: 'request'
        }),
        request.rev
      );
    } catch (error) {
    }

    try {
      await response.delete();
    } catch (error) {
    }

    await this.deleteCallback(request);
  }

  private newRequestManager = ObjectModel({
    user: Object,
    name: String,
    podIndex: Number
  });

  private validateNew(arg) {
    this.argValid = new this.newRequestManager(arg);
  }
}