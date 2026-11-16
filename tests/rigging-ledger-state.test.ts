/**
 * Тесты состояния просмотра: независимые фильтры, сброс несовместимого
 * яруса, переключатель неприменимых строк, режим и раскрытие секций.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildInput } from '../src/lib/rigging/settings.ts';
import { calculate } from '../src/lib/rigging/calculate.ts';
import { buildLedgerRows } from '../src/lib/rigging/ledgerView.ts';
import {
    clearFilters,
    initialLedgerState,
    reconcileState,
    setAllSections,
    setMode,
    setNode,
    setQuery,
    setShowNotApplicable,
    setSort,
    setStatus,
    setTier,
    tierFilterDisabled,
    tierFilterNote,
    toggleSection,
} from '../src/lib/rigging/ledgerState.ts';
import { loadDocument } from './helpers/profiles.ts';
import { fullSettingsFor } from './helpers/control.ts';

const document = loadDocument('traditional_plant', '1.1.0');
const rows = buildLedgerRows(
    calculate(buildInput(fullSettingsFor(document)), document).results,
);

test('initial state is grouped, unfiltered and fully expanded', () => {
    const state = initialLedgerState();
    assert.equal(state.mode, 'grouped');
    assert.deepEqual(state.filters, {
        node: 'all',
        tier: 'all',
        type: 'all',
        status: 'all',
    });
    assert.equal(state.query, '');
    assert.equal(state.sort, 'profile');
    assert.equal(state.showNotApplicable, false);
    assert.equal(state.collapsedNodes.size, 0);
});

test('choosing a node keeps a compatible tier and resets an incompatible one with a notice', () => {
    const withTier = setTier(initialLedgerState(), 'topgallant', rows);
    const fore = setNode(withTier, 'fore', rows);
    assert.equal(fore.state.filters.node, 'fore');
    assert.equal(fore.state.filters.tier, 'topgallant');
    assert.equal(fore.notice, null);

    const bowsprit = setNode(withTier, 'bowsprit', rows);
    assert.equal(bowsprit.state.filters.node, 'bowsprit');
    assert.equal(bowsprit.state.filters.tier, 'all');
    assert.match(bowsprit.notice ?? '', /Topgallant is not available/);
    assert.match(bowsprit.notice ?? '', /Bowsprit & spars/);

    const backToAll = setNode(bowsprit.state, 'all', rows);
    assert.equal(backToAll.state.filters.node, 'all');
    assert.equal(backToAll.notice, null);
});

test('an unavailable tier cannot be selected for a node without tiers', () => {
    const bowsprit = setNode(initialLedgerState(), 'bowsprit', rows).state;
    const attempted = setTier(bowsprit, 'lower', rows);
    assert.equal(attempted.filters.tier, 'all');
    assert.equal(tierFilterDisabled(rows, 'bowsprit'), true);
    assert.match(tierFilterNote(rows, 'bowsprit'), /has no tiers/);
    assert.equal(tierFilterDisabled(rows, 'fore'), false);
    assert.equal(tierFilterNote(rows, 'fore'), '');
});

test('Not applicable status and the separate toggle stay in sync', () => {
    const na = setStatus(initialLedgerState(), 'not_applicable');
    assert.equal(na.filters.status, 'not_applicable');
    assert.equal(na.showNotApplicable, true);

    const hidden = setShowNotApplicable(na, false);
    assert.equal(hidden.showNotApplicable, false);
    assert.equal(hidden.filters.status, 'all');

    const shown = setShowNotApplicable(initialLedgerState(), true);
    assert.equal(shown.showNotApplicable, true);
    assert.equal(shown.filters.status, 'all');

    const calculated = setStatus(shown, 'calculated');
    assert.equal(calculated.filters.status, 'calculated');
    assert.equal(calculated.showNotApplicable, true, 'turning a status on must not hide NA rows');
});

test('mode, sort and filters are independent', () => {
    let state = setMode(initialLedgerState(), 'flat');
    state = setSort(state, 'diameter-desc');
    state = setNode(state, 'fore', rows).state;
    state = setStatus(state, 'calculated');
    state = setQuery(state, 'stay');

    assert.equal(state.mode, 'flat');
    assert.equal(state.sort, 'diameter-desc');
    assert.equal(state.filters.node, 'fore');
    assert.equal(state.filters.status, 'calculated');
    assert.equal(state.query, 'stay');

    const cleared = clearFilters(state);
    assert.deepEqual(cleared.filters, {
        node: 'all',
        tier: 'all',
        type: 'all',
        status: 'all',
    });
    assert.equal(cleared.query, '');
    assert.equal(cleared.showNotApplicable, false);
    assert.equal(cleared.mode, 'flat', 'Clear all must keep the view mode');
    assert.equal(cleared.sort, 'diameter-desc', 'Clear all must keep the sort');
});

test('sections collapse outside search and stay open for search matches', () => {
    const collapsed = toggleSection(initialLedgerState(), 'fore', false);
    assert.equal(collapsed.collapsedNodes.has('fore'), true);

    const duringSearch = toggleSection(collapsed, 'main', true);
    assert.equal(duringSearch.collapsedNodes.has('main'), false);

    const expandedAgain = toggleSection(collapsed, 'fore', false);
    assert.equal(expandedAgain.collapsedNodes.has('fore'), false);

    const allCollapsed = setAllSections(initialLedgerState(), false, ['fore', 'main']);
    assert.deepEqual([...allCollapsed.collapsedNodes].sort(), ['fore', 'main']);

    const allOpen = setAllSections(allCollapsed, true, ['fore', 'main']);
    assert.equal(allOpen.collapsedNodes.size, 0);
});

test('recalculation resets only filters that disappeared, with a notice', () => {
    const foreOnly = rows.filter((row) => row.nodeId === 'fore');
    const state = setNode(initialLedgerState(), 'bowsprit', rows).state;
    const result = reconcileState(state, foreOnly);

    assert.equal(result.state.filters.node, 'all');
    assert.equal(result.state.filters.tier, 'all');
    assert.match(result.notice ?? '', /Bowsprit & spars is not part of this calculation/);

    const unsupportedOnly = rows.filter((row) => row.result.status === 'unsupported');
    const statusState = setStatus(initialLedgerState(), 'calculated');
    const statusResult = reconcileState(statusState, unsupportedOnly);
    assert.equal(statusResult.state.filters.status, 'all');
    assert.match(statusResult.notice ?? '', /selected status is not present/);

    const standingOnly = rows.filter((row) => row.type === 'standing');
    const typeState = setStatus(initialLedgerState(), 'all');
    typeState.filters.type = 'running';
    const typeResult = reconcileState(typeState, standingOnly);
    assert.equal(typeResult.state.filters.type, 'all');
    assert.match(typeResult.notice ?? '', /selected rigging type is not present/);
});

test('recalculation keeps filters that still exist', () => {
    const state = setNode(setTier(initialLedgerState(), 'lower', rows), 'fore', rows).state;
    const result = reconcileState(state, rows);
    assert.equal(result.state.filters.node, 'fore');
    assert.equal(result.state.filters.tier, 'lower');
    assert.equal(result.notice, null);
});
