/**
 * galleryFilterUi.ts
 *
 * Shared client-side helpers for the gallery filter UI.
 *
 * The hub, the all-photos page and every model page repeated the same label
 * map, the same summary sentence, the same index parsing and the same
 * returnTo validation. Keeping one copy also keeps the wording identical
 * across pages.
 */

import type { GalleryFilterIndex } from '../lib/gallery';
import type { FilterGroup, FilterState } from './galleryFilterEngine';

export const FILTER_GROUPS: FilterGroup[] = ['period', 'scale', 'tag'];

const GROUP_TITLES: Record<FilterGroup, string> = {
    period: 'Period',
    scale: 'Scale',
    tag: 'Tags',
};

/** "1 photo" / "3 photos" with an optional override for other nouns. */
export function countLabel(
    count: number,
    one = 'photo',
    many = 'photos',
): string {
    return `${count} ${count === 1 ? one : many}`;
}

/** Maps `period:x`, `scale:y` and `tag:z` keys to human readable labels. */
export function createLabelMap(index: GalleryFilterIndex): Map<string, string> {
    const labels = new Map<string, string>();

    for (const option of index.periods) labels.set(`period:${option.value}`, option.label);
    for (const option of index.scales) labels.set(`scale:${option.value}`, option.label);

    for (const group of index.groups) {
        for (const tag of group.tags) labels.set(`tag:${tag.slug}`, tag.name);
    }

    return labels;
}

/** "Period: Classic · Tags: Hull" — empty when nothing is selected. */
export function describeState(
    state: FilterState,
    labels: Map<string, string>,
): string {
    return FILTER_GROUPS
        .filter((group) => state[group].length > 0)
        .map((group) => {
            const values = state[group].map(
                (value) => labels.get(`${group}:${value}`) ?? value,
            );

            return `${GROUP_TITLES[group]}: ${values.join(', ')}`;
        })
        .join(' · ');
}

export function hasActiveFilters(state: FilterState): boolean {
    return FILTER_GROUPS.some((group) => state[group].length > 0);
}

/** returnTo from the hub link; same-site /gallery paths only. */
export function getSafeReturnTo(search: string): string | null {
    const returnTo = new URLSearchParams(search).get('returnTo');

    if (returnTo && returnTo.startsWith('/gallery') && !returnTo.startsWith('//')) {
        return returnTo;
    }

    return null;
}
