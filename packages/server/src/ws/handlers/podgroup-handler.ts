/**
 * PodGroup WebSocket Handler
 *
 * Centralises PodGroup membership on the orchestrator server.
 * Pods communicate group operations (join, leave, getGroupPods, etc.) via WS,
 * and the orchestrator maintains a single authoritative PodGroupStore backed
 * by node-cache.
 *
 * After group discovery, pods still talk to each other directly over WebRTC —
 * this handler only manages the *membership* metadata.
 *
 * Message types handled:
 *   group:join            — join a group
 *   group:leave           — leave a specific group
 *   group:leave-all       — leave all groups (graceful shutdown)
 *   group:get-pods        — list members of a group
 *   group:get-groups      — list groups a pod belongs to
 *
 * @module @stark-o/server/ws/handlers/podgroup-handler
 */

import { createServiceLogger, PodGroupStore } from '@stark-o/shared';
import type { WsMessage, PodGroupMembership } from '@stark-o/shared';

const logger = createServiceLogger(
  { level: 'debug', service: 'stark-orchestrator' },
  { component: 'podgroup-ws-handler' },
);

// ── Central store (singleton for the orchestrator process) ──────────────────

let _centralStore: PodGroupStore | null = null;

function getCentralPodGroupStore(): PodGroupStore {
  if (!_centralStore) {
    _centralStore = new PodGroupStore();
  }
  return _centralStore;
}

/** Exposed for testing — resets the central store. */
export function resetCentralPodGroupStore(): void {
  if (_centralStore) {
    _centralStore.dispose();
    _centralStore = null;
  }
}

/** Expose the central PodGroupStore singleton for cross-service cleanup. */
export { getCentralPodGroupStore };

// ── Payload types ───────────────────────────────────────────────────────────

export interface GroupJoinPayload {
  podId: string;
  groupId: string;
  ttl?: number;
  metadata?: Record<string, unknown>;
}

export interface GroupLeavePayload {
  podId: string;
  groupId: string;
}

export interface GroupLeaveAllPayload {
  podId: string;
}

export interface GroupGetPodsPayload {
  groupId: string;
}

export interface GroupGetGroupsPayload {
  podId: string;
}

// ── WS message type constants ───────────────────────────────────────────────

export const PODGROUP_WS_TYPES = {
  JOIN: 'group:join',
  JOIN_ACK: 'group:join:ack',
  LEAVE: 'group:leave',
  LEAVE_ACK: 'group:leave:ack',
  LEAVE_ALL: 'group:leave-all',
  LEAVE_ALL_ACK: 'group:leave-all:ack',
  GET_PODS: 'group:get-pods',
  GET_PODS_ACK: 'group:get-pods:ack',
  GET_GROUPS: 'group:get-groups',
  GET_GROUPS_ACK: 'group:get-groups:ack',
  ERROR: 'group:error',
} as const;

// ── Handler factory ─────────────────────────────────────────────────────────

export function createPodGroupWsHandlers() {
  const store = getCentralPodGroupStore();

  return {
    /**
     * Handle group:join — add a pod to a group.
     */
    handleJoin(
      message: WsMessage<GroupJoinPayload>,
      sendResponse: (response: WsMessage) => void,
      connUserId?: string,
      connectionType?: 'agent' | 'pod',
    ): void {
      const { podId, groupId, ttl, metadata } = message.payload ?? {} as GroupJoinPayload;

      if (!podId || !groupId) {
        sendResponse({
          type: PODGROUP_WS_TYPES.ERROR,
          payload: { error: 'Missing podId or groupId' },
          correlationId: message.correlationId,
        });
        return;
      }

      // Pod connections can only join as themselves
      if (connectionType === 'pod' && connUserId && connUserId !== podId) {
        logger.warn('group:join rejected — podId mismatch', { podId, connUserId });
        sendResponse({
          type: PODGROUP_WS_TYPES.ERROR,
          payload: { error: 'Pod identity mismatch' },
          correlationId: message.correlationId,
        });
        return;
      }

      try {
        const membership = store.joinGroup(groupId, podId, ttl, metadata);
        logger.debug('Pod joined group', { podId, groupId });

        sendResponse({
          type: PODGROUP_WS_TYPES.JOIN_ACK,
          payload: { membership },
          correlationId: message.correlationId,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Join failed';
        sendResponse({
          type: PODGROUP_WS_TYPES.ERROR,
          payload: { error: errorMessage },
          correlationId: message.correlationId,
        });
      }
    },

    /**
     * Handle group:leave — remove a pod from a specific group.
     */
    handleLeave(
      message: WsMessage<GroupLeavePayload>,
      sendResponse: (response: WsMessage) => void,
      connUserId?: string,
      connectionType?: 'agent' | 'pod',
    ): void {
      const { podId, groupId } = message.payload ?? {} as GroupLeavePayload;

      if (!podId || !groupId) {
        sendResponse({
          type: PODGROUP_WS_TYPES.ERROR,
          payload: { error: 'Missing podId or groupId' },
          correlationId: message.correlationId,
        });
        return;
      }

      if (connectionType === 'pod' && connUserId && connUserId !== podId) {
        logger.warn('group:leave rejected — podId mismatch', { podId, connUserId });
        sendResponse({
          type: PODGROUP_WS_TYPES.ERROR,
          payload: { error: 'Pod identity mismatch' },
          correlationId: message.correlationId,
        });
        return;
      }

      const removed = store.leaveGroup(groupId, podId);
      logger.debug('Pod left group', { podId, groupId, removed });

      sendResponse({
        type: PODGROUP_WS_TYPES.LEAVE_ACK,
        payload: { removed },
        correlationId: message.correlationId,
      });
    },

    /**
     * Handle group:leave-all — remove a pod from every group.
     * Typically called during graceful shutdown.
     */
    handleLeaveAll(
      message: WsMessage<GroupLeaveAllPayload>,
      sendResponse: (response: WsMessage) => void,
      connUserId?: string,
      connectionType?: 'agent' | 'pod',
    ): void {
      const { podId } = message.payload ?? {} as GroupLeaveAllPayload;

      if (!podId) {
        sendResponse({
          type: PODGROUP_WS_TYPES.ERROR,
          payload: { error: 'Missing podId' },
          correlationId: message.correlationId,
        });
        return;
      }

      if (connectionType === 'pod' && connUserId && connUserId !== podId) {
        logger.warn('group:leave-all rejected — podId mismatch', { podId, connUserId });
        sendResponse({
          type: PODGROUP_WS_TYPES.ERROR,
          payload: { error: 'Pod identity mismatch' },
          correlationId: message.correlationId,
        });
        return;
      }

      const removedFrom = store.leaveAllGroups(podId);
      logger.debug('Pod left all groups', { podId, groups: removedFrom });

      sendResponse({
        type: PODGROUP_WS_TYPES.LEAVE_ALL_ACK,
        payload: { removedFrom },
        correlationId: message.correlationId,
      });
    },

    /**
     * Handle group:get-pods — return current members of a group.
     */
    handleGetPods(
      message: WsMessage<GroupGetPodsPayload>,
      sendResponse: (response: WsMessage) => void,
    ): void {
      const { groupId } = message.payload ?? {} as GroupGetPodsPayload;

      if (!groupId) {
        sendResponse({
          type: PODGROUP_WS_TYPES.ERROR,
          payload: { error: 'Missing groupId' },
          correlationId: message.correlationId,
        });
        return;
      }

      const members: PodGroupMembership[] = store.getGroupPods(groupId);

      sendResponse({
        type: PODGROUP_WS_TYPES.GET_PODS_ACK,
        payload: { members },
        correlationId: message.correlationId,
      });
    },

    /**
     * Handle group:get-groups — return all groups a pod belongs to.
     */
    handleGetGroups(
      message: WsMessage<GroupGetGroupsPayload>,
      sendResponse: (response: WsMessage) => void,
    ): void {
      const { podId } = message.payload ?? {} as GroupGetGroupsPayload;

      if (!podId) {
        sendResponse({
          type: PODGROUP_WS_TYPES.ERROR,
          payload: { error: 'Missing podId' },
          correlationId: message.correlationId,
        });
        return;
      }

      const groups = store.getGroupsForPod(podId);

      sendResponse({
        type: PODGROUP_WS_TYPES.GET_GROUPS_ACK,
        payload: { groups },
        correlationId: message.correlationId,
      });
    },

    /**
     * Called when a pod disconnects — clean up all its group memberships.
     */
    handlePodDisconnected(podId: string): void {
      const removedFrom = store.leaveAllGroups(podId);
      if (removedFrom.length > 0) {
        logger.debug('Pod disconnected — removed from groups', { podId, groups: removedFrom });
      }
    },

    /** Expose the central store for testing / advanced use. */
    getStore(): PodGroupStore {
      return store;
    },
  };
}
