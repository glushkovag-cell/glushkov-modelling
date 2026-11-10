/**
 * Компактная конфигурация судна для MCP-инструмента калькулятора толщин
 * такелажа и её развёртывание в RiggingInput Worker'а.
 *
 * Worker (rigging-calculator-worker) принимает уже развёрнутый список узлов.
 * На сайте его строит src/lib/rigging/settings.ts → buildNodes(); здесь та же
 * схема узлов, но вход описан так, чтобы модели было удобно его заполнять:
 * отсутствующий блок = отсутствующий узел. Формул тут нет — расчёт выполняет
 * только Worker. Совпадение узлов с сайтом проверяет test/rigging-parity.test.ts.
 */

import type { CalculationResponse, CalculationResultRow, ProfileUi } from "./rigging-api.js";

export type MastId = "fore" | "main" | "mizzen";
export const MAST_IDS: readonly MastId[] = ["fore", "main", "mizzen"];

export type Tier = "lower" | "topmast" | "topgallant";
export const TIERS: readonly Tier[] = ["lower", "topmast", "topgallant"];

export type SailClass = "head_lower" | "head_upper" | "staysail_lower" | "staysail_upper";
export const SAIL_CLASSES: readonly SailClass[] = [
  "head_lower",
  "head_upper",
  "staysail_lower",
  "staysail_upper",
];

/** Узлы яхтенного и гафельного вооружения, задаваемые по мачтам (как на сайте). */
export type SailNodeKind =
  | "main_sail"
  | "gaff"
  | "gaff_sail"
  | "boom"
  | "topsail"
  | "head_lower"
  | "head_upper"
  | "staysail"
  | "flag";

export const SAIL_NODE_KINDS: readonly SailNodeKind[] = [
  "main_sail",
  "gaff",
  "gaff_sail",
  "boom",
  "topsail",
  "head_lower",
  "head_upper",
  "staysail",
  "flag",
];

export type UnitId = "mm" | "cm" | "in";
export type Basis = "model" | "prototype";
export type MeasurementPointId = "partner" | "maximum" | "working_section" | "step" | "unknown";
export type GunType = "carriage_gun" | "carronade" | "unknown";
export type MountingType = "wheeled" | "slide_pivot" | "unknown";
export type AnchorConnection = "fiber" | "chain";

export interface Measurement {
  value: number | null;
  unitId: UnitId;
  basis: Basis;
  measurementPointId: MeasurementPointId;
}

export interface RiggingNode {
  nodeId: string;
  nodeType: string;
  parentNodeId: string | null;
  ownerType: "mast" | "bowsprit" | "hull" | "anchor_group" | "gun_group";
  ownerId: string;
  present: boolean | null;
  sailPresent?: boolean | null;
  tier?: Tier;
  sailClass?: SailClass;
  supportingMastId?: MastId | null;
  gunType?: GunType;
  mountingType?: MountingType;
  anchorConnection?: AnchorConnection;
}

export interface RiggingInput {
  profileId: string;
  profileVersion?: string | null;
  scaleDenominator: number;
  measurements: {
    mastDiameter: Partial<Record<MastId, Measurement>>;
    bowspritDiameter?: Measurement | null;
    hullWidth?: Measurement | null;
    gunBore?: Measurement | null;
  };
  nodes: RiggingNode[];
}

// ---------------------------------------------------------------------------
// Вход MCP-инструмента
// ---------------------------------------------------------------------------

export interface MeasurementInput {
  value: number;
  unitId?: UnitId;
  basis?: Basis;
  measurementPointId?: MeasurementPointId;
}

export interface MastConfig {
  diameter: MeasurementInput;
  topmast?: boolean;
  topgallant?: boolean;
  /** Ярусы, на которых есть реи. */
  yards?: Tier[];
  /** Ярусы, на реях которых привязан прямой парус. */
  squareSails?: Tier[];
  /** Узлы яхтенного/гафельного вооружения на этой мачте. */
  sailNodes?: SailNodeKind[];
}

export interface ShipConfiguration {
  profileId: string;
  profileVersion?: string | null;
  scaleDenominator: number;
  masts?: Partial<Record<MastId, MastConfig>>;
  foreAndAftSails?: Array<{ sailClass: SailClass; supportingMastId: MastId }>;
  gaff?: { supportingMastId: MastId; sailPresent?: boolean };
  lateenYard?: { supportingMastId: MastId; sailPresent?: boolean };
  bowsprit?: {
    diameter: MeasurementInput;
    jibboom?: boolean;
    flyingJibboom?: boolean;
    martingale?: boolean;
    spritsailYard?: boolean;
    spritsailSail?: boolean;
  };
  hullGroup?: boolean;
  hullWidth?: MeasurementInput;
  anchor?: { connection?: AnchorConnection };
  gun?: { gunType?: GunType; mountingType?: MountingType; bore: MeasurementInput };
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

function measurement(input: MeasurementInput): Measurement {
  return {
    value: input.value,
    unitId: input.unitId ?? "mm",
    basis: input.basis ?? "model",
    measurementPointId: input.measurementPointId ?? "unknown",
  };
}

function node(
  nodeId: string,
  nodeType: string,
  parentNodeId: string | null,
  ownerType: RiggingNode["ownerType"],
  ownerId: string,
  present: boolean | null,
  extra: Partial<RiggingNode> = {},
): RiggingNode {
  return { nodeId, nodeType, parentNodeId, ownerType, ownerId, present, ...extra };
}

/**
 * Разворачивает компактную конфигурацию в RiggingInput. Порядок и форма узлов
 * повторяют buildNodes() сайта: отсутствие мачты гасит её ярусы, реи, паруса и
 * зависимые узлы, а не «молча» рассчитывает их.
 */
export function buildRiggingInput(config: ShipConfiguration): RiggingInput {
  const masts = config.masts ?? {};
  const nodes: RiggingNode[] = [];
  const mastPresent = (mastId: MastId): boolean => masts[mastId] !== undefined;

  const foreAndAft = new Map<SailClass, MastId>();
  for (const sail of config.foreAndAftSails ?? []) {
    if (foreAndAft.has(sail.sailClass)) {
      throw new ConfigurationError(
        `foreAndAftSails contains ${sail.sailClass} more than once; each sail class can be set once.`,
      );
    }
    foreAndAft.set(sail.sailClass, sail.supportingMastId);
  }

  for (const mastId of MAST_IDS) {
    const mast = masts[mastId];
    if (!mast) continue;

    const yards = new Set(mast.yards ?? []);
    const squareSails = new Set(mast.squareSails ?? []);
    const sailNodes = new Set(mast.sailNodes ?? []);

    const lowerId = `mast.${mastId}.lower`;
    const topmastId = `mast.${mastId}.topmast`;
    const topgallantId = `mast.${mastId}.topgallant`;

    nodes.push(node(lowerId, "lower_mast", null, "mast", mastId, true));

    const topmastPresent = mast.topmast === true;
    if (topmastPresent) {
      nodes.push(node(topmastId, "topmast", lowerId, "mast", mastId, true));
    }

    const topgallantPresent = topmastPresent && mast.topgallant === true;
    if (topgallantPresent) {
      nodes.push(node(topgallantId, "topgallant", topmastId, "mast", mastId, true));
    }

    for (const tier of TIERS) {
      if (tier === "topmast" && !topmastPresent) continue;
      if (tier === "topgallant" && !topgallantPresent) continue;
      if (!yards.has(tier)) continue;

      const tierId = tier === "lower" ? lowerId : tier === "topmast" ? topmastId : topgallantId;
      nodes.push(
        node(`yard.${mastId}.${tier}`, "yard", tierId, "mast", mastId, true, {
          tier,
          sailPresent: squareSails.has(tier),
        }),
      );
    }

    for (const kind of SAIL_NODE_KINDS) {
      if (!sailNodes.has(kind)) continue;
      if (kind === "topsail" && !topmastPresent) continue;

      const parentId =
        kind === "topsail"
          ? topmastId
          : kind === "gaff_sail" && sailNodes.has("gaff")
            ? `gaff.${mastId}`
            : lowerId;

      let sailPresent: boolean | undefined;
      if (kind === "gaff") {
        // Гафель несёт признак «парус привязан»; сам парус — узел gaff_sail.
        sailPresent = sailNodes.has("gaff_sail");
      } else if (kind !== "boom" && kind !== "flag") {
        sailPresent = true;
      }

      nodes.push(
        node(kind === "gaff" ? `gaff.${mastId}` : `${kind}.${mastId}`, kind, parentId, "mast", mastId, true, {
          supportingMastId: mastId,
          ...(sailPresent === undefined ? {} : { sailPresent }),
        }),
      );
    }
  }

  for (const sailClass of SAIL_CLASSES) {
    const supportingMastId = foreAndAft.get(sailClass);
    if (!supportingMastId || !mastPresent(supportingMastId)) continue;

    nodes.push(
      node(
        `sail.${sailClass}.${supportingMastId}`,
        "fore_and_aft_sail",
        `mast.${supportingMastId}.lower`,
        "mast",
        supportingMastId,
        true,
        { sailClass, supportingMastId },
      ),
    );
  }

  if (config.gaff && mastPresent(config.gaff.supportingMastId)) {
    const mastId = config.gaff.supportingMastId;
    if (!nodes.some((entry) => entry.nodeId === `gaff.${mastId}`)) {
      nodes.push(
        node(`gaff.${mastId}`, "gaff", `mast.${mastId}.lower`, "mast", mastId, true, {
          sailPresent: config.gaff.sailPresent ?? true,
          supportingMastId: mastId,
        }),
      );
    }
  }

  if (config.lateenYard && mastPresent(config.lateenYard.supportingMastId)) {
    const mastId = config.lateenYard.supportingMastId;
    nodes.push(
      node("lateen_yard", "lateen_yard", `mast.${mastId}.lower`, "mast", mastId, true, {
        sailPresent: config.lateenYard.sailPresent ?? true,
        supportingMastId: mastId,
      }),
    );
  }

  const spar = config.bowsprit;
  if (spar) {
    nodes.push(node("bowsprit", "bowsprit", null, "bowsprit", "bowsprit", true));

    if (spar.jibboom) {
      nodes.push(node("jibboom", "jibboom", "bowsprit", "bowsprit", "bowsprit", true));
    }
    if (spar.jibboom && spar.flyingJibboom) {
      nodes.push(node("flying_jibboom", "flying_jibboom", "jibboom", "bowsprit", "bowsprit", true));
    }
    if (spar.martingale) {
      nodes.push(node("martingale", "martingale", "bowsprit", "bowsprit", "bowsprit", true));
    }
    if (spar.spritsailYard) {
      nodes.push(
        node("spritsail_yard", "spritsail_yard", "bowsprit", "bowsprit", "bowsprit", true, {
          sailPresent: spar.spritsailSail === true,
        }),
      );
    }
  }

  if (config.hullGroup) {
    nodes.push(node("hull_group", "hull_group", null, "hull", "hull", true));
  }

  if (config.anchor) {
    nodes.push(
      node("anchor_group", "anchor_group", null, "anchor_group", "anchor_group", true, {
        anchorConnection: config.anchor.connection ?? "fiber",
      }),
    );
  }

  if (config.gun) {
    nodes.push(
      node("gun_group", "gun_group", null, "gun_group", "gun_group", true, {
        gunType: config.gun.gunType ?? "carriage_gun",
        mountingType: config.gun.mountingType ?? "wheeled",
      }),
    );
  }

  const mastDiameter: Partial<Record<MastId, Measurement>> = {};
  for (const mastId of MAST_IDS) {
    const mast = masts[mastId];
    if (mast) mastDiameter[mastId] = measurement(mast.diameter);
  }

  const measurements: RiggingInput["measurements"] = { mastDiameter };
  if (spar) measurements.bowspritDiameter = measurement(spar.diameter);
  if (config.hullWidth) measurements.hullWidth = measurement(config.hullWidth);
  if (config.gun) measurements.gunBore = measurement(config.gun.bore);

  return {
    profileId: config.profileId,
    profileVersion: config.profileVersion ?? null,
    scaleDenominator: config.scaleDenominator,
    measurements,
    nodes,
  };
}

// ---------------------------------------------------------------------------
// Пример конфигурации профиля (как форма сайта при выборе профиля)
// ---------------------------------------------------------------------------

const FALLBACK_MAST_MM: Record<MastId, number> = { fore: 9, main: 10, mizzen: 7 };

/**
 * Демонстрационная конфигурация профиля — то, что показывает форма сайта сразу
 * после выбора профиля (defaultSettingsForProfile). Размеры — демонстрационные
 * размеры модели, а не историческая ведомость.
 */
export function exampleConfiguration(
  profileId: string,
  profileVersion: string,
  ui: ProfileUi,
): ShipConfiguration {
  const defaults = ui.defaults ?? {};
  const config: ShipConfiguration = {
    profileId,
    profileVersion,
    scaleDenominator: defaults.scaleDenominator ?? 64,
  };

  const gaffPerMast = ui.gaffSail;
  const tierUsed = (tier: Tier): boolean => ui.tiers.includes(tier);

  if (ui.masts) {
    config.masts = {};
    for (const mastId of MAST_IDS) {
      const value = defaults.mastDiameterMm?.[mastId];
      const sailNodes = SAIL_NODE_KINDS.filter((kind) => {
        switch (kind) {
          case "main_sail": return ui.mainSail;
          case "gaff": return ui.gaff && gaffPerMast;
          case "gaff_sail": return ui.gaffSail;
          case "boom": return ui.boom;
          case "topsail": return ui.topsail;
          case "head_lower":
          case "head_upper": return ui.headSails && mastId === "fore";
          case "staysail": return ui.staysail && mastId === "mizzen";
          case "flag": return ui.flag;
          default: return false;
        }
      });

      config.masts[mastId] = {
        diameter: {
          value: value ?? FALLBACK_MAST_MM[mastId],
          unitId: "mm",
          basis: "model",
          // На сайте точка всегда берётся из ui.mastPoint (по умолчанию partner).
          measurementPointId: ui.mastPoint as MeasurementPointId,
        },
        topmast: tierUsed("topmast"),
        topgallant: tierUsed("topgallant"),
        yards: ui.yards ? TIERS.filter(tierUsed) : [],
        squareSails: ui.squareSails ? TIERS.filter(tierUsed) : [],
        sailNodes,
      };
    }
  }

  const foreAndAft = SAIL_CLASSES.filter((sailClass) => ui.foreAndAft.includes(sailClass));
  if (foreAndAft.length > 0) {
    config.foreAndAftSails = foreAndAft.map((sailClass) => ({ sailClass, supportingMastId: "fore" as MastId }));
  }

  if (ui.gaff && !ui.gaffSail) {
    config.gaff = { supportingMastId: "mizzen", sailPresent: true };
  }

  if (ui.lateenYard) {
    config.lateenYard = { supportingMastId: "mizzen", sailPresent: true };
  }

  if (ui.bowsprit) {
    const value = defaults.bowspritDiameterMm;
    config.bowsprit = {
      diameter: {
        value: value ?? 8,
        unitId: "mm",
        basis: "model",
        measurementPointId: value !== undefined ? (ui.bowspritPoint as MeasurementPointId) : "working_section",
      },
      jibboom: ui.jibboom,
      flyingJibboom: ui.jibboom,
      martingale: ui.martingale,
      spritsailYard: ui.spritsaill,
      spritsailSail: ui.spritsaill,
    };
  }

  if (ui.hullGroup) config.hullGroup = true;

  const anchorPresent = ui.anchor && (defaults.anchor ?? true);
  if (anchorPresent) {
    config.anchor = { connection: "fiber" };
    config.hullWidth = {
      value: defaults.hullWidthMm ?? 150,
      unitId: "mm",
      basis: "model",
      measurementPointId: "unknown",
    };
  }

  if (ui.gun) {
    config.gun = {
      gunType: "carriage_gun",
      mountingType: "wheeled",
      bore: {
        value: defaults.gunBoreMm ?? 2,
        unitId: "mm",
        basis: "model",
        measurementPointId: "working_section",
      },
    };
  }

  return config;
}

/** Блоки конфигурации, которые профиль поддерживает (подсказка формы сайта). */
export function supportedBlocks(ui: ProfileUi): Record<string, unknown> {
  const perMastSailNodes = SAIL_NODE_KINDS.filter((kind) => {
    switch (kind) {
      case "main_sail": return ui.mainSail;
      case "gaff": return ui.gaff && ui.gaffSail;
      case "gaff_sail": return ui.gaffSail;
      case "boom": return ui.boom;
      case "topsail": return ui.topsail;
      case "head_lower":
      case "head_upper": return ui.headSails;
      case "staysail": return ui.staysail;
      case "flag": return ui.flag;
      default: return false;
    }
  });

  return {
    masts: ui.masts,
    tiers: ui.tiers,
    yards: ui.yards,
    squareSails: ui.squareSails,
    perMastSailNodes,
    foreAndAftSails: ui.foreAndAft,
    singleGaff: ui.gaff && !ui.gaffSail,
    lateenYard: ui.lateenYard,
    bowsprit: ui.bowsprit,
    jibboom: ui.jibboom,
    martingale: ui.martingale,
    spritsail: ui.spritsaill,
    hullGroup: ui.hullGroup,
    anchor: ui.anchor,
    gun: ui.gun,
    mastMeasurementPoint: ui.mastPoint,
    bowspritMeasurementPoint: ui.bowspritPoint,
  };
}

// ---------------------------------------------------------------------------
// Компактное представление результата Worker'а
// ---------------------------------------------------------------------------

export type ResultStatus = CalculationResultRow["status"];

export interface CompactOptions {
  includeNotApplicable?: boolean;
  includeTrace?: boolean;
  statuses?: ResultStatus[];
  groups?: string[];
  ownerIds?: string[];
  /** table — компактная таблица (по умолчанию); full — объекты с полной точностью. */
  detail?: "table" | "full";
}

/** Колонки компактной таблицы результатов (detail = "table"). */
export const TABLE_COLUMNS = [
  "nodeId",
  "group",
  "tier",
  "ruleId",
  "nameEn",
  "nameRu",
  "status",
  "reasonCode",
  "diameterModelMm",
  "diameterPrototypeMm",
  "material",
  "coefficientBasis",
  "calibrationStatus",
  "sourceIds",
  "noteIds",
] as const;

function round(value: number | null, digits: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Сокращает ответ Worker'а для модели. Неокруглённый диаметр модели сохраняется
 * (diameterModelMm), рядом — округление до 0,01 мм, как в интерфейсе сайта.
 * Повторяющиеся предупреждения строк и локаторы источников вынесены в
 * справочники notes/sourceLocators и адресуются индексами — иначе ответ для
 * полного парусника занимает сотни килобайт. Трассировка — только по запросу.
 */
export function compactCalculation(
  calculation: CalculationResponse,
  options: CompactOptions = {},
): Record<string, unknown> {
  const summary = { total: calculation.results.length, calculated: 0, needs_input: 0, unsupported: 0, not_applicable: 0 };
  for (const row of calculation.results) summary[row.status] += 1;

  const statusFilter = options.statuses && options.statuses.length > 0 ? new Set(options.statuses) : null;
  const groupFilter = options.groups && options.groups.length > 0 ? new Set(options.groups) : null;
  const ownerFilter = options.ownerIds && options.ownerIds.length > 0 ? new Set(options.ownerIds) : null;
  const globalWarnings = new Set(calculation.warnings);

  const notes: string[] = [];
  const noteIndex = new Map<string, number>();
  const locators: string[] = [];
  const locatorIndex = new Map<string, number>();

  const intern = (value: string, list: string[], index: Map<string, number>): number => {
    let id = index.get(value);
    if (id === undefined) {
      id = list.length;
      list.push(value);
      index.set(value, id);
    }
    return id;
  };

  const rows = calculation.results
    .filter((row) => {
      if (statusFilter) return statusFilter.has(row.status);
      return options.includeNotApplicable === true || row.status !== "not_applicable";
    })
    .filter((row) => !groupFilter || groupFilter.has(row.group))
    .filter((row) => !ownerFilter || ownerFilter.has(row.ownerId))
    .map((row) => {
      const noteIds = [...new Set(row.warnings.filter((warning) => warning && !globalWarnings.has(warning)))]
        .map((warning) => intern(warning, notes, noteIndex));
      const sourceLocatorId = row.sourceLocator ? intern(row.sourceLocator, locators, locatorIndex) : null;

      return {
        nodeId: row.nodeId,
        ownerId: row.ownerId,
        group: row.group,
        ...(row.tier ? { tier: row.tier } : {}),
        ruleId: row.ruleId,
        ...(row.ropeId && row.ropeId !== row.ruleId ? { ropeId: row.ropeId } : {}),
        role: row.role,
        nameEn: row.nameEn,
        nameRu: row.nameRu,
        status: row.status,
        ...(row.reasonCode ? { reasonCode: row.reasonCode } : {}),
        ...(row.missingInputIds.length > 0 ? { missingInputIds: row.missingInputIds } : {}),
        diameterModelMm: row.diameterModelMm,
        diameterModelMmRounded: round(row.diameterModelMm, 2),
        diameterPrototypeMm: round(row.diameterPrototypeMm, 1),
        material: row.material,
        coefficientBasis: row.coefficientBasis,
        calibrationStatus: row.calibrationStatus,
        sourceIds: row.sourceIds,
        ...(sourceLocatorId !== null ? { sourceLocatorId } : {}),
        ...(row.alternativeGroupId ? { alternativeGroupId: row.alternativeGroupId } : {}),
        ...(row.variant ? { variant: row.variant } : {}),
        ...(noteIds.length > 0 ? { noteIds } : {}),
        ...(options.includeTrace
          ? {
              measurementPointId: row.measurementPointId,
              formula: row.formula,
              referenceLabel: row.referenceLabel,
              factorLabel: row.factorLabel,
              trace: row.trace,
            }
          : {}),
      };
    });

  const header = {
    apiVersion: calculation.apiVersion,
    algorithmVersion: calculation.algorithmVersion,
    schemaVersion: calculation.schemaVersion,
    profileId: calculation.profileId,
    profileVersion: calculation.profileVersion,
    profileStatus: calculation.profileStatus,
    scaleDenominator: calculation.scaleDenominator,
    summary,
    returnedRows: rows.length,
    validationErrors: calculation.validationErrors,
    warnings: calculation.warnings,
    normalizedMeasurements: calculation.normalizedMeasurements,
  };

  if (options.detail === "full") {
    return {
      ...header,
      results: rows,
      notes,
      sourceLocators: locators,
      sources: calculation.sources,
    };
  }

  // Таблица: диаметр модели округлён до 0,01 мм, как на сайте; точное значение
  // и локаторы источников — в detail = "full".
  const table = rows.map((row) => [
    row.nodeId,
    row.group,
    row.tier ?? null,
    row.ruleId,
    row.nameEn,
    row.nameRu,
    row.status,
    row.reasonCode ?? null,
    row.diameterModelMmRounded,
    row.diameterPrototypeMm,
    row.material,
    row.coefficientBasis,
    row.calibrationStatus,
    row.sourceIds,
    row.noteIds ?? [],
  ]);
  const missingInputs = rows
    .filter((row) => row.missingInputIds && row.missingInputIds.length > 0)
    .map((row) => ({ nodeId: row.nodeId, ruleId: row.ruleId, missingInputIds: row.missingInputIds }));

  return {
    ...header,
    columns: TABLE_COLUMNS,
    rows: table,
    ...(missingInputs.length > 0 ? { missingInputs } : {}),
    notes,
    sources: calculation.sources,
  };
}
