import { RopeError } from '../core/errors';
import type { CatalogThread } from '../core/types';

function invalid(message: string): RopeError {
  return new RopeError('CATALOG_INVALID', message);
}

function requireString(value: unknown, field: string, slug: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid(`Catalog record ${slug || '<unknown>'} has no valid ${field}.`);
  }
  return value.trim();
}

function requireFinite(value: unknown, field: string, slug: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalid(`Catalog record ${slug || '<unknown>'} has no valid ${field}.`);
  }
  return value;
}

/**
 * Приводит узлы GraphQL к каталогу Worker.
 *
 * Отбрасываются неопубликованные и отключённые записи, поэтому отключение
 * нити в CMS убирает её из API. Дубли threadId, отсутствующие поля и пустой
 * результат считаются некорректным каталогом: такой ответ нельзя кешировать
 * и нельзя отдавать клиенту.
 */
export function normalizeCatalog(nodes: readonly unknown[]): CatalogThread[] {
  const active: CatalogThread[] = [];
  const seen = new Set<string>();

  for (const node of nodes) {
    if (typeof node !== 'object' || node === null) {
      throw invalid('Catalog node is not an object.');
    }

    const record = node as Record<string, unknown>;
    const slug = typeof record.slug === 'string' ? record.slug : '';
    const status = record.status;

    if (status !== 'publish') continue;

    const fields = record.ropethreadfields;
    if (typeof fields !== 'object' || fields === null) {
      throw invalid(`Catalog record ${slug || '<unknown>'} has no ACF fields.`);
    }

    const fieldRecord = fields as Record<string, unknown>;
    const threadId = requireString(fieldRecord.threadId, 'threadId', slug);

    if (seen.has(threadId)) {
      throw invalid(`Duplicate threadId in catalog: ${threadId}.`);
    }
    seen.add(threadId);

    if (fieldRecord.enabled !== true) continue;

    active.push({
      threadId,
      brand: requireString(fieldRecord.brand, 'brand', slug),
      number: requireString(fieldRecord.number, 'number', slug),
      dtex: requireFinite(fieldRecord.dtex, 'dtex', slug),
      sortOrder: requireFinite(fieldRecord.sortOrder, 'sortOrder', slug),
      enabled: true,
    });
  }

  if (active.length === 0) {
    throw invalid('Catalog has no published and enabled threads.');
  }

  return active.sort(
    (a, b) => a.sortOrder - b.sortOrder || (a.threadId < b.threadId ? -1 : a.threadId > b.threadId ? 1 : 0),
  );
}
