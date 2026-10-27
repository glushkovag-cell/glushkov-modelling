import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { RopeApiError, calculateRope } from "../lib/rope-api.js";

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
      .min(80)
      .max(6000)
      .optional()
      .describe(
          "Custom linear density in dTex, from 80 to 6000 inclusive. Required when basis is 'dtex'.",
      ),
  threadsPerStrand: z
      .number()
      .int()
      .min(1)
      .max(3)
      .describe(
          "Threads per strand: 1, 2 or 3. All ropes have three strands, so 2 means the 2 × 3 construction.",
      ),
};

export function registerCalculateRopeDiameter(server: McpServer): void {
  server.registerTool(
      "calculate_rope_diameter",
      {
        title: "Calculate rope diameter",
        description:
            "Read-only. Calculates the estimated diameter of a three-strand rope from a thread's linear density and the number of threads per strand. " +
            "Use this tool when the user asks how thick a rope made from a given thread will be, or what diameter a custom dTex produces. " +
            "Provide basis 'catalog' with threadId for a catalog thread, or basis 'dtex' with a value between 80 and 6000 for a custom thread. " +
            "threadsPerStrand is 1, 2 or 3; because all ropes have three strands, 2 corresponds to the 2 × 3 construction. " +
            "Diameters are model estimates, not measured values. The response includes the diameter in millimetres, the construction label, the resolved dTex, and API, algorithm and catalog versions. " +
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
