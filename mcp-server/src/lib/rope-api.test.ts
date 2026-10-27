import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// config.ts читает окружение при импорте, поэтому переменные выставляются до
// динамического импорта модуля.
process.env.MCP_API_KEY = "test-key";
process.env.WP_GRAPHQL_URL = "https://cms.example.test/graphql";
process.env.CMS_GALLERY_URL = "https://cms.example.test/gallery";
process.env.ROPE_API_BASE_URL = "https://api.example.test/";

const { calculateRope, findRopeThreads, RopeApiError } = await import("./rope-api.js");

const forwardResponse = {
    apiVersion: "1",
    algorithmVersion: "1.0.0",
    catalogVersion: "40dc45531758",
    fetchedAt: "2026-10-27T06:00:00.000Z",
    basis: "catalog",
    input: { threadId: "tera-40", dtex: 750, threadsPerStrand: 2 },
    result: {
        diameterMm: 0.9631868577202545,
        threadsPerStrand: 2,
        strands: 3,
        construction: "2 × 3",
    },
};

const reverseResponse = {
    apiVersion: "1",
    algorithmVersion: "1.0.0",
    catalogVersion: "40dc45531758",
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
            diameterMm: 0.9806440349690794,
            deviationPercent: -1.935596503092063,
        },
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
            diameterMm: 0.9631868577202545,
            construction: "2 × 3",
            catalogVersion: "40dc45531758",
        });
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
