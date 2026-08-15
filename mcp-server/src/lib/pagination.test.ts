import { describe, expect, it } from "vitest";
import { paginate } from "./pagination.js";

describe("paginate", () => {
    const items = [
        { id: "1" },
        { id: "2" },
        { id: "3" },
        { id: "4" },
        { id: "5" },
        { id: "6" },
        { id: "7" },
    ];

    it("reports total independently from current page size", () => {
        const result = paginate(items, 3, 0);

        expect(result.total).toBe(7);
        expect(result.returned).toBe(3);
        expect(result.items).toEqual([{ id: "1" }, { id: "2" }, { id: "3" }]);
        expect(result.offset).toBe(0);
        expect(result.nextOffset).toBe(3);
        expect(result.hasMore).toBe(true);
    });

    it("returns consecutive pages without overlapping results", () => {
        const first = paginate(items, 3, 0);
        const second = paginate(items, 3, 3);

        expect(second.items).toEqual([{ id: "4" }, { id: "5" }, { id: "6" }]);

        const firstIds = new Set(first.items.map((item) => item.id));
        expect(second.items.some((item) => firstIds.has(item.id))).toBe(false);

        expect(second.nextOffset).toBe(6);
        expect(second.hasMore).toBe(true);
    });

    it("marks the final partial page as complete", () => {
        const result = paginate(items, 3, 6);

        expect(result.items).toEqual([{ id: "7" }]);
        expect(result.total).toBe(7);
        expect(result.returned).toBe(1);
        expect(result.nextOffset).toBeNull();
        expect(result.hasMore).toBe(false);
    });

    it("returns an empty final page when offset equals total", () => {
        const result = paginate(items, 3, 7);

        expect(result.items).toEqual([]);
        expect(result.total).toBe(7);
        expect(result.returned).toBe(0);
        expect(result.nextOffset).toBeNull();
        expect(result.hasMore).toBe(false);
    });

    it("supports an empty collection", () => {
        const result = paginate([], 10, 0);

        expect(result).toEqual({
            total: 0,
            returned: 0,
            hasMore: false,
            limit: 10,
            offset: 0,
            nextOffset: null,
            items: [],
        });
    });
});