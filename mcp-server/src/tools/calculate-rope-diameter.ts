import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import {
  ROPE_MAX_DTEX,
  ROPE_MIN_DTEX_V1,
  ROPE_MIN_DTEX_V2,
  RopeApiError,
  calculateRope,
} from "../lib/rope-api.js";
import { loadGramsSchema, loadModeSchema, loadSelectionError } from "./rope-load-schema.js";

const inputSchema = {
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
      .min(ROPE_MIN_DTEX_V2)
      .max(ROPE_MAX_DTEX)
      .optional()
      .describe(
          "Custom linear density in dTex. Required when basis is 'dtex'. From 20 to 6000 inclusive with loadMode; from 80 to 6000 without loadMode (legacy API v1).",
      ),
  threadsPerStrand: z
      .number()
      .int()
      .min(1)
      .max(5)
      .describe(
          "Threads per strand: 1 to 5. All ropes have three strands, so 2 means the 2 × 3 construction.",
      ),
  loadMode: loadModeSchema,
  loadGrams: loadGramsSchema,
};

export function registerCalculateRopeDiameter(server: McpServer): void {
  server.registerTool(
      "calculate_rope_diameter",
      {
        title: "Calculate rope diameter",
        description:
            "Read-only. Calculates the estimated diameter of a three-strand rope from a thread's linear density and the number of threads per strand. " +
            "Use this tool when the user asks how thick a rope made from a given thread will be, or what diameter a custom dTex produces. " +
            "Provide basis 'catalog' with threadId for a catalog thread, or basis 'dtex' with a custom value (20 to 6000 with loadMode, 80 to 6000 without). " +
            "threadsPerStrand is 1 to 5; because all ropes have three strands, 2 corresponds to the 2 × 3 construction. " +
            "Pass loadMode 'auto' to use the recommended tension load, or 'manual' with loadGrams (30, 50, 100, 150, 200, 250 or 300) to use a chosen load; the recommended load is a starting suggestion, not an experimentally established optimum. " +
            "Diameters are empirical model estimates, not measured values. The response includes the diameter in millimetres rounded to 3 decimals, the construction label, the resolved dTex, and API, algorithm and catalog versions; " +
            "with loadMode it also includes totalDtex, loadMode, recommendedLoadGrams, appliedLoadGrams, loadRecommendationVersion and warnings. " +
            "Use find_rope_threads when the user wants threads for a target diameter instead.",
        inputSchema,
      },
      async ({ basis, threadId, dtex, threadsPerStrand, loadMode, loadGrams }) => {
        if (basis === "catalog" && !threadId) {
          return errorResult("threadId is required when basis is 'catalog'.");
        }

        if (basis === "dtex" && dtex === undefined) {
          return errorResult("dtex is required when basis is 'dtex'.");
        }

        if (basis === "dtex" && dtex !== undefined && loadMode === undefined && dtex < ROPE_MIN_DTEX_V1) {
          return errorResult(
              `dtex must be at least ${ROPE_MIN_DTEX_V1} without loadMode; pass loadMode to use values from ${ROPE_MIN_DTEX_V2}.`,
          );
        }

        const loadError = loadSelectionError(loadMode, loadGrams);
        if (loadError) return errorResult(loadError);

        try {
          const result = await calculateRope({ basis, threadId, dtex, threadsPerStrand, loadMode, loadGrams });

          return jsonResult(result);
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
