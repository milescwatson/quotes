// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  nitro: {
    awsAmplify: {
      // Nitro 2.13's type union predates Amplify's Node 22 support.
      // @ts-expect-error nodejs22.x is supported by Amplify Hosting.
      runtime: 'nodejs22.x'
    }
  }
})
