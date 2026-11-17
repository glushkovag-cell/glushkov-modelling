import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, textAndStructuredResult } from "../lib/tool-result.js";
import { RopeApiError, calculateRope } from "../lib/rope-api.js";
import { calculateRopeText } from "../lib/rope-text.js";

/**
 * Схема строгая: неизвестные аргументы отклоняются валидацией, а не
 * отбрасываются молча. Это закрывает устаревшие поля нагрузки из снятого ТЗ —
 * `loadMode`, `loadGrams` и подобные приходят в Worker как 422 INVALID_PARAMS,
 * если клиент всё же попробует их отправить напрямую.
 */
const inputSchema = z
    .object({
  basis: z
      .enum(["catalog", "dtex"])
      .describe(
          "Source of the linear density. Use 'catalog' for a thread from the catalog, or 'dtex' for a custom value.",
      ),
  threadId: z
      .string()
      .min(1)
      .optional()
      .describe(
          "Catalog thread id, for example 'tera-40'. Required when basis is 'catalog'. Use find_rope_threads to see which thread ids match a target diameter.",
      ),
  dtex: z
      .number()
      .min(22.22)
      .max(6000)
      .optional()
      .describe(
          "Custom linear density in dTex, from 22.22 to 6000 inclusive. Required when basis is 'dtex'.",
      ),
  threadsPerStrand: z
      .number()
      .int()
      .min(1)
      .max(5)
      .describe(
          "Threads per strand: 1 to 5. All ropes have three strands, so 2 means the 2 × 3 construction.",
      ),
    })
    .strict();

export function registerCalculateRopeDiameter(server: McpServer): void {
  server.registerTool(
      "calculate_rope_diameter",
      {
        title: "Calculate rope diameter",
        description:
            "Read-only. Calculates the estimated diameter of a three-strand rope from a thread's linear density and the number of threads per strand. " +
            "Use this tool when the user asks how thick a rope made from a given thread will be, or what diameter a custom dTex produces. " +
            "Provide basis 'catalog' with threadId for a catalog thread, or basis 'dtex' with a value between 22.22 and 6000 for a custom thread. " +
            "threadsPerStrand is 1 to 5; because all ropes have three strands, 2 corresponds to the 2 × 3 construction. " +
            "The model does not use tension load: there are no load parameters and no load fields in the response. " +
            "Diameters are model estimates, not measured values; above 3000 dTex the result carries an EXTRAPOLATION warning. " +
            "The text response shows the diameter with three decimals, structuredContent carries the unrounded numbers plus API, algorithm, model and catalog versions. " +
            "Use find_rope_threads when the user wants threads for a target diameter instead.",
        inputSchema,
      },
      async ({ basis, threadId, dtex, threadsPerStrand }) => {
        if (basis === "catalog" && !threadId) {
          return errorResult("threadId is required when basis is 'catalog'.");
        }

        if (basis === "dtex" && dtex === undefined) {
          return errorResult("dtex is required when basis is 'dtex'.");
        }

        try {
          const result = await calculateRope({ basis, threadId, dtex, threadsPerStrand });

          return textAndStructuredResult(
            calculateRopeText(result),
            result as unknown as Record<string, unknown>,
          );
        } catch (error) {
          if (error instanceof RopeApiError) {
            return errorResult(`Rope calculator error (${error.code}): ${error.message}`);
          }

          return errorResult(
              `Error calculating rope diameter: ${(error as Error).message}`,
          );
        }
      },
  );
}
