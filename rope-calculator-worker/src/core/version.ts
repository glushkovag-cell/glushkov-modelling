import type { CatalogThread } from './types';

const encoder = new TextEncoder();

function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Версия каталога: первые 12 hex-символов sha-256 от канонического JSON.
 *
 * Канонический вид фиксирован и совпадает с генератором фикстур
 * (scripts/gen-rope-fixtures.mjs): записи сортируются по sortOrder, затем по
 * threadId, и сериализуются с полями в порядке threadId, brand, number, dtex,
 * sortOrder, enabled. Любое изменение данных меняет версию, порядок входа —
 * нет.
 */
export async function catalogVersion(threads: readonly CatalogThread[]): Promise<string> {
  const canonical = [...threads]
    .sort((a, b) => a.sortOrder - b.sortOrder || compareIds(a.threadId, b.threadId))
    .map((thread) => ({
      threadId: thread.threadId,
      brand: thread.brand,
      number: thread.number,
      dtex: thread.dtex,
      sortOrder: thread.sortOrder,
      enabled: thread.enabled,
    }));

  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(canonical)));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');

  return hex.slice(0, 12);
}
