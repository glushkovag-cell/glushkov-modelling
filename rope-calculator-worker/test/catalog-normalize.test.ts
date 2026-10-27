import { describe, expect, it } from 'vitest';
import { normalizeCatalog } from '../src/catalog/normalize';
import { errorCodeOf } from './helpers';

function node(overrides: {
  slug?: string;
  status?: string;
  threadId?: string;
  brand?: string;
  number?: string;
  dtex?: number;
  enabled?: boolean;
  sortOrder?: number;
  fields?: unknown;
}): Record<string, unknown> {
  const {
    slug = 'tera-40',
    status = 'publish',
    threadId = 'tera-40',
    brand = 'Tera',
    number = '40',
    dtex = 750,
    enabled = true,
    sortOrder = 304,
    fields,
  } = overrides;

  return {
    slug,
    status,
    ropethreadfields:
      fields !== undefined
        ? fields
        : { threadId, brand, number, dtex, enabled, sortOrder },
  };
}

describe('normalizeCatalog', () => {
  it('сортирует по sortOrder, затем по threadId', () => {
    const result = normalizeCatalog([
      node({ slug: 'b', threadId: 'b', sortOrder: 20 }),
      node({ slug: 'a', threadId: 'a', sortOrder: 20 }),
      node({ slug: 'c', threadId: 'c', sortOrder: 10 }),
    ]);

    expect(result.map((thread) => thread.threadId)).toEqual(['c', 'a', 'b']);
  });

  it('отбрасывает неопубликованные и отключённые записи', () => {
    const result = normalizeCatalog([
      node({ slug: 'active', threadId: 'active' }),
      node({ slug: 'draft', threadId: 'draft', status: 'draft' }),
      node({ slug: 'off', threadId: 'off', enabled: false }),
    ]);

    expect(result.map((thread) => thread.threadId)).toEqual(['active']);
  });

  it('обрезает пробелы и хранит number строкой', () => {
    const [thread] = normalizeCatalog([
      node({ threadId: ' tera-40 ', brand: ' Tera ', number: ' 40 ' }),
    ]);

    expect(thread).toEqual({
      threadId: 'tera-40',
      brand: 'Tera',
      number: '40',
      dtex: 750,
      sortOrder: 304,
      enabled: true,
    });
  });

  it.each([
    ['дубль threadId', [node({}), node({ slug: 'dup' })]],
    ['пустой каталог', []],
    ['каталог без активных нитей', [node({ enabled: false })]],
    ['нечисловой dtex', [node({ dtex: Number.NaN })]],
    ['пустой threadId', [node({ threadId: '   ' })]],
    ['пустой brand', [node({ brand: '' })]],
    ['отсутствующие ACF-поля', [node({ fields: null })]],
    ['узел не объект', [42]],
  ])('считает каталог некорректным: %s', (_label, nodes) => {
    expect(errorCodeOf(() => normalizeCatalog(nodes))).toBe('CATALOG_INVALID');
  });
});
