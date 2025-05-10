// Simple test to check if true is true

describe('Basic Mocha Test', () => {
  it('should assert true is true', () => {
    if (true !== true) throw new Error('True is not true');
  });
});
