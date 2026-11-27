import express from 'express'
import cors from 'cors'
import { env } from '../config/env'
import { AttachmentService } from '../services/attachment-service'
import { AuthService } from '../services/auth-service'
import { HealthService } from '../services/health-service'
import { StatsService } from '../services/stats-service'
import { SuggestionService } from '../services/suggestion-service'
import { TicketService } from '../services/ticket-service'
import { errorHandler, notFoundHandler } from './errors'
import { attachmentRoutes } from './routes/attachments'
import { authRoutes } from './routes/auth'
import { healthRoutes } from './routes/health'
import { statsRoutes } from './routes/stats'
import { ticketRoutes } from './routes/tickets'

// A camada http recebe os serviços prontos (montados em main.ts) e nunca toca em repositório
// nem no Prisma (gate G4).
export interface Services {
  auth: AuthService
  tickets: TicketService
  attachments: AttachmentService
  suggestions: SuggestionService
  stats: StatsService
  health: HealthService
}

export function createApp(services: Services) {
  const app = express()

  app.use(cors({ origin: env.CORS_ORIGIN }))
  app.use(express.json())

  app.use('/api/health', healthRoutes(services.health))
  app.use('/api/auth', authRoutes(services.auth))
  app.use('/api/tickets', ticketRoutes(services.tickets, services.attachments, services.suggestions))
  app.use('/api/attachments', attachmentRoutes(services.attachments))
  app.use('/api/stats', statsRoutes(services.stats))

  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}
