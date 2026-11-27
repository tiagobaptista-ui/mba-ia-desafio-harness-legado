// Erros de regra de negócio. A camada http traduz cada código para o status HTTP
// (ver http/errors.ts); os serviços não conhecem HTTP (gate G6).
export type ErrorCode =
  | 'validation_error'
  | 'forbidden'
  | 'not_found'
  | 'invalid_transition'
  | 'file_too_large'
  | 'unsupported_type'
  | 'email_taken'
  | 'invalid_credentials'
  | 'unauthorized'

export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message)
  }
}
