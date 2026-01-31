# Nuxt Bundle Example

This example demonstrates how to build a Nuxt/Vue application into a **truly self-contained** JavaScript bundle with all assets inlined.

## Overview

The bundle exports a default async function as the entry point:

```javascript
module.exports.default = async function(context) {
  // Render or return HTML
  return { status: 'rendered' };
};
```

This example takes a full Nuxt application and builds it into a single `bundle.js` file that can be loaded and executed in different contexts, with **no external dependencies** - all images, fonts, CSS, and JavaScript are inlined.

## Features

- ✅ **Dynamic imports disabled** - All code in a single chunk
- ✅ **Assets inlined as base64** - Images, fonts, SVGs become data URIs
- ✅ **CSS fully embedded** - No external stylesheets
- ✅ **Self-contained HTML** - Everything in one string constant
- ✅ **Works offline** - No network requests needed after load

## Requirements for Bundleable Projects

For a project to be bundled properly into a self-contained pack, it must meet these requirements:

### 1. Package Manager: pnpm

The project must use **pnpm** as its package manager. The CLI runs `pnpm install` and `pnpm exec` commands.

### 2. Static Build Output

The project must be configured to generate **static HTML/JS/CSS output** (not SSR). The bundler looks for output in `.output/public/` with an `index.html` entry point.

### 3. Disable Dynamic Imports (Code Splitting)

Dynamic imports create separate chunk files that can't be inlined. All code must be bundled into a single file.

### 4. Inline Assets

Assets (images, fonts, SVGs) must be inlined as base64 data URIs rather than referenced as external files.

### 5. No External Runtime Dependencies

The bundle should not require external CDN resources, API calls during initialization, or server-side rendering.

---

## Nuxt Configuration Guide

Here's how to configure a Nuxt project for bundling:

### `nuxt.config.ts`

```typescript
export default defineNuxtConfig({
  // 1. Disable SSR - generate static client-side app
  ssr: false,
  
  // 2. Configure static output
  nitro: {
    preset: 'static',
    output: {
      publicDir: '.output/public'
    }
  },
  
  // 3. Configure Vite build settings
  vite: {
    build: {
      // Minify for smaller bundle
      minify: true,
      sourcemap: false,
      
      // Inline assets up to 100KB as base64 data URIs
      // Increase this limit for larger assets
      assetsInlineLimit: 100 * 1024, // 100KB
      
      rollupOptions: {
        output: {
          // CRITICAL: Disable code-splitting
          // This puts all code in a single chunk
          inlineDynamicImports: true,
          
          // Prevent manual chunk splitting
          manualChunks: undefined,
        },
      },
    },
  },
  
  // 4. Optional: Inline SSR styles if SSR is ever enabled
  experimental: {
    inlineSSRStyles: true,
  },
})
```

### Key Configuration Explained

| Setting | Purpose | Required |
|---------|---------|----------|
| `ssr: false` | Generates client-side only app | ✅ Yes |
| `nitro.preset: 'static'` | Outputs static files | ✅ Yes |
| `vite.build.assetsInlineLimit` | Inlines small assets as base64 | ✅ Yes |
| `rollupOptions.output.inlineDynamicImports` | Disables code-splitting | ✅ Yes |
| `rollupOptions.output.manualChunks: undefined` | Prevents chunk splitting | ✅ Yes |
| `vite.build.minify` | Reduces bundle size | Recommended |
| `vite.build.sourcemap: false` | Excludes sourcemaps | Recommended |

### Handling Large Assets

If you have assets larger than the inline limit:

1. **Increase the limit**: Set `assetsInlineLimit: 500 * 1024` for up to 500KB
2. **Optimize images**: Use WebP or compressed formats
3. **Use SVGs**: They compress well and scale perfectly
4. **Consider external hosting**: For very large assets, host externally and reference by URL

### Avoiding Common Issues

❌ **Don't use lazy-loaded components**:
```typescript
// Bad - creates separate chunks
const MyComponent = defineAsyncComponent(() => import('./MyComponent.vue'))

// Good - direct import
import MyComponent from './MyComponent.vue'
```

❌ **Don't use dynamic route imports**:
```typescript
// Bad - Nuxt's default behavior
// pages/[slug].vue with dynamic imports

// Good - disable route splitting or use static routes
```

❌ **Don't reference external URLs in CSS**:
```css
/* Bad - external font */
@import url('https://fonts.googleapis.com/css2?family=Roboto');

/* Good - inline font or use local files */
@font-face {
  font-family: 'Roboto';
  src: url('@/assets/fonts/Roboto.woff2') format('woff2');
}
```

---

## Project Structure

```
nuxt-pack/
├── app.vue              # Root Vue component
├── pages/
│   └── index.vue        # Main page with interactive demo
├── assets/
│   ├── images/          # Example images (logo.svg, icons)
│   └── css/             # Custom CSS with asset references
├── nuxt.config.ts       # Nuxt configuration
└── package.json         # Dependencies and scripts
```

## Building with the CLI

Use the Stark CLI to bundle this Nuxt project:

```bash
# From the repository root
node packages/cli/dist/index.js pack bundle ./examples/nuxt-pack --out ./bundle.js --name nuxt-pack-example
```

This will:
1. Run `pnpm install` to install dependencies
2. Run `nuxt generate` to build the static Vue app
3. Scan all assets (images, fonts, etc.)
4. Inline all JavaScript and CSS into the HTML
5. Convert asset references to base64 data URIs
6. Wrap everything in a CommonJS module

### CLI Options

| Option | Description |
|--------|-------------|
| `--out <path>` | Output bundle path (default: `./bundle.js`) |
| `-n, --name <name>` | Pack name for metadata |
| `--skip-install` | Skip pnpm install step |
| `--skip-build` | Skip nuxt generate step |

### Example with Options

```bash
# Skip install if dependencies are already installed
node packages/cli/dist/index.js pack bundle ./examples/nuxt-pack \
  --out ./my-bundle.js \
  --name my-nuxt-app \
  --skip-install
```

## Development

For local development without bundling:

```bash
cd examples/nuxt-pack
pnpm install
pnpm dev
```

## Output

The generated bundle exports:

```javascript
module.exports.default = async function(context) { ... }
module.exports.meta = { 
  name: 'nuxt-pack-example',
  bundleSizeKb: '123.45 KB',
  assetsInlined: true,
  ...
}
```

## How It Works

### 1. CLI Bundler

The CLI bundler (`pack bundle`) handles:

1. **Dependency Installation**: Runs `pnpm install` in the project
2. **Static Build**: Runs `nuxt generate` to create static output
3. **Asset Discovery**: Finds all images, fonts, etc. in `.output/public/_nuxt/`
4. **Base64 Conversion**: Converts each asset to a data URI
5. **CSS Inlining**: Replaces `url()` references with data URIs
6. **JS Inlining**: Replaces asset path strings with data URIs
7. **HTML Bundling**: Combines everything into a single HTML string
8. **Module Wrapping**: Exports as CommonJS with metadata

### 2. Execution

When the bundle runs:
- **In a DOM context**: Writes the HTML to the document
- **In a worker context**: Returns the HTML content

## Metadata

The bundle exports comprehensive metadata:

```javascript
module.exports.meta = {
  name: 'nuxt-pack-example',
  version: '0.0.1',
  framework: 'nuxt',
  requiresDOM: true,
  bundleSize: 123456,
  bundleSizeKb: '123.45 KB',
  assetsInlined: true,
  generatedAt: '2026-01-31T12:00:00.000Z'
};
```

## Customizing

To create your own bundled Nuxt app:

1. Copy this example
2. Modify the Vue components in `pages/` and `app.vue`
3. Add assets to the `assets/` folder
4. Ensure `nuxt.config.ts` has the required settings (see above)
5. Run the CLI bundle command

## Notes

- The bundle uses CommonJS format (`module.exports`) for broad compatibility
- All assets are inlined to create a single self-contained file
- The bundle requires DOM access to render the Vue app interactively
- Maximum recommended bundle size is ~5MB for reasonable load times

---

## Iframe Sandbox Compatibility

The bundle renders inside an iframe using the `srcdoc` attribute. This creates a sandboxed environment with some browser restrictions that require special handling.

### Issues Solved

| Issue | Cause | Solution |
|-------|-------|----------|
| `SecurityError: replaceState` | History API doesn't work in `about:srcdoc` origin | History API shim wraps calls in try/catch |
| `Page not found: /srcdoc` | Vue Router reads `location.pathname` as `/srcdoc` | Use hash-based routing (`/#/`) |
| `404 /_nuxt/builds/meta/*.json` | Nuxt tries to fetch app manifest | Disable `experimental.appManifest` |

### Required Nuxt Configuration

For iframe compatibility, your `nuxt.config.ts` must include:

```typescript
export default defineNuxtConfig({
  // ... other config ...

  // Use hash-based routing for iframe/srcdoc compatibility
  // This avoids relying on location.pathname which breaks in about:srcdoc
  router: {
    options: {
      hashMode: true
    }
  },

  // Disable app manifest to prevent 404 fetches in bundled mode
  experimental: {
    appManifest: false
  },
})
```

### Automatic Shims

The bundler automatically injects compatibility shims into the HTML `<head>`:

1. **History API Shim** - Wraps `pushState` and `replaceState` in try/catch to silently handle `SecurityError`
2. **Fetch Shim** - Intercepts requests to `/_nuxt/builds/` and returns empty JSON to prevent 404 errors

These shims run before any application code, ensuring Vue Router and Nuxt initialize without errors.

### Why srcdoc?

The bundle uses `iframe.srcdoc` instead of blob URLs because:

- **Same-origin friendly** - Works better with parent page communication
- **No URL cleanup needed** - No `URL.revokeObjectURL()` required
- **Simpler security model** - Predictable `about:srcdoc` origin

### Limitations

- **No real navigation** - Hash changes work but actual page navigation is sandboxed
- **No history persistence** - Browser back/forward buttons don't work inside the iframe
- **Console warnings** - Some History API warnings may still appear (but don't break functionality)
