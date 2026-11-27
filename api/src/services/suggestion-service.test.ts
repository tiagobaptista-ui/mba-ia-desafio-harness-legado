import { describe, expect, it, vi } from 'vitest'
import { SuggestionService } from './suggestion-service'
import { CurrentUser, Ticket } from '../domain/ticket'

const ticket = { id: 't1', title: 'Erro no login', description: 'Não entra', customerId: 'c1' } as Ticket
const tickets = { getById: async () => ticket }
const agent: CurrentUser = { id: 'a1', role: 'agent' }

describe('SuggestionService', () => {
  it('não deixa cliente pedir sugestão', async () => {
    const service = new SuggestionService(tickets, { findById: async () => null }, vi.fn())
    await expect(service.suggestFor({ id: 'c1', role: 'customer' }, 't1')).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('usa o nome do cliente e cai em "cliente" quando ele não existe', async () => {
    const suggest = vi.fn().mockResolvedValue('Olá!')
    await new SuggestionService(tickets, { findById: async () => null }, suggest).suggestFor(agent, 't1')
    expect(suggest).toHaveBeenCalledWith({ customerName: 'cliente', title: 'Erro no login', description: 'Não entra' })
  })
})
