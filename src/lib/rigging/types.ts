/**
 * Типы расчётного ядра калькулятора толщин такелажа.
 *
 * Ядро чистое: здесь нет DOM, HTTP, CMS и случайных источников. Все размеры
 * внутри — миллиметры прототипа; масштаб применяется один раз при
 * нормализации и один раз при выводе диаметра модели. Коэффициенты и состав
 * ролей живут в версионированных JSON-документах профилей (data/rigging),
 * а не в коде.
 */

/** Версия контракта расширенной схемы. Изменение контракта — новая версия. */
export const SCHEMA_VERSION = '1.0.0';

/** Версия алгоритма ядра. Меняется только при изменении вычислений. */
export const ALGORITHM_VERSION = '1.0.0';

/** Профиль по умолчанию, пока пользователь не выбрал другой явно. */
export const DEFAULT_PROFILE_ID = 'traditional_plant';

export type MastId = 'fore' | 'main' | 'mizzen';
export const MAST_IDS: readonly MastId[] = ['fore', 'main', 'mizzen'];

export type Tier = 'lower' | 'topmast' | 'topgallant';
export const TIERS: readonly Tier[] = ['lower', 'topmast', 'topgallant'];

export type UnitId = 'mm' | 'cm' | 'in';
export type Basis = 'model' | 'prototype';

/**
 * Точка измерения. `step` — явно помеченный proxy: диаметр у степа не
 * взаимозаменяем с диаметром у пяртнерса.
 */
export type MeasurementPointId =
    | 'partner'
    | 'maximum'
    | 'working_section'
    | 'step'
    | 'unknown';

export type SailClass =
    | 'head_lower'
    | 'head_upper'
    | 'staysail_lower'
    | 'staysail_upper';

export const SAIL_CLASSES: readonly SailClass[] = [
    'head_lower',
    'head_upper',
    'staysail_lower',
    'staysail_upper',
];

/**
 * Словарь узлов. Ранние профили используют подмножество; расширение словаря
 * не означает, что каждый профиль поддержан для каждого узла.
 */
export type NodeType =
    | 'lower_mast'
    | 'topmast'
    | 'topgallant'
    | 'yard'
    | 'fore_and_aft_sail'
    | 'gaff'
    | 'gaff_sail'
    | 'boom'
    | 'main_sail'
    | 'topsail'
    | 'head_lower'
    | 'head_upper'
    | 'staysail'
    | 'flag'
    | 'lateen_yard'
    | 'bowsprit'
    | 'jibboom'
    | 'flying_jibboom'
    | 'martingale'
    | 'spritsail_yard'
    | 'hull_group'
    | 'anchor_group'
    | 'gun_group';

export type OwnerType =
    | 'mast'
    | 'bowsprit'
    | 'hull'
    | 'anchor_group'
    | 'gun_group';

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

/** Материал прототипа. Материал модельной нити не меняет это поле. */
export type Material = 'fiber' | 'wire' | 'rod' | 'chain' | 'unknown';

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

export interface RiggingInput {
    /** Явно выбранный профиль. Неизвестный профиль не подменяется другим. */
    profileId: string;
    /** Зафиксированная версия проекта; null — последняя опубликованная. */
    profileVersion?: string | null;
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
    material: Material;
    coefficientBasis: CoefficientBasis;
    calibrationStatus: CalibrationStatus;
    profileId: string;
    profileVersion: string;
    schemaVersion: string;
    sourceIds: string[];
    sourceLocator: string | null;
    measurementPointId: MeasurementPointId | null;
    formula: string | null;
    referenceLabel: string;
    factorLabel: string;
    trace: string[];
    warnings: string[];
    alternativeGroupId?: string;
    variant?: 'compound' | 'simple';
    sortIndex: number;
}

export interface CalculationSource {
    id: string;
    title: string;
    locator: string;
}

export interface Calculation {
    profileId: string;
    profileVersion: string;
    profileStatus: string;
    schemaVersion: string;
    algorithmVersion: string;
    scaleDenominator: number;
    normalizedMeasurements: NormalizedMeasurement[];
    results: RiggingResult[];
    sources: CalculationSource[];
    warnings: string[];
    validationErrors: ValidationIssue[];
}
