import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { fetchAllTutorials, levelOf, facetOf } from "../lib/tutorials.js";

/**
 * Reference data for tutorial taxonomy: categories, tags, and difficulty
 * levels currently used by educational tutorials, with article counts for
 * each value. The data is built locally from fetchAllTutorials() and does
 * not require additional WPGraphQL requests.
 *
 * Tags include ACF metadata fields (facet, status, publicFilter) sourced
 * from the TagSettings ACF group in WordPress. Tags are grouped by facet
 * when groupByFacet is true.
 */
export function registerListTutorialTaxonomy(server: McpServer): void {
  server.registerTool(
      "list_tutorial_taxonomy",
      {
        title: "List tutorial taxonomy",
        description:
            "Read-only. Returns tutorial categories, tags, and difficulty levels currently used by educational articles, together with the number of tutorials assigned to each value. " +
            "Tags include ACF metadata: facet (component | technique | material | context), status (active | deprecated), and publicFilter (whether the tag is shown in UI filters). " +
            "Use includeDeprecated=true to include deprecated tags for audit purposes (excluded by default). " +
            "Use groupByFacet=true to receive tags grouped by their facet type instead of a flat list. " +
            "Use this tool before calling get_tutorials with tag, category, or level filters when the exact available value is unknown. " +
            "Use get_tutorials to retrieve tutorials matching selected taxonomy values. " +
            "This tool returns taxonomy metadata, not tutorial articles. " +
            "Values are ordered by tutorial count in descending order. " +
            "If no tutorials are available, returns empty categories, tags, and levels arrays.",
        inputSchema: {
          includeDeprecated: z
              .boolean()
              .optional()
              .default(false)
              .describe(
                  "When true, includes tags with status='deprecated' in the result. " +
                  "Default: false (only active tags are returned).",
              ),
          groupByFacet: z
              .boolean()
              .optional()
              .default(false)
              .describe(
                  "When true, returns tags grouped by facet type " +
                  "(component, technique, material, context, unclassified) " +
                  "instead of a flat sorted list.",
              ),
        },
      },
      async ({ includeDeprecated = false, groupByFacet = false }) => {
        try {
          const tutorials = await fetchAllTutorials();

          const categoryCounts = new Map<string, number>();
          const levelCounts = new Map<string, number>();

          // Tag metadata map: slug → { name, facet, status, publicFilter, count }
          interface TagMeta {
            name: string;
            slug: string;
            facet: string;
            status: string;
            publicFilter: boolean;
            count: number;
          }
          const tagMap = new Map<string, TagMeta>();

          for (const tutorial of tutorials) {
            for (const category of tutorial.tutorialCategories?.nodes || []) {
              categoryCounts.set(
                  category.name,
                  (categoryCounts.get(category.name) ?? 0) + 1,
              );
            }

            for (const tag of tutorial.tutorialTags?.nodes || []) {
              const facet = facetOf(tag.tagSettings?.facet) ?? "unclassified";
              const status =
                  (tag.tagSettings?.status ?? [])[0] ?? "active";
              const publicFilter =
                  tag.tagSettings?.public ?? false;

              // Filter deprecated tags unless explicitly requested
              if (status === "deprecated" && !includeDeprecated) continue;

              const existing = tagMap.get(tag.slug);
              if (existing) {
                existing.count += 1;
              } else {
                tagMap.set(tag.slug, {
                  name: tag.tagSettings?.prefferedLabel ?? tag.name,
                  slug: tag.slug,
                  facet,
                  status,
                  publicFilter,
                  count: 1,
                });
              }
            }

            const level = levelOf(tutorial.tutorialFields?.tutorialLevel);
            if (level) {
              levelCounts.set(level, (levelCounts.get(level) ?? 0) + 1);
            }
          }

          const toSortedArray = (counts: Map<string, number>) =>
              Array.from(counts.entries())
                  .map(([name, count]) => ({ name, count }))
                  .sort((a, b) => b.count - a.count);

          const allTags = Array.from(tagMap.values()).sort(
              (a, b) => b.count - a.count,
          );

          // Build tag output: flat list or grouped by facet
          const FACET_ORDER = [
            "component",
            "technique",
            "material",
            "context",
            "unclassified",
          ];

          const tagOutput = groupByFacet
              ? buildGroupedTags(allTags, FACET_ORDER)
              : allTags;

          return jsonResult({
            totalTutorials: tutorials.length,
            categories: toSortedArray(categoryCounts),
            tags: tagOutput,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TagMeta {
  name: string;
  slug: string;
  facet: string;
  status: string;
  publicFilter: boolean;
  count: number;
}

interface TagGroup {
  facet: string;
  tags: TagMeta[];
}

function buildGroupedTags(tags: TagMeta[], facetOrder: string[]): TagGroup[] {
  const groups = new Map<string, TagMeta[]>();

  for (const tag of tags) {
    const bucket = groups.get(tag.facet) ?? [];
    bucket.push(tag);
    groups.set(tag.facet, bucket);
  }

  return facetOrder
      .filter((f) => groups.has(f))
      .map((f) => ({ facet: f, tags: groups.get(f)! }));
}
