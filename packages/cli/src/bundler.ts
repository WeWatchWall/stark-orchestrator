/**
 * Bundler Module
 *
 * Bundles Nuxt/web projects into self-contained CommonJS modules
 * by inlining all assets, JS, and CSS.
 *
 * @module @stark-o/cli/bundler
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { info } from './output.js';

/**
 * MIME type mapping for common asset types
 */
const MIME_TYPES: Record<string, string> = {
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
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Convert a file to a base64 data URI
 */
function fileToDataUri(filePath: string): string {
  const content = fs.readFileSync(filePath);
  const mimeType = getMimeType(filePath);
  return `data:${mimeType};base64,${content.toString('base64')}`;
}

/**
 * Recursively find all files in a directory
 */
function findAllFiles(dir: string, files: string[] = []): string[] {
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      findAllFiles(fullPath, files);
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a map of asset paths to their data URIs
 */
function buildAssetMap(nuxtDir: string): Map<string, string> {
  const assetMap = new Map<string, string>();
  const allFiles = findAllFiles(nuxtDir);

  for (const filePath of allFiles) {
    const ext = path.extname(filePath).toLowerCase();
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
function inlineAssetsInCss(css: string, assetMap: Map<string, string>): string {
  return css.replace(/url\(["']?([^"')]+)["']?\)/g, (match, url: string) => {
    // Skip data URIs and external URLs
    if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) {
      return match;
    }

    // Try to find the asset in our map
    for (const [assetPath, dataUri] of assetMap) {
      const basename = path.basename(assetPath);
      if (url.includes(basename) || url.endsWith(assetPath) || assetPath.endsWith(url.replace(/^\.?\/?/, ''))) {
        return `url(${dataUri})`;
      }
    }

    return match;
  });
}

/**
 * Replace asset URLs in HTML content with data URIs
 */
function inlineAssetsInHtml(html: string, assetMap: Map<string, string>): string {
  return html.replace(/(src|href)=["']([^"']*_nuxt[^"']*)["']/g, (match, attr: string, url: string) => {
    for (const [assetPath, dataUri] of assetMap) {
      const basename = path.basename(assetPath);
      if (url.includes(basename) || url.endsWith(assetPath)) {
        return `${attr}="${dataUri}"`;
      }
    }
    return match;
  });
}

/**
 * Replace asset URLs in JS content with data URIs
 */
function inlineAssetsInJs(js: string, assetMap: Map<string, string>): string {
  let result = js;

  for (const [assetPath, dataUri] of assetMap) {
    const filename = path.basename(assetPath);
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
            result = result.replace(match, `"${dataUri}"`);
          }
        }
      }
    }
  }

  return result;
}

export interface BundleOptions {
  /** Project source directory */
  sourceDir: string;
  /** Output bundle file path */
  outputPath: string;
  /** Pack name for metadata */
  packName: string;
  /** Pack version for metadata */
  version?: string;
  /** Skip install step */
  skipInstall?: boolean;
  /** Skip build step */
  skipBuild?: boolean;
}

export interface BundleResult {
  success: boolean;
  outputPath: string;
  bundleSize: number;
  bundleSizeKb: string;
  error?: string;
}

/**
 * Detects if a directory is a Nuxt project
 */
export function isNuxtProject(dir: string): boolean {
  const nuxtConfigFiles = ['nuxt.config.ts', 'nuxt.config.js'];
  return nuxtConfigFiles.some((f) => fs.existsSync(path.join(dir, f)));
}

/**
 * Bundles a Nuxt project into a self-contained CommonJS module
 */
export async function bundleNuxtProject(options: BundleOptions): Promise<BundleResult> {
  const { sourceDir, outputPath, packName, version = '0.0.1' } = options;

  // Ensure source directory exists
  if (!fs.existsSync(sourceDir)) {
    return {
      success: false,
      outputPath,
      bundleSize: 0,
      bundleSizeKb: '0',
      error: `Source directory not found: ${sourceDir}`,
    };
  }

  // Check if it's a Nuxt project
  if (!isNuxtProject(sourceDir)) {
    return {
      success: false,
      outputPath,
      bundleSize: 0,
      bundleSizeKb: '0',
      error: 'Not a Nuxt project (nuxt.config.ts/js not found)',
    };
  }

  try {
    // Step 1: Install dependencies
    if (!options.skipInstall) {
      info('Installing dependencies...');
      execSync('pnpm install', {
        cwd: sourceDir,
        stdio: 'inherit',
      });
    }

    // Step 2: Build the project (nuxt generate for static output)
    if (!options.skipBuild) {
      info('Building project...');
      execSync('pnpm exec nuxt generate', {
        cwd: sourceDir,
        stdio: 'inherit',
      });
    }

    // Step 3: Locate output directory
    const outputDir = path.join(sourceDir, '.output', 'public');
    if (!fs.existsSync(outputDir)) {
      return {
        success: false,
        outputPath,
        bundleSize: 0,
        bundleSizeKb: '0',
        error: 'Build output not found at .output/public',
      };
    }

    // Step 4: Read index.html
    const indexHtmlPath = path.join(outputDir, 'index.html');
    if (!fs.existsSync(indexHtmlPath)) {
      return {
        success: false,
        outputPath,
        bundleSize: 0,
        bundleSizeKb: '0',
        error: 'index.html not found in build output',
      };
    }

    let indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');

    // Step 5: Process _nuxt directory for assets
    const nuxtDir = path.join(outputDir, '_nuxt');
    if (fs.existsSync(nuxtDir)) {
      info('Scanning for assets to inline...');
      const assetMap = buildAssetMap(nuxtDir);
      info(`Found ${Math.floor(assetMap.size / 3)} unique assets to inline`);

      // Collect all JS files
      const jsFiles = fs.readdirSync(nuxtDir).filter((f) => f.endsWith('.js'));
      info(`Found ${jsFiles.length} JavaScript files to inline`);

      let allJs = '';
      for (const jsFile of jsFiles) {
        const jsPath = path.join(nuxtDir, jsFile);
        const jsContent = fs.readFileSync(jsPath, 'utf-8');
        allJs += jsContent + '\n';
      }

      // Collect all CSS files
      const cssFiles = fs.readdirSync(nuxtDir).filter((f) => f.endsWith('.css'));
      info(`Found ${cssFiles.length} CSS files to inline`);

      let allCss = '';
      for (const cssFile of cssFiles) {
        const cssPath = path.join(nuxtDir, cssFile);
        const cssContent = fs.readFileSync(cssPath, 'utf-8');
        allCss += cssContent + '\n';
      }

      // Inline assets in CSS
      if (allCss && assetMap.size > 0) {
        info('Inlining assets in CSS...');
        allCss = inlineAssetsInCss(allCss, assetMap);
      }

      // Inline assets in JS
      if (allJs && assetMap.size > 0) {
        info('Inlining assets in JavaScript...');
        allJs = inlineAssetsInJs(allJs, assetMap);
      }

      // Remove external references from HTML by filtering out matching lines
      // Using line-based filtering instead of regex replacement to ensure complete sanitization
      indexHtml = indexHtml
        .split('\n')
        .filter(line => {
          const trimmed = line.trim();
          // Remove script tags referencing _nuxt bundles
          if (trimmed.startsWith('<script') && trimmed.includes('_nuxt') && trimmed.includes('src=')) return false;
          // Remove CSS link tags referencing _nuxt stylesheets
          if (trimmed.startsWith('<link') && trimmed.includes('_nuxt') && trimmed.includes('.css')) return false;
          // Remove modulepreload link tags
          if (trimmed.startsWith('<link') && trimmed.includes('rel="modulepreload"')) return false;
          return true;
        })
        .join('\n');

      // Inline assets in HTML
      if (assetMap.size > 0) {
        info('Inlining assets in HTML...');
        indexHtml = inlineAssetsInHtml(indexHtml, assetMap);
      }

      // Inject iframe sandbox compatibility shims
      // This must come before any other scripts to:
      // 1. Stub History API to prevent SecurityErrors in srcdoc iframes
      // 2. Stub fetch for manifest requests that would 404 in bundled mode
      // 3. Report content height to parent for auto-sizing
      const sandboxShim = `<script>
(function() {
  // Stub History API - wrap in try/catch for srcdoc SecurityErrors
  var origPushState = history.pushState;
  var origReplaceState = history.replaceState;
  history.pushState = function(state, title, url) {
    try { origPushState.call(history, state, title, url); } catch(e) {}
  };
  history.replaceState = function(state, title, url) {
    try { origReplaceState.call(history, state, title, url); } catch(e) {}
  };
  
  // Stub fetch for manifest requests that will 404 in bundled mode
  var origFetch = window.fetch;
  window.fetch = function(url, opts) {
    if (typeof url === 'string' && url.includes('/_nuxt/builds/')) {
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return origFetch.apply(this, arguments);
  };
  
  // Auto-resize: Report content dimensions to parent window
  var lastHeight = 0;
  function reportSize() {
    // Temporarily set html/body to auto height to get true content height
    var html = document.documentElement;
    var body = document.body;
    var origHtmlHeight = html.style.height;
    var origBodyHeight = body.style.height;
    html.style.height = 'auto';
    body.style.height = 'auto';
    
    var height = Math.max(
      body.scrollHeight,
      body.offsetHeight
    );
    
    // Restore original styles
    html.style.height = origHtmlHeight;
    body.style.height = origBodyHeight;
    
    var width = Math.max(
      body.scrollWidth,
      body.offsetWidth,
      html.scrollWidth,
      html.offsetWidth
    );
    
    // Only post if height actually changed
    if (height !== lastHeight) {
      lastHeight = height;
      parent.postMessage({ type: 'stark-pack-resize', height: height, width: width }, '*');
    }
  }
  // Reset scroll on window resize (container size changed)
  window.addEventListener('resize', function() {
    window.scrollTo(0, 0);
    reportSize();
  });
  // Report size on load, mutations, and resize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reportSize);
  } else {
    reportSize();
  }
  window.addEventListener('load', reportSize);
  window.addEventListener('resize', reportSize);
  // Observe DOM changes
  var observer = new MutationObserver(function() { setTimeout(reportSize, 50); });
  document.addEventListener('DOMContentLoaded', function() {
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  });
  // Periodic check for dynamic content
  setInterval(reportSize, 500);
})();
</script>`;
      indexHtml = indexHtml.replace('<head>', `<head>${sandboxShim}`);

      // Inject inline CSS in head
      // Note: We use a function replacement to avoid special $& patterns being interpreted
      if (allCss) {
        indexHtml = indexHtml.replace('</head>', () => `<style>${allCss}</style></head>`);
      }

      // Inject inline JS before closing body
      // Note: We use a function replacement to avoid special $& patterns in allJs
      // being interpreted as replacement patterns by String.replace()
      if (allJs) {
        indexHtml = indexHtml.replace('</body>', () => `<script type="module">${allJs}</script></body>`);
      }
    }

    // Step 6: Calculate bundle size
    const bundleSize = Buffer.byteLength(indexHtml, 'utf-8');
    const bundleSizeKb = (bundleSize / 1024).toFixed(2);

    // Step 7: Create CommonJS module wrapper
    const sanitizedPackName = packName.replace(/[^a-zA-Z0-9-_]/g, '-');
    const defaultContainerId = `stark-pack-${sanitizedPackName}`;
    const generatedAt = new Date().toISOString();
    const htmlContentStr = JSON.stringify(indexHtml);
    
    const packBundle = `// Pack Bundle - Auto-generated
// Self-contained application module
// Bundle size: ${bundleSizeKb} KB (uncompressed)
// Generated: ${generatedAt}

const HTML_CONTENT = ${htmlContentStr};
const DEFAULT_CONTAINER_ID = ${JSON.stringify(defaultContainerId)};

module.exports.default = async function(context) {
  context = context || {};
  if (typeof document !== 'undefined') {
    var containerId = context.containerId || DEFAULT_CONTAINER_ID;
    var container = document.getElementById(containerId);
    if (!container) {
      container = document.createElement('div');
      container.id = containerId;
      document.body.appendChild(container);
    }
    var iframe = document.createElement('iframe');
    iframe.id = containerId + '-frame';
    iframe.style.cssText = 'width:100%;border:none;display:block;min-height:100px;';
    if (context.style) { Object.assign(iframe.style, context.style); }
    container.innerHTML = '';
    container.appendChild(iframe);
    
    // Listen for size updates from iframe content
    var frameId = containerId + '-frame';
    window.addEventListener('message', function(e) {
      if (e.data && e.data.type === 'stark-pack-resize') {
        var frame = document.getElementById(frameId);
        if (frame) {
          if (e.data.height) frame.style.height = e.data.height + 'px';
        }
      }
    });
    
    iframe.srcdoc = HTML_CONTENT;
    return new Promise(function(resolve) {
      iframe.onload = function() {
        resolve({ status: 'rendered', containerId: containerId, frameId: frameId });
      };
      setTimeout(function() { resolve({ status: 'rendered', containerId: containerId, frameId: frameId }); }, 2000);
    });
  }
  return { html: HTML_CONTENT, contentType: 'text/html', defaultContainerId: DEFAULT_CONTAINER_ID };
};

module.exports.meta = {
  name: ${JSON.stringify(packName)},
  version: ${JSON.stringify(version)},
  framework: 'nuxt',
  requiresDOM: true,
  bundleSize: ${bundleSize},
  bundleSizeKb: '${bundleSizeKb} KB',
  assetsInlined: true,
  generatedAt: '${generatedAt}',
  defaultContainerId: ${JSON.stringify(defaultContainerId)}
};
`;

    // Step 8: Ensure output directory exists and write bundle
    const outputDirPath = path.dirname(outputPath);
    if (!fs.existsSync(outputDirPath)) {
      fs.mkdirSync(outputDirPath, { recursive: true });
    }

    fs.writeFileSync(outputPath, packBundle);

    return {
      success: true,
      outputPath,
      bundleSize,
      bundleSizeKb,
    };
  } catch (err) {
    return {
      success: false,
      outputPath,
      bundleSize: 0,
      bundleSizeKb: '0',
      error: err instanceof Error ? err.message : 'Unknown error during bundling',
    };
  }
}

/**
 * Simple bundler that copies a file (for non-Nuxt projects)
 */
export async function bundleSimple(options: BundleOptions): Promise<BundleResult> {
  const { sourceDir, outputPath } = options;

  try {
    const stats = fs.statSync(sourceDir);

    if (stats.isFile()) {
      fs.copyFileSync(sourceDir, outputPath);
    } else if (stats.isDirectory()) {
      // Look for index.js or index.ts
      const indexFile = ['index.js', 'index.ts', 'main.js', 'main.ts']
        .map((f) => path.join(sourceDir, f))
        .find((f) => fs.existsSync(f));

      if (!indexFile) {
        return {
          success: false,
          outputPath,
          bundleSize: 0,
          bundleSizeKb: '0',
          error: 'Could not find entry point (index.js, index.ts, main.js, or main.ts)',
        };
      }

      fs.copyFileSync(indexFile, outputPath);
    }

    const bundleSize = fs.statSync(outputPath).size;
    const bundleSizeKb = (bundleSize / 1024).toFixed(2);

    return {
      success: true,
      outputPath,
      bundleSize,
      bundleSizeKb,
    };
  } catch (err) {
    return {
      success: false,
      outputPath,
      bundleSize: 0,
      bundleSizeKb: '0',
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
