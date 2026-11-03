import { API_VERSION, MAX_BODY_BYTES } from '../constants';
import { RiggingError, invalidParams } from '../core/errors';
import {
  ALGORITHM_VERSION,
  PROFILE_REGISTRY,
  calculate,
  type RiggingInput,
} from '../core/rigging';
import { corsHeaders } from './cors';
import { errorResponse, jsonResponse } from './responses';

const ROUTES = {
  health: '/api/rigging/v1/health',
  profiles: '/api/rigging/v1/profiles',
  calculate: '/api/rigging/v1/calculate',
} as const;

function requestIdOf(request: Request): string {
  const ray = request.headers.get('cf-ray');
  return ray && ray.trim() !== '' ? ray.trim() : crypto.randomUUID();
}

/**
 * Читает JSON-тело с ограничением размера. Content-Length проверяется до
 * чтения, фактическая длина — после: заголовок может отсутствовать при
 * chunked-передаче.
 */
async function readJsonBody(request: Request): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const bytes = Number(declared);
    if (Number.isFinite(bytes) && bytes > MAX_BODY_BYTES) {
      throw new RiggingError(
        'BODY_TOO_LARGE',
        `Request body must not exceed ${MAX_BODY_BYTES} bytes.`,
      );
    }
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    throw new RiggingError(
      'BODY_TOO_LARGE',
      `Request body must not exceed ${MAX_BODY_BYTES} bytes.`,
    );
  }

  if (text.trim() === '') {
    throw new RiggingError('BAD_JSON', 'Request body is empty.');
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new RiggingError('BAD_JSON', 'Request body is not valid JSON.');
  }
}

/**
 * Проверяет только форму тела. Доменные ошибки (масштаб, дубли узлов,
 * неизвестные размеры) возвращает само ядро в validationErrors.
 */
function ensureRiggingInput(value: unknown): RiggingInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidParams('Request body must be a JSON object.');
  }

  const input = value as Partial<RiggingInput>;
  const fields: string[] = [];

  if (typeof input.scaleDenominator !== 'number') fields.push('scaleDenominator');
  if (!Array.isArray(input.nodes)) fields.push('nodes');
  if (typeof input.measurements !== 'object' || input.measurements === null) {
    fields.push('measurements');
  }

  if (fields.length > 0) {
    throw invalidParams(
      'Request body must contain scaleDenominator, measurements and nodes.',
      fields,
    );
  }

  return input as RiggingInput;
}

/** Обработчик всех маршрутов Worker. Вынесен из index.ts ради тестов. */
export async function handleRequest(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const cors = corsHeaders(request.headers.get('origin'));
  const requestId = requestIdOf(request);

  const methodNotAllowed = (allowed: 'GET' | 'POST'): Response =>
    jsonResponse(
      {
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: `Use ${allowed} for ${pathname}.`,
          fields: [],
        },
        requestId,
      },
      405,
      { ...cors, allow: allowed },
    );

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    switch (pathname) {
      case ROUTES.health: {
        if (request.method !== 'GET') return methodNotAllowed('GET');
        return jsonResponse(
          { ok: true, apiVersion: API_VERSION, algorithmVersion: ALGORITHM_VERSION },
          200,
          cors,
        );
      }

      case ROUTES.profiles: {
        if (request.method !== 'GET') return methodNotAllowed('GET');
        return jsonResponse(
          {
            apiVersion: API_VERSION,
            algorithmVersion: ALGORITHM_VERSION,
            profiles: PROFILE_REGISTRY,
          },
          200,
          cors,
        );
      }

      case ROUTES.calculate: {
        if (request.method !== 'POST') return methodNotAllowed('POST');
        const input = ensureRiggingInput(await readJsonBody(request));
        const calculation = calculate(input);
        return jsonResponse(
          { apiVersion: API_VERSION, ...calculation },
          200,
          cors,
        );
      }

      default:
        return jsonResponse(
          {
            error: {
              code: 'NOT_FOUND',
              message: `Unknown route: ${pathname}.`,
              fields: [],
            },
            requestId,
          },
          404,
          cors,
        );
    }
  } catch (error) {
    if (error instanceof RiggingError) {
      return errorResponse(error, requestId, cors);
    }

    return jsonResponse(
      {
        error: {
          code: 'INTERNAL',
          message: 'Unexpected server error.',
          fields: [],
        },
        requestId,
      },
      500,
      cors,
    );
  }
}
