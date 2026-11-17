import { describe, expect, it } from 'vitest';
import { calculateDiameterMm, recommendLoadGrams, totalDtex } from '../src/core/load-model';
import { withinTolerance } from '../src/core/reverse';
import {
  computeForwardV2,
  findMatchesV2,
  parseForwardInputV2,
  parseLoadSelection,
  parseReverseInputV2,
} from '../src/core/v2';
import { catalog, errorCodeOf } from './helpers';

const LOADS = [30, 50, 100, 150, 200, 250, 300] as const;

describe('v2: разбор loadMode / loadGrams', () => {
  it('отсутствие loadMode означает auto', () => {
    expect(parseLoadSelection({})).toEqual({ loadMode: 'auto' });
  });

  it('auto без груза', () => {
    expect(parseLoadSelection({ loadMode: 'auto' })).toEqual({ loadMode: 'auto' });
  });

  it.each(LOADS)('manual с грузом %s г', (grams) => {
    expect(parseLoadSelection({ loadMode: 'manual', loadGrams: grams })).toEqual({
      loadMode: 'manual',
      loadGrams: grams,
    });
  });

  it.each([
    ['manual без loadGrams', { loadMode: 'manual' }],
    ['auto вместе с loadGrams', { loadMode: 'auto', loadGrams: 200 }],
    ['loadGrams без loadMode', { loadGrams: 200 }],
    ['неизвестный режим', { loadMode: 'optimal' }],
    ['режим не строкой', { loadMode: 1 }],
    ['режим null', { loadMode: null }],
    ['неподдержанный вес', { loadMode: 'manual', loadGrams: 120 }],
    ['вес без округления', { loadMode: 'manual', loadGrams: 199.9 }],
    ['нулевой вес', { loadMode: 'manual', loadGrams: 0 }],
    ['отрицательный вес', { loadMode: 'manual', loadGrams: -30 }],
    ['NaN', { loadMode: 'manual', loadGrams: Number.NaN }],
    ['Infinity', { loadMode: 'manual', loadGrams: Number.POSITIVE_INFINITY }],
    ['вес строкой', { loadMode: 'manual', loadGrams: '200' }],
    ['вес null', { loadMode: 'manual', loadGrams: null }],
  ])('отклоняет: %s', (_label, body) => {
    expect(errorCodeOf(() => parseLoadSelection(body as Record<string, unknown>))).toBe('INVALID_PARAMS');
  });
});

describe('v2: разбор прямого расчёта', () => {
  it('ручной dTex 20–6000 включительно', () => {
    expect(parseForwardInputV2({ basis: 'dtex', dtex: 20, threadsPerStrand: 1 })).toEqual({
      basis: 'dtex',
      dtex: 20,
      threadsPerStrand: 1,
      loadMode: 'auto',
    });
    expect(parseForwardInputV2({ basis: 'dtex', dtex: 22.22, threadsPerStrand: 1 }).basis).toBe('dtex');
    expect(parseForwardInputV2({ basis: 'dtex', dtex: 6000, threadsPerStrand: 5 }).basis).toBe('dtex');
  });

  it.each([19.999, 6000.001, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, '750', null])(
    'отклоняет dTex %s',
    (dtex) => {
      expect(errorCodeOf(() => parseForwardInputV2({ basis: 'dtex', dtex, threadsPerStrand: 2 }))).toBe(
        'INVALID_PARAMS',
      );
    },
  );

  it.each([0, 6, 1.5, -1, '2', null, Number.NaN])('отклоняет threadsPerStrand %s', (threadsPerStrand) => {
    expect(errorCodeOf(() => parseForwardInputV2({ basis: 'dtex', dtex: 750, threadsPerStrand }))).toBe(
      'INVALID_PARAMS',
    );
  });

  it('manual-груз в каталожном запросе', () => {
    expect(
      parseForwardInputV2({
        basis: 'catalog',
        threadId: ' tera-40 ',
        threadsPerStrand: 2,
        loadMode: 'manual',
        loadGrams: 150,
      }),
    ).toEqual({ basis: 'catalog', threadId: 'tera-40', threadsPerStrand: 2, loadMode: 'manual', loadGrams: 150 });
  });

  it('некорректный груз отклоняется и в каталожном запросе', () => {
    expect(
      errorCodeOf(() =>
        parseForwardInputV2({ basis: 'catalog', threadId: 'tera-40', threadsPerStrand: 2, loadMode: 'manual' }),
      ),
    ).toBe('INVALID_PARAMS');
  });
});

describe('v2: разбор обратного подбора', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '1', null])('отклоняет target %s', (targetDiameterMm) => {
    expect(errorCodeOf(() => parseReverseInputV2({ targetDiameterMm }))).toBe('INVALID_PARAMS');
  });

  it('по умолчанию auto и весь каталог', () => {
    expect(parseReverseInputV2({ targetDiameterMm: 1 })).toEqual({ targetDiameterMm: 1, loadMode: 'auto' });
  });

  it('manual и список нитей без дублей', () => {
    expect(
      parseReverseInputV2({ targetDiameterMm: 1, threadIds: ['tera-40', 'tera-40'], loadMode: 'manual', loadGrams: 30 }),
    ).toEqual({ targetDiameterMm: 1, threadIds: ['tera-40'], loadMode: 'manual', loadGrams: 30 });
  });

  it('auto вместе с loadGrams отклоняется', () => {
    expect(errorCodeOf(() => parseReverseInputV2({ targetDiameterMm: 1, loadMode: 'auto', loadGrams: 30 }))).toBe(
      'INVALID_PARAMS',
    );
  });
});

describe('v2: прямой расчёт', () => {
  it('auto: S, рекомендованный и применённый груз, диаметр', () => {
    const { result, warnings } = computeForwardV2({ basis: 'dtex', dtex: 80, threadsPerStrand: 2, loadMode: 'auto' });

    expect(result).toMatchObject({
      basis: 'dtex',
      threadId: null,
      dtex: 80,
      threadsPerStrand: 2,
      strands: 3,
      construction: '2 × 3',
      totalDtex: 480,
      loadMode: 'auto',
      recommendedLoadGrams: 150,
      appliedLoadGrams: 150,
    });
    expect(Math.abs(result.diameterMm - 0.24069446380613793)).toBeLessThan(1e-12);
    expect(warnings.map((warning) => warning.code)).toEqual([
      'EMPIRICAL_MODEL',
      'RECOMMENDED_LOAD_STARTING_SUGGESTION',
      'UNVERIFIED_LOAD',
    ]);
  });

  it('manual: применяется выбранный груз, рекомендация сохраняется', () => {
    const { result } = computeForwardV2({
      basis: 'catalog',
      threadId: 'tera-40',
      threadsPerStrand: 2,
      loadMode: 'manual',
      loadGrams: 300,
    }, catalog);

    expect(result.dtex).toBe(750);
    expect(result.loadMode).toBe('manual');
    expect(result.recommendedLoadGrams).toBe(300);
    expect(result.appliedLoadGrams).toBe(300);
    expect(Math.abs(result.diameterMm - 1.0182712421634583)).toBeLessThan(1e-12);
  });

  it('эталоны общего набора через прямой расчёт', () => {
    const cases: [number, 1 | 2 | 3, (typeof LOADS)[number], number][] = [
      [80, 1, 30, 0.10854300211917706],
      [80, 1, 50, 0.12493176673267944],
      [80, 2, 150, 0.24069446380613793],
      [300, 3, 300, 0.7500614849457122],
      [750, 2, 300, 1.0182712421634583],
      [22.22, 1, 30, 0.05302633236570825],
    ];
    for (const [dtex, threadsPerStrand, loadGrams, expected] of cases) {
      const { result } = computeForwardV2({ basis: 'dtex', dtex, threadsPerStrand, loadMode: 'manual', loadGrams });
      expect(Math.abs(result.diameterMm - expected)).toBeLessThan(1e-12);
    }
  });

  it('ручной и автоматический режимы совпадают при одинаковом грузе', () => {
    for (const thread of catalog) {
      for (const threadsPerStrand of [1, 2, 3, 4, 5] as const) {
        const auto = computeForwardV2({ basis: 'catalog', threadId: thread.threadId, threadsPerStrand, loadMode: 'auto' }, catalog);
        const manual = computeForwardV2({
          basis: 'catalog',
          threadId: thread.threadId,
          threadsPerStrand,
          loadMode: 'manual',
          loadGrams: auto.result.appliedLoadGrams,
        }, catalog);
        expect(Math.abs(auto.result.diameterMm - manual.result.diameterMm)).toBeLessThan(1e-9);
      }
    }
  });

  it('предупреждение о dTex вне измеренного диапазона', () => {
    const { warnings } = computeForwardV2({ basis: 'dtex', dtex: 20, threadsPerStrand: 1, loadMode: 'auto' });
    expect(warnings.map((warning) => warning.code)).toContain('DTEX_OUTSIDE_MEASURED_RANGE');
  });

  it('неизвестная нить — THREAD_NOT_FOUND', () => {
    expect(
      errorCodeOf(() => computeForwardV2({ basis: 'catalog', threadId: 'nope', threadsPerStrand: 2, loadMode: 'auto' }, catalog)),
    ).toBe('THREAD_NOT_FOUND');
  });
});

describe('v2: обратный подбор', () => {
  const pairs = (matches: readonly { threadId: string; threadsPerStrand: number }[]) =>
    matches.map((match) => `${match.threadId} × ${match.threadsPerStrand}`);

  it('auto: груз считается для каждой нити и свивки', () => {
    const result = findMatchesV2({ targetDiameterMm: 0.5, loadMode: 'auto' }, catalog);

    expect(result.tolerance).toBe(0.1);
    expect(result.loadMode).toBe('auto');
    expect(result.matches.length).toBeGreaterThan(0);
    for (const match of result.matches) {
      expect(match.totalDtex).toBe(totalDtex(match.dtex, match.threadsPerStrand));
      expect(match.recommendedLoadGrams).toBe(recommendLoadGrams(match.dtex, match.threadsPerStrand));
      expect(match.appliedLoadGrams).toBe(match.recommendedLoadGrams);
      expect(match.diameterMm).toBe(calculateDiameterMm(match.dtex, match.threadsPerStrand, match.appliedLoadGrams));
      expect(Math.abs(match.deviationPercent)).toBeLessThanOrEqual(10);
    }
  });

  it('auto: у кандидатов могут быть разные грузы', () => {
    const result = findMatchesV2({ targetDiameterMm: 0.3, loadMode: 'auto' }, catalog);
    const all = findMatchesV2({ targetDiameterMm: 0.45, loadMode: 'auto' }, catalog);
    const grams = new Set([...result.matches, ...all.matches].map((match) => match.appliedLoadGrams));
    expect(grams.size).toBeGreaterThan(1);
  });

  it('manual: груз одинаков для всех кандидатов, рекомендация у каждого своя', () => {
    const result = findMatchesV2({ targetDiameterMm: 1, loadMode: 'manual', loadGrams: 200 }, catalog);

    expect(result.matches.length).toBeGreaterThan(0);
    for (const match of result.matches) {
      expect(match.appliedLoadGrams).toBe(200);
      expect(match.recommendedLoadGrams).toBe(recommendLoadGrams(match.dtex, match.threadsPerStrand));
    }
  });

  it('target = 1.0, auto: устойчивый порядок', () => {
    const result = findMatchesV2({ targetDiameterMm: 1, loadMode: 'auto' }, catalog);
    expect(pairs(result.matches)).toEqual([
      'tera-60 × 3',
      'tera-40 × 2',
      'mara-80 × 4',
      'mara-100 × 5',
      'tera-80 × 4',
      'tera-20 × 1',
      'tera-80 × 5',
    ]);
    expect(pairs(findMatchesV2({ targetDiameterMm: 1, loadMode: 'auto' }, [...catalog].reverse()).matches)).toEqual(
      pairs(result.matches),
    );
  });

  it('включает границу ±10% и исключает выход за неё', () => {
    const diameter = calculateDiameterMm(750, 2, recommendLoadGrams(750, 2));
    const inside = findMatchesV2({ targetDiameterMm: diameter / 1.0999, threadIds: ['tera-40'], loadMode: 'auto' }, catalog);
    const outside = findMatchesV2({ targetDiameterMm: diameter / 1.1001, threadIds: ['tera-40'], loadMode: 'auto' }, catalog);
    const insideLow = findMatchesV2({ targetDiameterMm: diameter / 0.9001, threadIds: ['tera-40'], loadMode: 'auto' }, catalog);
    const outsideLow = findMatchesV2({ targetDiameterMm: diameter / 0.8999, threadIds: ['tera-40'], loadMode: 'auto' }, catalog);

    expect(pairs(inside.matches)).toContain('tera-40 × 2');
    expect(pairs(outside.matches)).not.toContain('tera-40 × 2');
    expect(pairs(insideLow.matches)).toContain('tera-40 × 2');
    expect(pairs(outsideLow.matches)).not.toContain('tera-40 × 2');
    expect(withinTolerance(0.1)).toBe(true);
    expect(withinTolerance(-0.1)).toBe(true);
  });

  it('фильтр по неокруглённому отклонению и отклонение от target', () => {
    const result = findMatchesV2({ targetDiameterMm: 0.8, loadMode: 'auto' }, catalog);
    for (const match of result.matches) {
      expect(match.deviationPercent).toBe(((match.diameterMm - 0.8) / 0.8) * 100);
    }
  });

  it('пустой результат — успешный ответ', () => {
    const result = findMatchesV2({ targetDiameterMm: 100, loadMode: 'auto' }, catalog);
    expect(result.matches).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'EMPIRICAL_MODEL',
      'RECOMMENDED_LOAD_STARTING_SUGGESTION',
    ]);
  });

  it('manual с непроверенным грузом — предупреждение', () => {
    const result = findMatchesV2({ targetDiameterMm: 1, loadMode: 'manual', loadGrams: 250 }, catalog);
    expect(result.warnings.map((warning) => warning.code)).toContain('UNVERIFIED_LOAD');
  });

  it('проверяет свивки 1–5', () => {
    const result = findMatchesV2({ targetDiameterMm: 1, loadMode: 'auto' }, catalog);
    const counts = new Set(result.matches.map((match) => match.threadsPerStrand));
    expect([...counts].every((count) => count >= 1 && count <= 5)).toBe(true);
    expect(counts.has(5)).toBe(true);
  });

  it('неизвестная нить — THREAD_NOT_FOUND', () => {
    expect(
      errorCodeOf(() => findMatchesV2({ targetDiameterMm: 1, threadIds: ['nope'], loadMode: 'auto' }, catalog)),
    ).toBe('THREAD_NOT_FOUND');
  });
});
