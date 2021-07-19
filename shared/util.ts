import FlatPromise from "flat-promise";
import promiseRetry from 'promise-retry';

export class Util {
  
  static delay(ms: number) {
    return new Promise( resolve => setTimeout(resolve, ms) );
  }

  static async retry(callback, numRetries: number) {
    let promise = new FlatPromise();
    promiseRetry(
      async function (retry) {
        await callback(retry);
      },
      {retries: numRetries}
    ).then(
      () => {
        promise.resolve()
      },
      (error) => {
        promise.reject(error);
      }
    );
    
    await promise.promise;
  }
}