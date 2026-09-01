import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { tutorialUrl } from "../lib/public-urls.js";
import { fetchAllTutorials, levelOf } from "../lib/tutorials.js";
import {
    createExcerpt,
    findTutorialTextMatch,
    getSearchTerms,
} from "../lib/tutorial-search.js";

/**
 * Полнотекстовый поиск по содержимому статей (не только по title/teaser, как в search_content).
 * Фильтрация выполняется на стороне MCP-сервера, поскольку custom resolver
 * tutorialsFiltered не подтверждён на поддержку search в WPGraphQL.
 */

const inputSchema = {
    query: z
        .string()
        .min(2)
        .describe(
            "Search query for full-text search within educational article content.",
        ),
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
            title: "Search within tutorial content",
            description:
                "Searches educational articles by full body content, title, and summary. " +
                "Unlike search_content, this tool searches within the complete article text. " +
                "Use it when the requested term, technique, material, or instruction may occur " +
                "inside an article rather than in its title or teaser.",
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
                        const match = findTutorialTextMatch(
                            {
                                title: tutorial.title,
                                teaser: tutorial.tutorialFields?.tutorialTeaser,
                                content: tutorial.content,
                            },
                            terms,
                        );

                        return match ? { tutorial, match } : null;
                    })
                    .filter(
                        (
                            item,
                        ): item is {
                            tutorial: (typeof tutorials)[number];
                            match: NonNullable<
                                ReturnType<typeof findTutorialTextMatch>
                            >;
                        } => item !== null,
                    );

                const total = matches.length;
                const results = matches.slice(0, limit).map(({ tutorial, match }) => ({
                    title: tutorial.title,
                    slug: tutorial.slug,
                    url: tutorialUrl(tutorial.slug),
                    level: levelOf(tutorial.tutorialFields?.tutorialLevel),
                    tags: (tutorial.tutorialTags?.nodes || []).map((tag) => tag.name),
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