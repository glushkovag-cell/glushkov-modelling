import test from 'node:test';
import assert from 'node:assert/strict';

import {
    sailSelectable,
    tierAvailability,
    yardSelectable,
} from '../src/lib/rigging/formRules.ts';
import {
    defaultSettingsForProfile,
    sailNodeKindsForUi,
} from '../src/lib/rigging/settings.ts';
import { buildNodes } from '../src/lib/rigging/settings.ts';
import { EARLY, SCHOONER, TRADITIONAL, YACHT } from './helpers/profiles.ts';

test('a removed mast disables every yard and every sail on that mast', () => {
    const mast = { present: false, topmast: true, topgallant: true };

    for (const tier of ['lower', 'topmast', 'topgallant'] as const) {
        assert.equal(yardSelectable(mast, tier), false, `yard ${tier}`);
        assert.equal(sailSelectable(mast, tier, true), false, `sail ${tier}`);
    }
});

test('a sail is disabled when its yard is not selected', () => {
    const mast = { present: true, topmast: true, topgallant: true };

    assert.equal(sailSelectable(mast, 'lower', false), false);
    assert.equal(sailSelectable(mast, 'lower', true), true);
    // The other tier is independent.
    assert.equal(sailSelectable(mast, 'topmast', true), true);
});

test('topgallant availability follows the topmast chain', () => {
    assert.deepEqual(tierAvailability({ present: true, topmast: false, topgallant: true }), {
        lower: true,
        topmast: false,
        topgallant: false,
    });
    assert.deepEqual(tierAvailability({ present: true, topmast: true, topgallant: false }), {
        lower: true,
        topmast: true,
        topgallant: false,
    });
});

test('traditional_plant keeps one gaff on the mizzen and no per-mast gaff duplicates', () => {
    const settings = defaultSettingsForProfile(TRADITIONAL());
    assert.equal(settings.gaff.present, true);
    assert.equal(settings.gaff.supportingMastId, 'mizzen');
    assert.deepEqual(settings.sailNodes.gaff, { fore: false, main: false, mizzen: false });

    const gaffNodes = buildNodes(settings).filter((node) => node.nodeType === 'gaff');
    assert.equal(gaffNodes.length, 1);
    assert.equal(gaffNodes[0]?.nodeId, 'gaff.mizzen');
});

test('yacht_metal_schooner builds gaff nodes per mast instead of one legacy gaff', () => {
    const settings = defaultSettingsForProfile(SCHOONER());
    assert.equal(settings.gaff.present, false);
    assert.deepEqual(settings.sailNodes.gaff, { fore: true, main: true, mizzen: true });

    const nodes = buildNodes(settings);
    assert.equal(nodes.filter((node) => node.nodeType === 'gaff').length, 3);
    assert.equal(nodes.filter((node) => node.nodeType === 'gaff_sail').length, 3);
    assert.equal(nodes.filter((node) => node.nodeType === 'boom').length, 3);
});

test('early_plant defaults match the Santa Maria measurement set', () => {
    const settings = defaultSettingsForProfile(EARLY());
    assert.equal(settings.scaleDenominator, 65);
    assert.equal(settings.masts.fore.diameter.value, 6);
    assert.equal(settings.masts.main.diameter.value, 8);
    assert.equal(settings.masts.mizzen.diameter.value, 6);
    assert.equal(settings.bowsprit.diameter.value, 4);
    assert.equal(settings.lateenYard.present, true);
    assert.equal(settings.hullGroup, true);
    assert.equal(settings.gun.present, false);
    assert.equal(settings.anchor.present, true);
    assert.equal(settings.masts.main.topgallant, false);

    const nodes = buildNodes(settings);
    assert.equal(nodes.filter((node) => node.nodeType === 'lateen_yard').length, 1);
    assert.equal(nodes.filter((node) => node.nodeType === 'hull_group').length, 1);
    assert.equal(nodes.filter((node) => node.nodeType === 'gun_group').length, 0);
    assert.equal(nodes.filter((node) => node.nodeType === 'spritsail_yard').length, 1);
});

test('yacht profile exposes only main sails and no bow/anchor/gun nodes', () => {
    const settings = defaultSettingsForProfile(YACHT());
    assert.equal(settings.bowsprit.present, false);
    assert.equal(settings.anchor.present, false);
    assert.equal(settings.gun.present, false);
    assert.deepEqual(settings.sailNodes.main_sail, { fore: true, main: true, mizzen: true });

    const nodes = buildNodes(settings);
    assert.equal(nodes.filter((node) => node.nodeType === 'main_sail').length, 3);
    assert.equal(nodes.filter((node) => node.nodeType === 'bowsprit').length, 0);
});

test('sail node kinds follow the profile UI', () => {
    assert.deepEqual(sailNodeKindsForUi(YACHT().profile.ui), ['main_sail']);
    assert.deepEqual(sailNodeKindsForUi(SCHOONER().profile.ui), [
        'gaff',
        'gaff_sail',
        'boom',
        'topsail',
        'head_lower',
        'head_upper',
        'staysail',
        'flag',
    ]);
    assert.deepEqual(sailNodeKindsForUi(TRADITIONAL().profile.ui), []);
    assert.deepEqual(sailNodeKindsForUi(EARLY().profile.ui), []);
});
