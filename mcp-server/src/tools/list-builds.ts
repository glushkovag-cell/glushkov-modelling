import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult } from "../lib/tool-result.js";
// import { requestWithTimeout } from "../lib/graphql-client.js";

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

/**
 * TODO(Этап 1): реализовать реальный GraphQL-запрос к WPGraphQL custom post type
 * построек, когда будет доступна схема (интроспекция или примеры запросов
 * из Astro-кода). Пока — заглушка, возвращающая понятную ошибку "not implemented",
 * чтобы MCP Inspector корректно показывал зарегистрированный инструмент.
 */
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
        // Заглушка до реализации реального запроса к WPGraphQL.
        return errorResult(
          `list_builds пока не реализован (получен фильтр status=${status ?? "не задан"}, limit=${limit}).`,
        );
      } catch (error) {
        return errorResult(
          `Ошибка при получении списка построек: ${(error as Error).message}`,
        );
      }
    },
  );
}
