import tailwindcss from '@tailwindcss/vite'
import { env } from 'node:process'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  ...(env.NUXT_BUILD_DIR ? { buildDir: env.NUXT_BUILD_DIR } : {}),
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  // Amplify exposes these public values during build, not to the SSR process.
  // Bake in public defaults; Nuxt still permits runtime NUXT_PUBLIC_* overrides.
  runtimeConfig: {
    public: {
      apiBase: env.NUXT_PUBLIC_API_BASE || '',
      cognitoUserPoolId: env.NUXT_PUBLIC_COGNITO_USER_POOL_ID || '',
      cognitoClientId: env.NUXT_PUBLIC_COGNITO_CLIENT_ID || '',
      cognitoDomain: env.NUXT_PUBLIC_COGNITO_DOMAIN || '',
      identityFixtures: false,
    },
  },
  nitro: {
    awsAmplify: {
      // Nitro 2.13's type union predates Amplify's Node 22 support.
      // @ts-expect-error nodejs22.x is supported by Amplify Hosting.
      runtime: 'nodejs22.x'
    }
  }
})
