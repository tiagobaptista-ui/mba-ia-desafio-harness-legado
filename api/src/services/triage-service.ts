import { TicketCategory, TicketPriority } from '../domain/ticket'
import { TicketRepository } from '../repositories/ticket-repository'

type Classify = (ticket: { title: string; description: string }) => Promise<{
  category: TicketCategory
  priority: TicketPriority
}>

const BATCH_SIZE = 10

// Uma rodada do worker de triagem: classifica os chamados pendentes mais antigos.
// Se a classificação falhar, o chamado fica com triageStatus "failed" e a rodada segue.
export class TriageService {
  constructor(
    private tickets: TicketRepository,
    private classify: Classify,
  ) {}

  async runOnce() {
    const pending = await this.tickets.findPendingTriage(BATCH_SIZE)
    for (const ticket of pending) {
      try {
        const result = await this.classify(ticket)
        await this.tickets.update(ticket.id, { category: result.category, priority: result.priority, triageStatus: 'done' })
        console.log(`chamado ${ticket.id} triado: ${result.category}/${result.priority}`)
      } catch (err) {
        console.log(`falha na triagem do chamado ${ticket.id}: ${err instanceof Error ? err.message : String(err)}`)
        await this.tickets.update(ticket.id, { triageStatus: 'failed' })
      }
    }
  }
}
