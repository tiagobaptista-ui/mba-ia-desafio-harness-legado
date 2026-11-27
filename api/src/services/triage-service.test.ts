import { describe, expect, it, vi } from 'vitest'
import { TriageService } from './triage-service'
import { Ticket } from '../domain/ticket'
import { TicketRepository, TicketUpdate } from '../repositories/ticket-repository'

function ticket(id: string, title: string, minuto: number): Ticket {
  const createdAt = new Date(2024, 0, 1, 0, minuto)
  return {
    id,
    title,
    description: 'descrição do chamado',
    status: 'open',
    category: null,
    priority: null,
    triageStatus: 'pending',
    customerId: 'c1',
    assigneeId: null,
    createdAt,
    updatedAt: createdAt,
  }
}

function fakeRepository(tickets: Ticket[]) {
  const updates: { id: string; data: TicketUpdate }[] = []
  const repo = {
    findPendingTriage: async (limit: number) => tickets.filter((t) => t.triageStatus === 'pending').slice(0, limit),
    update: async (id: string, data: TicketUpdate) => {
      updates.push({ id, data })
      return tickets.find((t) => t.id === id)!
    },
  } as unknown as TicketRepository
  return { repo, updates }
}

describe('TriageService', () => {
  it('grava categoria, prioridade e done quando a classificação funciona', async () => {
    const { repo, updates } = fakeRepository([ticket('t1', 'Fatura', 1)])
    const classify = vi.fn().mockResolvedValue({ category: 'billing', priority: 'urgent' })
    await new TriageService(repo, classify).runOnce()
    expect(updates).toEqual([{ id: 't1', data: { category: 'billing', priority: 'urgent', triageStatus: 'done' } }])
  })

  it('marca failed quando a classificação falha e segue para o próximo', async () => {
    const { repo, updates } = fakeRepository([ticket('t1', '[falha-ia]', 1), ticket('t2', 'Senha', 2)])
    const classify = vi
      .fn()
      .mockRejectedValueOnce(new Error('classificacao falhou'))
      .mockResolvedValueOnce({ category: 'account', priority: 'high' })
    await new TriageService(repo, classify).runOnce()
    expect(updates).toEqual([
      { id: 't1', data: { triageStatus: 'failed' } },
      { id: 't2', data: { category: 'account', priority: 'high', triageStatus: 'done' } },
    ])
  })

  it('pega no máximo 10 chamados por rodada', async () => {
    const pendentes = Array.from({ length: 12 }, (_, i) => ticket(`t${i}`, 'Chamado', i))
    const { repo, updates } = fakeRepository(pendentes)
    await new TriageService(repo, vi.fn().mockResolvedValue({ category: 'other', priority: 'low' })).runOnce()
    expect(updates).toHaveLength(10)
  })
})
