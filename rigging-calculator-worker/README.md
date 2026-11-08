# Rigging calculator worker

Cloudflare Worker для калькулятора толщин такелажа. Использует то же чистое
ядро, что и сайт: `src/lib/rigging/**` (импортируется из корня репозитория),
поэтому формулы и коэффициенты не дублируются. Документы профилей Worker не
бандлит: он читает их с сайта по HTTP и кэширует в `caches.default`.

## Маршруты

| Метод | Путь | Назначение |
| --- | --- | --- |
| `GET` | `/api/rigging/v1/health` | проверка Worker и версии |
| `GET` | `/api/rigging/v1/profiles` | манифест профилей (4 записи) |
| `POST` | `/api/rigging/v1/calculate` | расчёт по `RiggingInput` с `profileId` |

Прод-домен: `https://rigging-api.glushkov-modelling.com`.

### `POST /calculate`

Тело — `RiggingInput`. `profileId` обязателен; `profileVersion` можно зафиксировать.

```json
{
  "profileId": "early_plant",
  "profileVersion": "1.2.1",
  "scaleDenominator": 65,
  "measurements": {
    "mastDiameter": {
      "main": {
        "value": 8,
        "unitId": "mm",
        "basis": "model",
        "measurementPointId": "unknown"
      }
    }
  },
  "nodes": [
    {
      "nodeId": "mast.main.lower",
      "nodeType": "lower_mast",
      "parentNodeId": null,
      "ownerType": "mast",
      "ownerId": "main",
      "present": true
    }
  ]
}
```

Ответ — `Calculation` с `apiVersion`: `profileId`, `profileVersion`,
`profileStatus`, `schemaVersion`, `algorithmVersion`, `normalizedMeasurements`,
`results`, `sources`, `warnings`, `validationErrors`. Каждая строка содержит
`material`, `sourceIds`, `sourceLocator`, `measurementPointId` и неокруглённый
`diameterModelMm`.

Доменные ошибки (масштаб, дубли узлов) возвращаются в `validationErrors` со
статусом 200. Неверный JSON — 400, неверная форма тела — 422, неизвестный
профиль — 422 `PROFILE_NOT_FOUND`, слишком большое тело — 413, недоступность
источника профилей — 503 `PROFILE_UNAVAILABLE`.

## Доставка профилей

- `PROFILES_BASE_URL` (переменная окружения) — база сайта; по умолчанию
  `https://www.glushkov-modelling.com`.
- Версия кэшируется на год (`immutable`), последняя — на короткий TTL.
- При сетевой ошибке используется закэтированная копия; если её нет — 503.
  Другой профиль не подставляется.
- Контракт документа и схема: `docs/rigging-profiles.md`.

## Разработка

```bash
cd rigging-calculator-worker
npm ci
npm run typecheck
npm test
npm run dev -- --var PROFILES_BASE_URL:http://127.0.0.1:4321
```

Для локальной страницы: `npm run dev` в корне, затем открыть
`/tools/rigging-diameters?api=http://localhost:8787`.

## Деплой

Workflow `.github/workflows/rigging-worker-deploy.yml` запускается на push в
`main` при изменениях `rigging-calculator-worker/**`, `src/lib/rigging/**` или
самого workflow. Нужны секреты `CLOUDFLARE_API_TOKEN` и `CLOUDFLARE_ACCOUNT_ID`.
Smoke-тесты проверяют манифест, версию `early_plant`, расчёт по общему ядру и
`422` для неизвестного профиля.

```bash
npx wrangler deploy
```
