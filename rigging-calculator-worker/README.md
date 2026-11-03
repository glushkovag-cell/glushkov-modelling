# Rigging calculator worker

Cloudflare Worker для калькулятора толщин такелажа. Использует то же чистое
ядро, что и сайт: `src/lib/rigging/**` (импортируется из корня репозитория),
поэтому формулы и коэффициенты не дублируются.

## Маршруты

| Метод | Путь | Назначение |
| --- | --- | --- |
| `GET` | `/api/rigging/v1/health` | проверка Worker и версии |
| `GET` | `/api/rigging/v1/profiles` | реестр профилей (traditional_plant) |
| `POST` | `/api/rigging/v1/calculate` | расчёт по `RiggingInput` |

Прод-домен: `https://rigging-api.glushkov-modelling.com`.

### `POST /calculate`

Тело — `RiggingInput`:

```json
{
  "scaleDenominator": 64,
  "measurements": {
    "mastDiameter": {
      "main": {
        "value": 10,
        "unitId": "mm",
        "basis": "model",
        "measurementPointId": "partner"
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
`schemaVersion`, `algorithmVersion`, `normalizedMeasurements`, `results`,
`warnings`, `validationErrors`. Доменные ошибки (масштаб, дубли узлов)
возвращаются в `validationErrors` со статусом 200; неверный JSON — 400,
неверная форма тела — 422, слишком большое тело — 413.

## Разработка

```bash
cd rigging-calculator-worker
npm ci
npm run typecheck
npm test
npm run dev
```

## Деплой

Workflow `.github/workflows/rigging-worker-deploy.yml` запускается на push в
`main` при изменениях `rigging-calculator-worker/**` или `src/lib/rigging/**`.
Нужны секреты `CLOUDFLARE_API_TOKEN` и `CLOUDFLARE_ACCOUNT_ID` (уже используются
rope worker).

```bash
npx wrangler deploy
```
