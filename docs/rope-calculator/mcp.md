# MCP-инструменты

Два read-only инструмента в существующем MCP-сервере (`mcp-server/`). Оба ходят
в JSON API Worker'а и не содержат ни формулы, ни каталога: числа в MCP и в
интерфейсе сайта совпадают бит в бит.

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
| `dtex` | число 80–6000 | при `basis = "dtex"` | ручная линейная плотность |
| `threadsPerStrand` | 1, 2 или 3 | да | прядей всегда три, `2` = конструкция 2 × 3 |

Ответ: `diameterMm`, `construction`, `threadsPerStrand`, `strands`, `dtex`,
`threadId`, `catalogVersion`, `apiVersion`, `algorithmVersion`.

## find_rope_threads

Подбор нитей под целевой диаметр с допуском ±15% (в v1 допуск фиксирован).

| Вход | Тип | Обязателен | Примечание |
| --- | --- | --- | --- |
| `targetDiameterMm` | число > 0 | да | целевой диаметр |
| `threadIds` | массив строк | нет | без него проверяется весь активный каталог |

Ответ: `targetDiameterMm`, `tolerancePercent` (15), `totalMatched`, `results`
(каждое совпадение с `diameterMm` и `deviationPercent`), `catalogVersion`,
`apiVersion`, `algorithmVersion`.

Сортировка результатов задаётся Worker'ом: `|deviation|` → `dtex` →
`threadsPerStrand` → `sortOrder` → `threadId`. Пустой `results` — успешный
ответ, а не ошибка.

## list_rope_threads

Полный активный каталог нитей — без параметров. Нужен, чтобы модель узнала
`threadId` до вызова прямого расчёта.

Ответ: `totalThreads` (23), `threads` в порядке выдачи Worker'а (от тонкой к
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
