import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult } from "../lib/tool-result.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { RiggingApiError, calculateRigging } from "../lib/rigging-api.js";
import {
  ConfigurationError,
  SAIL_CLASSES,
  SAIL_NODE_KINDS,
  TIERS,
  buildRiggingInput,
  compactCalculation,
  type ShipConfiguration,
} from "../lib/rigging-config.js";
import { siteOrigin } from "../lib/public-urls.js";

const mastId = z.enum(["fore", "main", "mizzen"]);
const tier = z.enum(TIERS as unknown as [string, ...string[]]);

const measurementSchema = z
    .object({
      value: z.number().positive().describe("Measured size, greater than zero."),
      unitId: z.enum(["mm", "cm", "in"]).optional().describe("Unit. Default 'mm'."),
      basis: z
          .enum(["model", "prototype"])
          .optional()
          .describe("'model' — measured on the model (default); 'prototype' — full-size ship value."),
      measurementPointId: z
          .enum(["partner", "maximum", "working_section", "step", "unknown"])
          .optional()
          .describe("Where the diameter was measured. Default 'unknown'. 'step' is a flagged proxy, not interchangeable with 'partner'."),
    })
    .strict();

const mastSchema = z
    .object({
      diameter: measurementSchema.describe("Lower-mast diameter."),
      topmast: z.boolean().optional().describe("Topmast is fitted. Default false."),
      topgallant: z.boolean().optional().describe("Topgallant mast is fitted (requires topmast). Default false."),
      yards: z.array(tier).optional().describe("Tiers that carry a yard: 'lower', 'topmast', 'topgallant'."),
      squareSails: z.array(tier).optional().describe("Tiers whose yard carries a bent square sail."),
      sailNodes: z
          .array(z.enum(SAIL_NODE_KINDS as unknown as [string, ...string[]]))
          .optional()
          .describe("Per-mast yacht/gaff rig nodes on this mast: main_sail, gaff, gaff_sail, boom, topsail, head_lower, head_upper, staysail, flag. Use only kinds listed in supportedBlocks.perMastSailNodes."),
    })
    .strict();

const inputSchema = {
  profileId: z.string().min(1).describe("Profile id from list_rigging_profiles. Required; it is never substituted."),
  profileVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .optional()
      .describe("Pin a profile version, for example '1.1.0'. Omit for the latest."),
  scaleDenominator: z.number().positive().describe("Model scale denominator S for 1:S, for example 64 for 1:64."),
  masts: z
      .object({ fore: mastSchema.optional(), main: mastSchema.optional(), mizzen: mastSchema.optional() })
      .strict()
      .optional()
      .describe("Masts present on the model. An omitted mast is absent together with its tiers, yards and sails."),
  foreAndAftSails: z
      .array(
          z.object({
            sailClass: z.enum(SAIL_CLASSES as unknown as [string, ...string[]]),
            supportingMastId: mastId,
          }).strict(),
      )
      .optional()
      .describe("Fore-and-aft sail classes (head_lower, head_upper, staysail_lower, staysail_upper) with the mast that supports them; each class at most once."),
  gaff: z
      .object({ supportingMastId: mastId, sailPresent: z.boolean().optional() })
      .strict()
      .optional()
      .describe("Single gaff (profiles where supportedBlocks.singleGaff is true), with its mast; sailPresent defaults to true."),
  lateenYard: z
      .object({ supportingMastId: mastId, sailPresent: z.boolean().optional() })
      .strict()
      .optional()
      .describe("Lateen yard and its mast; sailPresent defaults to true."),
  bowsprit: z
      .object({
        diameter: measurementSchema.describe("Bowsprit diameter."),
        jibboom: z.boolean().optional(),
        flyingJibboom: z.boolean().optional().describe("Requires jibboom."),
        martingale: z.boolean().optional(),
        spritsailYard: z.boolean().optional(),
        spritsailSail: z.boolean().optional().describe("Sail bent to the spritsail yard."),
      })
      .strict()
      .optional()
      .describe("Bowsprit and its parts. Omit if the model has no bowsprit."),
  hullGroup: z.boolean().optional().describe("Include the hull rope group (profiles with supportedBlocks.hullGroup)."),
  hullWidth: measurementSchema.optional().describe("Hull width — the base for anchor ropes; required when anchor is set."),
  anchor: z
      .object({ connection: z.enum(["fiber", "chain"]).optional().describe("Anchor connection. Default 'fiber'.") })
      .strict()
      .optional()
      .describe("Anchor group is present."),
  gun: z
      .object({
        gunType: z.enum(["carriage_gun", "carronade", "unknown"]).optional(),
        mountingType: z.enum(["wheeled", "slide_pivot", "unknown"]).optional(),
        bore: measurementSchema.describe("Gun bore (calibre)."),
      })
      .strict()
      .optional()
      .describe("Gun group (breeching and tackles) is present."),
  includeNotApplicable: z
      .boolean()
      .optional()
      .describe("Return rows with status 'not_applicable' too (the website hides them by default). Default false."),
  statuses: z
      .array(z.enum(["calculated", "needs_input", "unsupported", "not_applicable"]))
      .optional()
      .describe("Return only rows with these statuses; overrides includeNotApplicable."),
  groups: z
      .array(z.enum(["standing", "running", "bowsprit", "anchor", "gun"]))
      .optional()
      .describe("Return only rows of these result groups."),
  ownerIds: z
      .array(z.string().min(1))
      .optional()
      .describe("Return only rows of these owners: 'fore', 'main', 'mizzen', 'bowsprit', 'hull', 'anchor_group', 'gun_group'."),
  detail: z
      .enum(["table", "full"])
      .optional()
      .describe("'table' (default): compact table — columns plus row arrays, model diameter rounded to 0.01 mm as on the website. 'full': one object per row with the unrounded diameter, source locator ids and alternative/variant markers."),
  includeTrace: z
      .boolean()
      .optional()
      .describe("Add measurement point, formula, reference and factor labels and the calculation trace to each row; implies detail 'full'. Default false."),
};

function compactJsonResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export function registerCalculateRiggingDiameters(server: McpServer): void {
  server.registerTool(
      "calculate_rigging_diameters",
      {
        title: "Calculate rigging rope diameters",
        description:
            "Read-only. Estimates rope diameters for the standing and running rigging, bowsprit, anchor and gun ropes of a static scale ship model, using the same calculation core (Cloudflare Worker) as the website tool /tools/rigging-diameters. " +
            "Describe the model: profileId, scale (1:S), masts present with lower-mast diameters and their tiers, yards and sails, bowsprit and its parts, anchor, guns. Omitted blocks mean the node is absent. " +
            "Tip: call get_rigging_profile and start from its exampleConfiguration, replacing demo sizes with the user's measurements. " +
            "By default the answer is a table (columns + rows): each row has node, group, tier, rule id, English and Russian rope names, status (calculated, needs_input, unsupported, not_applicable), model diameter in mm rounded to 0.01 as on the website, prototype diameter, material, coefficient basis, calibration status, source ids and noteIds pointing into the top-level notes array. " +
            "detail 'full' returns objects with the unrounded diameter and source locators. " +
            "A fully rigged ship returns hundreds of rows: use ownerIds, groups or statuses to narrow the answer. " +
            "Values are engineering estimates for static models, not strength calculations; quote the profile warnings when presenting them. Domain problems (invalid scale, duplicate nodes) are returned in validationErrors. " +
            "To pick a thread for a resulting diameter use find_rope_threads.",
        inputSchema,
      },
      async (args) => {
        const { includeNotApplicable, statuses, groups, ownerIds, detail, includeTrace, ...configuration } = args;

        try {
          const input = buildRiggingInput(configuration as ShipConfiguration);
          const calculation = await calculateRigging(input);
          // Без отступов: полный парусник — сотни строк, отступы удваивают объём.
          return compactJsonResult({
            ...compactCalculation(calculation, {
              includeNotApplicable,
              statuses,
              groups,
              ownerIds,
              detail: includeTrace ? "full" : detail,
              includeTrace,
            }),
            calculatorUrl: `${siteOrigin()}/tools/rigging-diameters`,
          });
        } catch (error) {
          if (error instanceof ConfigurationError) {
            return errorResult(`Invalid rigging configuration: ${error.message}`);
          }
          if (error instanceof RiggingApiError) {
            const fields = error.fields.length > 0 ? ` Fields: ${error.fields.join(", ")}.` : "";
            return errorResult(`Rigging calculator error (${error.code}): ${error.message}${fields}`);
          }
          return errorResult(`Error calculating rigging diameters: ${(error as Error).message}`);
        }
      },
  );
}
