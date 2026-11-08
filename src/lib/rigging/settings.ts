/**
 * Компактная конфигурация для интерфейса и преобразование в узлы профиля.
 *
 * Ядро принимает уже развёрнутый список узлов. Этот модуль нужен, чтобы UI не
 * собирал вручную десятки nodeId и чтобы тесты могли описать конфигурацию
 * коротко. Числа по умолчанию — демонстрационные размеры модели, а не
 * историческая ведомость. Набор доступных блоков задаёт документ профиля.
 */

import type {
    AnchorConnection,
    GunType,
    MastId,
    Measurement,
    MountingType,
    RiggingInput,
    RiggingNode,
    SailClass,
    Tier,
} from './types.ts';
import { DEFAULT_PROFILE_ID, MAST_IDS } from './types.ts';
import { SAIL_CLASSES, TIERS } from './profile.ts';
import type { ProfileDocument, ProfileUi } from './document.ts';

export interface MastSettings {
    present: boolean;
    diameter: Measurement;
    topmast: boolean;
    topgallant: boolean;
    yards: Record<Tier, boolean>;
    sails: Record<Tier, boolean>;
}

export interface ForeAndAftSetting {
    present: boolean;
    supportingMastId: MastId;
}

export interface GaffSettings {
    present: boolean;
    sailPresent: boolean;
    supportingMastId: MastId;
}

export interface BowspritSettings {
    present: boolean;
    diameter: Measurement;
    jibboom: boolean;
    flyingJibboom: boolean;
    martingale: boolean;
    spritsailYard: boolean;
    spritsailSail: boolean;
}

export interface AnchorSettings {
    present: boolean;
    connection: AnchorConnection;
}

export interface GunSettings {
    present: boolean;
    gunType: GunType;
    mountingType: MountingType;
    bore: Measurement;
}

/** Узлы яхтенного и гафельного вооружения, задаваемые по мачтам. */
export type SailNodeKind =
    | 'main_sail'
    | 'gaff'
    | 'gaff_sail'
    | 'boom'
    | 'topsail'
    | 'head_lower'
    | 'head_upper'
    | 'staysail'
    | 'flag';

export const SAIL_NODE_KINDS: readonly SailNodeKind[] = [
    'main_sail',
    'gaff',
    'gaff_sail',
    'boom',
    'topsail',
    'head_lower',
    'head_upper',
    'staysail',
    'flag',
];

export type SailNodeMatrix = Record<SailNodeKind, Record<MastId, boolean>>;

export interface RiggingSettings {
    profileId: string;
    profileVersion?: string | null;
    scaleDenominator: number;
    masts: Record<MastId, MastSettings>;
    bowsprit: BowspritSettings;
    hullWidth: Measurement;
    anchor: AnchorSettings;
    gun: GunSettings;
    foreAndAft: Record<SailClass, ForeAndAftSetting>;
    gaff: GaffSettings;
    sailNodes: SailNodeMatrix;
    lateenYard: { present: boolean; sailPresent: boolean; supportingMastId: MastId };
    hullGroup: boolean;
}

function modelMm(value: number, point: Measurement['measurementPointId'] = 'partner'): Measurement {
    return {
        value,
        unitId: 'mm',
        basis: 'model',
        measurementPointId: point,
    };
}

function emptySailNodes(): SailNodeMatrix {
    const matrix = {} as SailNodeMatrix;
    for (const kind of SAIL_NODE_KINDS) {
        matrix[kind] = { fore: false, main: false, mizzen: false };
    }
    return matrix;
}

export function defaultSettings(): RiggingSettings {
    return {
        profileId: DEFAULT_PROFILE_ID,
        profileVersion: null,
        scaleDenominator: 64,
        masts: {
            fore: {
                present: true,
                diameter: modelMm(9),
                topmast: true,
                topgallant: true,
                yards: { lower: true, topmast: true, topgallant: true },
                sails: { lower: true, topmast: true, topgallant: true },
            },
            main: {
                present: true,
                diameter: modelMm(10),
                topmast: true,
                topgallant: true,
                yards: { lower: true, topmast: true, topgallant: true },
                sails: { lower: true, topmast: true, topgallant: true },
            },
            mizzen: {
                present: true,
                diameter: modelMm(7),
                topmast: true,
                topgallant: true,
                yards: { lower: true, topmast: true, topgallant: true },
                sails: { lower: true, topmast: true, topgallant: true },
            },
        },
        bowsprit: {
            present: true,
            diameter: modelMm(8, 'working_section'),
            jibboom: true,
            flyingJibboom: true,
            martingale: true,
            spritsailYard: true,
            spritsailSail: true,
        },
        hullWidth: modelMm(150, 'unknown'),
        anchor: { present: true, connection: 'fiber' },
        gun: {
            present: true,
            gunType: 'carriage_gun',
            mountingType: 'wheeled',
            bore: modelMm(2, 'working_section'),
        },
        foreAndAft: {
            head_lower: { present: true, supportingMastId: 'fore' },
            head_upper: { present: false, supportingMastId: 'fore' },
            staysail_lower: { present: true, supportingMastId: 'fore' },
            staysail_upper: { present: false, supportingMastId: 'fore' },
        },
        gaff: { present: true, sailPresent: true, supportingMastId: 'mizzen' },
        sailNodes: emptySailNodes(),
        lateenYard: { present: false, sailPresent: true, supportingMastId: 'mizzen' },
        hullGroup: false,
    };
}

/**
 * Настройки по умолчанию для выбранного профиля. Показывает только блоки,
 * предусмотренные документом, и подставляет демонстрационные размеры из
 * profile.ui.defaults — это не историческая ведомость.
 */
export function defaultSettingsForProfile(document: ProfileDocument): RiggingSettings {
    const settings = defaultSettings();
    const ui = document.profile.ui;
    const defaults = ui.defaults ?? {};

    settings.profileId = document.profile.profileId;
    settings.profileVersion = document.profile.profileVersion;
    settings.scaleDenominator = defaults.scaleDenominator ?? settings.scaleDenominator;

    for (const mastId of MAST_IDS) {
        const mast = settings.masts[mastId];
        mast.present = ui.masts;
        const diameter = defaults.mastDiameterMm?.[mastId];
        if (diameter !== undefined) {
            mast.diameter = modelMm(diameter, ui.mastPoint);
        } else if (ui.mastPoint !== 'partner') {
            mast.diameter = { ...mast.diameter, measurementPointId: ui.mastPoint };
        }
        mast.topmast = ui.tiers.includes('topmast');
        mast.topgallant = ui.tiers.includes('topgallant');
        for (const tier of TIERS) {
            const tierUsed = ui.tiers.includes(tier);
            mast.yards[tier] = ui.yards && tierUsed;
            mast.sails[tier] = ui.squareSails && tierUsed;
        }
    }

    settings.bowsprit.present = ui.bowsprit;
    if (defaults.bowspritDiameterMm !== undefined) {
        settings.bowsprit.diameter = modelMm(defaults.bowspritDiameterMm, ui.bowspritPoint);
    }
    settings.bowsprit.jibboom = ui.jibboom;
    settings.bowsprit.flyingJibboom = ui.jibboom;
    settings.bowsprit.martingale = ui.martingale;
    settings.bowsprit.spritsailYard = ui.spritsaill;
    settings.bowsprit.spritsailSail = ui.spritsaill;

    if (defaults.hullWidthMm !== undefined) {
        settings.hullWidth = modelMm(defaults.hullWidthMm, 'unknown');
    }
    if (defaults.gunBoreMm !== undefined) {
        settings.gun.bore = modelMm(defaults.gunBoreMm, 'working_section');
    }

    settings.anchor.present = ui.anchor && (defaults.anchor ?? true);
    settings.gun.present = ui.gun;

    for (const sailClass of SAIL_CLASSES) {
        settings.foreAndAft[sailClass].present = ui.foreAndAft.includes(sailClass);
    }

    settings.gaff.present = ui.gaff;
    settings.gaff.sailPresent = ui.gaff;

    settings.sailNodes = emptySailNodes();
    for (const mastId of MAST_IDS) {
        settings.sailNodes.main_sail[mastId] = ui.mainSail;
        settings.sailNodes.gaff[mastId] = ui.gaff;
        settings.sailNodes.gaff_sail[mastId] = ui.gaffSail;
        settings.sailNodes.boom[mastId] = ui.boom;
        settings.sailNodes.topsail[mastId] = ui.topsail;
        settings.sailNodes.head_lower[mastId] = ui.headSails && mastId === 'fore';
        settings.sailNodes.head_upper[mastId] = ui.headSails && mastId === 'fore';
        settings.sailNodes.staysail[mastId] = ui.staysail && mastId === 'mizzen';
        settings.sailNodes.flag[mastId] = ui.flag;
    }

    // traditional_plant задаёт гафель одним узлом через settings.gaff; для
    // профилей с гафельным вооружением узлы создаются по мачтам.
    if (ui.gaff && !ui.gaffSail) {
        for (const mastId of MAST_IDS) settings.sailNodes.gaff[mastId] = false;
        settings.gaff.present = true;
        settings.gaff.supportingMastId = 'mizzen';
    } else if (ui.gaffSail) {
        settings.gaff.present = false;
    }

    settings.lateenYard.present = ui.lateenYard;
    settings.lateenYard.supportingMastId = 'mizzen';
    settings.hullGroup = ui.hullGroup;

    return settings;
}

export function sailNodeKindsForUi(ui: ProfileUi): SailNodeKind[] {
    return SAIL_NODE_KINDS.filter((kind) => {
        if (kind === 'gaff') return ui.gaffSail;
        if (kind === 'gaff_sail') return ui.gaffSail;
        if (kind === 'boom') return ui.boom;
        if (kind === 'main_sail') return ui.mainSail;
        if (kind === 'topsail') return ui.topsail;
        if (kind === 'head_lower') return ui.headSails;
        if (kind === 'head_upper') return ui.headSails;
        if (kind === 'staysail') return ui.staysail;
        if (kind === 'flag') return ui.flag;
        return false;
    });
}

function node(
    nodeId: string,
    nodeType: RiggingNode['nodeType'],
    parentNodeId: string | null,
    ownerType: RiggingNode['ownerType'],
    ownerId: string,
    present: boolean | null,
    extra: Partial<RiggingNode> = {},
): RiggingNode {
    return {
        nodeId,
        nodeType,
        parentNodeId,
        ownerType,
        ownerId,
        present,
        ...extra,
    };
}

/**
 * Разворачивает компактную конфигурацию в полный набор узлов профиля.
 * Отсутствие мачты гасит её ярусы, реи, паруса и зависимые узлы; это не
 * является молчаливым расчётом отсутствующего узла.
 */
export function buildNodes(settings: RiggingSettings): RiggingNode[] {
    const nodes: RiggingNode[] = [];

    for (const mastId of MAST_IDS) {
        const mast = settings.masts[mastId];
        if (!mast.present) continue;

        const lowerId = `mast.${mastId}.lower`;
        const topmastId = `mast.${mastId}.topmast`;
        const topgallantId = `mast.${mastId}.topgallant`;

        nodes.push(node(lowerId, 'lower_mast', null, 'mast', mastId, true));

        const topmastPresent = mast.topmast;
        if (topmastPresent) {
            nodes.push(node(topmastId, 'topmast', lowerId, 'mast', mastId, true));
        }

        const topgallantPresent = topmastPresent && mast.topgallant;
        if (topgallantPresent) {
            nodes.push(node(topgallantId, 'topgallant', topmastId, 'mast', mastId, true));
        }

        for (const tier of TIERS) {
            if (tier === 'topmast' && !topmastPresent) continue;
            if (tier === 'topgallant' && !topgallantPresent) continue;
            if (!mast.yards[tier]) continue;

            const tierId =
                tier === 'lower' ? lowerId : tier === 'topmast' ? topmastId : topgallantId;

            nodes.push(
                node(`yard.${mastId}.${tier}`, 'yard', tierId, 'mast', mastId, true, {
                    tier,
                    sailPresent: mast.sails[tier],
                }),
            );
        }

        for (const kind of SAIL_NODE_KINDS) {
            if (!settings.sailNodes[kind]?.[mastId]) continue;
            if (kind === 'topsail' && !topmastPresent) continue;

            const parentId =
                kind === 'topsail'
                    ? topmastId
                    : kind === 'gaff_sail' && settings.sailNodes.gaff[mastId]
                      ? `gaff.${mastId}`
                      : lowerId;

            let sailPresent: boolean | undefined;
            if (kind === 'gaff') {
                // Гафель несёт признак «парус привязан»; сам парус — отдельный
                // узел gaff_sail, поэтому признак берётся из него.
                sailPresent = settings.sailNodes.gaff_sail[mastId];
            } else if (kind !== 'boom' && kind !== 'flag') {
                sailPresent = true;
            }

            nodes.push(
                node(kind === 'gaff' ? `gaff.${mastId}` : `${kind}.${mastId}`, kind, parentId, 'mast', mastId, true, {
                    supportingMastId: mastId,
                    ...(sailPresent === undefined ? {} : { sailPresent }),
                }),
            );
        }
    }

    for (const sailClass of SAIL_CLASSES) {
        const setting = settings.foreAndAft[sailClass];
        if (!setting.present || !settings.masts[setting.supportingMastId].present) continue;

        nodes.push(
            node(
                `sail.${sailClass}.${setting.supportingMastId}`,
                'fore_and_aft_sail',
                `mast.${setting.supportingMastId}.lower`,
                'mast',
                setting.supportingMastId,
                true,
                { sailClass, supportingMastId: setting.supportingMastId },
            ),
        );
    }

    if (settings.gaff.present && settings.masts[settings.gaff.supportingMastId].present) {
        const mastId = settings.gaff.supportingMastId;
        if (!nodes.some((entry) => entry.nodeId === `gaff.${mastId}`)) {
            nodes.push(
                node(`gaff.${mastId}`, 'gaff', `mast.${mastId}.lower`, 'mast', mastId, true, {
                    sailPresent: settings.gaff.sailPresent,
                    supportingMastId: mastId,
                }),
            );
        }
    }

    if (settings.lateenYard.present && settings.masts[settings.lateenYard.supportingMastId].present) {
        const mastId = settings.lateenYard.supportingMastId;
        nodes.push(
            node('lateen_yard', 'lateen_yard', `mast.${mastId}.lower`, 'mast', mastId, true, {
                sailPresent: settings.lateenYard.sailPresent,
                supportingMastId: mastId,
            }),
        );
    }

    const spar = settings.bowsprit;
    if (spar.present) {
        nodes.push(node('bowsprit', 'bowsprit', null, 'bowsprit', 'bowsprit', true));

        if (spar.jibboom) {
            nodes.push(node('jibboom', 'jibboom', 'bowsprit', 'bowsprit', 'bowsprit', true));
        }

        if (spar.jibboom && spar.flyingJibboom) {
            nodes.push(
                node('flying_jibboom', 'flying_jibboom', 'jibboom', 'bowsprit', 'bowsprit', true),
            );
        }

        if (spar.martingale) {
            nodes.push(node('martingale', 'martingale', 'bowsprit', 'bowsprit', 'bowsprit', true));
        }

        if (spar.spritsailYard) {
            nodes.push(
                node('spritsail_yard', 'spritsail_yard', 'bowsprit', 'bowsprit', 'bowsprit', true, {
                    sailPresent: spar.spritsailSail,
                }),
            );
        }
    }

    if (settings.hullGroup) {
        nodes.push(node('hull_group', 'hull_group', null, 'hull', 'hull', true));
    }

    if (settings.anchor.present) {
        nodes.push(
            node('anchor_group', 'anchor_group', null, 'anchor_group', 'anchor_group', true, {
                anchorConnection: settings.anchor.connection,
            }),
        );
    }

    if (settings.gun.present) {
        nodes.push(
            node('gun_group', 'gun_group', null, 'gun_group', 'gun_group', true, {
                gunType: settings.gun.gunType,
                mountingType: settings.gun.mountingType,
            }),
        );
    }

    return nodes;
}

export function buildInput(settings: RiggingSettings): RiggingInput {
    return {
        profileId: settings.profileId,
        profileVersion: settings.profileVersion ?? null,
        scaleDenominator: settings.scaleDenominator,
        measurements: {
            mastDiameter: {
                fore: cloneMeasurement(settings.masts.fore.diameter),
                main: cloneMeasurement(settings.masts.main.diameter),
                mizzen: cloneMeasurement(settings.masts.mizzen.diameter),
            },
            bowspritDiameter: cloneMeasurement(settings.bowsprit.diameter),
            hullWidth: cloneMeasurement(settings.hullWidth),
            gunBore: cloneMeasurement(settings.gun.bore),
        },
        nodes: buildNodes(settings),
    };
}

function cloneMeasurement(measurement: Measurement): Measurement {
    return { ...measurement };
}
