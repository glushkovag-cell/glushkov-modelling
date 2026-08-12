import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import {
  fetchAllModels,
  fetchBuildPartsForSlug,
  findModelByName,
  statusSlugOf,
  statusTextOf,
  stripHtmlAndTruncate,
} from "../lib/wp-models.js";

const inputSchema = {
  buildName: z
    .string()
    .min(1)
    .describe("Name of the build (model) for which detailed information is required."),
};

export function registerGetBuildDetails(server: McpServer): void {
  server.registerTool(
    "get_build_details",
    {
      title: "Build details",
      description:
        "Returns historical information about the vessel, a list of build-log series parts " +
        "and technical notes regarding the specified build.",
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

        const parts = await fetchBuildPartsForSlug(model.slug);

        return jsonResult({
          title: model.title,
          slug: model.slug,
          manufacturer: model.modelinfo?.manufacturer ?? null,
          scale: model.modelinfo?.modelscale ?? null,
          status: statusTextOf(model) || null,
          statusSlug: statusSlugOf(model) || null,
          historicalYear: model.modelinfo?.historicalyear ?? null,
          modelLength: model.modelinfo?.modellength ?? null,
          totalParts: model.modelinfo?.totalparts ?? null,
          doneDate: model.modelinfo?.donedate ?? null,
          shortDescription: model.modelinfo?.shortdescription ?? null,
          historicalNote: model.modelinfo?.historicalnote ?? null,
          buildLogParts: parts.map((post) => ({
            partNumber: post.buildlog?.partnumber ?? null,
            recordDay: post.buildlog?.recordday ?? null,
            title: post.title,
            slug: post.slug,
            excerpt: stripHtmlAndTruncate(post.buildlog?.partcontent || post.content, 300),
          })),
          totalBuildLogParts: parts.length,
        });
      } catch (error) {
        return errorResult(
          `Error retrieving building details: ${(error as Error).message}`,
        );
      }
    },
  );
}
