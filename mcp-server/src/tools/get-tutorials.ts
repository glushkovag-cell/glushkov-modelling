import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult } from "../lib/tool-result.js";
// import { requestWithTimeout } from "../lib/graphql-client.js";

const inputSchema = {
  slug: z
    .string()
    .optional()
    .describe(
      "Slug конкретной обучающей статьи. Если не указан, возвращается список всех статей.",
    ),
};

/**
 * TODO(Этап 1): реализовать запрос списка/содержания обучающих статей через
 * wpgraphql-glushkov-tutorials. Реализуется последним по плану.
 */
export function registerGetTutorials(server: McpServer): void {
  server.registerTool(
    "get_tutorials",
    {
      title: "Обучающие статьи",
      description:
        "Возвращает список обучающих статей сайта или содержание конкретной статьи по slug.",
      inputSchema,
    },
    async ({ slug }) => {
      try {
        return errorResult(
          `get_tutorials пока не реализован (slug=${slug ?? "не задан, запрошен список"}).`,
        );
      } catch (error) {
        return errorResult(
          `Ошибка при получении обучающих статей: ${(error as Error).message}`,
        );
      }
    },
  );
}
