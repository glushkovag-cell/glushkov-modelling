/**
 * Централизованная загрузка и валидация конфигурации из переменных окружения.
 * Запускать процесс с --env-file=.env (Node.js >=20.6) либо через PM2 node-args.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Отсутствует обязательная переменная окружения: ${name}`);
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
  wpReadonlyUsername: optionalEnv("WP_READONLY_USERNAME", ""),
  wpReadonlyAppPassword: optionalEnv("WP_READONLY_APP_PASSWORD", ""),

  galleryManifestPath: optionalEnv("GALLERY_MANIFEST_PATH", ""),

  // Лимиты по умолчанию для read-only инструментов
  defaultResponseLimit: 50,
  requestTimeoutMs: 8000,
} as const;
