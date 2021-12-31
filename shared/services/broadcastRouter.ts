import { RequestMode } from "../objectmodels/requestMode";

export class BroadcastRouter {
  dbServer; userServiceDb; nodeServiceName; nodeServiceDb; name; pod; isCurrentPod;

  private addWatcher;

  constructor(init?: Partial<BroadcastRouter>) {
    Object.assign(this, init);
  }

  async init() {
    var self = this;

    /* #region  Initialize the router's Request state and updates. */
    // TODO: Watch for changes before or after load???
    this.addWatcher = this.userServiceDb.changes({
      since: 'now',
      live: true,
      retry: true,
      include_docs: true,
      selector: {
        "_id": {"$regex": "^request"},
        data: {
          service: this.name,
          "$or": [
            { isNew: true },
            { isDeleted: true }
          ],
          mode: RequestMode.Broadcast,
          arg: { command: "get" }
        }
      }
    }).on('change', async function (change) {
      let request = await self.userServiceDb.rel.parseRelDocs('request', [change.doc]);
      request = request.requests[0];

      if (request.isDeleted) { return await self.delete(request); }
      await self.add(request);
    });

    let preRequests = (await this.userServiceDb.find({
      selector: {
        "_id": { "$regex": "^request" },
        data: {
          service: this.name,
          "$or": [
            { isNew: true },
            { isDeleted: true }
          ],
          mode: RequestMode.Broadcast,
          arg: { command: "get" }
        }
      }
    })).docs;
    preRequests = await this.userServiceDb.rel.parseRelDocs('request', preRequests);
    preRequests = preRequests.requests;

    preRequests.forEach(async request => {
      if (request.isDeleted) { return await this.delete(request); }
      await this.add(request);
    });
    /* #endregion */
  }

  async add(request) {
    if (!request.isRemote) { debugger; return; } // Should never happen.
    if (request.hasAttachment && !request.attachments) { return; }
    if (!request.isNew) { return; }
    if (!await this.get(request)) { return; }
  
    request.target = this.nodeServiceName;
    request.targetPod = this.pod;
    request.isNew = false;
    request.timeRoute = Date.now();

    // Save request.
    try {
      await this.nodeServiceDb.rel.save('request', request);
    } catch {
      // The request goes to the first service pod that responds.
    }
  }

  async get(request) {
    return await this.isCurrentPod(request);
  }

  async delete(request) {
    try {
      await this.userServiceDb.remove(
        this.userServiceDb.rel.makeDocID({
          id: request.id,
          type: 'request'
        }),
        request.rev
      );
    } catch { // WARNING.
    }
  }
}