import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { stripHtmlAndTruncate } from "../lib/wp-models.js";
import { fetchAllTutorials, levelOf } from "../lib/tutorials.js";

/**
 * Полнотекстовый поиск по содержимому статей (не только по title/teaser, как в search_content).
 * Фильтрация выполняется на клиенте (в MCP-сервере), поскольку кастомный резолвер
 * tutorialsFiltered не подтверждён на поддержку аргумента search на уровне WPGraphQL.
 * CMS и MCP работают на одном VPS, поэтому клиентская фильтрация полного списка статей
 * не создаёт заметной сетевой или временной задержки.
 */

const inputSchema = {
  query: z
    .string()
    .min(2)
    .describe("Search query for full-text search of the content of educational articles."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe("Maximum number of results."),
};

export function registerSearchTutorialContent(server: McpServer): void {
  server.registerTool(
    "search_tutorial_content",
    {
      title: "Search within tutorials content",
      description:
          "Searches for educational articles based on their full content (not just the title " +
          "and summary, as with search_content). Use this when the desired term or technique " +
          "might appear within the article rather than in its title.",
      inputSchema,
    },
    async ({ query, limit }) => {
      try {
        const tutorials = await fetchAllTutorials();
        const needle = query.trim().toLowerCase();

        const results = tutorials
          .filter((t) => {
            const plainContent = stripHtmlAndTruncate(t.content, 20000).toLowerCase();
            return (
              plainContent.includes(needle) ||
              t.title.toLowerCase().includes(needle) ||
              (t.tutorialFields?.tutorialTeaser || "").toLowerCase().includes(needle)
            );
          })
          .slice(0, limit)
          .map((t) => {
            const plainContent = stripHtmlAndTruncate(t.content, 20000);
            const matchIndex = plainContent.toLowerCase().indexOf(needle);
            const excerpt =
              matchIndex >= 0
                ? plainContent.slice(Math.max(0, matchIndex - 80), matchIndex + 200).trim()
                : stripHtmlAndTruncate(t.tutorialFields?.tutorialTeaser, 200);

            return {
              title: t.title,
              slug: t.slug,
              level: levelOf(t.tutorialFields?.tutorialLevel),
              tags: (t.tutorialTags?.nodes || []).map((tg) => tg.name),
              excerpt: excerpt || null,
            };
          });

        return jsonResult({
          query,
          total: results.length,
          results,
        });
      } catch (error) {
        return errorResult(
          `Full-text search error for articles: ${(error as Error).message}`,
        );
      }
    },
  );
}
