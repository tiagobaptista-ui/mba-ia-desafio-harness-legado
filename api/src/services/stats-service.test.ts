import { describe, expect, it } from 'vitest'
import { StatsService } from './stats-service'
import { StatsRepository } from '../repositories/stats-repository'

describe('StatsService', () => {
  it('preenche com zero o que não aparece e conta sem triagem como untriaged', async () => {
    const repo: StatsRepository = {
      countByStatus: async () => [{ status: 'open', count: 3 }],
      countByCategory: async () => [
        { category: 'billing', count: 2 },
        { category: null, count: 1 },
      ],
      countByPriority: async () => [{ priority: null, count: 3 }],
    }
    expect(await new StatsService(repo).summary()).toEqual({
      byStatus: { open: 3, in_progress: 0, resolved: 0 },
      byCategory: { billing: 2, technical: 0, account: 0, other: 0, untriaged: 1 },
      byPriority: { low: 0, medium: 0, high: 0, urgent: 0, untriaged: 3 },
    })
  })
})
