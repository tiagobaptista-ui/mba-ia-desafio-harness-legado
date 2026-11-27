import { prisma } from './prisma'
import { TicketCategory, TicketPriority, TicketStatus } from '../domain/ticket'

export interface StatsRepository {
  countByStatus(): Promise<{ status: TicketStatus; count: number }[]>
  countByCategory(): Promise<{ category: TicketCategory | null; count: number }[]>
  countByPriority(): Promise<{ priority: TicketPriority | null; count: number }[]>
}

class PrismaStatsRepository implements StatsRepository {
  async countByStatus() {
    const rows = await prisma.ticket.groupBy({ by: ['status'], _count: { _all: true } })
    return rows.map((row) => ({ status: row.status, count: row._count._all }))
  }

  async countByCategory() {
    const rows = await prisma.ticket.groupBy({ by: ['category'], _count: { _all: true } })
    return rows.map((row) => ({ category: row.category, count: row._count._all }))
  }

  async countByPriority() {
    const rows = await prisma.ticket.groupBy({ by: ['priority'], _count: { _all: true } })
    return rows.map((row) => ({ priority: row.priority, count: row._count._all }))
  }
}

export const statsRepository = new PrismaStatsRepository()
