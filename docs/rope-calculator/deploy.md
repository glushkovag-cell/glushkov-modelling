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
4. Smoke-тесты: health, каталог, прямой расчёт (0.9631868577202545),
   обратный подбор (11 совпадений), CORS preflight.

Воркфлоу запускается только вручную. Когда первый деплой пройдёт, можно
добавить триггер `push` по путям `rope-calculator-worker/**`.

## Проверка вручную

```bash
BASE=https://api.glushkov-modelling.com/api/rope/v1

curl -s $BASE/health
curl -s $BASE/catalog | head -c 400

curl -s -X POST $BASE/forward \
  -H 'content-type: application/json' \
  -d '{"basis":"catalog","threadId":"tera-40","threadsPerStrand":2}'

curl -s -X POST $BASE/reverse \
  -H 'content-type: application/json' \
  -d '{"targetDiameterMm":1}' | head -c 400
```

Ожидается: `ok: true`, 23 нити в каталоге, `0.9631868577202545` для Tera 40 × 2,
11 совпадений при target = 1.0.

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
