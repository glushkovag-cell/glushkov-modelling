import { fetchCatalogThreads, type Env } from './client';
import { catalogVersion } from '../core/version';
import type { CatalogThread } from '../core/types';

/** Ключ кеша не зависит от параметров расчёта и версии каталога. */
export const CATALOG_CACHE_KEY = 'https://rope-catalog.internal/v1?schema=1';

/** TTL каталога: 24 часа. */
export const CATALOG_CACHE_TTL_SECONDS = 86400;

export interface CatalogSnapshot {
  threads: CatalogThread[];
  catalogVersion: string;
  fetchedAt: string;
}

export interface GetCatalogOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

/**
 * Схлопывание одновременных промахов в пределах изолята. Глобальной
 * блокировки нет: у каждого изолята свой Promise.
 */
let inFlight: Promise<CatalogSnapshot> | null = null;

function toResponse(snapshot: CatalogSnapshot): Response {
  return new Response(JSON.stringify(snapshot), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${CATALOG_CACHE_TTL_SECONDS}`,
    },
  });
}

/**
 * Возвращает каталог из кеша Cloudflare или читает его из CMS.
 *
 * Кеш уважает max-age, но локален для дата-центра и может быть вытеснен
 * раньше TTL — это ожидаемое поведение, а не ошибка. Ошибки CMS не кешируются
 * и не оставляют за собой залипший inFlight.
 */
export async function getCatalogSnapshot(
  env: Env,
  options: GetCatalogOptions = {},
): Promise<CatalogSnapshot> {
  const cache = caches.default;
  const cached = await cache.match(CATALOG_CACHE_KEY);
  if (cached) {
    return (await cached.json()) as CatalogSnapshot;
  }

  if (inFlight) {
    return inFlight;
  }

  inFlight = (async () => {
    const threads = await fetchCatalogThreads(env, { fetchImpl: options.fetchImpl });
    const snapshot: CatalogSnapshot = {
      threads,
      catalogVersion: await catalogVersion(threads),
      fetchedAt: (options.now?.() ?? new Date()).toISOString(),
    };

    try {
      await cache.put(CATALOG_CACHE_KEY, toResponse(snapshot));
    } catch (error) {
      // Кеш — оптимизация, а не источник истины: сбой записи не должен
      // ломать расчёт. Наблюдаемость покажет такие случаи в логах Worker.
      console.warn('Failed to cache rope catalog', error);
    }

    return snapshot;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Сброс кеша и inFlight. Нужен тестам и ручной инвалидации. */
export async function resetCatalogCache(): Promise<void> {
  inFlight = null;
  await caches.default.delete(CATALOG_CACHE_KEY);
}
