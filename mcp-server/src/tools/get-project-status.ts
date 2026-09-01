import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { buildUrl } from "../lib/public-urls.js";
import { fetchAllModels, findModelByName, statusSlugOf, statusTextOf } from "../lib/wp-models.js";

const inputSchema = {
  buildName: z
    .string()
    .min(1)
    .describe("Model name (for example, 'Le Requin', 'Bounty')."),
};

export function registerGetProjectStatus(server: McpServer): void {
  server.registerTool(
    "get_project_status",
    {
      title: "Build status",
      description:
        "Returns the current build status of the model by name: " +
        "in progress, completed или planned (ACF-field buildStatus).",
      inputSchema,
    },
    async ({ buildName }) => {
      try {
        const models = await fetchAllModels();
        const model = findModelByName(models, buildName);

        if (!model) {
          return errorResult(
            `Model '${buildName}' not found. Available models: ${models
              .map((m) => m.title)
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
