/**
 * Stark Orchestrator Server
 *
 * Entry point for the HTTP REST API and WebSocket server.
 * @module @stark-o/server
 */

import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import express, { Express } from 'express';
import cors, { CorsOptions } from 'cors';
import { WebSocketServer } from 'ws';
import httpProxy from 'http-proxy';
import selfsigned from 'selfsigned';
import { createServiceLogger } from '@stark-o/shared';
import { createApiRouter } from './api/router.js';
import { createConnectionManager, type ConnectionManagerOptions } from './ws/connection-manager.js';
import { createSchedulerService } from './services/scheduler-service.js';
import { getDeploymentController } from './services/deployment-controller.js';
import { setConnectionManager } from './services/connection-service.js';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Server configuration options
 */
export interface ServerConfig {
  /** HTTPS port (default: 443) */
  port: number;
  /** Internal HTTP port (default: 3000, only for internal proxy) */
  httpPort: number;
  /** Hostname to bind to (default: '0.0.0.0') */
  host: string;
  /** Enable CORS (default: true) */
  enableCors: boolean;
  /** CORS allowed origins (default: ['https://localhost:*']) */
  corsOrigins: string[];
  /** Enable request logging (default: true) */
  enableLogging: boolean;
  /** WebSocket path (default: '/ws') */
  wsPath: string;
  /** Node environment */
  nodeEnv: 'development' | 'production' | 'test';
  /** Supabase URL */
  supabaseUrl?: string;
  /** Supabase anon key */
  supabaseAnonKey?: string;
  /** Path to SSL certificate file */
  sslCert?: string;
  /** Path to SSL key file */
  sslKey?: string;
  /** Expose HTTP on external interface (default: false, HTTP only on 127.0.0.1) */
  exposeHttp: boolean;
}

/**
 * Default server configuration
 */
const DEFAULT_CONFIG: ServerConfig = {
  port: parseInt(process.env.PORT || '443', 10),
  httpPort: parseInt(process.env.HTTP_PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  enableCors: true,
  corsOrigins: (process.env.CORS_ORIGINS || 'https://localhost,https://localhost:*,http://localhost,http://localhost:*,http://127.0.0.1,http://127.0.0.1:*').split(','),
  enableLogging: process.env.ENABLE_LOGGING !== 'false',
  wsPath: process.env.WS_PATH || '/ws',
  nodeEnv: (process.env.NODE_ENV || 'development') as ServerConfig['nodeEnv'],
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  sslCert: process.env.SSL_CERT,
  sslKey: process.env.SSL_KEY,
  exposeHttp: process.env.EXPOSE_HTTP === 'true',
};

/**
 * Logger for server operations
 */
const logger = createServiceLogger(
  {
    level: process.env.LOG_LEVEL === 'debug' ? 'debug' : 'info',
    service: 'stark-orchestrator',
  },
  { component: 'server' }
);

// ============================================================================
// CORS Configuration
// ============================================================================

/**
 * Create CORS configuration for browser clients
 */
function createCorsConfig(origins: string[]): CorsOptions {
  return {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) {
        callback(null, true);
        return;
      }

      // Check if origin matches any allowed pattern
      const isAllowed = origins.some((pattern) => {
        if (pattern.includes('*')) {
          // Convert wildcard pattern to regex
          const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
          return regex.test(origin);
        }
        return pattern === origin;
      });

      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Correlation-ID',
      'X-Request-ID',
    ],
    exposedHeaders: ['X-Correlation-ID', 'X-Request-ID'],
    maxAge: 86400, // 24 hours
  };
}

// ============================================================================
// Server Instance
// ============================================================================

/**
 * Server instance containing HTTP server and WebSocket server
 */
export interface ServerInstance {
  /** Express application */
  app: Express;
  /** HTTP server (internal, or external if exposeHttp is true) */
  httpServer: http.Server;
  /** HTTPS server (always enabled) */
  httpsServer: https.Server;
  /** WebSocket server (attached to HTTPS) */
  wss: WebSocketServer;
  /** Connection manager for WebSocket */
  connectionManager: ReturnType<typeof createConnectionManager>;
  /** Scheduler service for pod scheduling */
  schedulerService: ReturnType<typeof createSchedulerService>;
  /** Deployment controller for reconciling deployments */
  deploymentController: ReturnType<typeof getDeploymentController>;
  /** Server configuration */
  config: ServerConfig;
  /** Start the server */
  start: () => Promise<void>;
  /** Stop the server */
  stop: () => Promise<void>;
}

/**
 * Create and configure the server
 */
export function createServer(config: Partial<ServerConfig> = {}): ServerInstance {
  const finalConfig: ServerConfig = { ...DEFAULT_CONFIG, ...config };

  logger.info('Creating server', {
    httpsPort: finalConfig.port,
    httpPort: finalConfig.httpPort,
    host: finalConfig.host,
    nodeEnv: finalConfig.nodeEnv,
    enableCors: finalConfig.enableCors,
    wsPath: finalConfig.wsPath,
    exposeHttp: finalConfig.exposeHttp,
  });

  // Create Express app
  const app = express();

  // Trust proxy (for correct IP detection behind reverse proxy)
  app.set('trust proxy', true);

  // Parse JSON bodies
  app.use(express.json({ limit: '10mb' }));

  // Parse URL-encoded bodies
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // CORS middleware
  if (finalConfig.enableCors) {
    const corsConfig = createCorsConfig(finalConfig.corsOrigins);
    app.use(cors(corsConfig));
    logger.debug('CORS enabled', { origins: finalConfig.corsOrigins });
  }

  // Mount API router
  const apiRouter = createApiRouter({
    enableLogging: finalConfig.enableLogging,
  });
  app.use(apiRouter);

  // Serve static files from client build
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // In dev mode (__dirname is src/), go up to package root then into dist/public
  // In production (__dirname is dist/), public is a sibling folder
  const publicPath = __dirname.endsWith('src') 
    ? path.join(__dirname, '..', 'dist', 'public')
    : path.join(__dirname, 'public');
  
  app.use(express.static(publicPath));
  
  // SPA fallback - serve index.html for any unmatched routes
  app.get('*', (_req, res) => {
    const indexPath = path.join(publicPath, 'index.html');
    res.sendFile(indexPath, (err) => {
      if (err) {
        res.status(404).send('Not found');
      }
    });
  });

  // Create HTTP server (internal, binds to 127.0.0.1 unless exposeHttp is true)
  const httpServer = http.createServer(app);

  // These will be initialized in start()
  let httpsServer: https.Server;
  let wss: WebSocketServer;
  let connectionManager: ReturnType<typeof createConnectionManager>;
  let schedulerService: ReturnType<typeof createSchedulerService>;
  let deploymentController: ReturnType<typeof getDeploymentController>;

  // Server instance
  const instance: ServerInstance = {
    app,
    httpServer,
    get httpsServer() { return httpsServer; },
    get wss() { return wss; },
    get connectionManager() { return connectionManager; },
    get schedulerService() { return schedulerService; },
    get deploymentController() { return deploymentController; },
    config: finalConfig,

    start: async () => {
      // Load SSL certificates or generate self-signed for development
      let sslOptions: https.ServerOptions;
      if (finalConfig.sslCert && finalConfig.sslKey) {
        sslOptions = {
          cert: fs.readFileSync(finalConfig.sslCert),
          key: fs.readFileSync(finalConfig.sslKey),
        };
        logger.info('Using provided SSL certificates');
      } else {
        // Auto-generate self-signed certificate for development
        // Cache the certificate to avoid regenerating on each restart
        const cacheDir = path.join(process.cwd(), '.cache');
        const certPath = path.join(cacheDir, 'localhost.crt');
        const keyPath = path.join(cacheDir, 'localhost.key');
        
        let cert: string;
        let key: string;
        
        if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
          // Reuse cached certificate
          cert = fs.readFileSync(certPath, 'utf-8');
          key = fs.readFileSync(keyPath, 'utf-8');
          logger.info('Using cached self-signed certificate from .cache/');
        } else {
          // Generate new certificate and cache it
          logger.warn('No SSL certificates provided. Generating self-signed certificate for development.');
          logger.warn('For production, set SSL_CERT and SSL_KEY environment variables.');
          
          const attrs = [{ name: 'commonName', value: 'localhost' }];
          const pems = await selfsigned.generate(attrs, {
            algorithm: 'sha256',
            keySize: 2048,
            extensions: [
              { name: 'basicConstraints', cA: true },
              {
                name: 'keyUsage',
                keyCertSign: true,
                digitalSignature: true,
                keyEncipherment: true,
              },
              {
                name: 'extKeyUsage',
                serverAuth: true,
                clientAuth: true,
              },
              {
                name: 'subjectAltName',
                altNames: [
                  { type: 2, value: 'localhost' },
                  { type: 7, ip: '127.0.0.1' },
                  { type: 7, ip: '::1' },
                ],
              },
            ],
          });
          
          cert = pems.cert;
          key = pems.private;
          
          // Cache the certificate for future restarts
          if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
          }
          fs.writeFileSync(certPath, cert);
          fs.writeFileSync(keyPath, key);
          
          logger.info('Self-signed certificate generated and cached in .cache/');
        }
        
        sslOptions = { cert, key };
      }

      // Create HTTPS proxy server that routes to internal HTTP
      const proxy = httpProxy.createProxyServer({
        target: `http://127.0.0.1:${finalConfig.httpPort}`,
        ws: true, // Enable WebSocket proxying
        xfwd: true, // Add X-Forwarded headers
        changeOrigin: true, // Required for proper WebSocket handshake
        timeout: 0, // No timeout for long-lived WebSocket connections
        proxyTimeout: 0, // No timeout for proxy connections
      });

      proxy.on('error', (err, _req, res) => {
        logger.error('Proxy error', err);
        if (res && 'writeHead' in res && typeof res.writeHead === 'function') {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('Bad Gateway');
        } else if (res && 'destroy' in res && typeof res.destroy === 'function') {
          // For WebSocket upgrades, res is a Socket, not ServerResponse
          res.destroy();
        }
      });

      // Handle WebSocket-specific proxy errors
      proxy.on('proxyReqWs', (_proxyReq, _req, socket) => {
        socket.on('error', (err) => {
          logger.error('WebSocket proxy socket error', err);
        });
      });

      // Log WebSocket connection lifecycle for debugging
      proxy.on('open', (proxySocket) => {
        logger.debug('WebSocket proxy connection opened');
        proxySocket.on('error', (err) => {
          logger.error('WebSocket proxySocket error', err);
        });
      });

      proxy.on('close', (_res, _socket, _head) => {
        logger.debug('WebSocket proxy connection closed');
      });

      // Create HTTPS server that proxies to internal HTTP
      httpsServer = https.createServer(sslOptions, (req, res) => {
        proxy.web(req, res);
      });

      // Log all HTTPS connections for debugging
      httpsServer.on('connection', (socket: any) => {
        logger.debug('New HTTPS connection', { 
          remoteAddress: socket.remoteAddress,
          remotePort: socket.remotePort 
        });
      });

      // Handle WebSocket upgrade for HTTPS
      httpsServer.on('upgrade', (req, socket: any, head) => {
        logger.info('WebSocket upgrade request received', {
          url: req.url,
          headers: req.headers['upgrade'],
          remoteAddress: socket.remoteAddress,
        });
        // Handle socket errors to prevent unhandled exceptions
        socket.on('error', (err: any) => {
          logger.error('WebSocket upgrade socket error', err);
        });
        proxy.ws(req, socket, head);
      });

      // Create WebSocket server attached to HTTP server (internal)
      wss = new WebSocketServer({
        server: httpServer,
        path: finalConfig.wsPath,
      });

      // Create connection manager for WebSocket
      const connectionManagerOptions: ConnectionManagerOptions = {
        pingInterval: 30000,
        pongTimeout: 10000,
      };
      connectionManager = createConnectionManager(connectionManagerOptions);

      // Attach connection manager to WebSocket server
      connectionManager.attach(wss);

      // Register connection manager with the connection service for global access
      setConnectionManager(connectionManager);

      logger.debug('WebSocket server attached', { path: finalConfig.wsPath });

      // Create scheduler service for pod scheduling
      schedulerService = createSchedulerService({
        scheduleInterval: 5000,
        maxPodsPerRun: 10,
        autoStart: false, // We'll start it after the server is listening
      });

      // Attach scheduler to connection manager
      schedulerService.attach(connectionManager);

      // Create deployment controller for reconciling deployments
      deploymentController = getDeploymentController({
        reconcileInterval: 10000,
        autoStart: false, // We'll start it after the server is listening
      });

      return new Promise<void>((resolve, reject) => {
        try {
          // Determine HTTP host based on exposeHttp setting
          const httpHost = finalConfig.exposeHttp ? finalConfig.host : '127.0.0.1';
          
          // Start HTTP server (internal or external based on exposeHttp)
          httpServer.listen(finalConfig.httpPort, httpHost, () => {
            logger.info('HTTP server started', {
              url: `http://${httpHost}:${finalConfig.httpPort}`,
              wsUrl: `ws://${httpHost}:${finalConfig.httpPort}${finalConfig.wsPath}`,
              internal: !finalConfig.exposeHttp,
            });

            // Start HTTPS server on external interface
            httpsServer.listen(finalConfig.port, finalConfig.host, () => {
              logger.info('HTTPS server started', {
                url: `https://${finalConfig.host}:${finalConfig.port}`,
                wsUrl: `wss://${finalConfig.host}:${finalConfig.port}${finalConfig.wsPath}`,
                nodeEnv: finalConfig.nodeEnv,
              });

              // Start the scheduler service after server is running
              schedulerService.start();
              logger.info('Scheduler service started');

              // Start the deployment controller after server is running
              deploymentController.start();
              logger.info('Deployment controller started');

              resolve();
            });

            httpsServer.on('error', (error) => {
              logger.error('HTTPS server error', error);
              reject(error);
            });
          });

          httpServer.on('error', (error) => {
            logger.error('Server error', error);
            reject(error);
          });
        } catch (error) {
          reject(error);
        }
      });
    },

    stop: async () => {
      return new Promise<void>((resolve, reject) => {
        logger.info('Stopping server...');

        // Stop the deployment controller
        deploymentController.stop();
        logger.info('Deployment controller stopped');

        // Stop the scheduler service
        schedulerService.stop();
        logger.info('Scheduler service stopped');

        // Close WebSocket connections
        connectionManager.shutdown();

        // Close WebSocket server
        wss.close((wsError) => {
          if (wsError) {
            logger.warn('Error closing WebSocket server', { error: wsError.message });
          }

          // Close HTTPS server
          httpsServer.close((httpsError) => {
            if (httpsError) {
              logger.warn('Error closing HTTPS server', { error: httpsError.message });
            }

            // Close HTTP server
            httpServer.close((httpError) => {
              if (httpError) {
                logger.error('Error closing HTTP server', httpError);
                reject(httpError);
              } else {
                logger.info('Server stopped');
                resolve();
              }
            });
          });
        });
      });
    },
  };

  return instance;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Main function to start the server
 */
async function main(): Promise<void> {
  const server = createServer();

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    try {
      await server.stop();
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', error instanceof Error ? error : undefined);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
    shutdown('uncaughtException').catch(() => process.exit(1));
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', reason instanceof Error ? reason : new Error(String(reason)));
  });

  // Start server
  try {
    await server.start();
  } catch (error) {
    logger.error('Failed to start server', error instanceof Error ? error : undefined);
    process.exit(1);
  }
}

// Run main if this is the entry point
// Check if running directly (not imported as a module)
import { resolve } from 'node:path';

const currentFile = fileURLToPath(import.meta.url);
const entryFile = resolve(process.argv[1] ?? '');
const isMainModule = currentFile === entryFile;
if (isMainModule) {
  main();
}

// ============================================================================
// Exports
// ============================================================================

export { createApiRouter } from './api/router.js';
export { createConnectionManager } from './ws/connection-manager.js';
export * from './api/index.js';
export * from './ws/index.js';
export * from './middleware/index.js';

