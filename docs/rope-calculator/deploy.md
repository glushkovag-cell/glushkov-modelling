# Деплой Worker

## Что нужно один раз

### 1. API-токен Cloudflare

1. Открыть [dash.cloudflare.com](https://dash.cloudflare.com) → иконка профиля →
   **My Profile** → **API Tokens** → **Create Token**.
2. Взять шаблон **Edit Cloudflare Workers**.
3. Проверить права в токене:

   | Тип | Ресурс | Право |
   | --- | --- | --- |
   | Account | Workers Scripts | Edit |
   | Zone | Workers Routes | Edit |
   | Zone | Zone | Read |
   | Zone | DNS | Edit |

   `DNS: Edit` нужен, чтобы при первом деплое Cloudflare сам создал запись
   `api.glushkov-modelling.com` для Custom Domain. Права на KV и R2 из шаблона
   не используются, их можно снять.
4. Account Resources — нужный аккаунт, Zone Resources — зона
   `glushkov-modelling.com`.
5. **Continue to summary** → **Create Token** → скопировать значение: оно
   показывается один раз.

### 2. Account ID

Workers & Pages → правая колонка **Account ID** (или взять из адреса
`dash.cloudflare.com/<account-id>/...`).

### 3. Секреты GitHub

Репозиторий → **Settings** → **Secrets and variables** → **Actions** →
**New repository secret**:

| Имя | Значение |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | токен из шага 1 |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID из шага 2 |

`WP_GRAPHQL_SECRET` в репозитории уже есть: он используется сайтом и
MCP-сервером и тот же самый нужен Worker.

## Первый деплой

**Actions** → **Deploy rope calculator worker** → **Run workflow**, ветка
`main`.

Что делает воркфлоу:

1. `npm ci`, `npm run typecheck`, `npm test`.
2. Синхронизирует `WP_GRAPHQL_SECRET` в Worker Secrets.
3. `npx wrangler deploy` — публикует код и создаёт Custom Domain
   `api.glushkov-modelling.com` вместе с DNS-записью и сертификатом.
4. Smoke-тесты: health v1 (2.0.0) и v2 (4.0.0, `modelId`), каталог v2, прямой
   расчёт (`1.0201549921706878` и `0.05259208341950491` для 22.22 dTex),
   обратный подбор (есть Tera 40 × 2, все результаты в допуске ±10%),
   предупреждение EXTRAPOLATION, отказ на устаревшее поле нагрузки (422),
   CORS preflight.

Воркфлоу запускается автоматически при push в `main`, если изменились
`rope-calculator-worker/**`, `docs/rope-calculator/fixtures/**`,
`docs/rope-calculator/reference/**` или сам файл воркфлоу. Ручной запуск
(**Run workflow**) остаётся для повторного деплоя без изменений в коде.

## Проверка вручную

```bash
BASE=https://api.glushkov-modelling.com/api/rope/v2

curl -s $BASE/health
curl -s $BASE/catalog | head -c 400

curl -s -X POST $BASE/forward \
  -H 'content-type: application/json' \
  -d '{"basis":"catalog","threadId":"tera-40","threadsPerStrand":2}'

curl -s -X POST $BASE/reverse \
  -H 'content-type: application/json' \
  -d '{"targetDiameterMm":1}' | head -c 400
```

Ожидается: `ok: true`, `apiVersion 2`, `algorithmVersion 4.0.0`,
`modelId log-dtex-quadratic-no-load`, 22 нити в каталоге (на 03.11.2026),
`1.0201549921706878` для Tera 40 × 2; при target = 1.0 на снимке каталога —
10 совпадений (модель 4.0.0); на живом CMS число зависит от состава каталога.
Запрос v2 с `loadMode`/`loadGrams` должен вернуть 422 `INVALID_PARAMS`.

## Конфигурация

| Что | Где |
| --- | --- |
| `WP_GRAPHQL_URL` | `wrangler.jsonc` → `vars` (не секрет) |
| `WP_GRAPHQL_SECRET` | Worker Secret, синхронизируется из GitHub Secrets |
| Домен API | `wrangler.jsonc` → `routes` с `custom_domain` |
| `workers_dev` | выключен: публичного `*.workers.dev` адреса нет |

## Ротация секрета

1. Обновить `WP_GRAPHQL_SECRET` в GitHub Secrets (и в CMS, если меняется
   серверная часть).
2. Запустить воркфлоу деплоя заново — он перезапишет секрет в Worker.

## Откат

См. [`rollback.md`](./rollback.md).
