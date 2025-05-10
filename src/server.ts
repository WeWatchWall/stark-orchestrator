import workerpool from "workerpool";
import path from "path";
import http from "http";
import httpProxy from "http-proxy";
import https from "https";
import { getCerts } from "./certs";
import { ServerConfig } from "./entity/serverConfig";
import fs from "fs";

// Declare variables at module scope
let pool: workerpool.Pool | undefined;
let workerTargets: string[] = [];
let currentIndex = 0;
let proxy: httpProxy | undefined;
let httpServer: http.Server | undefined;
let httpsServer: https.Server | undefined;

export async function runServers(
  numWorkers: number,
  httpPort: number,
  exposeHttp: boolean,
  httpsPort: number,
  serverConfig: ServerConfig
): Promise<void> {
  const workerBasePort = httpPort + 1;

  // Determine worker path for both dev (src) and prod (dist) environments
  let workerPath = path.join(__dirname, "worker.js");
  try {
    fs.accessSync(workerPath);
  } catch {
    // fallback to cwd if not found (e.g., running from dist in test)
    workerPath = path.join(process.cwd(), "dist", "worker.js");
  }
  pool = workerpool.pool(workerPath, {
    maxWorkers: numWorkers,
  });

  workerTargets = [];
  for (let i = 0; i < numWorkers; i++) {
    const workerPort = workerBasePort + i;
    workerTargets.push(`http://127.0.0.1:${workerPort}`);
    try {
      const p = await pool.exec("startServer", [workerPort, serverConfig]);
      console.log(p);
    } catch (error) {
      console.error(`Error starting worker on port ${workerPort}: ${error}`);
    }
  }

  currentIndex = 0;
  proxy = httpProxy.createProxyServer({});
  const requestHandler = (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) => {
    // Check for pid in query string or headers
    let pid: string | undefined;
    if (req.url) {
      const urlObj = new URL(
        req.url,
        `http://${req.headers.host || "localhost"}`
      );
      pid = urlObj.searchParams.get("pid") || undefined;
    }
    if (!pid && req.headers["pid"]) {
      pid = Array.isArray(req.headers["pid"])
        ? req.headers["pid"][0]
        : req.headers["pid"];
    }
    let targetIndex: number;
    if (pid) {
      // Convert pid string to a number and map to worker index
      const pidNum = parseInt(pid, 10);
      if (!isNaN(pidNum)) {
        targetIndex = Math.abs(pidNum) % workerTargets.length;
      } else {
        targetIndex = 0; // fallback if pid is not a number
      }
    } else {
      // fallback to round-robin
      targetIndex = currentIndex;
      currentIndex = (currentIndex + 1) % workerTargets.length;
    }
    const target = workerTargets[targetIndex];
    proxy!.web(req, res, { target }, (_err: any) => {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Bad gateway");
    });
  };

  httpServer = undefined;
  httpsServer = undefined;

  if (exposeHttp) {
    httpServer = http.createServer(requestHandler);
    httpServer.listen(httpPort, "0.0.0.0", () => {
      console.log(`HTTP Proxy server listening on port ${httpPort}`);
    });
  } else {
    console.log("HTTP server not exposed.");
  }

  // HTTPS proxy server (always created)
  const certOptions = getCerts();
  httpsServer = https.createServer(certOptions, requestHandler);
  httpsServer.listen(httpsPort, "0.0.0.0", () => {
    console.log(`HTTPS Proxy server listening on port ${httpsPort}`);
  });
}

// Expose dispose logic as a function
export async function dispose() {
  await pool?.terminate(true); // force kill all workers
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
  proxy?.close();
}
