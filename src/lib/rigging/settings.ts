/**
 * Компактная конфигурация для интерфейса и преобразование в узлы профиля.
 *
 * Ядро принимает уже развёрнутый список узлов. Этот модуль нужен, чтобы UI не
 * собирал вручную десятки nodeId и чтобы тесты могли описать конфигурацию
 * коротко. Числа по умолчанию — демонстрационные размеры модели, а не
 * историческая ведомость.
 */

import type {
    AnchorConnection,
    GunType,
    HistoricalContext,
    MastId,
    Measurement,
    MountingType,
    RiggingInput,
    RiggingNode,
    SailClass,
    Tier,
} from './types.ts';
import { PROFILE_ID } from './types.ts';
import { MAST_IDS, SAIL_CLASSES, TIERS } from './profile.ts';

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

export interface RiggingSettings {
    profileId: string;
    historicalContext: HistoricalContext;
    scaleDenominator: number;
    masts: Record<MastId, MastSettings>;
    bowsprit: BowspritSettings;
    hullWidth: Measurement;
    anchor: AnchorSettings;
    gun: GunSettings;
    foreAndAft: Record<SailClass, ForeAndAftSetting>;
    gaff: GaffSettings;
}

function modelMm(value: number, point: Measurement['measurementPointId'] = 'partner'): Measurement {
    return {
        value,
        unitId: 'mm',
        basis: 'model',
        measurementPointId: point,
    };
}

export function defaultSettings(): RiggingSettings {
    return {
        profileId: PROFILE_ID,
        historicalContext: {
            mode: null,
            year: null,
            periodFrom: null,
            periodTo: null,
        },
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
    };
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
 * Отсутствие мачты гасит её ярусы, реи и паруса; это не является молчаливым
 * расчётом отсутствующего узла.
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
        nodes.push(
            node(
                `gaff.${settings.gaff.supportingMastId}`,
                'gaff',
                `mast.${settings.gaff.supportingMastId}.lower`,
                'mast',
                settings.gaff.supportingMastId,
                true,
                {
                    sailPresent: settings.gaff.sailPresent,
                    supportingMastId: settings.gaff.supportingMastId,
                },
            ),
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
