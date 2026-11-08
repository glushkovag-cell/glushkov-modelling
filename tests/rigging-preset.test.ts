import test from 'node:test';
import assert from 'node:assert/strict';

import { calculate } from '../src/lib/rigging/calculate.ts';
import { toProjectJson } from '../src/lib/rigging/export.ts';
import {
    PresetError,
    parsePresetJson,
    profileVersions,
} from '../src/lib/rigging/preset.ts';
import { buildInput, defaultSettingsForProfile } from '../src/lib/rigging/settings.ts';
import { EARLY, SCHOONER } from './helpers/profiles.ts';

const VERSIONS = profileVersions([EARLY(), SCHOONER()]);

test('an exported project JSON round-trips through the preset parser', () => {
    const document = EARLY();
    const settings = defaultSettingsForProfile(document);
    const calculation = calculate(buildInput(settings), document);
    const exported = toProjectJson(calculation, settings, '2026-11-08T00:00:00.000Z');

    const restored = parsePresetJson(exported, VERSIONS);
    assert.equal(restored.profileId, 'early_plant');
    assert.equal(restored.profileVersion, '1.2.1');
    assert.equal(restored.scaleDenominator, settings.scaleDenominator);
    assert.equal(restored.masts.main.diameter.value, settings.masts.main.diameter.value);
    assert.equal(restored.bowsprit.diameter.value, settings.bowsprit.diameter.value);
    assert.equal(restored.lateenYard.present, settings.lateenYard.present);
});

test('a bare settings object is accepted as well as the export wrapper', () => {
    const settings = defaultSettingsForProfile(SCHOONER());
    const restored = parsePresetJson(JSON.stringify(settings), VERSIONS);
    assert.equal(restored.profileId, 'yacht_metal_schooner');
});

test('a preset with an unknown profile is rejected', () => {
    const settings = { ...defaultSettingsForProfile(EARLY()), profileId: 'nope' };
    assert.throws(
        () => parsePresetJson(JSON.stringify(settings), VERSIONS),
        (error: unknown) =>
            error instanceof PresetError && error.message.includes('is not available'),
    );
});

test('a preset pinned to another profile version is rejected, not silently upgraded', () => {
    const settings = { ...defaultSettingsForProfile(EARLY()), profileVersion: '1.0.0' };
    assert.throws(
        () => parsePresetJson(JSON.stringify(settings), VERSIONS),
        (error: unknown) =>
            error instanceof PresetError && error.message.includes('not available'),
    );
});

test('invalid JSON and missing dimensions are rejected', () => {
    assert.throws(() => parsePresetJson('{broken', VERSIONS), PresetError);
    assert.throws(
        () =>
            parsePresetJson(
                JSON.stringify({ profileId: 'early_plant', profileVersion: '1.2.1' }),
                VERSIONS,
            ),
        (error: unknown) =>
            error instanceof PresetError && error.message.includes('scaleDenominator'),
    );
});
