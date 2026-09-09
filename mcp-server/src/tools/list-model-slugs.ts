import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { buildUrl } from "../lib/public-urls.js";
import {
  fetchAllModels,
  filterModelsByStatus,
  findModelsByNamePartial,
  statusSlugOf,
  statusTextOf,
} from "../lib/wp-models.js";

const inputSchema = {
  name: z
      .string()
      .optional()
      .describe(
          "Full or partial model name to search for. Matching is case-insensitive and checks both the model title and slug. If omitted, all models are considered.",
      ),

  status: z
      .enum(["in progress", "completed", "planned"])
      .optional()
      .describe(
          "Filter by build status. If omitted, models with all statuses are considered.",
      ),

  manufacturer: z
      .string()
      .optional()
      .describe(
          "Filter by kit manufacturer using a case-insensitive partial match.",
      ),

  scale: z
      .string()
      .optional()
      .describe(
          "Filter by exact model scale, for example '1:64'.",
      ),
};

export function registerListModelSlugs(server: McpServer): void {
  server.registerTool(
      "list_model_slugs",
      {
        title: "List model slugs",
        description:
            "Read-only. Finds valid sailing-ship model slugs by full or partial model name, build status, manufacturer, or scale. " +
            "Use this tool when another tool requires a model slug and the user provides only a human-readable model name or identifying metadata. " +
            "Use list_builds when the user wants to browse or compare the model catalog. " +
            "Returns matching model titles, slugs, URLs, and minimal identification metadata. " +
            "When name matches more than one model, ambiguous is true and results contains all matching candidates. " +
            "If no models match the criteria, returns an empty results array.",
        inputSchema,
      },
      async ({ name, status, manufacturer, scale }) => {
        try {
          const models = await fetchAllModels();

          let filtered = name
              ? findModelsByNamePartial(models, name)
              : models;

          if (status) {
            filtered = filterModelsByStatus(filtered, status);
          }

          if (manufacturer) {
            const needle = manufacturer.trim().toLowerCase();

            filtered = filtered.filter((model) =>
                (model.modelinfo?.manufacturer ?? "")
                    .toLowerCase()
                    .includes(needle),
            );
          }

          if (scale) {
            filtered = filtered.filter(
                (model) => model.modelinfo?.modelscale === scale,
            );
          }

          const results = filtered.map((model) => ({
            title: model.title,
            slug: model.slug,
            url: buildUrl(model.slug),
            manufacturer: model.modelinfo?.manufacturer ?? null,
            scale: model.modelinfo?.modelscale ?? null,
            status: statusTextOf(model) || null,
            statusSlug: statusSlugOf(model) || null,
          }));

          return jsonResult({
            total: results.length,
            ambiguous: results.length > 1 && Boolean(name),
            results,
          });
        } catch (error) {
          return errorResult(
              `Error retrieving build slug list: ${(error as Error).message}`,
          );
        }
      },
  );
}
