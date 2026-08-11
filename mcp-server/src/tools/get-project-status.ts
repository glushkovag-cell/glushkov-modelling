import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { fetchAllModels, findModelByName, statusSlugOf, statusTextOf } from "../lib/wp-models.js";

const inputSchema = {
  buildName: z
    .string()
    .min(1)
    .describe("Название постройки (например, 'Le Requin', 'Bounty')."),
};

export function registerGetProjectStatus(server: McpServer): void {
  server.registerTool(
    "get_project_status",
    {
      title: "Статус постройки",
      description:
        "Возвращает текущий статус постройки модели по названию: " +
        "in-progress, completed или planned (ACF-поле buildStatus).",
      inputSchema,
    },
    async ({ buildName }) => {
      try {
        const models = await fetchAllModels();
        const model = findModelByName(models, buildName);

        if (!model) {
          return errorResult(
            `Постройка '${buildName}' не найдена. Доступные названия: ${models
              .map((m) => m.title)
              .join(", ")}.`,
          );
        }

        return jsonResult({
          title: model.title,
          slug: model.slug,
          status: statusTextOf(model) || null,
          statusSlug: statusSlugOf(model) || null,
          doneDate: model.modelinfo?.donedate ?? null,
        });
      } catch (error) {
        return errorResult(
          `Ошибка при получении статуса постройки: ${(error as Error).message}`,
        );
      }
    },
  );
}
