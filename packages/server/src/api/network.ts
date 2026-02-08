/**
 * Network API Routes
 *
 * REST endpoints for:
 * - Network policies (CRUD)
 * - Service registry (read-only snapshot)
 * - Pod routing requests (used by pods on cache miss)
 *
 * @module @stark-o/server/api/network
 */

import { Router, type Request, type Response } from 'express';
import { createServiceLogger, generateCorrelationId } from '@stark-o/shared';
import {
  getNetworkPolicyEngine,
  getServiceRegistry,
  handleRoutingRequest,
} from '@stark-o/shared';
import type {
  CreateNetworkPolicyInput,
  RoutingRequest,
} from '@stark-o/shared';

const logger = createServiceLogger(
  { level: 'debug', service: 'stark-orchestrator' },
  { component: 'network-api' },
);

// ── Network Policies ────────────────────────────────────────────────────────

async function listPoliciesHandler(_req: Request, res: Response): Promise<void> {
  const policies = getNetworkPolicyEngine().listPolicies();
  res.json({ success: true, data: policies });
}

async function createPolicyHandler(req: Request, res: Response): Promise<void> {
  const correlationId = (req as Request & { correlationId?: string }).correlationId ?? generateCorrelationId();
  const reqLogger = logger.withCorrelationId(correlationId);

  const input = req.body as CreateNetworkPolicyInput;
  if (!input.sourceService || !input.targetService || !input.action) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'sourceService, targetService, and action are required' },
    });
    return;
  }

  if (input.action !== 'allow' && input.action !== 'deny') {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: "action must be 'allow' or 'deny'" },
    });
    return;
  }

  const policy = getNetworkPolicyEngine().addPolicy(input);
  reqLogger.info('Network policy created', {
    policyId: policy.id,
    source: policy.sourceService,
    target: policy.targetService,
    action: policy.action,
  });
  res.status(201).json({ success: true, data: policy });
}

async function deletePolicyHandler(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Policy ID is required' },
    });
    return;
  }

  const removed = getNetworkPolicyEngine().removePolicy(id);
  if (!removed) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: `Network policy '${id}' not found` },
    });
    return;
  }

  logger.info('Network policy deleted', { policyId: id });
  res.json({ success: true, data: { id, deleted: true } });
}

async function deletePolicyByPairHandler(req: Request, res: Response): Promise<void> {
  const { sourceService, targetService } = req.body as { sourceService?: string; targetService?: string };
  if (!sourceService || !targetService) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'sourceService and targetService are required' },
    });
    return;
  }

  const removed = getNetworkPolicyEngine().removePolicyByPair(sourceService, targetService);
  if (!removed) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: `No network policy found for ${sourceService} → ${targetService}` },
    });
    return;
  }

  logger.info('Network policy removed by pair', { sourceService, targetService });
  res.json({ success: true, data: { sourceService, targetService, deleted: true } });
}

// ── Service Registry ────────────────────────────────────────────────────────

async function registrySnapshotHandler(_req: Request, res: Response): Promise<void> {
  const snapshot = getServiceRegistry().snapshot();
  res.json({ success: true, data: snapshot });
}

async function registerPodHandler(req: Request, res: Response): Promise<void> {
  const { serviceId, podId, nodeId, status } = req.body as {
    serviceId?: string; podId?: string; nodeId?: string; status?: string;
  };
  if (!serviceId || !podId || !nodeId) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'serviceId, podId, and nodeId are required' },
    });
    return;
  }

  getServiceRegistry().register(serviceId, podId, nodeId, (status as 'healthy' | 'unhealthy' | 'unknown') ?? 'healthy');
  logger.debug('Pod registered in service registry', { serviceId, podId, nodeId });
  res.status(201).json({ success: true, data: { serviceId, podId, nodeId } });
}

async function unregisterPodHandler(req: Request, res: Response): Promise<void> {
  const { serviceId, podId } = req.body as { serviceId?: string; podId?: string };
  if (!serviceId || !podId) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'serviceId and podId are required' },
    });
    return;
  }

  getServiceRegistry().unregister(serviceId, podId);
  logger.debug('Pod unregistered from service registry', { serviceId, podId });
  res.json({ success: true, data: { serviceId, podId, unregistered: true } });
}

// ── Routing ─────────────────────────────────────────────────────────────────

async function routeHandler(req: Request, res: Response): Promise<void> {
  const correlationId = (req as Request & { correlationId?: string }).correlationId ?? generateCorrelationId();
  const reqLogger = logger.withCorrelationId(correlationId);

  const request = req.body as RoutingRequest;
  if (!request.callerPodId || !request.callerServiceId || !request.targetServiceId) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'callerPodId, callerServiceId, and targetServiceId are required' },
    });
    return;
  }

  try {
    const response = handleRoutingRequest(request, {
      registry: getServiceRegistry(),
      policyEngine: getNetworkPolicyEngine(),
    });

    if (!response.policyAllowed) {
      reqLogger.warn('Routing denied by network policy', {
        source: request.callerServiceId,
        target: request.targetServiceId,
        reason: response.policyDeniedReason,
      });
      res.status(403).json({ success: false, data: response });
      return;
    }

    reqLogger.debug('Route resolved', {
      source: request.callerServiceId,
      target: request.targetServiceId,
      targetPod: response.targetPodId,
    });
    res.json({ success: true, data: response });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Routing failed';
    reqLogger.error('Routing error', err instanceof Error ? err : undefined, {
      source: request.callerServiceId,
      target: request.targetServiceId,
    });
    res.status(503).json({
      success: false,
      error: { code: 'ROUTING_ERROR', message },
    });
  }
}

// ── Router Factory ──────────────────────────────────────────────────────────

export function createNetworkRouter(): Router {
  const router = Router();

  // Network policies
  router.get('/policies', listPoliciesHandler);
  router.post('/policies', createPolicyHandler);
  router.delete('/policies/:id', deletePolicyHandler);
  router.post('/policies/delete-pair', deletePolicyByPairHandler);

  // Service registry
  router.get('/registry', registrySnapshotHandler);
  router.post('/registry/register', registerPodHandler);
  router.post('/registry/unregister', unregisterPodHandler);

  // Routing
  router.post('/route', routeHandler);

  logger.info('Network API router initialized');
  return router;
}

export default createNetworkRouter;
