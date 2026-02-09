import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // Define process.env for browser compatibility (some dependencies use it)
  define: {
    'process.env': '{}',
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    lib: {
      // Main library entry point
      // Only build the main library entry point here
      // pack-worker is built separately via vite.worker.config.ts as IIFE
      // because classic workers have WebRTC support while module workers may not
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'StarkBrowserRuntime',
      // Build index as ES module, pack-worker as IIFE for classic workers
      // Classic workers have WebRTC support; module workers may not in some browsers
      formats: ['es'],
      // Output as index.js to match package.json exports
      fileName: () => 'index.js',
    },
    outDir: 'dist',
    rollupOptions: {
      // External deps for main index - but pack-worker will be fully bundled
      external: (id, importer) => {
        // Never externalize for pack-worker (it must be self-contained)
        if (importer && importer.includes('pack-worker')) {
          return false;
        }
        // Externalize workspace packages for main library
        return id === '@stark-o/core' || id === '@stark-o/shared';
      },
      output: {
        // Library output options
      },
    },
  },
  resolve: {
    // Ensure browser-compatible module resolution
    browserField: true,
    mainFields: ['browser', 'module', 'main'],
  },
  // Optimize dependencies for browser bundling
  optimizeDeps: {
    include: ['@zenfs/core', '@zenfs/dom', 'axios'],
  },
});
