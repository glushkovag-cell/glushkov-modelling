/** Типы и клиент JSON API калькулятора. Контракт — docs/rope-calculator/spec.md. */

export interface CatalogThread {
  threadId: string;
  brand: string;
  number: string;
  dtex: number;
  sortOrder: number;
  enabled: boolean;
}

export interface CatalogResponse {
  apiVersion: string;
  algorithmVersion: string;
  catalogVersion: string;
  fetchedAt: string;
  threads: CatalogThread[];
}

export interface ForwardResult {
  diameterMm: number;
  threadsPerStrand: number;
  strands: number;
  construction: string;
}

export interface ForwardResponse {
  apiVersion: string;
  algorithmVersion: string;
  catalogVersion: string | null;
  fetchedAt: string | null;
  result: ForwardResult;
}

export interface ReverseMatch {
  threadId: string;
  brand: string;
  number: string;
  dtex: number;
  threadsPerStrand: number;
  construction: string;
  diameterMm: number;
  deviationPercent: number;
}

export interface ReverseResponse {
  apiVersion: string;
  algorithmVersion: string;
  catalogVersion: string;
  fetchedAt: string;
  results: ReverseMatch[];
}

export type ForwardBody =
  | { basis: 'catalog'; threadId: string; threadsPerStrand: number }
  | { basis: 'dtex'; dtex: number; threadsPerStrand: number };

export interface ReverseBody {
  targetDiameterMm: number;
  threadIds: string[];
}

/** Ошибка API с кодом из контракта, чтобы интерфейс мог различать причины. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields: string[];

  constructor(code: string, message: string, status: number, fields: string[] = []) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function normalizeBase(apiBase: string): string {
  return apiBase.replace(/\/+$/, '');
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, init);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(
      'NETWORK_ERROR',
      'The calculator service is unreachable. Check your connection and try again.',
      0,
    );
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: unknown; message?: unknown; fields?: unknown } } | null)?.error;
    const code = typeof error?.code === 'string' ? error.code : `HTTP_${response.status}`;
    const message =
      typeof error?.message === 'string'
        ? error.message
        : `The calculator service returned ${response.status}.`;
    const fields = Array.isArray(error?.fields)
      ? error.fields.filter((field): field is string => typeof field === 'string')
      : [];

    throw new ApiError(code, message, response.status, fields);
  }

  if (payload === null) {
    throw new ApiError('BAD_RESPONSE', 'Unexpected response from the calculator service.', response.status);
  }

  return payload as T;
}

export function fetchCatalog(apiBase: string, signal?: AbortSignal): Promise<CatalogResponse> {
  return request<CatalogResponse>(`${normalizeBase(apiBase)}/api/rope/v1/catalog`, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal,
  });
}

export function postForward(
  apiBase: string,
  body: ForwardBody,
  signal?: AbortSignal,
): Promise<ForwardResponse> {
  return request<ForwardResponse>(`${normalizeBase(apiBase)}/api/rope/v1/forward`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

export function postReverse(
  apiBase: string,
  body: ReverseBody,
  signal?: AbortSignal,
): Promise<ReverseResponse> {
  return request<ReverseResponse>(`${normalizeBase(apiBase)}/api/rope/v1/reverse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}
