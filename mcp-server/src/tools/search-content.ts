import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult } from "../lib/tool-result.js";
// import { requestWithTimeout } from "../lib/graphql-client.js";

const inputSchema = {
  query: z
    .string()
    .min(2)
    .describe("Поисковый запрос для полнотекстового поиска по build-логам и статьям."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe("Максимальное количество результатов."),
};

/**
 * TODO(Этап 1): реализовать полнотекстовый поиск через WPGraphQL posts search.
 * Реализуется последним в списке (наиболее требователен к производительности).
 */
export function registerSearchContent(server: McpServer): void {
  server.registerTool(
    "search_content",
    {
      title: "Поиск по контенту",
      description:
        "Выполняет полнотекстовый поиск по build-логам построек и обучающим статьям сайта.",
      inputSchema,
    },
    async ({ query, limit }) => {
      try {
        return errorResult(
          `search_content пока не реализован (query="${query}", limit=${limit}).`,
        );
      } catch (error) {
        return errorResult(`Ошибка при поиске контента: ${(error as Error).message}`);
      }
    },
  );
}
