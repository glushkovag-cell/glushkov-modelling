/**
 * Явный адаптер между измерениями модели в CMS и входами калькулятора
 * толщин такелажа.
 *
 * Сопоставление только по стабильным кодам и кодам элементов CMS. Габаритная
 * ширина не подменяет ширину корпуса, произвольный диаметр не выбирается:
 * mast_diameter допускается только для fore_mast, main_mast и mizzen_mast.
 * Недостающие входы не заполняются нулями или демонстрационными значениями.
 *
 * Сохранённые измерения относятся к физической модели и хранятся в мм,
 * поэтому в форму передаются как value = valueMm, unit = mm, basis = model.
 * Масштаб повторно не применяется: его применяет расчётное ядро.
 */

export interface MeasurementSourceTarget {
  kind?: string | null;
  id?: string | null;
  label?: string | null;
}

export interface MeasurementSource {
  code: string;
  label?: string | null;
  valueMm: number;
  target?: MeasurementSourceTarget | null;
}

export type PrefillField =
  | 'mastDiameter.fore'
  | 'mastDiameter.main'
  | 'mastDiameter.mizzen'
  | 'bowspritDiameter'
  | 'hullWidth'
  | 'gunBore';

export const PREFILL_FIELDS: readonly PrefillField[] = [
  'mastDiameter.fore',
  'mastDiameter.main',
  'mastDiameter.mizzen',
  'bowspritDiameter',
  'hullWidth',
  'gunBore',
];

export const PREFILL_FIELD_LABELS: Record<PrefillField, string> = {
  'mastDiameter.fore': 'Foremast diameter',
  'mastDiameter.main': 'Mainmast diameter',
  'mastDiameter.mizzen': 'Mizzenmast diameter',
  bowspritDiameter: 'Bowsprit diameter',
  hullWidth: 'Hull width',
  gunBore: 'Gun bore',
};

interface PrefillRule {
  code: string;
  /** null — измерение без элемента (target_kind = none). */
  targetKind: 'mast' | null;
  /** Стабильный код элемента CMS, например fore_mast. */
  targetId: string | null;
  field: PrefillField;
}

/**
 * Коды элементов CMS намеренно не совпадают с входами калькулятора
 * (fore_mast → fore). Это соответствие задано здесь, а не угадывается.
 */
export const PREFILL_RULES: readonly PrefillRule[] = [
  {
    code: 'mast_diameter',
    targetKind: 'mast',
    targetId: 'fore_mast',
    field: 'mastDiameter.fore',
  },
  {
    code: 'mast_diameter',
    targetKind: 'mast',
    targetId: 'main_mast',
    field: 'mastDiameter.main',
  },
  {
    code: 'mast_diameter',
    targetKind: 'mast',
    targetId: 'mizzen_mast',
    field: 'mastDiameter.mizzen',
  },
  {
    code: 'bowsprit_diameter',
    targetKind: null,
    targetId: null,
    field: 'bowspritDiameter',
  },
  {
    code: 'hull_width',
    targetKind: null,
    targetId: null,
    field: 'hullWidth',
  },
  {
    code: 'gun_bore',
    targetKind: null,
    targetId: null,
    field: 'gunBore',
  },
];

const PREFILL_CODES = new Set(PREFILL_RULES.map((rule) => rule.code));

export interface PrefillApplied {
  field: PrefillField;
  code: string;
  label: string;
  targetId: string | null;
  valueMm: number;
}

export interface PrefillDiagnostic {
  code: string;
  targetId: string | null;
  message: string;
}

export interface ModelPrefillResult {
  values: Partial<Record<PrefillField, number>>;
  applied: PrefillApplied[];
  missing: PrefillField[];
  diagnostics: PrefillDiagnostic[];
}

export interface PrefillMeasurement {
  value: number;
  unitId: 'mm';
  basis: 'model';
}

function targetKindOf(measurement: MeasurementSource): string | null {
  return measurement.target?.kind?.trim() || null;
}

function targetIdOf(measurement: MeasurementSource): string | null {
  return measurement.target?.id?.trim() || null;
}

function matchesRule(measurement: MeasurementSource, rule: PrefillRule): boolean {
  if (measurement.code !== rule.code) return false;

  const kind = targetKindOf(measurement);
  const id = targetIdOf(measurement);

  if (rule.targetKind === null) {
    // Размер модели целиком не должен нести элемент.
    return kind === null && id === null;
  }

  return kind === rule.targetKind && id === rule.targetId;
}

/**
 * Переносит только те измерения, которые явно сопоставлены адаптером.
 * Возвращает также список незаполненных входов и диагностику по
 * неоднозначным/некорректным записям, чтобы UI мог показать их явно.
 */
export function mapModelMeasurements(
  measurements: readonly MeasurementSource[] | null | undefined,
): ModelPrefillResult {
  const values: Partial<Record<PrefillField, number>> = {};
  const applied: PrefillApplied[] = [];
  const diagnostics: PrefillDiagnostic[] = [];
  const seenFields = new Set<PrefillField>();
  const reported = new Set<string>();

  for (const measurement of measurements ?? []) {
    if (!PREFILL_CODES.has(measurement.code)) continue;

    const matchingRule = PREFILL_RULES.find((rule) => matchesRule(measurement, rule));
    if (!matchingRule) {
      const kind = targetKindOf(measurement);
      const id = targetIdOf(measurement);
      const key = `${measurement.code}|${kind ?? ''}|${id ?? ''}`;
      if (!reported.has(key)) {
        reported.add(key);
        diagnostics.push({
          code: measurement.code,
          targetId: id,
          message: `Measurement ${measurement.code}${
            id ? ` for ${id}` : ''
          } is not mapped to a calculator input.`,
        });
      }
      continue;
    }

    const field = matchingRule.field;

    if (
      typeof measurement.valueMm !== 'number' ||
      !Number.isFinite(measurement.valueMm) ||
      measurement.valueMm <= 0
    ) {
      diagnostics.push({
        code: measurement.code,
        targetId: targetIdOf(measurement),
        message: `Measurement ${measurement.code} has no usable positive value and was not applied.`,
      });
      continue;
    }

    if (seenFields.has(field)) {
      diagnostics.push({
        code: measurement.code,
        targetId: targetIdOf(measurement),
        message: `Duplicate measurement for ${PREFILL_FIELD_LABELS[field]} was ignored.`,
      });
      continue;
    }

    seenFields.add(field);
    values[field] = measurement.valueMm;
    applied.push({
      field,
      code: measurement.code,
      label: measurement.label?.trim() || PREFILL_FIELD_LABELS[field],
      targetId: targetIdOf(measurement),
      valueMm: measurement.valueMm,
    });
  }

  return {
    values,
    applied,
    missing: PREFILL_FIELDS.filter((field) => values[field] === undefined),
    diagnostics,
  };
}

/**
 * Значение из CMS уже в миллиметрах и относится к модели. Эти поля нельзя
 * пересчитывать по масштабу при переносе в форму.
 */
export function measurementFromPrefill(valueMm: number): PrefillMeasurement {
  return {
    value: valueMm,
    unitId: 'mm',
    basis: 'model',
  };
}

/**
 * Разбирает строку масштаба карточки модели: «1:64», «1/64» или «64».
 * Неизвестный формат не подменяется догадкой.
 */
export function parseModelScale(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().replace(',', '.');
  if (!value) return null;

  const ratio = /^1\s*[:/]\s*(\d+(?:\.\d+)?)$/.exec(value);
  const bare = /^(\d+(?:\.\d+)?)$/.exec(value);
  const denominator = Number(ratio?.[1] ?? bare?.[1]);

  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return denominator;
}
