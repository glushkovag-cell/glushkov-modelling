/**
 * fetch-retry.ts
 *
 * `fetch` wrapper for build-time CMS access.
 *
 * The Astro build talks to WordPress and to the gallery host dozens of times
 * per run, and a single dropped connection used to fail the whole build (and
 * therefore the deploy). This helper adds a per-attempt timeout and retries
 * only transient failures: network errors, timeouts and 5xx/408/425/429
 * responses. Client errors (4xx other than the retryable ones) are returned
 * untouched so callers keep their existing error handling.
 *
 * The caller's abort signal is never overridden: an abort requested by the
 * caller stops the retry loop immediately.
 */

export interface RetryInfo {
    /** Attempt that just failed, 1-based. */
    attempt: number;
    /** Total attempts that will be made. */
    attempts: number;
    /** Backoff delay before the next attempt. */
    delayMs: number;
    /** Human-readable failure reason. */
    reason: string;
}

export interface FetchRetryOptions {
    /** Total attempts, including the first one. Default: 3. */
    attempts?: number;
    /** First backoff delay; doubles per attempt. Default: 300 ms. */
    baseDelayMs?: number;
    /** Backoff ceiling. Default: 3000 ms. */
    maxDelayMs?: number;
    /** Per-attempt timeout; 0 disables it. Default: 15000 ms. */
    timeoutMs?: number;
    /** Called before each retry; the default logs a warning. */
    onRetry?: (info: RetryInfo) => void;
    /** Injection point for tests. Default: global fetch. */
    fetchImpl?: typeof fetch;
    /** Injection point for tests. Default: setTimeout-based sleep. */
    sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE_STATUSES = new Set([408, 425, 429]);

export function isRetryableStatus(status: number): boolean {
    return RETRYABLE_STATUSES.has(status) || status >= 500;
}

function defaultSleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeError(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
    }

    return String(error);
}

function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
    return Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
}

export async function fetchWithRetry(
    input: string,
    init: RequestInit = {},
    options: FetchRetryOptions = {},
): Promise<Response> {
    const attempts = Math.max(1, options.attempts ?? 3);
    const baseDelayMs = Math.max(0, options.baseDelayMs ?? 300);
    const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 3_000);
    const timeoutMs = Math.max(0, options.timeoutMs ?? 15_000);
    const fetchImpl = options.fetchImpl ?? fetch;
    const sleep = options.sleep ?? defaultSleep;
    const onRetry = options.onRetry ?? ((info: RetryInfo) => {
        console.warn(
            `[fetch] ${info.reason}; attempt ${info.attempt}/${info.attempts}, ` +
            `retrying in ${info.delayMs} ms`,
        );
    });

    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const signals: AbortSignal[] = [];

        if (init.signal) {
            signals.push(init.signal);
        }

        if (timeoutMs > 0) {
            signals.push(AbortSignal.timeout(timeoutMs));
        }

        const signal = signals.length > 0 ? AbortSignal.any(signals) : undefined;

        try {
            const response = await fetchImpl(input, { ...init, signal });

            if (response.ok || !isRetryableStatus(response.status) || attempt === attempts) {
                return response;
            }

            // Release the socket before waiting for the next attempt.
            await response.body?.cancel().catch(() => undefined);

            const delayMs = backoffDelay(attempt, baseDelayMs, maxDelayMs);

            onRetry({
                attempt,
                attempts,
                delayMs,
                reason: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
            });

            await sleep(delayMs);
        } catch (error) {
            lastError = error;

            // The caller asked to stop: never retry that.
            if (init.signal?.aborted) {
                throw error;
            }

            if (attempt === attempts) {
                throw error;
            }

            const delayMs = backoffDelay(attempt, baseDelayMs, maxDelayMs);

            onRetry({
                attempt,
                attempts,
                delayMs,
                reason: describeError(error),
            });

            await sleep(delayMs);
        }
    }

    throw lastError ?? new Error('fetchWithRetry: no attempt was made');
}
