import { MAX_DEVIATION, THREAD_COUNTS } from './constants';
import { threadNotFound } from './errors';
import { calculateDiameterMm } from './formula';
import { construction } from './forward';
import type { CatalogThread, ReverseInput, ReverseMatch, ReverseResult, ThreadCount } from './types';

interface Candidate {
  thread: CatalogThread;
  threadsPerStrand: ThreadCount;
  diameterMm: number;
  deviation: number;
}

function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Правило допуска из эталона: граница включительная. */
export function withinTolerance(deviation: number): boolean {
  return Math.abs(deviation) <= MAX_DEVIATION;
}

/**
 * Сортировка результатов: |отклонение|, dtex, число нитей, sortOrder, threadId.
 *
 * Последние два ключа обязательны: в каталоге есть пары с одинаковым dtex
 * (mara-70/mara-80, mara-15/tera-15, mara-30/tera-30), и без них порядок
 * зависел бы от порядка входа.
 */
function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    Math.abs(a.deviation) - Math.abs(b.deviation) ||
    a.thread.dtex - b.thread.dtex ||
    a.threadsPerStrand - b.threadsPerStrand ||
    a.thread.sortOrder - b.thread.sortOrder ||
    compareIds(a.thread.threadId, b.thread.threadId)
  );
}

function selectThreads(input: ReverseInput, catalog: readonly CatalogThread[]): CatalogThread[] {
  if (!input.threadIds) {
    return catalog.filter((thread) => thread.enabled);
  }

  const byId = new Map(catalog.map((thread) => [thread.threadId, thread]));
  const missing: string[] = [];
  const selected: CatalogThread[] = [];

  for (const threadId of input.threadIds) {
    const thread = byId.get(threadId);
    if (!thread || !thread.enabled) {
      missing.push(threadId);
      continue;
    }
    selected.push(thread);
  }

  if (missing.length > 0) {
    throw threadNotFound(missing);
  }

  return selected;
}

/** Обратный подбор: все выбранные нити × 1, 2, 3 нити в пряди. */
export function findMatches(input: ReverseInput, catalog: readonly CatalogThread[]): ReverseResult {
  const threads = selectThreads(input, catalog);
  const candidates: Candidate[] = [];

  for (const thread of threads) {
    for (const threadsPerStrand of THREAD_COUNTS) {
      const diameterMm = calculateDiameterMm(thread.dtex, threadsPerStrand);
      const deviation = (diameterMm - input.targetDiameterMm) / input.targetDiameterMm;
      if (withinTolerance(deviation)) {
        candidates.push({ thread, threadsPerStrand, diameterMm, deviation });
      }
    }
  }

  candidates.sort(compareCandidates);

  const matches: ReverseMatch[] = candidates.map((candidate) => ({
    threadId: candidate.thread.threadId,
    brand: candidate.thread.brand,
    number: candidate.thread.number,
    dtex: candidate.thread.dtex,
    threadsPerStrand: candidate.threadsPerStrand,
    construction: construction(candidate.threadsPerStrand),
    diameterMm: candidate.diameterMm,
    deviationPercent: candidate.deviation * 100,
  }));

  return {
    targetDiameterMm: input.targetDiameterMm,
    tolerance: MAX_DEVIATION,
    matches,
  };
}
