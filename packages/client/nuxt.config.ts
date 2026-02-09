// https://nuxt.com/docs/api/configuration/nuxt-config
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { Plugin } from 'vite';

// Vite plugin to inject process polyfill at the very beginning of the bundle
function processPolyfillPlugin(): Plugin {
  const polyfillCode = `
(function() {
  if (typeof globalThis.process === 'undefined') {
    globalThis.process = {
      env: { NODE_ENV: 'production' },
      browser: true,
      version: '',
      versions: {},
      platform: 'browser',
      cwd: function() { return '/'; },
      nextTick: function(fn) {
        var args = Array.prototype.slice.call(arguments, 1);
        Promise.resolve().then(function() { fn.apply(null, args); });
      }
    };
  }
})();
`;

  return {
    name: 'process-polyfill',
    enforce: 'pre',
    // During dev, inject via transformIndexHtml
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head><script>${polyfillCode}</script>`
      );
    },
    // During build, add as banner to chunks
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && chunk.isEntry) {
          chunk.code = polyfillCode + chunk.code;
        }
      }
    }
  };
}

export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },
  
  // Generate static files for production
  ssr: false,
  
  // Output directory for the static build
  nitro: {
    preset: 'static',
    output: {
      publicDir: '../server/dist/public'
    }
  },
  
  // Copy pack-worker.js and its chunks to _nuxt directory after generate
  hooks: {
    'nitro:build:public-assets': (nitro) => {
      const srcDir = resolve(__dirname, '../browser-runtime/dist');
      const destDir = resolve(nitro.options.output.publicDir, '_nuxt');
      
      console.log('📦 Copy pack-worker files hook triggered');
      console.log('   Source dir:', srcDir);
      console.log('   Dest dir:', destDir);
      
      if (existsSync(srcDir)) {
        // Ensure destination directory exists
        if (!existsSync(destDir)) {
          mkdirSync(destDir, { recursive: true });
        }
        
        // Copy all .js files except index.js (which is the main library entry)
        const { readdirSync } = require('fs');
        const files = readdirSync(srcDir);
        let copiedCount = 0;
        
        for (const file of files) {
          if (file.endsWith('.js') && file !== 'index.js') {
            const src = resolve(srcDir, file);
            const dest = resolve(destDir, file);
            copyFileSync(src, dest);
            console.log(`   ✅ Copied ${file}`);
            copiedCount++;
          }
        }
        
        console.log(`✅ Copied ${copiedCount} pack-worker files to _nuxt directory`);
      } else {
        console.warn('⚠️ browser-runtime/dist not found at', srcDir);
        console.warn('   Run `pnpm build --filter=@stark-o/browser-runtime` first');
      }
    }
  },
  
  app: {
    head: {
      title: 'Stark Orchestrator',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Isomorphic JavaScript orchestration platform' }
      ]
    }
  },
  
  // Vite configuration for browser compatibility
  vite: {
    plugins: [processPolyfillPlugin()],
    define: {
      // Static replacement at build time
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    optimizeDeps: {
      // Include packages that need pre-bundling
      include: ['@stark-o/browser-runtime'],
    },
  },
})
