// Isomorphic JavaScript - works in both Node.js and browser environments
// Export a default function that the runtime will call
// Uses CommonJS format for compatibility with the pack executor's new Function() wrapper
module.exports.default = async function(_context) {
  if (typeof console !== 'undefined' && console.log) {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('Hello World');
    }
  }
  return { message: 'Hello World' };
};