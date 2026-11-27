import { existsSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// Sem .env (ex.: CI), valem as variáveis do ambiente.
if (existsSync('.env')) process.loadEnvFile('.env')

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.DATABASE_URL_TEST || '',
    },
  },
})
