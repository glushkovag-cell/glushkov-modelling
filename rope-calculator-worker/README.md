# rope-calculator-worker

Cloudflare Worker: расчёт диаметра канатов и подбор нитей по каталогу WordPress.
Контракт API и правила округления описаны в
[`docs/rope-calculator/spec.md`](../docs/rope-calculator/spec.md).

## Команды

```bash
npm ci                # установка по лок-файлу
npm test              # тесты в workerd (vitest + @cloudflare/vitest-plugin)
npm run typecheck     # wrangler types + tsc --noEmit
npx wrangler dev      # локальный запуск
npx wrangler deploy   # публикация
```

## Конфигурация

| Переменная | Тип | Назначение |
| --- | --- | --- |
| `WP_GRAPHQL_URL` | var | GraphQL endpoint WordPress |
| `WP_GRAPHQL_SECRET` | secret | общий с сайтом секрет; без него CMS отвечает 404 |

KV, D1 и Durable Objects не используются намеренно: каталог кешируется через
`caches.default` с TTL 24 часа.

## Лок-файл и версия npm

`package-lock.json` собран стандартным резолвером npm 11. npm 10 падает с
`Cannot read properties of null (reading 'edgesOut')` только при холодном
разрешении зависимостей без лок-файла — то есть при его пересоздании или
добавлении зависимости в пустой проект. `npm ci` и обычный `npm install` с
готовым лок-файлом работают на npm 10 и 11.

Если лок-файл нужно пересобрать:

```bash
npx npm@11 install
```

Причина — баг arborist в npm 10 на опциональных peer-зависимостях vitest 4
(`happy-dom`, `jsdom`, `canvas`).
