const WP_GRAPHQL_URL = import.meta.env.WP_GRAPHQL_URL;

type Variables = Record<string, unknown>;

interface GraphQLErrorItem {
  message?: string;
}

interface FeaturedImageNode {
  sourceUrl?: string | null;
  altText?: string | null;
}

interface FeaturedImage {
  node?: FeaturedImageNode | null;
}

interface ModelInfo {
  manufacturer?: string | null;
  modelscale?: string | null;
  modelimageurl?: string | null;
  shortdescription?: string | null;
  historicalyear?: string | null;
  modellength?: string | null;
  totalparts?: string | null;
  buildstatus?: string[] | string | null;
  historicalnote?: string | null;
  donedate?: string | null;
}

interface ModelNode {
  id: string;
  slug: string;
  title: string;
  featuredImage?: FeaturedImage | null;
  modelinfo?: ModelInfo | null;
}

interface NormalizedModel extends ModelNode {
  heroImage: string | null;
  heroImageAlt: string;
  buildstatusText: string;
  buildstatusClass: string;
}

interface BuildLog {
  modelslug?: string | null;
  partnumber?: string | number | null;
  partcontent?: string | null;
  recordday?: string | null;
}

interface BuildPostNode {
  id: string;
  slug: string;
  title: string;
  content?: string | null;
  featuredImage?: FeaturedImage | null;
  buildlog?: BuildLog | null;
}

interface NormalizedBuildPart extends BuildPostNode {
  heroImage: string | null;
  heroImageAlt: string;
  partNumber: number;
  partContent: string;
  recordDay: string | null;
}

interface GetAllModelsResponse {
  models: {
    nodes: ModelNode[];
  };
}

interface GetModelBySlugResponse {
  model: ModelNode | null;
}

interface GetBuildPartsByModelResponse {
  posts: {
    nodes: BuildPostNode[];
  };
}

async function fetchAPI<T>(query: string, variables: Variables = {}): Promise<T> {
  if (!WP_GRAPHQL_URL) {
    throw new Error('WP_GRAPHQL_URL is not defined');
  }

  const response = await fetch(WP_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  if (!response.ok) {
    throw new Error(`WPGraphQL HTTP error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();

  if (json.errors?.length) {
    const message = json.errors
        .map((error: GraphQLErrorItem) => error.message || 'Unknown GraphQL error')
        .join('; ');

    throw new Error(message);
  }

  return json.data as T;
}

function slugifyStatus(status: string): string {
  return status.toLowerCase().trim().replace(/\s+/g, '-');
}

function normalizeModel(model: ModelNode): NormalizedModel {
  const rawStatus = model.modelinfo?.buildstatus;

  const buildstatusText = Array.isArray(rawStatus)
      ? rawStatus.join(', ')
      : rawStatus || '';

  const buildstatusClass = Array.isArray(rawStatus)
      ? rawStatus[0]
          ? slugifyStatus(rawStatus[0])
          : ''
      : rawStatus
          ? slugifyStatus(rawStatus)
          : '';

  return {
    ...model,
    heroImage: model.featuredImage?.node?.sourceUrl || model.modelinfo?.modelimageurl || null,
    heroImageAlt: model.featuredImage?.node?.altText || model.title,
    buildstatusText,
    buildstatusClass,
  };
}

function normalizeBuildPart(post: BuildPostNode): NormalizedBuildPart {
  const partNumber = Number(post.buildlog?.partnumber || 0);

  const recordDay = post.buildlog?.recordday
      ? new Date(post.buildlog.recordday).toLocaleDateString('ru-RU')
      : null;

  return {
    ...post,
    heroImage: post.featuredImage?.node?.sourceUrl || null,
    heroImageAlt: post.featuredImage?.node?.altText || post.title,
    partNumber,
    partContent: post.buildlog?.partcontent || post.content || '',
    recordDay,
  };
}

// --- TUTORIAL TYPES

export interface TutorialCategory {
  id: string;          // глобальный ID
  databaseId?: number; // term_id из WP
  name: string;
  slug: string;
}

export interface TutorialTag {
  id: string;
  databaseId?: number;
  name: string;
  slug: string;
}

export interface NormalizedTutorial {
  id: string;
  title: string;
  slug: string;
  content: string;
  teaser: string;
  level: string;
  featuredImage?: {
    sourceUrl: string;
    altText: string;
  };
  categories: TutorialCategory[];
  tags: TutorialTag[];
  relatedBuilds: {
    id: string;
    title: string;
    slug: string;
    teaser: string;
    scale: string;
    featuredImage?: {
      sourceUrl: string;
      altText: string;
    };
    categories: TutorialCategory[];
    tags: TutorialTag[];
  }[];
  relatedTutorials: NormalizedTutorial[];
  databaseId?: number;
  views?: number;
}

// --- NEWS TYPES & NORMALIZATION ---

export type NewsType =
    | 'announcement'
    | 'social-release'
    | 'build-log-entry'
    | 'new-model'
    | 'new-tutorial'
    | 'site-update';

export type ExternalSource =
    | 'internal'
    | 'youtube'
    | 'telegram'
    | 'instagram'
    | 'facebook';

interface RelatedModelNode {
  id: string;
  slug: string;
  title: string;
}

interface RelatedModelConnection {
  nodes?: RelatedModelNode[] | null;
}

// "сырые" поля как в GraphQL-ответе (newsfields)
interface RawNewsfields {
  newsType?: string[] | null;
  shortText?: string | null;
  targetUrl?: string | null;
  targetLabel?: string | null;
  externalSource?: string[] | null;
  isPinned?: boolean | null;
  eventDate?: string | null;
  relatedModel?: RelatedModelConnection | null;
}

// Нормализованные поля для фронтенда
export interface NewsFields {
  newsType: NewsType;
  shortText: string;
  targetUrl: string;
  targetLabel: string;
  externalSource: ExternalSource;
  isPinned: boolean;
  eventDate: string | null;
  relatedModel: RelatedModelNode | null;
}

export interface NewsItem {
  id: string;
  databaseId?: number;
  title: string;
  slug: string;
  date: string;
  uri?: string;
  news: NewsFields;
}

interface GetAllNewsResponse {
  newsitems: {
    nodes: {
      id: string;
      databaseId?: number;
      title: string;
      slug: string;
      date: string;
      uri?: string;
      newsfields?: RawNewsfields | null;
    }[];
  };
}

interface GetNewsBySlugResponse {
  newsitem: {
    id: string;
    databaseId?: number;
    title: string;
    slug: string;
    date: string;
    uri?: string;
    newsfields?: RawNewsfields | null;
  } | null;
}

const GET_ALL_NEWS = `
  query GetAllNews {
    newsitems(first: 100, where: { status: PUBLISH }) {
      nodes {
        id
        databaseId
        title
        slug
        date
        uri
        newsfields {
          newsType
          shortText
          targetUrl
          targetLabel
          externalSource
          isPinned
          eventDate
          relatedModel {
            nodes {
              __typename
              ... on Model {
                id
                slug
                title
              }
            }
          }
        }
      }
    }
  }
`;

const GET_NEWS_BY_SLUG = `
  query GetNewsBySlug($slug: ID!) {
    newsitem(id: $slug, idType: SLUG) {
      id
      databaseId
      title
      slug
      date
      uri
      newsfields {
        newsType
        shortText
        targetUrl
        targetLabel
        externalSource
        isPinned
        eventDate
        relatedModel {
          nodes {
            __typename
            ... on Model {
              id
              slug
              title
            }
          }
        }
      }
    }
  }
`;

// Нормализация одного newsfields
function normalizeNewsfields(raw?: RawNewsfields | null): NewsFields {
  const newsTypeRaw = raw?.newsType && raw.newsType.length > 0
      ? raw.newsType[0]
      : 'announcement';

  const externalSourceRaw = raw?.externalSource && raw.externalSource.length > 0
      ? raw.externalSource[0]
      : 'internal';

  const relatedModelNode =
      raw?.relatedModel?.nodes && raw.relatedModel.nodes.length > 0
          ? raw.relatedModel.nodes[0]
          : null;

  return {
    newsType: newsTypeRaw as NewsType,
    shortText: raw?.shortText ?? '',
    targetUrl: raw?.targetUrl ?? '#',
    targetLabel: raw?.targetLabel ?? 'Open',
    externalSource: externalSourceRaw as ExternalSource,
    isPinned: raw?.isPinned ?? false,
    eventDate: raw?.eventDate ?? null,
    relatedModel: relatedModelNode,
  };
}

// Нормализация NewsItem
function normalizeNewsItem(node: GetAllNewsResponse['newsitems']['nodes'][number]): NewsItem {
  return {
    id: node.id,
    databaseId: node.databaseId,
    title: node.title,
    slug: node.slug,
    date: node.date,
    uri: node.uri,
    news: normalizeNewsfields(node.newsfields),
  };
}

// Утилиты сортировки и свежести

export function isFreshNews(date: string, now = new Date(), days = 7): boolean {
  const published = new Date(date).getTime();
  const threshold = now.getTime() - days * 24 * 60 * 60 * 1000;
  return published >= threshold;
}

export function sortNews(items: NewsItem[]): NewsItem[] {
  return [...items].sort((a, b) => {
    const pinA = a.news.isPinned ? 1 : 0;
    const pinB = b.news.isPinned ? 1 : 0;

    if (pinA !== pinB) return pinB - pinA;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });
}

export function getFreshNews(items: NewsItem[], days = 7): NewsItem[] {
  return sortNews(items).filter((item) => isFreshNews(item.date, new Date(), days));
}

export function hasFreshNews(items: NewsItem[], days = 7): boolean {
  return getFreshNews(items, days).length > 0;
}

// Публичное API для News

export async function getAllNews(): Promise<NewsItem[]> {
  const data = await fetchAPI<GetAllNewsResponse>(GET_ALL_NEWS);
  return data.newsitems.nodes.map(normalizeNewsItem);
}

export async function getNewsBySlug(slug: string): Promise<NewsItem | null> {
  const data = await fetchAPI<GetNewsBySlugResponse>(GET_NEWS_BY_SLUG, { slug });

  if (!data.newsitem) return null;

  return normalizeNewsItem({
    id: data.newsitem.id,
    databaseId: data.newsitem.databaseId,
    title: data.newsitem.title,
    slug: data.newsitem.slug,
    date: data.newsitem.date,
    uri: data.newsitem.uri,
    newsfields: data.newsitem.newsfields ?? undefined,
  } as GetAllNewsResponse['newsitems']['nodes'][number]);
}

export async function getFreshNewsItems(limit = 3): Promise<NewsItem[]> {
  const items = await getAllNews();
  return getFreshNews(items).slice(0, limit);
}

export async function getRelatedModelNews(modelSlug: string, limit = 5): Promise<NewsItem[]> {
  const items = await getAllNews();

  return sortNews(
      items.filter((item) => item.news.relatedModel?.slug === modelSlug)
  ).slice(0, limit);
}

// MODELS & BUILDS

export async function getAllModels(): Promise<NormalizedModel[]> {
  const data = await fetchAPI<GetAllModelsResponse>(`
    query GetAllModels {
      models(first: 100) {
        nodes {
          id
          slug
          title
          featuredImage {
            node {
              sourceUrl
              altText
            }
          }
          modelinfo {
            manufacturer
            modelscale
            modelimageurl
            shortdescription
            historicalyear
            modellength
            totalparts
            buildstatus
            historicalnote
            donedate
          }
        }
      }
    }
  `);

  return data.models.nodes
      .map(normalizeModel)
      .sort((a, b) => {
        const dateA = a.modelinfo?.donedate ? new Date(a.modelinfo.donedate).getTime() : 0;
        const dateB = b.modelinfo?.donedate ? new Date(b.modelinfo.donedate).getTime() : 0;
        return dateB - dateA;
      });
}

export async function getModelBySlug(slug: string): Promise<NormalizedModel | null> {
  const data = await fetchAPI<GetModelBySlugResponse>(
      `
      query GetModelBySlug($slug: ID!) {
        model(id: $slug, idType: SLUG) {
          id
          slug
          title
          featuredImage {
            node {
              sourceUrl
              altText
            }
          }
          modelinfo {
            manufacturer
            modelscale
            modelimageurl
            shortdescription
            historicalyear
            modellength
            totalparts
            buildstatus
            historicalnote
            donedate
          }
        }
      }
    `,
      { slug }
  );

  return data.model ? normalizeModel(data.model) : null;
}

export async function getBuildPartsByModel(slug: string): Promise<NormalizedBuildPart[]> {
  const data = await fetchAPI<GetBuildPartsByModelResponse>(
      `
      query GetBuildPartsByModel {
        posts(where: { categoryName: "Builds" }, first: 100) {
          nodes {
            id
            slug
            title
            content
            featuredImage {
              node {
                sourceUrl
                altText
              }
            }
            buildlog {
              modelslug
              partnumber
              partcontent
              recordday
            }
          }
        }
      }
    `
  );

  return data.posts.nodes
      .filter((post) => post.buildlog?.modelslug === slug)
      .map(normalizeBuildPart)
      .sort((a, b) => a.partNumber - b.partNumber);
}

// --- TUTORIAL QUERIES & RESPONSES ---

interface TutorialFieldsNode {
  tutorialTeaser?: string | null;
  tutorialLevel?: string | null;
  tutorialRelatedBuilds?: { [key: string]: any } | null;
  tutorialRelatedTutorials?: { [key: string]: any } | null;
  views?: number | null;
}

interface TutorialNode {
  id: string;
  title: string;
  slug: string;
  content?: string | null;
  tutorialFields?: TutorialFieldsNode | null;
  featuredImage?: {
    node?: {
      sourceUrl?: string | null;
      altText?: string | null;
    } | null;
  } | null;
  tutorialCategories?: {
    nodes: TutorialCategory[];
  } | null;
  tutorialTags?: {
    nodes: TutorialTag[];
  } | null;
  databaseId?: number;
}

interface GetTutorialsResponse {
  tutorialsFiltered: TutorialNode[];
}

interface GetTutorialBySlugResponse {
  tutorial: TutorialNode | null;
}

interface GetTutorialCategoriesResponse {
  tutorialCategories: {
    nodes: (TutorialCategory & { count?: number })[];
  };
}

interface GetTutorialTagsResponse {
  tutorialTags: {
    nodes: (TutorialTag & { count?: number })[];
  };
}

const TUTORIALS_QUERY = `
  query GetTutorials(
    $categoryIn: [ID]
    $tagIn: [ID]
  ) {
    tutorialsFiltered(
      where: {
        categoryIn: $categoryIn
        tagIn: $tagIn
      }
    ) {
      id
      databaseId
      title
      slug
      tutorialFields {
        tutorialTeaser
        tutorialLevel
        views
      }
      featuredImage {
        node {
          sourceUrl
          altText
        }
      }
      tutorialCategories {
        nodes {
          id
          name
          slug
        }
      }
      tutorialTags {
        nodes {
          id
          name
          slug
        }
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
              modelinfo {
                shortdescription
                modelscale
              }
              featuredImage {
                node {
                  sourceUrl
                  altText
                }
              }
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
              tutorialFields {
                tutorialTeaser
                tutorialLevel
              }
            }
          }
        }
      }
      featuredImage {
        node {
          sourceUrl
          altText
        }
      }
      tutorialCategories {
        nodes {
          id
          name
          slug
        }
      }
      tutorialTags {
        nodes {
          id
          name
          slug
        }
      }
    }
  }
`;

const TUTORIAL_CATEGORIES_QUERY = `
  query GetTutorialCategories {
    tutorialCategories(first: 100) {
      nodes {
        id
        databaseId
        name
        slug
        count
      }
    }
  }
`;

const TUTORIAL_TAGS_QUERY = `
  query GetTutorialTags {
    tutorialTags(first: 100, where: { hideEmpty: true }) {
      nodes {
        id
        databaseId
        name
        slug
        count
      }
    }
  }
`;

// --- TUTORIAL FUNCTIONS ---

export async function getAllTutorials(params?: {
  categoryIn?: string[];
  tagIn?: string[];
}): Promise<NormalizedTutorial[]> {
  const variables = {
    categoryIn: params?.categoryIn,
    tagIn: params?.tagIn,
  };

  const data = await fetchAPI<GetTutorialsResponse>(TUTORIALS_QUERY, variables);

  return data.tutorialsFiltered.map((tutorial) => ({
    id: tutorial.id,
    databaseId: tutorial.databaseId,
    title: tutorial.title,
    slug: tutorial.slug,
    content: '',
    teaser: tutorial.tutorialFields?.tutorialTeaser || '',
    level: Array.isArray(tutorial.tutorialFields?.tutorialLevel)
        ? (tutorial.tutorialFields?.tutorialLevel[0] || '')
        : (tutorial.tutorialFields?.tutorialLevel || ''),
    featuredImage: tutorial.featuredImage?.node
        ? {
          sourceUrl: tutorial.featuredImage.node.sourceUrl || '',
          altText: tutorial.featuredImage.node.altText || tutorial.title,
        }
        : undefined,
    categories: tutorial.tutorialCategories?.nodes || [],
    tags: tutorial.tutorialTags?.nodes || [],
    relatedBuilds: [],
    relatedTutorials: [],
    views: Number(tutorial.tutorialFields?.views ?? 0),
  }));
}


export async function getTutorialBySlug(slug: string): Promise<NormalizedTutorial | null> {
  const data = await fetchAPI<GetTutorialBySlugResponse>(TUTORIAL_BY_SLUG_QUERY, { slug });

  if (!data.tutorial) return null;

  const t = data.tutorial;

  const relatedBuilds =
      t.tutorialFields?.tutorialRelatedBuilds?.nodes?.map((build: any) => ({
        id: build.id,
        title: build.title,
        slug: build.slug,
        teaser: build.modelinfo?.shortdescription || '',
        scale: build.modelinfo?.modelscale || '',
        featuredImage: build.featuredImage?.node
            ? {
              sourceUrl: build.featuredImage.node.sourceUrl || '',
              altText: build.featuredImage.node.altText || build.title,
            }
            : undefined,
        categories: [],
        tags: [],
      })) || [];

  const relatedTutorials =
      t.tutorialFields?.tutorialRelatedTutorials?.nodes?.map((rt: any) => ({
        id: rt.id,
        title: rt.title,
        slug: rt.slug,
        content: '',
        teaser: rt.tutorialFields?.tutorialTeaser || '',
        level: Array.isArray(rt.tutorialFields?.tutorialLevel)
            ? (rt.tutorialFields?.tutorialLevel[0] || '')
            : (rt.tutorialFields?.tutorialLevel || ''),
        featuredImage: undefined,
        categories: [],
        tags: [],
        relatedBuilds: [],
        relatedTutorials: [],
      })) || [];

  return {
    id: t.id,
    databaseId: t.databaseId,
    title: t.title,
    slug: t.slug,
    content: t.content || '',
    teaser: t.tutorialFields?.tutorialTeaser || '',
    level: Array.isArray(t.tutorialFields?.tutorialLevel)
        ? (t.tutorialFields?.tutorialLevel[0] || '')
        : (t.tutorialFields?.tutorialLevel || ''),
    featuredImage: t.featuredImage?.node
        ? {
          sourceUrl: t.featuredImage.node.sourceUrl || '',
          altText: t.featuredImage.node.altText || t.title,
        }
        : undefined,
    categories: t.tutorialCategories?.nodes || [],
    tags: t.tutorialTags?.nodes || [],
    relatedBuilds,
    relatedTutorials,
    views: Number(t.tutorialFields?.views ?? 0),
  };
}

export async function getTutorialCategories(): Promise<TutorialCategory[]> {
  const data = await fetchAPI<GetTutorialCategoriesResponse>(TUTORIAL_CATEGORIES_QUERY);
  return data.tutorialCategories.nodes.filter((cat) => (cat as any).count > 0);
}

export async function getTutorialTags(): Promise<TutorialTag[]> {
  const data = await fetchAPI<GetTutorialTagsResponse>(TUTORIAL_TAGS_QUERY);
  return data.tutorialTags.nodes;
}
