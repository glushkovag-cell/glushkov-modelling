/**
 * Фактическое использование тегов таксономии статьями и фотографиями галереи.
 *
 * Результат определяет appliesTo в list_tutorial_taxonomy:
 * - "tutorials" — тег назначен хотя бы одной статье;
 * - "gallery"   — тег назначен хотя бы одной фотографии галереи.
 *
 * Снимок кэшируется на 60 минут (TAG_USAGE_CACHE_TTL_MS). Если источник
 * галереи недоступен, снимок кэшируется только на 1 минуту, чтобы
 * временная ошибка файловой системы не скрывала appliesTo=gallery на час.
 */
import type { TutorialListNode } from "./tutorials.js";
import { collectGalleryTagUsage } from "./gallery.js";

export const TAG_USAGE_CACHE_TTL_MS = 60 * 60_000;
const DEGRADED_CACHE_TTL_MS = 60_000;

export type AppliesTo = "tutorials" | "gallery";

export interface TagUsageSnapshot {
  /** slug → количество статей. */
  tutorials: Map<string, number>;
  /** slug → количество фотографий. */
  gallery: Map<string, number>;
  galleryAvailable: boolean;
  computedAt: number;
  expiresAt: number;
}

export function collectTutorialTagUsage(
    tutorials: TutorialListNode[],
): Map<string, number> {
  const usage = new Map<string, number>();

  for (const tutorial of tutorials) {
    const seen = new Set<string>();
    for (const tag of tutorial.tutorialTags?.nodes ?? []) {
      const slug = tag.slug.trim().toLowerCase();
      if (seen.has(slug)) continue;
      seen.add(slug);
      usage.set(slug, (usage.get(slug) ?? 0) + 1);
    }
  }

  return usage;
}

export function appliesToOf(slug: string, snapshot: TagUsageSnapshot): AppliesTo[] {
  const result: AppliesTo[] = [];
  if ((snapshot.tutorials.get(slug) ?? 0) > 0) result.push("tutorials");
  if ((snapshot.gallery.get(slug) ?? 0) > 0) result.push("gallery");
  return result;
}

let cache: TagUsageSnapshot | null = null;

export interface TagUsageSources {
  loadTutorials: () => Promise<TutorialListNode[]>;
  loadGalleryUsage?: () => Promise<Map<string, number>>;
  now?: () => number;
}

export async function getTagUsageSnapshot(
    sources: TagUsageSources,
): Promise<TagUsageSnapshot> {
  const now = (sources.now ?? Date.now)();

  if (cache && now < cache.expiresAt) {
    return cache;
  }

  const loadGallery = sources.loadGalleryUsage ?? collectGalleryTagUsage;

  const [tutorials, galleryResult] = await Promise.all([
    sources.loadTutorials(),
    loadGallery().then(
        (usage) => ({ usage, ok: true as const }),
        () => ({ usage: new Map<string, number>(), ok: false as const }),
    ),
  ]);

  cache = {
    tutorials: collectTutorialTagUsage(tutorials),
    gallery: galleryResult.usage,
    galleryAvailable: galleryResult.ok,
    computedAt: now,
    expiresAt:
        now + (galleryResult.ok ? TAG_USAGE_CACHE_TTL_MS : DEGRADED_CACHE_TTL_MS),
  };

  return cache;
}

/** Только для тестов. */
export function resetTagUsageCache(): void {
  cache = null;
}
