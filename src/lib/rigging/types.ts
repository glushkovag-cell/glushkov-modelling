/**
 * Типы расчётного ядра калькулятора толщин такелажа.
 *
 * Профиль traditional_plant v1.0.0 (schemaVersion 1.0.0). Ядро чистое: здесь
 * нет DOM, HTTP, CMS и случайных источников. Все размеры внутри — миллиметры
 * прототипа; масштаб применяется один раз при нормализации и один раз при
 * выводе диаметра модели.
 */

export const PROFILE_ID = 'traditional_plant';
export const PROFILE_VERSION = '1.0.0';
export const SCHEMA_VERSION = '1.0.0';
export const ALGORITHM_VERSION = '1.0.0';

export type MastId = 'fore' | 'main' | 'mizzen';
export type Tier = 'lower' | 'topmast' | 'topgallant';
export type UnitId = 'mm' | 'cm' | 'in';
export type Basis = 'model' | 'prototype';
export type MeasurementPointId =
    | 'partner'
    | 'maximum'
    | 'working_section'
    | 'unknown';

export type SailClass =
    | 'head_lower'
    | 'head_upper'
    | 'staysail_lower'
    | 'staysail_upper';

export type NodeType =
    | 'lower_mast'
    | 'topmast'
    | 'topgallant'
    | 'yard'
    | 'fore_and_aft_sail'
    | 'gaff'
    | 'bowsprit'
    | 'jibboom'
    | 'flying_jibboom'
    | 'martingale'
    | 'spritsail_yard'
    | 'anchor_group'
    | 'gun_group';

export type OwnerType = 'mast' | 'bowsprit' | 'anchor_group' | 'gun_group';

export type GunType = 'carriage_gun' | 'carronade' | 'unknown';
export type MountingType = 'wheeled' | 'slide_pivot' | 'unknown';
export type AnchorConnection = 'fiber' | 'chain';

export type ResultGroup =
    | 'standing'
    | 'running'
    | 'bowsprit'
    | 'anchor'
    | 'gun';

export type ResultStatus =
    | 'calculated'
    | 'needs_input'
    | 'unsupported'
    | 'not_applicable';

export type ReasonCode =
    | 'node_absent'
    | 'sail_not_configured'
    | 'rule_not_supported'
    | 'material_not_supported'
    | 'installation_not_supported'
    | 'configuration_required'
    | 'measurement_required'
    | 'dependency_unavailable';

export type CoefficientBasis =
    | 'engineering_assumption'
    | 'preliminary_fit';

export type CalibrationStatus =
    | 'not_calibrated'
    | 'training_set_only';

export type MeasurementId =
    | `mast.${MastId}.diameter`
    | 'bowsprit.diameter'
    | 'hull.width'
    | 'gun.bore';

export interface Measurement {
    value: number | null;
    unitId: UnitId;
    basis: Basis;
    measurementPointId: MeasurementPointId;
}

export interface RiggingNode {
    nodeId: string;
    nodeType: NodeType;
    parentNodeId: string | null;
    ownerType: OwnerType;
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

export interface RiggingMeasurements {
    mastDiameter: Partial<Record<MastId, Measurement>>;
    bowspritDiameter?: Measurement | null;
    hullWidth?: Measurement | null;
    gunBore?: Measurement | null;
}

export interface HistoricalContext {
    mode: 'year' | 'period' | null;
    year: number | null;
    periodFrom: number | null;
    periodTo: number | null;
}

export interface RiggingInput {
    scaleDenominator: number;
    measurements: RiggingMeasurements;
    nodes: RiggingNode[];
}

export interface ValidationIssue {
    code: string;
    message: string;
    field?: string;
    nodeId?: string;
}

export interface NormalizedMeasurement {
    measurementId: MeasurementId;
    rawValue: number;
    unitId: UnitId;
    basis: Basis;
    measurementPointId: MeasurementPointId;
    realMm: number;
    modelMm: number;
}

export interface RiggingResult {
    ownerType: OwnerType;
    ownerId: string;
    nodeId: string;
    ruleId: string;
    ropeId: string;
    role: string;
    segmentType: 'rope';
    nameEn: string;
    nameRu: string;
    group: ResultGroup;
    tier?: Tier;
    status: ResultStatus;
    reasonCode?: ReasonCode;
    missingInputIds: MeasurementId[];
    diameterPrototypeMm: number | null;
    diameterModelMm: number | null;
    method: 'proportional';
    calculationKind: 'estimate';
    coefficientBasis: CoefficientBasis;
    calibrationStatus: CalibrationStatus;
    profileId: typeof PROFILE_ID;
    profileVersion: typeof PROFILE_VERSION;
    schemaVersion: typeof SCHEMA_VERSION;
    formula: string | null;
    referenceLabel: string;
    factorLabel: string;
    trace: string[];
    warnings: string[];
    alternativeGroupId?: string;
    variant?: 'compound' | 'simple';
    sortIndex: number;
}

export interface Calculation {
    profileId: typeof PROFILE_ID;
    profileVersion: typeof PROFILE_VERSION;
    schemaVersion: typeof SCHEMA_VERSION;
    algorithmVersion: typeof ALGORITHM_VERSION;
    scaleDenominator: number;
    normalizedMeasurements: NormalizedMeasurement[];
    results: RiggingResult[];
    warnings: string[];
    validationErrors: ValidationIssue[];
}
