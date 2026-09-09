import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { buildUrl, tutorialUrl } from "../lib/public-urls.js";
import { stripHtmlAndTruncate } from "../lib/wp-models.js";
import {
  fetchAllTutorials,
  fetchTutorialBySlug,
  levelOf,
} from "../lib/tutorials.js";

const inputSchema = {
  slug: z
      .string()
      .optional()
      .describe(
          "Optional stable tutorial slug. When provided, returns the complete content and metadata for one tutorial. When omitted, returns a filtered list of tutorial summaries.",
      ),

  tag: z
      .string()
      .optional()
      .describe(
          "Optional filter for tutorial tags. Uses a case-insensitive partial match against tag names. Applies only when slug is omitted.",
      ),

  category: z
      .string()
      .optional()
      .describe(
          "Optional filter for tutorial categories. Uses a case-insensitive partial match against category names. Applies only when slug is omitted.",
      ),

  level: z
      .string()
      .optional()
      .describe(
          "Optional filter for tutorial difficulty level. Uses an exact match, for example 'beginner'. Applies only when slug is omitted.",
      ),
};

export function registerGetTutorials(server: McpServer): void {
  server.registerTool(
      "get_tutorials",
      {
        title: "Get tutorials",
        description:
            "Read-only. Returns educational tutorials from the site, optionally filtered by tag, category, or difficulty level. " +
            "Use this tool to browse tutorials and filter them by taxonomy. When a slug is provided, it returns the content and metadata for that one tutorial. " +
            "Use get_tutorial_by_title when the user knows an article title but not its slug. " +
            "Use search_tutorial_content when the user knows only a term, technique, material, tool, or instruction that may occur inside a tutorial. " +
            "Use list_tutorial_taxonomy when the exact available category, tag, or difficulty-level value is unknown. " +
            "Without a slug, returns tutorial summaries and metadata. If no tutorials match the filters, returns an empty tutorials array. " +
            "If a provided slug does not exist, returns a not-found result.",
        inputSchema,
      },
      async ({ slug, tag, category, level }) => {
        try {
          if (slug) {
            const tutorial = await fetchTutorialBySlug(slug);

            if (!tutorial) {
              return errorResult(`Tutorial with slug='${slug}' not found.`);
            }

            const relatedBuilds = (
                tutorial.tutorialFields?.tutorialRelatedBuilds?.nodes || []
            )
                .filter((node) => node.__typename === "Model")
                .map((node) => ({
                  title: node.title,
                  slug: node.slug,
                  url: buildUrl(node.slug),
                  shortDescription: node.modelinfo?.shortdescription ?? null,
                  scale: node.modelinfo?.modelscale ?? null,
                }));

            const relatedTutorials = (
                tutorial.tutorialFields?.tutorialRelatedTutorials?.nodes || []
            )
                .filter((node) => node.__typename === "Tutorial")
                .map((node) => ({
                  title: node.title,
                  slug: node.slug,
                  url: tutorialUrl(node.slug),
                  teaser: node.tutorialFields?.tutorialTeaser ?? null,
                  level: levelOf(node.tutorialFields?.tutorialLevel),
                }));

            return jsonResult({
              title: tutorial.title,
              slug: tutorial.slug,
              url: tutorialUrl(tutorial.slug),
              teaser: tutorial.tutorialFields?.tutorialTeaser ?? null,
              level: levelOf(tutorial.tutorialFields?.tutorialLevel),
              views: tutorial.tutorialFields?.views ?? 0,
              content: stripHtmlAndTruncate(tutorial.content, 4000),
              categories: (tutorial.tutorialCategories?.nodes || []).map(
                  (categoryNode) => categoryNode.name,
              ),
              tags: (tutorial.tutorialTags?.nodes || []).map(
                  (tagNode) => tagNode.name,
              ),
              relatedBuilds,
              relatedTutorials,
            });
          }

          let tutorials = await fetchAllTutorials();

          if (tag) {
            const needle = tag.trim().toLowerCase();

            tutorials = tutorials.filter((tutorial) =>
                (tutorial.tutorialTags?.nodes || []).some((tagNode) =>
                    tagNode.name.toLowerCase().includes(needle),
                ),
            );
          }

          if (category) {
            const needle = category.trim().toLowerCase();

            tutorials = tutorials.filter((tutorial) =>
                (tutorial.tutorialCategories?.nodes || []).some(
                    (categoryNode) =>
                        categoryNode.name.toLowerCase().includes(needle),
                ),
            );
          }

          if (level) {
            tutorials = tutorials.filter(
                (tutorial) =>
                    levelOf(tutorial.tutorialFields?.tutorialLevel) === level,
            );
          }

          const results = tutorials.map((tutorial) => ({
            title: tutorial.title,
            slug: tutorial.slug,
            url: tutorialUrl(tutorial.slug),
            teaser: tutorial.tutorialFields?.tutorialTeaser ?? null,
            level: levelOf(tutorial.tutorialFields?.tutorialLevel),
            views: tutorial.tutorialFields?.views ?? 0,
            categories: (tutorial.tutorialCategories?.nodes || []).map(
                (categoryNode) => categoryNode.name,
            ),
            tags: (tutorial.tutorialTags?.nodes || []).map(
                (tagNode) => tagNode.name,
            ),
          }));

          return jsonResult({
            total: results.length,
            tutorials: results,
          });
        } catch (error) {
          return errorResult(
              `Error retrieving tutorials: ${(error as Error).message}`,
          );
        }
      },
  );
}
