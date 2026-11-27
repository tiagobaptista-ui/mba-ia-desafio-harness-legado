import { z } from 'zod'

// Único lugar da API que lê process.env (gate G5). Os outros módulos importam `env`.
// Valor vazio no .env conta como ausente, para que `CHAVE=` caia no padrão.
const vazioComoAusente = (valor: unknown) => (valor === '' ? undefined : valor)

const schema = z.object({
  NODE_ENV: z.preprocess(vazioComoAusente, z.enum(['development', 'test', 'production']).default('development')),
  // Só o acesso ao banco exige DATABASE_URL (ver repositories/prisma.ts): os testes unitários rodam sem ele.
  DATABASE_URL: z.preprocess(vazioComoAusente, z.string().optional()),
  PORT: z.preprocess(vazioComoAusente, z.coerce.number().int().positive().default(4000)),
  CORS_ORIGIN: z.preprocess(vazioComoAusente, z.string().default('http://localhost:5173')),
  JWT_SECRET: z.preprocess(vazioComoAusente, z.string().default('dev-secret')),
  AI_MODE: z.preprocess(vazioComoAusente, z.string().default('fake')),
  OPENAI_API_KEY: z.preprocess(vazioComoAusente, z.string().optional()),
  UPLOAD_DIR: z.preprocess(vazioComoAusente, z.string().default('/tmp/balcao/uploads')),
  TRIAGE_INTERVAL_MS: z.preprocess(vazioComoAusente, z.coerce.number().positive().default(2000)),
})

export const env = schema.parse(process.env)
