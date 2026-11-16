/**
 * Контроль неизменности расчёта при доработке интерфейса.
 *
 * Снимок `tests/fixtures/rigging-control.json` фиксирует полную контрольную
 * ведомость традиционного профиля: ключи строк, группы, ярусы, статусы,
 * материалы и диаметры. Тест ловит случайное изменение методики или порядка
 * строк. Обновлять снимок можно только вместе с отдельно согласованным
 * изменением расчётного ядра.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildInput } from '../src/lib/rigging/settings.ts';
import { calculate } from '../src/lib/rigging/calculate.ts';
import { ledgerRowKey } from '../src/lib/rigging/ledgerKey.ts';
import { loadDocument, loadManifest } from './helpers/profiles.ts';
import {
    controlDigest,
    controlRows,
    fullSettingsFor,
    type ControlRow,
} from './helpers/control.ts';

interface ControlFixture {
    schemaVersion: string;
    algorithmVersion: string;
    profileId: string;
    profileVersion: string;
    scaleDenominator: number;
    configuration: string;
    rowCount: number;
    digest: string;
    rows: ControlRow[];
}

const FIXTURE = JSON.parse(
    readFileSync(join(import.meta.dirname, 'fixtures', 'rigging-control.json'), 'utf8'),
) as ControlFixture;

function approx(actual: number | null, expected: number | null, label: string): void {
    if (actual === null || expected === null) {
        assert.equal(actual, expected, `${label}: nullability changed`);
        return;
    }
    assert.ok(
        Math.abs(actual - expected) <= 1e-12,
        `${label}: expected ${expected}, got ${actual}`,
    );
}

test('control full ledger for traditional_plant matches the frozen snapshot', () => {
    const document = loadDocument(FIXTURE.profileId, FIXTURE.profileVersion);
    const settings = fullSettingsFor(document);
    const calc = calculate(buildInput(settings), document);
    const rows = controlRows(calc.results);

    assert.equal(calc.schemaVersion, FIXTURE.schemaVersion);
    assert.equal(calc.algorithmVersion, FIXTURE.algorithmVersion);
    assert.equal(calc.profileVersion, FIXTURE.profileVersion);
    assert.equal(settings.scaleDenominator, FIXTURE.scaleDenominator);
    assert.equal(FIXTURE.configuration, 'full');

    assert.equal(rows.length, FIXTURE.rowCount, 'row count changed');
    assert.equal(rows.length, FIXTURE.rows.length);
    assert.equal(controlDigest(rows), FIXTURE.digest, 'control ledger digest changed');

    for (const [index, row] of rows.entries()) {
        const expected = FIXTURE.rows[index];
        assert.equal(row.key, expected.key, `row ${index}: key or order changed`);
        assert.equal(row.group, expected.group, `${row.key}: group changed`);
        assert.equal(row.tier, expected.tier, `${row.key}: tier changed`);
        assert.equal(row.variant, expected.variant, `${row.key}: variant changed`);
        assert.equal(row.status, expected.status, `${row.key}: status changed`);
        assert.equal(row.material, expected.material, `${row.key}: material changed`);
        assert.equal(row.basis, expected.basis, `${row.key}: coefficient basis changed`);
        approx(row.modelMm, expected.modelMm, `${row.key}: model diameter`);
        approx(row.prototypeMm, expected.prototypeMm, `${row.key}: prototype diameter`);
    }
});

test('row keys are unique and structurally valid for every profile full configuration', () => {
    const manifest = loadManifest();

    for (const entry of manifest.profiles) {
        const document = loadDocument(entry.profileId, entry.latest);
        const calc = calculate(buildInput(fullSettingsFor(document)), document);
        const keys = calc.results.map((result) => ledgerRowKey(result));

        assert.ok(calc.results.length > 0, `${entry.profileId}: empty full ledger`);
        assert.equal(
            new Set(keys).size,
            keys.length,
            `${entry.profileId}: duplicate row keys in ${keys.length} rows`,
        );

        for (const result of calc.results) {
            const label = `${entry.profileId}/${ledgerRowKey(result)}`;
            assert.equal(
                result.ownerId,
                ledgerRowKey(result).split('|')[0],
                `${label}: key must start with ownerId`,
            );

            if (result.tier !== undefined) {
                assert.equal(
                    result.ownerType,
                    'mast',
                    `${label}: tier is only valid for mast owners`,
                );
            }

            if (result.status === 'calculated') {
                assert.notEqual(result.diameterModelMm, null, `${label}: calculated without diameter`);
            } else {
                assert.equal(
                    result.diameterModelMm,
                    null,
                    `${label}: non-calculated row must not fake a diameter`,
                );
            }

            if (result.ownerType === 'bowsprit') assert.equal(result.group, 'bowsprit', label);
            if (result.ownerType === 'anchor_group') assert.equal(result.group, 'anchor', label);
            if (result.ownerType === 'gun_group') assert.equal(result.group, 'gun', label);
            if (result.ownerType === 'mast') {
                assert.ok(
                    result.group === 'standing' || result.group === 'running',
                    `${label}: mast row must be standing or running`,
                );
            }
        }
    }
});

test('control ledger covers every supported node family of traditional_plant', () => {
    const document = loadDocument(FIXTURE.profileId, FIXTURE.profileVersion);
    const calc = calculate(buildInput(fullSettingsFor(document)), document);
    const ownerIds = new Set(calc.results.map((result) => result.ownerId));

    for (const ownerId of ['fore', 'main', 'mizzen', 'bowsprit', 'anchor_group', 'gun_group']) {
        assert.ok(ownerIds.has(ownerId), `control ledger lost the ${ownerId} section`);
    }

    const tiered = calc.results.filter((result) => result.tier);
    assert.deepEqual(
        [...new Set(tiered.map((result) => result.tier))].sort(),
        ['lower', 'topgallant', 'topmast'],
        'control ledger must exercise all three mast tiers',
    );

    const tierless = calc.results.filter((result) => !result.tier);
    assert.ok(tierless.length > 0, 'control ledger must keep tier-less rows visible');
    assert.ok(
        tierless.every((result) => result.status !== 'calculated' || result.diameterModelMm !== null),
        'tier-less rows must keep their computed diameters',
    );
});

test('the row key distinguishes tier and variant but ignores display details', () => {
    const base = {
        ownerId: 'fore',
        nodeId: 'mast.fore.lower',
        ruleId: 'rn.square.lower.tie',
    };
    const lower = ledgerRowKey({ ...base, tier: 'lower', variant: 'compound' });
    const topmast = ledgerRowKey({ ...base, tier: 'topmast', variant: 'compound' });
    const simple = ledgerRowKey({ ...base, tier: 'lower', variant: 'simple' });
    const noVariant = ledgerRowKey({ ...base, tier: 'lower' });

    assert.notEqual(lower, topmast);
    assert.notEqual(lower, simple);
    assert.notEqual(lower, noVariant);
    assert.equal(lower, 'fore|mast.fore.lower|rn.square.lower.tie|lower|compound');
});
