import { ObjectModel } from "objectmodel"
import { Database } from "../../shared/objectmodels/database";
import { Response } from "../../shared/objectmodels/response";

export class RequestManager {
  argValid;
  addWatcher: any;
  serviceNodeDb;
  addCallback;
  deleteCallback;

  constructor(arg) {
    this.validateNew(arg);
    this.addCallback = async () => { };
    this.deleteCallback = async () => { };
  }

  async init() { 
    this.serviceNodeDb = new Database({
      arg: { username: this.argValid.user.state.name },
      username: this.argValid.user.state.name,
      password: this.argValid.user.state.password
    });
    await this.serviceNodeDb.load();
    this.serviceNodeDb.state.setSchema(this.serviceDbSchema);

    /* #region  Initialize the router's Request state and updates. */
    // TODO: Watch for changes before or after load???
    var self = this;
    this.addWatcher = this.serviceNodeDb.state.changes({
      since: 'now',
      live: true,
      retry: true,
      include_docs: true,
      selector: {
        "_id": {"$regex": "^request"},
        data: {
          isNew: false,
          service: this.argValid.name,
          target: this.serviceNodeDb.dbName,
          targetPod: this.argValid.podIndex
        }
      }
    }).on('change', async function (change) {
      let request = await self.serviceNodeDb.state.rel.parseRelDocs('request', [change.doc]);
      request = request.requests[0];

      if (request.isDeleted) { return await self.deleteHandler(request); }
      await self.addHandler(request);
    });

    let preRequests = (await this.serviceNodeDb.state.find({
      selector: {
        "_id": { "$regex": "^request" },
        data: {
          isNew: false,
          service: this.argValid.name,
          target: this.serviceNodeDb.dbName,
          targetPod: this.argValid.podIndex
        }
      }
    })).docs;
    preRequests = await this.serviceNodeDb.state.rel.parseRelDocs('request', preRequests);
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
      db: this.serviceNodeDb.state,
      arg: {
        source: request.target,
        target: request.source,
        isRemote: request.isRemote,
        targetPod: request.sourcePod,
        result: await this.addCallback(request),
        time: new Date().getTime(),
        requestId: this.serviceNodeDb.state.rel.makeDocID({
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
      db: this.serviceNodeDb.state,
      arg: {
        _id: request.responseId
      }
    });
    await response.load();
    response.state.isDeleted = true;
    await response.save();
    
    try {
      await this.serviceNodeDb.state.remove(
        this.serviceNodeDb.state.rel.makeDocID({
          id: request.id,
          type: 'request'
        }),
        request.rev
      );
    } catch (error) {
      // TODO?
      debugger;
    }

    try {
      await response.delete();
    } catch (error) {
      // TODO?
      debugger;
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

  private serviceDbSchema = [
    { singular: 'request', plural: 'requests' },
    { singular: 'response', plural: 'responses' }
  ];
}