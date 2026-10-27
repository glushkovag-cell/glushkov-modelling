import { describe, expect, it } from 'vitest';
import { catalogVersion } from '../src/core/version';
import { catalog, relativeDifference, snapshot } from './helpers';

describe('каталог CMS', () => {
  it('содержит 23 активные нити и 69 конструкций', () => {
    expect(snapshot.threads).toHaveLength(23);

    let checked = 0;
    for (const thread of snapshot.threads) {
      for (const key of ['1', '2', '3'] as const) {
        const expected = thread.diametersMm[key];
        expect(expected).toBeGreaterThan(0);
        checked += 1;
      }
    }

    expect(checked).toBe(69);
  });

  it('отсортирован по sortOrder, затем по threadId', () => {
    const ids = snapshot.threads.map((thread) => thread.threadId);
    const expected = [...snapshot.threads]
      .sort((a, b) => a.sortOrder - b.sortOrder || (a.threadId < b.threadId ? -1 : 1))
      .map((thread) => thread.threadId);

    expect(ids).toEqual(expected);
  });

  it('catalogVersion воспроизводится из данных', async () => {
    await expect(catalogVersion(catalog)).resolves.toBe(snapshot.catalogVersion);
  });

  it('версия не зависит от порядка входа', async () => {
    const reversed = [...catalog].reverse();
    expect(await catalogVersion(reversed)).toBe(snapshot.catalogVersion);
  });

  it('версия меняется при изменении любого поля', async () => {
    const [first] = catalog;
    expect(first).toBeDefined();

    const changedDtex = catalog.map((thread, index) =>
      index === 0 ? { ...thread, dtex: thread.dtex + 1 } : thread,
    );
    const changedOrder = catalog.map((thread, index) =>
      index === 0 ? { ...thread, sortOrder: thread.sortOrder + 1000 } : thread,
    );

    expect(await catalogVersion(changedDtex)).not.toBe(snapshot.catalogVersion);
    expect(await catalogVersion(changedOrder)).not.toBe(snapshot.catalogVersion);
  });

  it('значения совпадают с формулой для каждой нити', async () => {
    const { calculateDiameterMm } = await import('../src/core/formula');

    for (const thread of snapshot.threads) {
      for (const key of ['1', '2', '3'] as const) {
        const actual = calculateDiameterMm(thread.dtex, Number(key));
        expect(relativeDifference(actual, thread.diametersMm[key])).toBeLessThan(1e-12);
      }
    }
  });
});
