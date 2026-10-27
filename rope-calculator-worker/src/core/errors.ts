/**
 * Единый формат ошибок API. Статусы зафиксированы спецификацией
 * (docs/rope-calculator/spec.md, раздел 9) и не зависят от транспорта.
 */
export const ERROR_STATUS = {
  BAD_JSON: 400,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  BODY_TOO_LARGE: 413,
  INVALID_PARAMS: 422,
  THREAD_NOT_FOUND: 422,
  CATALOG_UNAVAILABLE: 503,
  CATALOG_INVALID: 503,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class RopeError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields: readonly string[];

  constructor(code: ErrorCode, message: string, fields: readonly string[] = []) {
    super(message);
    this.name = 'RopeError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.fields = fields;
  }
}

export function invalidParams(message: string, fields: readonly string[] = []): RopeError {
  return new RopeError('INVALID_PARAMS', message, fields);
}

export function threadNotFound(ids: readonly string[]): RopeError {
  return new RopeError(
    'THREAD_NOT_FOUND',
    ids.length === 1
      ? `Thread is unknown or disabled: ${ids[0]}`
      : `Threads are unknown or disabled: ${ids.join(', ')}`,
    ['threadId'],
  );
}
