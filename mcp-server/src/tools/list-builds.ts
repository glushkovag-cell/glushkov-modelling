import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { fetchAllModels, statusSlugOf, statusTextOf } from "../lib/wp-models.js";

const inputSchema = {
  status: z
    .enum(["in-progress", "completed", "planned"])
    .optional()
    .describe("Фильтр по статусу постройки. Если не указан, возвращаются все."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .describe("Максимальное количество построек в ответе."),
};

export function registerListBuilds(server: McpServer): void {
  server.registerTool(
    "list_builds",
    {
      title: "Список построек",
      description:
        "Возвращает список моделей парусных судов на сайте: название, масштаб, " +
        "производитель, статус постройки. Поддерживает фильтр по статусу.",
      inputSchema,
    },
    async ({ status, limit }) => {
      try {
        const models = await fetchAllModels();

        const filtered = status
          ? models.filter((model) => statusSlugOf(model) === status)
          : models;

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
          `Ошибка при получении списка построек: ${(error as Error).message}`,
        );
      }
    },
  );
}
