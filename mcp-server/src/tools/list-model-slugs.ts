import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import {
  fetchAllModels,
  findModelsByNamePartial,
  statusSlugOf,
  statusTextOf,
} from "../lib/wp-models.js";

/**
 * Резолвер slug для моделей (построек). Большинство других инструментов
 * (get_build_details и т. д.) принимает slug модели как параметр, но ни один
 * инструмент явно не публикует список валидных slug — их приходилось угадывать
 * из побочных полей ответа list_builds. Этот инструмент делает slug частью
 * публичного контракта: по названию (полному или частичному) или по критериям
 * фильтрации возвращает список пар {title, slug}.
 */

const inputSchema = {
  name: z
    .string()
    .optional()
    .describe(
        "Full or partial name of the building to search for slug. Search is case insensitive " +
        "and looks for an occurrence both in the name and in the slug itself. If not specified, all models are returned.",
    ),
  status: z
    .enum(["in progress", "completed", "planned"])
    .optional()
    .describe("Filter by build status."),
  manufacturer: z
    .string()
    .optional()
    .describe("Filter by kit manufacturer (partial match, case-insensitive)."),
  scale: z
    .string()
    .optional()
    .describe("Filter by model scale (exact match, e.g., '1:64')."),
};

export function registerListModelSlugs(server: McpServer): void {
  server.registerTool(
    "list_model_slugs",
    {
      title: "Build slug",
      description:
          "Returns the slug for builds (models) based on the name (full or partial match) " +
          "or filtering criteria (status, manufacturer, scale). Use this tool " +
          "to obtain the correct slug before calling tools that accept a slug as a parameter " +
          "(e.g., get_build_details).",
      inputSchema,
    },
    async ({ name, status, manufacturer, scale }) => {
      try {
        const models = await fetchAllModels();

        let filtered = name ? findModelsByNamePartial(models, name) : models;

        if (status) {
          filtered = filtered.filter((m) => statusSlugOf(m) === status);
        }

        if (manufacturer) {
          const needle = manufacturer.trim().toLowerCase();
          filtered = filtered.filter((m) =>
            (m.modelinfo?.manufacturer ?? "").toLowerCase().includes(needle),
          );
        }

        if (scale) {
          filtered = filtered.filter((m) => m.modelinfo?.modelscale === scale);
        }

        const results = filtered.map((m) => ({
          title: m.title,
          slug: m.slug,
          manufacturer: m.modelinfo?.manufacturer ?? null,
          scale: m.modelinfo?.modelscale ?? null,
          status: statusTextOf(m) || null,
          statusSlug: statusSlugOf(m) || null,
        }));

        return jsonResult({
          total: results.length,
          ambiguous: results.length > 1 && Boolean(name),
          results,
        });
      } catch (error) {
        return errorResult(
          `Error retrieving buils slug list: ${(error as Error).message}`,
        );
      }
    },
  );
}
