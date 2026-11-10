import { describe, expect, it } from "vitest";
import { ConfigurationError, buildRiggingInput, compactCalculation } from "./rigging-config.js";
import type { CalculationResponse, CalculationResultRow } from "./rigging-api.js";

const mm = (value: number) => ({ value });

describe("buildRiggingInput", () => {
  it("expands a mast with tiers, yards and sails in website order", () => {
    const input = buildRiggingInput({
      profileId: "early_plant",
      scaleDenominator: 65,
      masts: { main: { diameter: mm(8), topmast: true, yards: ["lower", "topmast"], squareSails: ["lower"] } },
    });

    expect(input.nodes.map((node) => node.nodeId)).toEqual([
      "mast.main.lower",
      "mast.main.topmast",
      "yard.main.lower",
      "yard.main.topmast",
    ]);
    expect(input.nodes.find((node) => node.nodeId === "yard.main.topmast")?.sailPresent).toBe(false);
    expect(input.measurements.mastDiameter.main).toEqual({
      value: 8,
      unitId: "mm",
      basis: "model",
      measurementPointId: "unknown",
    });
    expect(input.profileVersion).toBeNull();
  });

  it("drops topgallant nodes without a topmast", () => {
    const input = buildRiggingInput({
      profileId: "traditional_plant",
      scaleDenominator: 64,
      masts: { fore: { diameter: mm(9), topgallant: true, yards: ["topgallant"] } },
    });

    expect(input.nodes.map((node) => node.nodeId)).toEqual(["mast.fore.lower"]);
  });

  it("parents a gaff sail to the gaff on the same mast", () => {
    const input = buildRiggingInput({
      profileId: "yacht_metal_schooner",
      scaleDenominator: 64,
      masts: { main: { diameter: mm(8.73), sailNodes: ["gaff", "gaff_sail", "boom"] } },
    });

    const gaff = input.nodes.find((node) => node.nodeId === "gaff.main");
    const sail = input.nodes.find((node) => node.nodeId === "gaff_sail.main");
    const boom = input.nodes.find((node) => node.nodeId === "boom.main");
    expect(gaff?.sailPresent).toBe(true);
    expect(sail?.parentNodeId).toBe("gaff.main");
    expect(boom?.sailPresent).toBeUndefined();
  });

  it("ignores sails, gaff and lateen yard on an absent mast", () => {
    const input = buildRiggingInput({
      profileId: "traditional_plant",
      scaleDenominator: 64,
      masts: { fore: { diameter: mm(9) } },
      foreAndAftSails: [{ sailClass: "staysail_lower", supportingMastId: "main" }],
      gaff: { supportingMastId: "mizzen" },
      lateenYard: { supportingMastId: "mizzen" },
    });

    expect(input.nodes.map((node) => node.nodeId)).toEqual(["mast.fore.lower"]);
  });

  it("rejects a fore-and-aft sail class given twice", () => {
    expect(() =>
      buildRiggingInput({
        profileId: "traditional_plant",
        scaleDenominator: 64,
        masts: { fore: { diameter: mm(9) } },
        foreAndAftSails: [
          { sailClass: "head_lower", supportingMastId: "fore" },
          { sailClass: "head_lower", supportingMastId: "fore" },
        ],
      }),
    ).toThrow(ConfigurationError);
  });

  it("adds bowsprit parts, anchor, guns and their measurements", () => {
    const input = buildRiggingInput({
      profileId: "traditional_plant",
      scaleDenominator: 64,
      bowsprit: { diameter: { value: 8, measurementPointId: "working_section" }, flyingJibboom: true, spritsailYard: true },
      hullWidth: mm(150),
      anchor: {},
      gun: { bore: { value: 2, unitId: "mm" } },
    });

    expect(input.nodes.map((node) => node.nodeId)).toEqual(["bowsprit", "spritsail_yard", "anchor_group", "gun_group"]);
    expect(input.nodes.find((node) => node.nodeId === "anchor_group")?.anchorConnection).toBe("fiber");
    expect(input.nodes.find((node) => node.nodeId === "gun_group")).toMatchObject({
      gunType: "carriage_gun",
      mountingType: "wheeled",
    });
    expect(input.measurements.bowspritDiameter?.measurementPointId).toBe("working_section");
    expect(input.measurements.hullWidth?.value).toBe(150);
    expect(input.measurements.gunBore?.value).toBe(2);
  });
});

function row(overrides: Partial<CalculationResultRow>): CalculationResultRow {
  return {
    ownerType: "mast",
    ownerId: "main",
    nodeId: "mast.main.lower",
    ruleId: "st.lower.stay",
    ropeId: "st.lower.stay",
    role: "stay",
    segmentType: "rope",
    nameEn: "Lower stay",
    nameRu: "Нижний штаг",
    group: "standing",
    tier: "lower",
    status: "calculated",
    missingInputIds: [],
    diameterPrototypeMm: 81.2956,
    diameterModelMm: 1.2702440710351692,
    method: "proportional",
    calculationKind: "estimate",
    material: "fiber",
    coefficientBasis: "engineering_assumption",
    calibrationStatus: "not_calibrated",
    profileId: "traditional_plant",
    profileVersion: "1.1.0",
    schemaVersion: "1.0.0",
    sourceIds: ["FIT"],
    sourceLocator: "FIT: Part lists",
    measurementPointId: "partner",
    formula: "d = q × B_m",
    referenceLabel: "B_m",
    factorLabel: "0.166",
    trace: ["step"],
    warnings: ["Global warning", "Row note"],
    sortIndex: 0,
    ...overrides,
  };
}

const calculation: CalculationResponse = {
  apiVersion: "1",
  profileId: "traditional_plant",
  profileVersion: "1.1.0",
  profileStatus: "draft",
  schemaVersion: "1.0.0",
  algorithmVersion: "1.0.0",
  scaleDenominator: 64,
  normalizedMeasurements: [],
  results: [
    row({}),
    row({ nodeId: "anchor_group", ownerId: "anchor_group", group: "anchor", ruleId: "anchor.cable", ropeId: "anchor.cable", status: "needs_input", reasonCode: "measurement_required", missingInputIds: ["hull.width"], diameterModelMm: null, diameterPrototypeMm: null }),
    row({ nodeId: "yard.main.lower", ruleId: "rn.brace", ropeId: "rn.brace", group: "running", status: "not_applicable", reasonCode: "node_absent", diameterModelMm: null, diameterPrototypeMm: null }),
  ],
  sources: [{ id: "FIT", title: "Fit", locator: "x" }],
  warnings: ["Global warning"],
  validationErrors: [],
};

describe("compactCalculation", () => {
  it("returns a table without not_applicable rows by default", () => {
    const result = compactCalculation(calculation) as Record<string, any>;

    expect(result.summary).toEqual({ total: 3, calculated: 1, needs_input: 1, unsupported: 0, not_applicable: 1 });
    expect(result.returnedRows).toBe(2);
    expect(result.columns[8]).toBe("diameterModelMm");
    expect(result.rows[0][8]).toBe(1.27);
    expect(result.rows[0][9]).toBe(81.3);
    expect(result.notes).toEqual(["Row note"]);
    expect(result.rows[0][14]).toEqual([0]);
    expect(result.missingInputs).toEqual([
      { nodeId: "anchor_group", ruleId: "anchor.cable", missingInputIds: ["hull.width"] },
    ]);
  });

  it("filters by status, group and owner", () => {
    expect((compactCalculation(calculation, { statuses: ["not_applicable"] }) as any).returnedRows).toBe(1);
    expect((compactCalculation(calculation, { groups: ["anchor"] }) as any).returnedRows).toBe(1);
    expect((compactCalculation(calculation, { ownerIds: ["main"], includeNotApplicable: true }) as any).returnedRows).toBe(2);
  });

  it("keeps the unrounded diameter, locators and trace in full detail", () => {
    const result = compactCalculation(calculation, { detail: "full", includeTrace: true }) as Record<string, any>;

    expect(result.results[0].diameterModelMm).toBe(1.2702440710351692);
    expect(result.results[0].diameterModelMmRounded).toBe(1.27);
    expect(result.results[0].ropeId).toBeUndefined();
    expect(result.sourceLocators).toEqual(["FIT: Part lists"]);
    expect(result.results[0].sourceLocatorId).toBe(0);
    expect(result.results[0].trace).toEqual(["step"]);
  });
});
