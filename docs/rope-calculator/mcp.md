# MCP-инструменты

Три read-only инструмента в существующем MCP-сервере (`mcp-server/`). Все ходят
в JSON API Worker'а и не содержат ни формулы, ни каталога.

## Версии API и точность

- С явным `loadMode` (`auto` или `manual`) инструменты расчёта вызывают
  `/api/rope/v2/*` (учёт груза, алгоритм `3.0.0`). Без `loadMode` — устаревший
  `/api/rope/v1/*`, поведение и форма ответа прежние.
- Worker отдаёт полные числа; MCP округляет при выдаче: `diameterMm` — 3 знака,
  `deviationPercent` — 2 знака, `−0` выводится как `0`. Так же округляет сайт,
  поэтому числа MCP и интерфейса совпадают.
- Допуск обратного подбора — ±10% в обеих версиях.
- OAuth и авторизация MCP не менялись.

## Конфигурация

| Переменная | Значение по умолчанию | Назначение |
| --- | --- | --- |
| `ROPE_API_BASE_URL` | `https://api.glushkov-modelling.com` | базовый URL Worker'а |

Переменная попадает в `.env` на VPS через `mcp-deploy.yml`. Таймаут запроса —
`config.requestTimeoutMs` (8 секунд).

## calculate_rope_diameter

Прямой расчёт диаметра каната.

| Вход | Тип | Обязателен | Примечание |
| --- | --- | --- | --- |
| `basis` | `"catalog"` или `"dtex"` | да | источник линейной плотности |
| `threadId` | строка | при `basis = "catalog"` | id нити, например `tera-40` |
| `dtex` | число 20–6000 с `loadMode`, 80–6000 без него | при `basis = "dtex"` | ручная линейная плотность |
| `threadsPerStrand` | от 1 до 5 | да | прядей всегда три, `2` = конструкция 2 × 3 |
| `loadMode` | `"auto"` или `"manual"` | нет | включает API v2 |
| `loadGrams` | 30, 50, 100, 150, 200, 250, 300 | при `loadMode = "manual"` | при `auto` или без режима запрещён |

Ответ: `diameterMm` (3 знака), `construction`, `threadsPerStrand`, `strands`,
`dtex`, `threadId`, `catalogVersion`, `apiVersion`, `algorithmVersion`. С
`loadMode` дополнительно: `totalDtex`, `loadMode`, `recommendedLoadGrams`,
`appliedLoadGrams`, `loadRecommendationVersion`, `warnings`.

## find_rope_threads

Подбор нитей под целевой диаметр с допуском ±10% (допуск фиксирован).

| Вход | Тип | Обязателен | Примечание |
| --- | --- | --- | --- |
| `targetDiameterMm` | число > 0 | да | целевой диаметр |
| `threadIds` | массив строк | нет | без него проверяется весь активный каталог |
| `loadMode` | `"auto"` или `"manual"` | нет | включает API v2 |
| `loadGrams` | 30, 50, 100, 150, 200, 250, 300 | при `loadMode = "manual"` | один груз для всех кандидатов |

Ответ: `targetDiameterMm`, `tolerancePercent` (10), `totalMatched`, `results`
(каждое совпадение с `diameterMm` — 3 знака и `deviationPercent` — 2 знака),
`catalogVersion`, `apiVersion`, `algorithmVersion`. С `loadMode` у каждого
совпадения есть `totalDtex`, `loadMode`, `recommendedLoadGrams`,
`appliedLoadGrams`, а в ответе — `loadMode`, `loadGrams`,
`loadRecommendationVersion`, `warnings`. В режиме `auto` груз подбирается для
каждой конструкции отдельно.

Сортировка результатов задаётся Worker'ом: `|deviation|` → `dtex` →
`threadsPerStrand` → `sortOrder` → `threadId`. Пустой `results` — успешный
ответ, а не ошибка.

## list_rope_threads

Полный активный каталог нитей — без параметров. Нужен, чтобы модель узнала
`threadId` до вызова прямого расчёта.

Ответ: `totalThreads` (на 03.11.2026 — 22), `threads` в порядке выдачи Worker'а (от тонкой к
толстой) с полями `threadId`, `brand`, `number`, `dtex`, `sortOrder` и
`label` вида `Tera 40 — 750 dTex`, плюс `catalogVersion`, `fetchedAt`,
`apiVersion`, `algorithmVersion`.

Отключённые и неопубликованные в CMS нити в ответ не попадают.

## Ошибки

`RopeApiError` содержит код контракта (`INVALID_PARAMS`, `THREAD_NOT_FOUND`,
`CATALOG_UNAVAILABLE`, `TIMEOUT`, `NETWORK_ERROR`, …). Инструмент возвращает
`isError: true` и текст вида `Rope calculator error (CODE): message`.

Секреты и внутренние адреса в сообщения не попадают: клиенту отдаётся только
`error.message` от Worker'а.
