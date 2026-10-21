import test from 'node:test';
import assert from 'node:assert/strict';

import {
    countLabel,
    createLabelMap,
    describeState,
    getSafeReturnTo,
    hasActiveFilters,
} from '../src/scripts/galleryFilterUi.ts';
import type { GalleryFilterIndex } from '../src/lib/gallery.ts';
import { createEmptyFilterState, type FilterState } from '../src/scripts/galleryFilterEngine.ts';

function index(): GalleryFilterIndex {
    return {
        version: 2,
        periods: [
            { value: 'classic', label: 'Classic' },
            { value: 'modern', label: 'Modern' },
        ],
        scales: [{ value: '1-48', label: '1:48' }],
        groups: [
            {
                slug: 'bounty',
                title: 'HMS Bounty',
                tags: [
                    { slug: 'hull', name: 'Hull' },
                    { slug: 'rigging', name: 'Rigging' },
                ],
            },
        ],
        items: {},
    } as unknown as GalleryFilterIndex;
}

function state(overrides: Partial<FilterState>): FilterState {
    return { ...createEmptyFilterState(), ...overrides };
}

test('countLabel pluralizes correctly', () => {
    assert.equal(countLabel(0), '0 photos');
    assert.equal(countLabel(1), '1 photo');
    assert.equal(countLabel(2), '2 photos');
    assert.equal(countLabel(1, 'model', 'models'), '1 model');
});

test('createLabelMap maps every group prefix', () => {
    const labels = createLabelMap(index());

    assert.equal(labels.get('period:classic'), 'Classic');
    assert.equal(labels.get('scale:1-48'), '1:48');
    assert.equal(labels.get('tag:hull'), 'Hull');
    assert.equal(labels.size, 5);
});

test('describeState is empty without filters', () => {
    assert.equal(describeState(state({}), createLabelMap(index())), '');
});

test('describeState renders labels in group order', () => {
    const labels = createLabelMap(index());
    const description = describeState(
        state({ period: ['classic'], tag: ['hull', 'rigging'] }),
        labels,
    );

    assert.equal(description, 'Period: Classic · Tags: Hull, Rigging');
});

test('describeState falls back to the raw value for unknown labels', () => {
    const description = describeState(state({ scale: ['unknown'] }), new Map());

    assert.equal(description, 'Scale: unknown');
});

test('hasActiveFilters detects every group', () => {
    assert.equal(hasActiveFilters(state({})), false);
    assert.equal(hasActiveFilters(state({ period: ['classic'] })), true);
    assert.equal(hasActiveFilters(state({ scale: ['1-48'] })), true);
    assert.equal(hasActiveFilters(state({ tag: ['hull'] })), true);
});

test('getSafeReturnTo accepts same-site gallery paths only', () => {
    assert.equal(getSafeReturnTo('?returnTo=/gallery/bounty'), '/gallery/bounty');
    assert.equal(getSafeReturnTo('?returnTo=/gallery'), '/gallery');
    assert.equal(getSafeReturnTo('?returnTo=//evil.test/gallery'), null);
    assert.equal(getSafeReturnTo('?returnTo=https://evil.test/gallery'), null);
    assert.equal(getSafeReturnTo('?returnTo=/builds/bounty'), null);
    assert.equal(getSafeReturnTo(''), null);
});
