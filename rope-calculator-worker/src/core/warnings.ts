import { MEASURED_DTEX_MAX, MEASURED_DTEX_MIN } from './constants';

/** Машинно-читаемое предупреждение расчёта. */
export interface ModelWarning {
  code: 'EXTRAPOLATION';
  message: string;
  fields: readonly string[];
}

const EXTRAPOLATION: ModelWarning = {
  code: 'EXTRAPOLATION',
  message:
    `The linear density is above the measured range of ${MEASURED_DTEX_MIN}–${MEASURED_DTEX_MAX} dTex. ` +
    'The diameter is an extrapolation of an empirical model, not a measured value.',
  fields: ['dtex'],
};

/**
 * Предупреждения для одного расчёта.
 *
 * Выше MEASURED_DTEX_MAX расчёт не запрещён — поддерживаются каталожные
 * значения до 6000 dTex, — но результат помечается EXTRAPOLATION. Вне
 * диапазона 22.22–6000 прогноз запрещён вовсе: эту границу проверяет
 * валидация, а не предупреждение.
 */
export function warningsForDtex(dtex: number): ModelWarning[] {
  return dtex > MEASURED_DTEX_MAX ? [EXTRAPOLATION] : [];
}

/** Схлопывает повторы предупреждений по коду, сохраняя первое вхождение. */
export function mergeWarnings(warnings: readonly ModelWarning[]): ModelWarning[] {
  const seen = new Set<string>();
  const unique: ModelWarning[] = [];

  for (const warning of warnings) {
    if (seen.has(warning.code)) continue;
    seen.add(warning.code);
    unique.push(warning);
  }

  return unique;
}
