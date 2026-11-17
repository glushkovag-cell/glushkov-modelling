/**
 * Модель диаметра с учётом груза: алгоритм 3.0.0, рекомендация груза 1.0.0.
 *
 * D = a × x^b × n^c × (w / 200)^loadExponent, где x — dTex исходной нити,
 * n — число нитей в пряди, w — груз в граммах. Прядей всегда три.
 *
 * Ручной и автоматический режимы используют одну функцию и один набор
 * коэффициентов: при одинаковых x, n, w диаметр одинаков, как бы ни был
 * выбран груз. Набор подобран по data/rope-calibration (общий для двух
 * режимов, равный вклад остатков); подбор воспроизводится скриптом
 * data/rope-calibration/calibrate.py.
 *
 * Промежуточного округления нет. Коэффициенты хранятся здесь, а не в ACF.
 */

import { STRANDS } from './constants';

export const LOAD_ALGORITHM_VERSION = '3.0.0';
export const LOAD_RECOMMENDATION_VERSION = '1.0.0';

export const COEFFICIENTS = {
  a: 0.015783234759902807,
  b: 0.5592028655918567,
  c: 0.5097503439652015,
  loadExponent: 0.27528238252976955,
} as const;

/** Опорный груз, при котором множитель нагрузки равен единице. */
export const REFERENCE_LOAD_GRAMS = 200;

/** Допустимые грузы, г. Других значений API не принимает. */
export const LOAD_GRAMS = [30, 50, 100, 150, 200, 250, 300] as const;
export type LoadGrams = (typeof LOAD_GRAMS)[number];

/** Грузы, которые в исходных данных не испытывались. */
export const UNVERIFIED_LOAD_GRAMS: readonly LoadGrams[] = [50, 100, 150, 250];

/**
 * Ступени рекомендации: груз выбирается по первой ступени, у которой
 * S < totalDtexBelow. На пороге берётся верхняя ступень. Выше последнего
 * порога — 300 г.
 */
export const LOAD_THRESHOLDS: readonly { totalDtexBelow: number; loadGrams: LoadGrams }[] = [
  { totalDtexBelow: 150, loadGrams: 30 },
  { totalDtexBelow: 250, loadGrams: 50 },
  { totalDtexBelow: 400, loadGrams: 100 },
  { totalDtexBelow: 550, loadGrams: 150 },
  { totalDtexBelow: 650, loadGrams: 200 },
  { totalDtexBelow: 800, loadGrams: 250 },
];
export const MAX_RECOMMENDED_LOAD_GRAMS: LoadGrams = 300;

/** Диапазон dTex исходных нитей в калибровочных измерениях. */
export const MEASURED_DTEX_MIN = 22.22;
export const MEASURED_DTEX_MAX = 3000;

export type LoadMode = 'auto' | 'manual';

export type LoadSelection =
  | { loadMode: 'auto'; loadGrams?: never }
  | { loadMode: 'manual'; loadGrams: LoadGrams };

export interface ResolvedLoad {
  loadMode: LoadMode;
  totalDtex: number;
  recommendedLoadGrams: LoadGrams;
  appliedLoadGrams: LoadGrams;
}

export function isLoadGrams(value: unknown): value is LoadGrams {
  return typeof value === 'number' && (LOAD_GRAMS as readonly number[]).includes(value);
}

/** Суммарный dTex каната: S = 3 × x × n. */
export function totalDtex(dtex: number, threadsPerStrand: number): number {
  return STRANDS * dtex * threadsPerStrand;
}

/**
 * Стартовая рекомендация груза по суммарному dTex. Монотонна по S,
 * дискретна и не зависит от целевого диаметра. Это эмпирическое правило,
 * а не оптимальная или безопасная нагрузка.
 */
export function recommendLoadGrams(dtex: number, threadsPerStrand: number): LoadGrams {
  const total = totalDtex(dtex, threadsPerStrand);
  for (const step of LOAD_THRESHOLDS) {
    if (total < step.totalDtexBelow) return step.loadGrams;
  }
  return MAX_RECOMMENDED_LOAD_GRAMS;
}

/**
 * Применённый груз: в auto — рекомендация, в manual — выбор пользователя.
 * Рекомендация возвращается в обоих режимах.
 */
export function resolveLoad(
  input: { dtex: number; threadsPerStrand: number } & LoadSelection,
): ResolvedLoad {
  const recommendedLoadGrams = recommendLoadGrams(input.dtex, input.threadsPerStrand);
  return {
    loadMode: input.loadMode,
    totalDtex: totalDtex(input.dtex, input.threadsPerStrand),
    recommendedLoadGrams,
    appliedLoadGrams: input.loadMode === 'manual' ? input.loadGrams : recommendedLoadGrams,
  };
}

/** Диаметр каната, мм, по алгоритму 3.0.0. */
export function calculateDiameterMm(dtex: number, threadsPerStrand: number, loadGrams: number): number {
  return COEFFICIENTS.a
    * Math.pow(dtex, COEFFICIENTS.b)
    * Math.pow(threadsPerStrand, COEFFICIENTS.c)
    * Math.pow(loadGrams / REFERENCE_LOAD_GRAMS, COEFFICIENTS.loadExponent);
}

export type WarningCode =
  | 'EMPIRICAL_MODEL'
  | 'RECOMMENDED_LOAD_STARTING_SUGGESTION'
  | 'UNVERIFIED_LOAD'
  | 'DTEX_OUTSIDE_MEASURED_RANGE';

export interface ModelWarning {
  code: WarningCode;
  message: string;
}

/**
 * Общие предупреждения. Метрики калибровки не являются гарантией точности
 * или прочности, поэтому они есть в каждом ответе v2.
 */
export function baseWarnings(): ModelWarning[] {
  return [
    {
      code: 'EMPIRICAL_MODEL',
      message: 'Empirical model fitted to measured model ropes. Not a guarantee of accuracy or strength.',
    },
    {
      code: 'RECOMMENDED_LOAD_STARTING_SUGGESTION',
      message: 'Recommended load is a starting suggestion, not an experimentally established optimum.',
    },
  ];
}

/** Предупреждения к одному результату: общие плюс груз и диапазон dTex. */
export function modelWarnings(dtex: number, load: ResolvedLoad): ModelWarning[] {
  const warnings = baseWarnings();

  if (UNVERIFIED_LOAD_GRAMS.includes(load.appliedLoadGrams)) {
    warnings.push({
      code: 'UNVERIFIED_LOAD',
      message: `A ${load.appliedLoadGrams} g load was not tested in the calibration data; only 30, 200 and 300 g were measured.`,
    });
  }

  if (dtex < MEASURED_DTEX_MIN || dtex > MEASURED_DTEX_MAX) {
    warnings.push({
      code: 'DTEX_OUTSIDE_MEASURED_RANGE',
      message: `dTex ${dtex} is outside the measured range ${MEASURED_DTEX_MIN}–${MEASURED_DTEX_MAX}.`,
    });
  }

  return warnings;
}
