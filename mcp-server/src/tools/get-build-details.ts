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
    .describe("Name of the build (model) for which detailed information is required."),
  partNumber: z
    .union([z.string(), z.number()])
    .optional()
    .describe(
        "Optional: the number of a specific build log part. If specified alongside partSlug, " +
        "partSlug takes precedence. If neither is specified, a list of all parts is returned.",
    ),
  partSlug: z
    .string()
    .optional()
    .describe("Optional: slug of a specific part of the build log (takes precedence over partNumber)."),
};

export function registerGetBuildDetails(server: McpServer): void {
  server.registerTool(
    "get_build_details",
    {
      title: "Build details",
      description:
        "Returns historical information about the vessel, a list of build-log series parts " +
        "and technical notes regarding the specified build. Опционально: если указан partNumber " +
        "или partSlug, возвращает только эту конкретную часть build-лога с полным содержимым " +
        "(без обрезки), вместо списка всех частей.",
      inputSchema,
    },
    async ({ buildName, partNumber, partSlug }) => {
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

        if (partSlug || partNumber !== undefined) {
          const targetPart = partSlug
            ? parts.find((post) => post.slug === partSlug)
            : parts.find((post) => String(post.buildlog?.partnumber ?? "") === String(partNumber));

          if (!targetPart) {
            return errorResult(
              `Build-log not found by ${
                partSlug ? `partSlug='${partSlug}'` : `partNumber='${partNumber}'`
              } in buiid '${model.title}'. Available parts: ${parts
                .map((p) => `${p.buildlog?.partnumber ?? "?"} (${p.slug})`)
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
              url: buildLogPartUrl(model.slug, targetPart.buildlog?.partnumber),
              content: stripHtmlAndTruncate(
                targetPart.buildlog?.partcontent || targetPart.content,
                4000,
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
