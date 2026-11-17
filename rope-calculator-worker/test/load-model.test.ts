import { describe, expect, it } from 'vitest';
import calibration from '../../data/rope-calibration/coefficients.json';
import {
  COEFFICIENTS,
  LOAD_ALGORITHM_VERSION,
  LOAD_GRAMS,
  LOAD_RECOMMENDATION_VERSION,
  LOAD_THRESHOLDS,
  MAX_RECOMMENDED_LOAD_GRAMS,
  calculateDiameterMm,
  isLoadGrams,
  modelWarnings,
  recommendLoadGrams,
  resolveLoad,
  totalDtex,
} from '../src/core/load-model';

/** Эталоны общего набора из ТЗ: (x, n, w) → D, мм. */
const GOLDEN: readonly [number, number, number, number][] = [
  [80, 1, 30, 0.10854300211917706],
  [80, 1, 50, 0.12493176673267944],
  [80, 2, 150, 0.24069446380613793],
  [300, 3, 300, 0.7500614849457122],
  [750, 2, 300, 1.0182712421634583],
  [22.22, 1, 30, 0.05302633236570825],
];

/** Рекомендация от суммарного dTex: n = 1, x = S / 3. */
const loadForTotal = (total: number) => recommendLoadGrams(total / 3, 1);

describe('модель 3.0.0: версии и коэффициенты', () => {
  it('версии алгоритма и рекомендации', () => {
    expect(LOAD_ALGORITHM_VERSION).toBe('3.0.0');
    expect(LOAD_RECOMMENDATION_VERSION).toBe('1.0.0');
    expect(calibration.algorithmVersion).toBe(LOAD_ALGORITHM_VERSION);
    expect(calibration.loadRecommendationVersion).toBe(LOAD_RECOMMENDATION_VERSION);
  });

  it('коэффициенты совпадают с зафиксированным набором калибровки', () => {
    expect(COEFFICIENTS).toEqual(calibration.shipped);
  });

  it('подбор калибровки совпадает с коэффициентами до 1e-6', () => {
    for (const key of Object.keys(COEFFICIENTS) as (keyof typeof COEFFICIENTS)[]) {
      const fitted = calibration.fitted[key];
      expect(Math.abs(fitted - COEFFICIENTS[key]) / Math.abs(COEFFICIENTS[key])).toBeLessThan(1e-6);
    }
  });

  it('пороги и допустимые грузы совпадают с калибровкой', () => {
    expect([...LOAD_GRAMS]).toEqual(calibration.allowedLoadsGrams);
    expect([
      ...LOAD_THRESHOLDS,
      { totalDtexBelow: null, loadGrams: MAX_RECOMMENDED_LOAD_GRAMS },
    ]).toEqual(calibration.loadThresholds);
  });
});

describe('calculateDiameterMm', () => {
  it.each(GOLDEN)('(%s, %s, %s) → %s', (x, n, w, expected) => {
    expect(Math.abs(calculateDiameterMm(x, n, w) - expected)).toBeLessThan(1e-12);
  });

  it('при w = 200 множитель нагрузки равен единице', () => {
    const base = COEFFICIENTS.a * Math.pow(750, COEFFICIENTS.b) * Math.pow(2, COEFFICIENTS.c);
    expect(calculateDiameterMm(750, 2, 200)).toBe(base);
  });

  it('ручной и автоматический режимы дают одинаковый D при одинаковых x, n, w', () => {
    for (const x of [22.22, 80, 300, 750, 3000, 6000]) {
      for (const n of [1, 2, 3, 4, 5]) {
        const auto = resolveLoad({ dtex: x, threadsPerStrand: n, loadMode: 'auto' });
        const manual = resolveLoad({
          dtex: x,
          threadsPerStrand: n,
          loadMode: 'manual',
          loadGrams: auto.appliedLoadGrams,
        });
        const dAuto = calculateDiameterMm(x, n, auto.appliedLoadGrams);
        const dManual = calculateDiameterMm(x, n, manual.appliedLoadGrams);
        expect(Math.abs(dAuto - dManual)).toBeLessThan(1e-9);
      }
    }
  });

  it('диаметр растёт с грузом', () => {
    const diameters = LOAD_GRAMS.map((w) => calculateDiameterMm(300, 2, w));
    for (let i = 1; i < diameters.length; i += 1) {
      expect(diameters[i]!).toBeGreaterThan(diameters[i - 1]!);
    }
  });
});

describe('totalDtex', () => {
  it('S = 3 × x × n', () => {
    expect(totalDtex(80, 1)).toBe(240);
    expect(totalDtex(22.22, 2)).toBeCloseTo(133.32, 12);
    expect(totalDtex(750, 5)).toBe(11250);
  });
});

describe('recommendLoadGrams', () => {
  const EPSILON = 1e-9;

  it.each(LOAD_THRESHOLDS.map((step, index) => [step.totalDtexBelow, step.loadGrams, LOAD_THRESHOLDS[index + 1]?.loadGrams ?? MAX_RECOMMENDED_LOAD_GRAMS]))(
    'порог S = %s: ниже — %s г, на пороге и выше — %s г',
    (threshold, below, above) => {
      expect(loadForTotal(threshold - EPSILON)).toBe(below);
      expect(loadForTotal(threshold)).toBe(above);
      expect(loadForTotal(threshold + EPSILON)).toBe(above);
    },
  );

  it('крайние значения', () => {
    expect(loadForTotal(1e-9)).toBe(30);
    expect(loadForTotal(66.66)).toBe(30);
    expect(loadForTotal(1e9)).toBe(300);
  });

  it('пороги из ТЗ', () => {
    expect(loadForTotal(149.999)).toBe(30);
    expect(loadForTotal(150)).toBe(50);
    expect(loadForTotal(250)).toBe(100);
    expect(loadForTotal(400)).toBe(150);
    expect(loadForTotal(550)).toBe(200);
    expect(loadForTotal(650)).toBe(250);
    expect(loadForTotal(800)).toBe(300);
  });

  it('результат только из разрешённого множества и монотонен по S', () => {
    let previous = 0;
    for (let total = 1; total <= 20000; total += 0.5) {
      const grams = loadForTotal(total);
      expect(isLoadGrams(grams)).toBe(true);
      expect(grams).toBeGreaterThanOrEqual(previous);
      previous = grams;
    }
  });

  it('зависит только от S, а не от разложения на x и n', () => {
    expect(recommendLoadGrams(100, 2)).toBe(recommendLoadGrams(200, 1));
    expect(recommendLoadGrams(50, 4)).toBe(recommendLoadGrams(200, 1));
  });
});

describe('resolveLoad', () => {
  it('auto применяет рекомендацию', () => {
    expect(resolveLoad({ dtex: 80, threadsPerStrand: 2, loadMode: 'auto' })).toEqual({
      loadMode: 'auto',
      totalDtex: 480,
      recommendedLoadGrams: 150,
      appliedLoadGrams: 150,
    });
  });

  it('manual применяет выбор и сохраняет рекомендацию', () => {
    expect(resolveLoad({ dtex: 80, threadsPerStrand: 2, loadMode: 'manual', loadGrams: 300 })).toEqual({
      loadMode: 'manual',
      totalDtex: 480,
      recommendedLoadGrams: 150,
      appliedLoadGrams: 300,
    });
  });
});

describe('isLoadGrams', () => {
  it.each([30, 50, 100, 150, 200, 250, 300])('принимает %s', (value) => {
    expect(isLoadGrams(value)).toBe(true);
  });

  it.each([0, -30, 29.999, 31, 120, 301, Number.NaN, Number.POSITIVE_INFINITY, '30', null, undefined])(
    'отклоняет %s',
    (value) => {
      expect(isLoadGrams(value)).toBe(false);
    },
  );
});

describe('modelWarnings', () => {
  const codes = (dtex: number, grams: (typeof LOAD_GRAMS)[number]) =>
    modelWarnings(dtex, {
      loadMode: 'manual',
      totalDtex: totalDtex(dtex, 1),
      recommendedLoadGrams: recommendLoadGrams(dtex, 1),
      appliedLoadGrams: grams,
    }).map((warning) => warning.code);

  it('эмпирическая модель и стартовая рекомендация — всегда', () => {
    expect(codes(300, 300)).toEqual(['EMPIRICAL_MODEL', 'RECOMMENDED_LOAD_STARTING_SUGGESTION']);
  });

  it.each([50, 100, 150, 250] as const)('непроверенный груз %s г', (grams) => {
    expect(codes(300, grams)).toContain('UNVERIFIED_LOAD');
  });

  it.each([30, 200, 300] as const)('измеренный груз %s г без предупреждения', (grams) => {
    expect(codes(300, grams)).not.toContain('UNVERIFIED_LOAD');
  });

  it('dTex вне измеренного диапазона 22.22–3000', () => {
    expect(codes(20, 30)).toContain('DTEX_OUTSIDE_MEASURED_RANGE');
    expect(codes(22.22, 30)).not.toContain('DTEX_OUTSIDE_MEASURED_RANGE');
    expect(codes(3000, 300)).not.toContain('DTEX_OUTSIDE_MEASURED_RANGE');
    expect(codes(3750, 300)).toContain('DTEX_OUTSIDE_MEASURED_RANGE');
  });
});
