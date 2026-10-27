import { STRANDS } from './constants';
import { threadNotFound } from './errors';
import { calculateDiameterMm } from './formula';
import type { CatalogThread, ForwardInput, ForwardResult } from './types';

/** Человекочитаемая конструкция: 2 × 3. */
export function construction(threadsPerStrand: number): string {
  return `${threadsPerStrand} × ${STRANDS}`;
}

/**
 * Прямой расчёт.
 *
 * Для basis = "catalog" нить ищется в каталоге и должна быть включённой;
 * её dtex диапазоном 80–6000 не проверяется. Для basis = "dtex" каталог не
 * нужен вовсе, поэтому отказ CMS не влияет на результат.
 */
export function computeForward(
  input: ForwardInput,
  catalog: readonly CatalogThread[] = [],
): ForwardResult {
  if (input.basis === 'dtex') {
    const diameterMm = calculateDiameterMm(input.dtex, input.threadsPerStrand);
    return {
      basis: 'dtex',
      threadId: null,
      dtex: input.dtex,
      threadsPerStrand: input.threadsPerStrand,
      strands: STRANDS,
      construction: construction(input.threadsPerStrand),
      diameterMm,
    };
  }

  const thread = catalog.find((candidate) => candidate.threadId === input.threadId);
  if (!thread || !thread.enabled) {
    throw threadNotFound([input.threadId]);
  }

  return {
    basis: 'catalog',
    threadId: thread.threadId,
    dtex: thread.dtex,
    threadsPerStrand: input.threadsPerStrand,
    strands: STRANDS,
    construction: construction(input.threadsPerStrand),
    diameterMm: calculateDiameterMm(thread.dtex, input.threadsPerStrand),
  };
}
