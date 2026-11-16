/**
 * Состояние просмотра ведомости и чистые переходы между состояниями.
 *
 * Состояние не содержит результатов расчёта: только режим, фильтры, поиск,
 * сортировку и свёрнутые секции. Поэтому смена фильтра, режима или раскрытия
 * не может изменить входные данные, диаметры или выбранную нить.
 */

import {
    availableTiers,
    buildFacets,
    nodeLabel,
    type LedgerFilters,
    type LedgerMode,
    type LedgerRow,
    type LedgerSort,
    type LedgerType,
} from './ledgerView.ts';
import { TIER_LABELS } from './profile.ts';
import type { ResultStatus, Tier } from './types.ts';

export interface LedgerState {
    mode: LedgerMode;
    filters: LedgerFilters;
    query: string;
    sort: LedgerSort;
    showNotApplicable: boolean;
    /** Свёрнутые пользователем секции узлов; новые секции раскрыты. */
    collapsedNodes: ReadonlySet<string>;
}

export interface LedgerStateChange {
    state: LedgerState;
    notice: string | null;
}

export function initialLedgerState(): LedgerState {
    return {
        mode: 'grouped',
        filters: { node: 'all', tier: 'all', type: 'all', status: 'all' },
        query: '',
        sort: 'profile',
        showNotApplicable: false,
        collapsedNodes: new Set<string>(),
    };
}

function withFilters(state: LedgerState, filters: LedgerFilters): LedgerState {
    return { ...state, filters };
}

/**
 * Выбор узла. Несовместимый ярус сбрасывается с доступным уведомлением, а не
 * молча оставляет пустую выборку.
 */
export function setNode(state: LedgerState, node: string, rows: readonly LedgerRow[]): LedgerStateChange {
    const filters = { ...state.filters, node };
    const tiers = availableTiers(rows, node);
    let notice: string | null = null;

    if (filters.tier !== 'all' && !tiers.includes(filters.tier)) {
        notice = `${TIER_LABELS[filters.tier].en} is not available for ${
            node === 'all' ? 'this calculation' : nodeLabel(node)
        }. Tier filter reset to All.`;
        filters.tier = 'all';
    }

    return { state: withFilters(state, filters), notice };
}

export function setTier(
    state: LedgerState,
    tier: Tier | 'all',
    rows: readonly LedgerRow[],
): LedgerState {
    if (tier !== 'all' && !availableTiers(rows, state.filters.node).includes(tier)) {
        return state;
    }
    return withFilters(state, { ...state.filters, tier });
}

export function setType(state: LedgerState, type: LedgerType | 'all'): LedgerState {
    return withFilters(state, { ...state.filters, type });
}

/**
 * Not applicable — одновременно фильтр статуса и отдельный переключатель.
 * Выбор статуса включает показ, выключение показа снимает статус.
 */
export function setStatus(state: LedgerState, status: ResultStatus | 'all'): LedgerState {
    const filters = { ...state.filters, status };
    return {
        ...state,
        filters,
        showNotApplicable: status === 'not_applicable' ? true : state.showNotApplicable,
    };
}

export function setShowNotApplicable(state: LedgerState, shown: boolean): LedgerState {
    const filters = { ...state.filters };
    if (!shown && filters.status === 'not_applicable') filters.status = 'all';
    return { ...state, showNotApplicable: shown, filters };
}

export function setQuery(state: LedgerState, query: string): LedgerState {
    return { ...state, query };
}

export function setMode(state: LedgerState, mode: LedgerMode): LedgerState {
    return { ...state, mode };
}

export function setSort(state: LedgerState, sort: LedgerSort): LedgerState {
    return { ...state, sort };
}

/** Clear all: поиск и фильтры. Режим, сортировка и расчёт сохраняются. */
export function clearFilters(state: LedgerState): LedgerState {
    return {
        ...state,
        filters: { node: 'all', tier: 'all', type: 'all', status: 'all' },
        query: '',
        showNotApplicable: false,
    };
}

/** Свёрнутость узла меняется только вне поиска: поиск раскрывает совпадения. */
export function toggleSection(
    state: LedgerState,
    nodeId: string,
    queryActive: boolean,
): LedgerState {
    if (queryActive) return state;
    const collapsed = new Set(state.collapsedNodes);
    if (collapsed.has(nodeId)) collapsed.delete(nodeId);
    else collapsed.add(nodeId);
    return { ...state, collapsedNodes: collapsed };
}

/** Идемпотентно фиксирует открытое состояние секции после события toggle. */
export function setSectionOpen(
    state: LedgerState,
    nodeId: string,
    open: boolean,
    queryActive: boolean,
): LedgerState {
    if (queryActive) return state;
    const collapsed = new Set(state.collapsedNodes);
    if (open) collapsed.delete(nodeId);
    else collapsed.add(nodeId);
    return { ...state, collapsedNodes: collapsed };
}

export function setAllSections(
    state: LedgerState,
    open: boolean,
    nodeIds: readonly string[],
): LedgerState {
    const collapsed = new Set(state.collapsedNodes);
    for (const nodeId of nodeIds) {
        if (open) collapsed.delete(nodeId);
        else collapsed.add(nodeId);
    }
    return { ...state, collapsedNodes: collapsed };
}

export function tierFilterDisabled(rows: readonly LedgerRow[], node: string): boolean {
    return availableTiers(rows, node).length === 0;
}

export function tierFilterNote(rows: readonly LedgerRow[], node: string): string {
    if (!tierFilterDisabled(rows, node)) return '';
    if (node === 'all') return 'This configuration has no mast tiers, so the tier filter is unavailable.';
    return `${nodeLabel(node)} has no tiers, so the tier filter is unavailable.`;
}

/**
 * Приводит состояние к новому расчёту: исчезнувшие узел, ярус или статус
 * сбрасываются с уведомлением, а не оставляют пользователя с пустой
 * выборкой без объяснения.
 */
export function reconcileState(
    state: LedgerState,
    rows: readonly LedgerRow[],
): LedgerStateChange {
    const facets = buildFacets(rows);
    const filters = { ...state.filters };
    const notices: string[] = [];

    if (filters.node !== 'all' && !facets.nodes.some((node) => node.value === filters.node)) {
        notices.push(`${nodeLabel(filters.node)} is not part of this calculation. Node filter reset to All.`);
        filters.node = 'all';
        filters.tier = 'all';
    }

    if (
        filters.tier !== 'all' &&
        !availableTiers(rows, filters.node).includes(filters.tier)
    ) {
        notices.push(
            `${TIER_LABELS[filters.tier].en} is not available for ${
                filters.node === 'all' ? 'this calculation' : nodeLabel(filters.node)
            }. Tier filter reset to All.`,
        );
        filters.tier = 'all';
    }

    if (filters.status !== 'all' && !facets.statuses.includes(filters.status)) {
        notices.push('The selected status is not present in this calculation. Status filter reset to All.');
        filters.status = 'all';
    }

    if (filters.type !== 'all' && !facets.types.includes(filters.type)) {
        notices.push('The selected rigging type is not present in this calculation. Type filter reset to All.');
        filters.type = 'all';
    }

    return {
        state: notices.length > 0 ? { ...state, filters } : state,
        notice: notices.length > 0 ? notices.join(' ') : null,
    };
}
