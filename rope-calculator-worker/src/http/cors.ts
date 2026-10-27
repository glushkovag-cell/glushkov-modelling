/** Origin, которым разрешено обращаться к API из браузера. */
export const ALLOWED_ORIGINS = [
  'https://www.glushkov-modelling.com',
  'https://glushkov-modelling.com',
  'http://localhost:4321',
] as const;

/**
 * Заголовки CORS для конкретного Origin.
 *
 * `Vary: Origin` обязателен: иначе промежуточный кеш может отдать ответ с
 * чужим Access-Control-Allow-Origin. Для неизвестного Origin заголовок
 * доступа не выставляется — браузер заблокирует чтение ответа.
 */
export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = { vary: 'Origin' };

  if (origin && (ALLOWED_ORIGINS as readonly string[]).includes(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
    headers['access-control-allow-headers'] = 'content-type';
    headers['access-control-max-age'] = '86400';
  }

  return headers;
}
