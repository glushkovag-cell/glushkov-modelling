import { config } from "./config.js";

/**
 * Клиент JSON API калькулятора канатов (Cloudflare Worker).
 *
 * Формулы здесь нет намеренно: MCP-сервер только передаёт входы и возвращает
 * результат Worker'а. Контракт — docs/rope-calculator/spec.md.
 *
 * Если задан `loadMode`, используется API v2 (учёт груза, алгоритм 3.0.0);
 * без него — устаревший v1. Числа Worker отдаёт полными, MCP округляет только
 * при выдаче: диаметр — 3 знака, отклонение — 2 знака, без «−0».
 */

export type RopeBasis = "catalog" | "dtex";
export type RopeLoadMode = "auto" | "manual";

/** Допустимые грузы натяжения, г (контракт v2). */
export const ROPE_LOAD_GRAMS = [30, 50, 100, 150, 200, 250, 300] as const;
export type RopeLoadGrams = (typeof ROPE_LOAD_GRAMS)[number];

/** Минимум ручного dTex: v1 — 80, v2 — 20. Максимум в обеих версиях — 6000. */
export const ROPE_MIN_DTEX_V1 = 80;
export const ROPE_MIN_DTEX_V2 = 20;
export const ROPE_MAX_DTEX = 6000;

export interface RopeWarning {
  code: string;
  message: string;
}

export interface RopeLoadInput {
  loadMode?: RopeLoadMode;
  loadGrams?: RopeLoadGrams;
}

export interface CalculateRopeInput extends RopeLoadInput {
  basis: RopeBasis;
  threadId?: string;
  dtex?: number;
  threadsPerStrand: number;
}

/** Поля, которые есть только в ответах v2. */
export interface RopeLoadResult {
  totalDtex: number;
  loadMode: RopeLoadMode;
  recommendedLoadGrams: number;
  appliedLoadGrams: number;
}

/** Округление для выдачи; `-0` превращается в `0`. */
export function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

export const roundDiameter = (value: number): number => roundTo(value, 3);
export const roundDeviation = (value: number): number => roundTo(value, 2);

export interface CalculateRopeResult {
  basis: RopeBasis;
  threadId: string | null;
  dtex: number;
  diameterMm: number;
  threadsPerStrand: number;
  strands: number;
  construction: string;
  catalogVersion: string | null;
  apiVersion: string;
  algorithmVersion: string;
  /** Только v2. */
  totalDtex?: number;
  loadMode?: RopeLoadMode;
  recommendedLoadGrams?: number;
  appliedLoadGrams?: number;
  loadRecommendationVersion?: string;
  warnings?: RopeWarning[];
}

export interface FindRopeThreadsInput extends RopeLoadInput {
  targetDiameterMm: number;
  threadIds?: string[];
}

export interface RopeThreadMatch extends Partial<RopeLoadResult> {
  threadId: string;
  brand: string;
  number: string;
  dtex: number;
  threadsPerStrand: number;
  construction: string;
  diameterMm: number;
  deviationPercent: number;
}

export interface FindRopeThreadsResult {
  targetDiameterMm: number;
  tolerancePercent: number;
  totalMatched: number;
  catalogVersion: string;
  apiVersion: string;
  algorithmVersion: string;
  /** Только v2. */
  loadMode?: RopeLoadMode;
  loadGrams?: number | null;
  loadRecommendationVersion?: string;
  warnings?: RopeWarning[];
  results: RopeThreadMatch[];
}

export interface RopeThreadSummary {
  threadId: string;
  brand: string;
  number: string;
  dtex: number;
  sortOrder: number;
  /** Человекочитаемая подпись, как в интерфейсе: "Tera 40 — 750 dTex". */
  label: string;
}

export interface ListRopeThreadsResult {
  catalogVersion: string;
  fetchedAt: string;
  totalThreads: number;
  apiVersion: string;
  algorithmVersion: string;
  threads: RopeThreadSummary[];
}

interface RopeApiErrorBody {
  error?: { code?: unknown; message?: unknown; fields?: unknown };
  requestId?: unknown;
}

interface ForwardResponse {
  apiVersion: string;
  algorithmVersion: string;
  loadRecommendationVersion?: string;
  catalogVersion: string | null;
  basis: RopeBasis;
  input: { threadId?: string; dtex: number; threadsPerStrand: number };
  result: Partial<RopeLoadResult> & {
    diameterMm: number;
    threadsPerStrand: number;
    strands: number;
    construction: string;
  };
  warnings?: RopeWarning[];
}

interface ReverseResponse {
  apiVersion: string;
  algorithmVersion: string;
  loadRecommendationVersion?: string;
  catalogVersion: string;
  input: {
    targetDiameterMm: number;
    tolerance: number;
    threadIds: string[] | null;
    loadMode?: RopeLoadMode;
    loadGrams?: number | null;
  };
  results: RopeThreadMatch[];
  warnings?: RopeWarning[];
}

interface CatalogThread {
  threadId: string;
  brand: string;
  number: string;
  dtex: number;
  sortOrder: number;
  enabled: boolean;
}

interface CatalogResponse {
  apiVersion: string;
  algorithmVersion: string;
  catalogVersion: string;
  fetchedAt: string;
  threads: CatalogThread[];
}

/** Ошибка API с кодом из контракта; сообщение безопасно показывать клиенту. */
export class RopeApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "RopeApiError";
    this.code = code;
    this.status = status;
  }
}

async function requestWorker<TResponse>(path: string, init: RequestInit): Promise<TResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const response = await fetch(`${config.ropeApiBaseUrl}${path}`, {
      ...init,
      signal: controller.signal,
    });

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const error = (payload as RopeApiErrorBody | null)?.error;
      const code = typeof error?.code === "string" ? error.code : `HTTP_${response.status}`;
      const message =
        typeof error?.message === "string"
          ? error.message
          : `Rope API returned HTTP ${response.status}`;

      console.error(JSON.stringify({
        event: "rope_api_error",
        status: response.status,
        code,
      }));

      throw new RopeApiError(code, message, response.status);
    }

    if (payload === null) {
      throw new RopeApiError("BAD_RESPONSE", "Rope API returned invalid JSON.", response.status);
    }

    return payload as TResponse;
  } catch (error) {
    if (error instanceof RopeApiError) throw error;

    if (controller.signal.aborted) {
      console.error(JSON.stringify({
        event: "rope_api_timeout",
        timeout_ms: config.requestTimeoutMs,
      }));
      throw new RopeApiError(
        "TIMEOUT",
        `Rope API request timed out after ${config.requestTimeoutMs} ms`,
        0,
      );
    }

    console.error(JSON.stringify({
      event: "rope_api_unreachable",
      message: error instanceof Error ? error.message : String(error),
    }));
    throw new RopeApiError("NETWORK_ERROR", "Rope API is unreachable.", 0);
  } finally {
    clearTimeout(timeout);
  }
}

function postToWorker<TResponse>(path: string, body: unknown): Promise<TResponse> {
  return requestWorker<TResponse>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getFromWorker<TResponse>(path: string): Promise<TResponse> {
  return requestWorker<TResponse>(path, {
    method: "GET",
    headers: { accept: "application/json" },
  });
}

/**
 * Прямой расчёт диаметра.
 *
 * Для basis = "catalog" Worker берёт dTex из каталога WordPress; для
 * basis = "dtex" каталог не нужен вовсе.
 */
/** Поля груза для тела запроса v2; пусто, если режим не задан. */
function loadBody(input: RopeLoadInput): Record<string, unknown> {
  if (input.loadMode === undefined) return {};
  return input.loadMode === "manual"
    ? { loadMode: "manual", loadGrams: input.loadGrams }
    : { loadMode: "auto" };
}

function ropePath(input: RopeLoadInput, route: "forward" | "reverse"): string {
  return input.loadMode === undefined ? `/api/rope/v1/${route}` : `/api/rope/v2/${route}`;
}

export async function calculateRope(input: CalculateRopeInput): Promise<CalculateRopeResult> {
  const base =
    input.basis === "catalog"
      ? { basis: "catalog", threadId: input.threadId, threadsPerStrand: input.threadsPerStrand }
      : { basis: "dtex", dtex: input.dtex, threadsPerStrand: input.threadsPerStrand };

  const response = await postToWorker<ForwardResponse>(ropePath(input, "forward"), {
    ...base,
    ...loadBody(input),
  });

  const result: CalculateRopeResult = {
    basis: response.basis,
    threadId: response.basis === "catalog" ? response.input.threadId ?? null : null,
    dtex: response.input.dtex,
    diameterMm: roundDiameter(response.result.diameterMm),
    threadsPerStrand: response.result.threadsPerStrand,
    strands: response.result.strands,
    construction: response.result.construction,
    catalogVersion: response.catalogVersion,
    apiVersion: response.apiVersion,
    algorithmVersion: response.algorithmVersion,
  };

  if (input.loadMode === undefined) return result;

  return {
    ...result,
    totalDtex: response.result.totalDtex,
    loadMode: response.result.loadMode,
    recommendedLoadGrams: response.result.recommendedLoadGrams,
    appliedLoadGrams: response.result.appliedLoadGrams,
    loadRecommendationVersion: response.loadRecommendationVersion,
    warnings: response.warnings ?? [],
  };
}

/**
 * Подбор нитей под целевой диаметр.
 *
 * `threadIds` не задан — проверяется весь активный каталог. Допуск
 * фиксирован (±10% в v1 и v2), поэтому в ответе есть только `tolerancePercent`.
 */
export async function findRopeThreads(
  input: FindRopeThreadsInput,
): Promise<FindRopeThreadsResult> {
  const base =
    input.threadIds && input.threadIds.length > 0
      ? { targetDiameterMm: input.targetDiameterMm, threadIds: input.threadIds }
      : { targetDiameterMm: input.targetDiameterMm };

  const response = await postToWorker<ReverseResponse>(ropePath(input, "reverse"), {
    ...base,
    ...loadBody(input),
  });

  const results = response.results.map((match) => ({
    ...match,
    diameterMm: roundDiameter(match.diameterMm),
    deviationPercent: roundDeviation(match.deviationPercent),
  }));

  const result: FindRopeThreadsResult = {
    targetDiameterMm: response.input.targetDiameterMm,
    tolerancePercent: Math.round(response.input.tolerance * 100),
    totalMatched: results.length,
    catalogVersion: response.catalogVersion,
    apiVersion: response.apiVersion,
    algorithmVersion: response.algorithmVersion,
    results,
  };

  if (input.loadMode === undefined) return result;

  return {
    ...result,
    loadMode: response.input.loadMode,
    loadGrams: response.input.loadGrams ?? null,
    loadRecommendationVersion: response.loadRecommendationVersion,
    warnings: response.warnings ?? [],
  };
}

/**
 * Полный активный каталог нитей в порядке выдачи Worker'а
 * (`sortOrder`, затем `threadId`).
 *
 * Нужен, чтобы модель могла узнать `threadId` для прямого расчёта: API
 * возвращает только активные опубликованные нити, отключённые в CMS сюда не
 * попадают.
 */
export async function listRopeThreads(): Promise<ListRopeThreadsResult> {
  const response = await getFromWorker<CatalogResponse>("/api/rope/v1/catalog");

  return {
    catalogVersion: response.catalogVersion,
    fetchedAt: response.fetchedAt,
    totalThreads: response.threads.length,
    apiVersion: response.apiVersion,
    algorithmVersion: response.algorithmVersion,
    threads: response.threads.map((thread) => ({
      threadId: thread.threadId,
      brand: thread.brand,
      number: thread.number,
      dtex: thread.dtex,
      sortOrder: thread.sortOrder,
      label: `${thread.brand} ${thread.number} — ${thread.dtex} dTex`,
    })),
  };
}
