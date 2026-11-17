/**
 * Форматирование результатов для интерфейса.
 *
 * Правила: диаметр — три знака, отклонение — два знака со знаком, «почти
 * ноль» выводится как 0.00% без знака. Ровно те же правила зафиксированы в
 * docs/rope-calculator/spec.md, раздел 7. Округление только для отображения:
 * API отдаёт полные числа.
 *
 * Границы диапазона дублируют контракт Worker'а: интерфейс проверяет ввод до
 * запроса, чтобы не показывать ошибку сети вместо ошибки параметра.
 */

export const MIN_CUSTOM_DTEX = 22.22;
export const MAX_CUSTOM_DTEX = 6000;

/**
 * Верхняя граница измеренного диапазона. Выше неё расчёт разрешён, но Worker
 * помечает ответ предупреждением EXTRAPOLATION, поэтому интерфейс упоминает
 * эту границу в пояснении, а не проверяет её сам.
 */
export const MEASURED_DTEX_MAX = 3000;

/** Допуск обратного подбора в процентах: подпись, а не правило расчёта. */
export const TOLERANCE_PERCENT = 10;

/** Порог, ниже которого отклонение печатается как 0.00%. */
export const NEAR_ZERO_PERCENT = 0.005;

export function formatDiameter(diameterMm: number): string {
  return `${diameterMm.toFixed(3)} mm`;
}

export function formatDeviation(deviationPercent: number): string {
  if (Math.abs(deviationPercent) < NEAR_ZERO_PERCENT) {
    return '0.00%';
  }
  const fixed = deviationPercent.toFixed(2);
  if (Number(fixed) === 0) return '0.00%';
  const sign = deviationPercent > 0 ? '+' : '';
  return `${sign}${fixed}%`;
}

export function formatConstruction(threadsPerStrand: number): string {
  return `${threadsPerStrand} × 3`;
}

export function formatThreadLabel(thread: { brand: string; number: string; dtex: number }): string {
  return `${thread.brand} ${thread.number} — ${thread.dtex} dTex`;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/**
 * Сводка выбора вместо раскрытого каталога: «Selected 22 threads in 3 brands».
 *
 * Счётчики строятся только по фактически отмеченным нитям, поэтому сводка
 * всегда отражает реальный выбор, а не число загруженных нитей.
 */
export function formatSelectionSummary(threads: number, brands: number): string {
  if (threads === 0) {
    return 'No threads selected';
  }

  return (
    `Selected ${threads} ${plural(threads, 'thread', 'threads')} in ` +
    `${brands} ${plural(brands, 'brand', 'brands')}`
  );
}

/**
 * Нормализует числовой ввод: десятичная запятая допустима и превращается в
 * точку. API принимает только JSON numbers, поэтому запятая живёт на границе
 * интерфейса и дальше не проникает.
 */
export function normalizeDecimal(raw: string): string {
  return raw.trim().replace(',', '.');
}

/**
 * Разбирает ручной dTex. Возвращает null для пустого, нечислового значения и
 * выхода за диапазон, чтобы интерфейс показал ошибку до запроса к API.
 */
export function parseCustomDtex(raw: string): number | null {
  const normalized = normalizeDecimal(raw);
  if (normalized === '') return null;

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  if (value < MIN_CUSTOM_DTEX || value > MAX_CUSTOM_DTEX) return null;

  return value;
}

/**
 * Разбирает целевой диаметр. Ноль, отрицательные значения и мусор дают null:
 * обратный подбор требует диаметр больше нуля.
 */
export function parseTargetDiameter(raw: string): number | null {
  const normalized = normalizeDecimal(raw);
  if (normalized === '') return null;

  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;

  return value;
}
