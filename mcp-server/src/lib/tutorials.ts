/**
 * Общая логика доступа к образовательным статьям (tutorials) через WPGraphQL.
 * Выделена из get-tutorials.ts, чтобы избежать дублирования GraphQL-запросов
 * между несколькими инструментами (get_tutorials, get_tutorial_by_title,
 * search_tutorial_content, list_tutorial_taxonomy).
 */
import { requestWithTimeout } from "./graphql-client.js";

export interface TutorialFieldsNode {
  tutorialTeaser?: string | null;
  tutorialLevel?: string[] | string | null;
  views?: number | null;
  tutorialRelatedBuilds?: { nodes?: RelatedBuildNode[] } | null;
  tutorialRelatedTutorials?: { nodes?: RelatedTutorialNode[] } | null;
}

export interface RelatedBuildNode {
  __typename?: string;
  id?: string;
  title?: string;
  slug?: string;
  modelinfo?: { shortdescription?: string | null; modelscale?: string | null } | null;
}

export interface RelatedTutorialNode {
  __typename?: string;
  id?: string;
  title?: string;
  slug?: string;
  tutorialFields?: { tutorialTeaser?: string | null; tutorialLevel?: string[] | string | null } | null;
}

export interface TutorialTermNode {
  id: string;
  name: string;
  slug: string;
}

export interface TutorialListNode {
  id: string;
  databaseId?: number;
  title: string;
  slug: string;
  content?: string | null;
  tutorialFields?: TutorialFieldsNode | null;
  tutorialCategories?: { nodes: TutorialTermNode[] } | null;
  tutorialTags?: { nodes: TutorialTermNode[] } | null;
}

export interface TutorialDetailNode extends TutorialListNode {
  content?: string | null;
}

interface GetTutorialsResponse {
  tutorialsFiltered: TutorialListNode[];
}

interface GetTutorialBySlugResponse {
  tutorial: TutorialDetailNode | null;
}

/**
 * Полный запрос списка статей, включая content — нужен для клиентской
 * полнотекстовой фильтрации (search_tutorial_content) и справочника
 * таксономии (list_tutorial_taxonomy). CMS и MCP-сервер работают на одном VPS,
 * поэтому клиентская фильтрация по всему списку статей не создаёт заметной
 * задержки или лишней сетевой нагрузки.
 */
const TUTORIALS_FULL_QUERY = `
  query GetTutorialsFull {
    tutorialsFiltered(where: {}) {
      id
      databaseId
      title
      slug
      content
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

export function levelOf(raw: string[] | string | null | undefined): string {
  return Array.isArray(raw) ? raw[0] || "" : raw || "";
}

let tutorialsCache: { data: TutorialListNode[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

/** Загружает все статьи (с полным content) с кратким кэшем, аналогично fetchAllModels. */
export async function fetchAllTutorials(): Promise<TutorialListNode[]> {
  if (tutorialsCache && Date.now() - tutorialsCache.fetchedAt < CACHE_TTL_MS) {
    return tutorialsCache.data;
  }
  const data = await requestWithTimeout<GetTutorialsResponse>(TUTORIALS_FULL_QUERY);
  tutorialsCache = { data: data.tutorialsFiltered, fetchedAt: Date.now() };
  return tutorialsCache.data;
}

export async function fetchTutorialBySlug(slug: string): Promise<TutorialDetailNode | null> {
  const data = await requestWithTimeout<GetTutorialBySlugResponse>(TUTORIAL_BY_SLUG_QUERY, {
    slug,
  });
  return data.tutorial;
}

/** Ищет статью по человекочитаемому названию: точное совпадение title (без учёта регистра),
 * затем частичное совпадение. Возвращает первую найденную — используется get_tutorial_by_title. */
export function findTutorialByTitle(
  tutorials: TutorialListNode[],
  title: string,
): TutorialListNode | null {
  const normalized = title.trim().toLowerCase();

  return (
    tutorials.find((t) => t.title.trim().toLowerCase() === normalized) ??
    tutorials.find((t) => t.title.trim().toLowerCase().includes(normalized)) ??
    null
  );
}
