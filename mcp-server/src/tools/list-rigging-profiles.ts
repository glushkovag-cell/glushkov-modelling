import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { RiggingApiError, listRiggingProfiles } from "../lib/rigging-api.js";
import { siteOrigin } from "../lib/public-urls.js";

export function registerListRiggingProfiles(server: McpServer): void {
  server.registerTool(
      "list_rigging_profiles",
      {
        title: "List rigging calculation profiles",
        description:
            "Read-only. Lists the rigging calculation profiles of the rigging-diameter calculator (the same Cloudflare Worker used by the website tool /tools/rigging-diameters): " +
            "profile id, family, name, publication status, latest version and all versions. " +
            "Each profile describes a rigging tradition (for example traditional plant rigging of 1625-1860, Columbus-era early plant rigging, metal yacht rigging) with its own roles and coefficients. " +
            "Call this first to choose profileId, then get_rigging_profile to see which configuration blocks the profile supports, then calculate_rigging_diameters.",
        inputSchema: {},
      },
      async () => {
        try {
          const manifest = await listRiggingProfiles();
          return jsonResult({
            ...manifest,
            totalProfiles: manifest.profiles.length,
            calculatorUrl: `${siteOrigin()}/tools/rigging-diameters`,
          });
        } catch (error) {
          if (error instanceof RiggingApiError) {
            return errorResult(`Rigging calculator error (${error.code}): ${error.message}`);
          }
          return errorResult(`Error listing rigging profiles: ${(error as Error).message}`);
        }
      },
  );
}
