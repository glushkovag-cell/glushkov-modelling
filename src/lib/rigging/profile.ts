/**
 * Реестр ролей и подписи профиля traditional_plant v1.0.0.
 *
 * Числа взяты из нормативной спецификации MVP v1.0.0. Это инженерные и
 * предварительные оценки, а не историческая верификация. Никакие строки
 * здесь не объявляют точность или применимость к конкретному прототипу.
 */

import type {
    AnchorConnection,
    CoefficientBasis,
    GunType,
    MastId,
    MountingType,
    ReasonCode,
    ResultGroup,
    ResultStatus,
    SailClass,
    Tier,
} from './types.ts';

export const MAST_IDS: readonly MastId[] = ['fore', 'main', 'mizzen'];
export const TIERS: readonly Tier[] = ['lower', 'topmast', 'topgallant'];
export const SAIL_CLASSES: readonly SailClass[] = [
    'head_lower',
    'head_upper',
    'staysail_lower',
    'staysail_upper',
];

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

export const CALIBRATION_LABELS: Record<string, string> = {
    not_calibrated: 'Not calibrated',
    training_set_only: 'Training set only',
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

export const MEASUREMENT_LABELS: Record<string, string> = {
    'mast.fore.diameter': 'Foremast diameter',
    'mast.main.diameter': 'Mainmast diameter',
    'mast.mizzen.diameter': 'Mizzenmast diameter',
    'bowsprit.diameter': 'Bowsprit diameter',
    'hull.width': 'Maximum hull width',
    'gun.bore': 'Gun bore diameter',
};

export const MEASUREMENT_IDS = {
    mast: (mastId: MastId) => `mast.${mastId}.diameter` as const,
    bowsprit: 'bowsprit.diameter' as const,
    hullWidth: 'hull.width' as const,
    gunBore: 'gun.bore' as const,
};

export const PROFILE_WARNINGS = [
    'These are estimated diameters for a static scale model. They are not a strength calculation and must not be used for a full-size vessel.',
    'All published rows are engineering estimates or a preliminary fit. The profile has no verified historical range and is not a reconstruction of a specific vessel.',
];

export const PRELIMINARY_FIT_WARNING =
    'Preliminary fit to a small Bounty/Mercury calibration set. Mean absolute relative deviation was 32.3% across eight diameters. This is not a guaranteed accuracy.';

export const ANCHOR_WARNING =
    'Anchor ratios follow a presented 1819 list. The base A = 0.0115 × W is a rounded assumption derived from one vessel.';

export const GUN_WARNING =
    'Gun-gear ratios are engineering estimates. They are not a historical calibration and do not assert that a particular fitting was carried.';

export const BOWSPRIT_WARNING =
    'Bowsprit and spar ratios are engineering estimates. One continuous rope is not duplicated when it passes a spar.';

export interface StandingRoleDef {
    role: string;
    nameEn: string;
    nameRu: string;
    factor: number;
    /** Ссылка на другую строку того же узла; null — на мачту (B_m). */
    baseRole: string | null;
    /** Для путенс-вант: tier узла, где лежит базовая строка. */
    baseTier?: Tier;
    baseMastId?: MastId;
    sailRole?: boolean;
    preliminary?: boolean;
}

export const STANDING_ROLE_NAMES: Record<string, { en: string; ru: string }> = {
    'st.lower.stay': { en: 'Lower stay', ru: 'Нижний штаг' },
    'st.lower.shroud': { en: 'Lower shrouds', ru: 'Нижние ванты' },
    'st.lower.backstay': { en: 'Lower backstays', ru: 'Нижние бакштаги' },
    'st.topmast.stay': { en: 'Topmast stay', ru: 'Стень-штаг' },
    'st.topmast.shroud': { en: 'Topmast shrouds', ru: 'Стень-ванты' },
    'st.topmast.backstay': { en: 'Topmast backstays', ru: 'Стень-фордуны' },
    'st.topgallant.stay': { en: 'Topgallant stay', ru: 'Брам-штаг' },
    'st.topgallant.shroud': { en: 'Topgallant shrouds', ru: 'Брам-ванты' },
    'st.topgallant.backstay': { en: 'Topgallant backstays', ru: 'Брам-фордуны' },
    'st.lower.preventer': { en: 'Lower preventer stay', ru: 'Нижний лось-штаг' },
    'st.topmast.preventer': { en: 'Topmast preventer stay', ru: 'Стень-лось-штаг' },
    'st.futtock.lower': { en: 'Lower futtock shrouds', ru: 'Нижние путенс-ванты' },
    'st.futtock.upper': { en: 'Upper futtock shrouds', ru: 'Верхние путенс-ванты' },
    'st.lower.ratline': { en: 'Lower ratlines', ru: 'Выбленки нижних вант' },
    'st.topmast.ratline': { en: 'Topmast ratlines', ru: 'Выбленки стень-вант' },
    'st.topgallant.ratline': { en: 'Topgallant ratlines', ru: 'Выбленки брам-вант' },
    'st.lower.shroud_lanyard': { en: 'Lower shroud lanyards', ru: 'Талрепы нижних вант' },
    'st.topmast.shroud_lanyard': { en: 'Topmast shroud lanyards', ru: 'Талрепы стень-вант' },
    'st.topgallant.shroud_lanyard': { en: 'Topgallant shroud lanyards', ru: 'Талрепы брам-вант' },
    'st.lower.backstay_lanyard': { en: 'Lower backstay lanyards', ru: 'Талрепы нижних бакштагов' },
    'st.topmast.backstay_lanyard': { en: 'Topmast backstay lanyards', ru: 'Талрепы стень-фордунов' },
    'st.topgallant.backstay_lanyard': { en: 'Topgallant backstay lanyards', ru: 'Талрепы брам-фордунов' },
    'st.lower.stay_lanyard': { en: 'Lower stay lanyard', ru: 'Ланьяр нижнего штага' },
    'st.topmast.stay_lanyard': { en: 'Topmast stay lanyard', ru: 'Ланьяр стень-штага' },
    'st.topgallant.stay_lanyard': { en: 'Topgallant stay lanyard', ru: 'Ланьяр брам-штага' },
    'st.lower.preventer_lanyard': { en: 'Lower preventer lanyard', ru: 'Ланьяр нижнего лось-штага' },
    'st.topmast.preventer_lanyard': { en: 'Topmast preventer lanyard', ru: 'Ланьяр стень-лось-штага' },
};

export interface SquareRoleDef {
    role: string;
    nameEn: string;
    nameRu: string;
    factors: Record<Tier, number | null>;
    sailRole: boolean;
    alternativeGroupId?: string;
    variant?: 'compound' | 'simple';
}

export const SQUARE_ROLE_DEFS: readonly SquareRoleDef[] = [
    {
        role: 'tie',
        nameEn: 'Yard tie',
        nameRu: 'Шкентель рея',
        factors: { lower: 0.5, topmast: 0.4, topgallant: 0.25 },
        sailRole: false,
        alternativeGroupId: 'yard_hoist',
        variant: 'compound',
    },
    {
        role: 'halyard_fall',
        nameEn: 'Halyard fall',
        nameRu: 'Ходовой конец фала',
        factors: { lower: 0.3, topmast: 0.25, topgallant: 0.2 },
        sailRole: false,
        alternativeGroupId: 'yard_hoist',
        variant: 'compound',
    },
    {
        role: 'simple_halyard',
        nameEn: 'Simple halyard',
        nameRu: 'Простой фал',
        factors: { lower: 0.3, topmast: 0.25, topgallant: 0.2 },
        sailRole: false,
        alternativeGroupId: 'yard_hoist',
        variant: 'simple',
    },
    {
        role: 'lift',
        nameEn: 'Yard lift',
        nameRu: 'Топенант',
        factors: { lower: 0.3, topmast: 0.25, topgallant: 0.2 },
        sailRole: false,
    },
    {
        role: 'brace_pendant',
        nameEn: 'Brace pendant',
        nameRu: 'Шкентель браса',
        factors: { lower: 0.35, topmast: 0.25, topgallant: 0.2 },
        sailRole: false,
    },
    {
        role: 'brace_fall',
        nameEn: 'Brace fall',
        nameRu: 'Ходовой конец браса',
        factors: { lower: 0.25, topmast: 0.2, topgallant: 0.15 },
        sailRole: false,
    },
    {
        role: 'sling',
        nameEn: 'Yard sling',
        nameRu: 'Строп рея',
        factors: { lower: 0.45, topmast: 0.3, topgallant: 0.2 },
        sailRole: false,
    },
    {
        role: 'parrel_rope',
        nameEn: 'Parrel rope',
        nameRu: 'Бейфут',
        factors: { lower: 0.3, topmast: 0.25, topgallant: 0.18 },
        sailRole: false,
    },
    {
        role: 'sheet',
        nameEn: 'Sheet',
        nameRu: 'Шкот',
        factors: { lower: 0.45, topmast: 0.4, topgallant: 0.25 },
        sailRole: true,
    },
    {
        role: 'tack',
        nameEn: 'Tack',
        nameRu: 'Галс',
        factors: { lower: 0.45, topmast: null, topgallant: null },
        sailRole: true,
    },
    {
        role: 'clewline',
        nameEn: 'Clewline',
        nameRu: 'Гитов',
        factors: { lower: 0.25, topmast: 0.2, topgallant: 0.15 },
        sailRole: true,
    },
    {
        role: 'buntline',
        nameEn: 'Buntline',
        nameRu: 'Бык-гордень',
        factors: { lower: 0.15, topmast: 0.12, topgallant: 0.1 },
        sailRole: true,
    },
    {
        role: 'leechline',
        nameEn: 'Leechline',
        nameRu: 'Нок-гордень',
        factors: { lower: 0.15, topmast: 0.12, topgallant: 0.1 },
        sailRole: true,
    },
    {
        role: 'bowline',
        nameEn: 'Bowline',
        nameRu: 'Булинь',
        factors: { lower: 0.2, topmast: 0.15, topgallant: 0.12 },
        sailRole: true,
    },
    {
        role: 'reef_fall',
        nameEn: 'Reef fall',
        nameRu: 'Риф-тали',
        factors: { lower: 0.2, topmast: 0.2, topgallant: null },
        sailRole: true,
    },
];

export const FORE_AND_AFT_ROLE_DEFS = [
    { role: 'halyard', nameEn: 'Halyard', nameRu: 'Фал' },
    { role: 'sheet', nameEn: 'Sheet', nameRu: 'Шкот' },
    { role: 'downhaul', nameEn: 'Downhaul', nameRu: 'Нирал' },
] as const;

export const FORE_AND_AFT_FACTORS: Record<
    SailClass,
    Record<'halyard' | 'sheet' | 'downhaul', number>
> = {
    head_lower: { halyard: 0.2, sheet: 0.3, downhaul: 0.12 },
    head_upper: { halyard: 0.15, sheet: 0.2, downhaul: 0.1 },
    staysail_lower: { halyard: 0.2, sheet: 0.25, downhaul: 0.12 },
    staysail_upper: { halyard: 0.15, sheet: 0.2, downhaul: 0.1 },
};

export const GAFF_ROLE_DEFS = [
    {
        role: 'throat_halyard',
        nameEn: 'Throat halyard',
        nameRu: 'Гафель-гардель',
        factor: 0.25,
        sailRole: true,
    },
    {
        role: 'peak_halyard',
        nameEn: 'Peak halyard',
        nameRu: 'Дирик-фал',
        factor: 0.25,
        sailRole: true,
    },
    {
        role: 'boom_sheet',
        nameEn: 'Boom sheet',
        nameRu: 'Гика-шкот',
        factor: 0.35,
        sailRole: true,
    },
    {
        role: 'boom_lift',
        nameEn: 'Boom lift',
        nameRu: 'Гика-топенант',
        factor: 0.25,
        sailRole: false,
    },
    {
        role: 'gaff_vang',
        nameEn: 'Gaff vang',
        nameRu: 'Оттяжка гафеля',
        factor: 0.2,
        sailRole: true,
    },
    {
        role: 'brail',
        nameEn: 'Brail',
        nameRu: 'Гитов гафельного паруса',
        factor: 0.15,
        sailRole: true,
    },
] as const;

export const BOW_ROLE_DEFS: Record<
    'bowsprit' | 'jibboom' | 'flying_jibboom' | 'martingale',
    readonly {
        role: string;
        nameEn: string;
        nameRu: string;
        factor: number;
        lanyard: boolean;
    }[]
> = {
    bowsprit: [
        { role: 'bobstay', nameEn: 'Bobstay', nameRu: 'Ватер-штаг', factor: 0.55, lanyard: true },
        { role: 'shroud', nameEn: 'Bowsprit shrouds', nameRu: 'Ватер-бакштаги', factor: 0.45, lanyard: true },
        { role: 'gammoning', nameEn: 'Gammoning', nameRu: 'Ватер-вулинг', factor: 0.55, lanyard: false },
    ],
    jibboom: [
        { role: 'jibboom_lower', nameEn: 'Jibboom lower support', nameRu: 'Нижняя поддержка утлегаря', factor: 0.3, lanyard: true },
        { role: 'jibboom_side', nameEn: 'Jibboom side support', nameRu: 'Боковая поддержка утлегаря', factor: 0.25, lanyard: true },
    ],
    flying_jibboom: [
        { role: 'flyingjibboom_lower', nameEn: 'Flying jibboom lower support', nameRu: 'Нижняя поддержка бом-утлегаря', factor: 0.2, lanyard: true },
        { role: 'flyingjibboom_side', nameEn: 'Flying jibboom side support', nameRu: 'Боковая поддержка бом-утлегаря', factor: 0.18, lanyard: true },
    ],
    martingale: [
        { role: 'martingale_backstay', nameEn: 'Martingale backstay', nameRu: 'Бакштаг мартин-гика', factor: 0.25, lanyard: true },
    ],
};

export const SPRITSAIL_ROLE_DEFS = [
    { role: 'sling', nameEn: 'Spritsail yard sling', nameRu: 'Строп блинда-рея', factor: 0.35, sailRole: false },
    { role: 'simple_halyard', nameEn: 'Spritsail yard halyard', nameRu: 'Фал блинда-рея', factor: 0.25, sailRole: false },
    { role: 'lift', nameEn: 'Spritsail yard lift', nameRu: 'Топенант блинда-рея', factor: 0.25, sailRole: false },
    { role: 'brace_pendant', nameEn: 'Spritsail brace pendant', nameRu: 'Шкентель блинда-браса', factor: 0.25, sailRole: false },
    { role: 'brace_fall', nameEn: 'Spritsail brace fall', nameRu: 'Ходовой конец блинда-браса', factor: 0.2, sailRole: false },
    { role: 'parrel_rope', nameEn: 'Spritsail yard parrel', nameRu: 'Бейфут блинда-рея', factor: 0.25, sailRole: false },
    { role: 'sheet', nameEn: 'Spritsail sheet', nameRu: 'Шкот блинда-паруса', factor: 0.3, sailRole: true },
    { role: 'clewline', nameEn: 'Spritsail clewline', nameRu: 'Гитов блинда-паруса', factor: 0.18, sailRole: true },
    { role: 'buntline', nameEn: 'Spritsail buntline', nameRu: 'Бык-гордень блинда-паруса', factor: 0.12, sailRole: true },
    { role: 'leechline', nameEn: 'Spritsail leechline', nameRu: 'Нок-гордень блинда-паруса', factor: 0.12, sailRole: true },
] as const;

export const SPRITSAIL_UNSUPPORTED_ROLES = ['tack', 'bowline', 'reef_fall'] as const;

export const ANCHOR_ROLE_DEFS = [
    { role: 'bower_cable', nameEn: 'Bower cable', nameRu: 'Становой якорный канат', factor: 1 },
    { role: 'kedge_cable', nameEn: 'Kedge cable', nameRu: 'Верп-канат', factor: 0.45 },
    { role: 'messenger', nameEn: 'Messenger', nameRu: 'Кабаляринг', factor: 0.7 },
    { role: 'bitter_rope', nameEn: 'Bitter rope', nameRu: 'Жвака-галс', factor: 0.37 },
    { role: 'bower_buoy_rope', nameEn: 'Bower buoy rope', nameRu: 'Буйреп станового якоря', factor: 0.37 },
    { role: 'kedge_buoy_rope', nameEn: 'Kedge buoy rope', nameRu: 'Буйреп верпа', factor: 0.26 },
    { role: 'cable_light', nameEn: 'Cable-laid rope, light', nameRu: 'Кабельтов, лёгкий', factor: 0.45 },
    { role: 'cable_medium', nameEn: 'Cable-laid rope, medium', nameRu: 'Кабельтов, средний', factor: 0.52 },
    { role: 'cable_heavy', nameEn: 'Cable-laid rope, heavy', nameRu: 'Кабельтов, тяжёлый', factor: 0.59 },
    { role: 'hawser_light', nameEn: 'Hawser, light', nameRu: 'Перлинь, лёгкий', factor: 0.3 },
    { role: 'hawser_medium', nameEn: 'Hawser, medium', nameRu: 'Перлинь, средний', factor: 0.37 },
    { role: 'hawser_heavy', nameEn: 'Hawser, heavy', nameRu: 'Перлинь, тяжёлый', factor: 0.41 },
    { role: 'cat_fall', nameEn: 'Cat fall', nameRu: 'Ходовой конец кат-талей', factor: 0.3 },
    { role: 'fish_fall', nameEn: 'Fish fall', nameRu: 'Ходовой конец фиш-талей', factor: 0.25 },
    { role: 'cable_stopper', nameEn: 'Cable stopper', nameRu: 'Стоппер каната', factor: 0.3 },
    { role: 'anchor_stow_lashing', nameEn: 'Anchor stow lashing', nameRu: 'Крепление якоря по-походному', factor: 0.25 },
] as const;

export const GUN_ROLE_DEFS = [
    { role: 'breeching', nameEn: 'Breeching', nameRu: 'Брюки', factor: 0.3 },
    { role: 'side_fall', nameEn: 'Side fall', nameRu: 'Боковая таль', factor: 0.1 },
    { role: 'train_fall', nameEn: 'Train fall', nameRu: 'Задняя таль', factor: 0.1 },
    { role: 'stow_lashing', nameEn: 'Stow lashing', nameRu: 'Походное крепление', factor: 0.12 },
] as const;

export const SUPPORTED_GUN_MOUNTINGS: ReadonlyArray<{
    gunType: GunType;
    mountingType: MountingType;
}> = [
    { gunType: 'carriage_gun', mountingType: 'wheeled' },
    { gunType: 'carronade', mountingType: 'slide_pivot' },
];

export function isSupportedGunMounting(
    gunType: GunType | undefined,
    mountingType: MountingType | undefined,
): boolean {
    if (!gunType || !mountingType) return false;
    return SUPPORTED_GUN_MOUNTINGS.some(
        (entry) => entry.gunType === gunType && entry.mountingType === mountingType,
    );
}

/** Коэффициенты базы: B_m = 3/25 D_m; N = 3/25 D_b; A = 23/2000 W. */
export const BASE_FACTORS = {
    mast: 3 / 25,
    bowsprit: 3 / 25,
    anchor: 23 / 2000,
} as const;

export const BASE_FACTOR_LABELS = {
    mast: '3/25',
    bowsprit: '3/25',
    anchor: '23/2000',
} as const;
