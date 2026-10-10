import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './auth-tests',
  fullyParallel: true,
  workers: 2,
  timeout: 30000,
  expect: { timeout: 10000 },
  use: { baseURL: 'http://127.0.0.1:3101', trace: 'retain-on-failure' },
  webServer: {
    command:
      'NUXT_PUBLIC_IDENTITY_FIXTURES=false NUXT_PUBLIC_API_BASE=https://api.quotes.test NUXT_PUBLIC_COGNITO_USER_POOL_ID=us-west-2_test NUXT_PUBLIC_COGNITO_CLIENT_ID=test-client NUXT_PUBLIC_COGNITO_DOMAIN=https://login.quotes.test npm run dev -- --host 127.0.0.1 --port 3101',
    url: 'http://127.0.0.1:3101/login',
    timeout: 120000,
  },
  projects: [{ name: 'chromium-auth', use: { ...devices['Desktop Chrome'] } }],
})
