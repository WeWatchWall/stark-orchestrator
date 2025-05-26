import http from "http";
import https from "https";
import express from "express";
import session from "express-session";
import createMemoryStore from "memorystore";

import { getCerts } from "./certs";
import { ServerConfig } from "./entity/serverConfig";
import { SESSION_EXPIRY } from "./util/constants";
import { AdminDB } from "./model/adminDB";

// Declare variables at module scope
let httpServer: http.Server | undefined;
let httpsServer: https.Server | undefined;

// Function to start an Express server, adapted from worker.ts
async function startExpressApp(
  serverConfig: ServerConfig
): Promise<express.Express> {
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

  const adminDB = new AdminDB(serverConfig);
  await adminDB.init();

  app.get("/hello", async (_req, res) => {
    res.send(`Hello, world!`);
  });

  // ...other express middleware/routes if needed...
  return app;
}

export async function runServers(
  httpPort: number,
  exposeHttp: boolean,
  httpsPort: number,
  serverConfig: ServerConfig
): Promise<void> {
  const expressApp = await startExpressApp(serverConfig);

  httpServer = undefined;
  httpsServer = undefined;

  if (exposeHttp) {
    httpServer = http.createServer(expressApp); // Use expressApp directly
    httpServer.listen(httpPort, "0.0.0.0", () => {
      console.log(`HTTP Server listening on port ${httpPort}`);
    });
  } else {
    console.log("HTTP server not exposed.");
  }

  // HTTPS server (always created)
  const certOptions = getCerts();
  httpsServer = https.createServer(certOptions, expressApp); // Use expressApp directly
  httpsServer.listen(httpsPort, "0.0.0.0", () => {
    console.log(`HTTPS Server listening on port ${httpsPort}`);
  });
  console.log(
    `Single server instance started. HTTP on ${httpPort} ${
      exposeHttp ? "" : "(not exposed)"
    }, HTTPS on ${httpsPort}`
  );
}

// Expose dispose logic as a function
export async function dispose() {
  if (httpServer) {
    await new Promise<void>((resolve, reject) => {
      httpServer!.close((err) => (err ? reject(err) : resolve()));
    });
  }
  if (httpsServer) {
    await new Promise<void>((resolve, reject) => {
      httpsServer!.close((err) => (err ? reject(err) : resolve()));
    });
  }
  console.log("Servers disposed.");
}
