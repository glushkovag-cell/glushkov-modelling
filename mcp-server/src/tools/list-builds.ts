import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { fetchAllModels, filterModelsByStatus, statusSlugOf, statusTextOf } from "../lib/wp-models.js";

const inputSchema = {
  status: z
    .enum(["in progress", "completed", "planned"])
    .optional()
    .describe("Filter by build status. If not specified, all are returned."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .describe("Maximum number of builds in the response."),
};

export function registerListBuilds(server: McpServer): void {
  server.registerTool(
    "list_builds",
    {
      title: "Список построек",
      description:
        "Returns a list of sailing ship models on the site: name, scale, manufacturer, and build status. " +
        "Supports filtering by status.",
      inputSchema,
    },
    async ({ status, limit }) => {
      try {
        const models = await fetchAllModels();

        const filtered = status ? filterModelsByStatus(models, status) : models;
        
        const builds = filtered.slice(0, limit).map((model) => ({
          slug: model.slug,
          title: model.title,
          manufacturer: model.modelinfo?.manufacturer ?? null,
          scale: model.modelinfo?.modelscale ?? null,
          status: statusTextOf(model) || null,
          statusSlug: statusSlugOf(model) || null,
          historicalYear: model.modelinfo?.historicalyear ?? null,
          totalParts: model.modelinfo?.totalparts ?? null,
          doneDate: model.modelinfo?.donedate ?? null,
        }));

        return jsonResult({
          total: builds.length,
          totalAvailable: filtered.length,
          status: status ?? null,
          builds,
        });
      } catch (error) {
        return errorResult(
          `Error retrieving list of builds: ${(error as Error).message}`,
        );
      }
    },
  );
}
