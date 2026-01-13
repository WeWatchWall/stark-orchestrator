// Isomorphic JavaScript - works in both Node.js and browser environments
// Export a default function that the runtime will call
// Uses CommonJS format for compatibility with the pack executor's new Function() wrapper
module.exports.default = function(_context) {
  if (typeof console !== 'undefined' && console.log) {
    console.log('Hello World');
  }
  return { message: 'Hello World' };
};