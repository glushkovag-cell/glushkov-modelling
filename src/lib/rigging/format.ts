/**
 * Представление результатов. Округление только здесь: ядро хранит полную
 * точность. Для толщин такелажа спецификация профиля задаёт 0,01 мм.
 */

import type { RiggingResult } from './types.ts';

export function formatMm(value: number | null, digits = 2): string {
    if (value === null || !Number.isFinite(value)) return '—';
    return `${value.toFixed(digits)} mm`;
}

export function formatDiameter(value: number | null): string {
    return formatMm(value, 2);
}

export function formatCoefficient(value: number, digits = 2): string {
    return `${value.toFixed(digits)} ×`;
}

export function formatRuleFactor(factorLabel: string): string {
    return factorLabel === '—' ? '—' : `${factorLabel} ×`;
}

export function formatStatusCount(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`;
}

export function displayTier(result: Pick<RiggingResult, 'tier'>): string {
    if (result.tier === 'lower') return 'Lower mast';
    if (result.tier === 'topmast') return 'Topmast';
    if (result.tier === 'topgallant') return 'Topgallant';
    return '';
}
