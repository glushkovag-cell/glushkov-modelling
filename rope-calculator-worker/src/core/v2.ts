/**
 * Контракт v2: прямой расчёт и обратный подбор с учётом груза
 * (алгоритм 3.0.0, рекомендация груза 1.0.0).
 *
 * Режим нагрузки — отдельная ось от basis и от прямого/обратного режима:
 * - loadMode отсутствует или 'auto' — груз рекомендуется по S = 3·x·n;
 * - 'manual' — груз задаёт пользователь, только из LOAD_GRAMS.
 * Некорректные сочетания отклоняются с INVALID_PARAMS, без округления и
 * подстановки значений по умолчанию.
 */

import { MAX_CUSTOM_DTEX_V2, MAX_DEVIATION, MIN_CUSTOM_DTEX_V2, STRANDS, THREAD_COUNTS } from './constants';
import { invalidParams, threadNotFound } from './errors';
import { construction } from './forward';
import {
  LOAD_GRAMS,
  type LoadGrams,
  type LoadMode,
  type LoadSelection,
  type ModelWarning,
  UNVERIFIED_LOAD_GRAMS,
  MEASURED_DTEX_MAX,
  MEASURED_DTEX_MIN,
  baseWarnings,
  calculateDiameterMm,
  isLoadGrams,
  modelWarnings,
  resolveLoad,
} from './load-model';
import { compareIds, selectThreads, withinTolerance } from './reverse';
import { asRecord, parseThreadIds, requireFiniteNumber, requireThreadCount } from './validation';
import type { CatalogThread, ThreadCount } from './types';

export type ForwardInputV2 =
  | ({ basis: 'catalog'; threadId: string; threadsPerStrand: ThreadCount } & LoadSelection)
  | ({ basis: 'dtex'; dtex: number; threadsPerStrand: ThreadCount } & LoadSelection);

export type ReverseInputV2 = { targetDiameterMm: number; threadIds?: readonly string[] } & LoadSelection;

export interface LoadFields {
  totalDtex: number;
  loadMode: LoadMode;
  recommendedLoadGrams: LoadGrams;
  appliedLoadGrams: LoadGrams;
}

export interface ForwardResultV2 extends LoadFields {
  basis: 'catalog' | 'dtex';
  threadId: string | null;
  dtex: number;
  threadsPerStrand: ThreadCount;
  strands: number;
  construction: string;
  diameterMm: number;
}

export interface ReverseMatchV2 extends Omit<LoadFields, 'loadMode'> {
  threadId: string;
  brand: string;
  number: string;
  dtex: number;
  threadsPerStrand: ThreadCount;
  construction: string;
  diameterMm: number;
  /** (D − target) / target × 100, без округления. */
  deviationPercent: number;
}

export interface ReverseResultV2 {
  targetDiameterMm: number;
  tolerance: number;
  loadMode: LoadMode;
  matches: ReverseMatchV2[];
  warnings: ModelWarning[];
}

const LOAD_LIST = LOAD_GRAMS.join(', ');

/** Разбор loadMode/loadGrams. Отсутствие loadMode — auto. */
export function parseLoadSelection(body: Record<string, unknown>): LoadSelection {
  const mode = body.loadMode === undefined ? 'auto' : body.loadMode;

  if (mode === 'auto') {
    if (body.loadGrams !== undefined) {
      throw invalidParams('loadGrams must be omitted when loadMode is "auto".', ['loadGrams', 'loadMode']);
    }
    return { loadMode: 'auto' };
  }

  if (mode === 'manual') {
    if (body.loadGrams === undefined) {
      throw invalidParams('loadGrams is required when loadMode is "manual".', ['loadGrams']);
    }
    if (!isLoadGrams(body.loadGrams)) {
      throw invalidParams(`loadGrams must be one of ${LOAD_LIST}.`, ['loadGrams']);
    }
    return { loadMode: 'manual', loadGrams: body.loadGrams };
  }

  throw invalidParams('loadMode must be "auto" or "manual".', ['loadMode']);
}

export function parseForwardInputV2(raw: unknown): ForwardInputV2 {
  const body = asRecord(raw);

  if (body.basis === 'catalog') {
    const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
    if (threadId === '') {
      throw invalidParams('threadId is required when basis is "catalog".', ['threadId']);
    }
    const threadsPerStrand = requireThreadCount(body.threadsPerStrand);
    return { basis: 'catalog', threadId, threadsPerStrand, ...parseLoadSelection(body) };
  }

  if (body.basis === 'dtex') {
    const dtex = requireFiniteNumber(body.dtex, 'dtex');
    if (dtex < MIN_CUSTOM_DTEX_V2 || dtex > MAX_CUSTOM_DTEX_V2) {
      throw invalidParams(`dtex must be between ${MIN_CUSTOM_DTEX_V2} and ${MAX_CUSTOM_DTEX_V2}.`, ['dtex']);
    }
    const threadsPerStrand = requireThreadCount(body.threadsPerStrand);
    return { basis: 'dtex', dtex, threadsPerStrand, ...parseLoadSelection(body) };
  }

  throw invalidParams('basis must be "catalog" or "dtex".', ['basis']);
}

export function parseReverseInputV2(raw: unknown): ReverseInputV2 {
  const body = asRecord(raw);

  const targetDiameterMm = requireFiniteNumber(body.targetDiameterMm, 'targetDiameterMm');
  if (targetDiameterMm <= 0) {
    throw invalidParams('targetDiameterMm must be greater than zero.', ['targetDiameterMm']);
  }

  const threadIds = parseThreadIds(body.threadIds);
  const load = parseLoadSelection(body);
  return threadIds ? { targetDiameterMm, threadIds, ...load } : { targetDiameterMm, ...load };
}

function loadSelectionOf(input: LoadSelection): LoadSelection {
  return input.loadMode === 'manual' ? { loadMode: 'manual', loadGrams: input.loadGrams } : { loadMode: 'auto' };
}

export interface ForwardOutputV2 {
  result: ForwardResultV2;
  warnings: ModelWarning[];
}

/**
 * Прямой расчёт v2. Для basis = "catalog" нить ищется в каталоге и должна
 * быть включённой; для basis = "dtex" каталог не нужен.
 */
export function computeForwardV2(input: ForwardInputV2, catalog: readonly CatalogThread[] = []): ForwardOutputV2 {
  let dtex: number;
  let threadId: string | null = null;

  if (input.basis === 'catalog') {
    const thread = catalog.find((candidate) => candidate.threadId === input.threadId);
    if (!thread || !thread.enabled) {
      throw threadNotFound([input.threadId]);
    }
    dtex = thread.dtex;
    threadId = thread.threadId;
  } else {
    dtex = input.dtex;
  }

  const load = resolveLoad({ dtex, threadsPerStrand: input.threadsPerStrand, ...loadSelectionOf(input) });

  return {
    result: {
      basis: input.basis,
      threadId,
      dtex,
      threadsPerStrand: input.threadsPerStrand,
      strands: STRANDS,
      construction: construction(input.threadsPerStrand),
      totalDtex: load.totalDtex,
      loadMode: load.loadMode,
      recommendedLoadGrams: load.recommendedLoadGrams,
      appliedLoadGrams: load.appliedLoadGrams,
      diameterMm: calculateDiameterMm(dtex, input.threadsPerStrand, load.appliedLoadGrams),
    },
    warnings: modelWarnings(dtex, load),
  };
}

interface CandidateV2 {
  thread: CatalogThread;
  threadsPerStrand: ThreadCount;
  totalDtex: number;
  recommendedLoadGrams: LoadGrams;
  appliedLoadGrams: LoadGrams;
  diameterMm: number;
  deviation: number;
}

/** Та же детерминированная сортировка, что и в v1. */
function compareCandidatesV2(a: CandidateV2, b: CandidateV2): number {
  return (
    Math.abs(a.deviation) - Math.abs(b.deviation) ||
    a.thread.dtex - b.thread.dtex ||
    a.threadsPerStrand - b.threadsPerStrand ||
    a.thread.sortOrder - b.thread.sortOrder ||
    compareIds(a.thread.threadId, b.thread.threadId)
  );
}

/**
 * Сводные предупреждения обратного подбора: по всем найденным вариантам.
 * В manual груз у всех кандидатов одинаков; в auto он у каждого свой.
 */
function reverseWarnings(matches: readonly CandidateV2[], load: LoadSelection): ModelWarning[] {
  const base = baseWarnings();

  const unverified = [
    ...new Set(
      (load.loadMode === 'manual' ? [load.loadGrams] : matches.map((match) => match.appliedLoadGrams)).filter(
        (grams) => UNVERIFIED_LOAD_GRAMS.includes(grams),
      ),
    ),
  ].sort((a, b) => a - b);

  if (unverified.length > 0) {
    base.push({
      code: 'UNVERIFIED_LOAD',
      message: `Loads of ${unverified.join(', ')} g were not tested in the calibration data; only 30, 200 and 300 g were measured.`,
    });
  }

  if (matches.some((match) => match.thread.dtex < MEASURED_DTEX_MIN || match.thread.dtex > MEASURED_DTEX_MAX)) {
    base.push({
      code: 'DTEX_OUTSIDE_MEASURED_RANGE',
      message: `Some results use threads outside the measured range ${MEASURED_DTEX_MIN}–${MEASURED_DTEX_MAX} dTex.`,
    });
  }

  return base;
}

/**
 * Обратный подбор v2: выбранные нити × 1–5 нитей в пряди.
 *
 * В auto груз и S считаются отдельно для каждой нити и свивки; в manual
 * груз общий. Фильтр ±10% включительно применяется к неокруглённому
 * отклонению, затем детерминированная сортировка.
 */
export function findMatchesV2(input: ReverseInputV2, catalog: readonly CatalogThread[]): ReverseResultV2 {
  const threads = selectThreads(input, catalog);
  const selection = loadSelectionOf(input);
  const candidates: CandidateV2[] = [];

  for (const thread of threads) {
    for (const threadsPerStrand of THREAD_COUNTS) {
      const load = resolveLoad({ dtex: thread.dtex, threadsPerStrand, ...selection });
      const diameterMm = calculateDiameterMm(thread.dtex, threadsPerStrand, load.appliedLoadGrams);
      const deviation = (diameterMm - input.targetDiameterMm) / input.targetDiameterMm;
      if (withinTolerance(deviation)) {
        candidates.push({
          thread,
          threadsPerStrand,
          totalDtex: load.totalDtex,
          recommendedLoadGrams: load.recommendedLoadGrams,
          appliedLoadGrams: load.appliedLoadGrams,
          diameterMm,
          deviation,
        });
      }
    }
  }

  candidates.sort(compareCandidatesV2);

  return {
    targetDiameterMm: input.targetDiameterMm,
    tolerance: MAX_DEVIATION,
    loadMode: selection.loadMode,
    matches: candidates.map((candidate) => ({
      threadId: candidate.thread.threadId,
      brand: candidate.thread.brand,
      number: candidate.thread.number,
      dtex: candidate.thread.dtex,
      threadsPerStrand: candidate.threadsPerStrand,
      construction: construction(candidate.threadsPerStrand),
      totalDtex: candidate.totalDtex,
      recommendedLoadGrams: candidate.recommendedLoadGrams,
      appliedLoadGrams: candidate.appliedLoadGrams,
      diameterMm: candidate.diameterMm,
      deviationPercent: candidate.deviation * 100,
    })),
    warnings: reverseWarnings(candidates, selection),
  };
}
