import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { fetchAllTutorials, levelOf } from "../lib/tutorials.js";

/**
 * Reference data for tutorial taxonomy: categories, tags, and difficulty
 * levels currently used by educational tutorials, with article counts for
 * each value. The data is built locally from fetchAllTutorials() and does
 * not require additional WPGraphQL requests.
 */
export function registerListTutorialTaxonomy(server: McpServer): void {
  server.registerTool(
      "list_tutorial_taxonomy",
      {
        title: "List tutorial taxonomy",
        description:
            "Read-only. Returns tutorial categories, tags, and difficulty levels currently used by educational articles, together with the number of tutorials assigned to each value. " +
            "Use this tool before calling get_tutorials with tag, category, or level filters when the exact available value is unknown. " +
            "Use get_tutorials to retrieve tutorials matching selected taxonomy values. " +
            "This tool returns taxonomy metadata, not tutorial articles. " +
            "Values are ordered by tutorial count in descending order. " +
            "If no tutorials are available, returns empty categories, tags, and levels arrays.",
        inputSchema: {},
      },
      async () => {
        try {
          const tutorials = await fetchAllTutorials();

          const categoryCounts = new Map<string, number>();
          const tagCounts = new Map<string, number>();
          const levelCounts = new Map<string, number>();

          for (const tutorial of tutorials) {
            for (const category of tutorial.tutorialCategories?.nodes || []) {
              categoryCounts.set(
                  category.name,
                  (categoryCounts.get(category.name) ?? 0) + 1,
              );
            }

            for (const tag of tutorial.tutorialTags?.nodes || []) {
              tagCounts.set(tag.name, (tagCounts.get(tag.name) ?? 0) + 1);
            }

            const level = levelOf(tutorial.tutorialFields?.tutorialLevel);

            if (level) {
              levelCounts.set(level, (levelCounts.get(level) ?? 0) + 1);
            }
          }

          const toSortedArray = (counts: Map<string, number>) =>
              Array.from(counts.entries())
                  .map(([name, count]) => ({ name, count }))
                  .sort((left, right) => right.count - left.count);

          return jsonResult({
            totalTutorials: tutorials.length,
            categories: toSortedArray(categoryCounts),
            tags: toSortedArray(tagCounts),
            levels: toSortedArray(levelCounts),
          });
        } catch (error) {
          return errorResult(
              `Error retrieving tutorial taxonomy: ${(error as Error).message}`,
          );
        }
      },
  );
}
