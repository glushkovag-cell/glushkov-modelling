import type { NextFunction, Request, Response } from "express";
import { config } from "../lib/config.js";

/**
 * Проверка заголовка Origin для соответствия рекомендациям безопасности
 * Streamable HTTP MCP-серверов (защита от DNS rebinding).
 *
 * Если MCP_ALLOWED_ORIGINS не задан, проверка пропускается (например, для
 * локального тестирования через MCP Inspector, который не всегда шлёт Origin).
 */
export function originCheck(req: Request, res: Response, next: NextFunction): void {
  if (config.allowedOrigins.length === 0) {
    next();
    return;
  }

  const origin = req.header("origin");

  // Запросы без Origin (server-to-server, curl, MCP Inspector) допускаются —
  // Origin проверяется только когда браузероподобный клиент его передаёт.
  if (!origin) {
    next();
    return;
  }

  if (!config.allowedOrigins.includes(origin)) {
    res.status(403).json({
      error: "forbidden_origin",
      message: `Origin '${origin}' not allowed.`,
    });
    return;
  }

  next();
}
