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

  // Also in userRegistration.ts
  try {
    console.log("4. Generating client config.");
    const dotenv = require('dotenv');
    dotenv.config();

    const updateDotenv = require('@growflow/update-dotenv');
    await updateDotenv.default({
      'STARK_HOST': process.env['STARK_HOST'],
      'STARK_PORT': process.env['STARK_PORT'],
      'STARK_DB_HOST': process.env['STARK_DB_HOST'],
      'STARK_USER_NAME': process.env['STARK_USER_NAME'],
      'STARK_USER_PASSWORD': process.env['STARK_USER_PASSWORD'],
      'STARK_USER_KEY': process.env['STARK_USER_KEY'],
      'STARK_SERVICES_NAME': process.env['STARK_SERVICES_NAME'],
      'STARK_SERVICES_PASSWORD': process.env['STARK_SERVICES_PASSWORD'],
    }, 'client');
    
    require('browser-env-vars').generate({
      esm: true,
      readFile: '.env.production'
    });
    console.log("Generated client config.");
    console.log("");

    console.log("5. Copying client config.");
    fs.copySync('config.js', './dist/public/config.js');
    console.log("Copied client config.");
    console.log("");
  } catch {
  }
  
}
Main();
