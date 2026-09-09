import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { requestWithTimeout } from "../lib/graphql-client.js";
import { buildLogPartUrl, tutorialUrl } from "../lib/public-urls.js";
import {
    fetchAllModels,
    stripHtmlAndTruncate,
} from "../lib/wp-models.js";

interface BuildLogSearchNode {
    id: string;
    slug: string;
    title: string;
    excerpt?: string | null;
    buildlog?: {
        modelslug?: string | null;
        partnumber?: string | number | null;
        recordday?: string | null;
    } | null;
}

interface SearchBuildLogsResponse {
    posts: { nodes: BuildLogSearchNode[] };
}

interface TutorialSearchNode {
    id: string;
    title: string;
    slug: string;
    tutorialFields?: { tutorialTeaser?: string | null } | null;
}

interface GetTutorialsForSearchResponse {
    tutorialsFiltered: TutorialSearchNode[];
}

/**
 * Fetch all published Build Log posts and filter them locally.
 *
 * This is intentional because WPGraphQL where.search does not search the
 * ACF buildlog.modelslug field. A model slug provides the technical link to
 * its model, while model title and historical year are obtained from
 * fetchAllModels(). This allows a query such as "Le Requin 1750" to match
 * both the model title and historical year, and "Le Requin hull" to match a
 * model title and a build-log part title.
 *
 * The site currently has a small content volume. The 100-item upper bound
 * matches the existing Build Log query limit in wp-models.ts.
 */
const BUILD_LOGS_FOR_SEARCH_QUERY = `
  query GetBuildLogsForSearch {
    posts(where: { categoryName: "Builds" }, first: 100) {
      nodes {
        id
        slug
        title
        excerpt
        buildlog {
          modelslug
          partnumber
          recordday
        }
      }
    }
  }
`;

/**
 * The custom tutorialsFiltered resolver does not have a confirmed search
 * argument, so tutorial title and teaser matching is performed locally.
 * Full tutorial body text is intentionally not fetched or searched here.
 */
const TUTORIALS_FOR_SEARCH_QUERY = `
  query GetTutorialsForSearch {
    tutorialsFiltered(where: {}) {
      id
      title
      slug
      tutorialFields {
        tutorialTeaser
      }
    }
  }
`;

const inputSchema = {
    query: z
        .string()
        .min(2)
        .describe(
            "Search terms for broad discovery across build-log metadata and tutorial metadata. Every term must match across the searchable fields of one result.",
        ),

    limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(20)
        .describe(
            "Maximum number of results to return for each result type. Default: 20. Maximum: 50.",
        ),
};

/**
 * Normalizes titles, slugs, years, and HTML excerpts for matching:
 *
 * "Le Requin"       -> "le requin"
 * "le-requin"       -> "le requin"
 * "1750"            -> "1750"
 * "<p>The hull</p>" -> "the hull"
 *
 * This allows space-separated query terms to match slugs that use hyphens.
 */
function normalizeSearchText(value: string | null | undefined): string {
    return (value ?? "")
        .replace(/<[^>]*>/g, " ")
        .replace(/[-_/]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase();
}

function tokenizeQuery(query: string): string[] {
    return normalizeSearchText(query)
        .split(" ")
        .filter(Boolean);
}

type MatchedField =
    | "modelTitle"
    | "modelSlug"
    | "historicalYear"
    | "title"
    | "excerpt"
    | "teaser";

function getMatchedFields(
    fields: Array<[MatchedField, string | null | undefined]>,
    searchTerms: string[],
): MatchedField[] {
    const normalizedFields = fields.map(
        ([field, value]) => [field, normalizeSearchText(value)] as const,
    );

    const searchableText = normalizedFields
        .map(([, value]) => value)
        .filter(Boolean)
        .join(" ");

    const matchesAllTerms = searchTerms.every((term) =>
        searchableText.includes(term),
    );

    if (!matchesAllTerms) {
        return [];
    }

    return normalizedFields
        .filter(([, value]) => searchTerms.some((term) => value.includes(term)))
        .map(([field]) => field);
}

export function registerSearchContent(server: McpServer): void {
    server.registerTool(
        "search_content",
        {
            title: "Search site content",
            description:
                "Read-only. Searches build-log metadata and tutorial metadata by keyword. " +
                "Build-log matches use model title, model slug, historical year, part title, and excerpt. " +
                "Tutorial matches use tutorial title and short description only. " +
                "Use this tool for broad content discovery when the relevant model or tutorial is not yet known. " +
                "Use search_tutorial_content when the requested term, technique, material, tool, or instruction may occur inside the complete body text of a tutorial. " +
                "Use get_build_details or get_tutorials to retrieve details after identifying a relevant result. " +
                "Every query term must match across the searchable fields of a result. " +
                "Returns separate buildLogResults and tutorialResults arrays, each limited to the requested limit. " +
                "If no content matches, both result arrays are empty.",
            inputSchema,
        },
        async ({ query, limit }) => {
            try {
                const searchTerms = tokenizeQuery(query);

                const [buildLogsData, models, tutorialsData] = await Promise.all([
                    requestWithTimeout<SearchBuildLogsResponse>(
                        BUILD_LOGS_FOR_SEARCH_QUERY,
                    ),
                    fetchAllModels(),
                    requestWithTimeout<GetTutorialsForSearchResponse>(
                        TUTORIALS_FOR_SEARCH_QUERY,
                    ),
                ]);

                const modelMetadataBySlug = new Map(
                    models.map((model) => [
                        model.slug.toLowerCase(),
                        {
                            title: model.title,
                            historicalYear: model.modelinfo?.historicalyear ?? null,
                        },
                    ]),
                );

                const buildLogResults = buildLogsData.posts.nodes
                    .map((post) => {
                        const modelSlug = post.buildlog?.modelslug ?? null;

                        const modelMetadata = modelSlug
                            ? modelMetadataBySlug.get(modelSlug.toLowerCase()) ?? null
                            : null;

                        const modelTitle = modelMetadata?.title ?? null;
                        const historicalYear = modelMetadata?.historicalYear ?? null;

                        const matchedFields = getMatchedFields(
                            [
                                ["modelTitle", modelTitle],
                                ["modelSlug", modelSlug],
                                ["historicalYear", historicalYear],
                                ["title", post.title],
                                ["excerpt", post.excerpt],
                            ],
                            searchTerms,
                        );

                        return {
                            post,
                            modelSlug,
                            modelTitle,
                            historicalYear,
                            matchedFields,
                        };
                    })
                    .filter(({ matchedFields }) => matchedFields.length > 0)
                    .slice(0, limit)
                    .map(
                        ({
                             post,
                             modelSlug,
                             modelTitle,
                             historicalYear,
                             matchedFields,
                         }) => ({
                            type: "build-log-part" as const,
                            title: post.title,
                            slug: post.slug,
                            modelSlug,
                            modelTitle,
                            historicalYear,
                            partNumber: post.buildlog?.partnumber ?? null,
                            url: buildLogPartUrl(modelSlug, post.buildlog?.partnumber),
                            recordDay: post.buildlog?.recordday ?? null,
                            excerpt: stripHtmlAndTruncate(post.excerpt, 200),
                            matchedFields,
                        }),
                    );

                const tutorialResults = tutorialsData.tutorialsFiltered
                    .map((tutorial) => {
                        const matchedFields = getMatchedFields(
                            [
                                ["title", tutorial.title],
                                ["teaser", tutorial.tutorialFields?.tutorialTeaser],
                            ],
                            searchTerms,
                        );

                        return {
                            tutorial,
                            matchedFields,
                        };
                    })
                    .filter(({ matchedFields }) => matchedFields.length > 0)
                    .slice(0, limit)
                    .map(({ tutorial, matchedFields }) => ({
                        type: "tutorial" as const,
                        title: tutorial.title,
                        slug: tutorial.slug,
                        url: tutorialUrl(tutorial.slug),
                        excerpt: stripHtmlAndTruncate(
                            tutorial.tutorialFields?.tutorialTeaser,
                            200,
                        ),
                        matchedFields,
                    }));

                return jsonResult({
                    query,
                    searchTerms,
                    totalBuildLogResults: buildLogResults.length,
                    totalTutorialResults: tutorialResults.length,
                    buildLogResults,
                    tutorialResults,
                    note:
                        "Build-log searches match every query term across model title, model slug, historical year, part title, and excerpt. " +
                        "Tutorial searches match every query term across tutorial title and short description only; full tutorial body text is not searched.",
                });
            } catch (error) {
                return errorResult(
                    `Error searching content: ${(error as Error).message}`,
                );
            }
        },
    );
}
