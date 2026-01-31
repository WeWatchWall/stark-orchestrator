/**
 * Build script that takes the Nuxt static output and wraps it into a
 * self-contained JavaScript module.
 * 
 * This creates a bundle that:
 * 1. Exports a default async function as the entry point
 * 2. When executed in a DOM context, renders the app directly
 * 3. When executed in a worker context, returns the HTML content
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const outputDir = join(projectRoot, '.output', 'public');
const packOutputDir = join(projectRoot, 'dist');

console.log('📦 Building entry point...\n');

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

// Create the entry point wrapper
const packEntryPoint = `// Nuxt App Bundle - Auto-generated entry point
// Self-contained Nuxt/Vue application module

const HTML_CONTENT = ${JSON.stringify(indexHtml)};

module.exports.default = async function(context = {}) {
  // If running in a browser context with DOM access
  if (typeof document !== 'undefined') {
    // Render the app into the page
    document.open();
    document.write(HTML_CONTENT);
    document.close();
    
    return { status: 'rendered' };
  }
  
  // If running in a worker or headless context, return the HTML
  return {
    html: HTML_CONTENT,
    contentType: 'text/html'
  };
};

// Export metadata about this bundle
module.exports.meta = {
  name: 'nuxt-pack-example',
  version: '0.0.1',
  framework: 'nuxt',
  requiresDOM: true
};
`;

// Write the entry point
const packOutputPath = join(packOutputDir, 'pack.js');
writeFileSync(packOutputPath, packEntryPoint);
console.log(`\n✅ Entry point written to: dist/pack.js`);

// Also create a test HTML page that loads the bundle
const testHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Bundle Test Page</title>
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
    #output {
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
  <div id="app-container">
    <!-- App will render here -->
  </div>
  
  <div class="test-controls">
    <h3>🧪 Test Controls</h3>
    <button onclick="loadApp()">Load App</button>
    <button onclick="location.reload()">Reload</button>
    <div id="output">Ready to load...</div>
  </div>

  <script type="module">
    import * as bundle from './pack.js';
    
    window.loadApp = async function() {
      const output = document.getElementById('output');
      output.textContent = 'Loading...';
      
      try {
        const result = await bundle.default();
        output.textContent = 'Loaded! Result: ' + JSON.stringify(result, null, 2);
        console.log('Result:', result);
      } catch (error) {
        output.textContent = 'Error: ' + error.message;
        console.error('Error:', error);
      }
    };
    
    // Show metadata
    if (bundle.meta) {
      console.log('Bundle metadata:', bundle.meta);
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
console.log('To test the bundle:');
console.log('  1. cd dist');
console.log('  2. npx serve .');
console.log('  3. Open http://localhost:3000/test.html');
console.log('\nEntry point: dist/pack.js');
