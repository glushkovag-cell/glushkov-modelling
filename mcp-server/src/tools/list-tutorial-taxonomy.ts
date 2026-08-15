import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { fetchAllTutorials, levelOf } from "../lib/tutorials.js";

/**
 * Справочник таксономии образовательных статей: все встречающиеся категории,
 * теги и уровни сложности с числом статей по каждому значению. Строится
 * клиентски из уже загружаемого списка статей (fetchAllTutorials), без
 * дополнительных GraphQL-запросов к WPGraphQL.
 */
export function registerListTutorialTaxonomy(server: McpServer): void {
  server.registerTool(
    "list_tutorial_taxonomy",
    {
      title: "Tutorials tags and categories reference",
      description:
          "Returns all available values for categories, tags, and difficulty levels of educational " +
          "articles on the site, along with the article count for each value. Use this before calling " +
          "get_tutorials with tag/category/level filters to determine the exact valid values.",
      inputSchema: {},
    },
    async () => {
      try {
        const tutorials = await fetchAllTutorials();

        const categoryCounts = new Map<string, number>();
        const tagCounts = new Map<string, number>();
        const levelCounts = new Map<string, number>();

        for (const t of tutorials) {
          for (const c of t.tutorialCategories?.nodes || []) {
            categoryCounts.set(c.name, (categoryCounts.get(c.name) ?? 0) + 1);
          }
          for (const tg of t.tutorialTags?.nodes || []) {
            tagCounts.set(tg.name, (tagCounts.get(tg.name) ?? 0) + 1);
          }
          const level = levelOf(t.tutorialFields?.tutorialLevel);
          if (level) {
            levelCounts.set(level, (levelCounts.get(level) ?? 0) + 1);
          }
        }

        const toSortedArray = (map: Map<string, number>) =>
          Array.from(map.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);

        return jsonResult({
          totalTutorials: tutorials.length,
          categories: toSortedArray(categoryCounts),
          tags: toSortedArray(tagCounts),
          levels: toSortedArray(levelCounts),
        });
      } catch (error) {
        return errorResult(
          `Error retrieving the tutorials taxonomy directory: ${(error as Error).message}`,
        );
      }
    },
  );
}
