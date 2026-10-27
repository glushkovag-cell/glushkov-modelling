import { ALGORITHM_VERSION, API_VERSION } from './core/constants';

/**
 * Точка входа Worker.
 *
 * Этап 2 содержит только расчётное ядро. HTTP-маршруты, кеш каталога и CORS
 * добавляются на этапе 4; до этого любой запрос получает явный 501, чтобы
 * случайный деплой не выглядел рабочим API.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    return Response.json(
      {
        error: {
          code: 'NOT_IMPLEMENTED',
          message: 'HTTP API is implemented in stage 4 of the plan.',
          fields: [],
        },
        apiVersion: API_VERSION,
        algorithmVersion: ALGORITHM_VERSION,
        path: pathname,
      },
      { status: 501 },
    );
  },
};
