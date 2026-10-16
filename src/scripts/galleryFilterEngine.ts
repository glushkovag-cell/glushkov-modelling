import type {
    GalleryFilterIndex,
    GalleryFilterIndexItem,
} from '../lib/gallery';

export interface FilterState {
    period: string[];
    scale: string[];
    tag: string[];
}

export type FilterGroup = keyof FilterState;

const FILTER_GROUPS: FilterGroup[] = [
    'period',
    'scale',
    'tag',
];

export function createEmptyFilterState(): FilterState {
    return {
        period: [],
        scale: [],
        tag: [],
    };
}

/**
 * Retained as an alias for existing imports.
 */
export const emptyState = createEmptyFilterState;

function uniqueValues(values: string[]): string[] {
    return [
        ...new Set(
            values
                .map((value) => value.trim())
                .filter(Boolean),
        ),
    ];
}

/**
 * Normalizes a filter state received from UI code.
 */
export function normalizeFilterState(
    state: FilterState,
): FilterState {
    return {
        period: uniqueValues(state.period),
        scale: uniqueValues(state.scale),
        tag: uniqueValues(state.tag),
    };
}

/**
 * Filtering rules:
 *
 * - selected periods use OR;
 * - selected scales use OR;
 * - selected tags use OR regardless of facet;
 * - period, scale and tag groups are combined with AND.
 */
export function matchesGalleryFilterItem(
    item: GalleryFilterIndexItem,
    state: FilterState,
): boolean {
    const matchesPeriod =
        state.period.length === 0 ||
        state.period.includes(item.period);

    const matchesScale =
        state.scale.length === 0 ||
        state.scale.includes(item.scale);

    const matchesTag =
        state.tag.length === 0 ||
        state.tag.some((tag) => item.tags.includes(tag));

    return (
        matchesPeriod &&
        matchesScale &&
        matchesTag
    );
}

/**
 * Returns keys of all items matching the current state.
 *
 * For a model index, keys are model slugs.
 * For a photo index, keys are model/file identifiers.
 */
export function computeResult(
    index: GalleryFilterIndex,
    state: FilterState,
): string[] {
    const normalizedState =
        normalizeFilterState(state);

    let candidateKeys: string[];

    if (normalizedState.tag.length === 0) {
        candidateKeys = Object.keys(index.items);
    } else {
        /**
         * Selected tags form one OR group, therefore byTag lists
         * are joined as a union.
         */
        candidateKeys = [
            ...new Set(
                normalizedState.tag.flatMap(
                    (tag) => index.byTag[tag] ?? [],
                ),
            ),
        ];
    }

    return candidateKeys.filter((key) => {
        const item = index.items[key];

        return (
            item !== undefined &&
            matchesGalleryFilterItem(
                item,
                normalizedState,
            )
        );
    });
}

/**
 * Returns the number of matching items.
 *
 * With the photo index this is the N value in the "N of M"
 * gallery summary.
 */
export function computeResultCount(
    index: GalleryFilterIndex,
    state: FilterState,
): number {
    return computeResult(index, state).length;
}

/**
 * Returns the total number of items in an index.
 *
 * With the photo index this is the M value in the "N of M"
 * gallery summary.
 */
export function getTotalResultCount(
    index: GalleryFilterIndex,
): number {
    return Object.keys(index.items).length;
}

function createKnownValues(
    index: GalleryFilterIndex,
): Record<FilterGroup, Set<string>> {
    return {
        period: new Set(
            index.periods.map(
                (option) => option.value,
            ),
        ),

        scale: new Set(
            index.scales.map(
                (option) => option.value,
            ),
        ),

        tag: new Set(
            Object.keys(index.byTag),
        ),
    };
}

/**
 * Restores filter state from URL search parameters.
 *
 * Unknown values are ignored without an error.
 * A known combination that produces zero results remains selected:
 * values are never blocked or removed based on result count.
 *
 * Obsolete parameters, including count, are ignored because only
 * period, scale and tag are read.
 */
export function parseUrl(
    index: GalleryFilterIndex,
    search: string,
): FilterState {
    const searchParams =
        new URLSearchParams(search);

    const knownValues =
        createKnownValues(index);

    const state =
        createEmptyFilterState();

    for (const group of FILTER_GROUPS) {
        const values = uniqueValues(
            searchParams.getAll(group),
        );

        state[group] = values.filter(
            (value) =>
                knownValues[group].has(value),
        );
    }

    return state;
}

/**
 * Serializes filter state into repeated URL parameters:
 *
 * ?period=...&period=...&scale=...&tag=...
 */
export function toQuery(
    state: FilterState,
): string {
    const normalizedState =
        normalizeFilterState(state);

    const searchParams =
        new URLSearchParams();

    for (const group of FILTER_GROUPS) {
        for (const value of normalizedState[group]) {
            searchParams.append(group, value);
        }
    }

    const query = searchParams.toString();

    return query ? `?${query}` : '';
}

/**
 * Updates only gallery filter parameters in an existing URL.
 *
 * Other URL parameters are preserved, except for the obsolete count
 * parameter, which is removed.
 */
export function updateFilterQuery(
    search: string,
    state: FilterState,
): string {
    const searchParams =
        new URLSearchParams(search);

    for (const group of FILTER_GROUPS) {
        searchParams.delete(group);
    }

    searchParams.delete('count');

    const normalizedState =
        normalizeFilterState(state);

    for (const group of FILTER_GROUPS) {
        for (const value of normalizedState[group]) {
            searchParams.append(group, value);
        }
    }

    const query = searchParams.toString();

    return query ? `?${query}` : '';
}

/**
 * Adds the current filters to an internal Gallery URL.
 */
export function appendFilterQuery(
    pathname: string,
    state: FilterState,
): string {
    return `${pathname}${toQuery(state)}`;
}

/**
 * Returns a new state with one value toggled.
 *
 * All values remain selectable, including combinations producing
 * zero results.
 */
export function toggleFilterValue(
    state: FilterState,
    group: FilterGroup,
    value: string,
): FilterState {
    const normalizedValue = value.trim();

    if (!normalizedValue) {
        return normalizeFilterState(state);
    }

    const currentValues = uniqueValues(
        state[group],
    );

    const nextValues = currentValues.includes(
        normalizedValue,
    )
        ? currentValues.filter(
            (item) => item !== normalizedValue,
        )
        : [...currentValues, normalizedValue];

    return normalizeFilterState({
        ...state,
        [group]: nextValues,
    });
}

/**
 * Runtime check used after parsing the embedded application/json
 * index. A malformed or absent index can be handled by the page
 * without breaking the gallery.
 */
export function isGalleryFilterIndex(
    value: unknown,
): value is GalleryFilterIndex {
    if (
        typeof value !== 'object' ||
        value === null
    ) {
        return false;
    }

    const candidate = value as Partial<
        GalleryFilterIndex
    >;

    return (
        Array.isArray(candidate.groups) &&
        Array.isArray(candidate.periods) &&
        Array.isArray(candidate.scales) &&
        typeof candidate.byTag === 'object' &&
        candidate.byTag !== null &&
        !Array.isArray(candidate.byTag) &&
        typeof candidate.items === 'object' &&
        candidate.items !== null &&
        !Array.isArray(candidate.items)
    );
}
