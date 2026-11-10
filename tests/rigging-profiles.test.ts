import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { calculate } from '../src/lib/rigging/calculate.ts';
import { validateProfileDocument, type ProfileDocument } from '../src/lib/rigging/document.ts';
import { summariseProfile } from '../src/lib/rigging/profiles.ts';
import { buildInput, defaultSettingsForProfile, type RiggingSettings } from '../src/lib/rigging/settings.ts';
import { POINT_PROXY_WARNING } from '../src/lib/rigging/profile.ts';
import { MAST_IDS, type MastId, type RiggingResult } from '../src/lib/rigging/types.ts';
import {
    EARLY,
    SCHOONER,
    TRADITIONAL,
    YACHT,
    loadAllDocuments,
    loadDocument,
    loadManifest,
} from './helpers/profiles.ts';

const ROOT = join(import.meta.dirname, '..');

function approx(actual: number | null | undefined, expected: number, epsilon = 1e-6): void {
    assert.notEqual(actual, null);
    assert.notEqual(actual, undefined);
    assert.ok(
        Math.abs((actual as number) - expected) <= epsilon,
        `expected ${expected}, got ${actual}`,
    );
}

function focusMast(settings: RiggingSettings, mastId: MastId, diameterMm = 10): RiggingSettings {
    for (const id of MAST_IDS) {
        settings.masts[id].present = id === mastId;
    }
    settings.masts[mastId].diameter = {
        value: diameterMm,
        unitId: 'mm',
        basis: 'model',
        measurementPointId: 'partner',
    };
    return settings;
}

function result(calc: ReturnType<typeof calculate>, ruleId: string, ownerId?: string): RiggingResult {
    const found = calc.results.find(
        (entry) => entry.ruleId === ruleId && (ownerId ? entry.ownerId === ownerId : true),
    );
    assert.ok(found, `missing result ${ruleId}`);
    return found;
}

function calculateFor(document: ProfileDocument, settings: RiggingSettings) {
    return calculate(buildInput(settings), document);
}

/* ---------------------------------- data --------------------------------- */

test('manifest matches the profile documents and their hashes', () => {
    const manifest = loadManifest();
    const documents = loadAllDocuments();

    assert.equal(manifest.schemaVersion, '1.0.0');
    const manifestVersions = manifest.profiles.flatMap((entry) => entry.versions);
    assert.equal(manifestVersions.length, documents.length);
    assert.deepEqual(
        manifest.profiles.map((entry) => entry.profileId),
        ['traditional_plant', 'yacht_metal_yacht', 'yacht_metal_schooner', 'early_plant'],
    );

    for (const entry of manifest.profiles) {
        const versions = entry.versions.map((version) => version.version);
        assert.equal(
            entry.latest,
            versions.sort((a, b) => {
                const left = a.split('.').map(Number);
                const right = b.split('.').map(Number);
                for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
                    const difference = (left[index] ?? 0) - (right[index] ?? 0);
                    if (difference !== 0) return difference;
                }
                return 0;
            })[versions.length - 1],
            `${entry.profileId} latest`,
        );

        for (const version of entry.versions) {
            const path = join(ROOT, 'data', 'rigging', version.document);
            const serialized = readFileSync(path, 'utf8');
            const hash = createHash('sha256').update(serialized).digest('hex');
            assert.equal(
                hash,
                version.sha256,
                `${entry.profileId}@${version.version} hash — после правки профиля выполните npm run rigging:manifest`,
            );
            const parsed = JSON.parse(serialized) as ProfileDocument;
            assert.equal(parsed.profile.profileId, entry.profileId);
            assert.equal(parsed.profile.profileVersion, version.version);
        }
    }
});

test('all profile documents satisfy the runtime contract', () => {
    for (const document of loadAllDocuments()) {
        assert.deepEqual(validateProfileDocument(document), [], document.profile.profileId);
        assert.equal(document.profile.schemaVersion, '1.0.0');
        assert.ok(document.profile.sources.length > 0);
        assert.ok(document.profile.warnings.length > 0);
    }
});

test('profile rule graph has no cycles and no dangling base rules', () => {
    for (const document of loadAllDocuments()) {
        const byId = new Map(document.rules.map((rule) => [rule.ruleId, rule]));
        for (const rule of document.rules) {
            const seen = new Set<string>();
            let cursor = rule;
            while (cursor.base.kind === 'rule') {
                assert.ok(cursor.base.ruleId, `${cursor.ruleId} has a rule base without ruleId`);
                assert.ok(byId.has(cursor.base.ruleId), `${cursor.ruleId} base missing`);
                if (seen.has(cursor.ruleId)) {
                    assert.fail(`cycle at ${cursor.ruleId} in ${document.profile.profileId}`);
                }
                seen.add(cursor.ruleId);
                cursor = byId.get(cursor.base.ruleId) as typeof cursor;
            }
        }
    }
});

test('profile rule counts match the published specifications', () => {
    assert.equal(TRADITIONAL().rules.length, 135);
    assert.equal(YACHT().rules.length, 5);
    assert.equal(SCHOONER().rules.length, 35);
    assert.equal(EARLY().rules.length, 48);

    assert.equal(TRADITIONAL().profile.profileVersion, '1.0.0');
    assert.equal(YACHT().profile.profileVersion, '1.0.0');
    assert.equal(SCHOONER().profile.profileVersion, '1.0.0');
    assert.equal(EARLY().profile.profileVersion, '1.2.1');
    assert.equal(EARLY().profile.status, 'draft');
    assert.equal(TRADITIONAL().profile.status, 'published');

    // Новые экспериментальные редакции сохраняют состав определений.
    assert.equal(loadDocument('traditional_plant', '1.1.0').rules.length, 135);
    assert.equal(loadDocument('yacht_metal_schooner', '1.1.0').rules.length, 35);
    assert.equal(loadDocument('early_plant', '1.2.2').rules.length, 48);
    assert.equal(loadDocument('traditional_plant', '1.1.0').profile.status, 'published');
    assert.equal(loadDocument('early_plant', '1.2.2').profile.status, 'published');
});

test('profile summaries expose counts, groups, metrics and draft status', () => {
    const early = summariseProfile(EARLY());
    assert.equal(early.profileId, 'early_plant');
    assert.equal(early.ruleCount, 48);
    assert.ok(early.description.includes('Draft'));
    assert.deepEqual(early.groups, ['standing', 'running', 'bowsprit', 'anchor']);
    assert.equal(early.metrics?.mapePercent, 13.4);
    assert.equal(early.metrics?.fittedRoles, 17);
    assert.ok(early.metrics?.note.includes('17 calibration rows'));

    const schooner = summariseProfile(SCHOONER());
    assert.equal(schooner.ruleCount, 35);
    assert.equal(schooner.family, 'yacht_metal');
    assert.equal(schooner.metrics?.crossTransferMaxPercent, 16.42);

    // Экспериментальные редакции не заявляют числовую точность: строка
    // Calibration не показывается, остаётся явная оговорка.
    const latestEarly = summariseProfile(loadDocument('early_plant', '1.2.2'));
    assert.equal(latestEarly.explanation.calibration, null);
    assert.equal(
        latestEarly.explanation.accuracy,
        'Experimental engineering estimate; historical accuracy not established.',
    );
});

test('profile card explanations follow the prescribed wording', () => {
    const cases = [
        {
            document: TRADITIONAL(),
            summary: '135 rule definitions: 27 standing, 63 running.',
            taxonomy: 'Groups: standing, running, bowsprit, anchor, gun · Materials: fiber.',
            calibration: 'Calibration: 8 fitted roles · MAPE 32.3% · worst deviation —%.',
            accuracy: 'Not an accuracy estimate for all 135 rules.',
            caveat: 'These are estimated diameters for a static scale model.',
        },
        {
            document: YACHT(),
            summary: '5 rule definitions: 3 standing, 2 running.',
            taxonomy: 'Groups: standing, running · Materials: wire, rod, fiber.',
            calibration:
                'Calibration: 4 fitted roles · MAPE 5.41% · worst deviation 8.47% · worst transfer 18.5%.',
            accuracy:
                'Four FIT2 control roles: MAPE 5.41%, maximum 8.47%; worst cross-reference transfer 18.5%. FIT1 backstays and engineering rows are not in this aggregate.',
            caveat: 'Estimates for a static model, not a strength calculation.',
        },
        {
            document: SCHOONER(),
            summary: '35 rule definitions: 9 standing, 23 running.',
            taxonomy: 'Groups: standing, running, bowsprit · Materials: wire, fiber.',
            calibration:
                'Calibration: 4 fitted roles · MAPE 4.54% · worst deviation 7.59% · worst transfer 16.42%.',
            accuracy:
                'Four FIT2 control roles: MAPE 4.54%, maximum 7.59%; worst cross-reference transfer 16.42%. 31 engineering rows are not in this aggregate.',
            caveat: 'Estimates for a static model, not a strength calculation.',
        },
        {
            document: EARLY(),
            summary: '48 rule definitions: 6 standing, 31 running.',
            taxonomy: 'Groups: standing, running, bowsprit, anchor · Materials: fiber.',
            calibration: 'Calibration: 17 fitted roles · MAPE 13.4% · worst deviation 8.57%.',
            accuracy: null,
            caveat: 'Estimates for a static model, not a strength calculation.',
        },
    ];

    for (const expected of cases) {
        const explanation = summariseProfile(expected.document).explanation;
        assert.equal(explanation.summary, expected.summary);
        assert.equal(
            explanation.disclaimer,
            'A row in the results does not assert that a rope was historically fitted.',
        );
        assert.equal(explanation.taxonomy, expected.taxonomy);
        assert.equal(explanation.calibration, expected.calibration);
        assert.equal(explanation.accuracy, expected.accuracy);
        assert.equal(explanation.caveat, expected.caveat);
    }
});

/* ------------------------------ traditional ------------------------------ */

test('traditional_plant control numbers are unchanged at D_model = 10', () => {
    const settings = focusMast(defaultSettingsForProfile(TRADITIONAL()), 'main');
    settings.masts.main.topmast = true;
    settings.masts.main.topgallant = true;
    settings.masts.main.yards = { lower: false, topmast: false, topgallant: false };
    settings.bowsprit.present = false;
    settings.anchor.present = false;
    settings.gun.present = false;
    settings.gaff.present = false;
    for (const sailClass of Object.keys(settings.foreAndAft) as Array<keyof typeof settings.foreAndAft>) {
        settings.foreAndAft[sailClass].present = false;
    }

    const calc = calculateFor(TRADITIONAL(), settings);
    approx(result(calc, 'st.lower.stay', 'main').diameterModelMm, 1.2);
    approx(result(calc, 'st.lower.shroud', 'main').diameterModelMm, 0.66);
    assert.ok(result(calc, 'st.lower.stay', 'main').sourceIds.length > 0);
    assert.equal(result(calc, 'st.lower.stay', 'main').material, 'fiber');
});

/* --------------------------------- yacht --------------------------------- */

test('yacht_metal_yacht matches the v1.0.0 control table at D_model = 10', () => {
    const settings = focusMast(defaultSettingsForProfile(YACHT()), 'main', 10);
    const calc = calculateFor(YACHT(), settings);

    approx(result(calc, 'ym.st.lower.shroud').diameterModelMm, 0.67004);
    approx(result(calc, 'ym.st.lower.stay').diameterModelMm, 0.77131);
    approx(result(calc, 'ym.st.backstay').diameterModelMm, 0.47659);
    approx(result(calc, 'ym.rn.main.sheet').diameterModelMm, 0.62906);
    approx(result(calc, 'ym.rn.main.halyard.wire').diameterModelMm, 0.2845);

    const shroud = result(calc, 'ym.st.lower.shroud');
    assert.equal(shroud.material, 'wire');
    assert.equal(shroud.measurementPointId, 'partner');
    assert.ok(shroud.warnings.some((warning) => warning.includes('material invariance')));
    assert.ok(shroud.sourceIds.includes('R-EB'));
});

test('yacht fiber lower shrouds are not supported and no parallel rule exists', () => {
    const calc = calculateFor(YACHT(), focusMast(defaultSettingsForProfile(YACHT()), 'main', 10));
    const rows = calc.results.filter((entry) => entry.ruleId === 'ym.st.lower.shroud');
    assert.equal(rows.length, 1);
    assert.deepEqual(YACHT().rules.find((rule) => rule.ruleId === 'ym.st.lower.shroud')?.materials, [
        'rod',
        'wire',
    ]);
});

/* -------------------------------- schooner ------------------------------- */

test('yacht_metal_schooner matches the v1.0.0 control table', () => {
    const settings = focusMast(defaultSettingsForProfile(SCHOONER()), 'main', 10);
    settings.bowsprit.diameter = {
        value: 8,
        unitId: 'mm',
        basis: 'model',
        measurementPointId: 'working_section',
    };
    const calc = calculateFor(SCHOONER(), settings);

    approx(result(calc, 'ym.st.lower.shroud').diameterModelMm, 0.57841);
    approx(result(calc, 'ym.st.lower.stay').diameterModelMm, 0.74231);
    approx(result(calc, 'ym.rn.gaff.sheet_fall').diameterModelMm, 0.48132);
    approx(result(calc, 'ym.rn.gaff.peak_halyard_fall').diameterModelMm, 0.38556);
    approx(result(calc, 'ym.st.topmast.shroud').diameterModelMm, 0.26);
    approx(result(calc, 'ym.st.lower.shroud_lanyard').diameterModelMm, 0.2);
    approx(result(calc, 'ym.rn.gaff.throat_halyard_fall').diameterModelMm, 0.3);
    approx(result(calc, 'ym.bow.bobstay').diameterModelMm, 0.352);
    approx(result(calc, 'ym.bow.guy').diameterModelMm, 0.272);
    approx(result(calc, 'ym.bow.backrope').diameterModelMm, 0.24);

    assert.equal(result(calc, 'ym.st.lower.shroud').material, 'wire');
    assert.equal(result(calc, 'ym.rn.gaff.brail').material, 'fiber');
});

test('schooner sail presence switches sail roles but not the boom lift', () => {
    const settings = focusMast(defaultSettingsForProfile(SCHOONER()), 'main', 10);
    const input = buildInput(settings);
    const sail = input.nodes.find(
        (node) => node.nodeType === 'gaff_sail' && node.ownerId === 'main',
    );
    assert.ok(sail, 'gaff_sail node expected');
    sail.sailPresent = false;

    const calc = calculate(input, SCHOONER());
    assert.equal(result(calc, 'ym.rn.boom.topping_lift', 'main').status, 'calculated');
    assert.equal(result(calc, 'ym.rn.gaff.brail', 'main').status, 'not_applicable');
    assert.equal(result(calc, 'ym.rn.gaff.brail', 'main').reasonCode, 'sail_not_configured');

    // Гафель без привязанного паруса не даёт парусных ролей, но гика-топенант
    // остаётся: парус не является зависимостью гика.
    const noSailSettings = focusMast(defaultSettingsForProfile(SCHOONER()), 'main', 10);
    noSailSettings.sailNodes.gaff_sail.main = false;
    const noSailCalc = calculateFor(SCHOONER(), noSailSettings);
    assert.equal(result(noSailCalc, 'ym.rn.gaff.throat_halyard_fall', 'main').status, 'not_applicable');
    assert.equal(result(noSailCalc, 'ym.rn.boom.topping_lift', 'main').status, 'calculated');
});

/* ------------------------------- early_plant ----------------------------- */

test('early_plant 1.2.1 reproduces the Santa Maria 1:65 table', () => {
    const settings = defaultSettingsForProfile(EARLY());
    const calc = calculateFor(EARLY(), settings);

    const expected: Record<string, [number, number, number]> = {
        'ep.st.lower.shroud': [0.642857143, 0.857142857, 0.642857143],
        'ep.st.lower.shroud_lanyard': [0.5, 0.666666667, 0.5],
        'ep.st.lower.stay': [0.78, 1.04, 0.78],
        'ep.st.lower.ratline': [0.218571429, 0.291428571, 0.218571429],
        'ep.st.lower.stay_lanyard': [0.273, 0.364, 0.273],
        'ep.mast.woolding': [0.6, 0.8, 0.6],
    };

    for (const [ruleId, values] of Object.entries(expected)) {
        const byMast = ['fore', 'main', 'mizzen'].map((mastId) =>
            result(calc, ruleId, mastId).diameterModelMm,
        );
        byMast.forEach((value, index) => approx(value, values[index] as number, 1e-8));
    }

    approx(result(calc, 'ep.bow.gammoning').diameterModelMm, 0.336966127, 1e-9);
    approx(result(calc, 'ep.anchor.bower_cable').diameterModelMm, 1.671641791, 1e-9);
    approx(result(calc, 'ep.anchor.anchor_stow_lashing').diameterModelMm, 0.5);
    approx(result(calc, 'ep.sail.boltrope').diameterModelMm, 0.774193548, 1e-9);
    approx(result(calc, 'ep.sail.yard_lashing').diameterModelMm, 0.285714286, 1e-9);
});

test('early_plant square and lateen rows follow the 48-rule registry', () => {
    const calc = calculateFor(EARLY(), defaultSettingsForProfile(EARLY()));

    approx(result(calc, 'ep.rn.square.lower.tie', 'main').diameterModelMm, 0.48);
    approx(result(calc, 'ep.rn.square.topmast.tie', 'main').diameterModelMm, 0.384);
    approx(result(calc, 'ep.rn.square.lower.sheet', 'main').diameterModelMm, 0.432);
    approx(result(calc, 'ep.rn.square.topmast.bowline', 'main').diameterModelMm, 0.144);
    approx(result(calc, 'ep.rn.lateen.tie', 'mizzen').diameterModelMm, 0.36);
    approx(result(calc, 'ep.rn.lateen.sheet', 'mizzen').diameterModelMm, 0.216);

    // Buntline, leechline and reef fall are outside the 48-rule early registry.
    assert.equal(
        calc.results.filter((entry) => entry.ruleId.includes('buntline')).length,
        0,
    );

    // The topgallant tier is outside the early_plant scope: no rule, no row.
    assert.equal(
        calc.results.filter((entry) => entry.ruleId.includes('topgallant')).length,
        0,
    );
});

test('early_plant reports the FIT and engineering origins separately', () => {
    const calc = calculateFor(EARLY(), defaultSettingsForProfile(EARLY()));

    assert.equal(result(calc, 'ep.st.lower.shroud', 'main').coefficientBasis, 'preliminary_fit');
    assert.equal(result(calc, 'ep.st.lower.ratline', 'main').coefficientBasis, 'engineering_assumption');
    assert.equal(result(calc, 'ep.rn.lateen.tie', 'mizzen').coefficientBasis, 'engineering_assumption');

    const coefficientBases = new Set(calc.results.map((entry) => entry.coefficientBasis));
    assert.ok(coefficientBases.has('preliminary_fit'));
    assert.ok(coefficientBases.has('engineering_assumption'));
});

/* ------------------------------- contract -------------------------------- */

test('model and prototype inputs are equivalent in every profile', () => {
    for (const document of loadAllDocuments()) {
        const model = defaultSettingsForProfile(document);
        const prototype = defaultSettingsForProfile(document);
        for (const mastId of MAST_IDS) {
            if (!prototype.masts[mastId].present) continue;
            const value = prototype.masts[mastId].diameter.value ?? 0;
            prototype.masts[mastId].diameter = {
                value: value * prototype.scaleDenominator,
                unitId: 'mm',
                basis: 'prototype',
                measurementPointId: 'partner',
            };
        }
        if (prototype.bowsprit.diameter.value !== null) {
            prototype.bowsprit.diameter = {
                ...prototype.bowsprit.diameter,
                value: (prototype.bowsprit.diameter.value as number) * prototype.scaleDenominator,
                basis: 'prototype',
            };
        }

        const modelCalc = calculateFor(document, model);
        const prototypeCalc = calculateFor(document, prototype);

        for (const modelResult of modelCalc.results) {
            const match = prototypeCalc.results.find(
                (entry) => entry.nodeId === modelResult.nodeId && entry.ruleId === modelResult.ruleId,
            );
            assert.ok(match, `${document.profile.profileId}: missing ${modelResult.ruleId}`);
            if (modelResult.diameterModelMm === null) {
                assert.equal(match.diameterModelMm, null);
                continue;
            }
            approx(modelResult.diameterModelMm, match.diameterModelMm as number, 1e-9);
        }
    }
});

test('scale is applied exactly once in early_plant', () => {
    const make = (scale: number) => {
        const settings = defaultSettingsForProfile(EARLY());
        settings.scaleDenominator = scale;
        settings.masts.main.diameter = {
            value: 520,
            unitId: 'mm',
            basis: 'prototype',
            measurementPointId: 'partner',
        };
        return calculateFor(EARLY(), settings);
    };

    const at65 = make(65);
    const at130 = make(130);
    approx(
        result(at130, 'ep.st.lower.shroud', 'main').diameterModelMm,
        (result(at65, 'ep.st.lower.shroud', 'main').diameterModelMm as number) / 2,
        1e-9,
    );
});

test('an unknown profileId is rejected instead of substituting another profile', () => {
    const settings = defaultSettingsForProfile(TRADITIONAL());
    settings.profileId = 'unknown_profile';
    const calc = calculate(buildInput(settings), TRADITIONAL());

    assert.equal(calc.results.length, 0);
    assert.ok(calc.validationErrors.some((issue) => issue.code === 'PROFILE_MISMATCH'));
});

test('a requested profileVersion that is not the supplied document is rejected', () => {
    const settings = defaultSettingsForProfile(EARLY());
    settings.profileVersion = '9.9.9';
    const calc = calculate(buildInput(settings), EARLY());

    assert.equal(calc.results.length, 0);
    assert.ok(calc.validationErrors.some((issue) => issue.code === 'PROFILE_VERSION_MISMATCH'));
});

test('the step point is marked as a proxy with a warning', () => {
    const settings = focusMast(defaultSettingsForProfile(TRADITIONAL()), 'main', 10);
    settings.masts.main.diameter = {
        ...settings.masts.main.diameter,
        measurementPointId: 'step',
    };
    const calc = calculateFor(TRADITIONAL(), settings);
    const stay = result(calc, 'st.lower.stay', 'main');

    assert.equal(stay.measurementPointId, 'step');
    assert.ok(stay.warnings.includes(POINT_PROXY_WARNING));
});

test('profile versions are independent in the manifest', () => {
    const manifest = loadManifest();
    const early = manifest.profiles.find((entry) => entry.profileId === 'early_plant');
    const yacht = manifest.profiles.find((entry) => entry.profileId === 'yacht_metal_yacht');

    assert.equal(early?.latest, '1.2.2');
    assert.equal(yacht?.latest, '1.0.0');
    assert.equal(
        manifest.profiles.find((entry) => entry.profileId === 'traditional_plant')?.latest,
        '1.1.0',
    );
    assert.notEqual(early?.latest, yacht?.latest);
});

test('a deliberately broken document is rejected by the contract guard', () => {
    const broken = JSON.parse(JSON.stringify(TRADITIONAL())) as ProfileDocument;
    broken.rules[0]!.ruleId = broken.rules[1]!.ruleId;
    broken.rules[2]!.base = { kind: 'rule', ruleId: 'does.not.exist' };
    broken.profile.schemaVersion = '2.0.0';

    const issues = validateProfileDocument(broken);
    assert.ok(issues.some((issue) => issue.includes('Duplicate ruleId')));
    assert.ok(issues.some((issue) => issue.includes('unknown base rule')));
    assert.ok(issues.some((issue) => issue.includes('Unsupported schemaVersion')));
});

test('every generated result keeps provenance without quantities', () => {
    for (const document of loadAllDocuments()) {
        const calc = calculateFor(document, defaultSettingsForProfile(document));
        assert.deepEqual(calc.validationErrors, []);
        for (const entry of calc.results) {
            assert.equal(entry.profileId, document.profile.profileId);
            assert.equal(entry.profileVersion, document.profile.profileVersion);
            assert.equal(entry.segmentType, 'rope');
            assert.ok(!('quantity' in entry));
            assert.ok(!('count' in entry));
            if (entry.status === 'calculated') {
                assert.ok(entry.sourceIds.length > 0, `${entry.ruleId} has no sourceIds`);
            }
        }
    }
});

test('loadDocument returns distinct documents per profile', () => {
    assert.equal(loadDocument('early_plant', '1.2.1').profile.profileId, 'early_plant');
    assert.throws(() => loadDocument('early_plant', '1.2.0'));
});
