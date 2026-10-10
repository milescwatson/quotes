import tailwindcss from '@tailwindcss/vite'
import { env } from 'node:process'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  ...(env.NUXT_BUILD_DIR ? { buildDir: env.NUXT_BUILD_DIR } : {}),
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  runtimeConfig: { public: { apiBase: '', cognitoUserPoolId: '', cognitoClientId: '', cognitoDomain: '', identityFixtures: false } },
  nitro: {
    awsAmplify: {
      // Nitro 2.13's type union predates Amplify's Node 22 support.
      // @ts-expect-error nodejs22.x is supported by Amplify Hosting.
      runtime: 'nodejs22.x'
    }
  }
})
