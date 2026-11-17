import { afterEach, describe, expect, it, vi } from "vitest";

// config.ts читает окружение при импорте; значения нужны до загрузки server.ts.
process.env.MCP_API_KEY = "test-key";
process.env.WP_GRAPHQL_URL = "https://cms.example.test/graphql";
process.env.CMS_GALLERY_URL = "https://cms.example.test/gallery";

const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const { createMcpServer } = await import("./server.js");

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("MCP server tools", () => {
    it("registers both rope calculator tools alongside the content tools", async () => {
        const server = createMcpServer();
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "rope-tools-test", version: "1.0.0" });

        await Promise.all([
            server.connect(serverTransport),
            client.connect(clientTransport),
        ]);

        const { tools } = await client.listTools();
        const names = tools.map((tool) => tool.name);

        expect(names).toEqual(
            expect.arrayContaining([
                "calculate_rope_diameter",
                "find_rope_threads",
                "list_rope_threads",
            ]),
        );

        const calculate = tools.find((tool) => tool.name === "calculate_rope_diameter");
        const find = tools.find((tool) => tool.name === "find_rope_threads");
        const list = tools.find((tool) => tool.name === "list_rope_threads");

        expect(calculate?.description).toContain("three-strand rope");
        expect(calculate?.inputSchema.required).toContain("threadsPerStrand");
        expect(calculate?.description).toContain("22.22 and 6000");
        expect(calculate?.description).toContain("EXTRAPOLATION");
        expect(calculate?.description).toContain("does not use tension load");
        expect(find?.description).toContain("±10%");
        expect(find?.description).not.toContain("±15%");
        expect(find?.description).toContain("1, 2, 3, 4 and 5 threads per strand");
        expect(find?.inputSchema.required).toContain("targetDiameterMm");
        expect(list?.description).toContain("active rope thread catalog");
        expect(list?.inputSchema.required).toBeUndefined();

        await client.close();
        await server.close();
    });

    it("rejects withdrawn load arguments instead of ignoring them", async () => {
        const server = createMcpServer();
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "rope-load-test", version: "1.0.0" });

        await Promise.all([
            server.connect(serverTransport),
            client.connect(clientTransport),
        ]);

        const { tools } = await client.listTools();
        for (const name of ["calculate_rope_diameter", "find_rope_threads"]) {
            const tool = tools.find((item) => item.name === name);
            const properties = (tool?.inputSchema.properties ?? {}) as Record<string, unknown>;
            expect(Object.keys(properties)).not.toContain("loadMode");
            expect(Object.keys(properties)).not.toContain("loadGrams");
        }

        const text = (result: any) => String(result.content?.[0]?.text ?? "");

        const calculate = await client.callTool({
            name: "calculate_rope_diameter",
            arguments: {
                basis: "dtex",
                dtex: 750,
                threadsPerStrand: 2,
                loadGrams: 200,
            },
        });
        // Схема строгая: аргумент отклонён валидацией, а не отброшен молча.
        expect(calculate.isError).toBe(true);
        expect(text(calculate)).toMatch(/validation error/i);
        expect(text(calculate)).toContain("loadGrams");

        const find = await client.callTool({
            name: "find_rope_threads",
            arguments: { targetDiameterMm: 1, loadMode: "manual" },
        });
        expect(find.isError).toBe(true);
        expect(text(find)).toMatch(/validation error/i);
        expect(text(find)).toContain("loadMode");

        // Нижняя граница ручного dTex — 22.22.
        const tooThin = await client.callTool({
            name: "calculate_rope_diameter",
            arguments: { basis: "dtex", dtex: 22.21, threadsPerStrand: 1 },
        });
        expect(tooThin.isError).toBe(true);
        expect(text(tooThin)).toMatch(/validation error/i);

        await client.close();
        await server.close();
    });

    it("returns three-decimal text and unrounded structuredContent", async () => {
        const workerResponse = {
            apiVersion: "2",
            algorithmVersion: "4.0.0",
            modelId: "log-dtex-quadratic-no-load",
            catalogVersion: null,
            fetchedAt: null,
            warnings: [],
            basis: "dtex",
            input: { dtex: 750, threadsPerStrand: 2 },
            result: {
                basis: "dtex",
                threadId: null,
                dtex: 750,
                threadsPerStrand: 2,
                strands: 3,
                construction: "2 × 3",
                diameterMm: 1.0201549921706878,
            },
        };

        const fetchMock = vi.fn(async () =>
            new Response(JSON.stringify(workerResponse), {
                status: 200,
                headers: { "content-type": "application/json" },
            }),
        );
        vi.stubGlobal("fetch", fetchMock);

        const server = createMcpServer();
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "rope-structured-test", version: "1.0.0" });

        await Promise.all([
            server.connect(serverTransport),
            client.connect(clientTransport),
        ]);

        const result = await client.callTool({
            name: "calculate_rope_diameter",
            arguments: { basis: "dtex", dtex: 750, threadsPerStrand: 2 },
        });

        const text = (result.content as Array<{ text?: string }>)[0]?.text ?? "";
        expect(text).toContain("Rope diameter: 1.020 mm");
        expect(text).not.toContain("1.0201549921706878");

        const structured = result.structuredContent as Record<string, unknown>;
        expect(structured.diameterMm).toBe(1.0201549921706878);
        expect(structured.algorithmVersion).toBe("4.0.0");
        expect(structured.modelId).toBe("log-dtex-quadratic-no-load");
        expect(structured.warnings).toEqual([]);

        await client.close();
        await server.close();
    });

    it("registers the rigging diameter calculator tools", async () => {
        const server = createMcpServer();
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "rigging-tools-test", version: "1.0.0" });

        await Promise.all([
            server.connect(serverTransport),
            client.connect(clientTransport),
        ]);

        const { tools } = await client.listTools();
        const byName = new Map(tools.map((tool) => [tool.name, tool]));

        expect(byName.get("list_rigging_profiles")?.inputSchema.required).toBeUndefined();
        expect(byName.get("get_rigging_profile")?.inputSchema.required).toEqual(["profileId"]);
        expect(byName.get("get_rigging_profile")?.description).toContain("exampleConfiguration");

        const calculate = byName.get("calculate_rigging_diameters");
        expect(calculate?.description).toContain("/tools/rigging-diameters");
        expect(calculate?.inputSchema.required).toEqual(
            expect.arrayContaining(["profileId", "scaleDenominator"]),
        );

        // Ошибка конфигурации отклоняется до обращения к Worker'у.
        const result = await client.callTool({
            name: "calculate_rigging_diameters",
            arguments: {
                profileId: "traditional_plant",
                scaleDenominator: 64,
                masts: { fore: { diameter: { value: 9 } } },
                foreAndAftSails: [
                    { sailClass: "head_lower", supportingMastId: "fore" },
                    { sailClass: "head_lower", supportingMastId: "fore" },
                ],
            },
        });
        expect(result.isError).toBe(true);

        await client.close();
        await server.close();
    });
});
