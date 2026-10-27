import { describe, expect, it } from 'vitest';
import { findMatches, withinTolerance } from '../src/core/reverse';
import { calculateDiameterMm } from '../src/core/formula';
import { catalog, errorCodeOf, relativeDifference } from './helpers';

function pairs(result: { matches: readonly { threadId: string; threadsPerStrand: number }[] }): string[] {
  return result.matches.map((match) => `${match.threadId} × ${match.threadsPerStrand}`);
}

describe('обратный подбор', () => {
  it('на target = 1.0 даёт 11 совпадений в устойчивом порядке', () => {
    const result = findMatches({ targetDiameterMm: 1 }, catalog);

    expect(result.matches).toHaveLength(11);
    expect(result.tolerance).toBe(0.15);
    expect(pairs(result)).toEqual([
      'tera-60 × 3',
      'tera-40 × 2',
      'tera-20 × 1',
      'mara-50 × 3',
      'mara-15 × 1',
      'tera-15 × 1',
      'mara-30 × 2',
      'tera-30 × 2',
      'mara-80 × 3',
      'mara-70 × 3',
      'mara-50 × 2',
    ]);
  });

  it('выдаёт диаметр и отклонение в процентах', () => {
    const [first] = findMatches({ targetDiameterMm: 1 }, catalog).matches;
    expect(first).toBeDefined();
    if (!first) return;

    expect(first.threadId).toBe('tera-60');
    expect(first.construction).toBe('3 × 3');
    expect(relativeDifference(first.diameterMm, 0.9806440349690794)).toBeLessThan(1e-12);
    expect(first.deviationPercent).toBeCloseTo(-1.935596503092063, 10);
  });

  it('порядок не зависит от порядка входа', () => {
    const straight = findMatches({ targetDiameterMm: 1 }, catalog);
    const reversed = findMatches({ targetDiameterMm: 1 }, [...catalog].reverse());

    expect(pairs(reversed)).toEqual(pairs(straight));
  });

  it('включает границу допуска и исключает выход за неё', () => {
    const diameter = calculateDiameterMm(750, 2);

    const inside = findMatches(
      { targetDiameterMm: diameter / 1.1499, threadIds: ['tera-40'] },
      catalog,
    );
    const outside = findMatches(
      { targetDiameterMm: diameter / 1.1501, threadIds: ['tera-40'] },
      catalog,
    );

    expect(inside.matches).toHaveLength(1);
    expect(outside.matches).toHaveLength(0);
  });

  it('правило допуска включительно по модулю', () => {
    expect(withinTolerance(0.15)).toBe(true);
    expect(withinTolerance(-0.15)).toBe(true);
    expect(withinTolerance(0.15000000000000002)).toBe(false);
    expect(withinTolerance(-0.15000000000000002)).toBe(false);
  });

  it('возвращает пустой список, если совпадений нет', () => {
    const result = findMatches({ targetDiameterMm: 100 }, catalog);
    expect(result.matches).toEqual([]);
  });

  it('проверяет только выбранные нити', () => {
    const result = findMatches({ targetDiameterMm: 1, threadIds: ['tera-40'] }, catalog);
    expect(pairs(result)).toEqual(['tera-40 × 2']);
  });

  it('отклоняет неизвестный threadId', () => {
    expect(
      errorCodeOf(() => findMatches({ targetDiameterMm: 1, threadIds: ['tera-40', 'nope'] }, catalog)),
    ).toBe('THREAD_NOT_FOUND');
  });

  it('отклоняет отключённую нить в явном списке', () => {
    const withDisabled = catalog.map((thread) =>
      thread.threadId === 'tera-40' ? { ...thread, enabled: false } : thread,
    );

    expect(
      errorCodeOf(() =>
        findMatches({ targetDiameterMm: 1, threadIds: ['tera-40'] }, withDisabled),
      ),
    ).toBe('THREAD_NOT_FOUND');
  });

  it('не включает отключённые нити при выборе всех', () => {
    const withDisabled = catalog.map((thread) =>
      thread.threadId === 'tera-60' ? { ...thread, enabled: false } : thread,
    );

    const all = pairs(findMatches({ targetDiameterMm: 1 }, withDisabled));
    expect(all).not.toContain('tera-60 × 3');
    expect(all).toHaveLength(10);
  });
});
