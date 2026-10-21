import test from 'node:test';
import assert from 'node:assert/strict';

import {
    applyBuildFilters,
    collectBuildFilterOptions,
    deriveHistoricalPeriod,
    getBuildStatusValues,
    type FilterableBuildModel,
} from '../src/lib/modelFilters.ts';

const models: FilterableBuildModel[] = [
    {
        slug: 'bounty',
        title: 'Bounty',
        modelinfo: {
            manufacturer: 'Art. Latina',
            modelscale: '1:48',
            historicalyear: '1787',
            buildstatus: ['Completed'],
        },
    },
    {
        slug: 'le-requin',
        title: 'Le Requin',
        modelinfo: {
            manufacturer: 'Corel',
            modelscale: '1:60',
            historicalyear: '1750',
            buildstatus: ['In progress'],
        },
    },
    {
        slug: 'bleriot',
        title: 'Blériot XI',
        modelinfo: {
            manufacturer: 'Corel',
            modelscale: '1:10',
            historicalyear: '1909',
            buildstatus: ['Completed', 'In progress'],
        },
    },
];

test('deriveHistoricalPeriod maps years to periods', () => {
    assert.equal(deriveHistoricalPeriod('1492'), 'age-of-discovery');
    assert.equal(deriveHistoricalPeriod('1599'), 'age-of-discovery');
    assert.equal(deriveHistoricalPeriod('1600'), '17th-century');
    assert.equal(deriveHistoricalPeriod('1699'), '17th-century');
    assert.equal(deriveHistoricalPeriod('1750'), 'age-of-sail-18th');
    assert.equal(deriveHistoricalPeriod('1799'), 'age-of-sail-18th');
    assert.equal(deriveHistoricalPeriod('1800'), 'age-of-sail-19th');
    assert.equal(deriveHistoricalPeriod('1899'), 'age-of-sail-19th');
    assert.equal(deriveHistoricalPeriod('1909'), 'early-modern-20th');
    assert.equal(deriveHistoricalPeriod('1999'), 'early-modern-20th');
});

test('deriveHistoricalPeriod tolerates decorated and unknown input', () => {
    assert.equal(deriveHistoricalPeriod('  ~1750 '), 'age-of-sail-18th');
    assert.equal(deriveHistoricalPeriod(''), 'other-unknown');
    assert.equal(deriveHistoricalPeriod(null), 'other-unknown');
    assert.equal(deriveHistoricalPeriod('unknown'), 'other-unknown');
    assert.equal(deriveHistoricalPeriod('1200'), 'other-unknown');
    assert.equal(deriveHistoricalPeriod('2001'), 'other-unknown');
});

test('getBuildStatusValues normalizes arrays, strings and the fallback', () => {
    assert.deepEqual(getBuildStatusValues(models[2]!), ['completed', 'in-progress']);
    assert.deepEqual(getBuildStatusValues(models[0]!), ['completed']);
    assert.deepEqual(
        getBuildStatusValues({ slug: 'x', title: 'X', buildstatusClass: 'In Progress', buildstatusText: 'In progress' }),
        ['in-progress'],
    );
    assert.deepEqual(getBuildStatusValues({ slug: 'y', title: 'Y' }), []);
});

test('collectBuildFilterOptions covers every model and de-duplicates values', () => {
    const options = collectBuildFilterOptions(models);

    assert.deepEqual(
        options.statuses.map((option) => option.value),
        ['completed', 'in-progress'],
    );
    assert.deepEqual(
        options.periods.map((option) => option.value),
        ['age-of-sail-18th', 'early-modern-20th'],
    );
    assert.deepEqual(
        options.scales.map((option) => option.value),
        ['1:10', '1:48', '1:60'],
    );
    assert.deepEqual(
        options.manufacturers.map((option) => option.value),
        ['art. latina', 'corel'],
    );
});

test('applyBuildFilters combines groups with AND and values with OR', () => {
    const filtered = applyBuildFilters(models, {
        status: ['completed'],
        period: [],
        scale: [],
        manufacturer: [],
    });

    assert.deepEqual(filtered.map((model) => model.slug), ['bounty', 'bleriot']);

    const narrowed = applyBuildFilters(models, {
        status: ['completed', 'in-progress'],
        period: ['age-of-sail-18th'],
        scale: ['1:60'],
        manufacturer: ['corel'],
    });

    assert.deepEqual(narrowed.map((model) => model.slug), ['le-requin']);
});

test('applyBuildFilters returns everything for an empty state', () => {
    const filtered = applyBuildFilters(models, {
        status: [],
        period: [],
        scale: [],
        manufacturer: [],
    });

    assert.equal(filtered.length, models.length);
});
