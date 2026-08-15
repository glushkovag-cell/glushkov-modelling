import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { config } from "../lib/config.js";

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
      title: "Фото из галереи",
      description:
        "Returns a list of photos from the website gallery (glushkov-modelling.com), with " +
        "filtering by building (project, for example 'le-requin') and/or category " +
        `photo (tag: ${KNOWN_SECTIONS.join(", ")}).`,
      inputSchema,
    },
    async ({ project, tag, limit }) => {
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

        const manifests = await Promise.all(slugsToRead.map((slug) => readManifest(slug)));

        interface PhotoResult {
          project: string;
          title: string;
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

        const photos: PhotoResult[] = [];

        outer: for (const manifest of manifests) {
          if (!manifest) continue;

          const sortedImages = [...manifest.images].sort((a, b) => a.order - b.order);

          for (const image of sortedImages) {
            if (tag && image.section !== tag) continue;

            photos.push({
              project: manifest.slug,
              title: manifest.title,
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

            if (photos.length >= limit) break outer;
          }
        }

        const result: Record<string, unknown> = {
          total: photos.length,
          project: project ?? null,
          tag: tag ?? null,
          photos,
        };

        if (tag && !KNOWN_SECTIONS.includes(tag)) {
          result.note = `Tag '${tag}' not found in known category list (${KNOWN_SECTIONS.join(", ")}) — possible typo`;
        }

        return jsonResult(result);
      } catch (error) {
        return errorResult(
          `Error retrieving gallery photo: ${(error as Error).message}`,
        );
      }
    },
  );
}
