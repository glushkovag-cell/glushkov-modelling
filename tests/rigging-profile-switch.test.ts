import test from 'node:test';
import assert from 'node:assert/strict';

import {
    switchProfileSettings,
    type DimensionKey,
    type ProfileSwitchContext,
} from '../src/lib/rigging/profileSwitch.ts';
import {
    defaultSettingsForProfile,
    type RiggingSettings,
} from '../src/lib/rigging/settings.ts';
import { profileRequirements } from '../src/lib/rigging/profiles.ts';
import type { ProfileDocument } from '../src/lib/rigging/document.ts';
import { EARLY, SCHOONER, TRADITIONAL, YACHT } from './helpers/profiles.ts';

function context(document: ProfileDocument): ProfileSwitchContext {
    return {
        ui: document.profile.ui,
        requirements: profileRequirements(document),
    };
}

function switchFrom(
    previousDocument: ProfileDocument,
    nextDocument: ProfileDocument,
    current: RiggingSettings,
    extra: {
        draft?: Parameters<typeof switchProfileSettings>[0]['draft'];
        edited?: DimensionKey[];
    } = {},
) {
    return switchProfileSettings({
        current,
        previous: context(previousDocument),
        nextDefaults: defaultSettingsForProfile(nextDocument),
        next: context(nextDocument),
        draft: extra.draft ?? {},
        editedDimensions: new Set(extra.edited ?? []),
    });
}

test('traditional_plant → early_plant carries scale, masts, bowsprit and anchor choices', () => {
    const current = defaultSettingsForProfile(TRADITIONAL());
    current.scaleDenominator = 87;
    current.masts.main.diameter = {
        value: 12.5,
        unitId: 'in',
        basis: 'prototype',
        measurementPointId: 'step',
    };
    current.bowsprit.diameter = {
        value: 9.5,
        unitId: 'mm',
        basis: 'model',
        measurementPointId: 'working_section',
    };
    current.anchor.connection = 'chain';

    const result = switchFrom(TRADITIONAL(), EARLY(), current);

    assert.equal(result.settings.scaleDenominator, 87);
    assert.equal(result.settings.masts.main.diameter.value, 12.5);
    assert.equal(result.settings.masts.main.diameter.unitId, 'in');
    assert.equal(result.settings.masts.main.diameter.basis, 'prototype');
    assert.equal(result.settings.masts.main.diameter.measurementPointId, 'step');
    assert.equal(result.settings.bowsprit.diameter.value, 9.5);
    assert.equal(result.settings.anchor.connection, 'chain');
    assert.deepEqual(result.requiredDimensions, []);

    // early_plant не использует ширину корпуса и орудийный порт: переносить
    // туда нечего, и требовать ввод по ним нельзя.
    assert.equal(result.settings.hullWidth.value, defaultSettingsForProfile(EARLY()).hullWidth.value);
    assert.equal(result.settings.gun.bore.value, defaultSettingsForProfile(EARLY()).gun.bore.value);
});

test('a profile that adds bowsprit, hull width and gun bore marks them required', () => {
    const current = defaultSettingsForProfile(YACHT());
    current.scaleDenominator = 50;
    current.masts.main.diameter = {
        value: 11,
        unitId: 'mm',
        basis: 'model',
        measurementPointId: 'partner',
    };

    const result = switchFrom(YACHT(), TRADITIONAL(), current);

    assert.equal(result.settings.scaleDenominator, 50);
    assert.equal(result.settings.masts.main.diameter.value, 11);
    assert.equal(result.settings.bowsprit.diameter.value, null);
    assert.equal(result.settings.hullWidth.value, null);
    assert.equal(result.settings.gun.bore.value, null);
    assert.deepEqual(result.requiredDimensions, ['bowsprit', 'hullWidth', 'gunBore']);
});

test('early_plant → traditional_plant keeps the bowsprit but requires hull width and gun bore', () => {
    const current = defaultSettingsForProfile(EARLY());
    current.bowsprit.diameter = {
        value: 4.2,
        unitId: 'mm',
        basis: 'model',
        measurementPointId: 'working_section',
    };

    const result = switchFrom(EARLY(), TRADITIONAL(), current);

    assert.equal(result.settings.bowsprit.diameter.value, 4.2);
    assert.equal(result.settings.hullWidth.value, null);
    assert.equal(result.settings.gun.bore.value, null);
    assert.deepEqual(result.requiredDimensions, ['hullWidth', 'gunBore']);
});

test('a value edited in an earlier profile is carried back, not required again', () => {
    const current = defaultSettingsForProfile(YACHT());

    const result = switchFrom(YACHT(), TRADITIONAL(), current, {
        draft: {
            bowsprit: {
                value: 9.75,
                unitId: 'mm',
                basis: 'model',
                measurementPointId: 'working_section',
            },
        },
        edited: ['bowsprit'],
    });

    assert.equal(result.settings.bowsprit.diameter.value, 9.75);
    assert.deepEqual(result.requiredDimensions, ['hullWidth', 'gunBore']);
});

test('an empty value in the previous profile is required in the next profile', () => {
    const current = defaultSettingsForProfile(TRADITIONAL());
    current.bowsprit.diameter = { ...current.bowsprit.diameter, value: null };

    const result = switchFrom(TRADITIONAL(), EARLY(), current);

    assert.equal(result.settings.bowsprit.diameter.value, null);
    assert.deepEqual(result.requiredDimensions, ['bowsprit']);
});

test('an invalid scale falls back to the next profile default', () => {
    const current = defaultSettingsForProfile(TRADITIONAL());
    current.scaleDenominator = 0;

    const result = switchFrom(TRADITIONAL(), SCHOONER(), current);

    assert.equal(result.settings.scaleDenominator, defaultSettingsForProfile(SCHOONER()).scaleDenominator);
});

test('shared node choices survive, while unsupported blocks use next defaults', () => {
    const current = defaultSettingsForProfile(TRADITIONAL());
    current.masts.mizzen.present = false;
    current.masts.main.yards.topgallant = false;
    current.gaff.present = false;
    current.anchor.connection = 'chain';

    const result = switchFrom(TRADITIONAL(), EARLY(), current);

    assert.equal(result.settings.masts.mizzen.present, false);
    assert.equal(result.settings.masts.main.yards.topgallant, false);
    assert.equal(result.settings.anchor.connection, 'chain');
    // early_plant не поддерживает гафель — берём значение профиля.
    assert.equal(result.settings.gaff.present, false);
});

test('a round trip through a narrower profile keeps bowsprit spar choices', () => {
    const traditional = defaultSettingsForProfile(TRADITIONAL());
    const early = switchFrom(TRADITIONAL(), EARLY(), traditional).settings;
    const back = switchFrom(EARLY(), TRADITIONAL(), early).settings;

    assert.equal(back.bowsprit.present, traditional.bowsprit.present);
    assert.equal(back.bowsprit.jibboom, traditional.bowsprit.jibboom);
    assert.equal(back.bowsprit.flyingJibboom, traditional.bowsprit.flyingJibboom);
    assert.equal(back.bowsprit.martingale, traditional.bowsprit.martingale);
    assert.equal(back.bowsprit.spritsailYard, traditional.bowsprit.spritsailYard);
    // Ширина корпуса и орудийный порт в early_plant не использовались,
    // поэтому при возврате их нужно вводить заново.
    assert.equal(back.hullWidth.value, null);
    assert.equal(back.gun.bore.value, null);
});

test('schooner per-mast sail nodes survive a switch between profiles that share them', () => {
    const current = defaultSettingsForProfile(SCHOONER());
    current.sailNodes.gaff_sail.main = false;
    current.sailNodes.boom.main = false;

    const result = switchFrom(SCHOONER(), SCHOONER(), current);

    assert.equal(result.settings.sailNodes.gaff_sail.main, false);
    assert.equal(result.settings.sailNodes.boom.main, false);
    assert.equal(result.settings.sailNodes.gaff_sail.fore, true);
});
