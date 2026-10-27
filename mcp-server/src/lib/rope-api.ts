import { config } from "./config.js";

/**
 * Клиент JSON API калькулятора канатов (Cloudflare Worker).
 *
 * Формулы здесь нет намеренно: MCP-сервер только передаёт входы и возвращает
 * результат Worker'а, чтобы числа в интерфейсе сайте и в MCP-инструментах
 * совпадали бит в бит. Контракт — docs/rope-calculator/spec.md.
 */

export type RopeBasis = "catalog" | "dtex";

export interface CalculateRopeInput {
  basis: RopeBasis;
  threadId?: string;
  dtex?: number;
  threadsPerStrand: number;
}

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
}

export interface FindRopeThreadsInput {
  targetDiameterMm: number;
  threadIds?: string[];
}

export interface RopeThreadMatch {
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
  results: RopeThreadMatch[];
}

interface RopeApiErrorBody {
  error?: { code?: unknown; message?: unknown; fields?: unknown };
  requestId?: unknown;
}

interface ForwardResponse {
  apiVersion: string;
  algorithmVersion: string;
  catalogVersion: string | null;
  basis: RopeBasis;
  input: { threadId?: string; dtex: number; threadsPerStrand: number };
  result: {
    diameterMm: number;
    threadsPerStrand: number;
    strands: number;
    construction: string;
  };
}

interface ReverseResponse {
  apiVersion: string;
  algorithmVersion: string;
  catalogVersion: string;
  input: { targetDiameterMm: number; tolerance: number; threadIds: string[] | null };
  results: RopeThreadMatch[];
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

async function postToWorker<TResponse>(path: string, body: unknown): Promise<TResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const response = await fetch(`${config.ropeApiBaseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
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

/**
 * Прямой расчёт диаметра.
 *
 * Для basis = "catalog" Worker берёт dTex из каталога WordPress; для
 * basis = "dtex" каталог не нужен вовсе.
 */
export async function calculateRope(input: CalculateRopeInput): Promise<CalculateRopeResult> {
  const body =
    input.basis === "catalog"
      ? { basis: "catalog", threadId: input.threadId, threadsPerStrand: input.threadsPerStrand }
      : { basis: "dtex", dtex: input.dtex, threadsPerStrand: input.threadsPerStrand };

  const response = await postToWorker<ForwardResponse>("/api/rope/v1/forward", body);

  return {
    basis: response.basis,
    threadId: response.basis === "catalog" ? response.input.threadId ?? null : null,
    dtex: response.input.dtex,
    diameterMm: response.result.diameterMm,
    threadsPerStrand: response.result.threadsPerStrand,
    strands: response.result.strands,
    construction: response.result.construction,
    catalogVersion: response.catalogVersion,
    apiVersion: response.apiVersion,
    algorithmVersion: response.algorithmVersion,
  };
}

/**
 * Подбор нитей под целевой диаметр.
 *
 * `threadIds` не задан — проверяется весь активный каталог. Допуск в v1
 * фиксирован: ±15%, поэтому в ответе есть только `tolerancePercent`.
 */
export async function findRopeThreads(
  input: FindRopeThreadsInput,
): Promise<FindRopeThreadsResult> {
  const body =
    input.threadIds && input.threadIds.length > 0
      ? { targetDiameterMm: input.targetDiameterMm, threadIds: input.threadIds }
      : { targetDiameterMm: input.targetDiameterMm };

  const response = await postToWorker<ReverseResponse>("/api/rope/v1/reverse", body);

  return {
    targetDiameterMm: response.input.targetDiameterMm,
    tolerancePercent: Math.round(response.input.tolerance * 100),
    totalMatched: response.results.length,
    catalogVersion: response.catalogVersion,
    apiVersion: response.apiVersion,
    algorithmVersion: response.algorithmVersion,
    results: response.results,
  };
}
