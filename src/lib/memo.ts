/**
 * memo.ts
 *
 * Request-level memoization for build-time and SSR data access.
 *
 * The build asks the CMS for the same documents dozens of times (news on every
 * page, the model catalogue from every /builds page, every gallery manifest
 * twice), and the SSR /tutorials page repeats four queries on every hit. This
 * helper deduplicates identical in-flight calls, caches the resolved value for
 * a TTL, and never caches a rejection.
 */

export interface MemoizeOptions {
    /** Entry lifetime. 0 means "for the lifetime of the process" (default). */
    ttlMs?: number;
    /** Upper bound on cached keys; the oldest entry is evicted first. */
    maxEntries?: number;
    /** Injection point for tests. */
    now?: () => number;
}

export interface Memoized<Args extends unknown[], Result> {
    (...args: Args): Promise<Result>;
    clear: () => void;
    size: () => number;
}

interface Entry<Result> {
    promise: Promise<Result>;
    expiresAt: number;
}

export function memoizeAsync<Args extends unknown[], Result>(
    loader: (...args: Args) => Promise<Result>,
    options: MemoizeOptions = {},
): Memoized<Args, Result> {
    const ttlMs = Math.max(0, options.ttlMs ?? 0);
    const maxEntries = Math.max(1, options.maxEntries ?? 200);
    const now = options.now ?? Date.now;
    const entries = new Map<string, Entry<Result>>();

    const memoized = (...args: Args): Promise<Result> => {
        const key = JSON.stringify(args);
        const cached = entries.get(key);

        if (cached) {
            if (ttlMs === 0 || cached.expiresAt > now()) {
                return cached.promise;
            }

            entries.delete(key);
        }

        const promise = (async () => loader(...args))().catch((error: unknown) => {
            // A failure must not be cached: the next call should retry.
            entries.delete(key);
            throw error;
        });

        entries.set(key, {
            promise,
            expiresAt: ttlMs === 0 ? Number.POSITIVE_INFINITY : now() + ttlMs,
        });

        while (entries.size > maxEntries) {
            const oldest = entries.keys().next().value;

            if (oldest === undefined) {
                break;
            }

            entries.delete(oldest);
        }

        return promise;
    };

    return Object.assign(memoized, {
        clear: () => entries.clear(),
        size: () => entries.size,
    });
}
