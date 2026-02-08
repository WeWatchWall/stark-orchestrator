/**
 * Default PeerFactory implementation using `simple-peer`.
 *
 * Isomorphic — works in both Node.js and browsers.
 * In Node.js, pass the `wrtc` package to enable WebRTC support.
 * In browsers, native WebRTC APIs are used automatically.
 *
 * @module @stark-o/shared/network/peer-factory
 */

import SimplePeer from 'simple-peer';
import type { PeerFactory, SimplePeerLike } from './webrtc-manager.js';
import type { WebRTCConfig } from '../types/network.js';

/**
 * Options for createSimplePeerFactory.
 */
export interface SimplePeerFactoryOptions {
  /**
   * The wrtc module for Node.js environments.
   * Required in Node.js; not needed in browsers.
   * Install with: npm install wrtc
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wrtc?: any;
}

/**
 * Create a PeerFactory backed by `simple-peer`.
 *
 * Usage (Browser):
 * ```ts
 * const factory = createSimplePeerFactory();
 * ```
 *
 * Usage (Node.js):
 * ```ts
 * import wrtc from 'wrtc';
 * const factory = createSimplePeerFactory({ wrtc });
 * ```
 */
export function createSimplePeerFactory(options?: SimplePeerFactoryOptions): PeerFactory {
  return (initiator: boolean, config: Required<WebRTCConfig>): SimplePeerLike => {
    const peer = new SimplePeer({
      initiator,
      trickle: config.trickleICE,
      wrtc: options?.wrtc,
      config: {
        iceServers: config.iceServers.map((s) => ({
          urls: s.urls,
          username: s.username,
          credential: s.credential,
        })),
      },
    });

    // simple-peer Instance implements the SimplePeerLike interface natively
    return peer as unknown as SimplePeerLike;
  };
}
