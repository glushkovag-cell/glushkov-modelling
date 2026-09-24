// mcp-server/src/tools/search-tutorial-content.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { tutorialUrl } from "../lib/public-urls.js";
import { fetchAllTutorials, levelOf, activeTagsOf } from "../lib/tutorials.js";
import {
    createExcerpt,
    findTutorialTextMatch,
    getSearchTerms,
} from "../lib/tutorial-search.js";

/**
 * Full-text search across tutorial content, not only title and teaser fields
 * as in search_content. Matching is performed in the MCP server because the
 * custom tutorialsFiltered resolver has no confirmed WPGraphQL search support.
 */
const inputSchema = {
    query: z
        .string()
        .min(2)
        .describe(
            "Search terms for educational tutorial title, summary, tags, and full article content. Every query term is evaluated by the tutorial text-matching logic.",
        ),

    limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(20)
        .describe(
            "Maximum number of matching tutorials to return. Default: 20. Maximum: 50.",
        ),
};

export function registerSearchTutorialContent(server: McpServer): void {
    server.registerTool(
        "search_tutorial_content",
        {
            title: "Search tutorial content",
            description:
                "Read-only. Searches educational tutorials by full article body text, title, summary, and tags. " +
                "Use this tool when the user asks about a term, technique, material, tool, or instruction that may occur inside a tutorial. " +
                "Use search_content for broad discovery across build-log metadata and tutorial metadata when full tutorial body text is not required. " +
                "Use get_tutorials to browse tutorials or retrieve the content and metadata for a tutorial after identifying a relevant result. " +
                "Returns matching tutorial summaries with matchedFields and a relevant excerpt. " +
                "matchedFields may include: title, teaser, content, tags. " +
                "Results are limited to the requested limit. If no tutorial content matches, returns an empty results array.",
            inputSchema,
        },
        async ({ query, limit }) => {
            try {
                const terms = getSearchTerms(query);

                if (terms.length === 0) {
                    return errorResult(
                        "Search query must contain at least one non-whitespace character.",
                    );
                }

                const tutorials = await fetchAllTutorials();

                const matches = tutorials
                    .map((tutorial) => {
                        // Передаём tagNames — имена активных тегов для включения в индекс
                        const activeTags = activeTagsOf(tutorial.tutorialTags?.nodes);
                        const match = findTutorialTextMatch(
                            {
                                title: tutorial.title,
                                teaser: tutorial.tutorialFields?.tutorialTeaser,
                                content: tutorial.content,
                                tagNames: activeTags.map((t) => t.name),
                            },
                            terms,
                        );

                        return match ? { tutorial, match, activeTags } : null;
                    })
                    .filter(
                        (
                            item,
                        ): item is {
                            tutorial: (typeof tutorials)[number];
                            match: NonNullable<ReturnType<typeof findTutorialTextMatch>>;
                            activeTags: ReturnType<typeof activeTagsOf>;
                        } => item !== null,
                    );

                const total = matches.length;

                const results = matches.slice(0, limit).map(({ tutorial, match, activeTags }) => ({
                    title: tutorial.title,
                    slug: tutorial.slug,
                    url: tutorialUrl(tutorial.slug),
                    level: levelOf(tutorial.tutorialFields?.tutorialLevel),
                    // Теги как объекты {name, slug, facet} — консистентно с get_tutorials
                    tags: activeTags.map((t) => ({
                        name: t.name,
                        slug: t.slug,
                        facet: (() => {
                            const v = Array.isArray(t.tagSettings?.facet)
                                ? (t.tagSettings!.facet![0] ?? null)
                                : null;
                            return v === "component" ||
                            v === "technique" ||
                            v === "material" ||
                            v === "context"
                                ? v
                                : null;
                        })(),
                    })),
                    matchedFields: match.matchedFields,
                    excerpt: createExcerpt(
                        match.plainContent,
                        terms[0],
                        tutorial.tutorialFields?.tutorialTeaser,
                    ),
                }));

                return jsonResult({
                    query,
                    total,
                    returned: results.length,
                    results,
                });
            } catch (error) {
                return errorResult(
                    `Full-text search error for tutorials: ${(error as Error).message}`,
                );
            }
        },
    );
}
