import type { NextFunction, Request, Response } from "express";
import { config } from "../lib/config.js";

/**
 * Проверяет заголовок Authorization: Bearer <MCP_API_KEY>.
 * Метод авторизации, поддерживаемый Perplexity Custom Remote Connector.
 */
export function bearerAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token || token !== config.mcpApiKey) {
    res.status(401).json({
      error: "unauthorized",
      message: "A valid Authorization header is required: Bearer <API_KEY>.",
    });
    return;
  }

  next();
}
