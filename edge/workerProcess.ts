// worker.js
import Multee from 'multee';
const multee = Multee('child'); // 'worker' for worker_threads | 'child' for child_process

const execute = multee.createHandler('execute', (arg: any) => {
  const bootstrap = require(arg.file);
  bootstrap(arg.arg);
  // console.log(`Executed args: ${JSON.stringify(arg.arg)}`);
  // return 'jobA';
});

export default {
  init: () => {
    const worker = multee.start(__filename);
    return {
      execute: execute(worker),
      worker: worker
    };
  }
};