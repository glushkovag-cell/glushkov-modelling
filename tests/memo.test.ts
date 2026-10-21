import test from 'node:test';
import assert from 'node:assert/strict';

import { memoizeAsync } from '../src/lib/memo.ts';

test('loads once and reuses the cached promise', async () => {
    let calls = 0;
    const load = memoizeAsync(async (id: string) => {
        calls += 1;
        return `value:${id}`;
    });

    assert.equal(await load('a'), 'value:a');
    assert.equal(await load('a'), 'value:a');
    assert.equal(calls, 1);
});

test('deduplicates concurrent calls for the same key', async () => {
    let calls = 0;
    const load = memoizeAsync(async (id: string) => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return id;
    });

    const results = await Promise.all([load('a'), load('a'), load('a')]);

    assert.deepEqual(results, ['a', 'a', 'a']);
    assert.equal(calls, 1);
});

test('keys by every argument', async () => {
    const load = memoizeAsync(async (a: string, b: number) => `${a}:${b}`);

    assert.equal(await load('x', 1), 'x:1');
    assert.equal(await load('x', 2), 'x:2');
    assert.equal(load.size(), 2);
});

test('does not cache rejections', async () => {
    let calls = 0;
    const load = memoizeAsync(async () => {
        calls += 1;

        if (calls === 1) {
            throw new Error('transient');
        }

        return 'ok';
    });

    await assert.rejects(load(), /transient/);
    assert.equal(await load(), 'ok');
    assert.equal(calls, 2);
});

test('expires entries after the TTL', async () => {
    let clock = 1_000;
    let calls = 0;
    const load = memoizeAsync(
        async () => {
            calls += 1;
            return calls;
        },
        { ttlMs: 100, now: () => clock },
    );

    assert.equal(await load(), 1);
    clock = 1_050;
    assert.equal(await load(), 1);
    clock = 1_101;
    assert.equal(await load(), 2);
});

test('keeps entries forever when the TTL is zero', async () => {
    let clock = 1_000;
    let calls = 0;
    const load = memoizeAsync(
        async () => {
            calls += 1;
            return calls;
        },
        { now: () => clock },
    );

    await load();
    clock += 10_000_000;
    await load();

    assert.equal(calls, 1);
});

test('evicts the oldest entry when the limit is reached', async () => {
    const load = memoizeAsync(
        async (id: string) => id,
        { maxEntries: 2 },
    );

    await load('a');
    await load('b');
    await load('c');

    assert.equal(load.size(), 2);
});

test('clear drops every entry', async () => {
    let calls = 0;
    const load = memoizeAsync(async () => {
        calls += 1;
        return calls;
    });

    await load();
    load.clear();
    await load();

    assert.equal(calls, 2);
});
