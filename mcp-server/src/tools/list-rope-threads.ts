import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { RopeApiError, listRopeThreads } from "../lib/rope-api.js";

export function registerListRopeThreads(server: McpServer): void {
  server.registerTool(
      "list_rope_threads",
      {
        title: "List rope threads",
        description:
            "Read-only. Returns the full active rope thread catalog: 23 threads ordered from thin to thick, each with its id, brand, number, linear density in dTex, sort order and a human-readable label. " +
            "Use this tool to discover thread ids before calling calculate_rope_diameter, or when the user asks which threads are available. " +
            "Threads disabled or unpublished in the CMS are not included. The response also carries the catalog version and the moment the catalog was read. " +
            "Use find_rope_threads when the user needs threads for a specific target diameter instead of the whole catalog.",
        inputSchema: {},
      },
      async () => {
        try {
          const catalog = await listRopeThreads();

          return jsonResult(catalog);
        } catch (error) {
          if (error instanceof RopeApiError) {
            return errorResult(`Rope calculator error (${error.code}): ${error.message}`);
          }

          return errorResult(
              `Error listing rope threads: ${(error as Error).message}`,
          );
        }
      },
  );
}
