import test from 'node:test';
import assert from 'node:assert/strict';

import {
    PREFILL_FIELDS,
    mapModelMeasurements,
    measurementFromPrefill,
    parseModelScale,
    type MeasurementSource,
} from '../src/lib/rigging/modelMeasurements.ts';

function source(
    code: string,
    valueMm: number,
    target?: { kind: string; id: string; label?: string },
): MeasurementSource {
    return { code, valueMm, target };
}

test('explicit adapter maps only the declared measurement codes and elements', () => {
    const result = mapModelMeasurements([
        source('overall_length', 832),
        source('hull_width', 130),
        source('mast_diameter', 8, { kind: 'mast', id: 'fore_mast' }),
        source('mast_diameter', 9, { kind: 'mast', id: 'main_mast' }),
        source('mast_diameter', 7, { kind: 'mast', id: 'mizzen_mast' }),
        source('bowsprit_diameter', 6),
        source('gun_bore', 4),
    ]);

    assert.deepEqual(result.values, {
        'mastDiameter.fore': 8,
        'mastDiameter.main': 9,
        'mastDiameter.mizzen': 7,
        bowspritDiameter: 6,
        hullWidth: 130,
        gunBore: 4,
    });
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.diagnostics, []);
});

test('mast element codes are mapped explicitly, not guessed', () => {
    const result = mapModelMeasurements([
        source('mast_diameter', 12, { kind: 'mast', id: 'main_topmast' }),
        source('mast_diameter', 10, { kind: 'mast', id: 'fore_mast' }),
    ]);

    assert.deepEqual(result.values, { 'mastDiameter.fore': 10 });
    assert.equal(result.diagnostics.length, 1);
    assert.match(result.diagnostics[0]?.message ?? '', /main_topmast/);
    assert.ok(result.missing.includes('mastDiameter.main'));
    assert.ok(result.missing.includes('mastDiameter.mizzen'));
});

test('a mast diameter without an element is not applied to an arbitrary mast', () => {
    const result = mapModelMeasurements([source('mast_diameter', 9)]);

    assert.deepEqual(result.values, {});
    assert.equal(result.diagnostics.length, 1);
    assert.deepEqual(result.missing, [...PREFILL_FIELDS]);
});

test('overall width never substitutes for hull width', () => {
    const result = mapModelMeasurements([
        source('overall_width', 310),
        source('hull_width', 130),
    ]);

    assert.equal(result.values.hullWidth, 130);
    assert.equal(result.applied.length, 1);
});

test('zero, negative and non-finite values are rejected and reported', () => {
    const result = mapModelMeasurements([
        source('hull_width', 0),
        source('bowsprit_diameter', -2),
        source('gun_bore', Number.NaN),
    ]);

    assert.deepEqual(result.values, {});
    assert.equal(result.diagnostics.length, 3);
    assert.ok(result.missing.includes('hullWidth'));
    assert.ok(result.missing.includes('bowspritDiameter'));
    assert.ok(result.missing.includes('gunBore'));
});

test('duplicate measurements for the same field keep the first and are reported', () => {
    const result = mapModelMeasurements([
        source('mast_diameter', 8, { kind: 'mast', id: 'fore_mast' }),
        source('mast_diameter', 8.5, { kind: 'mast', id: 'fore_mast' }),
    ]);

    assert.equal(result.values['mastDiameter.fore'], 8);
    assert.equal(result.diagnostics.length, 1);
    assert.match(result.diagnostics[0]?.message ?? '', /Duplicate/);
});

test('an empty list reports every adapter input as missing', () => {
    const result = mapModelMeasurements([]);

    assert.deepEqual(result.applied, []);
    assert.deepEqual(result.values, {});
    assert.deepEqual(result.missing, [...PREFILL_FIELDS]);
});

test('prefill keeps millimetres and model semantics, so no scale is applied', () => {
    assert.deepEqual(measurementFromPrefill(8.5), {
        value: 8.5,
        unitId: 'mm',
        basis: 'model',
    });
});

test('model scale is parsed only from an unambiguous string', () => {
    assert.equal(parseModelScale('1:64'), 64);
    assert.equal(parseModelScale('1 / 48'), 48);
    assert.equal(parseModelScale(' 1:72 '), 72);
    assert.equal(parseModelScale('64'), 64);
    assert.equal(parseModelScale('1:0'), null);
    assert.equal(parseModelScale('0'), null);
    assert.equal(parseModelScale('scale 1:64'), null);
    assert.equal(parseModelScale(''), null);
    assert.equal(parseModelScale(null), null);
    assert.equal(parseModelScale(undefined), null);
});
