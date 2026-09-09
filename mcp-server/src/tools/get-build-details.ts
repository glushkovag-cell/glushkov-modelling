import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { buildLogPartUrl, buildUrl } from "../lib/public-urls.js";
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
      .describe(
          "Human-readable model name. Use list_builds to browse models or list_model_slugs to identify a model before requesting details.",
      ),

  partNumber: z
      .union([z.string(), z.number()])
      .optional()
      .describe(
          "Optional build-log part number. Use this to retrieve one part when its part slug is not known. If partSlug is also provided, partSlug takes precedence. If neither partNumber nor partSlug is provided, returns model details and summaries of all build-log parts.",
      ),

  partSlug: z
      .string()
      .optional()
      .describe(
          "Optional stable slug of one build-log part. Takes precedence over partNumber and returns that part's complete content.",
      ),
};

export function registerGetBuildDetails(server: McpServer): void {
  server.registerTool(
      "get_build_details",
      {
        title: "Get build details",
        description:
            "Read-only. Returns detailed information for one sailing-ship model, including vessel background, technical notes, and build-log parts. " +
            "Use list_builds to browse or filter the model catalog, and use list_model_slugs when a model slug must be identified from a name or metadata. " +
            "Use this tool when details for one known model are needed; do not use it for catalog browsing. " +
            "Without partNumber or partSlug, returns model metadata and a summary list of build-log parts. " +
            "Set partNumber or partSlug to retrieve one build-log part with complete, untruncated content. If both are provided, partSlug takes precedence. " +
            "Returns a not-found result if the model or requested build-log part does not exist.",
        inputSchema,
      },
      async ({ buildName, partNumber, partSlug }) => {
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

          const parts = await fetchBuildPartsForSlug(model.slug);

          if (partSlug || partNumber !== undefined) {
            const targetPart = partSlug
                ? parts.find((post) => post.slug === partSlug)
                : parts.find(
                    (post) =>
                        String(post.buildlog?.partnumber ?? "") ===
                        String(partNumber),
                );

            if (!targetPart) {
              return errorResult(
                  `Build-log part not found by ${
                      partSlug
                          ? `partSlug='${partSlug}'`
                          : `partNumber='${partNumber}'`
                  } in build '${model.title}'. Available parts: ${parts
                      .map(
                          (part) =>
                              `${part.buildlog?.partnumber ?? "?"} (${part.slug})`,
                      )
                      .join(", ")}.`,
              );
            }

            return jsonResult({
              title: model.title,
              slug: model.slug,
              url: buildUrl(model.slug),
              part: {
                partNumber: targetPart.buildlog?.partnumber ?? null,
                recordDay: targetPart.buildlog?.recordday ?? null,
                title: targetPart.title,
                slug: targetPart.slug,
                url: buildLogPartUrl(
                    model.slug,
                    targetPart.buildlog?.partnumber,
                ),
                content: stripHtmlAndTruncate(
                    targetPart.buildlog?.partcontent || targetPart.content,
                ),
              },
            });
          }

          return jsonResult({
            title: model.title,
            slug: model.slug,
            url: buildUrl(model.slug),
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
              url: buildLogPartUrl(model.slug, post.buildlog?.partnumber),
              excerpt: stripHtmlAndTruncate(
                  post.buildlog?.partcontent || post.content,
                  300,
              ),
            })),
            totalBuildLogParts: parts.length,
          });
        } catch (error) {
          return errorResult(
              `Error retrieving build details: ${(error as Error).message}`,
          );
        }
      },
  );
}
