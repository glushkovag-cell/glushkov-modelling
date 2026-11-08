/**
 * Чистые правила доступности полей формы.
 *
 * Вынесены из DOM-контроллера, чтобы поведение зависимых чекбоксов можно было
 * проверить без браузера. Ядро эти правила не использует: оно работает с уже
 * развёрнутым списком узлов.
 */

import type { MastSettings } from './settings.ts';
import type { Tier } from './types.ts';

export type TierAvailability = Record<Tier, boolean>;

/**
 * Цепочка ярусов: стеньга существует только при мачте, брам-стеньга — только
 * при стеньге. Снятая мачта запрещает все свои ярусы и всё, что на них висит.
 */
export function tierAvailability(
    mast: Pick<MastSettings, 'present' | 'topmast' | 'topgallant'>,
): TierAvailability {
    const topmast = mast.present && mast.topmast;
    const topgallant = topmast && mast.topgallant;
    return { lower: mast.present, topmast, topgallant };
}

/** Рей выбирается, только если его ярус физически присутствует. */
export function yardSelectable(
    mast: Pick<MastSettings, 'present' | 'topmast' | 'topgallant'>,
    tier: Tier,
): boolean {
    return tierAvailability(mast)[tier];
}

/**
 * Парус выбирается, только если присутствует мачта, присутствует ярус и
 * выбран рей этого яруса. Это закрывает прежнюю ошибку: при снятой мачте реи
 * запрещались, а паруса оставались доступными.
 */
export function sailSelectable(
    mast: Pick<MastSettings, 'present' | 'topmast' | 'topgallant'>,
    tier: Tier,
    yardSelected: boolean,
): boolean {
    return yardSelectable(mast, tier) && yardSelected;
}

/** Роль, привязанная к мачте (гафель, косой парус, флаг), без мачты недоступна. */
export function mastOwnedRoleSelectable(mastPresent: boolean): boolean {
    return mastPresent;
}
