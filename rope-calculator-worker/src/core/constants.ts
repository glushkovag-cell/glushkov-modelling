/** Версия HTTP-контракта. Меняется только при ломающем изменении API. */
export const API_VERSION = '1';

/** Версия расчётного алгоритма. Меняется при изменении формулы или допуска. */
export const ALGORITHM_VERSION = '1.0.0';

/** Прядей в канате всегда три. */
export const STRANDS = 3;

/** Допустимые значения числа нитей в пряди. */
export const THREAD_COUNTS = [1, 2, 3] as const;

/**
 * Допуск обратного подбора как доля. Граница включительная:
 * вариант попадает в выборку при |deviation| <= MAX_DEVIATION.
 */
export const MAX_DEVIATION = 0.15;

/**
 * Диапазон ручного dTex. Каталожные значения им не ограничены:
 * в каталоге есть нити 3750 и 6000 dTex.
 */
export const MIN_CUSTOM_DTEX = 80;
export const MAX_CUSTOM_DTEX = 6000;
