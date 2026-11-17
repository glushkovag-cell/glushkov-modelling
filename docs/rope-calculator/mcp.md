# MCP-инструменты

Три read-only инструмента в существующем MCP-сервере (`mcp-server/`). Все они
ходят в JSON API Worker'а (контракт v2) и не содержат ни формулы, ни каталога:
числа в MCP и в интерфейсе сайта совпадают, потому что источник один — Worker.

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
| `dtex` | число 22.22–6000 | при `basis = "dtex"` | ручная линейная плотность |
| `threadsPerStrand` | целое от 1 до 5 | да | прядей всегда три, `2` = конструкция 2 × 3 |

Полей нагрузки нет: модель без груза. Схема строгая, поэтому аргументы
`loadMode`, `loadGrams` и любые другие неподдержанные поля отклоняются
валидацией с текстом `Input validation error` — они не игнорируются молча.

Ответ: `diameterMm`, `construction`, `threadsPerStrand`, `strands`, `dtex`,
`threadId`, `catalogVersion`, `apiVersion`, `algorithmVersion`, `modelId`,
`warnings`.

Текст ответа показывает диаметр с тремя знаками (`Rope diameter: 1.020 mm`), а
`structuredContent` содержит те же числа без округления и полный набор полей.
Числовой паритет с HTTP API держится на `structuredContent`, а не на тексте.

## find_rope_threads

Подбор нитей под целевой диаметр. Допуск фиксирован: **±10% включительно**.
Допуск — окно поиска, а не обещание точности модели.

| Вход | Тип | Обязателен | Примечание |
| --- | --- | --- | --- |
| `targetDiameterMm` | число > 0 | да | целевой диаметр |
| `threadIds` | массив строк | нет | без него проверяется весь активный каталог; пустой массив — ошибка |

Ответ: `targetDiameterMm`, `tolerancePercent` (10), `totalMatched`, `results`
(каждое совпадение с `diameterMm` и `deviationPercent`), `catalogVersion`,
`apiVersion`, `algorithmVersion`, `modelId`, `warnings`.

Сортировка результатов задаётся Worker'ом: `|deviation|` → `dtex` →
`threadsPerStrand` → `sortOrder` → `threadId`. Для каждой нити проверяются
`n` = 1, 2, 3, 4, 5. Пустой `results` — успешный ответ, а не ошибка.

Текст ответа перечисляет до 25 совпадений с диаметром в три знака и
отклонением в два; полный список — в `structuredContent`.

## list_rope_threads

Полный активный каталог нитей — без параметров. Нужен, чтобы модель узнала
`threadId` до вызова прямого расчёта.

Ответ: `totalThreads` (на 03.11.2026 — 22), `threads` в порядке выдачи Worker'а
(от тонкой к толстой) с полями `threadId`, `brand`, `number`, `dtex`,
`sortOrder` и `label` вида `Tera 40 — 750 dTex`, плюс `catalogVersion`,
`fetchedAt`, `apiVersion`, `algorithmVersion`, `modelId`.

Отключённые и неопубликованные в CMS нити в ответ не попадают. Инструмент не
использует формулу, поэтому при смене модели не меняется.

## Предупреждения

`warnings` — массив `{ code, message, fields }`. Сейчас единственный код —
`EXTRAPOLATION`: линейная плотность выше измеренного предела 3000 dTex, но не
выше 6000. Расчёт не блокируется. В текстовом ответе предупреждения идут
строками `- EXTRAPOLATION: …`, в `structuredContent` — структурой.

## Формат ответа

`calculate_rope_diameter` и `find_rope_threads` возвращают два представления:

- `content[0].text` — текст для человека: диаметр с тремя знаками, отклонение с
  двумя, перечисление предупреждений;
- `structuredContent` — те же данные без округления, включая `diameterMm`,
  `deviationPercent`, версии и предупреждения.

Текстовый формат изменился вместе с моделью 3.0.0: раньше в тексте лежал JSON,
теперь — сводка. Клиентам, которым нужны точные числа, следует читать
`structuredContent`.

## Ошибки

`RopeApiError` содержит код контракта (`INVALID_PARAMS`, `THREAD_NOT_FOUND`,
`CATALOG_UNAVAILABLE`, `TIMEOUT`, `NETWORK_ERROR`, …). Инструмент возвращает
`isError: true` и текст вида `Rope calculator error (CODE): message`.

Секреты и внутренние адреса в сообщения не попадают: клиенту отдаётся только
`error.message` от Worker'а.
