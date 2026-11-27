import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { env } from '../config/env'
import { DomainError } from '../domain/errors'
import { CurrentUser } from '../domain/ticket'
import { AttachmentRepository } from '../repositories/attachment-repository'
import { TicketService } from './ticket-service'

const MAX_SIZE = 5 * 1024 * 1024
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'application/pdf', 'text/plain']

// O arquivo já lido pela camada http (o multer entrega neste formato). O serviço não conhece o Express.
export type UploadedFile = {
  originalname: string
  mimetype: string
  size: number
  buffer: Buffer
}

export class AttachmentService {
  constructor(
    private attachments: AttachmentRepository,
    private tickets: Pick<TicketService, 'getById'>,
    private uploadDir: string = env.UPLOAD_DIR,
  ) {}

  async upload(user: CurrentUser, ticketId: string, file: UploadedFile | undefined) {
    await this.tickets.getById(user, ticketId)

    if (!file) {
      throw new DomainError('validation_error', 'Envie o arquivo no campo file')
    }
    if (file.size > MAX_SIZE) {
      throw new DomainError('file_too_large', 'O arquivo pode ter no máximo 5 MB')
    }
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      throw new DomainError('unsupported_type', 'Tipo de arquivo não suportado')
    }

    fs.mkdirSync(this.uploadDir, { recursive: true })
    const storedName = crypto.randomUUID() + path.extname(file.originalname)
    fs.writeFileSync(path.join(this.uploadDir, storedName), file.buffer)

    return this.attachments.create({
      ticketId,
      uploaderId: user.id,
      originalName: file.originalname,
      storedName,
      mimeType: file.mimetype,
      sizeBytes: file.size,
    })
  }

  async getForDownload(user: CurrentUser, attachmentId: string) {
    const attachment = await this.attachments.findById(attachmentId)
    if (!attachment) {
      throw new DomainError('not_found', 'Anexo não encontrado')
    }
    try {
      await this.tickets.getById(user, attachment.ticketId)
    } catch {
      throw new DomainError('not_found', 'Anexo não encontrado')
    }
    return { attachment, filePath: path.join(this.uploadDir, attachment.storedName) }
  }
}
