// Lint do gate G2 (scripts/gates.mjs roda com --max-warnings 0 em api/ e web/ inteiros).
import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
  { ignores: ['**/node_modules/**', '**/dist/**'] },
  {
    files: ['api/**/*.{ts,mts,cts}', 'web/**/*.{ts,tsx,mts}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // Parâmetro com _ na frente fica de fora só quando a posição é obrigatória
      // (ex.: o `_next` do error handler do Express, que precisa de 4 argumentos).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
)
