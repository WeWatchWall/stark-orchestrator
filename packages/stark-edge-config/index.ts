module.exports = function(arg) {
  let fs = require('fs-extra');
    setInterval(() => {
    console.log('Hello from:' + process.cwd());
    console.log(JSON.stringify(arg));
  }, 5000);
   
}