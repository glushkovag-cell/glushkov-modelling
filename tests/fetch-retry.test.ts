import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchWithRetry, isRetryableStatus, type RetryInfo } from '../src/lib/fetch-retry.ts';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

/** fetch stub that walks through the given steps and records calls. */
function sequenceFetch(steps: Array<() => Response>) {
    const init: Array<RequestInit | undefined> = [];

    const fetchImpl = (async (_input: string, options?: RequestInit) => {
        const step = steps[Math.min(init.length, steps.length - 1)]!;
        init.push(options);
        return step();
    }) as typeof fetch;

    return { fetchImpl, init };
}

const noSleep = async () => undefined;

function recorder() {
    const retries: RetryInfo[] = [];
    return { retries, onRetry: (info: RetryInfo) => retries.push(info) };
}

test('returns the first successful response without retrying', async () => {
    const { fetchImpl, init } = sequenceFetch([() => jsonResponse({ ok: true })]);
    const { retries, onRetry } = recorder();

    const response = await fetchWithRetry('https://cms.test/graphql', {}, {
        fetchImpl,
        sleep: noSleep,
        onRetry,
    });

    assert.equal(response.status, 200);
    assert.equal(init.length, 1);
    assert.equal(retries.length, 0);
});

test('retries a 503 response and returns the next success', async () => {
    const { fetchImpl, init } = sequenceFetch([
        () => jsonResponse({ error: 'unavailable' }, 503),
        () => jsonResponse({ ok: true }),
    ]);
    const { retries, onRetry } = recorder();

    const response = await fetchWithRetry('https://cms.test/graphql', {}, {
        fetchImpl,
        sleep: noSleep,
        onRetry,
    });

    assert.equal(response.status, 200);
    assert.equal(init.length, 2);
    assert.equal(retries.length, 1);
    assert.match(retries[0]!.reason, /503/);
    assert.equal(retries[0]!.delayMs, 300);
});

test('retries a rate-limited (429) response', async () => {
    const { fetchImpl, init } = sequenceFetch([
        () => jsonResponse({ error: 'slow down' }, 429),
        () => jsonResponse({ ok: true }),
    ]);

    const response = await fetchWithRetry('https://cms.test/graphql', {}, {
        fetchImpl,
        sleep: noSleep,
        onRetry: () => undefined,
    });

    assert.equal(response.status, 200);
    assert.equal(init.length, 2);
});

test('returns a client error without retrying', async () => {
    const { fetchImpl, init } = sequenceFetch([() => jsonResponse({ error: 'bad' }, 404)]);
    const { retries, onRetry } = recorder();

    const response = await fetchWithRetry('https://cms.test/graphql', {}, {
        fetchImpl,
        sleep: noSleep,
        onRetry,
    });

    assert.equal(response.status, 404);
    assert.equal(init.length, 1);
    assert.equal(retries.length, 0);
});

test('returns the last retryable response once attempts are exhausted', async () => {
    const { fetchImpl, init } = sequenceFetch([() => jsonResponse({ error: 'down' }, 503)]);
    const { retries, onRetry } = recorder();

    const response = await fetchWithRetry('https://cms.test/graphql', {}, {
        attempts: 3,
        fetchImpl,
        sleep: noSleep,
        onRetry,
    });

    assert.equal(response.status, 503);
    assert.equal(init.length, 3);
    assert.deepEqual(retries.map((info) => info.delayMs), [300, 600]);
});

test('retries a network error and then succeeds', async () => {
    const { fetchImpl, init } = sequenceFetch([
        () => {
            throw new TypeError('fetch failed');
        },
        () => jsonResponse({ ok: true }),
    ]);
    const { retries, onRetry } = recorder();

    const response = await fetchWithRetry('https://cms.test/graphql', {}, {
        fetchImpl,
        sleep: noSleep,
        onRetry,
    });

    assert.equal(response.status, 200);
    assert.equal(init.length, 2);
    assert.match(retries[0]!.reason, /TypeError: fetch failed/);
});

test('throws the last network error once attempts are exhausted', async () => {
    const { fetchImpl, init } = sequenceFetch([
        () => {
            throw new TypeError('fetch failed');
        },
    ]);

    await assert.rejects(
        fetchWithRetry('https://cms.test/graphql', {}, {
            attempts: 3,
            fetchImpl,
            sleep: noSleep,
            onRetry: () => undefined,
        }),
        /fetch failed/,
    );

    assert.equal(init.length, 3);
});

test('stops immediately when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    let calls = 0;
    const fetchImpl = (async () => {
        calls += 1;
        throw new DOMException('aborted', 'AbortError');
    }) as typeof fetch;

    await assert.rejects(
        fetchWithRetry('https://cms.test/graphql', { signal: controller.signal }, {
            fetchImpl,
            sleep: noSleep,
            onRetry: () => undefined,
        }),
        (error: unknown) => error instanceof Error && error.name === 'AbortError',
    );

    assert.equal(calls, 1);
});

test('times out a hanging request and reports a TimeoutError', async () => {
    let calls = 0;

    const fetchImpl = ((_input: string, options?: RequestInit) => {
        calls += 1;

        return new Promise<Response>((_resolve, reject) => {
            // AbortSignal.timeout() uses an unref'd timer, so keep the event
            // loop alive while the abort is pending.
            const guard = setTimeout(
                () => reject(new Error('the timeout signal never fired')),
                1_000,
            );

            options?.signal?.addEventListener(
                'abort',
                () => {
                    clearTimeout(guard);
                    reject(options.signal!.reason);
                },
                { once: true },
            );
        });
    }) as typeof fetch;

    await assert.rejects(
        fetchWithRetry('https://cms.test/graphql', {}, {
            attempts: 2,
            timeoutMs: 15,
            fetchImpl,
            sleep: noSleep,
            onRetry: () => undefined,
        }),
        (error: unknown) => error instanceof Error && error.name === 'TimeoutError',
    );

    assert.equal(calls, 2);
});

test('caps the exponential backoff', async () => {
    const { fetchImpl } = sequenceFetch([() => jsonResponse({ error: 'down' }, 500)]);
    const { retries, onRetry } = recorder();

    await fetchWithRetry('https://cms.test/graphql', {}, {
        attempts: 3,
        baseDelayMs: 1_000,
        maxDelayMs: 1_200,
        fetchImpl,
        sleep: noSleep,
        onRetry,
    });

    assert.deepEqual(retries.map((info) => info.delayMs), [1_000, 1_200]);
});

test('isRetryableStatus covers transient and client statuses', () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504, 522]) {
        assert.equal(isRetryableStatus(status), true, `status ${status}`);
    }

    for (const status of [200, 301, 400, 401, 403, 404, 422]) {
        assert.equal(isRetryableStatus(status), false, `status ${status}`);
    }
});
