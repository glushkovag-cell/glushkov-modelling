import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOG_CACHE_KEY, resetCatalogCache } from '../src/catalog/cache';
import type { Env } from '../src/catalog/client';
import { handleRequest } from '../src/http/app';
import type { CatalogThread } from '../src/core/types';
import { catalog, relativeDifference } from './helpers';

const env: Env = {
  WP_GRAPHQL_URL: 'https://cms.example.test/graphql',
  WP_GRAPHQL_SECRET: 's3cret',
};

const API = 'https://api.example.test';

function cmsNode(thread: CatalogThread): Record<string, unknown> {
  return {
    slug: thread.threadId,
    status: 'publish',
    ropethreadfields: {
      threadId: thread.threadId,
      brand: thread.brand,
      number: thread.number,
      dtex: thread.dtex,
      enabled: thread.enabled,
      sortOrder: thread.sortOrder,
    },
  };
}

function cmsPage(nodes: unknown[] = catalog.map(cmsNode)): unknown {
  return { data: { ropeThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } };
}

function cmsResponse(body: unknown = cmsPage(), status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fetchMock(handler: () => Promise<Response>) {
  return vi.fn(handler);
}

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`${API}${path}`, { headers });
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function json(response: Response): Promise<any> {
  return response.json();
}

describe('rope API', () => {
  beforeEach(async () => {
    await resetCatalogCache();
  });

  it('health не требует каталога', async () => {
    const fn = fetchMock(async () => cmsResponse());
    const response = await handleRequest(get('/api/rope/v1/health'), env, {
      fetchImpl: fn as unknown as typeof fetch,
    });

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      ok: true,
      apiVersion: '1',
      algorithmVersion: '1.0.0',
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it('catalog отдаёт 23 нити и версию', async () => {
    const fn = fetchMock(async () => cmsResponse());
    const response = await handleRequest(get('/api/rope/v1/catalog'), env, {
      fetchImpl: fn as unknown as typeof fetch,
    });
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.threads).toHaveLength(23);
    expect(body.catalogVersion).toBe('40dc45531758');
    expect(body.apiVersion).toBe('1');
    expect(typeof body.fetchedAt).toBe('string');
  });

  it('повторный запрос каталога обслуживается кешем', async () => {
    const fn = fetchMock(async () => cmsResponse());

    const first = await json(
      await handleRequest(get('/api/rope/v1/catalog'), env, { fetchImpl: fn as unknown as typeof fetch }),
    );
    const second = await json(
      await handleRequest(get('/api/rope/v1/catalog'), env, { fetchImpl: fn as unknown as typeof fetch }),
    );

    expect(fn).toHaveBeenCalledTimes(1);
    expect(second.fetchedAt).toBe(first.fetchedAt);
    expect(second.catalogVersion).toBe(first.catalogVersion);
  });

  it('forward по каталогу считает диаметр', async () => {
    const fn = fetchMock(async () => cmsResponse());
    const response = await handleRequest(
      post('/api/rope/v1/forward', { basis: 'catalog', threadId: 'tera-40', threadsPerStrand: 2 }),
      env,
      { fetchImpl: fn as unknown as typeof fetch },
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.basis).toBe('catalog');
    expect(body.input.dtex).toBe(750);
    expect(body.result.construction).toBe('2 × 3');
    expect(relativeDifference(body.result.diameterMm, 0.9631868577202545)).toBeLessThan(1e-12);
  });

  it('forward по ручному dTex не обращается к CMS', async () => {
    const fn = fetchMock(async () => cmsResponse());
    const response = await handleRequest(
      post('/api/rope/v1/forward', { basis: 'dtex', dtex: 750, threadsPerStrand: 2 }),
      env,
      { fetchImpl: fn as unknown as typeof fetch },
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.catalogVersion).toBeNull();
    expect(body.fetchedAt).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it('reverse отдаёт совпадения в устойчивом порядке', async () => {
    const fn = fetchMock(async () => cmsResponse());
    const response = await handleRequest(
      post('/api/rope/v1/reverse', { targetDiameterMm: 1 }),
      env,
      { fetchImpl: fn as unknown as typeof fetch },
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.results).toHaveLength(11);
    expect(body.results[0].threadId).toBe('tera-60');
    expect(body.input.tolerance).toBe(0.15);
    expect(body.input.threadIds).toBeNull();
  });

  it('reverse без совпадений возвращает пустой список', async () => {
    const fn = fetchMock(async () => cmsResponse());
    const response = await handleRequest(
      post('/api/rope/v1/reverse', { targetDiameterMm: 100 }),
      env,
      { fetchImpl: fn as unknown as typeof fetch },
    );

    expect(response.status).toBe(200);
    expect((await json(response)).results).toEqual([]);
  });

  it('неизвестный маршрут даёт 404', async () => {
    const response = await handleRequest(get('/api/rope/v1/nope'), env);

    expect(response.status).toBe(404);
    expect((await json(response)).error.code).toBe('NOT_FOUND');
  });

  it('неверный метод даёт 405 с Allow', async () => {
    const response = await handleRequest(get('/api/rope/v1/forward'), env);

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect((await json(response)).error.code).toBe('METHOD_NOT_ALLOWED');
  });

  it('невалидный JSON даёт 400', async () => {
    const response = await handleRequest(post('/api/rope/v1/forward', '{oops'), env);

    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe('BAD_JSON');
  });

  it('слишком большое тело даёт 413', async () => {
    const response = await handleRequest(
      post('/api/rope/v1/forward', JSON.stringify({ padding: 'x'.repeat(9000) })),
      env,
    );

    expect(response.status).toBe(413);
    expect((await json(response)).error.code).toBe('BODY_TOO_LARGE');
  });

  it('невалидные параметры дают 422 с полями', async () => {
    const response = await handleRequest(
      post('/api/rope/v1/forward', { basis: 'dtex', dtex: 10, threadsPerStrand: 2 }),
      env,
    );
    const body = await json(response);

    expect(response.status).toBe(422);
    expect(body.error.code).toBe('INVALID_PARAMS');
    expect(body.error.fields).toEqual(['dtex']);
  });

  it('неизвестная нить даёт 422 THREAD_NOT_FOUND', async () => {
    const fn = fetchMock(async () => cmsResponse());
    const response = await handleRequest(
      post('/api/rope/v1/forward', { basis: 'catalog', threadId: 'nope', threadsPerStrand: 2 }),
      env,
      { fetchImpl: fn as unknown as typeof fetch },
    );

    expect(response.status).toBe(422);
    expect((await json(response)).error.code).toBe('THREAD_NOT_FOUND');
  });

  it('отказ CMS даёт 503, но ручной dTex продолжает работать', async () => {
    const failing = fetchMock(async () => cmsResponse({ message: 'boom' }, 500));

    const catalogResponse = await handleRequest(get('/api/rope/v1/catalog'), env, {
      fetchImpl: failing as unknown as typeof fetch,
    });
    expect(catalogResponse.status).toBe(503);
    expect((await json(catalogResponse)).error.code).toBe('CATALOG_UNAVAILABLE');

    const dtexResponse = await handleRequest(
      post('/api/rope/v1/forward', { basis: 'dtex', dtex: 750, threadsPerStrand: 2 }),
      env,
      { fetchImpl: failing as unknown as typeof fetch },
    );
    expect(dtexResponse.status).toBe(200);
  });

  it('кладёт каталог в кеш с TTL 24 часа', async () => {
    const fn = fetchMock(async () => cmsResponse());
    await handleRequest(get('/api/rope/v1/catalog'), env, {
      fetchImpl: fn as unknown as typeof fetch,
    });

    const cached = await caches.default.match(CATALOG_CACHE_KEY);
    expect(cached).toBeDefined();
    expect(cached?.headers.get('cache-control')).toContain('max-age=86400');
  });

  it('схлопывает одновременные промахи в один запрос к CMS', async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fn = fetchMock(async () => {
      await gate;
      return cmsResponse();
    });

    const first = handleRequest(get('/api/rope/v1/catalog'), env, {
      fetchImpl: fn as unknown as typeof fetch,
    });
    const second = handleRequest(get('/api/rope/v1/catalog'), env, {
      fetchImpl: fn as unknown as typeof fetch,
    });

    release();
    const [a, b] = await Promise.all([first, second]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('не кеширует ошибки CMS', async () => {
    let healthy = false;
    const fn = fetchMock(async () => (healthy ? cmsResponse() : cmsResponse({}, 500)));

    const failed = await handleRequest(get('/api/rope/v1/catalog'), env, {
      fetchImpl: fn as unknown as typeof fetch,
    });
    expect(failed.status).toBe(503);

    healthy = true;
    const recovered = await handleRequest(get('/api/rope/v1/catalog'), env, {
      fetchImpl: fn as unknown as typeof fetch,
    });
    expect(recovered.status).toBe(200);
    expect((await json(recovered)).threads).toHaveLength(23);
  });

  it('preflight отвечает 204 и разрешает только известные origin', async () => {
    const preflight = (origin: string): Request =>
      new Request(`${API}/api/rope/v1/catalog`, {
        method: 'OPTIONS',
        headers: { origin, 'access-control-request-method': 'GET' },
      });

    const allowed = await handleRequest(preflight('https://www.glushkov-modelling.com'), env);
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe(
      'https://www.glushkov-modelling.com',
    );
    expect(allowed.headers.get('vary')).toBe('Origin');

    const foreign = await handleRequest(preflight('https://evil.example'), env);
    expect(foreign.status).toBe(204);
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('проставляет CORS-заголовок на обычный ответ', async () => {
    const fn = fetchMock(async () => cmsResponse());
    const response = await handleRequest(
      get('/api/rope/v1/catalog', { origin: 'https://glushkov-modelling.com' }),
      env,
      { fetchImpl: fn as unknown as typeof fetch },
    );

    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://glushkov-modelling.com',
    );
  });

  it('возвращает cf-ray как requestId', async () => {
    const response = await handleRequest(
      get('/api/rope/v1/nope', { 'cf-ray': '8f3c1a7b2e40-HEL' }),
      env,
    );

    expect((await json(response)).requestId).toBe('8f3c1a7b2e40-HEL');
  });
});
