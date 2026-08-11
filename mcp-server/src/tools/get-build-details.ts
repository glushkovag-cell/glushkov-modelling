import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult } from "../lib/tool-result.js";
// import { requestWithTimeout } from "../lib/graphql-client.js";

const inputSchema = {
  buildName: z
    .string()
    .min(1)
    .describe("Название постройки, о которой нужна подробная информация."),
};

/**
 * TODO(Этап 1): реализовать запрос исторической справки, частей серии build-логов
 * и техзаметок через WPGraphQL + ACF. Требует схему WPGraphQL для custom post type.
 */
export function registerGetBuildDetails(server: McpServer): void {
  server.registerTool(
    "get_build_details",
    {
      title: "Подробности постройки",
      description:
        "Возвращает историческую справку о судне, список частей серии build-логов " +
        "и технические заметки по указанной постройке.",
      inputSchema,
    },
    async ({ buildName }) => {
      try {
        return errorResult(
          `get_build_details пока не реализован (запрошена постройка: ${buildName}).`,
        );
      } catch (error) {
        return errorResult(
          `Ошибка при получении деталей постройки: ${(error as Error).message}`,
        );
      }
    },
  );
}
