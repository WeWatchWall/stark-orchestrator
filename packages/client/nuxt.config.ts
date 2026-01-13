// https://nuxt.com/docs/api/configuration/nuxt-config
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
  
  app: {
    head: {
      title: 'Stark Orchestrator',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Isomorphic JavaScript orchestration platform' }
      ]
    }
  }
})
