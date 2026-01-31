# Nuxt Bundle Example

This example demonstrates how to build a Nuxt/Vue application into a self-contained JavaScript bundle.

## Overview

The bundle exports a default async function as the entry point:

```javascript
module.exports.default = async function(context) {
  // Render or return HTML
  return { status: 'rendered' };
};
```

This example takes a full Nuxt application and builds it into a single `pack.js` file that can be loaded and executed in different contexts.

## Project Structure

```
nuxt-pack/
├── app.vue              # Root Vue component
├── pages/
│   └── index.vue        # Main page with interactive demo
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
   - Inline all JavaScript and CSS into the HTML
   - Wrap everything in a CommonJS module entry point
   - Generate a test page

## Output

After building, the `dist/` folder will contain:

- **`pack.js`** - The bundle entry point that exports:
  ```javascript
  module.exports.default = async function(context) { ... }
  module.exports.meta = { name, version, ... }
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

1. **Nuxt Build**: `nuxt generate` creates a static SPA with chunked JS/CSS in `_nuxt/`

2. **Bundle Build**: The `build-pack.mjs` script:
   - Reads the generated `index.html`
   - Inlines all JavaScript and CSS
   - Wraps everything in a CommonJS module with `module.exports.default`

3. **Execution**: When the bundle runs:
   - In a DOM context: It writes the HTML to the document
   - In a worker context: It returns the HTML content

## Metadata

The bundle exports optional metadata:

```javascript
module.exports.meta = {
  name: 'nuxt-pack-example',
  version: '0.0.1',
  framework: 'nuxt',
  requiresDOM: true
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
