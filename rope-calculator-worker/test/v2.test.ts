import { describe, expect, it } from 'vitest';
import {
  TARGET_VERSIONS,
  computeForwardV2,
  findMatchesV2,
  parseForwardInputV2,
  parseReverseInputV2,
} from '../src/core/v2';
import { calculateDiameterMm } from '../src/core/model';
import { withinTolerance } from '../src/core/reverse';
import { RopeError } from '../src/core/errors';
import { TARGET_MAX_CUSTOM_DTEX, TARGET_MIN_CUSTOM_DTEX } from '../src/core/constants';
import { catalog, errorCodeOf } from './helpers';

function pairs(result: { matches: readonly { threadId: string; threadsPerStrand: number }[] }): string[] {
  return result.matches.map((match) => `${match.threadId} × ${match.threadsPerStrand}`);
}

describe('v2: версии ответа', () => {
  it('apiVersion, algorithmVersion и modelId зафиксированы', () => {
    expect(TARGET_VERSIONS).toEqual({
      apiVersion: '2',
      algorithmVersion: '4.0.0',
      modelId: 'log-dtex-quadratic-no-load',
    });
  });
});

describe('v2: разбор прямого расчёта', () => {
  it('принимает каталожный расчёт и обрезает threadId', () => {
    expect(
      parseForwardInputV2({ basis: 'catalog', threadId: ' tera-40 ', threadsPerStrand: 2 }),
    ).toEqual({ basis: 'catalog', threadId: 'tera-40', threadsPerStrand: 2 });
  });

  it('принимает ручной dTex на границах диапазона', () => {
    expect(parseForwardInputV2({ basis: 'dtex', dtex: TARGET_MIN_CUSTOM_DTEX, threadsPerStrand: 1 })).toEqual({
      basis: 'dtex',
      dtex: 22.22,
      threadsPerStrand: 1,
    });
    expect(parseForwardInputV2({ basis: 'dtex', dtex: TARGET_MAX_CUSTOM_DTEX, threadsPerStrand: 5 })).toEqual({
      basis: 'dtex',
      dtex: 6000,
      threadsPerStrand: 5,
    });
  });

  it.each([
    ['ниже минимума', 22.21],
    ['выше максимума', 6000.01],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['строка вместо числа', '750'],
  ])('отклоняет dTex: %s', (_label, dtex) => {
    expect(errorCodeOf(() => parseForwardInputV2({ basis: 'dtex', dtex, threadsPerStrand: 2 }))).toBe(
      'INVALID_PARAMS',
    );
  });

  it.each([0, 6, 1.5, '2', null])('отклоняет threadsPerStrand = %s', (threadsPerStrand) => {
    expect(
      errorCodeOf(() => parseForwardInputV2({ basis: 'dtex', dtex: 750, threadsPerStrand })),
    ).toBe('INVALID_PARAMS');
  });

  it('отклоняет неизвестный basis и пустой threadId', () => {
    expect(errorCodeOf(() => parseForwardInputV2({ basis: 'other' }))).toBe('INVALID_PARAMS');
    expect(
      errorCodeOf(() => parseForwardInputV2({ basis: 'catalog', threadId: '  ', threadsPerStrand: 2 })),
    ).toBe('INVALID_PARAMS');
  });

  it.each([null, [], 'body', 42])('отклоняет тело не-объект: %s', (body) => {
    expect(errorCodeOf(() => parseForwardInputV2(body))).toBe('INVALID_PARAMS');
  });
});

describe('v2: устаревшие поля нагрузки', () => {
  it.each([
    'loadMode',
    'loadGrams',
    'load',
    'appliedLoadGrams',
    'recommendedLoadGrams',
    'recommendedLoad',
    'loadRecommendationVersion',
  ])('отклоняет forward с полем %s', (field) => {
    const body = { basis: 'dtex', dtex: 750, threadsPerStrand: 2, [field]: 200 };
    expect(errorCodeOf(() => parseForwardInputV2(body))).toBe('INVALID_PARAMS');
  });

  it('перечисляет все неподдержанные поля в ошибке', () => {
    try {
      parseForwardInputV2({
        basis: 'dtex',
        dtex: 750,
        threadsPerStrand: 2,
        loadMode: 'manual',
        loadGrams: 200,
      });
      throw new Error('Ожидалась ошибка INVALID_PARAMS.');
    } catch (error) {
      expect(error).toBeInstanceOf(RopeError);
      expect((error as RopeError).code).toBe('INVALID_PARAMS');
      expect((error as RopeError).fields).toEqual(['loadMode', 'loadGrams']);
      expect((error as RopeError).message).toContain('loadMode, loadGrams');
    }
  });

  it('отклоняет поле нагрузки со значением null, а не игнорирует его', () => {
    expect(
      errorCodeOf(() =>
        parseForwardInputV2({ basis: 'dtex', dtex: 750, threadsPerStrand: 2, loadGrams: null }),
      ),
    ).toBe('INVALID_PARAMS');
  });

  it('отклоняет поля нагрузки в обратном подборе', () => {
    expect(errorCodeOf(() => parseReverseInputV2({ targetDiameterMm: 1, loadGrams: 300 }))).toBe(
      'INVALID_PARAMS',
    );
    expect(errorCodeOf(() => parseReverseInputV2({ targetDiameterMm: 1, loadMode: 'auto' }))).toBe(
      'INVALID_PARAMS',
    );
  });
});

describe('v2: разбор обратного подбора', () => {
  it('принимает target без списка нитей', () => {
    expect(parseReverseInputV2({ targetDiameterMm: 1 })).toEqual({ targetDiameterMm: 1 });
  });

  it('схлопывает дубли threadIds с сохранением порядка', () => {
    expect(parseReverseInputV2({ targetDiameterMm: 1.5, threadIds: ['tera-40', 'tera-60', 'tera-40'] })).toEqual({
      targetDiameterMm: 1.5,
      threadIds: ['tera-40', 'tera-60'],
    });
  });

  it.each([0, -1, Number.NaN, Number.NEGATIVE_INFINITY])('отклоняет targetDiameterMm = %s', (targetDiameterMm) => {
    expect(errorCodeOf(() => parseReverseInputV2({ targetDiameterMm }))).toBe('INVALID_PARAMS');
  });

  it.each([
    ['пустой массив', []],
    ['строка вместо массива', 'tera-40'],
    ['пустая строка в массиве', ['']],
    ['число в массиве', [1]],
  ])('отклоняет threadIds: %s', (_label, threadIds) => {
    expect(errorCodeOf(() => parseReverseInputV2({ targetDiameterMm: 1, threadIds }))).toBe('INVALID_PARAMS');
  });
});

describe('v2: прямой расчёт', () => {
  it('считает по каталожной нити', () => {
    const { result, warnings } = computeForwardV2(
      { basis: 'catalog', threadId: 'tera-40', threadsPerStrand: 2 },
      catalog,
    );

    expect(result).toMatchObject({
      basis: 'catalog',
      threadId: 'tera-40',
      dtex: 750,
      threadsPerStrand: 2,
      strands: 3,
      construction: '2 × 3',
    });
    expect(Math.abs(result.diameterMm - 1.0201549921706878)).toBeLessThan(1e-9);
    expect(warnings).toEqual([]);
  });

  it('считает по ручному dTex без каталога', () => {
    const { result } = computeForwardV2({ basis: 'dtex', dtex: 750, threadsPerStrand: 2 }, []);
    expect(result.threadId).toBeNull();
    expect(Math.abs(result.diameterMm - 1.0201549921706878)).toBeLessThan(1e-9);
  });

  it('не применяет диапазон 22.22–6000 к каталожной нити', () => {
    const tera5 = computeForwardV2({ basis: 'catalog', threadId: 'tera-5', threadsPerStrand: 3 }, catalog);
    const tera8 = computeForwardV2({ basis: 'catalog', threadId: 'tera-8', threadsPerStrand: 1 }, catalog);

    expect(Math.abs(tera5.result.diameterMm - 2.869711987982336)).toBeLessThan(1e-9);
    expect(Math.abs(tera8.result.diameterMm - 1.3765511360992075)).toBeLessThan(1e-9);
    expect(tera5.warnings.map((warning) => warning.code)).toEqual(['EXTRAPOLATION']);
    expect(tera8.warnings.map((warning) => warning.code)).toEqual(['EXTRAPOLATION']);
  });

  it('не предупреждает о экстраполяции для тонкой нити', () => {
    const { warnings } = computeForwardV2({ basis: 'dtex', dtex: 22.22, threadsPerStrand: 1 }, []);
    expect(warnings).toEqual([]);
  });

  it('отклоняет неизвестную и отключённую нить', () => {
    expect(
      errorCodeOf(() =>
        computeForwardV2({ basis: 'catalog', threadId: 'nope', threadsPerStrand: 2 }, catalog),
      ),
    ).toBe('THREAD_NOT_FOUND');

    const withDisabled = catalog.map((thread) =>
      thread.threadId === 'tera-40' ? { ...thread, enabled: false } : thread,
    );
    expect(
      errorCodeOf(() =>
        computeForwardV2({ basis: 'catalog', threadId: 'tera-40', threadsPerStrand: 2 }, withDisabled),
      ),
    ).toBe('THREAD_NOT_FOUND');
  });
});

describe('v2: обратный подбор', () => {
  it('на target = 1.0 даёт 10 совпадений в устойчивом порядке', () => {
    const result = findMatchesV2({ targetDiameterMm: 1 }, catalog);

    expect(result.matches).toHaveLength(10);
    expect(result.tolerance).toBe(0.1);
    expect(pairs(result)).toEqual([
      'mara-100 × 5',
      'tera-60 × 3',
      'tera-40 × 2',
      'tera-20 × 1',
      'tera-80 × 4',
      'mara-80 × 4',
      'tera-80 × 5',
      'mara-50 × 2',
      'mara-15 × 1',
      'tera-15 × 1',
    ]);
  });

  it('выдаёт диаметр и отклонение в процентах', () => {
    const [first] = findMatchesV2({ targetDiameterMm: 1 }, catalog).matches;
    expect(first).toBeDefined();
    if (!first) return;

    expect(first.threadId).toBe('mara-100');
    expect(first.construction).toBe('5 × 3');
    expect(first.diameterMm).toBe(calculateDiameterMm(300, 5));
    expect(first.deviationPercent).toBeCloseTo(-0.9282427818066208, 12);
  });

  it('порядок не зависит от порядка входа', () => {
    const straight = findMatchesV2({ targetDiameterMm: 1 }, catalog);
    const reversed = findMatchesV2({ targetDiameterMm: 1 }, [...catalog].reverse());
    expect(pairs(reversed)).toEqual(pairs(straight));
  });

  it('соблюдает границу допуска 10% включительно', () => {
    const diameter = calculateDiameterMm(750, 2);

    const inside = findMatchesV2({ targetDiameterMm: diameter / 1.0999, threadIds: ['tera-40'] }, catalog);
    const outside = findMatchesV2({ targetDiameterMm: diameter / 1.1001, threadIds: ['tera-40'] }, catalog);

    expect(inside.matches).toHaveLength(1);
    expect(outside.matches).toHaveLength(0);
  });

  it('фильтрует по неокруглённому отклонению', () => {
    const diameter = calculateDiameterMm(750, 2);

    const inside = findMatchesV2(
      { targetDiameterMm: diameter / 1.0999999, threadIds: ['tera-40'] },
      catalog,
    );
    const outside = findMatchesV2(
      { targetDiameterMm: diameter / 1.1000001, threadIds: ['tera-40'] },
      catalog,
    );

    expect(inside.matches).toHaveLength(1);
    expect(inside.matches[0]?.diameterMm.toFixed(3)).toBe('1.020');
    expect(outside.matches).toEqual([]);
  });

  it('правило допуска включительно по модулю', () => {
    expect(withinTolerance(0.1)).toBe(true);
    expect(withinTolerance(-0.1)).toBe(true);
    expect(withinTolerance(0.10000000000000002)).toBe(false);
    expect(withinTolerance(-0.10000000000000002)).toBe(false);
  });

  it('пустой результат — успешный ответ без предупреждений', () => {
    const result = findMatchesV2({ targetDiameterMm: 100 }, catalog);
    expect(result.matches).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('собирает предупреждения по выданным совпадениям', () => {
    const result = findMatchesV2({ targetDiameterMm: 3.5, threadIds: ['tera-5'] }, catalog);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.warnings.map((warning) => warning.code)).toEqual(['EXTRAPOLATION']);
  });

  it('проверяет только выбранные нити и свивки 1–5', () => {
    expect(pairs(findMatchesV2({ targetDiameterMm: 1, threadIds: ['tera-40'] }, catalog))).toEqual([
      'tera-40 × 2',
    ]);

    const counts = new Set(
      findMatchesV2({ targetDiameterMm: 4, threadIds: ['tera-5'] }, catalog).matches.map(
        (match) => match.threadsPerStrand,
      ),
    );
    for (const count of counts) {
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(5);
    }
  });

  it('отклоняет неизвестную и отключённую нить в явном списке', () => {
    expect(
      errorCodeOf(() => findMatchesV2({ targetDiameterMm: 1, threadIds: ['tera-40', 'nope'] }, catalog)),
    ).toBe('THREAD_NOT_FOUND');

    const withDisabled = catalog.map((thread) =>
      thread.threadId === 'tera-40' ? { ...thread, enabled: false } : thread,
    );
    expect(
      errorCodeOf(() => findMatchesV2({ targetDiameterMm: 1, threadIds: ['tera-40'] }, withDisabled)),
    ).toBe('THREAD_NOT_FOUND');
  });

  it('не включает отключённые нити при выборе всех', () => {
    const withDisabled = catalog.map((thread) =>
      thread.threadId === 'mara-100' ? { ...thread, enabled: false } : thread,
    );

    const all = pairs(findMatchesV2({ targetDiameterMm: 1 }, withDisabled));
    expect(all).not.toContain('mara-100 × 5');
    expect(all).toHaveLength(9);
  });
});
