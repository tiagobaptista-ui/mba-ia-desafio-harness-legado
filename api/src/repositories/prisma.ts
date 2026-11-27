import { PrismaClient } from '@prisma/client'
import { env } from '../config/env'

if (!env.DATABASE_URL) {
  throw new Error('DATABASE_URL não definida: crie o api/.env (npm run up faz isso por você).')
}

export const prisma = new PrismaClient({
  datasources: { db: { url: env.DATABASE_URL } },
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
})
