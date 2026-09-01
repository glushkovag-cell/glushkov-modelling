import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { buildUrl, tutorialUrl } from "../lib/public-urls.js";
import { stripHtmlAndTruncate } from "../lib/wp-models.js";
import { fetchAllTutorials, fetchTutorialBySlug, findTutorialByTitle, levelOf } from "../lib/tutorials.js";

const inputSchema = {
  title: z
    .string()
    .min(1)
    .describe(
        "Title of the educational article (full or partial, case-insensitive). " +
        "Searches for an exact title match first, followed by a partial match.",
    ),
};

export function registerGetTutorialByTitle(server: McpServer): void {
  server.registerTool(
    "get_tutorial_by_title",
    {
      title: "Tutorial by name",
      description:
        "Finds an educational article by its human-readable title (without needing to know " +
        "its slug in advance) and returns the full content of the article.",
      inputSchema,
    },
    async ({ title }) => {
      try {
        const tutorials = await fetchAllTutorials();
        const match = findTutorialByTitle(tutorials, title);

        if (!match) {
          return errorResult(
            `Tutotial with title '${title}' not found. Available tutorials: ${tutorials
              .map((t) => t.title)
              .join(", ")}.`,
          );
        }

        const full = await fetchTutorialBySlug(match.slug);
        const t = full ?? match;

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
      } catch (error) {
        return errorResult(
          `Error retrieving tutorial by title : ${(error as Error).message}`,
        );
      }
    },
  );
}
