import { describe, expect, it, vi } from "vitest";

import { collectAllPages, type WpConnection } from "./wp-pagination.js";

interface Row {
  id: string;
}

function page(
  ids: string[],
  pageInfo?: WpConnection<Row>["pageInfo"],
): WpConnection<Row> {
  return {
    nodes: ids.map((id) => ({ id })),
    pageInfo,
  };
}

describe("collectAllPages", () => {
  it("returns a single page without following a cursor", async () => {
    const calls: Array<{ first: number; after: string | null }> = [];

    const rows = await collectAllPages<Row>(async (variables) => {
      calls.push(variables);
      return page(["a", "b"], { hasNextPage: false, endCursor: null });
    });

    expect(rows.map((row) => row.id)).toEqual(["a", "b"]);
    expect(calls).toEqual([{ first: 100, after: null }]);
  });

  it("follows the cursor chain and concatenates every page", async () => {
    const calls: Array<{ first: number; after: string | null }> = [];
    const pages = [
      page(["a", "b"], { hasNextPage: true, endCursor: "cursor-1" }),
      page(["c"], { hasNextPage: true, endCursor: "cursor-2" }),
      page(["d"], { hasNextPage: false, endCursor: null }),
    ];

    const rows = await collectAllPages<Row>(async (variables) => {
      calls.push(variables);
      return pages[calls.length - 1]!;
    });

    expect(rows.map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
    expect(calls.map((call) => call.after)).toEqual([null, "cursor-1", "cursor-2"]);
  });

  it("returns an empty array for an empty connection", async () => {
    const rows = await collectAllPages<Row>(async () => ({
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    }));

    expect(rows).toEqual([]);
  });

  it("treats a missing pageInfo as the last page", async () => {
    const rows = await collectAllPages<Row>(async () => page(["a"]));

    expect(rows.map((row) => row.id)).toEqual(["a"]);
  });

  it("stops and warns when the cursor does not advance", async () => {
    const warn = vi.fn();

    const rows = await collectAllPages<Row>(
      async () => page(["a"], { hasNextPage: true, endCursor: "same" }),
      { warn },
    );

    expect(rows.map((row) => row.id)).toEqual(["a", "a"]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/cursor did not advance/);
  });

  it("stops and warns when the page budget is exhausted", async () => {
    const warn = vi.fn();
    let pageNumber = 0;

    const rows = await collectAllPages<Row>(
      async () => {
        pageNumber += 1;
        return page([`p${pageNumber}`], {
          hasNextPage: true,
          endCursor: `cursor-${pageNumber}`,
        });
      },
      { maxPages: 3, warn },
    );

    expect(rows.map((row) => row.id)).toEqual(["p1", "p2", "p3"]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/stopped after 3 pages/);
  });

  it("clamps the page size to the WPGraphQL limit", async () => {
    const sizes: number[] = [];

    await collectAllPages<Row>(
      async ({ first }) => {
        sizes.push(first);
        return page([], { hasNextPage: false, endCursor: null });
      },
      { pageSize: 500 },
    );

    expect(sizes).toEqual([100]);
  });
});
