import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { buildUrl } from "../lib/public-urls.js";
import {
  fetchAllModels,
  filterModelsByStatus,
  statusSlugOf,
  statusTextOf,
} from "../lib/wp-models.js";

const inputSchema = {
  status: z
      .enum(["in progress", "completed", "planned"])
      .optional()
      .describe(
          "Filter by build status. If omitted, models with all statuses are returned.",
      ),

  limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe(
          "Maximum number of model summaries to return. Default: 50. Maximum: 100.",
      ),
};

export function registerListBuilds(server: McpServer): void {
  server.registerTool(
      "list_builds",
      {
        title: "List builds",
        description:
            "Read-only. Returns a list of sailing-ship model summaries with title, slug, scale, manufacturer, build status, and site URL. " +
            "Use this tool to browse the model catalog, compare models, filter by build status, or discover a model before requesting details. " +
            "Use get_project_status only for the current progress of one known model. Use get_build_details for vessel background, technical notes, or build-log content. " +
            "Results follow the site's model order and are limited to the requested limit. The response includes total for the number of returned models and totalAvailable for the number of models matching the filter before the limit is applied. " +
            "If no models match the filter, returns an empty builds array.",
        inputSchema,
      },
      async ({ status, limit }) => {
        try {
          const models = await fetchAllModels();
          const filtered = status
              ? filterModelsByStatus(models, status)
              : models;

          const builds = filtered.slice(0, limit).map((model) => ({
            slug: model.slug,
            title: model.title,
            url: buildUrl(model.slug),
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
