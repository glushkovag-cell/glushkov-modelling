/**
 * Актуальный контракт v2: прямой расчёт и обратный подбор без груза.
 *
 * Модель — `model.ts` (algorithmVersion 4.0.0, log-dtex-quadratic-no-load).
 * Полей нагрузки нет: `loadMode`, `loadGrams` и любые их эквиваленты
 * отклоняются валидацией как неподдержанные.
 */

import {
  API_VERSION_V2,
  MAX_DEVIATION,
  MODEL_ID,
  STRANDS,
  TARGET_ALGORITHM_VERSION,
  TARGET_MAX_CUSTOM_DTEX,
  TARGET_MIN_CUSTOM_DTEX,
  THREAD_COUNTS,
} from './constants';
import { invalidParams, threadNotFound } from './errors';
import { construction } from './forward';
import { calculateDiameterMm } from './model';
import { compareIds, selectThreads, withinTolerance } from './reverse';
import {
  asRecord,
  parseThreadIds,
  rejectLegacyLoadFields,
  requireFiniteNumber,
  requireThreadCount,
} from './validation';
import { mergeWarnings, warningsForDtex, type ModelWarning } from './warnings';
import type { CatalogThread, ThreadCount } from './types';

/** Версии в каждом ответе актуального контракта. */
export const TARGET_VERSIONS = {
  apiVersion: API_VERSION_V2,
  algorithmVersion: TARGET_ALGORITHM_VERSION,
  modelId: MODEL_ID,
} as const;

export type ForwardInputV2 =
  | { basis: 'catalog'; threadId: string; threadsPerStrand: ThreadCount }
  | { basis: 'dtex'; dtex: number; threadsPerStrand: ThreadCount };

export type ReverseInputV2 = { targetDiameterMm: number; threadIds?: readonly string[] };

export interface ForwardResultV2 {
  basis: 'catalog' | 'dtex';
  threadId: string | null;
  dtex: number;
  threadsPerStrand: ThreadCount;
  strands: number;
  construction: string;
  diameterMm: number;
}

export interface ReverseMatchV2 {
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
  matches: ReverseMatchV2[];
  warnings: ModelWarning[];
}

export function parseForwardInputV2(raw: unknown): ForwardInputV2 {
  const body = asRecord(raw);
  rejectLegacyLoadFields(body);

  if (body.basis === 'catalog') {
    const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
    if (threadId === '') {
      throw invalidParams('threadId is required when basis is "catalog".', ['threadId']);
    }
    return {
      basis: 'catalog',
      threadId,
      threadsPerStrand: requireThreadCount(body.threadsPerStrand),
    };
  }

  if (body.basis === 'dtex') {
    const dtex = requireFiniteNumber(body.dtex, 'dtex');
    if (dtex < TARGET_MIN_CUSTOM_DTEX || dtex > TARGET_MAX_CUSTOM_DTEX) {
      throw invalidParams(
        `dtex must be between ${TARGET_MIN_CUSTOM_DTEX} and ${TARGET_MAX_CUSTOM_DTEX}.`,
        ['dtex'],
      );
    }
    return {
      basis: 'dtex',
      dtex,
      threadsPerStrand: requireThreadCount(body.threadsPerStrand),
    };
  }

  throw invalidParams('basis must be "catalog" or "dtex".', ['basis']);
}

export function parseReverseInputV2(raw: unknown): ReverseInputV2 {
  const body = asRecord(raw);
  rejectLegacyLoadFields(body);

  const targetDiameterMm = requireFiniteNumber(body.targetDiameterMm, 'targetDiameterMm');
  if (targetDiameterMm <= 0) {
    throw invalidParams('targetDiameterMm must be greater than zero.', ['targetDiameterMm']);
  }

  const threadIds = parseThreadIds(body.threadIds);
  return threadIds ? { targetDiameterMm, threadIds } : { targetDiameterMm };
}

export interface ForwardOutputV2 {
  result: ForwardResultV2;
  warnings: ModelWarning[];
}

/**
 * Прямой расчёт v2. Для basis = "catalog" нить ищется в каталоге и должна
 * быть включённой; для basis = "dtex" каталог не нужен.
 */
export function computeForwardV2(
  input: ForwardInputV2,
  catalog: readonly CatalogThread[] = [],
): ForwardOutputV2 {
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

  return {
    result: {
      basis: input.basis,
      threadId,
      dtex,
      threadsPerStrand: input.threadsPerStrand,
      strands: STRANDS,
      construction: construction(input.threadsPerStrand),
      diameterMm: calculateDiameterMm(dtex, input.threadsPerStrand),
    },
    warnings: warningsForDtex(dtex),
  };
}

interface CandidateV2 {
  thread: CatalogThread;
  threadsPerStrand: ThreadCount;
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
 * Обратный подбор v2: выбранные нити × 1–5 нитей в пряди.
 *
 * Допуск ±10% включительно применяется к неокруглённому отклонению, затем
 * детерминированная сортировка. Предупреждения собираются по выданным
 * совпадениям и схлопываются по коду.
 */
export function findMatchesV2(input: ReverseInputV2, catalog: readonly CatalogThread[]): ReverseResultV2 {
  const threads = selectThreads(input, catalog);
  const candidates: CandidateV2[] = [];

  for (const thread of threads) {
    for (const threadsPerStrand of THREAD_COUNTS) {
      const diameterMm = calculateDiameterMm(thread.dtex, threadsPerStrand);
      const deviation = (diameterMm - input.targetDiameterMm) / input.targetDiameterMm;
      if (withinTolerance(deviation)) {
        candidates.push({ thread, threadsPerStrand, diameterMm, deviation });
      }
    }
  }

  candidates.sort(compareCandidatesV2);

  return {
    targetDiameterMm: input.targetDiameterMm,
    tolerance: MAX_DEVIATION,
    matches: candidates.map((candidate) => ({
      threadId: candidate.thread.threadId,
      brand: candidate.thread.brand,
      number: candidate.thread.number,
      dtex: candidate.thread.dtex,
      threadsPerStrand: candidate.threadsPerStrand,
      construction: construction(candidate.threadsPerStrand),
      diameterMm: candidate.diameterMm,
      deviationPercent: candidate.deviation * 100,
    })),
    warnings: mergeWarnings(
      candidates.flatMap((candidate) => warningsForDtex(candidate.thread.dtex)),
    ),
  };
}
