import test from 'node:test';
import assert from 'node:assert/strict';

import { collectAllPages, type WpConnection } from '../src/lib/wp-pagination.ts';

interface Row {
    id: string;
}

function page(ids: string[], pageInfo?: WpConnection<Row>['pageInfo']): WpConnection<Row> {
    return { nodes: ids.map((id) => ({ id })), pageInfo };
}

test('returns a single page without following a cursor', async () => {
    const calls: Array<{ first: number; after: string | null }> = [];

    const rows = await collectAllPages<Row>(async (variables) => {
        calls.push(variables);
        return page(['a', 'b'], { hasNextPage: false, endCursor: null });
    });

    assert.deepEqual(rows.map((row) => row.id), ['a', 'b']);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { first: 100, after: null });
});

test('follows the cursor chain and concatenates every page', async () => {
    const calls: Array<{ first: number; after: string | null }> = [];
    const pages = [
        page(['a', 'b'], { hasNextPage: true, endCursor: 'cursor-1' }),
        page(['c'], { hasNextPage: true, endCursor: 'cursor-2' }),
        page(['d'], { hasNextPage: false, endCursor: null }),
    ];

    const rows = await collectAllPages<Row>(async (variables) => {
        calls.push(variables);
        return pages[calls.length - 1]!;
    });

    assert.deepEqual(rows.map((row) => row.id), ['a', 'b', 'c', 'd']);
    assert.deepEqual(calls.map((call) => call.after), [null, 'cursor-1', 'cursor-2']);
});

test('returns an empty array for an empty connection', async () => {
    const rows = await collectAllPages<Row>(async () => ({
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
    }));

    assert.deepEqual(rows, []);
});

test('treats a missing pageInfo as the last page', async () => {
    const rows = await collectAllPages<Row>(async () => page(['a']));

    assert.deepEqual(rows.map((row) => row.id), ['a']);
});

test('stops and warns when the cursor does not advance', async () => {
    const warnings: string[] = [];

    const rows = await collectAllPages<Row>(
        async () => page(['a'], { hasNextPage: true, endCursor: 'same' }),
        { warn: (message) => warnings.push(message) },
    );

    assert.deepEqual(rows.map((row) => row.id), ['a', 'a']);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /cursor did not advance/);
});

test('stops and warns when the page budget is exhausted', async () => {
    const warnings: string[] = [];
    let pageNumber = 0;

    const rows = await collectAllPages<Row>(
        async () => {
            pageNumber += 1;
            return page([`p${pageNumber}`], {
                hasNextPage: true,
                endCursor: `cursor-${pageNumber}`,
            });
        },
        { maxPages: 3, warn: (message) => warnings.push(message) },
    );

    assert.deepEqual(rows.map((row) => row.id), ['p1', 'p2', 'p3']);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /stopped after 3 pages/);
});

test('passes the requested page size and clamps it to the WPGraphQL limit', async () => {
    const sizes: number[] = [];

    await collectAllPages<Row>(
        async ({ first }) => {
            sizes.push(first);
            return page([], { hasNextPage: false, endCursor: null });
        },
        { pageSize: 500 },
    );

    assert.deepEqual(sizes, [100]);
});
