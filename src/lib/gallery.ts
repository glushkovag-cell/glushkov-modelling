/**
 * gallery.ts — helpers for loading gallery manifests from CMS at build time.
 *
 * Supports two manifest formats:
 *   v1 — no `schemaVersion`; image.section is a single string ("overall", "hull", ...).
 *   v2 — `schemaVersion: 2`; image.section is an array of taxonomy slugs,
 *        optional `legacySection`, `review`, `suggested`.
 *
 * Both are normalized to one internal shape: `GalleryImage.sections: string[]`.
 */

export interface GalleryImagePaths {
  lowRes: string | null;
  hiRes: string | null;
}

/** Image as it appears in manifest.json (v1 or v2). */
export interface RawGalleryImage {
  file: string;
  order: number;
  section?: string | string[];
  legacySection?: string;
  review?: boolean;
  suggested?: string[];
  caption: string;
  alt: string;
  lead: boolean;
  orientation: 'landscape' | 'portrait' | 'square';
  width: number;
  height: number;
  paths: GalleryImagePaths;
}

/** Normalized image used by components. */
export interface GalleryImage {
  file: string;
  order: number;
  /** Always an array: v1 string is wrapped, missing/empty becomes []. */
  sections: string[];
  /** First section or null — convenient for single-label UI. */
  section: string | null;
  legacySection: string | null;
  review: boolean;
  suggested: string[];
  caption: string;
  alt: string;
  lead: boolean;
  orientation: 'landscape' | 'portrait' | 'square';
  width: number;
  height: number;
  paths: GalleryImagePaths;
}

export interface GalleryBreadcrumb {
  label: string;
  href: string;
}

export interface GalleryMeta {
  status: string;
  focus: string;
  viewerMode: string;
}

/** Manifest as it appears in manifest.json. */
export interface RawGalleryManifest {
  schemaVersion?: 1 | 2;
  slug: string;
  title: string;
  scale: string;
  galleryTitle: string;
  buildLogUrl: string;
  breadcrumbs: GalleryBreadcrumb[];
  meta: GalleryMeta;
  images: RawGalleryImage[];
}

/** Normalized manifest used by components. */
export interface GalleryManifest extends Omit<RawGalleryManifest, 'schemaVersion' | 'images'> {
  schemaVersion: 1 | 2;
  images: GalleryImage[];
}

export interface GalleryIndexEntry {
  slug: string;
  title: string;
  scale: string;
  cover: GalleryImage | null;
  imageCount: number;
}

const CMS_GALLERY_URL = (import.meta.env.CMS_GALLERY_URL || '').replace(/\/$/, '');

if (!CMS_GALLERY_URL) {
  throw new Error('CMS_GALLERY_URL is not set');
}

function buildCmsUrl(path: string) {
  return `${CMS_GALLERY_URL}/${path.replace(/^\//, '')}`;
}

function absolutizeAsset(path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;

  const cleaned = path
      .replace(/^\/+/, '')
      .replace(/^gallery\/+/, '');

  return buildCmsUrl(cleaned);
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  }
  if (typeof value === 'string' && value.length > 0) return [value];
  return [];
}

function detectVersion(manifest: RawGalleryManifest): 1 | 2 {
  if (manifest.schemaVersion === 2) return 2;
  if (manifest.schemaVersion === undefined || (manifest.schemaVersion as number) === 1) return 1;
  console.warn(
      `[gallery] unknown schemaVersion ${String(manifest.schemaVersion)} in "${manifest.slug}", treating as v2`,
  );
  return 2;
}

function normalizeImage(image: RawGalleryImage): GalleryImage {
  // Normalize by value shape, so both string (v1) and array (v2) work.
  const sections = [...new Set(toStringArray(image.section))];

  return {
    file: image.file,
    order: image.order,
    sections,
    section: sections[0] ?? null,
    legacySection: typeof image.legacySection === 'string' ? image.legacySection : null,
    review: image.review === true,
    suggested: toStringArray(image.suggested),
    caption: image.caption,
    alt: image.alt,
    lead: image.lead,
    orientation: image.orientation,
    width: image.width,
    height: image.height,
    paths: {
      lowRes: absolutizeAsset(image.paths?.lowRes ?? null),
      hiRes: absolutizeAsset(image.paths?.hiRes ?? null),
    },
  };
}

function normalizeManifest(manifest: RawGalleryManifest): GalleryManifest {
  const { schemaVersion: _ignored, images, ...rest } = manifest;

  return {
    ...rest,
    schemaVersion: detectVersion(manifest),
    images: (Array.isArray(images) ? images : []).map(normalizeImage),
  };
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function getAllGallerySlugs(): Promise<string[]> {
  const url = buildCmsUrl('index/models.json');
  const list = await fetchJson<string[]>(url);

  return Array.isArray(list) ? list : [];
}

async function readManifest(slug: string): Promise<GalleryManifest | null> {
  const url = buildCmsUrl(`${slug}/manifest.json`);
  const manifest = await fetchJson<RawGalleryManifest>(url);

  return manifest ? normalizeManifest(manifest) : null;
}

export async function getGalleryManifest(slug: string): Promise<GalleryManifest | null> {
  return readManifest(slug);
}

export async function getAllGalleryEntries(): Promise<GalleryIndexEntry[]> {
  const slugs = await getAllGallerySlugs();
  const manifests = await Promise.all(slugs.map((slug) => readManifest(slug)));

  return manifests
      .filter((manifest): manifest is GalleryManifest => manifest !== null)
      .map((manifest) => {
        const sorted = [...manifest.images].sort((a, b) => a.order - b.order);
        const cover = sorted.find((img) => img.lead) ?? sorted[0] ?? null;

        return {
          slug: manifest.slug,
          title: manifest.title,
          scale: manifest.scale,
          cover,
          imageCount: manifest.images.length,
        } satisfies GalleryIndexEntry;
      });
}
