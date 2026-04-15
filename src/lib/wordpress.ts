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

  return {
    ...post,
    heroImage: post.featuredImage?.node?.sourceUrl || null,
    heroImageAlt: post.featuredImage?.node?.altText || post.title,
    partNumber,
    partContent: post.buildlog?.partcontent || post.content || '',
    recordDay: post.buildlog?.recordday || null,
  };
}

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
          }
        }
      }
    }
  `);

  return data.models.nodes.map(normalizeModel);
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