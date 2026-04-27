/**
 * gallery.ts — helpers for loading gallery manifests from CMS at build time.
 */

export interface GalleryImagePaths {
  lowRes: string | null;
  hiRes: string | null;
}

export interface GalleryImage {
  file: string;
  order: number;
  section: string;
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

export interface GalleryManifest {
  slug: string;
  title: string;
  scale: string;
  galleryTitle: string;
  buildLogUrl: string;
  breadcrumbs: GalleryBreadcrumb[];
  meta: GalleryMeta;
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

function normalizeManifest(manifest: GalleryManifest): GalleryManifest {
  return {
    ...manifest,
    images: manifest.images.map((image) => ({
      ...image,
      paths: {
        lowRes: absolutizeAsset(image.paths?.lowRes ?? null),
        hiRes: absolutizeAsset(image.paths?.hiRes ?? null),
      },
    })),
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
  /*console.log('[gallery] index url:', url);*/

  const list = await fetchJson<string[]>(url);
  /*console.log('[gallery] index payload:', list);*/

  return Array.isArray(list) ? list : [];
}

async function readManifest(slug: string): Promise<GalleryManifest | null> {
  const url = buildCmsUrl(`${slug}/manifest.json`);
  /*console.log('[gallery] manifest url:', url);*/

  const manifest = await fetchJson<GalleryManifest>(url);
  /*console.log('[gallery] manifest loaded:', slug, !!manifest);*/

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