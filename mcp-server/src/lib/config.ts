/**
 * Централизованная загрузка и валидация конфигурации из переменных окружения.
 * Запускать процесс с --env-file=.env (Node.js >=20.6) либо через PM2 node-args.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Required environment variable is missing: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

export const config = {
  host: optionalEnv("HOST", "127.0.0.1"),
  port: Number(optionalEnv("PORT", "4322")),

  mcpApiKey: requireEnv("MCP_API_KEY"),

  allowedOrigins: optionalEnv("MCP_ALLOWED_ORIGINS", "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),

  wpGraphqlUrl: requireEnv("WP_GRAPHQL_URL"),
  // Заголовок X-GraphQL-Secret — та же защита, что использует Astro-сайт (src/lib/wordpress.ts).
  // Без него эндпоинт возвращает 404 (Cloudflare/WAF).
  wpGraphqlSecret: optionalEnv("WP_GRAPHQL_SECRET", ""),
  wpReadonlyUsername: optionalEnv("WP_READONLY_USERNAME", ""),
  wpReadonlyAppPassword: optionalEnv("WP_READONLY_APP_PASSWORD", ""),

  // Корневой каталог галереи на файловой системе VPS (см. Этап 0/1: подтверждён доступ пользователя deploy).
  galleryManifestPath: optionalEnv("GALLERY_MANIFEST_PATH", "/var/www/cms/gallery"),

  // Публичный базовый URL, по которому /var/www/cms/gallery раздаётся веб-сервером
  // (та же переменная, что использует Astro-сайт в src/lib/gallery.ts) — нужен,
  // чтобы строить рабочие ссылки на изображения, а не голые относительные пути.
  cmsGalleryUrl: requireEnv("CMS_GALLERY_URL").replace(/\/$/, ""),

  // Лимиты по умолчанию для read-only инструментов
  defaultResponseLimit: 50,
  requestTimeoutMs: 8000,
} as const;
