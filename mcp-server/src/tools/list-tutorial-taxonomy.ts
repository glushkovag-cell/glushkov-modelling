import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { fetchAllTutorials, levelOf, type TutorialListNode } from "../lib/tutorials.js";
import {
  fetchTaxonomyDictionary,
  TAXONOMY_FACETS,
  type TaxonomyDictionary,
} from "../lib/taxonomy.js";
import {
  appliesToOf,
  collectTutorialTagUsage,
  getTagUsageSnapshot,
  type AppliesTo,
  type TagUsageSnapshot,
} from "../lib/tag-usage.js";

export interface TaxonomyTagOutput {
  name: string;
  slug: string;
  facet: string;
  status: string;
  publicFilter: boolean;
  /** Количество статей с тегом (как и раньше). */
  count: number;
  /** Количество фотографий галереи с тегом. */
  photoCount: number;
  appliesTo: AppliesTo[];
}

interface TagGroup {
  facet: string;
  tags: TaxonomyTagOutput[];
}

const FACET_ORDER = [...TAXONOMY_FACETS, "unclassified"];

export interface BuildTaxonomyTagsOptions {
  includeDeprecated: boolean;
  appliesTo?: AppliesTo;
}

/**
 * Строит список тегов из справочника TutorialTags:
 * - status=active (или любые статусы при includeDeprecated=true);
 * - только теги, назначенные хотя бы одной статье или фотографии
 *   (appliesTo не пуст);
 * - count — фактическое число статей, photoCount — число фотографий.
 */
export function buildTaxonomyTags(
    dictionary: TaxonomyDictionary,
    snapshot: TagUsageSnapshot,
    tutorialCounts: Map<string, number>,
    options: BuildTaxonomyTagsOptions,
): TaxonomyTagOutput[] {
  const tags: TaxonomyTagOutput[] = [];

  for (const term of dictionary.terms) {
    if (term.status !== "active" && !options.includeDeprecated) continue;

    const appliesTo = appliesToOf(term.slug, snapshot);
    if (appliesTo.length === 0) continue;
    if (options.appliesTo && !appliesTo.includes(options.appliesTo)) continue;

    tags.push({
      name: term.name,
      slug: term.slug,
      facet: term.facet ?? "unclassified",
      status: term.status,
      publicFilter: term.publicFilter,
      count: tutorialCounts.get(term.slug) ?? 0,
      photoCount: snapshot.gallery.get(term.slug) ?? 0,
      appliesTo,
    });
  }

  return tags.sort(
      (a, b) =>
          b.count - a.count ||
          b.photoCount - a.photoCount ||
          a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
  );
}

export function buildGroupedTags(tags: TaxonomyTagOutput[]): TagGroup[] {
  const groups = new Map<string, TaxonomyTagOutput[]>();

  for (const tag of tags) {
    const bucket = groups.get(tag.facet) ?? [];
    bucket.push(tag);
    groups.set(tag.facet, bucket);
  }

  return FACET_ORDER.filter((f) => groups.has(f)).map((f) => ({
    facet: f,
    tags: groups.get(f)!,
  }));
}

function countCategoriesAndLevels(tutorials: TutorialListNode[]) {
  const categoryCounts = new Map<string, number>();
  const levelCounts = new Map<string, number>();

  for (const tutorial of tutorials) {
    for (const category of tutorial.tutorialCategories?.nodes || []) {
      categoryCounts.set(category.name, (categoryCounts.get(category.name) ?? 0) + 1);
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

  return {
    categories: toSortedArray(categoryCounts),
    levels: toSortedArray(levelCounts),
  };
}

/**
 * Справочник единой таксономии Gallery / Tutorials.
 *
 * Теги берутся непосредственно из TutorialTags (ACF Tutorial Tag Settings)
 * со status=active; в выдачу попадают только теги, назначенные хотя бы одной
 * статье или фотографии. appliesTo рассчитывается по фактическим данным и
 * кэшируется на 60 минут. Категории и уровни — как и раньше, по статьям.
 */
export function registerListTutorialTaxonomy(server: McpServer): void {
  server.registerTool(
      "list_tutorial_taxonomy",
      {
        title: "List tutorial taxonomy",
        description:
            "Read-only. Returns the shared taxonomy dictionary used by both tutorials and gallery photos, plus tutorial categories and difficulty levels with tutorial counts. " +
            "Tags come from the TutorialTags taxonomy (ACF Tutorial Tag Settings) with status='active' and are listed only when assigned to at least one tutorial or at least one gallery photo. " +
            "Each tag has slug, name, facet (component | technique | material | context | view | unclassified), status, publicFilter (shown in tutorial UI filters), " +
            "count (number of tutorials), photoCount (number of gallery photos), and appliesTo — an array with 'tutorials', 'gallery', or both, computed from actual assignments (cached up to 60 minutes). " +
            "Use tags with 'tutorials' in appliesTo as values for get_tutorials tag/tagFacet filters, and tags with 'gallery' in appliesTo as values for list_gallery_photos tag/tagFacet filters. " +
            "Use appliesTo='tutorials' or appliesTo='gallery' to return only tags used in that area. " +
            "Use includeDeprecated=true to also include non-active (deprecated or hidden) tags for audit purposes. " +
            "Use groupByFacet=true to receive tags grouped by facet instead of a flat list. " +
            "Tags are ordered by tutorial count, then photo count, descending; categories and levels by tutorial count. " +
            "This tool returns taxonomy metadata, not tutorial articles or photos. " +
            "If nothing is available, returns empty categories, tags, and levels arrays.",
        inputSchema: {
          includeDeprecated: z
              .boolean()
              .optional()
              .default(false)
              .describe(
                  "When true, also includes tags whose status is not 'active' (deprecated or hidden), if they are assigned to tutorials or photos. " +
                  "Default: false (only active tags are returned).",
              ),
          groupByFacet: z
              .boolean()
              .optional()
              .default(false)
              .describe(
                  "When true, returns tags grouped by facet " +
                  "(component, technique, material, context, view, unclassified) " +
                  "instead of a flat sorted list.",
              ),
          appliesTo: z
              .enum(["tutorials", "gallery"])
              .optional()
              .describe(
                  "Optional filter: 'tutorials' returns only tags assigned to at least one tutorial, 'gallery' only tags assigned to at least one gallery photo. " +
                  "When omitted, returns tags used in either area.",
              ),
        },
      },
      async ({ includeDeprecated = false, groupByFacet = false, appliesTo }) => {
        try {
          const [tutorials, dictionary] = await Promise.all([
            fetchAllTutorials(),
            fetchTaxonomyDictionary(),
          ]);

          const snapshot = await getTagUsageSnapshot({
            loadTutorials: fetchAllTutorials,
          });

          const tags = buildTaxonomyTags(
              dictionary,
              snapshot,
              collectTutorialTagUsage(tutorials),
              { includeDeprecated, appliesTo },
          );

          const { categories, levels } = countCategoriesAndLevels(tutorials);

          const result: Record<string, unknown> = {
            totalTutorials: tutorials.length,
            categories,
            tags: groupByFacet ? buildGroupedTags(tags) : tags,
            levels,
            appliesToComputedAt: new Date(snapshot.computedAt).toISOString(),
          };

          if (!snapshot.galleryAvailable) {
            result.note =
                "Gallery manifests were unavailable when appliesTo was computed; 'gallery' usage may be missing until the next refresh.";
          }

          return jsonResult(result);
        } catch (error) {
          return errorResult(
              `Error retrieving tutorial taxonomy: ${(error as Error).message}`,
          );
        }
      },
  );
}
