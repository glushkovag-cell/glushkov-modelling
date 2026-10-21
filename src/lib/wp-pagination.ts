/**
 * wp-pagination.ts
 *
 * WPGraphQL returns at most `first` nodes per connection. The site used to ask
 * for `first: 100` and silently drop everything beyond that limit, so a model
 * catalogue or build log larger than 100 entries would lose content without
 * any error.
 *
 * `collectAllPages` walks the cursor chain instead, and stops loudly when it
 * cannot continue (repeated cursor or page budget exceeded) so truncation is
 * never silent again.
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
    const label = options.label ?? 'connection';
    const warn = options.warn ?? ((message: string) => console.warn(message));

    const nodes: TNode[] = [];
    const seenCursors = new Set<string>();
    let after: string | null = null;

    for (let page = 1; page <= maxPages; page += 1) {
        const connection = await fetchPage({ first: pageSize, after });

        nodes.push(...(connection.nodes ?? []));

        const pageInfo = connection.pageInfo;

        if (!pageInfo?.hasNextPage) {
            return nodes;
        }

        const cursor = pageInfo.endCursor;

        if (!cursor || seenCursors.has(cursor)) {
            warn(
                `[wp] ${label}: pagination stopped on page ${page} because ` +
                'the cursor did not advance; results may be truncated',
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

/**
 * Logs when a connection returns the full page size. These collections are not
 * paginated yet, so hitting the limit means nodes may be missing — make that
 * visible instead of silently returning a partial list.
 */
export function warnIfAtLimit<T>(nodes: T[], label: string, limit = 100): T[] {
    if (nodes.length >= limit) {
        console.warn(
            `[wp] ${label}: received ${nodes.length} nodes (limit ${limit}); ` +
            'results may be truncated',
        );
    }

    return nodes;
}
