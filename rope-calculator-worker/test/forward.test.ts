import { describe, expect, it } from 'vitest';
import { computeForward } from '../src/core/forward';
import { catalog, errorCodeOf, relativeDifference } from './helpers';

describe('прямой расчёт', () => {
  it('считает по каталожной нити', () => {
    const result = computeForward(
      { basis: 'catalog', threadId: 'tera-40', threadsPerStrand: 2 },
      catalog,
    );

    expect(result.basis).toBe('catalog');
    expect(result.threadId).toBe('tera-40');
    expect(result.dtex).toBe(750);
    expect(result.threadsPerStrand).toBe(2);
    expect(result.strands).toBe(3);
    expect(result.construction).toBe('2 × 3');
    expect(relativeDifference(result.diameterMm, 0.9631868577202545)).toBeLessThan(1e-12);
  });

  it('не применяет диапазон 80–6000 к каталожной нити', () => {
    // tera-5 — 6000 dTex, верхняя граница совпадает, tera-8 — 3750.
    const tera5 = computeForward(
      { basis: 'catalog', threadId: 'tera-5', threadsPerStrand: 3 },
      catalog,
    );
    const tera8 = computeForward(
      { basis: 'catalog', threadId: 'tera-8', threadsPerStrand: 1 },
      catalog,
    );

    expect(tera5.diameterMm).toBeGreaterThan(3.7);
    expect(tera8.diameterMm).toBeGreaterThan(1.5);
  });

  it('считает по ручному dTex без каталога', () => {
    const result = computeForward({ basis: 'dtex', dtex: 750, threadsPerStrand: 2 }, []);

    expect(result.basis).toBe('dtex');
    expect(result.threadId).toBeNull();
    expect(relativeDifference(result.diameterMm, 0.9631868577202545)).toBeLessThan(1e-12);
  });

  it('отклоняет неизвестный threadId', () => {
    expect(
      errorCodeOf(() =>
        computeForward({ basis: 'catalog', threadId: 'nope', threadsPerStrand: 2 }, catalog),
      ),
    ).toBe('THREAD_NOT_FOUND');
  });

  it('отклоняет отключённую нить', () => {
    const withDisabled = catalog.map((thread) =>
      thread.threadId === 'tera-40' ? { ...thread, enabled: false } : thread,
    );

    expect(
      errorCodeOf(() =>
        computeForward({ basis: 'catalog', threadId: 'tera-40', threadsPerStrand: 2 }, withDisabled),
      ),
    ).toBe('THREAD_NOT_FOUND');
  });

  it('требует каталог для каталожного расчёта', () => {
    expect(
      errorCodeOf(() =>
        computeForward({ basis: 'catalog', threadId: 'tera-40', threadsPerStrand: 2 }, []),
      ),
    ).toBe('THREAD_NOT_FOUND');
  });
});
