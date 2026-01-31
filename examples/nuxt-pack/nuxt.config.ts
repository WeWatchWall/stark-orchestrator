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
      title: 'Nuxt Pack Example',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Example Nuxt app packaged for Stark Orchestrator' }
      ]
    }
  },

  // Configure Vite for building
  vite: {
    build: {
      // Ensure we get a clean build
      minify: true,
      sourcemap: false
    }
  }
})
