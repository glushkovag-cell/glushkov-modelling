const WP_API = import.meta.env.WP_GRAPHQL_URL;

if (!WP_API) {
  throw new Error('WP_GRAPHQL_URL is not defined');
}

// --- getAllBuilds: slugи постов для getStaticPaths ---
export async function getAllBuilds() {
  const res = await fetch(WP_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `
        query {
          posts(where: { categoryName: "builds" }) {
            nodes {
              slug
            }
          }
        }
      `,
    }),
  });
  const json = await res.json();
  return json.data?.posts?.nodes ?? [];
}

// --- getBuildPosts: карточки для /builds ---
export async function getBuildPosts() {
  const res = await fetch(WP_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `
        query {
          posts(where: { categoryName: "builds" }) {
            nodes {
              slug
              title
              featuredImage {
                node {
                  sourceUrl
                  altText
                }
              }
              buildlog {
                modelslug
                partnumber
              }
            }
          }
        }
      `,
    }),
  });
  const json = await res.json();
  return json.data?.posts?.nodes ?? [];
}

// --- getBuildBySlug: одна запись по slug ---
export async function getBuildBySlug(slug: string) {
  const res = await fetch(WP_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `
        query ($slug: ID!) {
          post(id: $slug, idType: SLUG) {
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
              partcontent
              partnumber
            }
          }
        }
      `,
      variables: { slug },
    }),
  });
  const json = await res.json();
  return json.data?.post ?? null;
}

// --- getBuildPartsByModel: все части одной модели ---
export async function getBuildPartsByModel(modelSlug: string) {
  const res = await fetch(WP_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `
        query {
          posts(where: { categoryName: "builds" }) {
            nodes {
              slug
              title
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
              }
            }
          }
        }
      `,
    }),
  });
  const json = await res.json();
  const all = json.data?.posts?.nodes ?? [];
  return all
    .filter((p: any) => p.buildlog?.modelslug === modelSlug)
    .sort(
      (a: any, b: any) =>
        (a.buildlog?.partnumber ?? 0) - (b.buildlog?.partnumber ?? 0)
    );
}

// --- getModelBySlug: данные модели по slug ---
export async function getModelBySlug(slug: string) {
  const res = await fetch(WP_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `
        query ($slug: ID!) {
          model(id: $slug, idType: SLUG) {
            slug
            title
            modelinfo {
              shortdescription
              historicalnote
              modelscale
              manufacturer
              totalparts
              modellength
              historicalyear
              buildstatus
              modelimageurl
            }
          }
        }
      `,
      variables: { slug },
    }),
  });
  const json = await res.json();
  return json.data?.model ?? null;
}

// --- getAllModels: все модели CPT ---
export async function getAllModels() {
  const res = await fetch(WP_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `
        query {
          models {
            nodes {
              slug
              title
              modelinfo {
                shortdescription
                modelscale
                manufacturer
                buildstatus
                modelimageurl
              }
            }
          }
        }
      `,
    }),
  });
  const json = await res.json();
  return (json.data?.models?.nodes ?? []).map((model: any) => ({
    ...model,
    heroImage: model?.modelinfo?.modelimageurl || null,
    heroImageAlt: model?.title || '',
    buildstatusText: Array.isArray(model?.modelinfo?.buildstatus)
      ? model.modelinfo.buildstatus.join(', ')
      : model?.modelinfo?.buildstatus ?? '',
    buildstatusClass: Array.isArray(model?.modelinfo?.buildstatus)
      ? String(model.modelinfo.buildstatus[0] ?? '').toLowerCase().replace(/\s+/g, '-')
      : String(model?.modelinfo?.buildstatus ?? '').toLowerCase().replace(/\s+/g, '-'),
  }));
}

// --- getModelsWithFirstPart: модели с первой частью build log ---
export async function getModelsWithFirstPart() {
  const [models, posts] = await Promise.all([
    getAllModels(),
    getBuildPosts(),
  ]);
  return models.map((model: any) => {
    const parts = posts
      .filter((p: any) => p.buildlog?.modelslug === model.slug)
      .sort(
        (a: any, b: any) =>
          (a.buildlog?.partnumber ?? 0) - (b.buildlog?.partnumber ?? 0)
      );
    return {
      ...model,
      firstPartSlug: parts.length > 0 ? parts[0].slug : null,
      partsCount: parts.length,
    };
  });
}
