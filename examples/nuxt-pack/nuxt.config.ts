// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: false },
  
  // Generate static files for production
  ssr: false,
  
  // Output directory for the static build
  nitro: {
    preset: 'static',
    output: {
      publicDir: '.output/public'
    }
  },
  
  app: {
    head: {
      title: 'Nuxt Bundle Example',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Example Nuxt app built as a self-contained bundle' }
      ]
    },
    // Use base of '/' for iframe compatibility
    baseURL: '/'
  },

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

  // Configure Vite for building
  vite: {
    build: {
      // Ensure we get a clean build
      minify: true,
      sourcemap: false,
      
      // Inline all assets smaller than 100KB as base64 data URIs
      // This helps create a truly self-contained bundle
      assetsInlineLimit: 100 * 1024, // 100KB
      
      rollupOptions: {
        output: {
          // Inline all dynamic imports into a single chunk
          // This prevents code-splitting which would break our bundle
          inlineDynamicImports: true,
          
          // Put all code in a single chunk
          manualChunks: undefined,
        },
      },
    },
  },

  // Inline all CSS to avoid external file references
  css: [],
  
  // Note: experimental.appManifest is set above
})
