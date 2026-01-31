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

This example takes a full Nuxt application and builds it into a single `pack.js` file that can be loaded and executed in different contexts, with **no external dependencies** - all images, fonts, CSS, and JavaScript are inlined.

## Features

- ✅ **Dynamic imports disabled** - All code in a single chunk
- ✅ **Assets inlined as base64** - Images, fonts, SVGs become data URIs
- ✅ **CSS fully embedded** - No external stylesheets
- ✅ **Self-contained HTML** - Everything in one string constant
- ✅ **Works offline** - No network requests needed after load

## Project Structure

```
nuxt-pack/
├── app.vue              # Root Vue component
├── pages/
│   └── index.vue        # Main page with interactive demo
├── assets/
│   ├── images/          # Example images (logo.svg, icons)
│   └── css/             # Custom CSS with asset references
├── scripts/
│   └── build-pack.mjs   # Post-build script to create bundle entry point
├── nuxt.config.ts       # Nuxt configuration
├── package.json         # Dependencies and scripts
└── dist/                # Output directory (after build)
    ├── pack.js          # The bundle entry point
    ├── test.html        # Test page to verify the bundle
    └── assets/          # Original build assets
```

## Installation

```bash
cd examples/nuxt-pack
pnpm install
```

## Building

```bash
pnpm build
```

This will:
1. Run `nuxt generate` to build the static Vue app
2. Run the build script to:
   - Scan all assets (images, fonts, etc.)
   - Inline all JavaScript and CSS into the HTML
   - Convert asset references to base64 data URIs
   - Wrap everything in a CommonJS module entry point
   - Generate a test page

## Output

After building, the `dist/` folder will contain:

- **`pack.js`** - The bundle entry point that exports:
  ```javascript
  module.exports.default = async function(context) { ... }
  module.exports.meta = { 
    name: 'nuxt-pack-example',
    bundleSizeKb: '123.45 KB',
    assetsInlined: true,
    dynamicImportsDisabled: true,
    ...
  }
  ```

- **`test.html`** - A test page that imports and runs the bundle

## Testing

After building:

```bash
cd dist
npx serve .
# Open http://localhost:3000/test.html
```

## How It Works

### 1. Nuxt Configuration (`nuxt.config.ts`)

Key settings for creating a bundleable app:

```typescript
vite: {
  build: {
    // Inline assets up to 100KB as data URIs
    assetsInlineLimit: 100 * 1024,
    rollupOptions: {
      output: {
        // Disable code-splitting - everything in one chunk
        inlineDynamicImports: true,
        manualChunks: undefined,
      },
    },
  },
},
```

### 2. Build Script (`build-pack.mjs`)

The build script handles:

1. **Asset Discovery**: Finds all images, fonts, etc. in `_nuxt/`
2. **Base64 Conversion**: Converts each asset to a data URI
3. **CSS Inlining**: Replaces `url()` references with data URIs
4. **JS Inlining**: Replaces asset path strings with data URIs
5. **HTML Bundling**: Combines everything into a single HTML string
6. **Module Wrapping**: Exports as CommonJS with metadata

### 3. Execution

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
  dynamicImportsDisabled: true,
  generatedAt: '2026-01-31T12:00:00.000Z'
};
```

## Customizing

To create your own bundle:

1. Copy this example
2. Modify the Vue components in `pages/` and `app.vue`
3. Update `meta` in `scripts/build-pack.mjs`
4. Run `pnpm build`

## Notes

- The bundle uses CommonJS format (`module.exports`) for broad compatibility
- All assets are inlined to create a single self-contained file
- The bundle requires DOM access to render the Vue app interactively
