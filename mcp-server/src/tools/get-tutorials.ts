import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { buildUrl, tutorialUrl } from "../lib/public-urls.js";
import { stripHtmlAndTruncate } from "../lib/wp-models.js";
import { fetchAllTutorials, fetchTutorialBySlug, levelOf } from "../lib/tutorials.js";

const inputSchema = {
  slug: z
    .string()
    .optional()
    .describe(
      "The slug of a specific educational article. If not specified, a list of all articles is returned.",
    ),
  tag: z
    .string()
    .optional()
    .describe("Article list filter by tag (partial tag name match, case-insensitive)."),
  category: z
    .string()
    .optional()
    .describe("Filter the list of articles by category (partial match of the category name)."),
  level: z
    .string()
    .optional()
    .describe("Article list filter by difficulty level (exact match, e.g., 'beginner')."),
};

export function registerGetTutorials(server: McpServer): void {
  server.registerTool(
    "get_tutorials",
    {
      title: "Tutorials",
      description:
        "Returns a list of the site's educational articles (optionally filtered by tag, category " +
        "or level) or the full content of a specific article based on its slug.",
      inputSchema,
    },
    async ({ slug, tag, category, level }) => {
      try {
        if (slug) {
          const t = await fetchTutorialBySlug(slug);

          if (!t) {
            return errorResult(`Tutorial with slug='${slug}' not found.`);
          }

          const relatedBuilds = (t.tutorialFields?.tutorialRelatedBuilds?.nodes || [])
            .filter((n) => n.__typename === "Model")
            .map((n) => ({
              title: n.title,
              slug: n.slug,
              url: buildUrl(n.slug),
              shortDescription: n.modelinfo?.shortdescription ?? null,
              scale: n.modelinfo?.modelscale ?? null,
            }));
          const relatedTutorials = (t.tutorialFields?.tutorialRelatedTutorials?.nodes || [])
            .filter((n) => n.__typename === "Tutorial")
            .map((n) => ({
              title: n.title,
              slug: n.slug,
              url: tutorialUrl(n.slug),
              teaser: n.tutorialFields?.tutorialTeaser ?? null,
              level: levelOf(n.tutorialFields?.tutorialLevel),
            }));

          return jsonResult({
            title: t.title,
            slug: t.slug,
            url: tutorialUrl(t.slug),
            teaser: t.tutorialFields?.tutorialTeaser ?? null,
            level: levelOf(t.tutorialFields?.tutorialLevel),
            views: t.tutorialFields?.views ?? 0,
            content: stripHtmlAndTruncate(t.content, 4000),
            categories: (t.tutorialCategories?.nodes || []).map((c) => c.name),
            tags: (t.tutorialTags?.nodes || []).map((tg) => tg.name),
            relatedBuilds,
            relatedTutorials,
          });
        }

        let tutorials = await fetchAllTutorials();

        if (tag) {
          const needle = tag.trim().toLowerCase();
          tutorials = tutorials.filter((t) =>
            (t.tutorialTags?.nodes || []).some((tg) => tg.name.toLowerCase().includes(needle)),
          );
        }

        if (category) {
          const needle = category.trim().toLowerCase();
          tutorials = tutorials.filter((t) =>
            (t.tutorialCategories?.nodes || []).some((c) => c.name.toLowerCase().includes(needle)),
          );
        }

        if (level) {
          tutorials = tutorials.filter((t) => levelOf(t.tutorialFields?.tutorialLevel) === level);
        }

        const results = tutorials.map((t) => ({
          title: t.title,
          slug: t.slug,
          url: tutorialUrl(t.slug),
          teaser: t.tutorialFields?.tutorialTeaser ?? null,
          level: levelOf(t.tutorialFields?.tutorialLevel),
          views: t.tutorialFields?.views ?? 0,
          categories: (t.tutorialCategories?.nodes || []).map((c) => c.name),
          tags: (t.tutorialTags?.nodes || []).map((tg) => tg.name),
        }));

        return jsonResult({ total: results.length, tutorials: results });
      } catch (error) {
        return errorResult(
          `Error retrieving tutorials: ${(error as Error).message}`,
        );
      }
    },
  );
}
