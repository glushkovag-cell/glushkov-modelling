/**
 * Формула замороженного контракта v1 (алгоритм 2.0.0).
 *
 * Выражение совпадает с RopeCalc.html: сначала
 * 0.0204055952 × dtex^0.5293147610, затем умножение на n^0.5366123919.
 * Числа v1 не меняются: клиенты этого контракта получают прежние диаметры.
 *
 * Актуальная модель без груза — `core/model.ts` (algorithmVersion 4.0.0).
 */
export function calculateDiameterMm(dtex: number, threadsPerStrand: number): number {
  return 0.0204055952 * Math.pow(dtex, 0.5293147610) * Math.pow(threadsPerStrand, 0.5366123919);
}
