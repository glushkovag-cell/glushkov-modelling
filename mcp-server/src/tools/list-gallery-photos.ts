import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult } from "../lib/tool-result.js";
// import { config } from "../lib/config.js";
// import { readFile } from "node:fs/promises";

const inputSchema = {
  project: z
    .string()
    .optional()
    .describe("Название проекта/постройки для фильтрации фото."),
  tag: z
    .string()
    .optional()
    .describe("Тег для фильтрации фото (например, 'armed-launch')."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .describe("Максимальное количество фото в ответе."),
};

/**
 * TODO(Этап 1): реализовать чтение и парсинг gallery-manifest.schema.json
 * (config.galleryManifestPath) с фильтрацией по project/tag.
 */
export function registerListGalleryPhotos(server: McpServer): void {
  server.registerTool(
    "list_gallery_photos",
    {
      title: "Фото из галереи",
      description:
        "Возвращает список фотографий из галереи сайта, с возможностью фильтрации " +
        "по проекту/постройке или тегу (например, armed-launch).",
      inputSchema,
    },
    async ({ project, tag, limit }) => {
      try {
        return errorResult(
          `list_gallery_photos пока не реализован (project=${project ?? "не задан"}, ` +
            `tag=${tag ?? "не задан"}, limit=${limit}).`,
        );
      } catch (error) {
        return errorResult(
          `Ошибка при получении фото галереи: ${(error as Error).message}`,
        );
      }
    },
  );
}
