const WP_GRAPHQL_URL = import.meta.env.WP_GRAPHQL_URL;
const WP_GRAPHQL_SECRET = import.meta.env.WP_GRAPHQL_SECRET;

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

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (WP_GRAPHQL_SECRET) {
    headers['X-GraphQL-Secret'] = WP_GRAPHQL_SECRET;
  }

  const response = await fetch(WP_GRAPHQL_URL, {
    method: 'POST',
    headers,
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

// --- AI HUB WORKFLOW STEPS ---

const AI_HUB_ID = 'cG9zdDo2OTY=';

interface AiHubPageNode {
  id: string;
  uri?: string | null;
  title?: string | null;
}

interface AiWorkflowStepFields {
  description?: string | null;
  displayNumber?: string | null;
  showOnAiHub?: boolean | null;
  aiHubPage?: {
    nodes?: AiHubPageNode[] | null;
  } | null;
}

interface AiWorkflowStepNode {
  id: string;
  title: string;
  slug: string;
  uri?: string | null;
  aiWorkflowStepFields?: AiWorkflowStepFields | null;
}

interface GetAiWorkflowStepsResponse {
  aiWorkflowSteps: {
    nodes: AiWorkflowStepNode[];
  };
}

export interface AiHubWorkflowStep {
  id: string;
  title: string;
  slug: string;
  uri: string;
  description: string;
  displayNumber: string;
}

const GET_AI_WORKFLOW_STEPS = `
  query GetAiWorkflowSteps {
    aiWorkflowSteps(first: 100) {
      nodes {
        id
        title
        slug
        uri
        aiWorkflowStepFields {
          description
          displayNumber
          showOnAiHub
          aiHubPage {
            nodes {
              id
              uri
              ... on NodeWithTitle {
                title
              }
            }
          }
        }
      }
    }
  }
`;

export async function getAiHubWorkflowSteps(): Promise<AiHubWorkflowStep[]> {
  const data = await fetchAPI<GetAiWorkflowStepsResponse>(GET_AI_WORKFLOW_STEPS);

  return data.aiWorkflowSteps.nodes
      .filter((step) => {
        const fields = step.aiWorkflowStepFields;

        return (
            fields?.showOnAiHub === true &&
            fields.aiHubPage?.nodes?.some((page) => page.id === AI_HUB_ID)
        );
      })
      .map((step) => ({
        id: step.id,
        title: step.title,
        slug: step.slug,
        uri: step.uri || '',
        description: step.aiWorkflowStepFields?.description || '',
        displayNumber: step.aiWorkflowStepFields?.displayNumber || '',
      }))
      .sort((a, b) => {
        const numberA = Number(a.displayNumber) || 0;
        const numberB = Number(b.displayNumber) || 0;

        return numberA - numberB;
      });
}

/// --- AI HUB PLATFORMS ---

interface AiPlatformLogo {
  node?: {
    sourceUrl?: string | null;
    altText?: string | null;
  } | null;
}

interface AiPlatformFields {
  accountRequirements?: string | null;
  compatibilityStatus?: [string, string] | string[] | null;
  endpointOverride?: string | null;
  lastTestedAt?: string | null;
  officialPlatformUrl?: string | null;
  platformLogo?: AiPlatformLogo | null;
  shortDescription?: string | null;
  showOnAiHub?: boolean | null;
  testPrompt?: string | null;
}

interface AiPlatformNode {
  id: string;
  title: string;
  slug: string;
  uri?: string | null;
  menuOrder?: number | null;
  aiPlatformFields?: AiPlatformFields | null;
}

interface GetAiPlatformsResponse {
  aiPlatforms: {
    nodes: AiPlatformNode[];
  };
}

export interface AiHubPlatform {
  id: string;
  title: string;
  slug: string;
  uri: string;
  menuOrder: number;

  shortDescription: string;

  compatibilityStatusValue: string;
  compatibilityStatusLabel: string;

  endpointOverride: string;
  lastTestedAt: string | null;
  officialPlatformUrl: string;

  logoUrl: string | null;
  logoAlt: string;

  accountRequirements: string;
  testPrompt: string;
}

const GET_AI_PLATFORMS = `
  query GetAiPlatforms {
    aiPlatforms(first: 100) {
      nodes {
        id
        title
        slug
        uri
        menuOrder
        aiPlatformFields {
          accountRequirements
          compatibilityStatus
          endpointOverride
          lastTestedAt
          officialPlatformUrl
          platformLogo {
            node {
              sourceUrl
              altText
            }
          }
          shortDescription
          showOnAiHub
          testPrompt
        }
      }
    }
  }
`;

function normalizeAcfSelect(
    value: string[] | null | undefined,
): { value: string; label: string } {
  if (!value?.length) {
    return {
      value: '',
      label: '',
    };
  }

  return {
    value: value[0] || '',
    label: value[1] || value[0] || '',
  };
}

export async function getAiHubPlatforms(): Promise<AiHubPlatform[]> {
  const data = await fetchAPI<GetAiPlatformsResponse>(GET_AI_PLATFORMS);

  return data.aiPlatforms.nodes
      .filter((platform) => platform.aiPlatformFields?.showOnAiHub === true)
      .map((platform) => {
        const fields = platform.aiPlatformFields;
        const compatibilityStatus = normalizeAcfSelect(
            fields?.compatibilityStatus,
        );

        return {
          id: platform.id,
          title: platform.title,
          slug: platform.slug,
          uri: platform.uri || '',
          menuOrder: platform.menuOrder ?? 0,

          shortDescription: fields?.shortDescription || '',

          compatibilityStatusValue: compatibilityStatus.value,
          compatibilityStatusLabel: compatibilityStatus.label,

          endpointOverride: fields?.endpointOverride || '',
          lastTestedAt: fields?.lastTestedAt || null,
          officialPlatformUrl: fields?.officialPlatformUrl || '',

          logoUrl: fields?.platformLogo?.node?.sourceUrl || null,
          logoAlt:
              fields?.platformLogo?.node?.altText ||
              `${platform.title} logo`,

          accountRequirements: fields?.accountRequirements || '',
          testPrompt: fields?.testPrompt || '',
        };
      })
      .sort((a, b) => a.menuOrder - b.menuOrder);
}

// --- AI HUB PAGE / HERO ---

interface AiHubHeroImage {
  node?: {
    sourceUrl?: string | null;
    altText?: string | null;
  } | null;
}

interface AiHubPageFields {
  eyebrow?: string | null;
  heroTitle?: string | null;
  heroLead?: string | null;
  heroImage?: AiHubHeroImage | null;

  primaryCtaLabel?: string | null;
  primaryCtaAnchor?: string | null;
  secondaryCtaLabel?: string | null;
  secondaryCtaAnchor?: string | null;

  publicMcpEndpoint?: string | null;
  statusLabel?: string | null;
  statusText?: string | null;

  feedbackTitle?: string | null;
  feedbackText?: string | null;
  feedbackEmail?: string | null;
  feedbackEmailSubject?: string | null;
  socialHubUrl?: string | null;
}

interface AiHubPageNode {
  id: string;
  title: string;
  slug: string;
  uri?: string | null;
  menuOrder?: number | null;
  status?: string | null;
  aihubpage?: AiHubPageFields | null;
}

interface GetAiHubPageResponse {
  aiHubs: {
    nodes: AiHubPageNode[];
  };
}

export interface AiHubPage {
  id: string;
  title: string;
  slug: string;
  uri: string;
  menuOrder: number;
  status: string;

  eyebrow: string;
  heroTitle: string;
  heroLead: string;

  heroImageUrl: string | null;
  heroImageAlt: string;

  primaryCtaLabel: string;
  primaryCtaAnchor: string;
  secondaryCtaLabel: string;
  secondaryCtaAnchor: string;

  publicMcpEndpoint: string;
  statusLabel: string;
  statusText: string;

  feedbackTitle: string;
  feedbackText: string;
  feedbackEmail: string;
  feedbackEmailSubject: string;
  socialHubUrl: string;
}

const GET_AI_HUB_PAGE = `
  query GetAiHubPage {
    aiHubs(first: 100) {
      nodes {
        id
        title
        slug
        uri
        menuOrder
        status

        aihubpage {
          eyebrow
          heroTitle
          heroLead

          heroImage {
            node {
              sourceUrl
              altText
            }
          }

          primaryCtaLabel
          primaryCtaAnchor
          secondaryCtaLabel
          secondaryCtaAnchor

          publicMcpEndpoint
          statusLabel
          statusText

          feedbackTitle
          feedbackText
          feedbackEmail
          feedbackEmailSubject
          socialHubUrl
        }
      }
    }
  }
`;

function normalizeAiHubPage(node: AiHubPageNode): AiHubPage {
  const fields = node.aihubpage;

  return {
    id: node.id,
    title: node.title,
    slug: node.slug,
    uri: node.uri || '',
    menuOrder: node.menuOrder ?? 0,
    status: node.status || '',

    eyebrow: fields?.eyebrow || 'AI-ready archive',

    heroTitle:
        fields?.heroTitle ||
        'Explore the workshop archive with your AI assistant.',

    heroLead:
        fields?.heroLead ||
        'Connect Glushkov Modelling to a compatible AI assistant and search build logs, historical notes, workshop decisions, gallery photographs, and tutorials in natural language.',

    heroImageUrl: fields?.heroImage?.node?.sourceUrl || null,

    heroImageAlt:
        fields?.heroImage?.node?.altText ||
        'Wooden ship model detail from the Glushkov Modelling archive',

    primaryCtaLabel:
        fields?.primaryCtaLabel || 'Connect an assistant',

    primaryCtaAnchor:
        fields?.primaryCtaAnchor || '#platforms',

    secondaryCtaLabel:
        fields?.secondaryCtaLabel || 'Browse example prompts',

    secondaryCtaAnchor:
        fields?.secondaryCtaAnchor || '#prompts',

    publicMcpEndpoint:
        fields?.publicMcpEndpoint ||
        'https://mcp.glushkov-modelling.com/mcp-oauth',

    statusLabel:
        fields?.statusLabel || 'Public MCP server',

    statusText:
        fields?.statusText || 'OAuth-secured · Read-only access',

    feedbackTitle:
        fields?.feedbackTitle ||
        'Need help connecting or found an issue?',

    feedbackText:
        fields?.feedbackText ||
        'Please contact us if you need help connecting your AI assistant.',

    feedbackEmail:
        fields?.feedbackEmail || 'glushkov.ag@gmail.com',

    feedbackEmailSubject:
        fields?.feedbackEmailSubject || 'MCP server',

    socialHubUrl:
        fields?.socialHubUrl || '',
  };
}

export async function getAiHubPage(): Promise<AiHubPage | null> {
  const data = await fetchAPI<GetAiHubPageResponse>(GET_AI_HUB_PAGE);

  const page = data.aiHubs.nodes.find(
      (node) =>
          node.id === AI_HUB_ID &&
          node.status === 'publish',
  );

  return page ? normalizeAiHubPage(page) : null;
}

// --- AI HUB CAPABILITIES ---

interface AiCapabilityIcon {
  node?: {
    sourceUrl?: string | null;
    altText?: string | null;
  } | null;
}

interface AiCapabilityHub {
  nodes?: {
    id: string;
  }[] | null;
}

interface AiCapabilityFields {
  description?: string | null;
  showOnAiHub?: boolean | null;
  icon?: AiCapabilityIcon | null;
  hub?: AiCapabilityHub | null;
}

interface AiCapabilityNode {
  id: string;
  title: string;
  slug: string;
  uri?: string | null;
  menuOrder?: number | null;
  status?: string | null;
  aiCapabilityFields?: AiCapabilityFields | null;
}

interface GetAiCapabilitiesResponse {
  aiCapabilities: {
    nodes: AiCapabilityNode[];
  };
}

export interface AiHubCapability {
  id: string;
  title: string;
  slug: string;
  uri: string;
  menuOrder: number;
  description: string;
  iconUrl: string | null;
  iconAlt: string;
}

const GET_AI_HUB_CAPABILITIES = `
  query GetAiHubCapabilities {
    aiCapabilities(first: 100) {
      nodes {
        id
        title
        slug
        uri
        menuOrder
        status
        aiCapabilityFields {
          description
          showOnAiHub
          icon {
            node {
              sourceUrl
              altText
            }
          }
          hub {
            nodes {
              id
            }
          }
        }
      }
    }
  }
`;

export async function getAiHubCapabilities(): Promise<AiHubCapability[]> {
  const data = await fetchAPI<GetAiCapabilitiesResponse>(
      GET_AI_HUB_CAPABILITIES,
  );

  return data.aiCapabilities.nodes
      .filter((capability) => {
        const fields = capability.aiCapabilityFields;

        return (
            capability.status === 'publish' &&
            fields?.showOnAiHub === true &&
            fields.hub?.nodes?.some((hub) => hub.id === AI_HUB_ID)
        );
      })
      .map((capability) => {
        const fields = capability.aiCapabilityFields;

        return {
          id: capability.id,
          title: capability.title,
          slug: capability.slug,
          uri: capability.uri || '',
          menuOrder: capability.menuOrder ?? 0,
          description: fields?.description || '',
          iconUrl: fields?.icon?.node?.sourceUrl || null,
          iconAlt: fields?.icon?.node?.altText || '',
        };
      })
      .sort((a, b) => a.menuOrder - b.menuOrder);
}

// --- AI HUB FAQ ---

interface AiFaqFields {
  answer?: string | null;
  faqCategory?: string[] | null;
  featuredonoverview?: boolean | null;
  showOnAiHub?: boolean | null;
}

interface AiFaqNode {
  id: string;
  title: string;
  slug: string;
  uri?: string | null;
  menuOrder?: number | null;
  status?: string | null;
  aiFaqFields?: AiFaqFields | null;
}

interface GetAiFaqsResponse {
  aiFaqs: {
    nodes: AiFaqNode[];
  };
}

export interface AiHubFaq {
  id: string;
  title: string;
  slug: string;
  uri: string;
  menuOrder: number;
  answer: string;
  categoryValue: string;
  categoryLabel: string;
  featuredOnOverview: boolean;
}

const GET_AI_HUB_FAQS = `
  query GetAiHubFaqs {
    aiFaqs(first: 100) {
      nodes {
        id
        title
        slug
        uri
        menuOrder
        status
        aiFaqFields {
          answer
          faqCategory
          featuredonoverview
          showOnAiHub
        }
      }
    }
  }
`;

export async function getAiHubFaqs(): Promise<AiHubFaq[]> {
  const data = await fetchAPI<GetAiFaqsResponse>(GET_AI_HUB_FAQS);

  return data.aiFaqs.nodes
      .filter((faq) => {
        const fields = faq.aiFaqFields;

        return (
            faq.status === 'publish' &&
            fields?.showOnAiHub === true
        );
      })
      .map((faq) => {
        const fields = faq.aiFaqFields;
        const category = normalizeAcfSelect(fields?.faqCategory);

        return {
          id: faq.id,
          title: faq.title,
          slug: faq.slug,
          uri: faq.uri || '',
          menuOrder: faq.menuOrder ?? 0,
          answer: fields?.answer || '',
          categoryValue: category.value,
          categoryLabel: category.label,
          featuredOnOverview: fields?.featuredonoverview === true,
        };
      })
      .sort((a, b) => a.menuOrder - b.menuOrder);
}

export async function getAiHubOverviewFaqs(): Promise<AiHubFaq[]> {
  const faqs = await getAiHubFaqs();

  return faqs.filter((faq) => faq.featuredOnOverview);
}

// --- AI HUB TROUBLESHOOTING ---

interface AiTroubleshootingPlatform {
  nodes?: {
    id: string;
    title?: string | null;
  }[] | null;
}

interface AiTroubleshootingFields {
  answer?: string | null;
  featuredonoverview?: boolean | null;
  showOnAiHub?: boolean | null;
  aiPlatform?: AiTroubleshootingPlatform | null;
}

interface AiTroubleshootingNode {
  id: string;
  title: string;
  slug: string;
  uri?: string | null;
  menuOrder?: number | null;
  status?: string | null;
  aiTroubleshootingFields?: AiTroubleshootingFields | null;
}

interface GetAiTroubleshootingResponse {
  aiTroubleshootings: {
    nodes: AiTroubleshootingNode[];
  };
}

export interface AiHubTroubleshooting {
  id: string;
  title: string;
  slug: string;
  uri: string;
  menuOrder: number;
  answer: string;
  featuredOnOverview: boolean;
  platformNames: string[];
  platformIds: string[];
}

const GET_AI_HUB_TROUBLESHOOTING = `
  query GetAiHubTroubleshooting {
    aiTroubleshootings(first: 100) {
      nodes {
        id
        title
        slug
        uri
        menuOrder
        status
        aiTroubleshootingFields {
          answer
          featuredonoverview
          showOnAiHub
          aiPlatform {
            nodes {
              id
              ... on NodeWithTitle {
                title
              }
            }
          }
        }
      }
    }
  }
`;

export async function getAiHubTroubleshooting(): Promise<AiHubTroubleshooting[]> {
  const data = await fetchAPI<GetAiTroubleshootingResponse>(
      GET_AI_HUB_TROUBLESHOOTING,
  );

  return data.aiTroubleshootings.nodes
      .filter((item) => {
        const fields = item.aiTroubleshootingFields;

        return (
            item.status === 'publish' &&
            fields?.showOnAiHub === true
        );
      })
      .map((item) => {
        const fields = item.aiTroubleshootingFields;
        const platforms = fields?.aiPlatform?.nodes || [];

        return {
          id: item.id,
          title: item.title,
          slug: item.slug,
          uri: item.uri || '',
          menuOrder: item.menuOrder ?? 0,
          answer: fields?.answer || '',
          featuredOnOverview: fields?.featuredonoverview === true,
          platformIds: platforms.map((platform) => platform.id),
          platformNames: platforms
              .map((platform) => platform.title || '')
              .filter(Boolean),
        };
      })
      .sort((a, b) => a.menuOrder - b.menuOrder);
}

export async function getAiHubOverviewTroubleshooting(): Promise<
    AiHubTroubleshooting[]
> {
  const items = await getAiHubTroubleshooting();

  return items.filter((item) => item.featuredOnOverview);
}

// --- AI HUB PLATFORM GUIDE DATA ---

interface GetAiPlatformBySlugResponse {
  aiPlatform: AiPlatformNode | null;
}

export async function getAiHubPlatformBySlug(
    slug: string,
): Promise<AiHubPlatform | null> {
  const data = await fetchAPI<GetAiPlatformBySlugResponse>(
      `
      query GetAiPlatformBySlug($slug: ID!) {
        aiPlatform(id: $slug, idType: SLUG) {
          id
          title
          slug
          uri
          menuOrder
          status
          aiPlatformFields {
            accountRequirements
            compatibilityStatus
            endpointOverride
            lastTestedAt
            officialPlatformUrl
            platformLogo {
              node {
                sourceUrl
                altText
              }
            }
            shortDescription
            showOnAiHub
            testPrompt
          }
        }
      }
    `,
      { slug },
  );

  const platform = data.aiPlatform;

  if (
      !platform ||
      platform.status !== 'publish' ||
      platform.aiPlatformFields?.showOnAiHub !== true
  ) {
    return null;
  }

  const fields = platform.aiPlatformFields;
  const compatibilityStatus = normalizeAcfSelect(fields?.compatibilityStatus);

  return {
    id: platform.id,
    title: platform.title,
    slug: platform.slug,
    uri: platform.uri || '',
    menuOrder: platform.menuOrder ?? 0,

    shortDescription: fields?.shortDescription || '',

    compatibilityStatusValue: compatibilityStatus.value,
    compatibilityStatusLabel: compatibilityStatus.label,

    endpointOverride: fields?.endpointOverride || '',
    lastTestedAt: fields?.lastTestedAt || null,
    officialPlatformUrl: fields?.officialPlatformUrl || '',

    logoUrl: fields?.platformLogo?.node?.sourceUrl || null,
    logoAlt:
        fields?.platformLogo?.node?.altText ||
        `${platform.title} logo`,

    accountRequirements: fields?.accountRequirements || '',
    testPrompt: fields?.testPrompt || '',
  };
}

// --- AI HUB CONNECTION STEPS ---

interface AiConnectionStepPlatform {
  nodes?: {
    id: string;
  }[] | null;
}

interface AiConnectionStepFields {
  stepNumber?: number | null;
  instruction?: string | null;
  urlOrCode?: string | null;
  note?: string | null;
  showOnAiHub?: boolean | null;
  aiPlatform?: AiConnectionStepPlatform | null;
}

interface AiConnectionStepNode {
  id: string;
  title: string;
  slug: string;
  uri?: string | null;
  menuOrder?: number | null;
  status?: string | null;
  aiConnectionStepFields?: AiConnectionStepFields | null;
}

interface GetAiConnectionStepsResponse {
  aiConnectionSteps: {
    nodes: AiConnectionStepNode[];
  };
}

export interface AiHubConnectionStep {
  id: string;
  title: string;
  slug: string;
  uri: string;
  menuOrder: number;
  stepNumber: number;
  instruction: string;
  urlOrCode: string;
  note: string;
}

const GET_AI_HUB_CONNECTION_STEPS = `
  query GetAiHubConnectionSteps {
    aiConnectionSteps(first: 100) {
      nodes {
        id
        title
        slug
        uri
        menuOrder
        status
        aiConnectionStepFields {
          stepNumber
          instruction
          urlOrCode
          note
          showOnAiHub
          aiPlatform {
            nodes {
              id
            }
          }
        }
      }
    }
  }
`;

function normalizeConnectionStepTitle(title: string): string {
  return title
      .replace(/^\s*[^–—-]+?\s*[–—-]\s*/, '')
      .trim();
}

export async function getAiHubConnectionSteps(
    platformId: string,
): Promise<AiHubConnectionStep[]> {
  const data = await fetchAPI<GetAiConnectionStepsResponse>(
      GET_AI_HUB_CONNECTION_STEPS,
  );

  return data.aiConnectionSteps.nodes
      .filter((step) => {
        const fields = step.aiConnectionStepFields;

        return (
            step.status === 'publish' &&
            fields?.showOnAiHub === true &&
            fields.aiPlatform?.nodes?.some(
                (platform) => platform.id === platformId,
            )
        );
      })
      .map((step) => {
        const fields = step.aiConnectionStepFields;

        return {
          id: step.id,
          title: normalizeConnectionStepTitle(step.title),
          slug: step.slug,
          uri: step.uri || '',
          menuOrder: step.menuOrder ?? 0,
          stepNumber: Number(fields?.stepNumber ?? 0),
          instruction: fields?.instruction || '',
          urlOrCode: fields?.urlOrCode || '',
          note: fields?.note || '',
        };
      })
      .sort((a, b) => {
        const menuOrderDifference = a.menuOrder - b.menuOrder;

        if (menuOrderDifference !== 0) {
          return menuOrderDifference;
        }

        return a.stepNumber - b.stepNumber;
      });
}
