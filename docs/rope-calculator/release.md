# Выпуск 4.0.0: модель без груза

Дата: 17.11.2026. Заменяет контракт v2 с учётом груза (algorithmVersion 3.0.0).

## Что меняется

| Область | Было (3.0.0) | Стало (4.0.0) |
| --- | --- | --- |
| Модель | `a·x^b·n^c·(w/200)^g`, нагрузка | `exp(c0 + c1·u + c2·v + c3·u²)`, без нагрузки |
| Запрос forward/reverse | `loadMode`, `loadGrams` | полей нагрузки нет; запрос с ними → 422 |
| Ответ | `totalDtex`, `loadMode`, `recommendedLoadGrams`, `appliedLoadGrams`, `loadRecommendationVersion` | `modelId`, `warnings`; полей нагрузки нет |
| UI | блок Tension load, Automatic/Manual, колонка Load (g) | блока нет; предупреждение EXTRAPOLATION у результата |
| MCP | `loadMode`/`loadGrams` в схемах | схема строгая; load-аргументы отклоняются валидацией |
| Ручной dTex v2 | 20–6000 | 22.22–6000 |
| Допуск | ±10% | ±10% (не менялся) |
| Версия | algorithmVersion 3.0.0 | algorithmVersion 4.0.0, modelId `log-dtex-quadratic-no-load` |

Контракт v1 (`/api/rope/v1/*`, алгоритм 2.0.0) заморожен: пути, поля и числа
не меняются.

## Порядок выката

1. Worker: `Deploy rope calculator worker` (push в `main` или Run workflow).
2. Сайт: `Deploy to VPS` тем же push; страница `/tools/rope-calculator` и статья
   получают новый бандл компонента.
3. MCP: `Deploy MCP Server to VPS` тем же push.
4. Очистить кеш Cloudflare для страницы инструмента и статьи с калькулятором:
   HTML отдаётся с TTL 4 часа, старый HTML ссылается на старый бандл.

Worker, сайт и MCP идут из одного коммита, поэтому новая страница и новый
Worker совместимы. Окно риска — только у клиентов со старым HTML из кеша:
старый бандл посылает `loadMode: 'auto'` и получит 422. Окно ограничено TTL
HTML (до 4 часов) либо очисткой кеша.

## Проверка

```bash
BASE=https://api.glushkov-modelling.com/api/rope/v2
curl -s $BASE/health
# {"ok":true,"apiVersion":"2","algorithmVersion":"4.0.0","modelId":"log-dtex-quadratic-no-load"}

curl -s -X POST $BASE/forward -H 'content-type: application/json' \
  -d '{"basis":"catalog","threadId":"tera-40","threadsPerStrand":2}'
# diameterMm ≈ 1.0201549921706878, warnings: []

curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/forward \
  -H 'content-type: application/json' \
  -d '{"basis":"dtex","dtex":750,"threadsPerStrand":2,"loadGrams":200}'
# 422 INVALID_PARAMS с fields ["loadGrams"]
```

UI: Tera 40 × 2 показывает `1.020 mm`; переключатель нагрузки отсутствует;
при target = 1.0 обратный подбор показывает 10 совпадений на снимке каталога.

MCP: `calculate_rope_diameter` с `dtex: 22.22` работает; с `loadGrams` —
ошибка валидации; текст ответа — `Rope diameter: 1.020 mm`, в
`structuredContent` — `1.0201549921706878`.

## Откат

Откат согласованный: Worker, сайт и MCP возвращаются на версию 3.0.0
(`npx wrangler rollback` и реверс коммита). Пути `/api/rope/v2/*` те же,
поэтому откат только Worker вернёт поля нагрузки, но новый UI их не пришлёт —
калькулятор продолжит работать без груза, числа станут прежними (3.0.0).
Полный откат UI нужен только если требуется вернуть блок нагрузки.

См. `rollback.md`.

## Что не входит в выпуск

- Материал-зависимые коэффициенты.
- Выбор или рекомендация нагрузки.
- Изменение каталога CMS и его кеша.
