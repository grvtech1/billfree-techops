import { ERROR_CODES, type ErrorCode } from '@billfree/shared';

/**
 * Domain error with a stable code (shared with the frontend via @billfree/shared)
 * and an HTTP status. Throw these from handlers/services; the Fastify error
 * handler (see http.ts) maps them to the canonical `{ success, error }` envelope.
 */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (msg = 'Not found') => new AppError(ERROR_CODES.NOT_FOUND, 404, msg);
export const validationFailed = (msg = 'Validation failed', details?: unknown) =>
  new AppError(ERROR_CODES.VALIDATION_FAILED, 400, msg, details);
export const unauthorized = (msg = 'Authentication required') =>
  new AppError(ERROR_CODES.UNAUTHORIZED, 401, msg);
export const forbidden = (msg = 'Insufficient permissions') =>
  new AppError(ERROR_CODES.INSUFFICIENT_PERMISSIONS, 403, msg);
export const rateLimited = (msg = 'Too many requests') =>
  new AppError(ERROR_CODES.RATE_LIMITED, 429, msg);
export const invalidStatus = (msg = 'Invalid status') =>
  new AppError(ERROR_CODES.INVALID_STATUS, 422, msg);
