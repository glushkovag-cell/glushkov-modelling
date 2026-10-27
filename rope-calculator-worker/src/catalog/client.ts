import { RopeError } from '../core/errors';
import type { CatalogThread } from '../core/types';
import { normalizeCatalog } from './normalize';
import { CATALOG_MAX_PAGES, CATALOG_PAGE_SIZE, ROPE_CATALOG_QUERY } from './query';

/** Переменные окружения Worker, нужные каталогу. */
export interface Env {
  /** GraphQL endpoint WordPress, например https://cms.example.com/graphql. */
  WP_GRAPHQL_URL: string;
  /** Общий с сайтом секрет; CMS без него отвечает 404. */
  WP_GRAPHQL_SECRET?: string;
}

export interface FetchCatalogOptions {
  /** Подмена fetch для тестов. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  pageSize?: number;
  maxPages?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

interface CatalogPage {
  nodes: unknown[];
  hasNextPage: boolean;
  endCursor: string | null;
}

function unavailable(message: string): RopeError {
  return new RopeError('CATALOG_UNAVAILABLE', message);
}

function parsePage(payload: unknown): CatalogPage {
  if (typeof payload !== 'object' || payload === null) {
    throw unavailable('CMS returned a non-object GraphQL response.');
  }

  const body = payload as Record<string, unknown>;

  if (Array.isArray(body.errors) && body.errors.length > 0) {
    throw unavailable(`CMS returned GraphQL errors: ${JSON.stringify(body.errors)}`);
  }

  const data = body.data;
  if (typeof data !== 'object' || data === null) {
    throw unavailable('CMS response has no data.');
  }

  const connection = (data as Record<string, unknown>).ropeThreads;
  if (typeof connection !== 'object' || connection === null) {
    throw unavailable('CMS response has no ropeThreads connection.');
  }

  const { nodes, pageInfo } = connection as Record<string, unknown>;
  if (!Array.isArray(nodes)) {
    throw unavailable('CMS response has no ropeThreads.nodes array.');
  }

  const info = typeof pageInfo === 'object' && pageInfo !== null ? (pageInfo as Record<string, unknown>) : {};
  const endCursor = typeof info.endCursor === 'string' && info.endCursor !== '' ? info.endCursor : null;

  return {
    nodes,
    hasNextPage: info.hasNextPage === true,
    endCursor,
  };
}

async function requestPage(
  endpoint: string,
  env: Env,
  after: string | null,
  options: Required<Pick<FetchCatalogOptions, 'timeoutMs' | 'pageSize'>> & FetchCatalogOptions,
): Promise<CatalogPage> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (env.WP_GRAPHQL_SECRET) {
    headers['x-graphql-secret'] = env.WP_GRAPHQL_SECRET;
  }

  const fetchImpl = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: ROPE_CATALOG_QUERY,
        variables: { first: options.pageSize, after },
      }),
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw unavailable(`CMS request failed: ${reason}`);
  }

  if (!response.ok) {
    throw unavailable(`CMS returned HTTP ${response.status}.`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw unavailable('CMS returned invalid JSON.');
  }

  return parsePage(payload);
}

/**
 * Читает каталог из CMS по фиксированному запросу.
 *
 * Собирает все страницы по курсору и возвращает нормализованный список
 * активных нитей. Любая проблема CMS поднимается как RopeError:
 * CATALOG_UNAVAILABLE — CMS недоступна или ответила ошибкой,
 * CATALOG_INVALID — данные неполны или противоречивы.
 */
export async function fetchCatalogThreads(
  env: Env,
  options: FetchCatalogOptions = {},
): Promise<CatalogThread[]> {
  const endpoint = env.WP_GRAPHQL_URL?.trim();
  if (!endpoint) {
    throw unavailable('CMS endpoint is not configured.');
  }

  const settings = {
    ...options,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    pageSize: options.pageSize ?? CATALOG_PAGE_SIZE,
    maxPages: options.maxPages ?? CATALOG_MAX_PAGES,
  };

  const nodes: unknown[] = [];
  let after: string | null = null;

  for (let page = 0; page < settings.maxPages; page += 1) {
    const result = await requestPage(endpoint, env, after, settings);
    nodes.push(...result.nodes);

    if (!result.hasNextPage) {
      return normalizeCatalog(nodes);
    }

    if (!result.endCursor || result.endCursor === after) {
      throw new RopeError(
        'CATALOG_INVALID',
        'CMS pagination did not advance: cursor is missing or repeated.',
      );
    }

    after = result.endCursor;
  }

  throw new RopeError(
    'CATALOG_INVALID',
    `CMS catalog did not fit into ${settings.maxPages} pages.`,
  );
}
