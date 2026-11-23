import test from 'node:test';
import assert from 'node:assert/strict';

import {
    formatMeasurementValue,
    groupModelMeasurements,
    measurementDescription,
    measurementDisplayLabel,
    measurementGroupLabel,
    type ModelMeasurement,
} from '../src/lib/modelMeasurements.ts';

function measurement(overrides: Partial<ModelMeasurement> = {}): ModelMeasurement {
    return {
        code: 'hull_width',
        label: 'Hull width',
        description: 'Maximum width of the hull.',
        group: 'hull',
        valueMm: 130,
        target: null,
        note: null,
        ...overrides,
    };
}

test('overall length is shown first and removed from the grouped list', () => {
    const grouped = groupModelMeasurements([
        measurement({ code: 'hull_width', group: 'hull', valueMm: 130 }),
        measurement({
            code: 'overall_length',
            label: 'Overall length',
            group: 'overall',
            valueMm: 832,
        }),
        measurement({
            code: 'mast_diameter',
            label: 'Mast diameter',
            group: 'rig',
            valueMm: 9,
            target: { kind: 'mast', id: 'main_mast', label: 'Mainmast' },
        }),
    ]);

    assert.equal(grouped.overallLength?.valueMm, 832);
    assert.deepEqual(
        grouped.groups.map((group) => [group.code, group.measurements.map((item) => item.code)]),
        [
            ['hull', ['hull_width']],
            ['rig', ['mast_diameter']],
        ],
    );
});

test('groups keep the server order, are not sorted again and empty groups are absent', () => {
    const grouped = groupModelMeasurements([
        measurement({ code: 'hull_width', group: 'hull' }),
        measurement({ code: 'mast_diameter', group: 'rig' }),
        measurement({ code: 'gun_bore', group: 'armament' }),
        measurement({ code: 'bowsprit_length', group: 'rig' }),
    ]);

    assert.deepEqual(
        grouped.groups.map((group) => [group.code, group.label]),
        [
            ['hull', 'Hull'],
            ['rig', 'Rigging'],
            ['armament', 'Armament'],
        ],
    );
    assert.deepEqual(
        grouped.groups[1]?.measurements.map((item) => item.code),
        ['mast_diameter', 'bowsprit_length'],
    );
});

test('other overall measurements stay in the overall group after the length row', () => {
    const grouped = groupModelMeasurements([
        measurement({ code: 'overall_length', label: 'Overall length', group: 'overall', valueMm: 960 }),
        measurement({ code: 'overall_width', label: 'Overall width', group: 'overall', valueMm: 310 }),
    ]);

    assert.equal(grouped.overallLength?.code, 'overall_length');
    assert.deepEqual(
        grouped.groups.map((group) => [group.code, group.measurements.map((item) => item.code)]),
        [['overall', ['overall_width']]],
    );
});

test('missing, zero and non-finite values are not displayed', () => {
    const grouped = groupModelMeasurements([
        measurement({ code: 'hull_width', valueMm: 0 }),
        measurement({ code: 'hull_length', valueMm: Number.NaN }),
        measurement({ code: 'overall_length', group: 'overall', valueMm: 500 }),
    ]);

    assert.equal(grouped.overallLength?.valueMm, 500);
    assert.equal(grouped.groups.length, 0);
});

test('measurement labels add the element name only when a target exists', () => {
    assert.equal(
        measurementDisplayLabel(
            measurement({
                label: 'Mast diameter',
                target: { kind: 'mast', id: 'main_mast', label: 'Mainmast' },
            }),
        ),
        'Mast diameter — Mainmast',
    );
    assert.equal(
        measurementDisplayLabel(measurement({ label: 'Hull width', target: null })),
        'Hull width',
    );
});

test('values are displayed without silent rounding', () => {
    assert.equal(formatMeasurementValue(8.125), '8.125');
    assert.equal(formatMeasurementValue(960), '960');
});

test('a description repeating the label is not displayed twice', () => {
    assert.equal(
        measurementDescription(
            measurement({ label: 'Overall length', description: 'Overall length' }),
        ),
        null,
    );
    assert.equal(
        measurementDescription(
            measurement({ label: 'Overall length', description: '  overall LENGTH  ' }),
        ),
        null,
    );
    assert.equal(
        measurementDescription(
            measurement({
                label: 'Mast diameter',
                description: 'Diameter measured at the partners.',
            }),
        ),
        'Diameter measured at the partners.',
    );
    assert.equal(measurementDescription(measurement({ description: '' })), null);
});

test('unknown group codes get a readable label', () => {
    assert.equal(measurementGroupLabel('rig'), 'Rigging');
    assert.equal(measurementGroupLabel('spars_and_gear'), 'Spars and gear');
    assert.equal(measurementGroupLabel(''), 'Other');
});

test('an empty or missing list produces no overall row and no groups', () => {
    assert.deepEqual(groupModelMeasurements([]), { overallLength: null, groups: [] });
    assert.deepEqual(groupModelMeasurements(null), { overallLength: null, groups: [] });
    assert.deepEqual(groupModelMeasurements(undefined), { overallLength: null, groups: [] });
});
