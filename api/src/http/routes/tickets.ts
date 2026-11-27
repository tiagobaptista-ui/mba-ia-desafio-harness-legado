import { Router } from 'express'
import multer from 'multer'
import { asyncHandler } from '../errors'
import { requireAuth } from '../middlewares/auth'
import { Reply, Ticket } from '../../domain/ticket'
import { AttachmentService } from '../../services/attachment-service'
import { SuggestionService } from '../../services/suggestion-service'
import { TicketService } from '../../services/ticket-service'

function toTicketJson(t: Ticket) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    category: t.category,
    priority: t.priority,
    triageStatus: t.triageStatus,
    customerId: t.customerId,
    assigneeId: t.assigneeId,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }
}

function toReplyJson(r: Reply) {
  return {
    id: r.id,
    ticketId: r.ticketId,
    authorId: r.authorId,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
    author: r.author,
  }
}

export function ticketRoutes(tickets: TicketService, attachments: AttachmentService, suggestions: SuggestionService) {
  const router = Router()
  const upload = multer({ storage: multer.memoryStorage() })

  router.use(requireAuth)

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const result = await tickets.list(req.user, req.query)
      res.json({ ...result, items: result.items.map(toTicketJson) })
    }),
  )

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const ticket = await tickets.create(req.user, req.body)
      res.status(201).json(toTicketJson(ticket))
    }),
  )

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const ticket = await tickets.getDetails(req.user, req.params.id)
      res.json({
        ...toTicketJson(ticket),
        replies: ticket.replies.map(toReplyJson),
        attachments: ticket.attachments,
      })
    }),
  )

  router.post(
    '/:id/assign',
    asyncHandler(async (req, res) => {
      const ticket = await tickets.assign(req.user, req.params.id)
      res.json(toTicketJson(ticket))
    }),
  )

  router.post(
    '/:id/resolve',
    asyncHandler(async (req, res) => {
      const ticket = await tickets.resolve(req.user, req.params.id)
      res.json(toTicketJson(ticket))
    }),
  )

  router.post(
    '/:id/replies',
    asyncHandler(async (req, res) => {
      const reply = await tickets.addReply(req.user, req.params.id, req.body)
      res.status(201).json(toReplyJson(reply))
    }),
  )

  router.post(
    '/:id/attachments',
    upload.single('file'),
    asyncHandler(async (req, res) => {
      const attachment = await attachments.upload(req.user, req.params.id, req.file)
      res.status(201).json(attachment)
    }),
  )

  router.post(
    '/:id/suggest-reply',
    asyncHandler(async (req, res) => {
      const suggestion = await suggestions.suggestFor(req.user, req.params.id)
      res.json({ suggestion })
    }),
  )

  return router
}
