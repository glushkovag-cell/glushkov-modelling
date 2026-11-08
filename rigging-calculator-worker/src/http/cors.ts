/** Origin, которым разрешено обращаться к API из браузера. */
export const ALLOWED_ORIGINS = [
  'https://www.glushkov-modelling.com',
  'https://glushkov-modelling.com',
  'http://localhost:4321',
] as const;

/**
 * Заголовки CORS для конкретного Origin. `Vary: Origin` обязателен, чтобы
 * промежуточный кеш не отдал ответ с чужим Access-Control-Allow-Origin.
 */
function isAllowedOrigin(origin: string): boolean {
  if ((ALLOWED_ORIGINS as readonly string[]).includes(origin)) return true;
  // Локальная разработка: любой порт loopback. Прод-домены перечислены явно.
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = { vary: 'Origin' };

  if (origin && isAllowedOrigin(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
    headers['access-control-allow-headers'] = 'content-type';
    headers['access-control-max-age'] = '86400';
  }

  return headers;
}
