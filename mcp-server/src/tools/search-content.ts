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
 * Загружаем все опубликованные build-log записи категории Builds, затем
 * фильтруем их локально. Это сознательное решение:
 *
 * - WPGraphQL `where.search` не ищет по ACF buildlog.modelslug;
 * - modelslug содержит техническую связь с моделью;
 * - title и historicalYear модели берутся через fetchAllModels();
 * - поэтому запрос "Le Requin 1750" может совпасть одновременно с
 *   modelTitle = "Le Requin" и historicalYear = "1750";
 * - запрос "Le Requin hull" может совпасть с modelTitle и title части.
 *
 * Объём контента сайта сейчас мал, а верхняя граница в 100 записей уже
 * используется в wp-models.ts::GET_BUILD_PARTS.
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

// У кастомного резолвера tutorialsFiltered нет подтверждённого аргумента search,
// поэтому статьи ищем клиентской фильтрацией по заголовку и тизеру.
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
        .describe("Search query for full-text search across build logs and articles."),
    limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(20)
        .describe("Максимальное количество результатов (на каждую категорию)."),
};

/**
 * Приводит human-readable title, slug, год и HTML excerpt к единому виду:
 *
 * "Le Requin"       -> "le requin"
 * "le-requin"       -> "le requin"
 * "1750"            -> "1750"
 * "<p>The hull</p>" -> "the hull"
 *
 * Это позволяет сопоставлять запросы с пробелами со значением modelslug,
 * где слова разделены дефисом.
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
    const normalizedFields = fields.map(([field, value]) => [
        field,
        normalizeSearchText(value),
    ] as const);

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
            title: "Поиск по контенту",
            description:
                "Searches build logs by model title, model slug, historical year, " +
                "part title and excerpt, and searches tutorials by title and short description.",
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
                            url: buildLogPartUrl(
                                modelSlug,
                                post.buildlog?.partnumber,
                            ),
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
                        "Build-log searches match every query term against the model title, " +
                        "model slug, historical year, part title and excerpt. Tutorial searches " +
                        "match every term against the title and short description (teaser), not " +
                        "the full article text.",
                });
            } catch (error) {
                return errorResult(`Error searching content: ${(error as Error).message}`);
            }
        },
    );
}
