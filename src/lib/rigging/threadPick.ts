/**
 * Выбранная модельная нить для строки ведомости.
 *
 * Подбор выполняет существующий калькулятор канатов; здесь хранится результат
 * выбора, целевой диаметр и диаметр строки на момент выбора. После пересчёта
 * выбор не теряется: он привязывается к стабильному ключу строки, а изменение
 * диаметра помечает нить как требующую повторной проверки.
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
    /** Цель, для которой подбирали нить (может быть изменена в модалке). */
    targetMm: number;
    /** Диаметр строки в момент выбора; основа проверки актуальности. */
    rowDiameterMm: number;
}

/** Половина тысячной миллиметра: меньше этого считаем диаметр неизменным. */
export const THREAD_PICK_TOLERANCE_MM = 0.0005;

function finite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

export function makeThreadPick(
    match: Partial<ThreadMatch> | null | undefined,
    targetMm: number,
    rowDiameterMm: number = targetMm,
): ThreadPick | null {
    if (!match) return null;
    if (typeof match.threadId !== 'string' || match.threadId === '') return null;
    if (typeof match.brand !== 'string' || typeof match.number !== 'string') return null;
    if (!finite(match.dtex) || !finite(match.threadsPerStrand)) return null;
    if (!finite(match.diameterMm) || !finite(targetMm) || targetMm <= 0) return null;
    if (!finite(rowDiameterMm) || rowDiameterMm <= 0) return null;

    return {
        threadId: match.threadId,
        brand: match.brand,
        number: match.number,
        dtex: match.dtex,
        threadsPerStrand: match.threadsPerStrand,
        diameterMm: match.diameterMm,
        deviationPercent: finite(match.deviationPercent) ? match.deviationPercent : 0,
        targetMm,
        rowDiameterMm,
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

/**
 * Нить нужно перепроверить, если диаметр строки изменился после выбора или
 * если нить подбирали для цели, отличной от диаметра строки.
 */
export function threadPickNeedsReview(
    pick: ThreadPick,
    currentRowDiameterMm: number | null,
): boolean {
    if (!finite(currentRowDiameterMm)) return true;
    return (
        Math.abs(currentRowDiameterMm - pick.rowDiameterMm) > THREAD_PICK_TOLERANCE_MM ||
        Math.abs(pick.targetMm - pick.rowDiameterMm) > THREAD_PICK_TOLERANCE_MM
    );
}

export function threadPickReviewNote(
    pick: ThreadPick,
    currentRowDiameterMm: number | null,
): string | null {
    if (!threadPickNeedsReview(pick, currentRowDiameterMm)) return null;
    if (!finite(currentRowDiameterMm)) {
        return 'The row has no calculated diameter now. Check the input and pick the thread again.';
    }

    const reasons: string[] = [];
    if (Math.abs(currentRowDiameterMm - pick.rowDiameterMm) > THREAD_PICK_TOLERANCE_MM) {
        reasons.push(
            `Row diameter changed from ${pick.rowDiameterMm.toFixed(3)} mm to ` +
                `${currentRowDiameterMm.toFixed(3)} mm since the pick.`,
        );
    }
    if (Math.abs(pick.targetMm - pick.rowDiameterMm) > THREAD_PICK_TOLERANCE_MM) {
        reasons.push(
            `The thread was chosen for a ${pick.targetMm.toFixed(3)} mm target, ` +
                `not the row diameter ${pick.rowDiameterMm.toFixed(3)} mm.`,
        );
    }
    return reasons.join(' ');
}
