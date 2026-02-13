import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/agent/node-agent.ts',
    'src/executor/pack-executor.ts',
    'src/adapters/fs-adapter.ts',
    'src/adapters/http-adapter.ts',
    'src/adapters/worker-adapter.ts',
    'src/workers/pack-worker.ts',
  ],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  tsconfig: 'tsconfig.json',
});
