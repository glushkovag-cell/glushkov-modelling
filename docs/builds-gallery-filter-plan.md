# Builds / Gallery Filter Implementation Plan

## Цель

Внедрить фильтрацию для страниц `Builds` и `Gallery` на базе текущей структуры проекта без смены существующих источников данных и с опорой на уже работающий UX-паттерн из `tutorials/index.astro`.

## Зафиксированное текущее состояние

### Builds

- `src/pages/builds/index.astro` получает данные через `getAllModels()`.
- Страница рендерит список карточек моделей без фильтров.
- В карточках уже используются данные, достаточные для базовой фильтрации:
  - `buildstatusText` / `buildstatusClass`
  - `modelinfo.modelscale`
  - `modelinfo.manufacturer`
  - `historicalyear`

### Gallery

- `src/pages/gallery/index.astro` получает данные через `getAllGalleryEntries()`.
- Страница не использует `getAllModels()`.
- Значит, фильтрация Gallery должна строиться поверх gallery-specific источника данных, без смешивания с Build Logs.

### Tutorials

- Актуальная рабочая фильтрация уже реализована в `src/pages/tutorials/index.astro`.
- В текущей реализации используется `TagFilter.astro`.
- Mobile-поведение реализовано прямо в странице через:
  - mobile toggle
  - collapsible filter panel
  - result count
  - reset behavior

### Legacy-компоненты

Подтверждённо не используются сейчас:

- `src/components/tutorials/MobileFilterPanel.astro`
- `src/components/tutorials/CategoryFilter.astro`
- `src/components/tutorials/LevelFilter.astro`
- `src/components/tutorials/TutorialCard.astro`

Эти файлы остались от более ранней версии реализации и могут быть безопасно удалены из активной ветки с сохранением возможности восстановления через git history.

---

## Этап 1. Удаление неиспользуемых legacy-компонентов

### Цель

Очистить активную ветку от неиспользуемых tutorial-компонентов, не теряя возможность их восстановить через историю git.

### Действия

1. Удалить:
   - `src/components/tutorials/MobileFilterPanel.astro`
   - `src/components/tutorials/CategoryFilter.astro`
   - `src/components/tutorials/LevelFilter.astro`
   - `src/components/tutorials/TutorialCard.astro`
2. Проверить, что проект собирается без этих файлов.
3. Зафиксировать изменения отдельным коммитом.

### Коммит

```bash
git commit -m "chore: remove unused legacy tutorial components"
