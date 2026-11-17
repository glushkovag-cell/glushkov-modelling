/**
 * Форматирование результатов для интерфейса.
 *
 * Правила повторяют эталонный калькулятор: диаметр — три знака, отклонение —
 * два знака со знаком, «почти ноль» выводится как 0.00% без знака. Ровно те же
 * правила зафиксированы в docs/rope-calculator/spec.md, раздел 7. Округление
 * только для отображения: API отдаёт полные числа.
 */

/** Диапазон ручного dTex в API v2. */
export const MIN_CUSTOM_DTEX = 20;
export const MAX_CUSTOM_DTEX = 6000;

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

/** Суммарный dTex: целое без дробной части, иначе до двух знаков. */
export function formatTotalDtex(totalDtex: number): string {
  return `${Number(totalDtex.toFixed(2))} dTex`;
}

export function formatLoad(grams: number): string {
  return `${grams} g`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Сводка выбранных нитей: «Selected 22 threads in 4 brands». */
export function formatSelectionSummary(threads: number, brands: number): string {
  return `Selected ${plural(threads, 'thread')} in ${plural(brands, 'brand')}`;
}

export function formatConstruction(threadsPerStrand: number): string {
  return `${threadsPerStrand} × 3`;
}

export function formatThreadLabel(thread: { brand: string; number: string; dtex: number }): string {
  return `${thread.brand} ${thread.number} — ${thread.dtex} dTex`;
}

/**
 * Разбирает ручной dTex. Возвращает null для пустого, нечислового значения и
 * выхода за диапазон, чтобы интерфейс показал ошибку до запроса к API.
 */
export function parseCustomDtex(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  if (value < MIN_CUSTOM_DTEX || value > MAX_CUSTOM_DTEX) return null;

  return value;
}
