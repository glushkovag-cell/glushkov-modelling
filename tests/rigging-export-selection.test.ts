import test from 'node:test';
import assert from 'node:assert/strict';

import { buildInput } from '../src/lib/rigging/settings.ts';
import { calculate } from '../src/lib/rigging/calculate.ts';
import { toCsv, toProjectJson } from '../src/lib/rigging/export.ts';
import { ledgerRowKey } from '../src/lib/rigging/ledgerKey.ts';
import { makeThreadPick } from '../src/lib/rigging/threadPick.ts';
import { loadDocument } from './helpers/profiles.ts';
import { fullSettingsFor } from './helpers/control.ts';

const document = loadDocument('traditional_plant', '1.1.0');
const settings = fullSettingsFor(document);
const calculation = calculate(buildInput(settings), document);
const subset = calculation.results.slice(0, 12);

test('CSV exports exactly the requested subset by default order', () => {
    const all = toCsv(calculation);
    const selected = toCsv(calculation, subset);

    assert.equal(all.trim().split('\r\n').length, calculation.results.length + 1);
    assert.equal(selected.trim().split('\r\n').length, subset.length + 1);

    const selectedRows = selected.trim().split('\r\n').slice(1);
    assert.equal(selectedRows.length, subset.length);
    assert.ok(selectedRows[0].includes(subset[0].ruleId));
    assert.ok(!selectedRows.some((row) => row.includes(calculation.results.at(-1)!.ruleId)));
});

test('project JSON records the export scope and total row count', () => {
    const exported = toProjectJson(calculation, settings, '2026-11-16T00:00:00.000Z', {
        results: subset,
        scope: 'selection',
        conditions: ['Node: Foremast', 'Search: “ванты”'],
    });
    const parsed = JSON.parse(exported) as {
        calculation: {
            results: Array<Record<string, unknown>>;
        };
        selection?: {
            scope: string;
            rowCount: number;
            totalRowCount: number;
            conditions: string[];
        };
    };

    assert.equal(parsed.calculation.results.length, subset.length);
    assert.deepEqual(parsed.selection, {
        scope: 'selection',
        rowCount: subset.length,
        totalRowCount: calculation.results.length,
        conditions: ['Node: Foremast', 'Search: “ванты”'],
    });
    for (const result of parsed.calculation.results) {
        assert.equal('formula' in result, false);
        assert.equal('trace' in result, false);
    }
});

test('the default project export still contains the whole ledger', () => {
    const exported = toProjectJson(calculation, settings, '2026-11-16T00:00:00.000Z');
    const parsed = JSON.parse(exported) as {
        calculation: { results: Array<Record<string, unknown>> };
        selection?: unknown;
    };

    assert.equal(parsed.calculation.results.length, calculation.results.length);
    assert.equal(parsed.selection, undefined);
});

test('CSV and JSON include the selected thread by thread_id', () => {
    const target = calculation.results.find((result) => result.diameterModelMm !== null)!;
    const rowKey = ledgerRowKey(target);
    const pick = makeThreadPick(
        {
            threadId: 'test-40',
            brand: 'Test',
            number: '40',
            dtex: 400,
            threadsPerStrand: 2,
            diameterMm: 0.5,
            deviationPercent: 1.5,
        },
        target.diameterModelMm!,
        target.diameterModelMm!,
    )!;
    const picks = new Map([[rowKey, pick]]);

    const csv = toCsv(calculation, [target], picks);
    const [header, row] = csv.trim().split('\r\n');
    assert.ok(header.replace(/^\uFEFF/, '').split(',').includes('thread_id'));
    assert.ok(row.includes('test-40'));
    assert.ok(row.includes('Test 40'));
    assert.ok(row.includes('0.5'));

    const exported = toProjectJson(calculation, settings, '2026-11-16T00:00:00.000Z', {
        results: [target],
        scope: 'selection',
        threadPicks: picks,
    });
    const parsed = JSON.parse(exported) as {
        threads: Array<Record<string, unknown>>;
    };
    assert.equal(parsed.threads.length, 1);
    assert.equal(parsed.threads[0].rowKey, rowKey);
    assert.equal(parsed.threads[0].thread_id, 'test-40');
    assert.equal(parsed.threads[0].targetMm, target.diameterModelMm);
});

test('exports without picks keep the threads field out', () => {
    const exported = toProjectJson(calculation, settings, '2026-11-16T00:00:00.000Z');
    const parsed = JSON.parse(exported) as { threads?: unknown };
    assert.equal(parsed.threads, undefined);
});
