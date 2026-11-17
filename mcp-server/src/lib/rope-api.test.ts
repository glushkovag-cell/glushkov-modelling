import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// config.ts читает окружение при импорте, поэтому переменные выставляются до
// динамического импорта модуля.
process.env.MCP_API_KEY = "test-key";
process.env.WP_GRAPHQL_URL = "https://cms.example.test/graphql";
process.env.CMS_GALLERY_URL = "https://cms.example.test/gallery";
process.env.ROPE_API_BASE_URL = "https://api.example.test/";

const { calculateRope, findRopeThreads, listRopeThreads, RopeApiError, roundTo } = await import("./rope-api.js");

const forwardResponse = {
    apiVersion: "1",
    algorithmVersion: "2.0.0",
    catalogVersion: "0b24290aff0e",
    fetchedAt: "2026-10-27T06:00:00.000Z",
    basis: "catalog",
    input: { threadId: "tera-40", dtex: 750, threadsPerStrand: 2 },
    result: {
        diameterMm: 0.9842333087830643,
        threadsPerStrand: 2,
        strands: 3,
        construction: "2 × 3",
    },
};

const reverseResponse = {
    apiVersion: "1",
    algorithmVersion: "2.0.0",
    catalogVersion: "0b24290aff0e",
    fetchedAt: "2026-10-27T06:00:00.000Z",
    input: { targetDiameterMm: 1, tolerance: 0.15, threadIds: null },
    results: [
        {
            threadId: "tera-60",
            brand: "Tera",
            number: "60",
            dtex: 500,
            threadsPerStrand: 3,
            construction: "3 × 3",
            diameterMm: 0.987149903754157,
            deviationPercent: -1.285009624584299,
        },
    ],
};

const catalogResponse = {
    apiVersion: "1",
    algorithmVersion: "2.0.0",
    catalogVersion: "0b24290aff0e",
    fetchedAt: "2026-10-27T06:00:00.000Z",
    threads: [
        { threadId: "mara-220", brand: "Mara", number: "220", dtex: 130, sortOrder: 101, enabled: true },
        { threadId: "tera-40", brand: "Tera", number: "40", dtex: 750, sortOrder: 304, enabled: true },
    ],
};

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

const fetchMock = vi.fn();

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("calculateRope", () => {
    it("sends a catalog calculation to the worker and maps the result", async () => {
        fetchMock.mockResolvedValue(jsonResponse(forwardResponse));

        const result = await calculateRope({
            basis: "catalog",
            threadId: "tera-40",
            threadsPerStrand: 2,
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://api.example.test/api/rope/v1/forward");
        expect(init.method).toBe("POST");
        expect(JSON.parse(String(init.body))).toEqual({
            basis: "catalog",
            threadId: "tera-40",
            threadsPerStrand: 2,
        });

        expect(result).toMatchObject({
            basis: "catalog",
            threadId: "tera-40",
            dtex: 750,
            diameterMm: 0.984,
            construction: "2 × 3",
            catalogVersion: "0b24290aff0e",
        });
        expect(result).not.toHaveProperty("loadMode");
        expect(result).not.toHaveProperty("warnings");
    });

    it("sends a custom dTex calculation without a thread id", async () => {
        fetchMock.mockResolvedValue(
            jsonResponse({
                ...forwardResponse,
                basis: "dtex",
                catalogVersion: null,
                input: { dtex: 750, threadsPerStrand: 2 },
            }),
        );

        const result = await calculateRope({ basis: "dtex", dtex: 750, threadsPerStrand: 2 });

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(String(init.body))).toEqual({
            basis: "dtex",
            dtex: 750,
            threadsPerStrand: 2,
        });
        expect(result.threadId).toBeNull();
        expect(result.catalogVersion).toBeNull();
    });

    it("surfaces the API error code and message", async () => {
        fetchMock.mockResolvedValue(
            jsonResponse(
                { error: { code: "INVALID_PARAMS", message: "dtex must be between 80 and 6000." } },
                422,
            ),
        );

        await expect(
            calculateRope({ basis: "dtex", dtex: 10, threadsPerStrand: 2 }),
        ).rejects.toMatchObject({
            code: "INVALID_PARAMS",
            status: 422,
            message: "dtex must be between 80 and 6000.",
        });
    });

    it("maps an unavailable catalog to CATALOG_UNAVAILABLE", async () => {
        fetchMock.mockResolvedValue(
            jsonResponse({ error: { code: "CATALOG_UNAVAILABLE", message: "CMS is down." } }, 503),
        );

        await expect(
            calculateRope({ basis: "catalog", threadId: "tera-40", threadsPerStrand: 2 }),
        ).rejects.toMatchObject({ code: "CATALOG_UNAVAILABLE", status: 503 });
    });

    it("rejects a non-JSON response", async () => {
        fetchMock.mockResolvedValue(new Response("oops", { status: 200 }));

        await expect(
            calculateRope({ basis: "dtex", dtex: 750, threadsPerStrand: 2 }),
        ).rejects.toMatchObject({ code: "BAD_RESPONSE" });
    });

    it("maps a network failure to NETWORK_ERROR", async () => {
        fetchMock.mockRejectedValue(new Error("socket hang up"));

        await expect(
            calculateRope({ basis: "dtex", dtex: 750, threadsPerStrand: 2 }),
        ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    });

    it("throws RopeApiError instances", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ error: { code: "THREAD_NOT_FOUND", message: "nope" } }, 422));

        await expect(
            calculateRope({ basis: "catalog", threadId: "nope", threadsPerStrand: 2 }),
        ).rejects.toBeInstanceOf(RopeApiError);
    });
});

describe("findRopeThreads", () => {
    it("maps tolerance to percent and counts matches", async () => {
        fetchMock.mockResolvedValue(jsonResponse(reverseResponse));

        const result = await findRopeThreads({ targetDiameterMm: 1 });

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://api.example.test/api/rope/v1/reverse");
        expect(JSON.parse(String(init.body))).toEqual({ targetDiameterMm: 1 });
        expect(result.tolerancePercent).toBe(15);
        expect(result.totalMatched).toBe(1);
        expect(result.results[0]?.threadId).toBe("tera-60");
        expect(result.results[0]?.diameterMm).toBe(0.987);
        expect(result.results[0]?.deviationPercent).toBe(-1.29);
        expect(result).not.toHaveProperty("loadMode");
    });

    it("passes an explicit thread list through", async () => {
        fetchMock.mockResolvedValue(jsonResponse(reverseResponse));

        await findRopeThreads({ targetDiameterMm: 1.5, threadIds: ["tera-40", "tera-60"] });

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(String(init.body))).toEqual({
            targetDiameterMm: 1.5,
            threadIds: ["tera-40", "tera-60"],
        });
    });

    it("returns an empty list when nothing matches", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ ...reverseResponse, results: [] }));

        const result = await findRopeThreads({ targetDiameterMm: 100 });

        expect(result.totalMatched).toBe(0);
        expect(result.results).toEqual([]);
    });
});

describe("listRopeThreads", () => {
    it("reads the catalog with GET and builds human-readable labels", async () => {
        fetchMock.mockResolvedValue(jsonResponse(catalogResponse));

        const result = await listRopeThreads();

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://api.example.test/api/rope/v1/catalog");
        expect(init.method).toBe("GET");

        expect(result.totalThreads).toBe(2);
        expect(result.catalogVersion).toBe("0b24290aff0e");
        expect(result.threads[0]).toEqual({
            threadId: "mara-220",
            brand: "Mara",
            number: "220",
            dtex: 130,
            sortOrder: 101,
            label: "Mara 220 — 130 dTex",
        });
    });

    it("maps an unavailable catalog to CATALOG_UNAVAILABLE", async () => {
        fetchMock.mockResolvedValue(
            jsonResponse({ error: { code: "CATALOG_UNAVAILABLE", message: "CMS is down." } }, 503),
        );

        await expect(listRopeThreads()).rejects.toMatchObject({
            code: "CATALOG_UNAVAILABLE",
            status: 503,
        });
    });
});

const VERSIONS_V2 = { apiVersion: "2", algorithmVersion: "3.0.0", loadRecommendationVersion: "1.0.0" };
const WARNINGS = [
    { code: "EMPIRICAL_MODEL", message: "Empirical model." },
    { code: "RECOMMENDED_LOAD_STARTING_SUGGESTION", message: "Starting suggestion." },
];

describe("rope API v2 via loadMode", () => {
    it("calls v2 forward in auto mode and returns load fields rounded to 3 decimals", async () => {
        fetchMock.mockResolvedValue(
            jsonResponse({
                ...VERSIONS_V2,
                catalogVersion: null,
                fetchedAt: null,
                basis: "dtex",
                input: { dtex: 80, threadsPerStrand: 2, loadMode: "auto", loadGrams: null },
                result: {
                    basis: "dtex", threadId: null, dtex: 80, threadsPerStrand: 2, strands: 3,
                    construction: "2 × 3", totalDtex: 480, loadMode: "auto",
                    recommendedLoadGrams: 150, appliedLoadGrams: 150, diameterMm: 0.24069446380613793,
                },
                warnings: WARNINGS,
            }),
        );

        const result = await calculateRope({ basis: "dtex", dtex: 80, threadsPerStrand: 2, loadMode: "auto" });

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://api.example.test/api/rope/v2/forward");
        expect(JSON.parse(String(init.body))).toEqual({ basis: "dtex", dtex: 80, threadsPerStrand: 2, loadMode: "auto" });
        expect(result).toEqual({
            basis: "dtex",
            threadId: null,
            dtex: 80,
            diameterMm: 0.241,
            threadsPerStrand: 2,
            strands: 3,
            construction: "2 × 3",
            catalogVersion: null,
            apiVersion: "2",
            algorithmVersion: "3.0.0",
            totalDtex: 480,
            loadMode: "auto",
            recommendedLoadGrams: 150,
            appliedLoadGrams: 150,
            loadRecommendationVersion: "1.0.0",
            warnings: WARNINGS,
        });
    });

    it("sends loadGrams in manual mode", async () => {
        fetchMock.mockResolvedValue(
            jsonResponse({
                ...VERSIONS_V2,
                catalogVersion: "0b24290aff0e",
                basis: "catalog",
                input: { threadId: "tera-40", dtex: 750, threadsPerStrand: 2, loadMode: "manual", loadGrams: 300 },
                result: {
                    threadsPerStrand: 2, strands: 3, construction: "2 × 3", totalDtex: 4500,
                    loadMode: "manual", recommendedLoadGrams: 300, appliedLoadGrams: 300,
                    diameterMm: 1.0182712421634583,
                },
                warnings: WARNINGS,
            }),
        );

        const result = await calculateRope({
            basis: "catalog", threadId: "tera-40", threadsPerStrand: 2, loadMode: "manual", loadGrams: 300,
        });

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(String(init.body))).toEqual({
            basis: "catalog", threadId: "tera-40", threadsPerStrand: 2, loadMode: "manual", loadGrams: 300,
        });
        expect(result.diameterMm).toBe(1.018);
        expect(result.appliedLoadGrams).toBe(300);
    });

    it("calls v2 reverse and rounds every match", async () => {
        fetchMock.mockResolvedValue(
            jsonResponse({
                ...VERSIONS_V2,
                catalogVersion: "0b24290aff0e",
                fetchedAt: "2026-11-17T06:00:00.000Z",
                input: { targetDiameterMm: 1, tolerance: 0.1, threadIds: null, loadMode: "manual", loadGrams: 200 },
                results: [
                    {
                        threadId: "tera-60", brand: "Tera", number: "60", dtex: 500, threadsPerStrand: 3,
                        construction: "3 × 3", totalDtex: 4500, loadMode: "manual",
                        recommendedLoadGrams: 300, appliedLoadGrams: 200,
                        diameterMm: 0.99995, deviationPercent: -0.004999,
                    },
                ],
                warnings: WARNINGS,
            }),
        );

        const result = await findRopeThreads({ targetDiameterMm: 1, loadMode: "manual", loadGrams: 200 });

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://api.example.test/api/rope/v2/reverse");
        expect(JSON.parse(String(init.body))).toEqual({ targetDiameterMm: 1, loadMode: "manual", loadGrams: 200 });
        expect(result.tolerancePercent).toBe(10);
        expect(result.loadMode).toBe("manual");
        expect(result.loadGrams).toBe(200);
        expect(result.loadRecommendationVersion).toBe("1.0.0");
        expect(result.warnings).toEqual(WARNINGS);
        const [match] = result.results;
        expect(match?.diameterMm).toBe(1);
        expect(Object.is(match?.deviationPercent, -0)).toBe(false);
        expect(match?.deviationPercent).toBe(0);
        expect(match?.appliedLoadGrams).toBe(200);
        expect(match?.recommendedLoadGrams).toBe(300);
    });

    it("auto reverse sends only loadMode", async () => {
        fetchMock.mockResolvedValue(
            jsonResponse({
                ...VERSIONS_V2,
                catalogVersion: "0b24290aff0e",
                input: { targetDiameterMm: 1, tolerance: 0.1, threadIds: ["tera-40"], loadMode: "auto", loadGrams: null },
                results: [],
                warnings: WARNINGS,
            }),
        );

        const result = await findRopeThreads({ targetDiameterMm: 1, threadIds: ["tera-40"], loadMode: "auto" });

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(String(init.body))).toEqual({ targetDiameterMm: 1, threadIds: ["tera-40"], loadMode: "auto" });
        expect(result.totalMatched).toBe(0);
        expect(result.loadGrams).toBeNull();
    });
});

describe("roundTo", () => {
    it("rounds and never returns -0", () => {
        expect(roundTo(0.24069446380613793, 3)).toBe(0.241);
        expect(roundTo(-1.285009624584299, 2)).toBe(-1.29);
        expect(Object.is(roundTo(-0.004, 2), -0)).toBe(false);
        expect(roundTo(-0.004, 2)).toBe(0);
        expect(roundTo(9.9999, 3)).toBe(10);
    });
});
