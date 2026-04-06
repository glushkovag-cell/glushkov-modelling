const WP_API = import.meta.env.WP_GRAPHQL_URL;
console.log('WP_GRAPHQL_URL =', import.meta.env.WP_GRAPHQL_URL);

if (!WP_API) {
  throw new Error('WP_GRAPHQL_URL is not defined');
}

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
              content
              featuredImage {
                node {
                  sourceUrl
                  altText
                }
              }
              buildLog {
                modelScale
                manufacturer
                buildStatus
                partNumber
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
            buildLog {
              modelScale
              manufacturer
              buildStatus
              partNumber
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