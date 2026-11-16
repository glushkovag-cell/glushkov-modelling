/**
 * Чистая модель представления ведомости такелажа.
 *
 * Здесь нет DOM и запросов: функции получают массив `RiggingResult` и
 * возвращают строки, секции, опции фильтров и подсветку. Расчёт не
 * запускается, значения диаметров не меняются — меняется только проекция.
 *
 * Классификация узла и вида такелажа опирается на подтверждённые поля DTO
 * (`ownerType`/`ownerId`, `tier`, `group`). Названия снастей для
 * классификации не используются: одно и то же правило повторяется по мачтам.
 */

import { GROUP_LABELS, OWNER_LABELS, STATUS_LABELS, TIER_LABELS } from './profile.ts';
import { ledgerRowKey } from './ledgerKey.ts';
import type { OwnerType, ResultStatus, RiggingResult, Tier } from './types.ts';
import { TIERS } from './types.ts';

export type LedgerNodeKind = 'mast' | 'bowsprit' | 'hull' | 'anchor' | 'gun' | 'other';
export type LedgerType = 'standing' | 'running';
export type LedgerMode = 'grouped' | 'flat';
export type LedgerSort =
    | 'profile'
    | 'name-asc'
    | 'name-desc'
    | 'diameter-asc'
    | 'diameter-desc';

export interface LedgerRow {
    result: RiggingResult;
    key: string;
    /** Узел = `ownerId`: fore / main / mizzen / bowsprit / hull / anchor_group / gun_group. */
    nodeId: string;
    nodeKind: LedgerNodeKind;
    tier: Tier | null;
    type: LedgerType | null;
    /** Порядок профиля: индекс в исходном ответе. */
    order: number;
}

export interface LedgerFilters {
    node: string;
    tier: Tier | 'all';
    type: LedgerType | 'all';
    status: ResultStatus | 'all';
}

export interface LedgerFilterState {
    filters: LedgerFilters;
    query: string;
    showNotApplicable: boolean;
}

export interface LedgerSelection {
    visible: LedgerRow[];
    /** M: строки расчёта с учётом переключателя неприменимых. */
    totalM: number;
    tokens: string[];
    /** Узлы, где есть совпадения поиска; нужны для авто-раскрытия секций. */
    matchingNodes: ReadonlySet<string>;
}

export interface LedgerNodeFacet {
    value: string;
    label: string;
    kind: LedgerNodeKind;
    count: number;
    tiers: Tier[];
    hasTierlessRows: boolean;
}

export interface LedgerFacets {
    nodes: LedgerNodeFacet[];
    tiers: Tier[];
    types: LedgerType[];
    statuses: ResultStatus[];
    hasTierlessRows: boolean;
}

export interface LedgerTypeGroup {
    type: LedgerType | null;
    label: string | null;
    rows: LedgerRow[];
}

export interface LedgerTierGroup {
    tier: Tier | null;
    label: string | null;
    types: LedgerTypeGroup[];
    count: number;
}

export interface LedgerNodeSection {
    nodeId: string;
    label: string;
    kind: LedgerNodeKind;
    /** Есть ли у узла настоящие ярусы (мачты). */
    hasTiers: boolean;
    tiers: LedgerTierGroup[];
    count: number;
}

export interface LedgerCondition {
    kind: 'query' | 'node' | 'tier' | 'type' | 'status' | 'notApplicable';
    label: string;
}

const NODE_ORDER: readonly string[] = [
    'fore',
    'main',
    'mizzen',
    'bowsprit',
    'hull',
    'hull_group',
    'anchor_group',
    'gun_group',
];

const NODE_KIND_BY_OWNER_TYPE: Record<OwnerType, LedgerNodeKind> = {
    mast: 'mast',
    bowsprit: 'bowsprit',
    hull: 'hull',
    anchor_group: 'anchor',
    gun_group: 'gun',
};

const TYPE_ORDER: readonly LedgerType[] = ['standing', 'running'];

const STATUS_ORDER: readonly ResultStatus[] = [
    'calculated',
    'needs_input',
    'unsupported',
    'not_applicable',
];

const nameCollator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const nameRuCollator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });

export function nodeKindOf(result: RiggingResult): LedgerNodeKind {
    return NODE_KIND_BY_OWNER_TYPE[result.ownerType] ?? 'other';
}

export function nodeLabel(nodeId: string): string {
    return OWNER_LABELS[nodeId] ?? nodeId;
}

export function typeOfGroup(group: string): LedgerType | null {
    return group === 'standing' || group === 'running' ? group : null;
}

export function buildLedgerRows(results: readonly RiggingResult[]): LedgerRow[] {
    return results.map((result, order) => ({
        result,
        key: ledgerRowKey(result),
        nodeId: result.ownerId,
        nodeKind: nodeKindOf(result),
        tier: result.tier ?? null,
        type: typeOfGroup(result.group),
        order,
    }));
}

export function availableTiers(rows: readonly LedgerRow[], node: string): Tier[] {
    const scoped = node === 'all' ? rows : rows.filter((row) => row.nodeId === node);
    return TIERS.filter((tier) => scoped.some((row) => row.tier === tier));
}

export function nodeHasTierlessRows(rows: readonly LedgerRow[], node: string): boolean {
    if (node === 'all') return rows.some((row) => row.tier === null);
    return rows.some((row) => row.nodeId === node && row.tier === null);
}

export function buildFacets(rows: readonly LedgerRow[]): LedgerFacets {
    const nodes = new Map<string, LedgerNodeFacet>();

    for (const row of rows) {
        let facet = nodes.get(row.nodeId);
        if (!facet) {
            facet = {
                value: row.nodeId,
                label: nodeLabel(row.nodeId),
                kind: row.nodeKind,
                count: 0,
                tiers: [],
                hasTierlessRows: false,
            };
            nodes.set(row.nodeId, facet);
        }
        facet.count += 1;
        if (row.tier && !facet.tiers.includes(row.tier)) facet.tiers.push(row.tier);
        if (row.tier === null) facet.hasTierlessRows = true;
    }

    const nodeOrder = (value: string): number => {
        const index = NODE_ORDER.indexOf(value);
        return index === -1 ? NODE_ORDER.length : index;
    };

    const nodeList = [...nodes.values()]
        .map((facet) => ({
            ...facet,
            tiers: TIERS.filter((tier) => facet.tiers.includes(tier)),
        }))
        .sort(
            (a, b) =>
                nodeOrder(a.value) - nodeOrder(b.value) ||
                nameCollator.compare(a.label, b.label) ||
                nameCollator.compare(a.value, b.value),
        );

    return {
        nodes: nodeList,
        tiers: TIERS.filter((tier) => rows.some((row) => row.tier === tier)),
        types: TYPE_ORDER.filter((type) => rows.some((row) => row.type === type)),
        statuses: STATUS_ORDER.filter((status) =>
            rows.some((row) => row.result.status === status),
        ),
        hasTierlessRows: rows.some((row) => row.tier === null),
    };
}

/** Нормализация поиска: регистр и е/ё не различаются. */
export function normalizeSearchText(value: string): string {
    return value.toLowerCase().replace(/ё/g, 'е');
}

export function searchTokens(query: string): string[] {
    return normalizeSearchText(query).trim().split(/\s+/).filter(Boolean);
}

export function rowMatchesTokens(row: LedgerRow, tokens: readonly string[]): boolean {
    if (tokens.length === 0) return true;
    const en = normalizeSearchText(row.result.nameEn);
    const ru = normalizeSearchText(row.result.nameRu);
    // Все слова запроса должны найтись в одном названии: английском или
    // русском. Смешивать половину слов из разных названий нельзя.
    return (
        tokens.every((token) => en.includes(token)) ||
        tokens.every((token) => ru.includes(token))
    );
}

export interface HighlightSegment {
    text: string;
    match: boolean;
}

function normalizeChar(char: string): string {
    return char.toLowerCase().replace(/ё/g, 'е');
}

/**
 * Разбивает текст на подсвечиваемые и обычные участки. Возвращает данные, а
 * не HTML: вызывающий код создаёт текстовые узлы и `<mark>`, поэтому вставка
 * названия снасти не может стать разметкой.
 */
export function highlightSegments(
    text: string,
    tokens: readonly string[],
): HighlightSegment[] {
    if (tokens.length === 0) return [{ text, match: false }];

    const chars = Array.from(text);
    const normalizedParts: string[] = [];
    const owner: number[] = [];

    for (const [charIndex, char] of chars.entries()) {
        for (const part of normalizeChar(char)) {
            normalizedParts.push(part);
            owner.push(charIndex);
        }
    }

    const normalized = normalizedParts.join('');
    const mask = new Array<boolean>(chars.length).fill(false);

    for (const token of tokens) {
        let from = 0;
        while (token.length > 0 && from <= normalized.length - token.length) {
            const index = normalized.indexOf(token, from);
            if (index === -1) break;
            const start = owner[index];
            const end = owner[index + token.length - 1];
            for (let i = start; i <= end; i += 1) mask[i] = true;
            from = index + 1;
        }
    }

    const segments: HighlightSegment[] = [];
    for (const [index, char] of chars.entries()) {
        const match = mask[index];
        const last = segments.at(-1);
        if (last && last.match === match) {
            last.text += char;
        } else {
            segments.push({ text: char, match });
        }
    }

    return segments;
}

export function sortLedgerRows(rows: readonly LedgerRow[], sort: LedgerSort): LedgerRow[] {
    if (sort === 'profile') return [...rows];

    const sorted = [...rows];

    if (sort === 'name-asc' || sort === 'name-desc') {
        const direction = sort === 'name-desc' ? -1 : 1;
        sorted.sort((a, b) => {
            const primary =
                nameCollator.compare(a.result.nameEn, b.result.nameEn) * direction ||
                nameRuCollator.compare(a.result.nameRu, b.result.nameRu) * direction;
            return primary || a.order - b.order;
        });
        return sorted;
    }

    const descending = sort === 'diameter-desc';
    sorted.sort((a, b) => {
        const left = a.result.diameterModelMm;
        const right = b.result.diameterModelMm;
        // Строки без диаметра всегда после числовых, в обоих направлениях.
        if (left === null && right === null) return a.order - b.order;
        if (left === null) return 1;
        if (right === null) return -1;
        return (left - right) * (descending ? -1 : 1) || a.order - b.order;
    });
    return sorted;
}

function groupByNode(rows: readonly LedgerRow[]): Map<string, LedgerRow[]> {
    const groups = new Map<string, LedgerRow[]>();
    for (const row of rows) {
        const list = groups.get(row.nodeId);
        if (list) list.push(row);
        else groups.set(row.nodeId, [row]);
    }
    return groups;
}

/**
 * Группировка по умолчанию: узел → ярус → вид такелажа → строки.
 * Ярусы одной мачты — соседние подразделы; строки без яруса идут в «No tier»
 * последними. У бушприта, якорей и орудий искусственных ярусов нет.
 */
export function groupedLedger(
    rows: readonly LedgerRow[],
    sort: LedgerSort = 'profile',
): LedgerNodeSection[] {
    const facets = buildFacets(rows);
    const byNode = groupByNode(rows);

    return facets.nodes
        .map((facet) => {
            const nodeRows = byNode.get(facet.value) ?? [];
            const hasTiers = nodeRows.some((row) => row.tier !== null);
            const tierKeys: Array<Tier | null> = hasTiers
                ? [...TIERS.filter((tier) => nodeRows.some((row) => row.tier === tier)), null]
                : [null];

            const tiers: LedgerTierGroup[] = tierKeys
                .map((tier) => {
                    const tierRows = nodeRows.filter((row) => row.tier === tier);
                    if (tierRows.length === 0) return null;

                    const typeKeys: Array<LedgerType | null> = TYPE_ORDER.filter((type) =>
                        tierRows.some((row) => row.type === type),
                    );
                    if (tierRows.some((row) => row.type === null)) typeKeys.push(null);

                    const types: LedgerTypeGroup[] = typeKeys.map((type) => ({
                        type,
                        label: type ? GROUP_LABELS[type] : null,
                        rows: sortLedgerRows(
                            tierRows.filter((row) => row.type === type),
                            sort,
                        ),
                    }));

                    return {
                        tier,
                        label: tier ? TIER_LABELS[tier].en : hasTiers ? 'No tier' : null,
                        types,
                        count: tierRows.length,
                    };
                })
                .filter((group): group is LedgerTierGroup => group !== null);

            return {
                nodeId: facet.value,
                label: facet.label,
                kind: facet.kind,
                hasTiers,
                tiers,
                count: nodeRows.length,
            };
        })
        .filter((section) => section.count > 0);
}

export function selectLedgerRows(
    rows: readonly LedgerRow[],
    state: LedgerFilterState,
): LedgerSelection {
    const base = rows.filter(
        (row) => state.showNotApplicable || row.result.status !== 'not_applicable',
    );
    const { filters } = state;

    const filtered = base.filter((row) => {
        if (filters.node !== 'all' && row.nodeId !== filters.node) return false;
        if (filters.tier !== 'all' && row.tier !== filters.tier) return false;
        if (filters.type !== 'all' && row.type !== filters.type) return false;
        if (filters.status !== 'all' && row.result.status !== filters.status) return false;
        return true;
    });

    const tokens = searchTokens(state.query);
    const matchingNodes = new Set<string>();
    let visible = filtered;

    if (tokens.length > 0) {
        visible = filtered.filter((row) => {
            const matched = rowMatchesTokens(row, tokens);
            if (matched) matchingNodes.add(row.nodeId);
            return matched;
        });
    }

    return {
        visible,
        totalM: base.length,
        tokens,
        matchingNodes,
    };
}

export function isSectionOpen(
    collapsedNodes: ReadonlySet<string>,
    nodeId: string,
    query: string,
    matchingNodes: ReadonlySet<string>,
): boolean {
    if (query.trim() !== '' && matchingNodes.has(nodeId)) return true;
    return !collapsedNodes.has(nodeId);
}

export function activeConditions(state: LedgerFilterState): LedgerCondition[] {
    const conditions: LedgerCondition[] = [];
    const query = state.query.trim();
    if (query !== '') conditions.push({ kind: 'query', label: `Search: “${query}”` });

    if (state.filters.node !== 'all') {
        conditions.push({ kind: 'node', label: `Node: ${nodeLabel(state.filters.node)}` });
    }
    if (state.filters.tier !== 'all') {
        conditions.push({
            kind: 'tier',
            label: `Tier: ${TIER_LABELS[state.filters.tier].en}`,
        });
    }
    if (state.filters.type !== 'all') {
        conditions.push({
            kind: 'type',
            label: `Rigging type: ${GROUP_LABELS[state.filters.type]}`,
        });
    }
    if (state.filters.status !== 'all') {
        conditions.push({
            kind: 'status',
            label: `Status: ${STATUS_LABELS[state.filters.status]}`,
        });
    }
    if (state.showNotApplicable) {
        conditions.push({ kind: 'notApplicable', label: 'Not applicable shown' });
    }

    return conditions;
}

export function hasActiveConditions(state: LedgerFilterState): boolean {
    return (
        state.query.trim() !== '' ||
        state.filters.node !== 'all' ||
        state.filters.tier !== 'all' ||
        state.filters.type !== 'all' ||
        state.filters.status !== 'all' ||
        state.showNotApplicable
    );
}
