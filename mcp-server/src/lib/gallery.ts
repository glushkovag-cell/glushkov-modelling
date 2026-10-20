/**
 * Чтение и нормализация манифестов галереи с файловой системы VPS.
 *
 * Поддерживаемые форматы manifest.json:
 *
 * v1 — schemaVersion отсутствует или равен 1; image.section — строка.
 * v2 — schemaVersion равен 2; image.section и/или image.sections — массив
 *      slug таксономии; дополнительные поля legacySection, review, suggested.
 *
 * Оба формата приводятся к массиву slug (GalleryPhotoRecord.tags) — так же,
 * как это делает сайт в src/lib/gallery.ts.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import type { TaxonomyDictionary, TaxonomyFacet } from "./taxonomy.js";

export interface GalleryImagePaths {
  lowRes: string | null;
  hiRes: string | null;
}

export interface RawGalleryImage {
  file: string;
  order: number;
  section?: string | string[] | null;
  sections?: string[] | string | null;
  legacySection?: string | null;
  caption?: string;
  alt?: string;
  lead?: boolean;
  orientation?: string;
  width?: number;
  height?: number;
  paths?: Partial<GalleryImagePaths> | null;
}

export interface RawGalleryManifest {
  schemaVersion?: number;
  slug: string;
  title: string;
  scale: string;
  images: RawGalleryImage[];
}

/** Нормализованная фотография галереи (до фильтрации по справочнику). */
export interface GalleryPhotoRecord {
  project: string;
  title: string;
  scale: string;
  file: string;
  order: number;
  /** Все slug из section/sections: lowercase, без пустых значений и дублей. */
  tags: string[];
  legacySection: string | null;
  caption: string;
  alt: string;
  lead: boolean;
  orientation: string;
  width: number;
  height: number;
  paths: GalleryImagePaths;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return [value];
  }

  return [];
}

/** Объединяет sections (v2) и section (строка v1 или массив v2) в массив slug. */
export function normalizeImageTags(image: RawGalleryImage): string[] {
  return [
    ...new Set(
        [...toStringArray(image.sections), ...toStringArray(image.section)].map(
            (slug) => slug.trim().toLowerCase(),
        ),
    ),
  ];
}

export function normalizeManifestPhotos(
    manifest: RawGalleryManifest,
): GalleryPhotoRecord[] {
  const images = Array.isArray(manifest.images) ? manifest.images : [];

  return [...images]
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
      .map((image) => ({
        project: manifest.slug,
        title: manifest.title,
        scale: manifest.scale,
        file: image.file,
        order: image.order,
        tags: normalizeImageTags(image),
        legacySection:
            typeof image.legacySection === "string" && image.legacySection.trim()
                ? image.legacySection.trim().toLowerCase()
                : null,
        caption: image.caption ?? "",
        alt: image.alt ?? "",
        lead: image.lead === true,
        orientation: image.orientation ?? "",
        width: image.width ?? 0,
        height: image.height ?? 0,
        paths: {
          lowRes: image.paths?.lowRes ?? null,
          hiRes: image.paths?.hiRes ?? null,
        },
      }));
}

// ─── файловая система ─────────────────────────────────────────────────────────

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

export async function getGallerySlugs(): Promise<string[]> {
  const filePath = path.join(config.galleryManifestPath, "index", "models.json");
  const list = await readJsonFile<unknown>(filePath);

  return Array.isArray(list)
      ? list.filter((item): item is string => typeof item === "string")
      : [];
}

export async function readManifest(slug: string): Promise<RawGalleryManifest | null> {
  const filePath = path.join(config.galleryManifestPath, slug, "manifest.json");

  try {
    return await readJsonFile<RawGalleryManifest>(filePath);
  } catch {
    return null;
  }
}

export async function readGalleryPhotos(slugs: string[]): Promise<GalleryPhotoRecord[]> {
  const manifests = await Promise.all(slugs.map((slug) => readManifest(slug)));

  return manifests.flatMap((manifest) =>
      manifest ? normalizeManifestPhotos(manifest) : [],
  );
}

// ─── фильтрация ───────────────────────────────────────────────────────────────

export type TagMatchMode = "any" | "all";

/**
 * Оставляет только известные справочнику активные термины.
 * Без справочника (null) теги возвращаются как есть.
 */
export function effectivePhotoTags(
    tags: string[],
    dictionary: TaxonomyDictionary | null,
): string[] {
  if (!dictionary) return tags;
  return tags.filter((slug) => dictionary.bySlug.get(slug)?.status === "active");
}

export interface PhotoTagFilter {
  /** Нормализованные slug; пустой массив — фильтр по тегам не задан. */
  tags: string[];
  match: TagMatchMode;
  tagFacet?: TaxonomyFacet;
}

/**
 * Семантика:
 * - match=any — у фотографии есть хотя бы один из tags (OR);
 * - match=all — у фотографии есть все tags (AND);
 * - tagFacet — у фотографии есть хотя бы один активный тег этого facet;
 * - tags и tagFacet комбинируются через AND (как в get_tutorials).
 */
export function photoMatchesFilter(
    photoTags: string[],
    filter: PhotoTagFilter,
    dictionary: TaxonomyDictionary | null,
): boolean {
  if (filter.tags.length > 0) {
    const has = (slug: string) => photoTags.includes(slug);
    const ok =
        filter.match === "all" ? filter.tags.every(has) : filter.tags.some(has);
    if (!ok) return false;
  }

  if (filter.tagFacet) {
    if (!dictionary) return false;
    const ok = photoTags.some(
        (slug) => dictionary.bySlug.get(slug)?.facet === filter.tagFacet,
    );
    if (!ok) return false;
  }

  return true;
}

// ─── использование тегов галереей (для appliesTo) ─────────────────────────────

/** slug → количество фотографий, к которым тег назначен. */
export async function collectGalleryTagUsage(): Promise<Map<string, number>> {
  const usage = new Map<string, number>();

  if (!config.galleryManifestPath) return usage;

  const slugs = await getGallerySlugs();
  const photos = await readGalleryPhotos(slugs);

  for (const photo of photos) {
    for (const tag of photo.tags) {
      usage.set(tag, (usage.get(tag) ?? 0) + 1);
    }
  }

  return usage;
}
