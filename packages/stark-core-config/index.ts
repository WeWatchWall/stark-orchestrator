module.exports = function(arg) {
	let fs = require('fs-extra');
    setInterval(() => {
		console.log(process.cwd());
		console.log(arg);
	}, 5000);
   
}