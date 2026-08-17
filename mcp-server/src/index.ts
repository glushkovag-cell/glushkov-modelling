import type { Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./lib/config.js";
import { bearerAuth } from "./middleware/auth.js";
import { oauthAuth } from "./middleware/oauth.js";
import { originCheck } from "./middleware/origin.js";
import { createMcpServer } from "./server.js";

/**
 * Streamable HTTP MCP-сервер.
 *
 * /mcp       — существующий маршрут с API key для Perplexity connector.
 * /mcp-oauth — новый маршрут OAuth 2.1: JWT Keycloak, audience и content:read.
 *
 * Оба маршрута stateless: на каждый запрос создаётся новый McpServer + transport.
 * Процесс слушает только localhost; внешний доступ идёт через Nginx.
 */
const app = createMcpExpressApp({
  host: config.host,
  allowedHosts: [
    "mcp.glushkov-modelling.com",
    "localhost",
    "127.0.0.1",
    "[::1]",
  ],
});

/** Health-check без авторизации для проверки цепочки Nginx → Node.js. */
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

/**
 * Единый обработчик stateless Streamable HTTP MCP.
 * Аутентификация выполняется middleware конкретного маршрута до вызова handler.
 */
async function handleStatelessMcpRequest(
    req: Request,
    res: Response,
): Promise<void> {
  const server = createMcpServer();

  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error("Error processing MCP query:", error);

    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
}

/**
 * Существующий API-key endpoint.
 * Не изменять: внешний Perplexity connector использует этот маршрут.
 */
app.post("/mcp", originCheck, bearerAuth, handleStatelessMcpRequest);

/**
 * Новый OAuth 2.1 endpoint.
 * Принимает только access token Keycloak с валидными:
 * подписью JWKS, issuer, audience, exp и scope content:read.
 */
app.post("/mcp-oauth", originCheck, oauthAuth, handleStatelessMcpRequest);

/**
 * Stateless Streamable HTTP не поддерживает GET (SSE) и DELETE:
 * sessionIdGenerator отключён, сессии отсутствуют.
 */
function methodNotAllowed(_req: Request, res: Response): void {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed.",
    },
    id: null,
  });
}

app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

app.get("/mcp-oauth", methodNotAllowed);
app.delete("/mcp-oauth", methodNotAllowed);

app.listen(config.port, config.host, () => {
  console.log(
      `MCP-server glushkov-modelling listens on ${config.host}:${config.port}`,
  );
});

process.on("SIGINT", () => {
  console.log("Stopping MCP-server...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("Stopping MCP-server...");
  process.exit(0);
});
