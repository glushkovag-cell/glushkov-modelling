/**
 * Тесты модели представления ведомости: группировка, фильтры, поиск,
 * сортировка, подсветка и счётчики. DOM здесь не нужен.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildInput } from '../src/lib/rigging/settings.ts';
import { calculate } from '../src/lib/rigging/calculate.ts';
import type { RiggingResult } from '../src/lib/rigging/types.ts';
import { TIERS, type ResultStatus, type Tier } from '../src/lib/rigging/types.ts';
import {
    activeConditions,
    availableTiers,
    buildFacets,
    buildLedgerRows,
    groupedLedger,
    hasActiveConditions,
    highlightSegments,
    isSectionOpen,
    nodeKindOf,
    normalizeSearchText,
    rowMatchesTokens,
    searchTokens,
    selectLedgerRows,
    sortLedgerRows,
    type LedgerRow,
    type LedgerFilterState,
    type LedgerType,
} from '../src/lib/rigging/ledgerView.ts';
import { initialLedgerState, setStatus, setShowNotApplicable } from '../src/lib/rigging/ledgerState.ts';
import { loadDocument, loadManifest } from './helpers/profiles.ts';
import { fullSettingsFor } from './helpers/control.ts';

const document = loadDocument('traditional_plant', '1.1.0');
const calculation = calculate(buildInput(fullSettingsFor(document)), document);
const rows = buildLedgerRows(calculation.results);
const allFilters = { node: 'all', tier: 'all', type: 'all', status: 'all' } as const;

function makeResult(overrides: Partial<RiggingResult> = {}): RiggingResult {
    return {
        ownerType: 'mast',
        ownerId: 'fore',
        nodeId: 'mast.fore.lower',
        ruleId: 'test.rule',
        ropeId: 'test.rule',
        role: 'stay',
        segmentType: 'rope',
        nameEn: 'Lower stay',
        nameRu: 'Нижний штаг',
        group: 'standing',
        tier: 'lower',
        status: 'calculated',
        missingInputIds: [],
        diameterPrototypeMm: 80,
        diameterModelMm: 1.25,
        method: 'proportional',
        calculationKind: 'estimate',
        material: 'fiber',
        coefficientBasis: 'engineering_assumption',
        calibrationStatus: 'not_calibrated',
        profileId: 'test',
        profileVersion: '1.0.0',
        schemaVersion: '1.0.0',
        sourceIds: [],
        sourceLocator: null,
        measurementPointId: 'partner',
        formula: null,
        referenceLabel: 'B_m',
        factorLabel: '1',
        trace: [],
        warnings: [],
        sortIndex: 0,
        ...overrides,
    };
}

function syntheticRows(results: RiggingResult[]): LedgerRow[] {
    return buildLedgerRows(results);
}

test('node, tier and rigging type come from confirmed result fields', () => {
    const bowsprit = makeResult({
        ownerType: 'bowsprit',
        ownerId: 'bowsprit',
        nodeId: 'bowsprit',
        group: 'bowsprit',
        tier: undefined,
    });
    const anchor = makeResult({
        ownerType: 'anchor_group',
        ownerId: 'anchor_group',
        nodeId: 'anchor_group',
        group: 'anchor',
        tier: undefined,
    });
    const running = makeResult({
        ownerId: 'main',
        nodeId: 'mast.main.topmast.yard',
        group: 'running',
        tier: 'topmast',
    });

    assert.equal(nodeKindOf(bowsprit), 'bowsprit');
    assert.equal(nodeKindOf(anchor), 'anchor');
    assert.equal(nodeKindOf(running), 'mast');

    const built = syntheticRows([bowsprit, anchor, running]);
    assert.deepEqual(
        built.map((row) => [row.nodeKind, row.tier, row.type]),
        [
            ['bowsprit', null, null],
            ['anchor', null, null],
            ['mast', 'topmast', 'running'],
        ],
    );
});

test('control ledger groups as node → adjacent tiers → rigging type', () => {
    const sections = groupedLedger(rows);
    assert.equal(sections.length, 6);
    assert.deepEqual(
        sections.map((section) => section.nodeId),
        ['fore', 'main', 'mizzen', 'bowsprit', 'anchor_group', 'gun_group'],
    );
    assert.equal(sections.reduce((sum, section) => sum + section.count, 0), rows.length);

    const fore = sections[0];
    assert.equal(fore.hasTiers, true);
    assert.deepEqual(
        fore.tiers.map((tier) => tier.label),
        ['Lower mast', 'Topmast', 'Topgallant', 'No tier'],
    );
    assert.equal(fore.tiers.at(-1)?.tier, null);
    assert.deepEqual(
        fore.tiers[0].types.map((type) => type.type),
        ['standing', 'running'],
    );

    const bowsprit = sections.find((section) => section.nodeId === 'bowsprit');
    assert.ok(bowsprit);
    assert.equal(bowsprit.hasTiers, false);
    assert.equal(bowsprit.tiers.length, 1);
    assert.equal(bowsprit.tiers[0].label, null);
    assert.equal(bowsprit.tiers[0].types.length, 1);
    assert.equal(bowsprit.tiers[0].types[0].type, null);
});

test('grouping does not invent tiers or type headers for anchor and gun gear', () => {
    const sections = groupedLedger(rows);
    for (const nodeId of ['anchor_group', 'gun_group']) {
        const section = sections.find((entry) => entry.nodeId === nodeId);
        assert.ok(section, `missing ${nodeId}`);
        assert.equal(section.hasTiers, false);
        assert.equal(section.tiers.length, 1);
        assert.equal(section.tiers[0].tier, null);
        assert.equal(section.tiers[0].label, null);
        assert.equal(section.tiers[0].types[0].type, null);
    }
});

test('tier-less mast rows stay in an explicit No tier section', () => {
    const sections = groupedLedger(rows);
    const fore = sections.find((section) => section.nodeId === 'fore');
    assert.ok(fore);
    const noTier = fore.tiers.find((tier) => tier.tier === null);
    assert.ok(noTier);
    assert.equal(noTier.label, 'No tier');
    assert.ok(noTier.types.every((type) => type.type === 'running'));
    assert.ok(noTier.types.every((type) => type.rows.every((row) => row.tier === null)));
});

test('grouping adapts to every profile without inventing nodes or tiers', () => {
    const manifest = loadManifest();

    for (const entry of manifest.profiles) {
        const profileDocument = loadDocument(entry.profileId, entry.latest);
        const profileRows = buildLedgerRows(
            calculate(buildInput(fullSettingsFor(profileDocument)), profileDocument).results,
        );
        const sections = groupedLedger(profileRows);

        assert.ok(sections.length > 0, `${entry.profileId}: no sections`);
        assert.deepEqual(
            sections.map((section) => section.nodeId).sort(),
            [...new Set(profileRows.map((row) => row.nodeId))].sort(),
            `${entry.profileId}: sections must match owners`,
        );
        assert.equal(
            sections.reduce((sum, section) => sum + section.count, 0),
            profileRows.length,
            `${entry.profileId}: section counts must add up`,
        );

        for (const section of sections) {
            assert.ok(section.count > 0, `${entry.profileId}/${section.nodeId}: empty section`);
            if (section.kind !== 'mast') {
                assert.equal(section.hasTiers, false, `${section.nodeId}: non-mast tiers invented`);
                assert.equal(section.tiers.length, 1);
                assert.equal(section.tiers[0].tier, null);
                assert.equal(section.tiers[0].label, null);
                assert.ok(
                    section.tiers[0].types.every((type) => type.type === null || type.type === 'running'),
                    `${section.nodeId}: unexpected rigging type`,
                );
            } else {
                const tierValues = section.tiers.map((tier) => tier.tier);
                assert.deepEqual(
                    tierValues,
                    [...TIERS.filter((tier) => tierValues.includes(tier)), null].filter((tier) =>
                        tierValues.includes(tier),
                    ),
                    `${entry.profileId}/${section.nodeId}: tier order is wrong`,
                );
                assert.ok(section.tiers.some((tier) => tier.tier === 'lower'), 'mast must expose a lower tier');
            }
        }
    }
});

test('filter facets are built from the whole ledger, not from the current selection', () => {
    const facets = buildFacets(rows);
    assert.deepEqual(
        facets.nodes.map((node) => node.value),
        ['fore', 'main', 'mizzen', 'bowsprit', 'anchor_group', 'gun_group'],
    );
    assert.deepEqual(facets.tiers, ['lower', 'topmast', 'topgallant']);
    assert.deepEqual(facets.types, ['standing', 'running']);
    assert.deepEqual(facets.statuses, ['calculated', 'unsupported']);
    assert.deepEqual(availableTiers(rows, 'bowsprit'), []);
    assert.deepEqual(availableTiers(rows, 'fore'), ['lower', 'topmast', 'topgallant']);
});

test('independent filters combine with AND and keep M stable', () => {
    const fore = selectLedgerRows(rows, {
        filters: { ...allFilters, node: 'fore' },
        query: '',
        showNotApplicable: false,
    });
    assert.equal(fore.visible.length, 84);
    assert.equal(fore.totalM, rows.length);

    const foreLower = selectLedgerRows(rows, {
        filters: { ...allFilters, node: 'fore', tier: 'lower' },
        query: '',
        showNotApplicable: false,
    });
    assert.ok(foreLower.visible.length > 0);
    assert.ok(foreLower.visible.every((row) => row.nodeId === 'fore' && row.tier === 'lower'));

    const foreLowerStanding = selectLedgerRows(rows, {
        filters: { ...allFilters, node: 'fore', tier: 'lower', type: 'standing' },
        query: '',
        showNotApplicable: false,
    });
    assert.ok(foreLowerStanding.visible.length > 0);
    assert.ok(
        foreLowerStanding.visible.every((row) => row.type === 'standing'),
        'AND between node, tier and type failed',
    );

    const unsupported = selectLedgerRows(rows, {
        filters: { ...allFilters, status: 'unsupported' },
        query: '',
        showNotApplicable: false,
    });
    assert.equal(unsupported.visible.length, 9);
    assert.ok(unsupported.visible.every((row) => row.result.status === 'unsupported'));
    assert.ok(unsupported.visible.every((row) => row.result.diameterModelMm === null));
});

test('every node, tier, type and status combination matches a direct predicate', () => {
    const facets = buildFacets(rows);
    const nodes = ['all', ...facets.nodes.map((node) => node.value)];
    const statuses = ['all', ...facets.statuses];
    const types = ['all', ...facets.types];

    for (const node of nodes) {
        const tiers = ['all', ...availableTiers(rows, node)];
        for (const tier of tiers) {
            for (const type of types) {
                for (const status of statuses) {
                    const filters = {
                        node,
                        tier: tier as Tier | 'all',
                        type: type as LedgerType | 'all',
                        status: status as ResultStatus | 'all',
                    };
                    const actual = selectLedgerRows(rows, {
                        filters,
                        query: '',
                        showNotApplicable: false,
                    }).visible;

                    const expected = rows.filter((row) => {
                        if (filters.node !== 'all' && row.nodeId !== filters.node) return false;
                        if (filters.tier !== 'all' && row.tier !== filters.tier) return false;
                        if (filters.type !== 'all' && row.type !== filters.type) return false;
                        if (filters.status !== 'all' && row.result.status !== filters.status) return false;
                        return row.result.status !== 'not_applicable';
                    });

                    assert.equal(
                        actual.length,
                        expected.length,
                        `${node}/${tier}/${type}/${status}: ${actual.length} != ${expected.length}`,
                    );
                }
            }
        }
    }
});

test('Standing and Running exclude unclassified bowsprit, anchor and gun rows', () => {
    for (const type of ['standing', 'running'] as const) {
        const selected = selectLedgerRows(rows, {
            filters: { ...allFilters, type },
            query: '',
            showNotApplicable: false,
        });
        assert.ok(selected.visible.length > 0);
        assert.ok(
            selected.visible.every((row) => row.type === type),
            `${type} filter leaked an unclassified row`,
        );
    }

    const all = selectLedgerRows(rows, {
        filters: allFilters,
        query: '',
        showNotApplicable: false,
    });
    assert.equal(all.visible.length, rows.length);
});

test('not applicable rows are hidden by default and count in M when shown', () => {
    const na = makeResult({
        ruleId: 'na.rule',
        status: 'not_applicable',
        reasonCode: 'node_absent',
        diameterModelMm: null,
        diameterPrototypeMm: null,
    });
    const data = syntheticRows([makeResult(), na]);

    const hidden = selectLedgerRows(data, {
        filters: allFilters,
        query: '',
        showNotApplicable: false,
    });
    assert.equal(hidden.visible.length, 1);
    assert.equal(hidden.totalM, 1);

    const shown = selectLedgerRows(data, {
        filters: allFilters,
        query: '',
        showNotApplicable: true,
    });
    assert.equal(shown.visible.length, 2);
    assert.equal(shown.totalM, 2);

    const state = setShowNotApplicable(
        setStatus(initialLedgerState(), 'not_applicable'),
        false,
    );
    assert.equal(state.filters.status, 'all', 'hiding NA must reset the NA status filter');
});

test('search matches RU and EN names, case, ё/е and multiple words', () => {
    const byRu = selectLedgerRows(rows, {
        filters: allFilters,
        query: '  ВАНТЫ ',
        showNotApplicable: false,
    });
    assert.ok(byRu.visible.length > 0);
    assert.ok(byRu.visible.every((row) => /ванты/i.test(row.result.nameRu)));
    assert.ok(byRu.matchingNodes.size > 0);

    const byEn = selectLedgerRows(rows, {
        filters: allFilters,
        query: 'SHROUD',
        showNotApplicable: false,
    });
    assert.ok(byEn.visible.length > 0);
    assert.ok(byEn.visible.every((row) => /shroud/i.test(row.result.nameEn)));

    const yo = selectLedgerRows(rows, {
        filters: allFilters,
        query: 'легкий',
        showNotApplicable: false,
    });
    const withYo = selectLedgerRows(rows, {
        filters: allFilters,
        query: 'лёгкий',
        showNotApplicable: false,
    });
    assert.ok(yo.visible.length > 0);
    assert.deepEqual(
        yo.visible.map((row) => row.key),
        withYo.visible.map((row) => row.key),
    );

    const multi = selectLedgerRows(rows, {
        filters: allFilters,
        query: 'lower stay',
        showNotApplicable: false,
    });
    assert.ok(multi.visible.length > 0);
    assert.ok(
        multi.visible.every((row) => {
            const en = normalizeSearchText(row.result.nameEn);
            const ru = normalizeSearchText(row.result.nameRu);
            return (
                (en.includes('lower') && en.includes('stay')) ||
                (ru.includes('lower') && ru.includes('stay'))
            );
        }),
    );
});

test('multi-word search requires every word in one of the row names', () => {
    const both = makeResult({ nameEn: 'Lower stay', nameRu: 'Нижний штаг' });
    const split = makeResult({
        ruleId: 'split',
        nameEn: 'Lower shroud',
        nameRu: 'Нижние ванты',
    });
    const data = syntheticRows([both, split]);

    const tokens = searchTokens('lower штаг');
    assert.deepEqual(tokens, ['lower', 'штаг']);
    assert.equal(
        rowMatchesTokens(data[0], tokens),
        false,
        'words from different names must not be combined',
    );
    assert.equal(
        rowMatchesTokens(data[1], tokens),
        false,
        'words from different names must not be combined',
    );
    assert.equal(
        rowMatchesTokens(data[0], searchTokens('lower stay')),
        true,
        'all words in the English name must match',
    );
    assert.equal(
        rowMatchesTokens(data[0], searchTokens('нижний штаг')),
        true,
        'all words in the Russian name must match',
    );
    assert.equal(
        rowMatchesTokens(data[0], searchTokens('lower штаг')),
        false,
        'words split between EN and RU names must not match',
    );
});

test('search with no matches yields an empty selection and no matching nodes', () => {
    const selected = selectLedgerRows(rows, {
        filters: allFilters,
        query: 'совершенно-нет-такой-снасти',
        showNotApplicable: false,
    });
    assert.equal(selected.visible.length, 0);
    assert.equal(selected.matchingNodes.size, 0);
    assert.equal(selected.totalM, rows.length);
});

test('highlighting is text-only and handles ё/е and overlap', () => {
    assert.deepEqual(highlightSegments('Lower stay', []), [
        { text: 'Lower stay', match: false },
    ]);
    assert.deepEqual(highlightSegments('Lower stay', ['stay']), [
        { text: 'Lower ', match: false },
        { text: 'stay', match: true },
    ]);

    const yo = highlightSegments('Кабельтов, лёгкий', ['легкий']);
    assert.equal(yo.map((segment) => segment.text).join(''), 'Кабельтов, лёгкий');
    assert.deepEqual(
        yo.filter((segment) => segment.match).map((segment) => segment.text),
        ['лёгкий'],
    );

    const overlap = highlightSegments('Lower', ['lower', 'owe']);
    assert.equal(overlap.map((segment) => segment.text).join(''), 'Lower');
    assert.equal(overlap.length, 1);
    assert.equal(overlap[0].match, true);

    const markup = highlightSegments('<b>stay</b>', ['stay']);
    assert.equal(markup.map((segment) => segment.text).join(''), '<b>stay</b>');
    assert.deepEqual(
        markup.filter((segment) => segment.match).map((segment) => segment.text),
        ['stay'],
    );
});

test('sorting by name and diameter has the declared scope and nulls last', () => {
    const nameAsc = sortLedgerRows(rows, 'name-asc');
    const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
    for (let index = 1; index < nameAsc.length; index += 1) {
        const previous = nameAsc[index - 1].result.nameEn;
        const current = nameAsc[index].result.nameEn;
        assert.ok(
            collator.compare(previous, current) <= 0,
            `${previous} must not sort after ${current}`,
        );
    }

    const diameterAsc = sortLedgerRows(rows, 'diameter-asc');
    const numbers = diameterAsc
        .map((row) => row.result.diameterModelMm)
        .filter((value): value is number => value !== null);
    assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b));
    assert.ok(
        diameterAsc.slice(numbers.length).every((row) => row.result.diameterModelMm === null),
        'null diameters must come last',
    );

    const diameterDesc = sortLedgerRows(rows, 'diameter-desc');
    const descending = diameterDesc
        .map((row) => row.result.diameterModelMm)
        .filter((value): value is number => value !== null);
    assert.deepEqual(descending, [...descending].sort((a, b) => b - a));
    assert.ok(
        diameterDesc.slice(descending.length).every((row) => row.result.diameterModelMm === null),
        'null diameters must stay last in descending order too',
    );

    const grouped = groupedLedger(rows, 'name-asc');
    for (const section of grouped) {
        for (const tier of section.tiers) {
            for (const type of tier.types) {
                const names = type.rows.map((row) => row.result.nameEn);
                assert.deepEqual(names, [...names].sort(collator.compare));
            }
        }
    }
});

test('active conditions and Clear all readiness follow the state', () => {
    const state: LedgerFilterState = {
        filters: { node: 'fore', tier: 'lower', type: 'standing', status: 'calculated' },
        query: '  stay ',
        showNotApplicable: true,
    };
    const conditions = activeConditions(state);
    assert.deepEqual(
        conditions.map((condition) => condition.kind),
        ['query', 'node', 'tier', 'type', 'status', 'notApplicable'],
    );
    assert.equal(hasActiveConditions(state), true);
    assert.equal(
        hasActiveConditions({
            filters: allFilters,
            query: '   ',
            showNotApplicable: false,
        }),
        false,
    );
});

test('search auto-expands matching sections and clearing restores collapsed state', () => {
    const collapsed = new Set(['fore', 'main']);
    const matched = new Set(['fore']);
    assert.equal(isSectionOpen(collapsed, 'fore', 'stay', matched), true);
    assert.equal(isSectionOpen(collapsed, 'main', 'stay', matched), false);
    assert.equal(isSectionOpen(collapsed, 'main', '', matched), false);
    assert.equal(isSectionOpen(collapsed, 'mizzen', '', matched), true);
});
