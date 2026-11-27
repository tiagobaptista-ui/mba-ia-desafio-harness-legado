import { env } from './config/env'
import { createApp } from './http/app'
import { suggestReply } from './integrations/ai-client'
import { attachmentRepository } from './repositories/attachment-repository'
import { healthRepository } from './repositories/health-repository'
import { replyRepository } from './repositories/reply-repository'
import { statsRepository } from './repositories/stats-repository'
import { ticketRepository } from './repositories/ticket-repository'
import { userRepository } from './repositories/user-repository'
import { AttachmentService } from './services/attachment-service'
import { AuthService } from './services/auth-service'
import { HealthService } from './services/health-service'
import { StatsService } from './services/stats-service'
import { SuggestionService } from './services/suggestion-service'
import { TicketService } from './services/ticket-service'

// Raiz de composição: o único lugar que liga repositórios, serviços e a camada http.
const tickets = new TicketService(ticketRepository, replyRepository)

const app = createApp({
  auth: new AuthService(userRepository),
  tickets,
  attachments: new AttachmentService(attachmentRepository, tickets),
  suggestions: new SuggestionService(tickets, userRepository, suggestReply),
  stats: new StatsService(statsRepository),
  health: new HealthService(healthRepository),
})

app.listen(env.PORT, () => {
  console.log(`API rodando na porta ${env.PORT}`)
})
