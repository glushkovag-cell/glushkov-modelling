> **Архив, снято с эксплуатации.** Документ описывает контракт v2 с учётом
> груза (algorithmVersion 3.0.0). Модель без груза 4.0.0 заменила его;
> груз удалён из кода, API, UI и MCP. См. `docs/rope-calculator/spec.md`.

# Калькулятор канатов: учёт груза — выпуск и проверки

Статус: доработка выполнена в ветке `feat/rope-load-v2`. Production-деплой
не выполнялся и требует отдельного разрешения: push в `main` автоматически
выкатывает Worker, MCP и сайт.

Режим `auto` экспериментальный: рекомендуемый груз — стартовое значение по
порогам суммарного dTex, а не экспериментально установленный оптимум.
Промежуточные 50/100/150/250 г не проверены измерениями и помечаются
предупреждением `UNVERIFIED_LOAD`.

## Этапы

| Этап | Что сделано | Проверка |
|---|---|---|
| 1 | Аудит v1, снимок legacy-контракта, решения | `node scripts/rope-legacy-snapshot.mjs` |
| 2 | Калибровочный датасет | `python3 data/rope-calibration/calibrate.py --check` |
| 3 | Модель груза 3.0.0 и golden-тесты | `npm test` в `rope-calculator-worker` |
| 4 | Worker API v2, допуск ±10% в v1 и v2 | `npm test`, `npm run typecheck` в `rope-calculator-worker` |
| 5 | MCP: `loadMode`/`loadGrams`, 3 знака диаметра | `npm test`, `npx tsc --noEmit` в `mcp-server` |
| 6 | Интерфейс: блок Tension load, свёрнутый каталог | `npm test`, `npx astro check` в корне |
| 7 | Отчёт drift, этот документ | `node scripts/rope-drift-report.mjs --check` |

Отчёт drift: [drift.md](./drift.md).

## Staging

Отдельного staging-окружения у проекта нет. До деплоя интерфейс проверен на
локальном стенде: Worker `handleRequest` на `catalog-snapshot.json` и бандл
виджета на одной странице, скриншоты Playwright в светлой и тёмной теме,
десктоп и 375 px. Проверено:

- auto: 750 dTex × 2 → 1.018 мм, 4500 dTex, 300 g · recommended;
- dTex 22.22 × 1 → 0.053 мм, 66.66 dTex, 30 g;
- manual 250 g: предупреждение об непроверенном грузе, ручной выбор
  сохраняется при смене нити и числа нитей, возврат в Automatic снова
  применяет рекомендацию;
- при задержке ответа API результат и селектор показывают загрузку, а не
  прошлое значение;
- обратный подбор 1.0 мм: 7 кандидатов в auto, колонка Load (g), каталог
  свёрнут, кнопка Show catalog раскрывает его.

`npm run build` в корне без секретов CMS останавливается на prerender
(`WP_GRAPHQL_URL is not defined`); это ограничение окружения, а не кода. В CI
секреты есть.

## Порядок выпуска (после разрешения)

1. Worker: деплой и проверка `/api/rope/v2/health`, `/api/rope/v2/forward`,
   `/api/rope/v2/reverse`, `/api/rope/v1/reverse` (допуск 0.1).
2. Сайт и MCP: деплой после Worker, потому что они вызывают `/api/rope/v2`.
3. Сквозная проверка на production:
   - `/tools/rope-calculator`: auto и manual, dTex 22.22, обратный подбор
     1.0 мм, `?target=1` раскрывает выбор нитей в каталоге;
   - MCP `calculate_rope_diameter` с `loadMode: "auto"` и без него
     (диаметр с тремя знаками), `find_rope_threads` с `loadMode: "manual"`,
     `loadGrams: 250`;
   - статья со встроенным калькулятором.

Откат — в обратном порядке: сначала сайт и MCP, затем Worker
([rollback.md](../rollback.md), раздел 6).
