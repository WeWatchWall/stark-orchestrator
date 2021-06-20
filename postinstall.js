#!/usr/bin/env node

async function Main() {
	/**
	 * Module dependencies.
	 */
	const fs = require('fs-extra');
	const execShellCommand = require("./cli/execShellCommand.js");

	console.log("1. Building.");
	stdout = await execShellCommand('tsc');
	console.log(stdout);
	console.log("");

	console.log("2. Copying certificate files.");
	fs.copySync('cert.pem', './dist/cert.pem');
	fs.copySync('key.pem', './dist/key.pem');
	console.log("Copied certificates.");
	console.log("");
	
	console.log("3. Copying public files.");
	fs.copySync('public', './dist/public');
	console.log("Copied public files.");
	console.log("");
}
Main();
