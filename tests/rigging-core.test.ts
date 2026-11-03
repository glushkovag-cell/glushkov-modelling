import test from 'node:test';
import assert from 'node:assert/strict';

import { buildInput, defaultSettings, type RiggingSettings } from '../src/lib/rigging/settings.ts';
import { calculate } from '../src/lib/rigging/calculate.ts';
import { toCsv, toProjectJson } from '../src/lib/rigging/export.ts';
import type { RiggingInput, RiggingNode } from '../src/lib/rigging/types.ts';

const S = 64;

function approx(actual: number | null | undefined, expected: number, epsilon = 1e-9): void {
    assert.notEqual(actual, null);
    assert.notEqual(actual, undefined);
    assert.ok(
        Math.abs((actual as number) - expected) <= epsilon,
        `expected ${expected}, got ${actual}`,
    );
}

function settingsWithMast(mastId: 'fore' | 'main' | 'mizzen' = 'main'): RiggingSettings {
    const settings = defaultSettings();
    for (const id of ['fore', 'main', 'mizzen'] as const) {
        if (id !== mastId) settings.masts[id].present = false;
    }
    settings.masts[mastId].topmast = true;
    settings.masts[mastId].topgallant = true;
    settings.masts[mastId].yards = { lower: false, topmast: false, topgallant: false };
    settings.masts[mastId].sails = { lower: false, topmast: false, topgallant: false };
    settings.bowsprit.present = false;
    settings.anchor.present = false;
    settings.gun.present = false;
    settings.gaff.present = false;
    for (const sailClass of Object.keys(settings.foreAndAft) as Array<keyof typeof settings.foreAndAft>) {
        settings.foreAndAft[sailClass].present = false;
    }
    return settings;
}

function calculationFor(settings: RiggingSettings) {
    return calculate(buildInput(settings));
}

function byRule(calc: ReturnType<typeof calculate>, ruleId: string, nodeSuffix = '') {
    const found = calc.results.find(
        (result) => result.ruleId === ruleId && result.nodeId.endsWith(nodeSuffix),
    );
    assert.ok(found, `missing result ${ruleId} ${nodeSuffix}`);
    return found;
}

function findNode(input: RiggingInput, nodeId: string): RiggingNode {
    const node = input.nodes.find((entry) => entry.nodeId === nodeId);
    assert.ok(node, `missing node ${nodeId}`);
    return node;
}

test('standing rigging matches the v1.0.0 control example D_model = 10', () => {
    const calc = calculationFor(settingsWithMast('main'));

    assert.deepEqual(calc.validationErrors, []);
    assert.equal(calc.profileId, 'traditional_plant');
    assert.equal(calc.profileVersion, '1.0.0');

    approx(byRule(calc, 'st.lower.stay', 'main.lower').diameterModelMm, 1.2);
    approx(byRule(calc, 'st.lower.shroud', 'main.lower').diameterModelMm, 0.66);
    approx(byRule(calc, 'st.lower.ratline', 'main.lower').diameterModelMm, 0.2244);
    approx(byRule(calc, 'st.topmast.stay', 'main.topmast').diameterModelMm, 0.72);
    approx(byRule(calc, 'st.topmast.shroud', 'main.topmast').diameterModelMm, 0.396);
    approx(byRule(calc, 'st.topmast.backstay', 'main.topmast').diameterModelMm, 0.48);
    approx(byRule(calc, 'st.topgallant.stay', 'main.topgallant').diameterModelMm, 0.42);
    approx(byRule(calc, 'st.topgallant.shroud', 'main.topgallant').diameterModelMm, 0.24);
    approx(byRule(calc, 'st.topgallant.backstay', 'main.topgallant').diameterModelMm, 0.3);
    approx(byRule(calc, 'st.lower.preventer', 'main.lower').diameterModelMm, 0.84);
    approx(byRule(calc, 'st.lower.shroud_lanyard', 'main.lower').diameterModelMm, 0.33);
    approx(byRule(calc, 'st.futtock.lower', 'main.topmast').diameterModelMm, 0.462);
    approx(byRule(calc, 'st.topmast.ratline', 'main.topmast').diameterModelMm, 0.13464);
    approx(byRule(calc, 'st.futtock.upper', 'main.topgallant').diameterModelMm, 0.2772);
});

test('prototype input D_real = 550 and S = 64 matches the control example', () => {
    const settings = settingsWithMast('main');
    settings.masts.main.diameter = {
        value: 550,
        unitId: 'mm',
        basis: 'prototype',
        measurementPointId: 'partner',
    };
    const calc = calculationFor(settings);

    approx(byRule(calc, 'st.lower.stay').diameterModelMm, 1.03125);
    approx(byRule(calc, 'st.lower.shroud').diameterModelMm, 0.5671875);
    approx(byRule(calc, 'st.lower.ratline').diameterModelMm, 0.19284375);
});

test('model and prototype inputs are equivalent at the same scale', () => {
    const model = settingsWithMast('main');
    const prototype = settingsWithMast('main');
    prototype.masts.main.diameter = {
        value: 10 * S,
        unitId: 'mm',
        basis: 'prototype',
        measurementPointId: 'partner',
    };

    const modelCalc = calculationFor(model);
    const prototypeCalc = calculationFor(prototype);

    for (const modelResult of modelCalc.results) {
        const prototypeResult = prototypeCalc.results.find(
            (entry) => entry.nodeId === modelResult.nodeId && entry.ruleId === modelResult.ruleId,
        );
        assert.ok(prototypeResult);
        approx(modelResult.diameterModelMm, prototypeResult.diameterModelMm as number, 1e-10);
    }
});

test('scale is applied exactly once for a prototype dimension', () => {
    const make = (scale: number) => {
        const settings = settingsWithMast('main');
        settings.scaleDenominator = scale;
        settings.masts.main.diameter = {
            value: 640,
            unitId: 'mm',
            basis: 'prototype',
            measurementPointId: 'partner',
        };
        return calculationFor(settings);
    };

    const at64 = make(64);
    const at128 = make(128);

    approx(
        byRule(at128, 'st.lower.stay').diameterModelMm,
        (byRule(at64, 'st.lower.stay').diameterModelMm as number) / 2,
    );
});

test('bowsprit and spar rules match the control example D_b_model = 8', () => {
    const settings = defaultSettings();
    for (const id of ['fore', 'main', 'mizzen'] as const) settings.masts[id].present = false;
    settings.gaff.present = false;
    for (const sailClass of Object.keys(settings.foreAndAft) as Array<keyof typeof settings.foreAndAft>) {
        settings.foreAndAft[sailClass].present = false;
    }
    settings.anchor.present = false;
    settings.gun.present = false;
    settings.bowsprit.diameter = {
        value: 8,
        unitId: 'mm',
        basis: 'model',
        measurementPointId: 'working_section',
    };

    const calc = calculationFor(settings);

    approx(byRule(calc, 'bow.bobstay').diameterModelMm, 0.528);
    approx(byRule(calc, 'bow.shroud').diameterModelMm, 0.432);
    approx(byRule(calc, 'bow.jibboom_lower').diameterModelMm, 0.288);
    approx(byRule(calc, 'bow.bobstay.lanyard').diameterModelMm, 0.1848);
    approx(byRule(calc, 'bow.gammoning').diameterModelMm, 0.528);
});

test('anchor rules match the control example W_model = 150', () => {
    const settings = defaultSettings();
    for (const id of ['fore', 'main', 'mizzen'] as const) settings.masts[id].present = false;
    settings.bowsprit.present = false;
    settings.gaff.present = false;
    for (const sailClass of Object.keys(settings.foreAndAft) as Array<keyof typeof settings.foreAndAft>) {
        settings.foreAndAft[sailClass].present = false;
    }
    settings.gun.present = false;
    settings.hullWidth = {
        value: 150,
        unitId: 'mm',
        basis: 'model',
        measurementPointId: 'unknown',
    };

    const calc = calculationFor(settings);

    approx(byRule(calc, 'anchor.messenger').diameterModelMm, 1.2075);
    approx(byRule(calc, 'anchor.bitter_rope').diameterModelMm, 0.63825);
    approx(byRule(calc, 'anchor.bower_cable').diameterModelMm, 1.725);
});

test('gun rules match the control example K_model = 2', () => {
    const settings = defaultSettings();
    for (const id of ['fore', 'main', 'mizzen'] as const) settings.masts[id].present = false;
    settings.bowsprit.present = false;
    settings.gaff.present = false;
    for (const sailClass of Object.keys(settings.foreAndAft) as Array<keyof typeof settings.foreAndAft>) {
        settings.foreAndAft[sailClass].present = false;
    }
    settings.anchor.present = false;
    settings.gun.bore = {
        value: 2,
        unitId: 'mm',
        basis: 'model',
        measurementPointId: 'working_section',
    };

    const calc = calculationFor(settings);

    approx(byRule(calc, 'gun.breeching').diameterModelMm, 0.6);
    approx(byRule(calc, 'gun.side_fall').diameterModelMm, 0.2);
    approx(byRule(calc, 'gun.stow_lashing').diameterModelMm, 0.24);
});

test('a yard with SailPresent=false keeps yard roles and hides sail roles', () => {
    const settings = settingsWithMast('main');
    settings.masts.main.topmast = false;
    settings.masts.main.topgallant = false;
    settings.masts.main.yards.lower = true;
    settings.masts.main.sails.lower = false;

    const calc = calculationFor(settings);

    assert.equal(byRule(calc, 'rn.square.lower.lift').status, 'calculated');
    assert.equal(byRule(calc, 'rn.square.lower.tie').status, 'calculated');

    const sheet = byRule(calc, 'rn.square.lower.sheet');
    assert.equal(sheet.status, 'not_applicable');
    assert.equal(sheet.reasonCode, 'sail_not_configured');
});

test('a yard with SailPresent=true calculates sail roles', () => {
    const settings = settingsWithMast('main');
    settings.masts.main.topmast = false;
    settings.masts.main.topgallant = false;
    settings.masts.main.yards.lower = true;
    settings.masts.main.sails.lower = true;

    const calc = calculationFor(settings);
    approx(byRule(calc, 'rn.square.lower.sheet').diameterModelMm, 0.54);
});

test('an unknown sail configuration produces needs_input, not zero', () => {
    const settings = settingsWithMast('main');
    settings.masts.main.topmast = false;
    settings.masts.main.topgallant = false;
    settings.masts.main.yards.lower = true;
    settings.masts.main.sails.lower = false;

    const input = buildInput(settings);
    const yard = findNode(input, 'yard.main.lower');
    yard.sailPresent = null;

    const calc = calculate(input);
    const sheet = byRule(calc, 'rn.square.lower.sheet');

    assert.equal(sheet.status, 'needs_input');
    assert.equal(sheet.reasonCode, 'configuration_required');
    assert.equal(sheet.diameterModelMm, null);
});

test('fore-and-aft sail uses the supporting mast base', () => {
    const settings = settingsWithMast('fore');
    settings.foreAndAft.head_lower.present = true;
    settings.foreAndAft.head_lower.supportingMastId = 'fore';

    const calc = calculationFor(settings);
    approx(byRule(calc, 'rn.foreandaft.head_lower.sheet').diameterModelMm, 0.324);
});

test('gaff boom lift is a spar role, other gaff roles need the sail', () => {
    const settings = settingsWithMast('mizzen');
    settings.masts.mizzen.diameter = {
        value: 10,
        unitId: 'mm',
        basis: 'model',
        measurementPointId: 'partner',
    };
    settings.gaff.present = true;
    settings.gaff.sailPresent = false;
    settings.gaff.supportingMastId = 'mizzen';

    const calc = calculationFor(settings);

    assert.equal(byRule(calc, 'rn.gaff.boom_lift').status, 'calculated');
    assert.equal(byRule(calc, 'rn.gaff.throat_halyard').status, 'not_applicable');
});

test('unsupported gun installation wins over a missing bore', () => {
    const settings = defaultSettings();
    for (const id of ['fore', 'main', 'mizzen'] as const) settings.masts[id].present = false;
    settings.bowsprit.present = false;
    settings.gaff.present = false;
    for (const sailClass of Object.keys(settings.foreAndAft) as Array<keyof typeof settings.foreAndAft>) {
        settings.foreAndAft[sailClass].present = false;
    }
    settings.anchor.present = false;
    settings.gun.gunType = 'carronade';
    settings.gun.mountingType = 'wheeled';
    settings.gun.bore = {
        value: null,
        unitId: 'mm',
        basis: 'model',
        measurementPointId: 'working_section',
    };

    const calc = calculationFor(settings);
    const breeching = byRule(calc, 'gun.breeching');

    assert.equal(breeching.status, 'unsupported');
    assert.equal(breeching.reasonCode, 'installation_not_supported');
});

test('chain anchor cable is unsupported while auxiliary fibre roles are calculated', () => {
    const settings = defaultSettings();
    for (const id of ['fore', 'main', 'mizzen'] as const) settings.masts[id].present = false;
    settings.bowsprit.present = false;
    settings.gaff.present = false;
    for (const sailClass of Object.keys(settings.foreAndAft) as Array<keyof typeof settings.foreAndAft>) {
        settings.foreAndAft[sailClass].present = false;
    }
    settings.gun.present = false;
    settings.anchor.connection = 'chain';

    const calc = calculationFor(settings);

    assert.equal(byRule(calc, 'anchor.bower_cable').status, 'unsupported');
    assert.equal(byRule(calc, 'anchor.bower_cable').reasonCode, 'material_not_supported');
    assert.equal(byRule(calc, 'anchor.messenger').status, 'calculated');
});

test('a missing mast diameter produces needs_input with the exact field', () => {
    const settings = settingsWithMast('main');
    settings.masts.main.diameter = {
        value: null,
        unitId: 'mm',
        basis: 'model',
        measurementPointId: 'partner',
    };

    const calc = calculationFor(settings);
    const stay = byRule(calc, 'st.lower.stay');

    assert.equal(stay.status, 'needs_input');
    assert.equal(stay.reasonCode, 'measurement_required');
    assert.deepEqual(stay.missingInputIds, ['mast.main.diameter']);
    assert.equal(stay.diameterModelMm, null);
});

test('a child present under an absent parent is a validation error', () => {
    const input = buildInput(settingsWithMast('main'));
    const topmast = findNode(input, 'mast.main.topmast');
    topmast.present = false;
    findNode(input, 'mast.main.topgallant').present = true;

    const calc = calculate(input);
    assert.ok(calc.validationErrors.some((issue) => issue.code === 'PARENT_ABSENT'));
    assert.equal(calc.results.length, 0);
});

test('duplicate node ids and invalid dimensions are rejected', () => {
    const input = buildInput(settingsWithMast('main'));
    input.nodes.push({ ...input.nodes[0] });
    input.scaleDenominator = 0;
    input.measurements.mastDiameter.main = {
        value: -10,
        unitId: 'mm',
        basis: 'model',
        measurementPointId: 'partner',
    };

    const calc = calculate(input);
    const codes = calc.validationErrors.map((issue) => issue.code);

    assert.ok(codes.includes('DUPLICATE_NODE'));
    assert.ok(codes.includes('INVALID_SCALE'));
    assert.ok(codes.includes('INVALID_MEASUREMENT'));
});

test('explicit absent nodes are not applicable, never zero', () => {
    const input = buildInput(defaultSettings());
    input.nodes.push({
        nodeId: 'anchor_group.off',
        nodeType: 'anchor_group',
        parentNodeId: null,
        ownerType: 'anchor_group',
        ownerId: 'anchor_group.off',
        present: false,
        anchorConnection: 'fiber',
    });

    const calc = calculate(input);
    const bower = calc.results.filter((result) => result.ownerId === 'anchor_group.off');
    assert.ok(bower.length > 0);
    for (const result of bower) {
        assert.equal(result.status, 'not_applicable');
        assert.equal(result.reasonCode, 'node_absent');
        assert.equal(result.diameterModelMm, null);
    }
});

test('result rows contain no quantity or equipment-count fields', () => {
    const calc = calculationFor(settingsWithMast('main'));
    const allowed = new Set([
        'ownerType',
        'ownerId',
        'nodeId',
        'ruleId',
        'ropeId',
        'role',
        'segmentType',
        'nameEn',
        'nameRu',
        'group',
        'tier',
        'status',
        'reasonCode',
        'missingInputIds',
        'diameterPrototypeMm',
        'diameterModelMm',
        'method',
        'calculationKind',
        'coefficientBasis',
        'calibrationStatus',
        'profileId',
        'profileVersion',
        'schemaVersion',
        'formula',
        'referenceLabel',
        'factorLabel',
        'trace',
        'warnings',
        'alternativeGroupId',
        'variant',
        'sortIndex',
    ]);

    for (const result of calc.results) {
        for (const key of Object.keys(result)) {
            assert.ok(allowed.has(key), `unexpected result field ${key}`);
        }
    }
});

test('CSV and project JSON export all rows and the profile version', () => {
    const settings = settingsWithMast('main');
    const calc = calculationFor(settings);

    const csv = toCsv(calc);
    assert.ok(csv.startsWith('\uFEFFprofileId,profileVersion,schemaVersion'));
    assert.equal(csv.trim().split('\r\n').length, calc.results.length + 1);
    assert.ok(csv.includes('st.lower.stay'));
    assert.ok(csv.includes('traditional_plant'));

    const json = toProjectJson(calc, settings, '2026-11-03T00:00:00.000Z');
    const parsed = JSON.parse(json) as {
        exportedAt: string;
        profile: { profileVersion: string };
        calculation: { results: unknown[] };
        settings: { scaleDenominator: number };
    };
    assert.equal(parsed.exportedAt, '2026-11-03T00:00:00.000Z');
    assert.equal(parsed.profile.profileVersion, '1.0.0');
    assert.equal(parsed.calculation.results.length, calc.results.length);
    assert.equal(parsed.settings.scaleDenominator, 64);
});
