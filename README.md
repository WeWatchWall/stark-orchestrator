# Stark Orchestrator for Javascript

[![Build and test status](https://github.com/WeWatchWall/stark-server/workflows/Lint%20and%20test/badge.svg)](https://github.com/WeWatchWall/stark-server/actions?query=workflow%3A%22Lint+and+test%22)
[![NPM version](https://img.shields.io/npm/v/stark-server.svg)](https://www.npmjs.com/package/stark-server)

The core Stark Orchestrator project, built the [![Couchdb]](http://couchdb.apache.org/) ecosystem. Tested only on Windows 10. Not yet ready for production, yet it makes prototyping a breeze ;)

## Getting Started

The Stark-Server project that runs the Stark Orchestrator Core be initialized before anything else.

1. [![Install CouchDB on your system.]](https://docs.couchdb.org/en/main/install/windows.html) Log into the http://LAN_IP:5984/_utils/#login with the configured credentials. Go to the DB setup tab on the left(wrench, second down), select single instance, and point the instance to your LAN_IP (not 0.0.0.0).

2. Go to the DB config tab(gear, fourth down) and enable: CORS (*, for all), and Main Config - couch_peruser:delete_dbs= true and couch_peruser:enable= true.

3. Then, clone the Stark-Server project, navigate into it, and build it. This folder will be called $STARK_HOME in the documentation.
  
  ```bash
  gh repo clone WeWatchWall/stark-server
  cd stark-server

  npm install
  ```

4. Copy the env_examples/core_init.env -to-> $STARK_HOME/.env. Plug in your CouchDB credentials to the STARK_USER_NAME and STARK_USER_PASSWORD variables in this file.

5. Run server. Your first pod, with STARK_MODE=DeploymentMode.Core should log out its arguments and configuration in the console.

  ```bash
  npm start
  ```

## Usage

The server will allow you to create users by sending a PUT request to http://LAN_IP:3005/users/root with the following body:
{
    "name": "<User name>", // ex: root
    "password": "<Password>", // ex: o1iviA51
    "key": "<User Key>", // ex: b1vI451key
    "email": "<Email>" // ex: friday@example.com
}

Other instances of core and edge nodes can be added to the orchestrator through a similar procedure to running the initial core node. For the edge, there is an example config in env_examples/edge_init.env. There is a single core user, so any core instance needs to share their config with the first initialized core environment. In other words, there is a single core user. Other users may only run DeloyMode.Edge and DeloyMode.Browser nodes.

If you navigate to http://LAN_IP:3005, you will receive the deployed Stark-Client build into your browser, which will create a DeployMode.Browser node and bootstrap it. If you deploy any eligible browser packages to your user database, they will appear in your browser.

The author aknowledges that documentation is not yet anywhere close to complete, so feel free to look at the following files to get an idea of how to use the classes for core and edge packages:

* $STARK_HOME/core/core.ts
* $STARK_HOME/edge/edge.ts
