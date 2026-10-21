/**
 * Cursor pagination for WPGraphQL connections.
 *
 * Mirrors src/lib/wp-pagination.ts in the Astro project. The MCP server is a
 * separate package, so the helper is duplicated rather than shared; the logic
 * and the stop conditions must stay in sync.
 */

export interface WpPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface WpConnection<TNode> {
  nodes: TNode[];
  pageInfo?: WpPageInfo | null;
}

export interface CollectPagesOptions {
  /** Nodes requested per page. WPGraphQL caps this at 100. */
  pageSize?: number;
  /** Safety ceiling; a warning is logged when it is reached. */
  maxPages?: number;
  /** Label used in warnings. */
  label?: string;
  /** Injection point for tests; defaults to console.warn. */
  warn?: (message: string) => void;
}

export async function collectAllPages<TNode>(
  fetchPage: (variables: {
    first: number;
    after: string | null;
  }) => Promise<WpConnection<TNode>>,
  options: CollectPagesOptions = {},
): Promise<TNode[]> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 100, 1), 100);
  const maxPages = Math.max(options.maxPages ?? 50, 1);
  const label = options.label ?? "connection";
  const warn = options.warn ?? ((message: string) => console.warn(message));

  const nodes: TNode[] = [];
  const seenCursors = new Set<string>();
  let after: string | null = null;

  for (let page = 1; page <= maxPages; page += 1) {
    const connection = await fetchPage({ first: pageSize, after });

    nodes.push(...(connection.nodes ?? []));

    if (!connection.pageInfo?.hasNextPage) {
      return nodes;
    }

    const cursor = connection.pageInfo.endCursor;

    if (!cursor || seenCursors.has(cursor)) {
      warn(
        `[wp] ${label}: pagination stopped on page ${page} because ` +
          "the cursor did not advance; results may be truncated",
      );

      return nodes;
    }

    seenCursors.add(cursor);
    after = cursor;
  }

  warn(
    `[wp] ${label}: stopped after ${maxPages} pages; results may be truncated`,
  );

  return nodes;
}
