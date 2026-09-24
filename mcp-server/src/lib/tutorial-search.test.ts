// mcp-server/src/lib/tutorial-search.test.ts
import { describe, expect, it } from "vitest";
import {
    createExcerpt,
    findTutorialTextMatch,
    getSearchTerms,
} from "./tutorial-search.js";

describe("tutorial full-text search helpers", () => {
    const tutorial = {
        title: "Running rigging",
        teaser: "Methods for installing lines on ship models.",
        content:
            "<p>Use waxed thread before installation to avoid fraying.</p>" +
            "<p>Prepare blocks and belaying pins before tensioning the lines.</p>",
    };

    it("finds a phrase that exists only in article body", () => {
        const match = findTutorialTextMatch(
            tutorial,
            getSearchTerms("waxed thread"),
        );

        expect(match).not.toBeNull();
        expect(match?.matchedFields).toEqual(["content"]);
    });

    it("uses AND semantics for multiple search terms", () => {
        const match = findTutorialTextMatch(
            tutorial,
            getSearchTerms("waxed nonexistent"),
        );

        expect(match).toBeNull();
    });

    // ИСПРАВЛЕНО: слова распределены по полям — matchedFields отражает
    // каждое поле, где нашлось хотя бы одно слово запроса.
    it("finds terms distributed across title and body", () => {
        const match = findTutorialTextMatch(
            tutorial,
            getSearchTerms("running waxed"),
        );

        expect(match).not.toBeNull();
        // "running" → title, "waxed" → content
        expect(match?.matchedFields).toContain("title");
        expect(match?.matchedFields).toContain("content");
        expect(match?.matchedFields).not.toContain("teaser");
        expect(match?.matchedFields).not.toContain("tags");
    });

    it("preserves individual-field matches", () => {
        const match = findTutorialTextMatch(
            tutorial,
            getSearchTerms("running rigging"),
        );

        expect(match).not.toBeNull();
        expect(match?.matchedFields).toContain("title");
    });

    it("returns a context excerpt around the body match", () => {
        const match = findTutorialTextMatch(
            tutorial,
            getSearchTerms("waxed"),
        );

        const excerpt = createExcerpt(
            match?.plainContent ?? "",
            "waxed",
            tutorial.teaser,
        );

        expect(excerpt).toMatch(/waxed thread/i);
        expect(excerpt?.length).toBeLessThanOrEqual(300);
    });

    it("uses teaser as fallback when article body has no match", () => {
        const excerpt = createExcerpt(
            "Article body without the requested phrase.",
            "lines",
            tutorial.teaser,
        );

        expect(excerpt).toBe(tutorial.teaser);
    });

    // НОВЫЕ ТЕСТЫ для поддержки tagNames (новая таксономия v1)

    it("finds a tutorial by tag name", () => {
        const withTags = {
            ...tutorial,
            tagNames: ["Caulking", "Hull", "Wood Bending"],
        };

        const match = findTutorialTextMatch(
            withTags,
            getSearchTerms("caulking"),
        );

        expect(match).not.toBeNull();
        expect(match?.matchedFields).toContain("tags");
        expect(match?.matchedFields).not.toContain("content");
    });

    it("matches when one term is in tag and another in title", () => {
        const withTags = {
            ...tutorial,
            tagNames: ["Caulking", "Hull"],
        };

        // "running" → title, "caulking" → tags
        const match = findTutorialTextMatch(
            withTags,
            getSearchTerms("running caulking"),
        );

        expect(match).not.toBeNull();
        expect(match?.matchedFields).toContain("title");
        expect(match?.matchedFields).toContain("tags");
    });

    it("returns null when tag term is absent from all fields", () => {
        const withTags = {
            ...tutorial,
            tagNames: ["Hull", "Deck"],
        };

        const match = findTutorialTextMatch(
            withTags,
            getSearchTerms("caulking"),
        );

        expect(match).toBeNull();
    });

    it("handles missing tagNames gracefully", () => {
        const noTags = { ...tutorial, tagNames: null };

        const match = findTutorialTextMatch(
            noTags,
            getSearchTerms("running rigging"),
        );

        expect(match).not.toBeNull();
        expect(match?.matchedFields).not.toContain("tags");
    });
});
