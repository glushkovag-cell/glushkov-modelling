import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./lib/config.js";
import { bearerAuth } from "./middleware/auth.js";
import { originCheck } from "./middleware/origin.js";
import { createMcpServer } from "./server.js";

/**
 * Streamable HTTP MCP-сервер — точка входа /mcp принимает POST-запросы.
 * Работает в стейтлес-режиме (sessionIdGenerator: undefined), как рекомендовано
 * для read-only MVP: на каждый запрос создаётся новый McpServer + transport.
 *
 * Процесс слушает только 127.0.0.1 — весь внешний трафик идёт через Nginx
 * (см. mcp.glushkov-modelling.com vhost, проксирующий на этот порт).
 */
const app = createMcpExpressApp({
  host: config.host,
  // Домен из Nginx (Host передаётся как есть через proxy_set_header Host $host)
  // плюс localhost/127.0.0.1 для локального тестирования через MCP Inspector.
  allowedHosts: [
    "mcp.glushkov-modelling.com",
    "localhost",
    "127.0.0.1",
    "[::1]",
  ],
});

/** Health-check без авторизации — используется для проверки цепочки Nginx → Node.js. */
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post("/mcp", originCheck, bearerAuth, async (req, res) => {
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
    console.error("Error processing MCP-query:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Streamable HTTP в стейтлес-режиме не поддерживает GET (SSE-стрим) и DELETE
// (завершение сессии) — сессий нет, поэтому явно отвечаем 405.
app.get("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
});

app.delete("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
});

app.listen(config.port, config.host, () => {
  console.log(
    `MCP-server glushkov-modelling listen on ${config.host}:${config.port}`,
  );
});

process.on("SIGINT", () => {
  console.log("Stop MCP-server...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("Stop MCP-server...");
  process.exit(0);
});
