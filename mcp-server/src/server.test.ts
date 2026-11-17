import { describe, expect, it } from "vitest";

// config.ts читает окружение при импорте; значения нужны до загрузки server.ts.
process.env.MCP_API_KEY = "test-key";
process.env.WP_GRAPHQL_URL = "https://cms.example.test/graphql";
process.env.CMS_GALLERY_URL = "https://cms.example.test/gallery";

const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const { createMcpServer } = await import("./server.js");

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
        expect(find?.description).toContain("±10%");
        expect(find?.description).not.toContain("±15%");
        expect(find?.inputSchema.required).toContain("targetDiameterMm");
        expect(list?.description).toContain("active rope thread catalog");
        expect(list?.inputSchema.required).toBeUndefined();

        await client.close();
        await server.close();
    });

    it("exposes loadMode/loadGrams in the rope tool schemas and validates them", async () => {
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
            const properties = tool?.inputSchema.properties as Record<string, any>;
            expect(properties.loadMode.enum).toEqual(["auto", "manual"]);
            expect(JSON.stringify(properties.loadGrams)).toContain("300");
            expect(tool?.inputSchema.required).not.toContain("loadMode");
        }
        const calculate = tools.find((item) => item.name === "calculate_rope_diameter");
        expect((calculate?.inputSchema.properties as Record<string, any>).dtex.minimum).toBe(20);

        const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
        const text = (result: any) => String(result.content?.[0]?.text ?? "");

        const manualWithoutLoad = await call("calculate_rope_diameter", {
            basis: "dtex", dtex: 80, threadsPerStrand: 2, loadMode: "manual",
        });
        expect(manualWithoutLoad.isError).toBe(true);
        expect(text(manualWithoutLoad)).toContain("loadGrams is required");

        const autoWithLoad = await call("find_rope_threads", { targetDiameterMm: 1, loadMode: "auto", loadGrams: 200 });
        expect(autoWithLoad.isError).toBe(true);
        expect(text(autoWithLoad)).toContain("only when loadMode is 'manual'");

        const legacyLowDtex = await call("calculate_rope_diameter", { basis: "dtex", dtex: 40, threadsPerStrand: 1 });
        expect(legacyLowDtex.isError).toBe(true);
        expect(text(legacyLowDtex)).toContain("at least 80");

        const badLoad = await call("calculate_rope_diameter", {
            basis: "dtex", dtex: 80, threadsPerStrand: 2, loadMode: "manual", loadGrams: 120,
        });
        expect(badLoad.isError).toBe(true);

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
