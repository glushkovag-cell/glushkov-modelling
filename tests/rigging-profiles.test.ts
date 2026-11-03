import test from 'node:test';
import assert from 'node:assert/strict';

import { PROFILE_REGISTRY, findSuitableProfiles } from '../src/lib/rigging/profiles.ts';
import type { HistoricalContext } from '../src/lib/rigging/types.ts';

test('traditional_plant is published with the Lees range 1625–1860', () => {
    const profile = PROFILE_REGISTRY.find((entry) => entry.profileId === 'traditional_plant');
    assert.ok(profile);
    assert.equal(profile.status, 'published');
    assert.equal(profile.yearFrom, 1625);
    assert.equal(profile.yearTo, 1860);
    assert.ok(profile.sources.length > 0);
    assert.ok(profile.sources[0].includes('Lees'));
});

test('a year inside the range matches the published profile', () => {
    const context: HistoricalContext = {
        mode: 'year',
        year: 1787,
        periodFrom: null,
        periodTo: null,
    };
    const matches = findSuitableProfiles(context);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].match, 'in_range');
});

test('a year outside the range does not match', () => {
    const context: HistoricalContext = {
        mode: 'year',
        year: 1492,
        periodFrom: null,
        periodTo: null,
    };
    const matches = findSuitableProfiles(context);
    assert.equal(matches.filter((match) => match.match === 'in_range').length, 0);
});

test('a period overlapping the range yields partial coverage', () => {
    const context: HistoricalContext = {
        mode: 'period',
        year: null,
        periodFrom: 1800,
        periodTo: 1900,
    };
    const matches = findSuitableProfiles(context);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].match, 'partial_overlap');
});

test('a period fully inside the range is covered', () => {
    const context: HistoricalContext = {
        mode: 'period',
        year: null,
        periodFrom: 1700,
        periodTo: 1800,
    };
    const matches = findSuitableProfiles(context);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].match, 'in_range');
});
