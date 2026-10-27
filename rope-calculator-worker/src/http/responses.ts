import { RopeError } from '../core/errors';

const CONTENT_TYPE = 'application/json; charset=utf-8';

export function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': CONTENT_TYPE, ...headers },
  });
}

export function errorResponse(error: RopeError, requestId: string, headers: Record<string, string> = {}): Response {
  return jsonResponse(
    {
      error: {
        code: error.code,
        message: error.message,
        fields: error.fields,
      },
      requestId,
    },
    error.status,
    headers,
  );
}
