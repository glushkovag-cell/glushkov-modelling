/**
 * Сохранение представления ведомости между перезагрузками вкладки.
 *
 * Хранится только состояние просмотра: режим, фильтры, поиск, сортировка,
 * область экспорта и свёрнутые секции. Результаты расчёта, конфигурация
 * модели и выбранные нити здесь не сохраняются: после перезагрузки расчёт
 * выполняется заново по текущей форме.
 *
 * sessionStorage выбран сознательно: представление живёт в рамках вкладки и
 * не возвращает пользователя к старым фильтрам через дни.
 */

import { initialLedgerState, type ExportScope, type LedgerState } from './ledgerState.ts';
import type { LedgerMode, LedgerSort, LedgerType } from './ledgerView.ts';
import { TIERS, type ResultStatus, type Tier } from './types.ts';

export const LEDGER_STORAGE_KEY = 'rigging-ledger-view-v1';
const STORAGE_VERSION = 1;

export interface LedgerStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

const MODES: readonly LedgerMode[] = ['grouped', 'flat'];
const SORTS: readonly LedgerSort[] = [
    'profile',
    'name-asc',
    'name-desc',
    'diameter-asc',
    'diameter-desc',
];
const TYPES: readonly LedgerType[] = ['standing', 'running'];
const STATUSES: readonly ResultStatus[] = [
    'calculated',
    'needs_input',
    'unsupported',
    'not_applicable',
];

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function readFilters(value: unknown): LedgerState['filters'] {
    const filters = (value ?? {}) as Record<string, unknown>;
    return {
        node:
            typeof filters.node === 'string' && filters.node !== ''
                ? filters.node
                : 'all',
        tier: isOneOf(filters.tier, TIERS) ? (filters.tier as Tier) : 'all',
        type: isOneOf(filters.type, TYPES) ? (filters.type as LedgerType) : 'all',
        status: isOneOf(filters.status, STATUSES)
            ? (filters.status as ResultStatus)
            : 'all',
    };
}

export function loadLedgerState(storage: LedgerStorage | null): LedgerState | null {
    if (!storage) return null;

    let raw: string | null;
    try {
        raw = storage.getItem(LEDGER_STORAGE_KEY);
    } catch {
        return null;
    }
    if (!raw) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;

    const record = parsed as Record<string, unknown>;
    if (record.version !== STORAGE_VERSION) return null;

    const base = initialLedgerState();
    return {
        ...base,
        mode: isOneOf(record.mode, MODES) ? record.mode : base.mode,
        filters: readFilters(record.filters),
        query: typeof record.query === 'string' ? record.query : '',
        sort: isOneOf(record.sort, SORTS) ? record.sort : base.sort,
        showNotApplicable: record.showNotApplicable === true,
        exportScope: record.exportScope === 'selection' ? 'selection' : 'all',
        collapsedNodes: new Set(
            Array.isArray(record.collapsedNodes)
                ? record.collapsedNodes.filter(
                      (nodeId): nodeId is string => typeof nodeId === 'string',
                  )
                : [],
        ),
    };
}

export function saveLedgerState(state: LedgerState, storage: LedgerStorage | null): void {
    if (!storage) return;

    const payload = {
        version: STORAGE_VERSION,
        mode: state.mode,
        filters: state.filters,
        query: state.query,
        sort: state.sort,
        showNotApplicable: state.showNotApplicable,
        exportScope: state.exportScope satisfies ExportScope,
        collapsedNodes: [...state.collapsedNodes],
    };

    try {
        storage.setItem(LEDGER_STORAGE_KEY, JSON.stringify(payload));
    } catch {
        // Переполнение квоты или запрет storage не должны ломать просмотр.
    }
}

export function clearLedgerState(storage: LedgerStorage | null): void {
    try {
        storage?.removeItem(LEDGER_STORAGE_KEY);
    } catch {
        // ignore
    }
}
