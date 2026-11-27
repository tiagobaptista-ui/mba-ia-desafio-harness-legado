import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { AttachmentService, UploadedFile } from './attachment-service'
import { DomainError } from '../domain/errors'
import { Attachment, CurrentUser, Ticket } from '../domain/ticket'
import { AttachmentRepository } from '../repositories/attachment-repository'

const ticket = { id: 't1', customerId: 'c1' } as Ticket

const fakeTickets = {
  getById: async (user: CurrentUser, id: string) => {
    if (id !== ticket.id || (user.role === 'customer' && user.id !== ticket.customerId)) {
      throw new DomainError('not_found', 'Chamado não encontrado')
    }
    return ticket
  },
}

const fakeAttachments: AttachmentRepository = {
  create: async (data) => ({ id: 'att1', createdAt: new Date(), ...data }),
  findById: async (): Promise<Attachment | null> => null,
}

const customer: CurrentUser = { id: 'c1', role: 'customer' }
const otherCustomer: CurrentUser = { id: 'c2', role: 'customer' }

function file(size: number, mimetype: string, originalname: string): UploadedFile {
  return { size, mimetype, originalname, buffer: Buffer.from('') }
}

describe('AttachmentService', () => {
  const uploadDir = path.join(os.tmpdir(), 'balcao-attachment-service-test')
  const service = new AttachmentService(fakeAttachments, fakeTickets, uploadDir)

  it('exige arquivo', async () => {
    await expect(service.upload(customer, 't1', undefined)).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('recusa arquivo maior que 5 MB', async () => {
    const grande = file(5 * 1024 * 1024 + 1, 'text/plain', 'a.txt')
    await expect(service.upload(customer, 't1', grande)).rejects.toMatchObject({ code: 'file_too_large' })
  })

  it('recusa tipo não suportado', async () => {
    const gif = file(10, 'image/gif', 'a.gif')
    await expect(service.upload(customer, 't1', gif)).rejects.toMatchObject({ code: 'unsupported_type' })
  })

  it('não deixa outro cliente enviar', async () => {
    await expect(service.upload(otherCustomer, 't1', undefined)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('grava o arquivo e registra o anexo', async () => {
    const anexo = await service.upload(customer, 't1', file(3, 'text/plain', 'nota.txt'))
    expect(anexo).toMatchObject({ ticketId: 't1', uploaderId: 'c1', originalName: 'nota.txt', mimeType: 'text/plain' })
    expect(anexo.storedName).toMatch(/\.txt$/)
  })
})
