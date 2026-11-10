import { config } from "./config.js";
import { siteOrigin } from "./public-urls.js";
import type { RiggingInput } from "./rigging-config.js";

/**
 * Клиент калькулятора толщин такелажа.
 *
 * Расчётное ядро — Cloudflare Worker rigging-calculator-worker
 * (`https://rigging-api.glushkov-modelling.com`), тот же, что вызывает
 * страница /tools/rigging-diameters. Формул и коэффициентов здесь нет:
 * MCP-сервер передаёт входы Worker'у и возвращает его результат.
 *
 * Документы профилей читаются с сайта (`/api/rigging/profiles/...`) — из того же
 * источника, из которого их берёт Worker. Они нужны только для описания
 * профиля (какие блоки поддержаны, демонстрационные размеры), не для расчёта.
 */

export interface ProfileManifestVersion {
  version: string;
  status: string;
  document: string;
  sha256: string;
}

export interface ProfileManifestEntry {
  profileId: string;
  family: string;
  name: string;
  status: string;
  latest: string;
  versions: ProfileManifestVersion[];
}

export interface ProfilesResponse {
  apiVersion: string;
  algorithmVersion: string;
  manifestVersion: string;
  schemaVersion: string;
  generatedAt: string;
  profiles: ProfileManifestEntry[];
}

export interface ProfileSource {
  id: string;
  title: string;
  locator: string;
}

/** Подмножество ProfileUi сайта (src/lib/rigging/document.ts). */
export interface ProfileUi {
  masts: boolean;
  tiers: Array<"lower" | "topmast" | "topgallant">;
  yards: boolean;
  squareSails: boolean;
  foreAndAft: Array<"head_lower" | "head_upper" | "staysail_lower" | "staysail_upper">;
  lateenYard: boolean;
  gaff: boolean;
  gaffSail: boolean;
  boom: boolean;
  mainSail: boolean;
  topsail: boolean;
  headSails: boolean;
  staysail: boolean;
  flag: boolean;
  bowsprit: boolean;
  spritsaill: boolean;
  jibboom: boolean;
  martingale: boolean;
  anchor: boolean;
  hullGroup: boolean;
  gun: boolean;
  mastPoint: string;
  bowspritPoint: string;
  defaults?: {
    scaleDenominator?: number;
    mastDiameterMm?: Partial<Record<"fore" | "main" | "mizzen", number>>;
    bowspritDiameterMm?: number;
    hullWidthMm?: number;
    gunBoreMm?: number;
    anchor?: boolean;
    gaff?: boolean;
    spritsaill?: boolean;
  };
}

export interface ProfileRuleSummarySource {
  ruleId: string;
  role: string;
  ropeId?: string;
  name: { en: string; ru: string };
  group: string;
  select: { nodeType: string; tier?: string | null; sailClass?: string | null };
  material?: string;
  materials?: string[];
  coefficientBasis?: string;
  calibrationStatus?: string;
}

export interface ProfileDocument {
  documentVersion?: string;
  profile: {
    profileId: string;
    profileVersion: string;
    schemaVersion: string;
    family: string;
    status: string;
    name: string;
    yearFrom?: number | null;
    yearTo?: number | null;
    materialConditions?: string[];
    warnings?: string[];
    metrics?: Record<string, unknown>;
    sources?: ProfileSource[];
    ui: ProfileUi;
    [key: string]: unknown;
  };
  rules: ProfileRuleSummarySource[];
}

export interface CalculationResultRow {
  ownerType: string;
  ownerId: string;
  nodeId: string;
  ruleId: string;
  ropeId: string;
  role: string;
  segmentType: string;
  nameEn: string;
  nameRu: string;
  group: string;
  tier?: string;
  status: "calculated" | "needs_input" | "unsupported" | "not_applicable";
  reasonCode?: string;
  missingInputIds: string[];
  diameterPrototypeMm: number | null;
  diameterModelMm: number | null;
  method: string;
  calculationKind: string;
  material: string;
  coefficientBasis: string;
  calibrationStatus: string;
  profileId: string;
  profileVersion: string;
  schemaVersion: string;
  sourceIds: string[];
  sourceLocator: string | null;
  measurementPointId: string | null;
  formula: string | null;
  referenceLabel: string;
  factorLabel: string;
  trace: string[];
  warnings: string[];
  alternativeGroupId?: string;
  variant?: "compound" | "simple";
  sortIndex: number;
}

export interface CalculationResponse {
  apiVersion: string;
  profileId: string;
  profileVersion: string;
  profileStatus: string;
  schemaVersion: string;
  algorithmVersion: string;
  scaleDenominator: number;
  normalizedMeasurements: Array<Record<string, unknown>>;
  results: CalculationResultRow[];
  sources: ProfileSource[];
  warnings: string[];
  validationErrors: Array<{ code: string; message: string; field?: string; nodeId?: string }>;
}

interface WorkerErrorBody {
  error?: { code?: unknown; message?: unknown; fields?: unknown };
  requestId?: unknown;
}

/** Ошибка калькулятора с кодом контракта; сообщение безопасно показывать клиенту. */
export class RiggingApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields: string[];

  constructor(code: string, message: string, status: number, fields: string[] = []) {
    super(message);
    this.name = "RiggingApiError";
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

async function requestJson<TResponse>(
  url: string,
  init: RequestInit,
  label: string,
): Promise<TResponse | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (response.status === 404 && label === "profile") return null;

    if (!response.ok) {
      const error = (payload as WorkerErrorBody | null)?.error;
      const code = typeof error?.code === "string" ? error.code : `HTTP_${response.status}`;
      const message =
        typeof error?.message === "string"
          ? error.message
          : `Rigging ${label} request returned HTTP ${response.status}`;
      const fields = Array.isArray(error?.fields)
        ? error.fields.filter((field): field is string => typeof field === "string")
        : [];

      console.error(JSON.stringify({ event: "rigging_api_error", label, status: response.status, code }));
      throw new RiggingApiError(code, message, response.status, fields);
    }

    if (payload === null) {
      throw new RiggingApiError("BAD_RESPONSE", `Rigging ${label} response is not valid JSON.`, response.status);
    }

    return payload as TResponse;
  } catch (error) {
    if (error instanceof RiggingApiError) throw error;

    if (controller.signal.aborted) {
      console.error(JSON.stringify({ event: "rigging_api_timeout", label, timeout_ms: config.requestTimeoutMs }));
      throw new RiggingApiError(
        "TIMEOUT",
        `Rigging ${label} request timed out after ${config.requestTimeoutMs} ms`,
        0,
      );
    }

    console.error(JSON.stringify({
      event: "rigging_api_unreachable",
      label,
      message: error instanceof Error ? error.message : String(error),
    }));
    throw new RiggingApiError("NETWORK_ERROR", `Rigging ${label} source is unreachable.`, 0);
  } finally {
    clearTimeout(timeout);
  }
}

/** Манифест профилей из Worker'а: id, статус, последняя и все версии. */
export async function listRiggingProfiles(): Promise<ProfilesResponse> {
  const payload = await requestJson<ProfilesResponse>(
    `${config.riggingApiBaseUrl}/api/rigging/v1/profiles`,
    { method: "GET", headers: { accept: "application/json" } },
    "profiles",
  );
  return payload as ProfilesResponse;
}

/**
 * Документ профиля с сайта. Без версии — последняя версия профиля.
 * Неизвестный профиль или версия — null (другой профиль не подставляется).
 */
export async function getRiggingProfileDocument(
  profileId: string,
  profileVersion?: string | null,
): Promise<ProfileDocument | null> {
  const path = profileVersion
    ? `/api/rigging/profiles/${encodeURIComponent(profileId)}/${encodeURIComponent(profileVersion)}`
    : `/api/rigging/profiles/${encodeURIComponent(profileId)}`;

  const document = await requestJson<ProfileDocument>(
    `${siteOrigin()}${path}`,
    { method: "GET", headers: { accept: "application/json" } },
    "profile",
  );

  if (!document) return null;
  if (!document.profile || typeof document.profile !== "object" || !document.profile.ui) {
    throw new RiggingApiError("BAD_RESPONSE", `Profile document for ${profileId} has an unexpected shape.`, 200);
  }
  if (document.profile.profileId !== profileId) {
    throw new RiggingApiError(
      "BAD_RESPONSE",
      `Profile source returned ${document.profile.profileId} for ${profileId}.`,
      200,
    );
  }
  return document;
}

/** Расчёт на Worker'е: POST /api/rigging/v1/calculate с развёрнутым RiggingInput. */
export async function calculateRigging(input: RiggingInput): Promise<CalculationResponse> {
  const payload = await requestJson<CalculationResponse>(
    `${config.riggingApiBaseUrl}/api/rigging/v1/calculate`,
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(input),
    },
    "calculate",
  );
  return payload as CalculationResponse;
}
