/**
 * Build script that takes the Nuxt static output and wraps it into a
 * self-contained JavaScript module.
 * 
 * This creates a bundle that:
 * 1. Exports a default async function as the entry point
 * 2. When executed in a DOM context, renders the app directly
 * 3. When executed in a worker context, returns the HTML content
 * 4. Inlines all assets (images, fonts) as base64 data URIs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync, statSync } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const outputDir = join(projectRoot, '.output', 'public');
const packOutputDir = join(projectRoot, 'dist');

console.log('📦 Building entry point...\n');

// MIME type mapping for common asset types
const MIME_TYPES = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
};

/**
 * Get MIME type for a file based on its extension
 */
function getMimeType(filePath) {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Convert a file to a base64 data URI
 */
function fileToDataUri(filePath) {
  const content = readFileSync(filePath);
  const mimeType = getMimeType(filePath);
  return `data:${mimeType};base64,${content.toString('base64')}`;
}

/**
 * Recursively find all files in a directory
 */
function findAllFiles(dir, files = []) {
  if (!existsSync(dir)) return files;
  
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      findAllFiles(fullPath, files);
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Build a map of asset paths to their data URIs
 */
function buildAssetMap(nuxtDir) {
  const assetMap = new Map();
  const allFiles = findAllFiles(nuxtDir);
  
  for (const filePath of allFiles) {
    const ext = extname(filePath).toLowerCase();
    // Skip JS and CSS files (handled separately)
    if (ext === '.js' || ext === '.css') continue;
    
    // Check if it's a known asset type
    if (MIME_TYPES[ext]) {
      const relativePath = filePath.replace(nuxtDir, '').replace(/\\/g, '/');
      const dataUri = fileToDataUri(filePath);
      assetMap.set(relativePath, dataUri);
      
      // Also map with _nuxt prefix for URL references
      assetMap.set(`/_nuxt${relativePath}`, dataUri);
      assetMap.set(`_nuxt${relativePath}`, dataUri);
    }
  }
  
  return assetMap;
}

/**
 * Replace asset URLs in CSS content with data URIs
 */
function inlineAssetsInCss(css, assetMap) {
  // Match url() references
  return css.replace(/url\(["']?([^"')]+)["']?\)/g, (match, url) => {
    // Skip data URIs and external URLs
    if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) {
      return match;
    }
    
    // Try to find the asset in our map
    for (const [path, dataUri] of assetMap) {
      if (url.includes(basename(path)) || url.endsWith(path) || path.endsWith(url.replace(/^\.?\/?/, ''))) {
        console.log(`  ✓ Inlined CSS asset: ${basename(path)}`);
        return `url(${dataUri})`;
      }
    }
    
    console.log(`  ⚠ Could not find asset for: ${url}`);
    return match;
  });
}

/**
 * Replace asset URLs in HTML content with data URIs
 */
function inlineAssetsInHtml(html, assetMap) {
  // Match src and href attributes pointing to _nuxt assets
  return html
    .replace(/(src|href)=["']([^"']*_nuxt[^"']*)["']/g, (match, attr, url) => {
      for (const [path, dataUri] of assetMap) {
        if (url.includes(basename(path)) || url.endsWith(path)) {
          console.log(`  ✓ Inlined HTML asset: ${basename(path)}`);
          return `${attr}="${dataUri}"`;
        }
      }
      return match;
    });
}

/**
 * Replace asset URLs in JS content with data URIs
 */
function inlineAssetsInJs(js, assetMap) {
  // Match string literals containing asset paths
  let result = js;
  
  for (const [path, dataUri] of assetMap) {
    const filename = basename(path);
    // Look for the asset filename in the JS (usually as part of a path string)
    const patterns = [
      new RegExp(`"[^"]*${escapeRegExp(filename)}[^"]*"`, 'g'),
      new RegExp(`'[^']*${escapeRegExp(filename)}[^']*'`, 'g'),
    ];
    
    for (const pattern of patterns) {
      const matches = result.match(pattern);
      if (matches) {
        for (const match of matches) {
          // Only replace if it looks like a path reference
          if (match.includes('_nuxt') || match.includes('/assets/') || match.includes('./')) {
            console.log(`  ✓ Inlined JS asset: ${filename}`);
            result = result.replace(match, `"${dataUri}"`);
          }
        }
      }
    }
  }
  
  return result;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
  // Build asset map for inlining images, fonts, etc.
  console.log('\n🔍 Scanning for assets to inline...');
  const assetMap = buildAssetMap(nuxtDir);
  console.log(`Found ${assetMap.size / 3} unique assets to inline`); // Divided by 3 due to multiple path variants
  
  const jsFiles = readdirSync(nuxtDir).filter(f => f.endsWith('.js'));
  
  console.log(`\n📄 Found ${jsFiles.length} JavaScript files to inline:`);
  jsFiles.forEach(f => console.log(`  - ${f}`));
  
  // Read all JS content and inline it
  let allJs = '';
  for (const jsFile of jsFiles) {
    const jsPath = join(nuxtDir, jsFile);
    let jsContent = readFileSync(jsPath, 'utf-8');
    allJs += jsContent + '\n';
  }
  
  // Find all CSS files and inline them
  const cssFiles = readdirSync(nuxtDir).filter(f => f.endsWith('.css'));
  let allCss = '';
  for (const cssFile of cssFiles) {
    const cssPath = join(nuxtDir, cssFile);
    let cssContent = readFileSync(cssPath, 'utf-8');
    allCss += cssContent + '\n';
  }
  
  console.log(`📄 Found ${cssFiles.length} CSS files to inline`);
  
  // Inline assets in CSS
  if (allCss && assetMap.size > 0) {
    console.log('\n🎨 Inlining assets in CSS...');
    allCss = inlineAssetsInCss(allCss, assetMap);
  }
  
  // Inline assets in JS (for dynamic imports of images, etc.)
  if (allJs && assetMap.size > 0) {
    console.log('\n📦 Inlining assets in JavaScript...');
    allJs = inlineAssetsInJs(allJs, assetMap);
  }
  
  // Create a self-contained HTML with inlined resources
  // Remove external script/link references and inject inline versions
  indexHtml = indexHtml
    // Remove external script tags referencing _nuxt
    .replace(/<script[^>]*src="[^"]*_nuxt[^"]*"[^>]*><\/script>/g, '')
    .replace(/<link[^>]*href="[^"]*_nuxt[^"]*\.css"[^>]*>/g, '')
    // Remove modulepreload links
    .replace(/<link[^>]*rel="modulepreload"[^>]*>/g, '');
  
  // Inline assets in HTML (for img src, etc.)
  if (assetMap.size > 0) {
    console.log('\n🌐 Inlining assets in HTML...');
    indexHtml = inlineAssetsInHtml(indexHtml, assetMap);
  }
  
  // Inject inline CSS in head
  if (allCss) {
    indexHtml = indexHtml.replace('</head>', `<style>${allCss}</style></head>`);
  }
  
  // Inject inline JS before closing body
  if (allJs) {
    indexHtml = indexHtml.replace('</body>', `<script type="module">${allJs}</script></body>`);
  }
}

// Calculate bundle size
const bundleSize = Buffer.byteLength(indexHtml, 'utf-8');
const bundleSizeKb = (bundleSize / 1024).toFixed(2);

// Create the entry point wrapper
const packEntryPoint = `// Nuxt App Bundle - Auto-generated entry point
// Self-contained Nuxt/Vue application module
// Bundle size: ${bundleSizeKb} KB (uncompressed)
// Generated: ${new Date().toISOString()}

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
  requiresDOM: true,
  bundleSize: ${bundleSize},
  bundleSizeKb: '${bundleSizeKb} KB',
  assetsInlined: true,
  dynamicImportsDisabled: true,
  generatedAt: '${new Date().toISOString()}'
};
`;

// Write the entry point
const packOutputPath = join(packOutputDir, 'pack.js');
writeFileSync(packOutputPath, packEntryPoint);
console.log(`\n✅ Entry point written to: dist/pack.js`);
console.log(`   Bundle size: ${bundleSizeKb} KB (uncompressed)`);

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
