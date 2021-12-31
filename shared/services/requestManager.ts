import { ObjectModel } from "objectmodel"
import { Response } from "../objectmodels/response";

export class RequestManager {
  arg;
  nodeServiceDb;

  private argValid;
  private addWatcher: any;

  constructor(init?: Partial<RequestManager>) {
    Object.assign(this, init);

    this.validateNew(this.arg);
    this.arg.addCallback = this.arg.addCallback || (async (request) => { });
    this.arg.deleteCallback = this.arg.deleteCallback || (async (request) => { });
  }

  async init() { 
    
    /* #region  Initialize the router's Request state and updates. */
    // TODO: Watch for changes before or after load???
    var self = this;
    this.addWatcher = this.arg.nodeServiceDb.state.changes({
      since: 'now',
      live: true,
      retry: true,
      include_docs: true,
      selector: {
        "_id": {"$regex": "^request"},
        data: {
          isNew: false,
          service: this.argValid.name,
          target: this.arg.nodeServiceDb.dbName,
          targetPod: this.argValid.podIndex
        }
      }
    }).on('change', async function (change) {
      let request = await self.arg.nodeServiceDb.state.rel.parseRelDocs('request', [change.doc]);
      request = request.requests[0];

      if (request.isDeleted) { return await self.delete(request); }
      await self.add(request);
    });

    let preRequests = (await this.arg.nodeServiceDb.state.find({
      selector: {
        "_id": { "$regex": "^request" },
        data: {
          isNew: false,
          service: this.argValid.name,
          target: this.arg.nodeServiceDb.dbName,
          targetPod: this.argValid.podIndex
        }
      }
    })).docs;
    preRequests = await this.arg.nodeServiceDb.state.rel.parseRelDocs('request', preRequests);
    preRequests = preRequests.requests;

    // Not waiting for async on purpose.
    preRequests.forEach(async request => {
      await this.add(request);
    });
    /* #endregion */
  }

  async add(request) {
    let result = new Response({
      db: this.arg.nodeServiceDb.state,
      arg: {
        source: request.target,
        sourcePod: request.targetPod,
        target: request.source,
        isRemote: request.isRemote,
        targetPod: request.sourcePod,
        result: await this.arg.addCallback(request),
        time: Date.now(),
        requestId: this.arg.nodeServiceDb.state.rel.makeDocID({
          id: request.id,
          type: 'request'
        })
      }
    },
    true);
    
    await result.save();
  }

  async delete(request) {
    // TODO: cancel waiting internally?
    let response = new Response({
      db: this.arg.nodeServiceDb.state,
      arg: {
        _id: request.responseId
      }
    });
    await response.load();
    response.state.isDeleted = true;
    await response.save();
    
    try {
      await this.arg.nodeServiceDb.state.remove(
        this.arg.nodeServiceDb.state.rel.makeDocID({
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

    await this.arg.deleteCallback(request);
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