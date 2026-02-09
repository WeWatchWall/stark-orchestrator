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
 * Detect native browser WebRTC APIs.
 * Works in main thread and Web Workers.
 * Includes vendor prefixes for older browsers.
 */
function detectBrowserWebRTC(): SimplePeerFactoryOptions['wrtc'] | undefined {
  // Check if we're in a browser environment (main thread or Web Worker)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = typeof globalThis !== 'undefined' ? globalThis : 
                 typeof self !== 'undefined' ? self : 
                 typeof window !== 'undefined' ? window : undefined;
  
  if (!g) return undefined;
  
  // Check for native WebRTC APIs (with vendor prefixes for older browsers)
  const RTCPeerConnection = g.RTCPeerConnection || 
                            g.webkitRTCPeerConnection || 
                            g.mozRTCPeerConnection;
  const RTCSessionDescription = g.RTCSessionDescription || 
                                g.webkitRTCSessionDescription || 
                                g.mozRTCSessionDescription;
  const RTCIceCandidate = g.RTCIceCandidate || 
                          g.webkitRTCIceCandidate || 
                          g.mozRTCIceCandidate;
  
  if (RTCPeerConnection && RTCSessionDescription && RTCIceCandidate) {
    return {
      RTCPeerConnection,
      RTCSessionDescription,
      RTCIceCandidate,
    };
  }
  
  return undefined;
}

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
  // Auto-detect browser WebRTC if not explicitly provided
  const wrtc = options?.wrtc ?? detectBrowserWebRTC();
  
  return (initiator: boolean, config: Required<WebRTCConfig>): SimplePeerLike => {
    const peer = new SimplePeer({
      initiator,
      trickle: config.trickleICE,
      wrtc,
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
