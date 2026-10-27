/**
 * Оценка диаметра каната.
 *
 * Выражение совпадает с RopeCalc.html до операции: сначала
 * 0.01752 × dtex^0.5437, затем умножение на n^0.5880. Порядок умножения
 * сохранён, чтобы результат совпадал с эталоном бит в бит.
 *
 * Промежуточного округления нет: точность обрезается только при выводе.
 */
export function calculateDiameterMm(dtex: number, threadsPerStrand: number): number {
  return 0.01752 * Math.pow(dtex, 0.5437) * Math.pow(threadsPerStrand, 0.5880);
}
