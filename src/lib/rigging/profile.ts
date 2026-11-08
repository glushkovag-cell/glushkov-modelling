/**
 * Подписи и словари представления. Коэффициентов, ролей и баз здесь нет:
 * они живут в JSON-документах профилей (data/rigging) и читаются ядром.
 */

import type {
    AnchorConnection,
    CalibrationStatus,
    CoefficientBasis,
    GunType,
    MastId,
    Material,
    MeasurementId,
    MountingType,
    OwnerType,
    ReasonCode,
    ResultGroup,
    ResultStatus,
    SailClass,
    Tier,
} from './types.ts';
import { MAST_IDS, SAIL_CLASSES, TIERS } from './types.ts';

export { MAST_IDS, SAIL_CLASSES, TIERS };

export const MAST_LABELS: Record<MastId, { en: string; ru: string }> = {
    fore: { en: 'Foremast', ru: 'Фок-мачта' },
    main: { en: 'Mainmast', ru: 'Грот-мачта' },
    mizzen: { en: 'Mizzenmast', ru: 'Бизань-мачта' },
};

export const TIER_LABELS: Record<Tier, { en: string; ru: string }> = {
    lower: { en: 'Lower mast', ru: 'Нижняя мачта' },
    topmast: { en: 'Topmast', ru: 'Стеньга' },
    topgallant: { en: 'Topgallant', ru: 'Брам-стеньга' },
};

export const SAIL_CLASS_LABELS: Record<SailClass, { en: string; ru: string }> = {
    head_lower: { en: 'Lower headsail', ru: 'Нижний носовой косой парус' },
    head_upper: { en: 'Upper headsail', ru: 'Верхний носовой косой парус' },
    staysail_lower: { en: 'Lower staysail', ru: 'Нижний межмачтовый стаксель' },
    staysail_upper: { en: 'Upper staysail', ru: 'Верхний межмачтовый стаксель' },
};

export const GROUP_LABELS: Record<ResultGroup, string> = {
    standing: 'Standing rigging',
    running: 'Running rigging',
    bowsprit: 'Bowsprit & spars',
    anchor: 'Anchor gear',
    gun: 'Gun gear',
};

export const OWNER_LABELS: Record<string, string> = {
    fore: 'Foremast',
    main: 'Mainmast',
    mizzen: 'Mizzenmast',
    bowsprit: 'Bowsprit & spars',
    hull: 'Hull & general rigging',
    hull_group: 'Hull & general rigging',
    anchor_group: 'Anchor gear',
    gun_group: 'Gun gear',
};

/** Порядок групп в ведомости. */
export const OWNER_ORDER: readonly string[] = [
    'fore',
    'main',
    'mizzen',
    'bowsprit',
    'hull',
    'hull_group',
    'anchor_group',
    'gun_group',
];

export const OWNER_TYPE_LABELS: Record<OwnerType, string> = {
    mast: 'Mast',
    bowsprit: 'Bowsprit',
    hull: 'Hull',
    anchor_group: 'Anchor gear',
    gun_group: 'Gun gear',
};

export const STATUS_LABELS: Record<ResultStatus, string> = {
    calculated: 'Calculated',
    needs_input: 'Needs input',
    unsupported: 'Unsupported',
    not_applicable: 'Not applicable',
};

export const ORIGIN_LABELS: Record<CoefficientBasis, string> = {
    engineering_assumption: 'Engineering estimate',
    preliminary_fit: 'Preliminary fit',
};

export const ORIGIN_SHORT_LABELS: Record<CoefficientBasis, string> = {
    engineering_assumption: 'ENG',
    preliminary_fit: 'FIT',
};

export const REASON_LABELS: Record<ReasonCode, string> = {
    node_absent: 'Node absent',
    sail_not_configured: 'Sail not configured',
    rule_not_supported: 'No supported coefficient',
    material_not_supported: 'Material outside profile',
    installation_not_supported: 'Mounting not supported',
    configuration_required: 'Configuration required',
    measurement_required: 'Dimension required',
    dependency_unavailable: 'Parent role unavailable',
};

export const CALIBRATION_LABELS: Record<CalibrationStatus, string> = {
    not_calibrated: 'Not calibrated',
    training_set_only: 'Training set only',
};

export const MATERIAL_LABELS: Record<Material, string> = {
    fiber: 'Fibre',
    wire: 'Wire',
    rod: 'Rod',
    chain: 'Chain',
    unknown: 'Unknown',
};

export const GUN_TYPE_LABELS: Record<GunType, string> = {
    carriage_gun: 'Carriage gun',
    carronade: 'Carronade',
    unknown: 'Unknown',
};

export const MOUNTING_TYPE_LABELS: Record<MountingType, string> = {
    wheeled: 'Wheeled carriage',
    slide_pivot: 'Slide / pivot mount',
    unknown: 'Unknown',
};

export const ANCHOR_CONNECTION_LABELS: Record<AnchorConnection, string> = {
    fiber: 'Fibre cable',
    chain: 'Chain cable',
};

export const MEASUREMENT_LABELS: Record<MeasurementId, string> = {
    'mast.fore.diameter': 'Foremast diameter',
    'mast.main.diameter': 'Mainmast diameter',
    'mast.mizzen.diameter': 'Mizzenmast diameter',
    'bowsprit.diameter': 'Bowsprit diameter',
    'hull.width': 'Maximum hull width',
    'gun.bore': 'Gun bore diameter',
};

export const MEASUREMENT_POINT_LABELS: Record<string, string> = {
    partner: 'At the partner',
    maximum: 'Maximum diameter',
    working_section: 'Maximum working section',
    step: 'At the step (proxy)',
    unknown: 'Unknown point',
};

export const POINT_PROXY_WARNING =
    'The base diameter is taken at the step (or another non-partner point) as an explicitly marked proxy. It is not interchangeable with the diameter at the partner.';

export const MATERIAL_INVARIANCE_NOTE =
    'Geometry-only material invariance: the profile applies one coefficient to the listed material alternatives for this role. This is not equal strength and not a historical equivalence.';

export const MEASUREMENT_IDS = {
    mast: (mastId: MastId) => `mast.${mastId}.diameter` as const,
    bowsprit: 'bowsprit.diameter' as const,
    hullWidth: 'hull.width' as const,
    gunBore: 'gun.bore' as const,
};

export function mastLabel(mastId: MastId): string {
    return MAST_LABELS[mastId]?.en ?? mastId;
}
