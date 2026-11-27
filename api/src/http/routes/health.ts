import { Router } from 'express'
import { asyncHandler } from '../errors'
import { HealthService } from '../../services/health-service'

export function healthRoutes(health: HealthService) {
  const router = Router()

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      if (await health.isDatabaseUp()) {
        res.json({ status: 'ok', db: 'ok' })
        return
      }
      res.status(503).json({ error: 'db_unavailable', message: 'Banco de dados não responde' })
    }),
  )

  return router
}
