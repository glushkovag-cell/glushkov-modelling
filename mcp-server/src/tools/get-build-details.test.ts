import { afterEach, describe, expect, it, vi } from "vitest";

// config.ts читает окружение при импорте; значения нужны до загрузки server.ts.
process.env.MCP_API_KEY = "test-key";
process.env.WP_GRAPHQL_URL = "https://cms.example.test/graphql";
process.env.CMS_GALLERY_URL = "https://cms.example.test/gallery";

const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const { createMcpServer } = await import("../server.js");
const { normalizeModelMeasurements } = await import("../lib/model-measurements.js");

/** Ответ резолвера в порядке, который задаёт WordPress (group, sort orders, code, target). */
const BLUENOSE_MEASUREMENTS = [
    {
        code: "hull_width",
        label: "Hull width",
        description: "Widest point of the hull, excluding wales.",
        group: "hull",
        valueMm: 130,
        target: null,
        note: null,
    },
    {
        code: "overall_length",
        label: "Overall length",
        description: "Including bowsprit and boom; excluding the stand.",
        group: "overall",
        valueMm: 832,
        target: null,
        note: null,
    },
    {
        code: "mast_diameter",
        label: "Mast diameter",
        description: "At the deck.",
        group: "rig",
        valueMm: 8.25,
        target: { kind: "mast", id: "fore_mast", label: "Foremast" },
        note: "Measured with calipers",
    },
    {
        code: "mast_diameter",
        label: "Mast diameter",
        description: "At the deck.",
        group: "rig",
        valueMm: 9,
        target: { kind: "mast", id: "main_mast", label: "Mainmast" },
        note: null,
    },
];

const MODELS = [
    {
        id: "cG9zdDoxMDgz",
        slug: "bluenose",
        title: "Bluenose",
        modelinfo: {
            manufacturer: "Model Shipways",
            modelscale: "1:64",
            modellength: "832",
            buildstatus: ["Done"],
        },
    },
    {
        id: "cG9zdDoxMDg0",
        slug: "empty-model",
        title: "Empty Model",
        modelinfo: { modellength: null, buildstatus: ["In progress"] },
    },
];

type MeasurementsReply =
    | { data: unknown }
    | { errors: Array<{ message: string }>; data?: unknown };

function stubWordPress(measurementsBySlug: Record<string, MeasurementsReply>) {
    const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];

    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        calls.push({ query: body.query, variables: body.variables ?? {} });

        let payload: unknown;
        if (body.query.includes("GetAllModels")) {
            payload = {
                data: {
                    models: {
                        nodes: MODELS,
                        pageInfo: { hasNextPage: false, endCursor: null },
                    },
                },
            };
        } else if (body.query.includes("GetBuildPartsByModel")) {
            payload = {
                data: {
                    posts: {
                        nodes: [
                            {
                                id: "p1",
                                slug: "bluenose-part-1",
                                title: "Part 1",
                                content: "<p>Keel</p>",
                                buildlog: { modelslug: "bluenose", partnumber: "1" },
                            },
                        ],
                        pageInfo: { hasNextPage: false, endCursor: null },
                    },
                },
            };
        } else if (body.query.includes("GetModelMeasurements")) {
            payload = measurementsBySlug[String(body.variables?.slug)] ?? {
                data: { model: null },
            };
        } else {
            throw new Error(`Unexpected query: ${body.query}`);
        }

        return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    });

    vi.stubGlobal("fetch", fetchMock);
    return calls;
}

async function connect() {
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "build-details-test", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return {
        client,
        close: async () => {
            await client.close();
            await server.close();
        },
    };
}

function parse(result: any): any {
    return JSON.parse(String(result.content?.[0]?.text ?? "null"));
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("get_build_details measurements", () => {
    it("returns the GraphQL measurements unchanged and keeps modelLength", async () => {
        stubWordPress({
            bluenose: { data: { model: { measurements: BLUENOSE_MEASUREMENTS } } },
        });
        const { client, close } = await connect();

        const result = await client.callTool({
            name: "get_build_details",
            arguments: { buildName: "Bluenose" },
        });

        expect(result.isError).toBeFalsy();
        const body = parse(result);
        // Тот же порядок, значения, подписи, target и note, что отдаёт GraphQL (и видит Astro).
        expect(body.measurements).toEqual(BLUENOSE_MEASUREMENTS);
        expect(body.measurements[2].valueMm).toBe(8.25);
        expect(body).not.toHaveProperty("measurementsError");
        // Совместимость: старое строковое поле не меняет источник и тип.
        expect(body.modelLength).toBe("832");
        expect(body.scale).toBe("1:64");
        expect(body.totalBuildLogParts).toBe(1);

        await close();
    });

    it("returns an empty list, not invented zeros, when nothing is recorded", async () => {
        stubWordPress({
            "empty-model": { data: { model: { measurements: [] } } },
        });
        const { client, close } = await connect();

        const body = parse(
            await client.callTool({
                name: "get_build_details",
                arguments: { buildName: "Empty Model" },
            }),
        );

        expect(body.measurements).toEqual([]);
        expect(body).not.toHaveProperty("measurementsError");
        expect(body.modelLength).toBeNull();

        await close();
    });

    it("reports a measurements field error without substituting data", async () => {
        stubWordPress({
            bluenose: {
                errors: [{ message: "Measurement definition broken_code is not found." }],
                data: { model: { measurements: null } },
            },
        });
        const { client, close } = await connect();

        const result = await client.callTool({
            name: "get_build_details",
            arguments: { buildName: "Bluenose" },
        });

        expect(result.isError).toBeFalsy();
        const body = parse(result);
        expect(body.measurements).toBeNull();
        expect(typeof body.measurementsError).toBe("string");
        expect(body.measurementsError.length).toBeGreaterThan(0);
        // Остальные данные модели по-прежнему возвращаются.
        expect(body.title).toBe("Bluenose");
        expect(body.modelLength).toBe("832");

        await close();
    });

    it("reports inaccessible measurements (null) explicitly", async () => {
        stubWordPress({ bluenose: { data: { model: { measurements: null } } } });
        const { client, close } = await connect();

        const body = parse(
            await client.callTool({
                name: "get_build_details",
                arguments: { buildName: "Bluenose" },
            }),
        );

        expect(body.measurements).toBeNull();
        expect(body.measurementsError).toContain("not available");

        await close();
    });

    it("does not request measurements for a single build-log part", async () => {
        const calls = stubWordPress({});
        const { client, close } = await connect();

        const body = parse(
            await client.callTool({
                name: "get_build_details",
                arguments: { buildName: "Bluenose", partNumber: 1 },
            }),
        );

        expect(body.part.slug).toBe("bluenose-part-1");
        expect(body).not.toHaveProperty("measurements");
        expect(calls.some((call) => call.query.includes("GetModelMeasurements"))).toBe(false);

        await close();
    });

    it("does not add MCP tools", async () => {
        const { client, close } = await connect();
        const { tools } = await client.listTools();

        expect(tools).toHaveLength(16);
        const details = tools.find((tool) => tool.name === "get_build_details");
        expect(details?.description).toContain("measurements");
        expect(details?.description).toContain("modelLength");

        await close();
    });
});

describe("normalizeModelMeasurements", () => {
    it("keeps order, fractions, null target and null note", () => {
        expect(normalizeModelMeasurements(BLUENOSE_MEASUREMENTS)).toEqual(
            BLUENOSE_MEASUREMENTS,
        );
    });

    it("maps a missing note to null", () => {
        const [item] = normalizeModelMeasurements([
            { ...BLUENOSE_MEASUREMENTS[0], note: undefined },
        ]);
        expect(item.note).toBeNull();
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, "8"])(
        "rejects invalid valueMm %s instead of substituting it",
        (valueMm) => {
            expect(() =>
                normalizeModelMeasurements([
                    { ...BLUENOSE_MEASUREMENTS[0], valueMm },
                ]),
            ).toThrow(/valueMm/);
        },
    );

    it("rejects a partial target", () => {
        expect(() =>
            normalizeModelMeasurements([
                {
                    ...BLUENOSE_MEASUREMENTS[2],
                    target: { kind: "mast", id: "", label: "Foremast" },
                },
            ]),
        ).toThrow(/target\.id/);
    });
});
