import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { config } from "../lib/config.js";
import { buildUrl, galleryUrl as galleryPageUrl } from "../lib/public-urls.js";
import { paginate } from "../lib/pagination.js";

interface GalleryImagePaths {
  lowRes: string | null;
  hiRes: string | null;
}

interface GalleryImage {
  file: string;
  order: number;
  section: string;
  caption: string;
  alt: string;
  lead: boolean;
  orientation: string;
  width: number;
  height: number;
  paths: GalleryImagePaths;
}

interface GalleryManifest {
  slug: string;
  title: string;
  scale: string;
  images: GalleryImage[];
}

interface PhotoResult {
  project: string;
  title: string;
  projectUrl: string | null;
  galleryUrl: string | null;
  scale: string;
  section: string;
  caption: string;
  alt: string;
  orientation: string;
  width: number;
  height: number;
  lowResUrl: string | null;
  hiResUrl: string | null;
}

const KNOWN_SECTIONS = ["overall", "hull", "deck", "rigging", "details"];

const inputSchema = {
  project: z
      .string()
      .optional()
      .describe(
          "The building slug used for filtering, e.g., 'le-requin'. If not specified, photos for all buildings are shown.",
      ),
  tag: z
      .string()
      .optional()
      .describe(
          `Category for photos taken inside the structure (the "section" field in the gallery manifest). Known values: ${KNOWN_SECTIONS.join(", ")}.`,
      ),
  limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe("Maximum number of photos in the response."),
  offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
          "Number of matching photos to skip before returning the current page.",
      ),
};

/** Собирает публичный URL из относительного пути манифеста, используя CMS_GALLERY_URL. */
function buildCmsUrl(relativePath: string): string {
  const cleaned = relativePath.replace(/^\/+/, "").replace(/^gallery\/+/, "");
  return `${config.cmsGalleryUrl}/${cleaned}`;
}

function absolutizeAsset(assetPath: string | null | undefined): string | null {
  if (!assetPath) return null;
  if (/^https?:\/\//i.test(assetPath)) return assetPath;
  return buildCmsUrl(assetPath);
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

/** Список slug-ов построек, у которых есть галерея (index/models.json). */
async function getGallerySlugs(): Promise<string[]> {
  const filePath = path.join(config.galleryManifestPath, "index", "models.json");
  const list = await readJsonFile<unknown>(filePath);

  return Array.isArray(list) ? (list as string[]) : [];
}

async function readManifest(slug: string): Promise<GalleryManifest | null> {
  const filePath = path.join(config.galleryManifestPath, slug, "manifest.json");

  try {
    return await readJsonFile<GalleryManifest>(filePath);
  } catch {
    return null;
  }
}

export function registerListGalleryPhotos(server: McpServer): void {
  server.registerTool(
      "list_gallery_photos",
      {
        title: "Photos from gallery",
        description:
            "Returns a paginated list of photos from the website gallery " +
            "(glushkov-modelling.com), with filtering by building (project, for " +
            "example 'le-requin') and/or photo category " +
            `(tag: ${KNOWN_SECTIONS.join(", ")}). The response includes total matching ` +
            "photos, returned count, pagination offset, nextOffset, and hasMore.",
        inputSchema,
      },
      async ({ project, tag, limit, offset }) => {
        try {
          if (!config.galleryManifestPath) {
            return errorResult(
                "GALLERY_MANIFEST_PATH not specified in server configuration.",
            );
          }

          const allSlugs = await getGallerySlugs();

          if (allSlugs.length === 0) {
            return errorResult(
                "Failed to retrieve the list of buildings with a gallery (index/models.json is empty or inaccessible).",
            );
          }

          let slugsToRead: string[];

          if (project) {
            if (!allSlugs.includes(project)) {
              return errorResult(
                  `Build with slug='${project}' not found in gallery. Available slugs: ${allSlugs.join(", ")}.`,
              );
            }

            slugsToRead = [project];
          } else {
            slugsToRead = allSlugs;
          }

          const manifests = await Promise.all(
              slugsToRead.map((slug) => readManifest(slug)),
          );

          const matchingPhotos: PhotoResult[] = [];

          for (const manifest of manifests) {
            if (!manifest) continue;

            const sortedImages = [...manifest.images].sort(
                (a, b) => a.order - b.order,
            );

            for (const image of sortedImages) {
              if (tag && image.section !== tag) continue;

              matchingPhotos.push({
                project: manifest.slug,
                title: manifest.title,
                projectUrl: buildUrl(manifest.slug),
                galleryUrl: galleryPageUrl(manifest.slug),
                scale: manifest.scale,
                section: image.section,
                caption: image.caption,
                alt: image.alt,
                orientation: image.orientation,
                width: image.width,
                height: image.height,
                lowResUrl: absolutizeAsset(image.paths?.lowRes),
                hiResUrl: absolutizeAsset(image.paths?.hiRes),
              });
            }
          }

          const page = paginate(matchingPhotos, limit, offset);

          const result: Record<string, unknown> = {
            total: page.total,
            returned: page.returned,
            hasMore: page.hasMore,
            limit: page.limit,
            offset: page.offset,
            nextOffset: page.nextOffset,
            project: project ?? null,
            tag: tag ?? null,
            photos: page.items,
          };

          if (tag && !KNOWN_SECTIONS.includes(tag)) {
            result.note =
                `Tag '${tag}' not found in known category list ` +
                `(${KNOWN_SECTIONS.join(", ")}) — possible typo`;
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