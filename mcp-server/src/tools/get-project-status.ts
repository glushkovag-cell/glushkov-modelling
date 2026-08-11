import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult } from "../lib/tool-result.js";
// import { requestWithTimeout } from "../lib/graphql-client.js";

const inputSchema = {
  buildName: z
    .string()
    .min(1)
    .describe("Название постройки (например, 'Le Requin', 'Bounty')."),
};

/**
 * TODO(Этап 1): реализовать запрос значения ACF-поля buildStatus через WPGraphQL
 * для постройки с указанным названием.
 */
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
        return errorResult(
          `get_project_status пока не реализован (запрошена постройка: ${buildName}).`,
        );
      } catch (error) {
        return errorResult(
          `Ошибка при получении статуса постройки: ${(error as Error).message}`,
        );
      }
    },
  );
}
