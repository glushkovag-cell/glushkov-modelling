import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { requestWithTimeout } from "../lib/graphql-client.js";
import { stripHtmlAndTruncate } from "../lib/wp-models.js";

interface TutorialFieldsNode {
  tutorialTeaser?: string | null;
  tutorialLevel?: string[] | string | null;
  views?: number | null;
  tutorialRelatedBuilds?: { nodes?: RelatedBuildNode[] } | null;
  tutorialRelatedTutorials?: { nodes?: RelatedTutorialNode[] } | null;
}

interface RelatedBuildNode {
  __typename?: string;
  id?: string;
  title?: string;
  slug?: string;
  modelinfo?: { shortdescription?: string | null; modelscale?: string | null } | null;
}

interface RelatedTutorialNode {
  __typename?: string;
  id?: string;
  title?: string;
  slug?: string;
  tutorialFields?: { tutorialTeaser?: string | null; tutorialLevel?: string[] | string | null } | null;
}

interface TutorialTermNode {
  id: string;
  name: string;
  slug: string;
}

interface TutorialListNode {
  id: string;
  databaseId?: number;
  title: string;
  slug: string;
  tutorialFields?: TutorialFieldsNode | null;
  tutorialCategories?: { nodes: TutorialTermNode[] } | null;
  tutorialTags?: { nodes: TutorialTermNode[] } | null;
}

interface TutorialDetailNode extends TutorialListNode {
  content?: string | null;
}

interface GetTutorialsResponse {
  tutorialsFiltered: TutorialListNode[];
}

interface GetTutorialBySlugResponse {
  tutorial: TutorialDetailNode | null;
}

const TUTORIALS_QUERY = `
  query GetTutorials {
    tutorialsFiltered(where: {}) {
      id
      databaseId
      title
      slug
      tutorialFields {
        tutorialTeaser
        tutorialLevel
        views
      }
      tutorialCategories {
        nodes { id name slug }
      }
      tutorialTags {
        nodes { id name slug }
      }
    }
  }
`;

const TUTORIAL_BY_SLUG_QUERY = `
  query GetTutorialBySlug($slug: ID!) {
    tutorial(id: $slug, idType: SLUG) {
      id
      databaseId
      title
      slug
      content
      tutorialFields {
        tutorialTeaser
        tutorialLevel
        views
        tutorialRelatedBuilds {
          nodes {
            __typename
            ... on Model {
              id
              title
              slug
              modelinfo { shortdescription modelscale }
            }
          }
        }
        tutorialRelatedTutorials {
          nodes {
            __typename
            ... on Tutorial {
              id
              title
              slug
              tutorialFields { tutorialTeaser tutorialLevel }
            }
          }
        }
      }
      tutorialCategories {
        nodes { id name slug }
      }
      tutorialTags {
        nodes { id name slug }
      }
    }
  }
`;

function levelOf(raw: string[] | string | null | undefined): string {
  return Array.isArray(raw) ? raw[0] || "" : raw || "";
}

const inputSchema = {
  slug: z
    .string()
    .optional()
    .describe(
      "Slug конкретной обучающей статьи. Если не указан, возвращается список всех статей.",
    ),
};

export function registerGetTutorials(server: McpServer): void {
  server.registerTool(
    "get_tutorials",
    {
      title: "Обучающие статьи",
      description:
        "Возвращает список обучающих статей сайта или содержание конкретной статьи по slug.",
      inputSchema,
    },
    async ({ slug }) => {
      try {
        if (slug) {
          const data = await requestWithTimeout<GetTutorialBySlugResponse>(
            TUTORIAL_BY_SLUG_QUERY,
            { slug },
          );

          if (!data.tutorial) {
            return errorResult(`Обучающая статья со slug='${slug}' не найдена.`);
          }

          const t = data.tutorial;
          const relatedBuilds = (t.tutorialFields?.tutorialRelatedBuilds?.nodes || [])
            .filter((n) => n.__typename === "Model")
            .map((n) => ({
              title: n.title,
              slug: n.slug,
              shortDescription: n.modelinfo?.shortdescription ?? null,
              scale: n.modelinfo?.modelscale ?? null,
            }));
          const relatedTutorials = (t.tutorialFields?.tutorialRelatedTutorials?.nodes || [])
            .filter((n) => n.__typename === "Tutorial")
            .map((n) => ({
              title: n.title,
              slug: n.slug,
              teaser: n.tutorialFields?.tutorialTeaser ?? null,
              level: levelOf(n.tutorialFields?.tutorialLevel),
            }));

          return jsonResult({
            title: t.title,
            slug: t.slug,
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

        const data = await requestWithTimeout<GetTutorialsResponse>(TUTORIALS_QUERY);

        const tutorials = data.tutorialsFiltered.map((t) => ({
          title: t.title,
          slug: t.slug,
          teaser: t.tutorialFields?.tutorialTeaser ?? null,
          level: levelOf(t.tutorialFields?.tutorialLevel),
          views: t.tutorialFields?.views ?? 0,
          categories: (t.tutorialCategories?.nodes || []).map((c) => c.name),
          tags: (t.tutorialTags?.nodes || []).map((tg) => tg.name),
        }));

        return jsonResult({ total: tutorials.length, tutorials });
      } catch (error) {
        return errorResult(
          `Ошибка при получении обучающих статей: ${(error as Error).message}`,
        );
      }
    },
  );
}
