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
