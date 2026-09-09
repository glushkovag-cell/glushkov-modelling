import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { buildUrl } from "../lib/public-urls.js";
import {
  fetchAllModels,
  findModelByName,
  statusSlugOf,
  statusTextOf,
} from "../lib/wp-models.js";

const inputSchema = {
  buildName: z
      .string()
      .min(1)
      .describe(
          "Human-readable model name, for example 'Le Requin' or 'Bounty'. Use list_builds to browse models or list_model_slugs when the exact model name is unknown.",
      ),
};

export function registerGetProjectStatus(server: McpServer): void {
  server.registerTool(
      "get_project_status",
      {
        title: "Get project status",
        description:
            "Read-only. Returns the current build status for one sailing-ship model, including its display status, normalized status slug, and completion date when available. " +
            "Use this tool when the user asks specifically for the status of one known model. " +
            "Use list_builds to browse, compare, or filter multiple models. " +
            "Use get_build_details for vessel background, technical notes, and build-log parts. " +
            "Returns a not-found result if no model matches the provided name.",
        inputSchema,
      },
      async ({ buildName }) => {
        try {
          const models = await fetchAllModels();
          const model = findModelByName(models, buildName);

          if (!model) {
            return errorResult(
                `Model '${buildName}' not found. Available models: ${models
                    .map((item) => item.title)
                    .join(", ")}.`,
            );
          }

          return jsonResult({
            title: model.title,
            slug: model.slug,
            url: buildUrl(model.slug),
            status: statusTextOf(model) || null,
            statusSlug: statusSlugOf(model) || null,
            doneDate: model.modelinfo?.donedate ?? null,
          });
        } catch (error) {
          return errorResult(
              `Error retrieving build status: ${(error as Error).message}`,
          );
        }
      },
  );
}
