import { TicketCategory, TicketPriority, TicketStatus } from '../domain/ticket'
import { StatsRepository } from '../repositories/stats-repository'

// Contagens do painel do admin. Toda chave aparece, mesmo com zero; sem triagem conta como "untriaged".
export class StatsService {
  constructor(private stats: StatsRepository) {}

  async summary() {
    const [statusRows, categoryRows, priorityRows] = await Promise.all([
      this.stats.countByStatus(),
      this.stats.countByCategory(),
      this.stats.countByPriority(),
    ])

    const byStatus: Record<TicketStatus, number> = { open: 0, in_progress: 0, resolved: 0 }
    for (const row of statusRows) byStatus[row.status] = row.count

    const byCategory: Record<TicketCategory | 'untriaged', number> = {
      billing: 0,
      technical: 0,
      account: 0,
      other: 0,
      untriaged: 0,
    }
    for (const row of categoryRows) byCategory[row.category || 'untriaged'] = row.count

    const byPriority: Record<TicketPriority | 'untriaged', number> = { low: 0, medium: 0, high: 0, urgent: 0, untriaged: 0 }
    for (const row of priorityRows) byPriority[row.priority || 'untriaged'] = row.count

    return { byStatus, byCategory, byPriority }
  }
}
