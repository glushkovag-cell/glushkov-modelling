/**
 * Измерения модели (поле Model.measurements WPGraphQL, плагин
 * gm-model-measurements) для get_build_details.
 *
 * Источник и выборка полей совпадают с Astro (src/lib/wordpress.ts:
 * getAllModels/getModelBySlug), поэтому MCP и сайт получают одни и те же
 * коды, подписи, описания, элементы, значения и порядок. Порядок задаёт
 * резолвер WordPress; здесь он не меняется.
 *
 * Значения относятся к физической модели и хранятся в мм; масштаб не
 * применяется. Отсутствующие измерения не дополняются нулями.
 *
 * Запрос выполняется отдельно от общего списка моделей: резолвер
 * сообщает о повреждённых данных ошибкой поля, и такая ошибка не должна
 * ломать list_builds и другие инструменты, читающие fetchAllModels().
 */
import { requestWithTimeout } from "./graphql-client.js";

export interface ModelMeasurementTarget {
  kind: string;
  id: string;
  label: string;
}

export interface ModelMeasurement {
  code: string;
  label: string;
  description: string;
  group: string;
  valueMm: number;
  target: ModelMeasurementTarget | null;
  note: string | null;
}

/** Результат чтения: либо список (возможно пустой), либо явная причина отсутствия. */
export type ModelMeasurementsResult =
  | { ok: true; measurements: ModelMeasurement[] }
  | { ok: false; error: string };

interface RawTarget {
  kind?: unknown;
  id?: unknown;
  label?: unknown;
}

interface RawMeasurement {
  code?: unknown;
  label?: unknown;
  description?: unknown;
  group?: unknown;
  valueMm?: unknown;
  target?: RawTarget | null;
  note?: unknown;
}

interface GetModelMeasurementsResponse {
  model: { measurements?: RawMeasurement[] | null } | null;
}

export const GET_MODEL_MEASUREMENTS = `
  query GetModelMeasurements($slug: ID!) {
    model(id: $slug, idType: SLUG) {
      measurements {
        code
        label
        description
        group
        valueMm
        target {
          kind
          id
          label
        }
        note
      }
    }
  }
`;

function requireString(value: unknown, field: string, index: number): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`measurements[${index}].${field} is missing`);
  }
  return value;
}

/**
 * Проверяет и копирует ответ GraphQL без пересортировки и без подмены
 * значений. Нарушение контракта — ошибка, а не пустой список.
 */
export function normalizeModelMeasurements(
    raw: readonly RawMeasurement[],
): ModelMeasurement[] {
  return raw.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`measurements[${index}] is not an object`);
    }

    const valueMm = item.valueMm;
    if (typeof valueMm !== "number" || !Number.isFinite(valueMm) || valueMm <= 0) {
      throw new Error(`measurements[${index}].valueMm is not a positive number`);
    }

    let target: ModelMeasurementTarget | null = null;
    if (item.target !== null && item.target !== undefined) {
      target = {
        kind: requireString(item.target.kind, "target.kind", index),
        id: requireString(item.target.id, "target.id", index),
        label: requireString(item.target.label, "target.label", index),
      };
    }

    const note = typeof item.note === "string" ? item.note : null;

    return {
      code: requireString(item.code, "code", index),
      label: requireString(item.label, "label", index),
      description: typeof item.description === "string" ? item.description : "",
      group: requireString(item.group, "group", index),
      valueMm,
      target,
      note,
    };
  });
}

/**
 * Читает измерения одной модели по slug — тем же способом, что
 * getModelBySlug() на сайте.
 * Ошибки сети, ошибки поля и null (нет доступа) возвращаются как
 * { ok: false }, чтобы инструмент мог отдать остальные данные модели.
 */
export async function fetchModelMeasurements(
    slug: string,
): Promise<ModelMeasurementsResult> {
  try {
    const data = await requestWithTimeout<GetModelMeasurementsResponse>(
        GET_MODEL_MEASUREMENTS,
        { slug },
    );

    const raw = data.model?.measurements;
    if (!Array.isArray(raw)) {
      return {
        ok: false,
        error: "Measurements are not available for this model.",
      };
    }

    return { ok: true, measurements: normalizeModelMeasurements(raw) };
  } catch (error) {
    return {
      ok: false,
      error: `Measurements could not be read: ${(error as Error).message}`,
    };
  }
}
