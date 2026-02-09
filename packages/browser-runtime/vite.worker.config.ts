import { defineConfig } from 'vite';
import { resolve } from 'path';

// Worker polyfill banner - runs before any other code (ES5 compatible)
// IMPORTANT: simple-peer's get-browser-rtc checks for 'window', not 'self' or 'globalThis'.
// Web Workers don't have 'window', so we must create a minimal window object with WebRTC APIs.
const workerPolyfillBanner = `// Polyfills for Web Workers (injected by build)
(function() {
  // Process polyfill
  if (typeof globalThis === 'undefined') { self.globalThis = self; }
  globalThis.process = globalThis.process || {
    env: { NODE_ENV: 'production' },
    nextTick: function(fn) { 
      var args = Array.prototype.slice.call(arguments, 1);
      setTimeout(function() { fn.apply(null, args); }, 0);
    },
    browser: true,
    version: '',
    versions: {},
    platform: 'browser',
    cwd: function() { return '/'; },
  };
  // simple-peer's get-browser-rtc checks 'window.RTCPeerConnection' - polyfill window for workers
  // Web Workers don't have 'window' but DO have WebRTC APIs on 'self' (in classic workers)
  if (typeof window === 'undefined' && self.RTCPeerConnection) {
    self.window = {
      RTCPeerConnection: self.RTCPeerConnection,
      RTCSessionDescription: self.RTCSessionDescription,
      RTCIceCandidate: self.RTCIceCandidate,
      // Add MediaStream if it exists (for tracks)
      MediaStream: self.MediaStream,
    };
  }
  // Also copy to globalThis for our detectBrowserWebRTC function
  if (self.RTCPeerConnection) {
    globalThis.RTCPeerConnection = globalThis.RTCPeerConnection || self.RTCPeerConnection;
    globalThis.RTCSessionDescription = globalThis.RTCSessionDescription || self.RTCSessionDescription;
    globalThis.RTCIceCandidate = globalThis.RTCIceCandidate || self.RTCIceCandidate;
  }
})();
`;

/**
 * Separate Vite config for building pack-worker as IIFE format.
 * Classic workers (non-module) have WebRTC support, while module workers may not.
 * 
 * Run with: vite build --config vite.worker.config.ts
 */
export default defineConfig({
  define: {
    'process.env': '{}',
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/workers/pack-worker.ts'),
      name: 'PackWorker',
      formats: ['iife'],
      fileName: () => 'pack-worker.js',
    },
    outDir: 'dist',
    emptyOutDir: false, // Don't clear dist - we build index.js first
    rollupOptions: {
      // Bundle everything - pack-worker must be self-contained
      external: [],
      output: {
        // No code splitting - single file IIFE
        inlineDynamicImports: true,
        banner: workerPolyfillBanner,
      },
    },
  },
  resolve: {
    browserField: true,
    mainFields: ['browser', 'module', 'main'],
  },
});
