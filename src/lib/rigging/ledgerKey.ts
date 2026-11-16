/**
 * Стабильный ключ строки ведомости.
 *
 * Ключ строится только из идентификаторов расчёта и не зависит от порядка
 * отображения, переведённого названия, диаметра или статуса. Поэтому он
 * переживает фильтрацию, сортировку, смену режима и повторный расчёт, пока
 * строка остаётся той же самой снастью в том же узле и ярусе.
 *
 * Проверено на контрольной полной конфигурации traditional_plant: ключ
 * уникален для всех строк (см. tests/rigging-control.test.ts).
 */

import type { RiggingResult } from './types.ts';

export const LEDGER_KEY_SEPARATOR = '|';

export type LedgerKeySource = Pick<
    RiggingResult,
    'ownerId' | 'nodeId' | 'ruleId' | 'tier' | 'variant'
>;

export function ledgerRowKey(result: LedgerKeySource): string {
    return [
        result.ownerId,
        result.nodeId,
        result.ruleId,
        result.tier ?? '',
        result.variant ?? '',
    ].join(LEDGER_KEY_SEPARATOR);
}
