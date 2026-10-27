import type { THREAD_COUNTS } from './constants';

/** Число нитей в одной пряди: 1, 2 или 3. */
export type ThreadCount = (typeof THREAD_COUNTS)[number];

/** Нить каталога в том виде, в котором её отдаёт Worker. */
export interface CatalogThread {
  threadId: string;
  brand: string;
  /** Обозначение нити, а не расчётное число. */
  number: string;
  dtex: number;
  sortOrder: number;
  enabled: boolean;
}

export interface ForwardCatalogInput {
  basis: 'catalog';
  threadId: string;
  threadsPerStrand: ThreadCount;
}

export interface ForwardDtexInput {
  basis: 'dtex';
  dtex: number;
  threadsPerStrand: ThreadCount;
}

export type ForwardInput = ForwardCatalogInput | ForwardDtexInput;

export interface ForwardResult {
  basis: ForwardInput['basis'];
  /** null для расчёта по ручному dTex. */
  threadId: string | null;
  dtex: number;
  threadsPerStrand: ThreadCount;
  strands: number;
  construction: string;
  diameterMm: number;
}

export interface ReverseInput {
  targetDiameterMm: number;
  /** Не задано — проверяются все активные нити. */
  threadIds?: readonly string[];
}

export interface ReverseMatch {
  threadId: string;
  brand: string;
  number: string;
  dtex: number;
  threadsPerStrand: ThreadCount;
  construction: string;
  diameterMm: number;
  /** Отклонение в процентах: (D - target) / target × 100. */
  deviationPercent: number;
}

export interface ReverseResult {
  targetDiameterMm: number;
  /** Допуск как доля: 0.15, а не 15. */
  tolerance: number;
  matches: ReverseMatch[];
}
