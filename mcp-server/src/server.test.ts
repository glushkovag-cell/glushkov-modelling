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
            expect.arrayContaining(["calculate_rope_diameter", "find_rope_threads"]),
        );

        const calculate = tools.find((tool) => tool.name === "calculate_rope_diameter");
        const find = tools.find((tool) => tool.name === "find_rope_threads");

        expect(calculate?.description).toContain("three-strand rope");
        expect(calculate?.inputSchema.required).toContain("threadsPerStrand");
        expect(find?.description).toContain("±15%");
        expect(find?.inputSchema.required).toContain("targetDiameterMm");

        await client.close();
        await server.close();
    });
});
