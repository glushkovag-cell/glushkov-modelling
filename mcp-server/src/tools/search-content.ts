import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { requestWithTimeout } from "../lib/graphql-client.js";
import { buildLogPartUrl, tutorialUrl } from "../lib/public-urls.js";
import { stripHtmlAndTruncate } from "../lib/wp-models.js";

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

// Поиск использует стандартный аргумент `search` WPGraphQL (WP_Query search),
// применённый к постам категории "Builds" (build-логи) — та же категория,
// что используется в src/lib/wordpress.ts::getBuildPartsByModel.
const SEARCH_BUILD_LOGS_QUERY = `
  query SearchBuildLogs($search: String!, $limit: Int!) {
    posts(where: { search: $search, categoryName: "Builds" }, first: $limit) {
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

export function registerSearchContent(server: McpServer): void {
  server.registerTool(
    "search_content",
    {
      title: "Поиск по контенту",
      description:
        "Searches through build logs (full-text, via WPGraphQL) and " +
        "the site's tutorials (by title and short description).",
      inputSchema,
    },
    async ({ query, limit }) => {
      try {
        const [buildLogsData, tutorialsData] = await Promise.all([
          requestWithTimeout<SearchBuildLogsResponse>(SEARCH_BUILD_LOGS_QUERY, {
            search: query,
            limit,
          }),
          requestWithTimeout<GetTutorialsForSearchResponse>(TUTORIALS_FOR_SEARCH_QUERY),
        ]);

        const buildLogResults = buildLogsData.posts.nodes.map((post) => ({
          type: "build-log-part" as const,
          title: post.title,
          slug: post.slug,
          modelSlug: post.buildlog?.modelslug ?? null,
          partNumber: post.buildlog?.partnumber ?? null,
          url: buildLogPartUrl(post.buildlog?.modelslug, post.buildlog?.partnumber),
          recordDay: post.buildlog?.recordday ?? null,
          excerpt: stripHtmlAndTruncate(post.excerpt, 200),
        }));

        const needle = query.trim().toLowerCase();
        const tutorialResults = tutorialsData.tutorialsFiltered
          .filter(
            (t) =>
              t.title.toLowerCase().includes(needle) ||
              (t.tutorialFields?.tutorialTeaser || "").toLowerCase().includes(needle),
          )
          .slice(0, limit)
          .map((t) => ({
            type: "tutorial" as const,
            title: t.title,
            slug: t.slug,
            url: tutorialUrl(t.slug),
            excerpt: stripHtmlAndTruncate(t.tutorialFields?.tutorialTeaser, 200),
          }));

        return jsonResult({
          query,
          totalBuildLogResults: buildLogResults.length,
          totalTutorialResults: tutorialResults.length,
          buildLogResults,
          tutorialResults,
          note:
            "Article searches are performed based on the title and short description (teaser), " +
            "not the full text—the WPGraphQL resolver for educational articles does not support " +
            "full-text search.",
        });
      } catch (error) {
        return errorResult(`Error searching content: ${(error as Error).message}`);
      }
    },
  );
}
