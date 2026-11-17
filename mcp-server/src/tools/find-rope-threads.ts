import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { RopeApiError, findRopeThreads } from "../lib/rope-api.js";
import { loadGramsSchema, loadModeSchema, loadSelectionError } from "./rope-load-schema.js";

const inputSchema = {
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
          "Optional list of catalog thread ids to check, for example ['tera-40', 'tera-30']. Omit to check the whole active catalog.",
      ),
  loadMode: loadModeSchema,
  loadGrams: loadGramsSchema,
};

export function registerFindRopeThreads(server: McpServer): void {
  server.registerTool(
      "find_rope_threads",
      {
        title: "Find rope threads",
        description:
            "Read-only. Finds catalog thread constructions whose estimated rope diameter is within ±10% of a target diameter. " +
            "Use this tool when the user asks which threads to use for a rope of a given thickness. " +
            "It checks 1 to 5 threads per strand for every selected thread. Omit threadIds to search the whole active catalog, or pass thread ids to narrow the search. " +
            "Pass loadMode 'auto' to apply the recommended tension load to each construction separately, or 'manual' with loadGrams (30, 50, 100, 150, 200, 250 or 300) to apply one load to all candidates; the recommended load is a starting suggestion, not an experimentally established optimum. " +
            "Results are sorted by absolute deviation from the target, then dTex, then threads per strand, with a deterministic tie-break. " +
            "The response includes every match with its diameter (3 decimals) and deviation percent (2 decimals), the tolerance, and the catalog version; with loadMode each match also has totalDtex and recommended and applied loads, and the response has warnings. " +
            "An empty results array means no construction fits the ±10% tolerance; it is a successful answer, not an error. " +
            "Use calculate_rope_diameter to get the diameter for one specific thread.",
        inputSchema,
      },
      async ({ targetDiameterMm, threadIds, loadMode, loadGrams }) => {
        const loadError = loadSelectionError(loadMode, loadGrams);
        if (loadError) return errorResult(loadError);

        try {
          const result = await findRopeThreads({ targetDiameterMm, threadIds, loadMode, loadGrams });

          return jsonResult(result);
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
