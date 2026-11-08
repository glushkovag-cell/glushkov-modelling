# Профили такелажа — данные и доставка

Реализация плана «Калькулятор толщин такелажа». Профили — версионированные
JSON-документы; расчётное ядро интерпретирует документ и не содержит ни одного
коэффициента профиля.

## Каталог данных

```text
data/rigging/
  index.json                              манифест: профили, версии, sha256
  schema/profile-document.schema.json      JSON Schema (draft 2020-12)
  profiles/
    traditional_plant/1.0.0.json
    yacht_metal_yacht/1.0.0.json
    yacht_metal_schooner/1.0.0.json
    early_plant/1.2.1.json
```

Файл версии только добавляется: проекты ссылаются на конкретную версию.
`index.json` — единственный файл, который меняется при выпуске версии; его
`sha256` проверяется тестом `tests/rigging-profiles.test.ts`.

## Документ профиля

```json
{
  "documentVersion": "1.0.0",
  "profile": {
    "profileId": "early_plant",
    "profileVersion": "1.2.1",
    "schemaVersion": "1.0.0",
    "status": "draft",
    "bases": { "mast": 1, "bowsprit": 1, "hullWidth": 1, "gunBore": 1, "thickestMast": 1 },
    "baseLabels": { "mast": "D", "bowsprit": "D_b", "hullWidth": "W", "gunBore": "K", "thickestMast": "G" },
    "sources": [{ "id": "N", "title": "Niña 1:36", "locator": "Part list" }],
    "warnings": ["Research draft."],
    "metrics": { "fittedRoles": 17, "mapePercent": 13.4, "note": "..." },
    "ui": { "masts": true, "tiers": ["lower", "topmast"], "...": "..." }
  },
  "rules": [
    {
      "ruleId": "ep.st.lower.shroud",
      "role": "lower_shroud",
      "name": { "en": "Lower shrouds", "ru": "Нижние ванты" },
      "group": "standing",
      "select": { "nodeType": "lower_mast", "perMast": true },
      "base": { "kind": "mast" },
      "factor": 0.10714285714285714,
      "factorLabel": "3/28",
      "materials": ["fiber"],
      "coefficientBasis": "preliminary_fit",
      "calibrationStatus": "training_set_only",
      "sources": ["N"]
    }
  ]
}
```

- `bases` — множитель размерной базы: `d = factor × bases[kind] × измерение`.
  У `traditional_plant` `bases.mast = 3/25`; у остальных профилей `1`, поэтому
  `factor` — прямой `q`.
- `base.kind`: `mast` \| `bowsprit` \| `hullWidth` \| `gunBore` \|
  `thickestMast` \| `rule`. `base.kind = rule` ссылается на другую роль того же
  узла (или на `base.nodeType`/`base.tier` другого яруса той же мачты).
- `select` — тип узла, ярус, парусный класс. Одно правило даёт строку на каждый
  подходящий узел; `perMast` — информативная пометка для аудита.
- `requires.sailPresent` включает проверку конструктивного наличия паруса;
  `unsupportedWhen` описывает материальные ограничения (например, chain cable).
- `perMastOverrides` сохраняет историческое происхождение основания по мачтам
  (например, FIT только для фока и грота).
- `ui` управляет видимостью блоков формы; это подсказка интерфейсу, а не
  правило расчёта.

## Ядро

```ts
import { calculate } from './src/lib/rigging/calculate.ts';
const calculation = calculate(input, document);
```

`calculate` не читает диск, сеть и CMS. Он проверяет документ лёгкими
guard-функциями (`validateProfileDocument`), граф правил, входные размеры и
циклы; коэффициенты и роли берутся только из документа.

Порядок статусов: `not_applicable` (узел/парус отсутствует) → `unsupported`
(правило, материал или установка не поддержаны) → `needs_input`
(неизвестная конфигурация или обязательный размер) → `calculated`.
Отсутствующий диаметр — `null`, не ноль.

## Доставка

| Метод | Путь | Ответ | Cache-Control |
| --- | --- | --- | --- |
| GET | `/api/rigging/profiles` | манифест | `public, max-age=60, must-revalidate` |
| GET | `/api/rigging/profiles/{profileId}` | последняя версия | `public, max-age=300, must-revalidate` |
| GET | `/api/rigging/profiles/{profileId}/{version}` | неизменяемая версия | `public, max-age=31536000, immutable` |

Заголовки: `application/json; charset=utf-8`, сильный `ETag` (`"sha256:..."`),
`Vary: Origin, Accept-Encoding`, CORS только для сайта и loopback в разработке.
`If-None-Match` возвращает `304`.

Astro SSR читает документы из бандла (`import.meta.glob` в
`src/lib/rigging/profileStore.ts`), Worker — по HTTP с кэшем `caches.default`.
Ошибки: `404 profile_not_found` / `version_not_found`, `422
unsupported_schema`, `500 profile_contract_violation`, `503
profile_unavailable`.

## Как добавить версию профиля

1. Добавить `data/rigging/profiles/{profileId}/{version}.json`.
2. Обновить `data/rigging/index.json`: `latest`, запись версии и `sha256`.
3. Запустить `npm test` — тесты проверяют схему, хеши, уникальность `ruleId`,
   ссылки `base.kind = rule`, отсутствие циклов и контрольные числа.
4. Изменение коэффициента, зависимости, материального условия или охвата — это
   новая `profileVersion`; изменение контракта — новая `schemaVersion`.
   Версии профилей независимы.

## Проверки приёмки

- `tests/rigging-core.test.ts` — регрессия `traditional_plant` (1,20 мм штаг и
  0,66 мм ванты при D_model = 10), model/prototype, статусы, CSV/JSON.
- `tests/rigging-profiles.test.ts` — манифест и хеши, 135/5/35/48 правил,
  контрольные таблицы §12 и §7, независимость версий, неизвестный профиль,
  proxy-точка `step`, провенанс.
- `tests/rigging-form-rules.test.ts` — зависимость «мачта → рей → парус» и
  профильные наборы узлов.
- `rigging-calculator-worker/test/app.test.ts` — маршруты, 422 для неизвестного
  профиля, early_plant тем же ядром.

## Принятые решения

- `profileId` — единственная ось выбора; `coefficientSetId` отсутствует.
- Год и период профиль не выбирают; выбор только прямой.
- `profileId` в `RiggingInput` обязателен; неизвестный профиль — `422`, без
  подмены `traditional_plant`.
- Версия HTTP-контракта остаётся `1`.
- MCP-инструмент такелажа в этот цикл не входит.
