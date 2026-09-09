import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { buildUrl, tutorialUrl } from "../lib/public-urls.js";
import { stripHtmlAndTruncate } from "../lib/wp-models.js";
import {
    fetchAllTutorials,
    fetchTutorialBySlug,
    findTutorialByTitle,
    levelOf,
} from "../lib/tutorials.js";

const inputSchema = {
    title: z
        .string()
        .min(1)
        .describe(
            "Human-readable tutorial title. Matching is case-insensitive: an exact title match is preferred, followed by a partial title match.",
        ),
};

export function registerGetTutorialByTitle(server: McpServer): void {
    server.registerTool(
        "get_tutorial_by_title",
        {
            title: "Get tutorial by title",
            description:
                "Read-only. Finds one educational tutorial by its human-readable title and returns its content and metadata. " +
                "Use this tool when the user knows an article title but does not know its slug. " +
                "Use get_tutorials to browse or filter tutorials, or to retrieve one tutorial when its slug is known. " +
                "Use search_tutorial_content when the user knows only a term, technique, material, tool, or instruction that may occur inside a tutorial. " +
                "The tool prefers an exact case-insensitive title match and otherwise uses a case-insensitive partial title match. " +
                "Returns a not-found result if no tutorial matches the provided title.",
            inputSchema,
        },
        async ({ title }) => {
            try {
                const tutorials = await fetchAllTutorials();
                const match = findTutorialByTitle(tutorials, title);

                if (!match) {
                    return errorResult(
                        `Tutorial with title '${title}' not found. Available tutorials: ${tutorials
                            .map((tutorial) => tutorial.title)
                            .join(", ")}.`,
                    );
                }

                const fullTutorial = await fetchTutorialBySlug(match.slug);
                const tutorial = fullTutorial ?? match;

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
                        (category) => category.name,
                    ),
                    tags: (tutorial.tutorialTags?.nodes || []).map(
                        (tag) => tag.name,
                    ),
                    relatedBuilds,
                    relatedTutorials,
                });
            } catch (error) {
                return errorResult(
                    `Error retrieving tutorial by title: ${(error as Error).message}`,
                );
            }
        },
    );
}
