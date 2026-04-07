const WP_API = import.meta.env.WP_GRAPHQL_URL;

if (!WP_API) {
  throw new Error('WP_GRAPHQL_URL is not defined');
}

// ─── Каталог: все slugи для getStaticPaths ───────────────────────────────────
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
  return json.data.posts.nodes;
}

// ─── Каталог: карточки для /builds ──────────────────────────────────────────
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
  return json.data.posts.nodes;
}

// ─── Страница части: одна запись по slug ─────────────────────────────────────
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
  return json.data.post;
}

// ─── Stepper: все части одной модели ─────────────────────────────────────────
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
  const all = json.data.posts.nodes;
  return all
    .filter((p: any) => p.buildlog?.modelslug === modelSlug)
    .sort((a: any, b: any) =>
      (a.buildlog?.partnumber ?? 0) - (b.buildlog?.partnumber ?? 0)
    );
}

// ─── CPT Model: данные модели по slug ────────────────────────────────────────
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
            }
          }
        }
      `,
      variables: { slug },
    }),
  });
  const json = await res.json();
  return json.data.model;
}