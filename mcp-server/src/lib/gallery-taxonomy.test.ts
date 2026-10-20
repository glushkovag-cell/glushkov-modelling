// mcp-server/src/lib/gallery-taxonomy.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config.js", () => ({
    config: {
        cmsGalleryUrl: "https://cms.example.com/gallery",
        galleryManifestPath: "/tmp/gallery",
        wpGraphqlUrl: "https://cms.example.com/graphql",
        requestTimeoutMs: 1000,
    },
}));

vi.mock("./public-urls.js", () => ({
    buildUrl: (slug: string) => `https://site.example.com/builds/${slug}`,
    galleryUrl: (slug: string) => `https://site.example.com/gallery/${slug}`,
}));

import {
    normalizeImageTags,
    normalizeManifestPhotos,
    type RawGalleryManifest,
} from "./gallery.js";
import {
    buildTaxonomyDictionary,
    normalizeTaxonomyTerm,
    type TaxonomyTerm,
} from "./taxonomy.js";
import {
    getTagUsageSnapshot,
    resetTagUsageCache,
    TAG_USAGE_CACHE_TTL_MS,
} from "./tag-usage.js";
import type { TutorialListNode } from "./tutorials.js";
import { paginate } from "./pagination.js";
import {
    filterGalleryPhotos,
    listGalleryPhotosInputSchema,
} from "../tools/list-gallery-photos.js";
import {
    buildGroupedTags,
    buildTaxonomyTags,
} from "../tools/list-tutorial-taxonomy.js";
import { z } from "zod";

// ─── fixtures ─────────────────────────────────────────────────────────────────

const terms: TaxonomyTerm[] = [
    { slug: "hull", name: "Hull", facet: "component", status: "active", publicFilter: true },
    { slug: "deck", name: "Deck", facet: "component", status: "active", publicFilter: true },
    { slug: "standing-rigging", name: "Standing Rigging", facet: "context", status: "active", publicFilter: true },
    { slug: "side-view", name: "Side View", facet: "view", status: "active", publicFilter: false },
    { slug: "close-up", name: "Close-up", facet: "view", status: "active", publicFilter: false },
    { slug: "planking", name: "Planking", facet: "technique", status: "active", publicFilter: true },
    { slug: "priming", name: "Priming", facet: "technique", status: "active", publicFilter: true },
    { slug: "rigging", name: "Rigging", facet: null, status: "deprecated", publicFilter: false },
];

const dictionary = buildTaxonomyDictionary(terms);

const v1Manifest: RawGalleryManifest = {
    slug: "old-model",
    title: "Old Model",
    scale: "1:50",
    images: [
        { file: "2.webp", order: 2, section: "deck", paths: { lowRes: "old-model/low-res/2.webp", hiRes: null } },
        { file: "1.webp", order: 1, section: "hull", paths: { lowRes: "old-model/low-res/1.webp", hiRes: "old-model/hi-res/1.webp" } },
        { file: "3.webp", order: 3, section: "rigging" },
    ],
};

const v2Manifest: RawGalleryManifest = {
    schemaVersion: 2,
    slug: "le-requin",
    title: "Le Requin",
    scale: "1:48",
    images: [
        { file: "1.webp", order: 1, section: ["Hull", "side-view"], legacySection: "overall" },
        { file: "2.webp", order: 2, section: ["deck", "close-up", "hull"], legacySection: "deck" },
        { file: "3.webp", order: 3, sections: ["standing-rigging"], section: ["close-up"] },
        { file: "4.webp", order: 4, section: [] },
        { file: "5.webp", order: 5, section: ["unknown-tag", "rigging"] },
    ],
};

const photos = [
    ...normalizeManifestPhotos(v1Manifest),
    ...normalizeManifestPhotos(v2Manifest),
];

// ─── manifest normalization ───────────────────────────────────────────────────

describe("gallery manifest normalization", () => {
    it("wraps a v1 string section into an array", () => {
        expect(normalizeImageTags({ file: "a", order: 1, section: "hull" })).toEqual(["hull"]);
    });

    it("merges v2 sections and section arrays, lowercases and deduplicates", () => {
        expect(
            normalizeImageTags({
                file: "a",
                order: 1,
                sections: ["Deck", "hull"],
                section: ["hull", " close-up "],
            }),
        ).toEqual(["deck", "hull", "close-up"]);
    });

    it("returns an empty array for missing or empty values", () => {
        expect(normalizeImageTags({ file: "a", order: 1 })).toEqual([]);
        expect(normalizeImageTags({ file: "a", order: 1, section: "" })).toEqual([]);
        expect(normalizeImageTags({ file: "a", order: 1, section: [] })).toEqual([]);
    });

    it("sorts images by order and keeps metadata", () => {
        const result = normalizeManifestPhotos(v1Manifest);
        expect(result.map((p) => p.file)).toEqual(["1.webp", "2.webp", "3.webp"]);
        expect(result[0].paths.hiRes).toBe("old-model/hi-res/1.webp");
        expect(result[0].legacySection).toBeNull();
    });
});

// ─── list_gallery_photos filtering ────────────────────────────────────────────

describe("list_gallery_photos filtering", () => {
    it("returns section as an array for both v1 and v2 photos", () => {
        const { photos: result } = filterGalleryPhotos(photos, { match: "any" }, dictionary);
        expect(result).toHaveLength(8);
        for (const photo of result) {
            expect(Array.isArray(photo.section)).toBe(true);
        }
        expect(result[0].section).toEqual(["hull"]);
        expect(result[3].section).toEqual(["hull", "side-view"]);
    });

    it("excludes unknown and non-active terms from section", () => {
        const { photos: result } = filterGalleryPhotos(photos, { match: "any" }, dictionary);
        expect(result[2].section).toEqual([]); // v1 "rigging" (deprecated)
        expect(result[7].section).toEqual([]); // v2 ["unknown-tag", "rigging"]
        expect(result.some((p) => p.section.includes("rigging"))).toBe(false);
        expect(result.some((p) => p.section.includes("unknown-tag"))).toBe(false);
    });

    it("adds tag details with name and facet", () => {
        const { photos: result } = filterGalleryPhotos(photos, { tag: "side-view", match: "any" }, dictionary);
        expect(result[0].tagDetails).toEqual([
            { slug: "hull", name: "Hull", facet: "component" },
            { slug: "side-view", name: "Side View", facet: "view" },
        ]);
    });

    it("gives the same result for a tag string and a one-element array", () => {
        const asString = filterGalleryPhotos(photos, { tag: "hull", match: "any" }, dictionary);
        const asArray = filterGalleryPhotos(photos, { tag: ["hull"], match: "any" }, dictionary);
        const asArrayAll = filterGalleryPhotos(photos, { tag: ["hull"], match: "all" }, dictionary);
        expect(asString.photos).toEqual(asArray.photos);
        expect(asString.photos).toEqual(asArrayAll.photos);
        expect(asString.photos).toHaveLength(3);
        expect(asString.tagSlugs).toEqual(["hull"]);
    });

    it("accepts display names and mixed case as tag values", () => {
        const bySlug = filterGalleryPhotos(photos, { tag: "standing-rigging", match: "any" }, dictionary);
        const byName = filterGalleryPhotos(photos, { tag: ["Standing Rigging"], match: "any" }, dictionary);
        expect(byName.photos).toEqual(bySlug.photos);
        expect(byName.tagSlugs).toEqual(["standing-rigging"]);
    });

    it("match=any uses OR between tags", () => {
        const { photos: result } = filterGalleryPhotos(photos, { tag: ["side-view", "standing-rigging"], match: "any" }, dictionary);
        expect(result.map((p) => p.section)).toEqual([
            ["hull", "side-view"],
            ["standing-rigging", "close-up"],
        ]);
    });

    it("match=all uses AND between tags", () => {
        const { photos: result } = filterGalleryPhotos(photos, { tag: ["hull", "close-up"], match: "all" }, dictionary);
        expect(result).toHaveLength(1);
        expect(result[0].section).toEqual(["deck", "close-up", "hull"]);
    });

    it("tagFacet keeps photos with at least one tag of the facet", () => {
        const { photos: result } = filterGalleryPhotos(photos, { tagFacet: "view", match: "any" }, dictionary);
        expect(result).toHaveLength(3);
        expect(result.every((p) => p.tagDetails.some((t) => t.facet === "view"))).toBe(true);
    });

    it("tag and tagFacet are combined with AND", () => {
        const { photos: result } = filterGalleryPhotos(photos, { tag: "hull", tagFacet: "view", match: "any" }, dictionary);
        expect(result).toHaveLength(2);
        expect(result.every((p) => p.project === "le-requin")).toBe(true);
    });

    it("returns an empty result and reports unknown or deprecated tags", () => {
        const unknown = filterGalleryPhotos(photos, { tag: ["overall", "rigging"], match: "any" }, dictionary);
        expect(unknown.photos).toEqual([]);
        expect(unknown.unknownTags).toEqual(["overall", "rigging"]);

        const emptyCombination = filterGalleryPhotos(photos, { tag: ["deck", "standing-rigging"], match: "all" }, dictionary);
        expect(emptyCombination.photos).toEqual([]);
        expect(emptyCombination.unknownTags).toEqual([]);
    });

    it("keeps pagination consistent over filtered results", () => {
        const { photos: result } = filterGalleryPhotos(photos, { match: "any" }, dictionary);
        const first = paginate(result, 3, 0);
        const second = paginate(result, 3, first.nextOffset ?? 0);
        const last = paginate(result, 3, 6);
        expect(first.total).toBe(8);
        expect(first.hasMore).toBe(true);
        expect(second.offset).toBe(3);
        expect([...first.items, ...second.items, ...last.items]).toEqual(result);
        expect(last.hasMore).toBe(false);
        expect(last.nextOffset).toBeNull();

        const empty = paginate(filterGalleryPhotos(photos, { tag: "planking", match: "any" }, dictionary).photos, 50, 0);
        expect(empty).toMatchObject({ total: 0, returned: 0, hasMore: false, nextOffset: null, items: [] });
    });

    it("builds absolute image URLs", () => {
        const { photos: result } = filterGalleryPhotos(photos, { match: "any" }, dictionary);
        expect(result[0].lowResUrl).toBe("https://cms.example.com/gallery/old-model/low-res/1.webp");
        expect(result[0].galleryUrl).toBe("https://site.example.com/gallery/old-model");
    });

    it("works without a dictionary using raw manifest tags", () => {
        const { photos: result } = filterGalleryPhotos(photos, { tag: "unknown-tag", match: "any" }, null);
        expect(result).toHaveLength(1);
        expect(result[0].tagDetails[0]).toEqual({ slug: "unknown-tag", name: "unknown-tag", facet: null });
    });
});

describe("list_gallery_photos input schema", () => {
    const schema = z.object(listGalleryPhotosInputSchema);

    it("accepts a string and an array for tag, defaults match to any", () => {
        expect(schema.parse({ tag: "hull" })).toMatchObject({ tag: "hull", match: "any", limit: 50, offset: 0 });
        expect(schema.parse({ tag: ["hull", "deck"], match: "all" })).toMatchObject({ tag: ["hull", "deck"], match: "all" });
    });

    it("accepts the view facet and rejects unknown facets and match values", () => {
        expect(schema.parse({ tagFacet: "view" }).tagFacet).toBe("view");
        expect(() => schema.parse({ tagFacet: "colour" })).toThrow();
        expect(() => schema.parse({ match: "some" })).toThrow();
        expect(() => schema.parse({ tag: [] })).toThrow();
    });
});

// ─── taxonomy dictionary ──────────────────────────────────────────────────────

describe("taxonomy dictionary normalization", () => {
    it("reads slug, name, facet, status from ACF tagSettings", () => {
        expect(
            normalizeTaxonomyTerm({
                slug: "side-view",
                name: "side view",
                tagSettings: { facet: ["view"], status: ["active"], public: false, prefferedLabel: "Side View" },
            }),
        ).toEqual({ slug: "side-view", name: "Side View", facet: "view", status: "active", publicFilter: false });
    });

    it("treats a missing status as active and unknown facet as null", () => {
        expect(
            normalizeTaxonomyTerm({ slug: "Wood", name: "Wood", tagSettings: { facet: "colour" } }),
        ).toEqual({ slug: "wood", name: "Wood", facet: null, status: "active", publicFilter: false });
    });
});

// ─── list_tutorial_taxonomy: appliesTo ────────────────────────────────────────

function tutorial(slug: string, tagSlugs: string[]): TutorialListNode {
    return {
        id: slug,
        title: slug,
        slug,
        tutorialTags: { nodes: tagSlugs.map((s) => ({ id: s, name: s, slug: s })) },
    };
}

const tutorials = [
    tutorial("t1", ["hull", "planking"]),
    tutorial("t2", ["planking", "rigging"]),
];

const galleryUsage = new Map([
    ["hull", 3],
    ["side-view", 1],
    ["close-up", 2],
    ["rigging", 1],
]);

describe("list_tutorial_taxonomy appliesTo", () => {
    beforeEach(() => resetTagUsageCache());

    it("returns only active assigned tags with appliesTo from actual data", async () => {
        const snapshot = await getTagUsageSnapshot({
            loadTutorials: async () => tutorials,
            loadGalleryUsage: async () => galleryUsage,
        });

        const tags = buildTaxonomyTags(dictionary, snapshot, snapshot.tutorials, { includeDeprecated: false });
        const bySlug = Object.fromEntries(tags.map((t) => [t.slug, t]));

        expect(Object.keys(bySlug).sort()).toEqual(["close-up", "hull", "planking", "side-view"]);
        expect(bySlug.hull.appliesTo).toEqual(["tutorials", "gallery"]);
        expect(bySlug.planking.appliesTo).toEqual(["tutorials"]);
        expect(bySlug["side-view"].appliesTo).toEqual(["gallery"]);
        expect(bySlug.planking.count).toBe(2);
        expect(bySlug.hull).toMatchObject({ count: 1, photoCount: 3, facet: "component", status: "active" });
        // priming is active but unassigned; deck is active but unassigned
        expect(bySlug.priming).toBeUndefined();
        expect(bySlug.deck).toBeUndefined();
        // ordering: by tutorial count, then photo count
        expect(tags[0].slug).toBe("planking");
    });

    it("includes non-active assigned tags only with includeDeprecated", async () => {
        const snapshot = await getTagUsageSnapshot({
            loadTutorials: async () => tutorials,
            loadGalleryUsage: async () => galleryUsage,
        });
        const tags = buildTaxonomyTags(dictionary, snapshot, snapshot.tutorials, { includeDeprecated: true });
        const rigging = tags.find((t) => t.slug === "rigging");
        expect(rigging).toMatchObject({ status: "deprecated", facet: "unclassified", appliesTo: ["tutorials", "gallery"] });
    });

    it("filters by appliesTo and groups by facet including view", async () => {
        const snapshot = await getTagUsageSnapshot({
            loadTutorials: async () => tutorials,
            loadGalleryUsage: async () => galleryUsage,
        });
        const galleryTags = buildTaxonomyTags(dictionary, snapshot, snapshot.tutorials, { includeDeprecated: false, appliesTo: "gallery" });
        expect(galleryTags.map((t) => t.slug).sort()).toEqual(["close-up", "hull", "side-view"]);

        const grouped = buildGroupedTags(galleryTags);
        expect(grouped.map((g) => g.facet)).toEqual(["component", "view"]);
    });

    it("caches appliesTo for 60 minutes", async () => {
        let now = 1_000_000;
        const loadTutorials = vi.fn(async () => tutorials);
        const loadGalleryUsage = vi.fn(async () => galleryUsage);
        const sources = { loadTutorials, loadGalleryUsage, now: () => now };

        const first = await getTagUsageSnapshot(sources);
        now += TAG_USAGE_CACHE_TTL_MS - 1;
        const cached = await getTagUsageSnapshot(sources);
        expect(cached).toBe(first);
        expect(loadGalleryUsage).toHaveBeenCalledTimes(1);

        now += 2;
        const refreshed = await getTagUsageSnapshot(sources);
        expect(refreshed).not.toBe(first);
        expect(loadGalleryUsage).toHaveBeenCalledTimes(2);
        expect(TAG_USAGE_CACHE_TTL_MS).toBe(60 * 60_000);
    });

    it("uses a short cache when gallery usage cannot be read", async () => {
        let now = 0;
        const sources = {
            loadTutorials: async () => tutorials,
            loadGalleryUsage: async () => { throw new Error("EACCES"); },
            now: () => now,
        };
        const snapshot = await getTagUsageSnapshot(sources);
        expect(snapshot.galleryAvailable).toBe(false);
        expect(snapshot.expiresAt - snapshot.computedAt).toBe(60_000);
        expect(snapshot.tutorials.get("planking")).toBe(2);
    });
});
