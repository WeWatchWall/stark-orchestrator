import express from "express";
import session from "express-session";
import fs from "fs";
import createMemoryStore from "memorystore";
import path from "path";
import { createPinia } from "pinia";
// import swaggerUi from 'swagger-ui-express';
import { createApp } from "vue";
import { threadId } from "worker_threads";
import workerpool from "workerpool";

import { ServerConfig } from "./entity/serverConfig";
import { SESSION_EXPIRY } from "./util/constants";

const app = createApp({});
const pinia = createPinia();

app.use(pinia);

// New function to start an Express server on a given port, binding to localhost
async function startServer(
  port: number,
  serverConfig: ServerConfig
): Promise<string> {

  const app = express();
  app.set("trust proxy", 1); // trust first proxy

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  /* #region Setup Swagger. */
  // const JSONPath =
  //   path.join(__dirname, '..', 'src', 'util', 'swagger.json');
  // const swaggerDocument =
  //   JSON.parse(fs.readFileSync(JSONPath).toString());
  // app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  /* #endregion */

  const MemoryStore = createMemoryStore(session);

  app.use(
    session({
      cookie: {
        maxAge: SESSION_EXPIRY,
        secure: serverConfig.isSecureCookie,
        sameSite: serverConfig.isSecureCookie ? "none" : "lax",
      },
      secret: require("crypto").randomBytes(32).toString("hex"),
      resave: false,
      saveUninitialized: false,
      store: new MemoryStore({
        checkPeriod: SESSION_EXPIRY, // prune expired entries every 24h
      }),
    })
  );

  app.use((req, _res, next) => {
    // Increment the session visits counter
    (req.session as any).visits = ((req.session as any).visits || 0) + 1;
    next();
  });

  app.get("/hello", (_req, res) => {
    res.send("Hello, world!");
  });

  // ...other express middleware/routes if needed...
  app.listen(port, "127.0.0.1", () => {
    console.log(`Worker thread ${threadId} listening on port ${port}`);
  });
  return `Worker thread ${threadId} started server on port ${port}`;
}

workerpool.worker({
  startServer,
});
