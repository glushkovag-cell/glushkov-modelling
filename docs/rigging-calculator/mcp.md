# MCP-инструменты калькулятора толщин такелажа

Три read-only инструмента в MCP-сервере (`mcp-server/`) повторяют страницу
[/tools/rigging-diameters](https://www.glushkov-modelling.com/tools/rigging-diameters).
Расчётное ядро — тот же Cloudflare Worker `rigging-calculator-worker`
(`https://rigging-api.glushkov-modelling.com`), что вызывает сайт. В MCP нет ни
формул, ни коэффициентов: числа в MCP и на сайте совпадают бит в бит.

## Конфигурация

| Переменная | Значение по умолчанию | Назначение |
| --- | --- | --- |
| `RIGGING_API_BASE_URL` | `https://rigging-api.glushkov-modelling.com` | базовый URL Worker'а |
| `PUBLIC_SITE_URL` | `https://www.glushkov-modelling.com` | источник документов профилей (`/api/rigging/profiles/...`) |

Переменные попадают в `.env` на VPS через `mcp-deploy.yml`. Таймаут запроса —
`config.requestTimeoutMs` (8 секунд).

## Поток

```
list_rigging_profiles → get_rigging_profile → calculate_rigging_diameters
   (Worker /profiles)     (сайт /api/rigging/       (Worker /calculate)
                           profiles/{id}[/{ver}])
```

## list_rigging_profiles

Без параметров. Манифест Worker'а: `profileId`, `family`, `name`, `status`,
`latest`, `versions`, плюс `totalProfiles` и `calculatorUrl`.

## get_rigging_profile

| Вход | Тип | Обязателен | Примечание |
| --- | --- | --- | --- |
| `profileId` | строка | да | например `traditional_plant` |
| `profileVersion` | `X.Y.Z` | нет | без него — последняя версия |
| `includeRules` | boolean | нет | список ролей профиля |

Ответ: метаданные, `warnings`, `metrics`, `sources`, `totalRules`,
`supportedBlocks` (какие блоки формы поддерживает профиль), `demoDefaults` и
`exampleConfiguration` — готовый вход для `calculate_rigging_diameters`, равный
форме сайта сразу после выбора профиля (`defaultSettingsForProfile`).
Демонстрационные размеры — не историческая ведомость.

## calculate_rigging_diameters

Компактная конфигурация судна; отсутствующий блок — отсутствующий узел.
MCP разворачивает её в `RiggingInput.nodes` по тем же правилам, что
`src/lib/rigging/settings.ts → buildNodes()`, и отправляет в
`POST /api/rigging/v1/calculate`.

| Вход | Примечание |
| --- | --- |
| `profileId`, `profileVersion?`, `scaleDenominator` | профиль не подменяется; масштаб 1:S |
| `masts.{fore,main,mizzen}` | `diameter`, `topmast`, `topgallant`, `yards[]`, `squareSails[]`, `sailNodes[]` |
| `foreAndAftSails[]` | `sailClass` + `supportingMastId`, каждый класс один раз |
| `gaff`, `lateenYard` | мачта и `sailPresent` (по умолчанию `true`) |
| `bowsprit` | `diameter`, `jibboom`, `flyingJibboom`, `martingale`, `spritsailYard`, `spritsailSail` |
| `hullGroup`, `hullWidth`, `anchor`, `gun` | `hullWidth` — база якорных канатов |
| `statuses`, `groups`, `ownerIds`, `includeNotApplicable` | фильтры строк (по умолчанию `not_applicable` скрыты, как на сайте) |
| `detail` | `table` (по умолчанию) или `full` |
| `includeTrace` | формула и трассировка; включает `full` |

Измерение: `{ value, unitId = "mm", basis = "model", measurementPointId = "unknown" }`.

Ответ `table`: `columns` + `rows`, диаметр модели округлён до 0,01 мм (как в
интерфейсе), `summary` по статусам, `missingInputs`, `notes` (уникальные
предупреждения строк; в строках — индексы `noteIds`), `warnings` профиля,
`validationErrors`, `normalizedMeasurements`, `sources`. Ответ `full`: объекты с
неокруглённым `diameterModelMm`, `sourceLocatorId` → `sourceLocators`,
`alternativeGroupId`, `variant`.

Полный парусник `traditional_plant` — 279 строк, ≈58 КБ в `table`; для
ответов по одной мачте используйте `ownerIds`.

## Паритет с сайтом

`mcp-server/test/rigging-parity.test.ts` для каждого документа в
`data/rigging/profiles` сверяет:

- `exampleConfiguration` ↔ `defaultSettingsForProfile` + `buildInput` — узлы и результат ядра;
- 150 случайных конфигураций формы ↔ компактная конфигурация MCP — узлы и результат ядра.

Поэтому `mcp-deploy.yml` запускается и при изменениях `src/lib/rigging/**`.

Известное расхождение: форма сайта отправляет диаметры всех трёх мачт, даже
отключённых, а правила с базой `thickestMast` без `scope` берут грот-мачту.
Без грот-мачты сайт считает такие строки (якорные канаты `early_plant`) по
диаметру несуществующей мачты; MCP передаёт измерения только существующих мачт
и возвращает `needs_input`.

## Ошибки

`RiggingApiError` с кодом контракта Worker'а (`INVALID_PARAMS`,
`PROFILE_NOT_FOUND`, `PROFILE_UNAVAILABLE`, `BODY_TOO_LARGE`, `TIMEOUT`,
`NETWORK_ERROR`, …). Инструмент возвращает `isError: true` и текст
`Rigging calculator error (CODE): message`. Доменные ошибки (масштаб, дубли
узлов) приходят со статусом 200 в `validationErrors`.
