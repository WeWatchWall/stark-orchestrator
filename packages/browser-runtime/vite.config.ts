import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'StarkBrowserRuntime',
      fileName: 'index',
      formats: ['es'],
    },
    outDir: 'dist',
    rollupOptions: {
      // Only externalize workspace packages - bundle all third-party deps
      external: ['@stark-o/core', '@stark-o/shared'],
    },
  },
  resolve: {
    // Ensure browser-compatible module resolution
    browserField: true,
    mainFields: ['browser', 'module', 'main'],
  },
  // Optimize dependencies for browser bundling
  optimizeDeps: {
    include: ['workerpool', '@zenfs/core', '@zenfs/dom', 'axios'],
  },
});
