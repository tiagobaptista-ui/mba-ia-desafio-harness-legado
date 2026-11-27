import { NextFunction, Request, Response } from 'express'
import { DomainError, ErrorCode } from '../domain/errors'
import { CurrentUser } from '../domain/ticket'

// Erro que só existe na borda http (ex.: corpo inválido). Regra de negócio lança DomainError.
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

// Status HTTP de cada código de erro de domínio. É o único lugar que liga regra de negócio a HTTP.
const STATUS_BY_CODE: Record<ErrorCode, number> = {
  validation_error: 422,
  forbidden: 403,
  not_found: 404,
  invalid_transition: 409,
  file_too_large: 413,
  unsupported_type: 415,
  email_taken: 409,
  invalid_credentials: 401,
  unauthorized: 401,
}

export type AuthedRequest = Request & { user: CurrentUser }

export function asyncHandler(fn: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req as AuthedRequest, res, next).catch(next)
  }
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: 'not_found', message: 'Rota não encontrada' })
}

function isJsonParseError(err: unknown) {
  return typeof err === 'object' && err !== null && 'type' in err && err.type === 'entity.parse.failed'
}

// O Express só reconhece o handler de erro pela aridade 4, por isso o `_next` sem uso.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.code, message: err.message })
  }
  if (err instanceof DomainError) {
    return res.status(STATUS_BY_CODE[err.code]).json({ error: err.code, message: err.message })
  }
  if (err instanceof Error && err.name === 'MulterError') {
    return res.status(422).json({ error: 'validation_error', message: err.message })
  }
  if (isJsonParseError(err)) {
    return res.status(400).json({ error: 'bad_request', message: 'JSON inválido' })
  }
  console.log('erro inesperado', err)
  res.status(500).json({ error: 'internal_error', message: 'Erro interno' })
}
