/**
 * Build script that takes the Nuxt static output and wraps it into a
 * CommonJS pack entry point compatible with Stark Orchestrator.
 * 
 * This creates a bundle that:
 * 1. Exports a default async function (the pack entry point)
 * 2. When executed, serves the Vue app or returns its HTML
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const outputDir = join(projectRoot, '.output', 'public');
const packOutputDir = join(projectRoot, 'dist');

console.log('📦 Building pack entry point...\n');

// Ensure output directory exists
if (!existsSync(packOutputDir)) {
  mkdirSync(packOutputDir, { recursive: true });
}

// Read the generated index.html
const indexHtmlPath = join(outputDir, 'index.html');
if (!existsSync(indexHtmlPath)) {
  console.error('❌ Error: index.html not found. Run "nuxt generate" first.');
  process.exit(1);
}

let indexHtml = readFileSync(indexHtmlPath, 'utf-8');

// Find and inline all JavaScript files
const nuxtDir = join(outputDir, '_nuxt');
if (existsSync(nuxtDir)) {
  const jsFiles = readdirSync(nuxtDir).filter(f => f.endsWith('.js'));
  
  console.log(`Found ${jsFiles.length} JavaScript files to inline:`);
  jsFiles.forEach(f => console.log(`  - ${f}`));
  
  // Read all JS content and inline it
  let allJs = '';
  for (const jsFile of jsFiles) {
    const jsPath = join(nuxtDir, jsFile);
    const jsContent = readFileSync(jsPath, 'utf-8');
    allJs += jsContent + '\n';
  }
  
  // Find all CSS files and inline them
  const cssFiles = readdirSync(nuxtDir).filter(f => f.endsWith('.css'));
  let allCss = '';
  for (const cssFile of cssFiles) {
    const cssPath = join(nuxtDir, cssFile);
    const cssContent = readFileSync(cssPath, 'utf-8');
    allCss += cssContent + '\n';
  }
  
  console.log(`Found ${cssFiles.length} CSS files to inline`);
  
  // Create a self-contained HTML with inlined resources
  // Remove external script/link references and inject inline versions
  indexHtml = indexHtml
    // Remove external script tags referencing _nuxt
    .replace(/<script[^>]*src="[^"]*_nuxt[^"]*"[^>]*><\/script>/g, '')
    .replace(/<link[^>]*href="[^"]*_nuxt[^"]*\.css"[^>]*>/g, '')
    // Remove modulepreload links
    .replace(/<link[^>]*rel="modulepreload"[^>]*>/g, '');
  
  // Inject inline CSS in head
  if (allCss) {
    indexHtml = indexHtml.replace('</head>', `<style>${allCss}</style></head>`);
  }
  
  // Inject inline JS before closing body
  if (allJs) {
    indexHtml = indexHtml.replace('</body>', `<script type="module">${allJs}</script></body>`);
  }
}

// Create the pack entry point wrapper
const packEntryPoint = `// Nuxt Pack - Auto-generated entry point for Stark Orchestrator
// This pack serves a pre-built Nuxt/Vue application
// Uses CommonJS format for compatibility with the pack executor

const HTML_CONTENT = ${JSON.stringify(indexHtml)};

module.exports.default = async function(context) {
  // Pack metadata
  const packInfo = {
    name: 'nuxt-pack-example',
    version: '0.0.1',
    type: 'nuxt-app',
    description: 'A Nuxt app built as a Stark Orchestrator pack'
  };
  
  // If running in a browser context with DOM access
  if (typeof document !== 'undefined') {
    // Inject the Vue app into the page
    document.open();
    document.write(HTML_CONTENT);
    document.close();
    
    return {
      status: 'rendered',
      pack: packInfo
    };
  }
  
  // If running in a worker or Node.js context, return the HTML
  return {
    html: HTML_CONTENT,
    contentType: 'text/html',
    pack: packInfo
  };
};

// Export pack metadata for the orchestrator
module.exports.packMeta = {
  name: 'nuxt-pack-example',
  version: '0.0.1',
  entryType: 'html-app',
  framework: 'nuxt',
  runtimeRequirements: ['dom'] // Indicates this pack needs DOM access
};
`;

// Write the pack entry point
const packOutputPath = join(packOutputDir, 'pack.js');
writeFileSync(packOutputPath, packEntryPoint);
console.log(`\n✅ Pack entry point written to: dist/pack.js`);

// Also create a test HTML page that loads the pack
const testHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pack Test Page</title>
  <style>
    body {
      margin: 0;
      font-family: system-ui, sans-serif;
    }
    .test-controls {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #1a1a2e;
      color: white;
      padding: 1rem;
      border-radius: 8px;
      z-index: 9999;
      font-size: 0.85rem;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .test-controls h3 {
      margin: 0 0 0.5rem 0;
      font-size: 0.9rem;
    }
    .test-controls button {
      background: #667eea;
      color: white;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 4px;
      cursor: pointer;
      margin-right: 0.5rem;
    }
    .test-controls button:hover {
      background: #764ba2;
    }
    #pack-output {
      margin-top: 0.5rem;
      padding: 0.5rem;
      background: rgba(255,255,255,0.1);
      border-radius: 4px;
      max-height: 100px;
      overflow: auto;
      font-family: monospace;
      font-size: 0.75rem;
    }
  </style>
</head>
<body>
  <div id="pack-container">
    <!-- Pack will render here -->
  </div>
  
  <div class="test-controls">
    <h3>📦 Pack Test Controls</h3>
    <button onclick="loadPack()">Load Pack</button>
    <button onclick="reloadPack()">Reload</button>
    <div id="pack-output">Ready to load pack...</div>
  </div>

  <script type="module">
    // Import the pack
    import * as pack from './pack.js';
    
    window.loadPack = async function() {
      const output = document.getElementById('pack-output');
      output.textContent = 'Loading pack...';
      
      try {
        // Call the pack's default function
        const result = await pack.default({
          // Simulated context from orchestrator
          podName: 'test-pod',
          nodeName: 'test-node'
        });
        
        output.textContent = 'Pack loaded! Result: ' + JSON.stringify(result, null, 2);
        console.log('Pack result:', result);
      } catch (error) {
        output.textContent = 'Error: ' + error.message;
        console.error('Pack error:', error);
      }
    };
    
    window.reloadPack = function() {
      window.location.reload();
    };
    
    // Show pack metadata
    if (pack.packMeta) {
      console.log('Pack metadata:', pack.packMeta);
    }
  </script>
</body>
</html>
`;

const testHtmlPath = join(packOutputDir, 'test.html');
writeFileSync(testHtmlPath, testHtml);
console.log(`✅ Test page written to: dist/test.html`);

// Copy original assets for reference
const assetsDir = join(packOutputDir, 'assets');
if (!existsSync(assetsDir)) {
  mkdirSync(assetsDir, { recursive: true });
}

// Copy the original HTML for comparison
copyFileSync(indexHtmlPath, join(assetsDir, 'original-index.html'));
console.log(`✅ Original HTML copied to: dist/assets/original-index.html`);

console.log('\n🎉 Build complete!\n');
console.log('To test the pack:');
console.log('  1. cd dist');
console.log('  2. npx serve .');
console.log('  3. Open http://localhost:3000/test.html');
console.log('\nPack entry point: dist/pack.js');
