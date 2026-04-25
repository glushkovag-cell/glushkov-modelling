/**
 * gallery.ts — helpers for loading static gallery manifests at build time.
 *
 * Manifests are stored in public/gallery/<slug>/manifest.json and generated
 * (or updated) by the Python script at scripts/update_manifest.py.
 *
 * During Astro SSG the helpers read the JSON files directly from the filesystem
 * so no network round-trip is needed at build time.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Internals ────────────────────────────────────────────────────────────────

const GALLERY_ROOT = join(process.cwd(), 'public', 'gallery');

function readManifest(slug: string): GalleryManifest | null {
  const manifestPath = join(GALLERY_ROOT, slug, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8')) as GalleryManifest;
  } catch {
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns all gallery slugs.
 * Prefers _index/models.json; falls back to directory scan.
 */
export function getAllGallerySlugs(): string[] {
  const indexPath = join(GALLERY_ROOT, '_index', 'models.json');
  if (existsSync(indexPath)) {
    try {
      const list = JSON.parse(readFileSync(indexPath, 'utf-8')) as string[];
      if (Array.isArray(list)) return list;
    } catch {
      // fall through to scan
    }
  }

  // Fallback: scan directory
  if (!existsSync(GALLERY_ROOT)) return [];
  return readdirSync(GALLERY_ROOT, { withFileTypes: true })
    .filter((dirent) => {
      if (!dirent.isDirectory()) return false;
      if (dirent.name.startsWith('_')) return false;
      return existsSync(join(GALLERY_ROOT, dirent.name, 'manifest.json'));
    })
    .map((dirent) => dirent.name);
}

/**
 * Loads a single model's gallery manifest.
 */
export function getGalleryManifest(slug: string): GalleryManifest | null {
  return readManifest(slug);
}

/**
 * Returns lightweight summaries of all gallery entries for the hub page.
 */
export function getAllGalleryEntries(): GalleryIndexEntry[] {
  const slugs = getAllGallerySlugs();
  return slugs
    .map((slug) => {
      const manifest = readManifest(slug);
      if (!manifest) return null;
      const sorted = [...manifest.images].sort((a, b) => a.order - b.order);
      const cover = sorted.find((img) => img.lead) ?? sorted[0] ?? null;
      return {
        slug: manifest.slug,
        title: manifest.title,
        scale: manifest.scale,
        cover,
        imageCount: manifest.images.length,
      } satisfies GalleryIndexEntry;
    })
    .filter((e): e is GalleryIndexEntry => e !== null);
}
