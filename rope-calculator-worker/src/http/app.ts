import { ALGORITHM_VERSION, API_VERSION } from '../core/constants';
import { RopeError } from '../core/errors';
import { computeForward } from '../core/forward';
import { findMatches } from '../core/reverse';
import { parseForwardInput, parseReverseInput } from '../core/validation';
import { getCatalogSnapshot } from '../catalog/cache';
import type { Env } from '../catalog/client';
import { corsHeaders } from './cors';
import { errorResponse, jsonResponse } from './responses';

const ROUTES = {
  health: '/api/rope/v1/health',
  catalog: '/api/rope/v1/catalog',
  forward: '/api/rope/v1/forward',
  reverse: '/api/rope/v1/reverse',
} as const;

/** Лимит тела запроса. */
export const MAX_BODY_BYTES = 8 * 1024;

export interface RequestOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

function requestIdOf(request: Request): string {
  const ray = request.headers.get('cf-ray');
  return ray && ray.trim() !== '' ? ray.trim() : crypto.randomUUID();
}

/**
 * Читает JSON-тело с ограничением размера.
 *
 * Content-Length проверяется до чтения, фактическая длина — после: заголовок
 * может отсутствовать при chunked-передаче, поэтому одной проверки мало.
 */
async function readJsonBody(request: Request): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const bytes = Number(declared);
    if (Number.isFinite(bytes) && bytes > MAX_BODY_BYTES) {
      throw new RopeError('BODY_TOO_LARGE', `Request body must not exceed ${MAX_BODY_BYTES} bytes.`);
    }
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    throw new RopeError('BODY_TOO_LARGE', `Request body must not exceed ${MAX_BODY_BYTES} bytes.`);
  }

  if (text.trim() === '') {
    throw new RopeError('BAD_JSON', 'Request body is empty.');
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new RopeError('BAD_JSON', 'Request body is not valid JSON.');
  }
}

/** Обработчик всех маршрутов Worker. Вынесен из index.ts ради тестов. */
export async function handleRequest(
  request: Request,
  env: Env,
  options: RequestOptions = {},
): Promise<Response> {
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

      case ROUTES.catalog: {
        if (request.method !== 'GET') return methodNotAllowed('GET');
        const snapshot = await getCatalogSnapshot(env, options);
        return jsonResponse(
          {
            apiVersion: API_VERSION,
            algorithmVersion: ALGORITHM_VERSION,
            catalogVersion: snapshot.catalogVersion,
            fetchedAt: snapshot.fetchedAt,
            threads: snapshot.threads,
          },
          200,
          cors,
        );
      }

      case ROUTES.forward: {
        if (request.method !== 'POST') return methodNotAllowed('POST');

        const input = parseForwardInput(await readJsonBody(request));

        if (input.basis === 'dtex') {
          const result = computeForward(input);
          return jsonResponse(
            {
              apiVersion: API_VERSION,
              algorithmVersion: ALGORITHM_VERSION,
              catalogVersion: null,
              fetchedAt: null,
              basis: 'dtex',
              input: { dtex: input.dtex, threadsPerStrand: input.threadsPerStrand },
              result,
            },
            200,
            cors,
          );
        }

        const snapshot = await getCatalogSnapshot(env, options);
        const result = computeForward(input, snapshot.threads);
        return jsonResponse(
          {
            apiVersion: API_VERSION,
            algorithmVersion: ALGORITHM_VERSION,
            catalogVersion: snapshot.catalogVersion,
            fetchedAt: snapshot.fetchedAt,
            basis: 'catalog',
            input: {
              threadId: input.threadId,
              dtex: result.dtex,
              threadsPerStrand: input.threadsPerStrand,
            },
            result,
          },
          200,
          cors,
        );
      }

      case ROUTES.reverse: {
        if (request.method !== 'POST') return methodNotAllowed('POST');

        const input = parseReverseInput(await readJsonBody(request));
        const snapshot = await getCatalogSnapshot(env, options);
        const { matches, tolerance } = findMatches(input, snapshot.threads);

        return jsonResponse(
          {
            apiVersion: API_VERSION,
            algorithmVersion: ALGORITHM_VERSION,
            catalogVersion: snapshot.catalogVersion,
            fetchedAt: snapshot.fetchedAt,
            input: {
              targetDiameterMm: input.targetDiameterMm,
              tolerance,
              threadIds: input.threadIds ?? null,
            },
            results: matches,
          },
          200,
          cors,
        );
      }

      default:
        throw new RopeError('NOT_FOUND', `Unknown route: ${pathname}`);
    }
  } catch (error) {
    if (error instanceof RopeError) {
      return errorResponse(error, requestId, cors);
    }

    console.error('Unhandled rope API error', error);
    return errorResponse(
      new RopeError('INTERNAL', 'Internal error.'),
      requestId,
      cors,
    );
  }
}
