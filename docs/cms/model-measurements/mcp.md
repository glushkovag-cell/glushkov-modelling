# MCP: измерения модели в get_build_details

Этап 7, часть MCP. Новые инструменты не добавляются (их по-прежнему 16).
Формулы и профили такелажа не изменяются.

## Источник данных

`mcp-server/src/lib/model-measurements.ts` запрашивает у WPGraphQL поле
`measurements` модели по slug — так же, как `getModelBySlug()` на сайте:

```graphql
query GetModelMeasurements($slug: ID!) {
  model(id: $slug, idType: SLUG) {
    measurements {
      code
      label
      description
      group
      valueMm
      target { kind id label }
      note
    }
  }
}
```

Запрос выполняется отдельно от общего `GetAllModels`, только в режиме сводки
модели (без `partNumber`/`partSlug`). Причина: резолвер сообщает о
повреждённых данных ошибкой поля; при включении `measurements` в общий
список одна повреждённая модель ломала бы `list_builds`, `list_model_slugs`,
`get_project_status` и другие инструменты.

## Ответ инструмента

В ответ `get_build_details` добавлено поле `measurements`. Остальные поля и
режимы не изменились.

| Ситуация | `measurements` | `measurementsError` |
| --- | --- | --- |
| Измерения есть | массив в порядке WordPress | отсутствует |
| Измерений нет | `[]` | отсутствует |
| Резолвер вернул `null` (нет доступа) | `null` | `Measurements are not available for this model.` |
| Ошибка поля, сети или нарушение контракта | `null` | описание ошибки |
| Запрошена одна часть build-лога | поле отсутствует | отсутствует |

Элемент массива: `code`, `label`, `description`, `group`, `valueMm`
(мм, физическая модель), `target { kind, id, label }` или `null`, `note`
или `null`. Значения и порядок не изменяются и не пересортировываются,
поэтому совпадают с тем, что получает Astro. Нули и значения по умолчанию
не подставляются; некорректная запись (неположительное или нечисловое
`valueMm`, неполный `target`) даёт `measurementsError`, а не частичный
список.

## Совместимость modelLength

`modelLength` остаётся строкой из `modelinfo.modellength`. Переключение на
`overall_length` нового хранилища через совместимый слой — этап 8.
Автоматическое копирование и синхронизация не выполняются.

## Расчётные сценарии

`calculate_rigging_diameters` не читает сохранённые измерения: все входы
передаются явно в аргументах. Поэтому правило приоритета явно переданных
значений и сообщение о происхождении размеров в текущем MCP не требуют
изменений. Адаптер `src/lib/rigging/modelMeasurements.ts` в MCP не
подключён.

## Проверки

`mcp-server/src/tools/get-build-details.test.ts`: совпадение ответа с
GraphQL (порядок, дробь 8.25, `target=null`, `note`), пустой список, ошибка
поля, `null` без доступа, отсутствие запроса в режиме части, число
инструментов и нормализация некорректных значений.
