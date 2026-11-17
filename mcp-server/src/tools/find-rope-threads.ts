import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, textAndStructuredResult } from "../lib/tool-result.js";
import { RopeApiError, findRopeThreads } from "../lib/rope-api.js";
import { findRopeThreadsText } from "../lib/rope-text.js";

/** Строгая схема: неизвестные аргументы, включая устаревшие поля нагрузки, отклоняются. */
const inputSchema = z
    .object({
  targetDiameterMm: z
      .number()
      .positive()
      .describe(
          "Target rope diameter in millimetres, greater than zero. Matches within ±10% of this value are returned.",
      ),
  threadIds: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe(
          "Optional list of catalog thread ids to check, for example ['tera-40', 'tera-30']. Omit to check the whole active catalog. An empty array is rejected rather than treated as the whole catalog.",
      ),
    })
    .strict();

export function registerFindRopeThreads(server: McpServer): void {
  server.registerTool(
      "find_rope_threads",
      {
        title: "Find rope threads",
        description:
            "Read-only. Finds catalog thread constructions whose estimated rope diameter is within ±10% of a target diameter. " +
            "Use this tool when the user asks which threads to use for a rope of a given thickness. " +
            "It checks 1, 2, 3, 4 and 5 threads per strand for every selected thread. Omit threadIds to search the whole active catalog, or pass thread ids to narrow the search. " +
            "Results are sorted by absolute deviation from the target, then dTex, then threads per strand, with a deterministic tie-break. " +
            "The ±10% window is a search tolerance, not an accuracy claim of the model. " +
            "The response includes every match with its diameter and deviation percent, the tolerance, the model and catalog versions, and any warnings such as EXTRAPOLATION. " +
            "An empty results array means no construction fits the ±10% tolerance; it is a successful answer, not an error. " +
            "Use calculate_rope_diameter to get the diameter for one specific thread.",
        inputSchema,
      },
      async ({ targetDiameterMm, threadIds }) => {
        try {
          const result = await findRopeThreads({ targetDiameterMm, threadIds });

          return textAndStructuredResult(
            findRopeThreadsText(result),
            result as unknown as Record<string, unknown>,
          );
        } catch (error) {
          if (error instanceof RopeApiError) {
            return errorResult(`Rope calculator error (${error.code}): ${error.message}`);
          }

          return errorResult(
              `Error finding rope threads: ${(error as Error).message}`,
          );
        }
      },
  );
}
