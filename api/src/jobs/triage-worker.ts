import { env } from '../config/env'
import { classifyTicket } from '../integrations/ai-client'
import { ticketRepository } from '../repositories/ticket-repository'
import { TriageService } from '../services/triage-service'

// Processo separado da API (npm run worker). Usa a mesma camada de dados que a API (gate G12).
const triage = new TriageService(ticketRepository, classifyTicket)

async function loop() {
  try {
    await triage.runOnce()
  } catch (err) {
    console.log('erro no worker', err)
  }
  setTimeout(loop, env.TRIAGE_INTERVAL_MS)
}

console.log(`worker de triagem rodando a cada ${env.TRIAGE_INTERVAL_MS}ms`)
loop()
