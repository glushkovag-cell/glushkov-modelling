/**
 * Единый генератор публичных (канонических) абсолютных URL сайта.
 *
 * Зачем: read-инструменты MCP до этого возвращали только внутренние
 * идентификаторы (slug), поэтому клиент/LLM был вынужден угадывать публичный
 * маршрут Astro и выдавал неверные ссылки. Публичный URL — контракт фронтенда,
 * а не побочный результат WordPress permalink settings, поэтому маршруты
 * зафиксированы здесь, в одном месте, и соответствуют src/pages:
 *
 *   src/pages/builds/[slug].astro     -> /builds/{slug}
 *                                        части build-лога рендерятся на этой же
 *                                        странице и адресуются якорем #part-{n}
 *   src/pages/tutorials/[slug].astro  -> /tutorials/{slug}
 *   src/pages/gallery/[slug].astro    -> /gallery/{slug}
 *
 * Базовый origin берётся из PUBLIC_SITE_URL (по умолчанию — production-домен),
 * чтобы ссылки оставались корректными в dev/preview-окружениях.
 *
 * Модуль намеренно не импортирует lib/config.ts: config требует обязательных
 * переменных окружения (MCP_API_KEY, WP_GRAPHQL_URL, CMS_GALLERY_URL) и
 * бросает исключение при их отсутствии, что сделало бы этот helper
 * непригодным для unit-тестов и для использования до валидации конфигурации.
 */

const DEFAULT_SITE_URL = "https://www.glushkov-modelling.com";

/** Origin публичного сайта без завершающего слэша, например https://www.glushkov-modelling.com */
export function siteOrigin(): string {
  const raw = process.env.PUBLIC_SITE_URL;
  const value = raw && raw.trim() !== "" ? raw.trim() : DEFAULT_SITE_URL;

  try {
    return new URL(value).origin;
  } catch {
    return new URL(DEFAULT_SITE_URL).origin;
  }
}

function absolute(pathname: string): string {
  return `${siteOrigin()}${pathname}`;
}

function segment(value: string): string {
  return encodeURIComponent(value.trim());
}

/** Страница постройки (модели): /builds/{buildSlug} */
export function buildUrl(buildSlug: string | null | undefined): string | null {
  if (!buildSlug || buildSlug.trim() === "") return null;
  return absolute(`/builds/${segment(buildSlug)}`);
}

/**
 * Часть журнала постройки. Части не имеют отдельных страниц: они выводятся на
 * странице постройки и адресуются якорем #part-{partNumber}. Если номер части
 * неизвестен, возвращается URL страницы постройки — это корректная, проверяемая
 * ссылка, в отличие от сконструированного пути с partSlug.
 */
export function buildLogPartUrl(
  buildSlug: string | null | undefined,
  partNumber: string | number | null | undefined,
): string | null {
  const base = buildUrl(buildSlug);
  if (!base) return null;

  const numeric = Number(partNumber);
  if (!Number.isFinite(numeric) || numeric <= 0) return base;

  return `${base}#part-${numeric}`;
}

/** Страница образовательной статьи: /tutorials/{slug} */
export function tutorialUrl(slug: string | null | undefined): string | null {
  if (!slug || slug.trim() === "") return null;
  return absolute(`/tutorials/${segment(slug)}`);
}

/** Страница галереи постройки: /gallery/{buildSlug} */
export function galleryUrl(buildSlug: string | null | undefined): string | null {
  if (!buildSlug || buildSlug.trim() === "") return null;
  return absolute(`/gallery/${segment(buildSlug)}`);
}
