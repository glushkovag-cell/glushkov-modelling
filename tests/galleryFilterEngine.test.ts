import test from 'node:test';
import assert from 'node:assert/strict';

import {
    computeResult,
    computeResultCount,
    createEmptyFilterState,
    getTotalResultCount,
    isGalleryFilterIndex,
    matchesGalleryFilterItem,
    normalizeFilterState,
    parseUrl,
    toQuery,
    toggleFilterValue,
    updateFilterQuery,
} from '../src/scripts/galleryFilterEngine.ts';
import type { GalleryFilterIndex } from '../src/lib/gallery.ts';

const index: GalleryFilterIndex = {
    groups: [
        { facet: 'component', tags: [{ slug: 'hull', name: 'Hull' }] },
        { facet: 'view', tags: [{ slug: 'close-up', name: 'Close-up' }] },
    ],
    periods: [{ value: 'age-of-sail-18th', label: 'Age of Sail · 18th c.' }],
    scales: [{ value: '1:48', label: '1:48' }],
    byTag: {
        hull: ['a/1.webp'],
        'close-up': ['b/2.webp'],
    },
    items: {
        'a/1.webp': { model: 'a', period: 'age-of-sail-18th', scale: '1:48', tags: ['hull'] },
        'b/2.webp': { model: 'b', period: 'age-of-sail-19th', scale: '1:60', tags: ['close-up'] },
    },
};

test('an empty state matches every item', () => {
    const state = createEmptyFilterState();

    assert.equal(matchesGalleryFilterItem(index.items['a/1.webp']!, state), true);
    assert.equal(matchesGalleryFilterItem(index.items['b/2.webp']!, state), true);
    assert.equal(computeResultCount(index, state), 2);
    assert.equal(getTotalResultCount(index), 2);
});

test('selected tags combine with OR regardless of facet', () => {
    const state = { ...createEmptyFilterState(), tag: ['hull', 'close-up'] };

    assert.deepEqual(computeResult(index, state).sort(), ['a/1.webp', 'b/2.webp']);
});

test('groups combine with AND', () => {
    const state = { period: ['age-of-sail-18th'], scale: ['1:48'], tag: ['close-up'] };

    assert.deepEqual(computeResult(index, state), []);
});

test('period and scale narrow the result independently', () => {
    assert.deepEqual(
        computeResult(index, { period: ['age-of-sail-18th'], scale: [], tag: [] }),
        ['a/1.webp'],
    );
    assert.deepEqual(
        computeResult(index, { period: [], scale: ['1:60'], tag: [] }),
        ['b/2.webp'],
    );
});

test('parseUrl keeps known values and drops unknown ones', () => {
    const state = parseUrl(index, '?period=age-of-sail-18th&tag=hull&tag=deleted-term&scale=9:99');

    assert.deepEqual(state, {
        period: ['age-of-sail-18th'],
        scale: [],
        tag: ['hull'],
    });
});

test('toQuery serializes repeated parameters and stays empty without filters', () => {
    assert.equal(toQuery(createEmptyFilterState()), '');
    assert.equal(
        toQuery({ period: ['age-of-sail-18th'], scale: [], tag: ['hull', 'close-up'] }),
        '?period=age-of-sail-18th&tag=hull&tag=close-up',
    );
});

test('updateFilterQuery preserves unrelated parameters and drops the obsolete count', () => {
    const next = updateFilterQuery(
        '?returnTo=%2Fgallery&period=stale&count=7',
        { period: ['age-of-sail-18th'], scale: [], tag: [] },
    );

    assert.equal(next, '?returnTo=%2Fgallery&period=age-of-sail-18th');
});

test('toggleFilterValue adds, removes and normalizes values', () => {
    const added = toggleFilterValue(createEmptyFilterState(), 'tag', ' hull ');
    assert.deepEqual(added.tag, ['hull']);

    const removed = toggleFilterValue(added, 'tag', 'hull');
    assert.deepEqual(removed.tag, []);

    const ignored = toggleFilterValue(createEmptyFilterState(), 'tag', '   ');
    assert.deepEqual(ignored.tag, []);
});

test('normalizeFilterState trims, de-duplicates and drops empty values', () => {
    const state = normalizeFilterState({
        period: [' 18th ', '18th', ''],
        scale: [],
        tag: ['hull', ' hull '],
    });

    assert.deepEqual(state, { period: ['18th'], scale: [], tag: ['hull'] });
});

test('isGalleryFilterIndex accepts a well-formed index and rejects the rest', () => {
    assert.equal(isGalleryFilterIndex(index), true);
    assert.equal(isGalleryFilterIndex(null), false);
    assert.equal(isGalleryFilterIndex([]), false);
    assert.equal(isGalleryFilterIndex({ groups: [], periods: [], scales: [], byTag: {}, items: [] }), false);
    assert.equal(isGalleryFilterIndex({ groups: 'nope' }), false);
});
