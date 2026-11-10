import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "../lib/tool-result.js";
import { RiggingApiError, getRiggingProfileDocument } from "../lib/rigging-api.js";
import { exampleConfiguration, supportedBlocks } from "../lib/rigging-config.js";

const inputSchema = {
  profileId: z
      .string()
      .min(1)
      .describe("Profile id from list_rigging_profiles, for example 'traditional_plant' or 'early_plant'."),
  profileVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .optional()
      .describe("Exact profile version, for example '1.1.0'. Omit for the latest version."),
  includeRules: z
      .boolean()
      .optional()
      .describe("Include the list of rope roles defined by the profile (rule id, names, group, node type, tier). Default false."),
};

export function registerGetRiggingProfile(server: McpServer): void {
  server.registerTool(
      "get_rigging_profile",
      {
        title: "Get rigging calculation profile",
        description:
            "Read-only. Returns one rigging calculation profile: metadata, period, materials, warnings, accuracy metrics, sources, the configuration blocks it supports " +
            "(masts and tiers, yards, square sails, per-mast sail nodes, fore-and-aft sails, gaff, lateen yard, bowsprit parts, anchor, guns, hull group, expected measurement points) " +
            "and exampleConfiguration — the demonstration configuration the website form shows for this profile, ready to pass to calculate_rigging_diameters after replacing the demo sizes with the user's model dimensions. " +
            "Demonstration sizes are not historical data. Set includeRules to list the rope roles the profile can calculate.",
        inputSchema,
      },
      async ({ profileId, profileVersion, includeRules }) => {
        try {
          const document = await getRiggingProfileDocument(profileId, profileVersion);
          if (!document) {
            return errorResult(
                `Rigging profile not found: ${profileId}${profileVersion ? `@${profileVersion}` : ""}. Use list_rigging_profiles to see available profiles and versions.`,
            );
          }

          const { profile, rules } = document;
          return jsonResult({
            profileId: profile.profileId,
            profileVersion: profile.profileVersion,
            schemaVersion: profile.schemaVersion,
            family: profile.family,
            name: profile.name,
            status: profile.status,
            yearFrom: profile.yearFrom ?? null,
            yearTo: profile.yearTo ?? null,
            materialConditions: profile.materialConditions ?? [],
            warnings: profile.warnings ?? [],
            metrics: profile.metrics ?? null,
            sources: profile.sources ?? [],
            totalRules: rules.length,
            supportedBlocks: supportedBlocks(profile.ui),
            demoDefaults: profile.ui.defaults ?? {},
            exampleConfiguration: exampleConfiguration(profile.profileId, profile.profileVersion, profile.ui),
            ...(includeRules
              ? {
                  rules: rules.map((rule) => ({
                    ruleId: rule.ruleId,
                    role: rule.role,
                    nameEn: rule.name.en,
                    nameRu: rule.name.ru,
                    group: rule.group,
                    nodeType: rule.select.nodeType,
                    tier: rule.select.tier ?? null,
                    sailClass: rule.select.sailClass ?? null,
                    material: rule.material ?? rule.materials?.[0] ?? null,
                    coefficientBasis: rule.coefficientBasis ?? null,
                    calibrationStatus: rule.calibrationStatus ?? null,
                  })),
                }
              : {}),
          });
        } catch (error) {
          if (error instanceof RiggingApiError) {
            return errorResult(`Rigging calculator error (${error.code}): ${error.message}`);
          }
          return errorResult(`Error reading rigging profile: ${(error as Error).message}`);
        }
      },
  );
}
