import { describe, expect, it, vi } from 'vitest';
import { fetchCatalogThreads, type Env } from '../src/catalog/client';

const env: Env = {
  WP_GRAPHQL_URL: 'https://cms.example.test/graphql',
  WP_GRAPHQL_SECRET: 's3cret',
};

interface RawNodeOptions {
  slug: string;
  status?: string;
  threadId?: string;
  brand?: string;
  number?: string;
  dtex?: number;
  enabled?: boolean;
  sortOrder?: number;
}

function rawNode(options: RawNodeOptions): Record<string, unknown> {
  const {
    slug,
    status = 'publish',
    threadId = slug,
    brand = 'Tera',
    number = '40',
    dtex = 750,
    enabled = true,
    sortOrder = 304,
  } = options;

  return {
    slug,
    status,
    ropethreadfields: { threadId, brand, number, dtex, enabled, sortOrder },
  };
}

function page(nodes: unknown[], hasNextPage = false, endCursor: string | null = null): unknown {
  return { data: { ropeThreads: { pageInfo: { hasNextPage, endCursor }, nodes } } };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fetchMock(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return vi.fn(handler);
}

describe('fetchCatalogThreads', () => {
  it('отправляет фиксированный запрос с секретом и возвращает активные нити', async () => {
    const fn = fetchMock(async () =>
      jsonResponse(
        page([
          rawNode({ slug: 'tera-40', sortOrder: 304 }),
          rawNode({ slug: 'tera-60', dtex: 500, sortOrder: 303 }),
          rawNode({ slug: 'draft', status: 'draft' }),
        ]),
      ),
    );

    const threads = await fetchCatalogThreads(env, {
      fetchImpl: fn as unknown as typeof fetch,
    });

    expect(threads.map((thread) => thread.threadId)).toEqual(['tera-60', 'tera-40']);

    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = fn.mock.calls[0]!;
    expect(String(url)).toBe(env.WP_GRAPHQL_URL);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['x-graphql-secret']).toBe('s3cret');

    const body = JSON.parse(String(init?.body)) as { variables: { first: number; after: string | null } };
    expect(body.variables).toEqual({ first: 100, after: null });
  });

  it('добирает каталог по курсору', async () => {
    const fn = fetchMock(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { variables: { after: string | null } };
      if (body.variables.after === null) {
        return jsonResponse(page([rawNode({ slug: 'a', sortOrder: 1 })], true, 'cursor-1'));
      }
      return jsonResponse(page([rawNode({ slug: 'b', sortOrder: 2 })]));
    });

    const threads = await fetchCatalogThreads(env, {
      fetchImpl: fn as unknown as typeof fetch,
    });

    expect(threads.map((thread) => thread.threadId)).toEqual(['a', 'b']);
    expect(fn).toHaveBeenCalledTimes(2);

    const secondBody = JSON.parse(String(fn.mock.calls[1]![1]?.body)) as {
      variables: { after: string | null };
    };
    expect(secondBody.variables.after).toBe('cursor-1');
  });

  it('падает на повторяющемся курсоре', async () => {
    const fn = fetchMock(async () => jsonResponse(page([rawNode({ slug: 'a' })], true, 'same')));

    await expect(
      fetchCatalogThreads(env, { fetchImpl: fn as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'CATALOG_INVALID' });
  });

  it.each([
    ['HTTP 500', async () => jsonResponse({}, 500)],
    ['GraphQL errors', async () => jsonResponse({ errors: [{ message: 'boom' }] })],
    ['невалидный JSON', async () => new Response('not json', { status: 200 })],
    ['нет данных', async () => jsonResponse({ data: null })],
    ['сетевой сбой', async () => Promise.reject(new Error('network down'))],
  ])('возвращает CATALOG_UNAVAILABLE: %s', async (_label, handler) => {
    const fn = fetchMock(handler as () => Promise<Response>);

    await expect(
      fetchCatalogThreads(env, { fetchImpl: fn as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'CATALOG_UNAVAILABLE' });
  });

  it('возвращает CATALOG_INVALID для неполного каталога', async () => {
    const fn = fetchMock(async () => jsonResponse(page([rawNode({ slug: 'a' }), rawNode({ slug: 'a' })])));

    await expect(
      fetchCatalogThreads(env, { fetchImpl: fn as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'CATALOG_INVALID' });
  });

  it('не делает запрос без endpoint', async () => {
    const fn = fetchMock(async () => jsonResponse(page([])));

    await expect(
      fetchCatalogThreads({ WP_GRAPHQL_URL: '' }, { fetchImpl: fn as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'CATALOG_UNAVAILABLE' });
    expect(fn).not.toHaveBeenCalled();
  });
});
