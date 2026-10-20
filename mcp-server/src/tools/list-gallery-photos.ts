import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { config } from "../lib/config.js";
import { buildUrl, galleryUrl as galleryPageUrl } from "../lib/public-urls.js";
import { paginate } from "../lib/pagination.js";
import {
  effectivePhotoTags,
  getGallerySlugs,
  photoMatchesFilter,
  readGalleryPhotos,
  type GalleryPhotoRecord,
  type TagMatchMode,
} from "../lib/gallery.js";
import {
  fetchTaxonomyDictionary,
  resolveTagValue,
  TAXONOMY_FACETS,
  type TaxonomyDictionary,
  type TaxonomyFacet,
} from "../lib/taxonomy.js";

interface PhotoTagDetail {
  slug: string;
  name: string;
  facet: TaxonomyFacet | null;
}

interface PhotoResult {
  project: string;
  title: string;
  projectUrl: string | null;
  galleryUrl: string | null;
  scale: string;
  /** Массив slug тегов фотографии (v1-строка приводится к массиву из одного элемента). */
  section: string[];
  tagDetails: PhotoTagDetail[];
  legacySection: string | null;
  caption: string;
  alt: string;
  orientation: string;
  width: number;
  height: number;
  lowResUrl: string | null;
  hiResUrl: string | null;
}

const MAX_TAG_VALUES = 20;

export const listGalleryPhotosInputSchema = {
  project: z
      .string()
      .optional()
      .describe(
          "Optional model project slug to filter photos, for example 'le-requin'. When omitted, returns photos from all gallery projects.",
      ),

  tag: z
      .union([
        z.string().min(1),
        z.array(z.string().min(1)).min(1).max(MAX_TAG_VALUES),
      ])
      .optional()
      .describe(
          "Optional filter by photo taxonomy tags. Accepts a single tag string (legacy format, still supported) or an array of tags. " +
          "A string is equivalent to a one-element array: tag='hull' and tag=['hull'] return the same photos. " +
          "Values are taxonomy slugs such as 'hull', 'standing-rigging', 'side-view', 'close-up'; display names from the taxonomy (e.g. 'Standing Rigging') are also accepted, case-insensitive. " +
          "Matching is exact by slug (no partial matching). How several values combine is controlled by match. " +
          "Get the allowed values from list_tutorial_taxonomy (tags with 'gallery' in appliesTo, or appliesTo='gallery').",
      ),

  tagFacet: z
      .enum(TAXONOMY_FACETS)
      .optional()
      .describe(
          "Optional filter by tag facet: keeps photos that have at least one active tag of this facet. " +
          "component — model parts (Hull, Deck, Masts…); technique — build methods (Planking, Caulking…); material — materials (Wood, Brass…); " +
          "context — themes (Standing Rigging, Running Rigging…); view — camera viewpoint (Overall View, Side View, Close-up…). " +
          "When combined with tag, both conditions must hold (AND).",
      ),

  match: z
      .enum(["any", "all"])
      .default("any")
      .describe(
          "How multiple tag values combine. 'any' (default) — a photo matches if it has at least one of the tags (OR). " +
          "'all' — a photo matches only if it has every listed tag (AND). Has no effect when tag has a single value.",
      ),

  limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe(
          "Maximum number of photos to return. Default: 50. Maximum: 100.",
      ),

  offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
          "Number of matching photos to skip before returning the current page. Use nextOffset from a previous response to retrieve the next page.",
      ),
};

function buildCmsUrl(relativePath: string): string {
  const cleaned = relativePath.replace(/^\/+/, "").replace(/^gallery\/+/, "");
  return `${config.cmsGalleryUrl}/${cleaned}`;
}

function absolutizeAsset(assetPath: string | null | undefined): string | null {
  if (!assetPath) {
    return null;
  }

  if (/^https?:\/\//i.test(assetPath)) {
    return assetPath;
  }

  return buildCmsUrl(assetPath);
}

/** Строка и массив приводятся к одному виду: массив уникальных slug. */
export function normalizeTagInput(
    tag: string | string[] | undefined,
    dictionary: TaxonomyDictionary | null,
): { slugs: string[]; unknown: string[] } {
  const values = tag === undefined ? [] : Array.isArray(tag) ? tag : [tag];
  const slugs: string[] = [];
  const unknown: string[] = [];

  for (const value of values) {
    if (!value.trim()) continue;
    const resolved = resolveTagValue(value, dictionary);
    if (!slugs.includes(resolved.slug)) slugs.push(resolved.slug);
    if (
        dictionary &&
        resolved.term?.status !== "active" &&
        !unknown.includes(resolved.slug)
    ) {
      unknown.push(resolved.slug);
    }
  }

  return { slugs, unknown };
}

function toPhotoResult(
    photo: GalleryPhotoRecord,
    tags: string[],
    dictionary: TaxonomyDictionary | null,
): PhotoResult {
  return {
    project: photo.project,
    title: photo.title,
    projectUrl: buildUrl(photo.project),
    galleryUrl: galleryPageUrl(photo.project),
    scale: photo.scale,
    section: tags,
    tagDetails: tags.map((slug) => {
      const term = dictionary?.bySlug.get(slug);
      return { slug, name: term?.name ?? slug, facet: term?.facet ?? null };
    }),
    legacySection: photo.legacySection,
    caption: photo.caption,
    alt: photo.alt,
    orientation: photo.orientation,
    width: photo.width,
    height: photo.height,
    lowResUrl: absolutizeAsset(photo.paths.lowRes),
    hiResUrl: absolutizeAsset(photo.paths.hiRes),
  };
}

export interface FilterGalleryPhotosArgs {
  tag?: string | string[];
  tagFacet?: TaxonomyFacet;
  match: TagMatchMode;
}

/** Чистая функция фильтрации — используется инструментом и unit-тестами. */
export function filterGalleryPhotos(
    photos: GalleryPhotoRecord[],
    args: FilterGalleryPhotosArgs,
    dictionary: TaxonomyDictionary | null,
): { photos: PhotoResult[]; tagSlugs: string[]; unknownTags: string[] } {
  const { slugs, unknown } = normalizeTagInput(args.tag, dictionary);
  const results: PhotoResult[] = [];

  for (const photo of photos) {
    const tags = effectivePhotoTags(photo.tags, dictionary);

    if (
        !photoMatchesFilter(
            tags,
            { tags: slugs, match: args.match, tagFacet: args.tagFacet },
            dictionary,
        )
    ) {
      continue;
    }

    results.push(toPhotoResult(photo, tags, dictionary));
  }

  return { photos: results, tagSlugs: slugs, unknownTags: unknown };
}

export function registerListGalleryPhotos(server: McpServer): void {
  server.registerTool(
      "list_gallery_photos",
      {
        title: "List gallery photos",
        description:
            "Read-only. Returns a paginated list of gallery photo summaries with captions, image URLs, model project references, taxonomy tags, and image metadata. " +
            "Use this tool to browse gallery photos or filter them by model project, taxonomy tags, and tag facet. " +
            "Use get_build_details when the user needs vessel background, technical notes, or build-log content for the related model. " +
            "Photos share one taxonomy with tutorials; call list_tutorial_taxonomy (appliesTo='gallery') to get the allowed tag slugs, names, and facets. " +
            "Each photo's section field is an ARRAY of tag slugs (legacy single-string sections are normalized to a one-element array); tagDetails gives name and facet for each tag; legacySection keeps the pre-taxonomy section label when present. " +
            "Filters: tag accepts a string (legacy) or an array of slugs; match='any' (default) returns photos with at least one listed tag, match='all' returns photos with every listed tag; " +
            "tagFacet (component | technique | material | context | view) keeps photos with at least one tag of that facet; tag and tagFacet combine with AND. " +
            "Results are ordered by project and then by each project's gallery order. " +
            "The response includes total matching photos, returned count, limit, offset, nextOffset, and hasMore. " +
            "Use nextOffset from a response with hasMore=true to retrieve the next page. " +
            "If no photos match a valid filter, returns an empty photos array; unknown tag values are listed in unknownTags. " +
            "If project does not identify a gallery project, returns a not-found result.",
        inputSchema: listGalleryPhotosInputSchema,
      },
      async ({ project, tag, tagFacet, match, limit, offset }) => {
        try {
          if (!config.galleryManifestPath) {
            return errorResult(
                "GALLERY_MANIFEST_PATH is not configured for this server.",
            );
          }

          const allSlugs = await getGallerySlugs();

          if (allSlugs.length === 0) {
            return errorResult(
                "No gallery projects are available because index/models.json is empty or inaccessible.",
            );
          }

          if (project && !allSlugs.includes(project)) {
            return errorResult(
                `Gallery project with slug='${project}' not found. Available project slugs: ${allSlugs.join(", ")}.`,
            );
          }

          const [photos, dictionary] = await Promise.all([
            readGalleryPhotos(project ? [project] : allSlugs),
            fetchTaxonomyDictionary().catch(() => null),
          ]);

          if (tagFacet && !dictionary) {
            return errorResult(
                "The tagFacet filter is temporarily unavailable because the taxonomy dictionary (WPGraphQL TutorialTags) could not be loaded. Retry later or filter by tag only.",
            );
          }

          const filtered = filterGalleryPhotos(
              photos,
              { tag, tagFacet, match },
              dictionary,
          );

          const page = paginate(filtered.photos, limit, offset);

          const result: Record<string, unknown> = {
            total: page.total,
            returned: page.returned,
            hasMore: page.hasMore,
            limit: page.limit,
            offset: page.offset,
            nextOffset: page.nextOffset,
            project: project ?? null,
            tag: filtered.tagSlugs.length > 0 ? filtered.tagSlugs : null,
            tagFacet: tagFacet ?? null,
            match,
            photos: page.items,
          };

          const notes: string[] = [];

          if (filtered.unknownTags.length > 0) {
            result.unknownTags = filtered.unknownTags;
            notes.push(
                `Tag value(s) ${filtered.unknownTags.map((t) => `'${t}'`).join(", ")} are not active terms of the taxonomy dictionary and match no photos. ` +
                "Call list_tutorial_taxonomy with appliesTo='gallery' for valid slugs (former section labels map, for example, overall → overall-view, details → close-up, rigging → standing-rigging / running-rigging).",
            );
          }

          if (!dictionary) {
            notes.push(
                "The taxonomy dictionary could not be loaded; tags are returned as stored in the manifests without name/facet metadata.",
            );
          }

          if (notes.length > 0) {
            result.note = notes.join(" ");
          }

          return jsonResult(result);
        } catch (error) {
          return errorResult(
              `Error retrieving gallery photos: ${(error as Error).message}`,
          );
        }
      },
  );
}
