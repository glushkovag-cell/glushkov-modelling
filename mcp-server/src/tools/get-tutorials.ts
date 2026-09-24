// mcp-server/src/tools/get-tutorials.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { buildUrl, tutorialUrl } from "../lib/public-urls.js";
import { stripHtmlAndTruncate } from "../lib/wp-models.js";
import {
    fetchAllTutorials,
    fetchTutorialBySlug,
    levelOf,
    activeTagsOf,
    facetOf,
} from "../lib/tutorials.js";

/** Нормализует тег из GraphQL-ноды в объект {name, slug, facet}. */
function mapTag(node: {
    name: string;
    slug: string;
    tagSettings?: { facet?: string[] | null } | null;
}) {
    return {
        name: node.name,
        slug: node.slug,
        facet: facetOf(node.tagSettings?.facet),
    };
}

// ─── input schema ─────────────────────────────────────────────────────────────

const inputSchema = {
    slug: z
        .string()
        .optional()
        .describe(
            "Optional stable tutorial slug. When provided, returns the complete content and metadata for one tutorial. When omitted, returns a filtered list of tutorial summaries.",
        ),

    tag: z
        .string()
        .optional()
        .describe(
            "Optional filter for tutorial tags. " +
            "Preferred format: slug (lowercase, hyphen-separated), e.g. 'standing-rigging', 'wood-bending', 'double-planking'. " +
            "Display names are also accepted (e.g. 'Standing Rigging'). " +
            "Matching is case-insensitive and partial — 'rigging' matches both 'standing-rigging' and 'running-rigging'. " +
            "Applies only when slug is omitted.",
        ),

    tagFacet: z
        .enum(["component", "technique", "material", "context"])
        .optional()
        .describe(
            "Optional filter for tutorial tags by facet type. " +
            "component — structural parts of the model (Hull, Deck, Masts…); " +
            "technique — build methods (Caulking, Wood Bending, Blackening…); " +
            "material — materials used (Wood, Brass, Thread…); " +
            "context — themes or use-case labels (Standing Rigging, Running Rigging…). " +
            "Can be combined with the tag filter. Applies only when slug is omitted.",
        ),

    category: z
        .string()
        .optional()
        .describe(
            "Optional filter for tutorial categories. Uses a case-insensitive partial match against category names. Applies only when slug is omitted.",
        ),

    level: z
        .string()
        .optional()
        .describe(
            "Optional filter for tutorial difficulty level. Uses an exact match, for example 'beginner'. Applies only when slug is omitted.",
        ),
};

// ─── tool registration ────────────────────────────────────────────────────────

export function registerGetTutorials(server: McpServer): void {
    server.registerTool(
        "get_tutorials",
        {
            title: "Get tutorials",
            description:
                "Read-only. Returns educational tutorials from the site, optionally filtered by tag, category, tagFacet, or difficulty level. " +
                "Use this tool to browse tutorials and filter them by taxonomy. When a slug is provided, it returns the content and metadata for one tutorial. " +
                "Use get_tutorial_by_title when the user knows an article title but not its slug. " +
                "Use search_tutorial_content when the user knows only a term, technique, material, tool, or instruction that may occur inside a tutorial. " +
                "Use list_tutorial_taxonomy when the exact available category, tag, or difficulty-level value is unknown. " +
                "Without a slug, returns tutorial summaries and metadata. Each tag object includes name, slug, and facet (component | technique | material | context | null). " +
                "If no tutorials match the filters, returns an empty tutorials array. " +
                "If a provided slug does not exist, returns a not-found result.",
            inputSchema,
        },
        async ({ slug, tag, tagFacet, category, level }) => {
            try {
                // ── single tutorial by slug ──────────────────────────────────────────
                if (slug) {
                    const tutorial = await fetchTutorialBySlug(slug);

                    if (!tutorial) {
                        return errorResult(`Tutorial with slug='${slug}' not found.`);
                    }

                    const relatedBuilds = (
                        tutorial.tutorialFields?.tutorialRelatedBuilds?.nodes || []
                    )
                        .filter((node) => node.__typename === "Model")
                        .map((node) => ({
                            title: node.title,
                            slug: node.slug,
                            url: buildUrl(node.slug),
                            shortDescription: node.modelinfo?.shortdescription ?? null,
                            scale: node.modelinfo?.modelscale ?? null,
                        }));

                    const relatedTutorials = (
                        tutorial.tutorialFields?.tutorialRelatedTutorials?.nodes || []
                    )
                        .filter((node) => node.__typename === "Tutorial")
                        .map((node) => ({
                            title: node.title,
                            slug: node.slug,
                            url: tutorialUrl(node.slug),
                            teaser: node.tutorialFields?.tutorialTeaser ?? null,
                            level: levelOf(node.tutorialFields?.tutorialLevel),
                        }));

                    const tags = activeTagsOf(tutorial.tutorialTags?.nodes).map(mapTag);

                    return jsonResult({
                        title: tutorial.title,
                        slug: tutorial.slug,
                        url: tutorialUrl(tutorial.slug),
                        teaser: tutorial.tutorialFields?.tutorialTeaser ?? null,
                        level: levelOf(tutorial.tutorialFields?.tutorialLevel),
                        views: tutorial.tutorialFields?.views ?? 0,
                        content: stripHtmlAndTruncate(tutorial.content, 4000),
                        categories: (tutorial.tutorialCategories?.nodes || []).map(
                            (c) => c.name,
                        ),
                        tags,
                        relatedBuilds,
                        relatedTutorials,
                    });
                }

                // ── list with filters ────────────────────────────────────────────────
                let tutorials = await fetchAllTutorials();

                if (tag) {
                    const needle = tag.trim().toLowerCase();
                    tutorials = tutorials.filter((t) =>
                        activeTagsOf(t.tutorialTags?.nodes).some(
                            (tagNode) =>
                                tagNode.name.toLowerCase().includes(needle) ||
                                tagNode.slug.toLowerCase().includes(needle),
                        ),
                    );
                }

                if (tagFacet) {
                    tutorials = tutorials.filter((t) =>
                        activeTagsOf(t.tutorialTags?.nodes).some(
                            (tagNode) => facetOf(tagNode.tagSettings?.facet) === tagFacet,
                        ),
                    );
                }

                if (category) {
                    const needle = category.trim().toLowerCase();
                    tutorials = tutorials.filter((t) =>
                        (t.tutorialCategories?.nodes || []).some((c) =>
                            c.name.toLowerCase().includes(needle),
                        ),
                    );
                }

                if (level) {
                    tutorials = tutorials.filter(
                        (t) => levelOf(t.tutorialFields?.tutorialLevel) === level,
                    );
                }

                const results = tutorials.map((t) => ({
                    title: t.title,
                    slug: t.slug,
                    url: tutorialUrl(t.slug),
                    teaser: t.tutorialFields?.tutorialTeaser ?? null,
                    level: levelOf(t.tutorialFields?.tutorialLevel),
                    views: t.tutorialFields?.views ?? 0,
                    categories: (t.tutorialCategories?.nodes || []).map((c) => c.name),
                    tags: activeTagsOf(t.tutorialTags?.nodes).map(mapTag),
                }));

                return jsonResult({
                    total: results.length,
                    tutorials: results,
                });
            } catch (error) {
                return errorResult(
                    `Error retrieving tutorials: ${(error as Error).message}`,
                );
            }
        },
    );
}
