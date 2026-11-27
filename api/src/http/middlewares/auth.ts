import { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../../config/env'
import { AuthedRequest } from '../errors'

export function signToken(user: { id: string; role: string }) {
  return jwt.sign({ sub: user.id, role: user.role }, env.JWT_SECRET, { expiresIn: '8h' })
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthorized', message: 'Token ausente' })
  }
  let payload: string | jwt.JwtPayload
  try {
    payload = jwt.verify(header.slice(7), env.JWT_SECRET)
  } catch {
    return res.status(401).json({ error: 'unauthorized', message: 'Token inválido' })
  }
  if (typeof payload === 'string') {
    return res.status(401).json({ error: 'unauthorized', message: 'Token inválido' })
  }
  ;(req as AuthedRequest).user = { id: payload.sub as string, role: payload.role }
  next()
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as Partial<AuthedRequest>).user
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ error: 'forbidden', message: 'Sem permissão' })
    }
    next()
  }
}
