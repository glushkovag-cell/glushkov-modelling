/**
 * Выбранная модельная нить для строки ведомости.
 *
 * Подбор выполняет существующий калькулятор канатов; здесь хранится только
 * результат выбора и целевой диаметр на момент выбора. Проверка актуальности
 * после пересчёта появится на следующем этапе, поэтому `targetMm` фиксируется
 * сразу.
 */

export interface ThreadMatch {
    threadId: string;
    brand: string;
    number: string;
    dtex: number;
    threadsPerStrand: number;
    diameterMm: number;
    deviationPercent: number;
}

export interface ThreadPick extends ThreadMatch {
    targetMm: number;
}

function finite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

export function makeThreadPick(
    match: Partial<ThreadMatch> | null | undefined,
    targetMm: number,
): ThreadPick | null {
    if (!match) return null;
    if (typeof match.threadId !== 'string' || match.threadId === '') return null;
    if (typeof match.brand !== 'string' || typeof match.number !== 'string') return null;
    if (!finite(match.dtex) || !finite(match.threadsPerStrand)) return null;
    if (!finite(match.diameterMm) || !finite(targetMm) || targetMm <= 0) return null;

    return {
        threadId: match.threadId,
        brand: match.brand,
        number: match.number,
        dtex: match.dtex,
        threadsPerStrand: match.threadsPerStrand,
        diameterMm: match.diameterMm,
        deviationPercent: finite(match.deviationPercent) ? match.deviationPercent : 0,
        targetMm,
    };
}

export function threadPickLabel(pick: ThreadPick): string {
    return `${pick.brand} ${pick.number}`;
}

export function threadPickDetails(pick: ThreadPick): string {
    const deviation =
        Math.abs(pick.deviationPercent) < 0.005
            ? '0.00%'
            : `${pick.deviationPercent > 0 ? '+' : ''}${pick.deviationPercent.toFixed(2)}%`;
    return `${pick.dtex} dTex · ${pick.threadsPerStrand} × 3 · Ø ${pick.diameterMm.toFixed(3)} mm · ${deviation}`;
}
