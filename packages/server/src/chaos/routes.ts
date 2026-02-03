/**
 * Chaos API Routes
 *
 * REST API endpoints for injecting chaos into a running server.
 * These endpoints are only available when STARK_CHAOS_ENABLED=true
 */

import { Router, Request, Response } from 'express';
import { getChaosController } from './controller';
import { getChaosProxy } from '../services/chaos-proxy';
import { getConnectionManager } from '../services/connection-service';

export function createChaosRouter(): Router {
  const router = Router();

  // Middleware: Check if chaos is enabled
  router.use((_req: Request, res: Response, next): void => {
    if (process.env.NODE_ENV === 'production') {
      res.status(403).json({ error: 'Chaos API disabled in production' });
      return;
    }
    if (process.env.STARK_CHAOS_ENABLED !== 'true') {
      res.status(403).json({ error: 'Chaos not enabled. Set STARK_CHAOS_ENABLED=true' });
      return;
    }
    next();
  });

  // GET /chaos/status - Check chaos status
  router.get('/status', (_req: Request, res: Response): void => {
    const controller = getChaosController();
    const stats = controller.getStats();
    res.json({
      enabled: stats.enabled,
      currentScenario: stats.currentScenario,
      stats: stats.proxyStats,
      runCount: stats.runHistory.length,
    });
  });

  // POST /chaos/enable - Enable chaos mode
  router.post('/enable', (_req: Request, res: Response): void => {
    const controller = getChaosController();
    controller.enable();
    res.json({ enabled: true, message: 'Chaos mode enabled' });
  });

  // POST /chaos/disable - Disable chaos mode
  router.post('/disable', (_req: Request, res: Response): void => {
    const controller = getChaosController();
    controller.disable();
    res.json({ enabled: false, message: 'Chaos mode disabled' });
  });

  // GET /chaos/scenarios - List available scenarios
  router.get('/scenarios', (_req: Request, res: Response): void => {
    const controller = getChaosController();
    res.json(controller.listAvailableScenarios());
  });

  // POST /chaos/run - Run a chaos scenario
  router.post('/run', async (req: Request, res: Response): Promise<void> => {
    const controller = getChaosController();
    const { scenario, options, timeout } = req.body;

    if (!scenario) {
      res.status(400).json({ error: 'scenario is required' });
      return;
    }

    try {
      const result = await controller.run({ scenario, options: options || {}, timeout });
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Live Connection Management
  // ─────────────────────────────────────────────────────────────────────────

  // GET /chaos/connections - List all active WebSocket connections
  router.get('/connections', (_req: Request, res: Response): void => {
    try {
      const connManager = getConnectionManager();
      if (!connManager) {
        res.status(503).json({ error: 'Connection manager not available' });
        return;
      }

      const connections = connManager.getConnections();
      const connectionList = Array.from(connections.entries()).map(([id, info]) => ({
        id,
        nodeIds: Array.from(info.nodeIds),
        userId: info.userId,
        ipAddress: info.ipAddress,
        connectedAt: info.connectedAt,
        lastActivity: info.lastActivity,
        isAuthenticated: info.isAuthenticated,
      }));

      res.json({
        count: connectionList.length,
        connections: connectionList,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // GET /chaos/nodes - List all registered nodes with their connection info
  router.get('/nodes', (_req: Request, res: Response): void => {
    try {
      const connManager = getConnectionManager();
      if (!connManager) {
        res.status(503).json({ error: 'Connection manager not available' });
        return;
      }

      const connections = connManager.getConnections();
      const nodes: Array<{ nodeId: string; connectionId: string; userId?: string; connectedAt: Date }> = [];

      for (const [connId, info] of connections) {
        for (const nodeId of info.nodeIds) {
          nodes.push({
            nodeId,
            connectionId: connId,
            userId: info.userId,
            connectedAt: info.connectedAt,
          });
        }
      }

      res.json({
        count: nodes.length,
        nodes,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Quick Actions - Direct manipulation without full scenarios
  // ─────────────────────────────────────────────────────────────────────────

  // POST /chaos/node/kill - Kill a node's connection
  router.post('/node/kill', (req: Request, res: Response): void => {
    const { nodeId } = req.body;
    if (!nodeId) {
      res.status(400).json({ error: 'nodeId is required' });
      return;
    }

    const proxy = getChaosProxy();
    if (!proxy.isEnabled()) {
      res.status(400).json({ error: 'Chaos proxy not enabled' });
      return;
    }

    const success = proxy.simulateNodeLoss(nodeId);
    res.json({ success, nodeId, message: success ? 'Node connection terminated' : 'Node not found or not connected' });
  });

  // POST /chaos/connection/kill - Kill a specific connection by ID
  router.post('/connection/kill', (req: Request, res: Response): void => {
    const { connectionId } = req.body;
    if (!connectionId) {
      res.status(400).json({ error: 'connectionId is required' });
      return;
    }

    const proxy = getChaosProxy();
    if (!proxy.isEnabled()) {
      res.status(400).json({ error: 'Chaos proxy not enabled' });
      return;
    }

    const success = proxy.terminateConnection(connectionId);
    res.json({ success, connectionId, message: success ? 'Connection terminated' : 'Connection not found' });
  });

  // POST /chaos/connection/pause - Pause message delivery on a connection (simulate network freeze)
  router.post('/connection/pause', (req: Request, res: Response): void => {
    const { connectionId, nodeId, durationMs } = req.body;
    if (!connectionId && !nodeId) {
      res.status(400).json({ error: 'connectionId or nodeId is required' });
      return;
    }

    const proxy = getChaosProxy();
    if (!proxy.isEnabled()) {
      res.status(400).json({ error: 'Chaos proxy not enabled' });
      return;
    }

    const success = proxy.pauseConnection(connectionId, nodeId, durationMs);
    res.json({ success, connectionId, nodeId, durationMs, message: success ? 'Connection paused' : 'Connection not found' });
  });

  // POST /chaos/connection/resume - Resume a paused connection
  router.post('/connection/resume', (req: Request, res: Response): void => {
    const { connectionId, nodeId } = req.body;
    if (!connectionId && !nodeId) {
      res.status(400).json({ error: 'connectionId or nodeId is required' });
      return;
    }

    const proxy = getChaosProxy();
    if (!proxy.isEnabled()) {
      res.status(400).json({ error: 'Chaos proxy not enabled' });
      return;
    }

    const success = proxy.resumeConnection(connectionId, nodeId);
    res.json({ success, connectionId, nodeId, message: success ? 'Connection resumed' : 'Connection not found or not paused' });
  });

  // POST /chaos/partition - Create a network partition (isolate nodes/connections)
  router.post('/partition', (req: Request, res: Response): void => {
    const { nodeIds, connectionIds, durationMs } = req.body;
    if (!nodeIds?.length && !connectionIds?.length) {
      res.status(400).json({ error: 'nodeIds or connectionIds array is required' });
      return;
    }

    const proxy = getChaosProxy();
    if (!proxy.isEnabled()) {
      res.status(400).json({ error: 'Chaos proxy not enabled' });
      return;
    }

    const partitionId = proxy.createPartition(nodeIds || [], connectionIds || [], durationMs);
    res.json({ 
      success: true, 
      partitionId,
      nodeIds: nodeIds || [],
      connectionIds: connectionIds || [],
      durationMs,
      message: 'Network partition created' 
    });
  });

  // DELETE /chaos/partition/:id - Remove a network partition
  router.delete('/partition/:id', (req: Request, res: Response): void => {
    const { id } = req.params;

    const proxy = getChaosProxy();
    if (!proxy.isEnabled()) {
      res.status(400).json({ error: 'Chaos proxy not enabled' });
      return;
    }

    const success = proxy.removePartition(id!);
    res.json({ success, partitionId: id, message: success ? 'Partition removed' : 'Partition not found' });
  });

  // GET /chaos/partitions - List active partitions
  router.get('/partitions', (_req: Request, res: Response): void => {
    const proxy = getChaosProxy();
    res.json(proxy.getActivePartitions());
  });

  // POST /chaos/latency - Inject latency into connections
  router.post('/latency', (req: Request, res: Response): void => {
    const { nodeId, connectionId, latencyMs, jitterMs, durationMs } = req.body;
    if (!nodeId && !connectionId) {
      res.status(400).json({ error: 'nodeId or connectionId is required' });
      return;
    }

    const proxy = getChaosProxy();
    if (!proxy.isEnabled()) {
      res.status(400).json({ error: 'Chaos proxy not enabled' });
      return;
    }

    const ruleId = proxy.injectLatency({
      nodeId,
      connectionId,
      latencyMs: latencyMs || 100,
      jitterMs: jitterMs || 0,
      durationMs,
    });

    res.json({ 
      success: true, 
      ruleId,
      nodeId,
      connectionId,
      latencyMs: latencyMs || 100,
      jitterMs: jitterMs || 0,
      durationMs,
      message: 'Latency injection configured' 
    });
  });

  // DELETE /chaos/latency/:id - Remove latency injection
  router.delete('/latency/:id', (req: Request, res: Response): void => {
    const { id } = req.params;

    const proxy = getChaosProxy();
    if (!proxy.isEnabled()) {
      res.status(400).json({ error: 'Chaos proxy not enabled' });
      return;
    }

    const success = proxy.removeLatencyRule(id!);
    res.json({ success, ruleId: id, message: success ? 'Latency rule removed' : 'Rule not found' });
  });

  // POST /chaos/heartbeat/delay - Add heartbeat delays
  router.post('/heartbeat/delay', (req: Request, res: Response): void => {
    const { nodeId, delayMs, durationMs, dropRate } = req.body;
    if (!nodeId) {
      res.status(400).json({ error: 'nodeId is required' });
      return;
    }

    const proxy = getChaosProxy();
    if (!proxy.isEnabled()) {
      res.status(400).json({ error: 'Chaos proxy not enabled' });
      return;
    }

    proxy.addHeartbeatRule({
      nodeId,
      delayMs: delayMs || 3000,
      delayJitterMs: (delayMs || 3000) * 0.5,
      dropRate,
    });

    // Auto-remove after duration
    if (durationMs) {
      setTimeout(() => {
        proxy.removeHeartbeatRule(nodeId);
      }, durationMs);
    }

    res.json({ success: true, nodeId, delayMs, durationMs });
  });

  // POST /chaos/message/drop - Add message drop rules
  router.post('/message/drop', (req: Request, res: Response): void => {
    const { nodeId, messageTypes, dropRate } = req.body;

    const proxy = getChaosProxy();
    if (!proxy.isEnabled()) {
      res.status(400).json({ error: 'Chaos proxy not enabled' });
      return;
    }

    const ruleId = proxy.addMessageRule({
      nodeId,
      messageTypes,
      dropRate: dropRate || 0.5,
    });

    res.json({ success: true, ruleId });
  });

  // POST /chaos/api/flaky - Make API calls flaky
  router.post('/api/flaky', (req: Request, res: Response): void => {
    const { errorRate, timeoutRate, timeoutMs } = req.body;

    const proxy = getChaosProxy();
    if (!proxy.isEnabled()) {
      res.status(400).json({ error: 'Chaos proxy not enabled' });
      return;
    }

    proxy.setApiChaos({ errorRate, timeoutRate, timeoutMs });
    res.json({ success: true, errorRate, timeoutRate, timeoutMs });
  });

  // POST /chaos/clear - Clear all chaos rules
  router.post('/clear', (_req: Request, res: Response): void => {
    const proxy = getChaosProxy();
    proxy.clearAllRules();
    res.json({ success: true, message: 'All chaos rules cleared' });
  });

  // GET /chaos/stats - Get detailed stats
  router.get('/stats', (_req: Request, res: Response): void => {
    const proxy = getChaosProxy();
    res.json(proxy.getStats());
  });

  // GET /chaos/events - Get recent chaos events
  router.get('/events', (req: Request, res: Response): void => {
    const proxy = getChaosProxy();
    const count = parseInt(req.query.count as string) || 50;
    res.json(proxy.getRecentEvents(count));
  });

  return router;
}
