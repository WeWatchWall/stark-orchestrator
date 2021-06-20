#!/usr/bin/env node

async function Main() {
	/**
	 * Module dependencies.
	 */
	const execShellCommand = require("./execShellCommand.js");

	console.log(`
	`);
	stdout = await execShellCommand('tsc');
	console.log(stdout);

}
Main();
