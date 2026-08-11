import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerListBuilds } from "./tools/list-builds.js";
import { registerGetProjectStatus } from "./tools/get-project-status.js";
import { registerGetBuildDetails } from "./tools/get-build-details.js";
import { registerListGalleryPhotos } from "./tools/list-gallery-photos.js";
import { registerSearchContent } from "./tools/search-content.js";
import { registerGetTutorials } from "./tools/get-tutorials.js";

/**
 * Создаёт новый экземпляр McpServer с зарегистрированными 6 read-only
 * инструментами для доступа к данным glushkov-modelling.com.
 *
 * Порядок регистрации соответствует рекомендованному порядку реализации
 * из плана: сначала простые GraphQL-запросы, затем более сложные.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "glushkov-modelling-mcp-server",
      version: "0.1.0",
    },
    { capabilities: { tools: {} } },
  );

  registerListBuilds(server);
  registerGetProjectStatus(server);
  registerGetBuildDetails(server);
  registerListGalleryPhotos(server);
  registerSearchContent(server);
  registerGetTutorials(server);

  return server;
}
