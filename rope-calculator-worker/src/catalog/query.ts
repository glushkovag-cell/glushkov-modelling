/**
 * Фиксированный запрос каталога. Клиент не может подменить ни endpoint,
 * ни текст запроса: оба задаются сервером.
 *
 * `first: 100` — максимум WPGraphQL на страницу; остальное добирается по
 * курсору, чтобы каталог больше 100 записей не обрезался молча.
 */
export const ROPE_CATALOG_QUERY = `
  query RopeCatalog($first: Int!, $after: String) {
    ropeThreads(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        slug
        status
        ropethreadfields {
          threadId
          brand
          number
          dtex
          enabled
          sortOrder
        }
      }
    }
  }
`;

/** Размер страницы для сбора каталога. */
export const CATALOG_PAGE_SIZE = 100;

/** Предел страниц: защита от бесконечного курсора. */
export const CATALOG_MAX_PAGES = 10;
