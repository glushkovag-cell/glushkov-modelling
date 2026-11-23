/**
 * Представление измерений модели для публичного интерфейса.
 *
 * Данные приходят из GraphQL уже нормализованными и отсортированными
 * (WordPress: группа по алфавиту, затем порядок вида измерения и элемента).
 * Здесь только раскладка по группам для диалога: габаритная длина идёт
 * первой строкой, остальные измерения — по группам, пустые группы не
 * создаются.
 */

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
  target?: ModelMeasurementTarget | null;
  note?: string | null;
}

export interface MeasurementGroup {
  code: string;
  label: string;
  measurements: ModelMeasurement[];
}

export interface GroupedModelMeasurements {
  overallLength: ModelMeasurement | null;
  groups: MeasurementGroup[];
}

export const OVERALL_LENGTH_CODE = 'overall_length';

const GROUP_LABELS: Record<string, string> = {
  overall: 'Overall',
  hull: 'Hull',
  rig: 'Rigging',
  armament: 'Armament',
  other: 'Other',
};

function humanizeGroupCode(code: string): string {
  const normalized = code.trim().replace(/[_-]+/g, ' ');
  if (!normalized) return 'Other';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function measurementGroupLabel(code: string): string {
  return GROUP_LABELS[code] ?? humanizeGroupCode(code);
}

function isValidMeasurement(measurement: ModelMeasurement): boolean {
  return (
    typeof measurement.valueMm === 'number' &&
    Number.isFinite(measurement.valueMm) &&
    measurement.valueMm > 0
  );
}

/**
 * Габаритная длина вынимается из общего списка и показывается отдельной
 * первой строкой. Остальные измерения сохраняют серверный порядок; группа
 * создаётся при первом появлении и не создаётся, если в ней нет значений.
 */
export function groupModelMeasurements(
  measurements: readonly ModelMeasurement[] | null | undefined,
): GroupedModelMeasurements {
  const valid = (measurements ?? []).filter(isValidMeasurement);

  let overallLength: ModelMeasurement | null = null;
  const groups = new Map<string, MeasurementGroup>();

  for (const measurement of valid) {
    if (!overallLength && measurement.code === OVERALL_LENGTH_CODE) {
      overallLength = measurement;
      continue;
    }

    const code = measurement.group || 'other';
    let group = groups.get(code);
    if (!group) {
      group = {
        code,
        label: measurementGroupLabel(code),
        measurements: [],
      };
      groups.set(code, group);
    }
    group.measurements.push(measurement);
  }

  return {
    overallLength,
    groups: [...groups.values()],
  };
}

/**
 * Подпись строки: «Диаметр мачты — Грот-мачта». Для размеров без элемента
 * остаётся только название вида измерения.
 */
export function measurementDisplayLabel(measurement: ModelMeasurement): string {
  const label = measurement.label?.trim() || measurement.code;
  const targetLabel = measurement.target?.label?.trim();
  return targetLabel ? `${label} — ${targetLabel}` : label;
}

/**
 * Описание выводится только тогда, когда оно действительно уточняет название.
 * В CMS встречаются определения, дословно повторяющие название; дублировать
 * их в диалоге не нужно.
 */
export function measurementDescription(measurement: ModelMeasurement): string | null {
  const description = measurement.description?.trim();
  if (!description) return null;
  const label = measurement.label?.trim() || measurement.code;
  return description.toLowerCase() === label.toLowerCase() ? null : description;
}

/**
 * Значение выводится как есть, без форматирования и округления: сохранённая
 * дробь не должна незаметно превращаться в другое число.
 */
export function formatMeasurementValue(valueMm: number): string {
  return String(valueMm);
}
