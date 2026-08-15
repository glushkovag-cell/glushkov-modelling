export interface PageResult<T> {
    total: number;
    returned: number;
    hasMore: boolean;
    limit: number;
    offset: number;
    nextOffset: number | null;
    items: T[];
}

export function paginate<T>(
    items: T[],
    limit: number,
    offset: number,
): PageResult<T> {
    const total = items.length;
    const pageItems = items.slice(offset, offset + limit);
    const returned = pageItems.length;
    const nextOffset = offset + returned < total ? offset + returned : null;

    return {
        total,
        returned,
        hasMore: nextOffset !== null,
        limit,
        offset,
        nextOffset,
        items: pageItems,
    };
}