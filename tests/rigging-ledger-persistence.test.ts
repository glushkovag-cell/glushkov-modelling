import test from 'node:test';
import assert from 'node:assert/strict';

import { initialLedgerState, type LedgerState } from '../src/lib/rigging/ledgerState.ts';
import {
    LEDGER_STORAGE_KEY,
    clearLedgerState,
    loadLedgerState,
    saveLedgerState,
    type LedgerStorage,
} from '../src/lib/rigging/ledgerPersistence.ts';

class MemoryStorage implements LedgerStorage {
    readonly values = new Map<string, string>();
    failReads = false;
    failWrites = false;

    getItem(key: string): string | null {
        if (this.failReads) throw new Error('read denied');
        return this.values.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
        if (this.failWrites) throw new Error('write denied');
        this.values.set(key, value);
    }

    removeItem(key: string): void {
        this.values.delete(key);
    }
}

function storedState(): LedgerState {
    return {
        ...initialLedgerState(),
        mode: 'flat',
        filters: {
            node: 'fore',
            tier: 'topmast',
            type: 'standing',
            status: 'unsupported',
        },
        query: 'ванты',
        sort: 'diameter-desc',
        showNotApplicable: true,
        exportScope: 'selection',
        collapsedNodes: new Set(['fore', 'bowsprit']),
    };
}

test('ledger view round-trips through storage', () => {
    const storage = new MemoryStorage();
    const state = storedState();

    saveLedgerState(state, storage);
    const loaded = loadLedgerState(storage);

    assert.ok(loaded);
    assert.equal(loaded.mode, state.mode);
    assert.deepEqual(loaded.filters, state.filters);
    assert.equal(loaded.query, state.query);
    assert.equal(loaded.sort, state.sort);
    assert.equal(loaded.showNotApplicable, state.showNotApplicable);
    assert.equal(loaded.exportScope, state.exportScope);
    assert.deepEqual([...loaded.collapsedNodes].sort(), ['bowsprit', 'fore']);
});

test('missing, malformed and version-mismatched state is ignored', () => {
    const storage = new MemoryStorage();
    assert.equal(loadLedgerState(storage), null);
    assert.equal(loadLedgerState(null), null);

    storage.setItem(LEDGER_STORAGE_KEY, '{not json');
    assert.equal(loadLedgerState(storage), null);

    storage.setItem(
        LEDGER_STORAGE_KEY,
        JSON.stringify({ version: 999, mode: 'flat', filters: {} }),
    );
    assert.equal(loadLedgerState(storage), null);

    storage.setItem(LEDGER_STORAGE_KEY, JSON.stringify({ version: 1 }));
    const loaded = loadLedgerState(storage);
    assert.ok(loaded);
    assert.equal(loaded.mode, 'grouped');
    assert.equal(loaded.query, '');
    assert.equal(loaded.exportScope, 'all');
});

test('unknown stored values fall back to safe defaults', () => {
    const storage = new MemoryStorage();
    storage.setItem(
        LEDGER_STORAGE_KEY,
        JSON.stringify({
            version: 1,
            mode: 'weird',
            filters: { node: '', tier: 'bogus', type: 'bogus', status: 'bogus' },
            query: 42,
            sort: 'bogus',
            showNotApplicable: 'yes',
            exportScope: 'everything',
            collapsedNodes: ['fore', 7, null],
        }),
    );

    const loaded = loadLedgerState(storage);
    assert.ok(loaded);
    assert.equal(loaded.mode, 'grouped');
    assert.deepEqual(loaded.filters, {
        node: 'all',
        tier: 'all',
        type: 'all',
        status: 'all',
    });
    assert.equal(loaded.query, '');
    assert.equal(loaded.sort, 'profile');
    assert.equal(loaded.showNotApplicable, false);
    assert.equal(loaded.exportScope, 'all');
    assert.deepEqual([...loaded.collapsedNodes], ['fore']);
});

test('storage failures never break the view', () => {
    const storage = new MemoryStorage();
    storage.failReads = true;
    assert.equal(loadLedgerState(storage), null);

    storage.failReads = false;
    storage.failWrites = true;
    assert.doesNotThrow(() => saveLedgerState(initialLedgerState(), storage));

    assert.doesNotThrow(() => clearLedgerState(null));
    assert.doesNotThrow(() => clearLedgerState(storage));
});

test('clear removes the stored view', () => {
    const storage = new MemoryStorage();
    saveLedgerState(storedState(), storage);
    assert.ok(storage.values.has(LEDGER_STORAGE_KEY));

    clearLedgerState(storage);
    assert.equal(loadLedgerState(storage), null);
});
