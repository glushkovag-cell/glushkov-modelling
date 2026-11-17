import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Единый формат успешного текстового ответа инструмента (JSON внутри text-блока). */
export function jsonResult(data: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * Ответ инструмента с текстом для человека и полными данными без округления.
 *
 * `structuredContent` — источник числового паритета с HTTP API; текст может
 * показывать диаметр с тремя знаками, но не заменяет числа.
 */
export function textAndStructuredResult(
  text: string,
  structuredContent: Record<string, unknown>,
): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    structuredContent,
  };
}

/** Единый формат ошибки инструмента — isError: true, чтобы клиент/модель отличала сбой от данных. */
export function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: message,
      },
    ],
  };
}
