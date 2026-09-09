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
          "Optional model project slug to filter photos, for example 'le-requin'. When omitted, returns photos from all gallery projects.",
      ),

  tag: z
      .string()
      .optional()
      .describe(
          `Optional gallery section filter. Matches the manifest section field exactly. Known values: ${KNOWN_SECTIONS.join(", ")}.`,
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

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

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
        title: "List gallery photos",
        description:
            "Read-only. Returns a paginated list of gallery photo summaries with captions, image URLs, model project references, section tags, and image metadata. " +
            "Use this tool to browse gallery photos or filter them by model project and gallery section. " +
            "Use get_build_details when the user needs vessel background, technical notes, or build-log content for the related model. " +
            `Known section tags are: ${KNOWN_SECTIONS.join(", ")}. ` +
            "Results are ordered by each project's gallery order. " +
            "The response includes total matching photos, returned count, limit, offset, nextOffset, and hasMore. " +
            "Use nextOffset from a response with hasMore=true to retrieve the next page. " +
            "If no photos match a valid filter, returns an empty photos array. " +
            "If project does not identify a gallery project, returns a not-found result.",
        inputSchema,
      },
      async ({ project, tag, limit, offset }) => {
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

          let slugsToRead: string[];

          if (project) {
            if (!allSlugs.includes(project)) {
              return errorResult(
                  `Gallery project with slug='${project}' not found. Available project slugs: ${allSlugs.join(", ")}.`,
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
            if (!manifest) {
              continue;
            }

            const sortedImages = [...manifest.images].sort(
                (left, right) => left.order - right.order,
            );

            for (const image of sortedImages) {
              if (tag && image.section !== tag) {
                continue;
              }

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
                `Tag '${tag}' is not in the known gallery section list ` +
                `(${KNOWN_SECTIONS.join(", ")}). The filter is applied exactly and may return no photos.`;
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
