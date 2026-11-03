/** Единый формат ошибок API толщин такелажа. */
export const ERROR_STATUS = {
  BAD_JSON: 400,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  BODY_TOO_LARGE: 413,
  INVALID_PARAMS: 422,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class RiggingError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields: readonly string[];

  constructor(code: ErrorCode, message: string, fields: readonly string[] = []) {
    super(message);
    this.name = 'RiggingError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.fields = fields;
  }
}

export function invalidParams(message: string, fields: readonly string[] = []): RiggingError {
  return new RiggingError('INVALID_PARAMS', message, fields);
}
