# MCP Registry badge — деплой

Воркер `mcp-registry-badge` отдаёт бейдж версии сервера
`com.glushkov-modelling/content` из официального MCP Registry.

## Адреса

| Путь | Ответ |
| --- | --- |
| `https://mcp-badge.glushkov-modelling.com/` | health (JSON, `no-store`) |
| `https://mcp-badge.glushkov-modelling.com/badge` | Shields endpoint JSON |
| `https://mcp-badge.glushkov-modelling.com/badge.svg` | готовый SVG |

Хост — отдельный Cloudflare Custom Domain (решение 27.10.2026, вариант A).
`api.glushkov-modelling.com` принадлежит калькулятору канатов, бейдж его
не использует. Адрес `*.workers.dev` выключен (`workers_dev: false`).

Потребители: карточка MCP Registry на `/ai-hub` (`src/pages/ai-hub.astro`).

## Деплой

**Actions** → **Deploy MCP registry badge worker** → **Run workflow**, ветка
`main`. Используются секреты `CLOUDFLARE_API_TOKEN` и `CLOUDFLARE_ACCOUNT_ID`
(те же, что у калькулятора; права — см.
[`../rope-calculator/deploy.md`](../rope-calculator/deploy.md)).

Воркфлоу: `npm ci` → тесты → `wrangler deploy` → ожидание DNS/TLS → smoke
health, `/badge`, `/badge.svg` (`image/svg+xml`), CORS preflight.

## Конфигурация

| Что | Где |
| --- | --- |
| Домен | `wrangler.jsonc` → `routes` с `custom_domain` |
| `CACHE_TTL_SECONDS` | `wrangler.jsonc` → `vars`, сейчас 3600 |
| `MCP_FALLBACK_VERSION` | `wrangler.jsonc` → `vars` |

## Проверка вручную

```bash
B=https://mcp-badge.glushkov-modelling.com
curl -s $B/
curl -s $B/badge
curl -s -o /dev/null -D - $B/badge.svg | grep -iE 'content-type|cache-control|x-badge-source'
```

`HEAD` не поддерживается (405), проверять через `GET`.
