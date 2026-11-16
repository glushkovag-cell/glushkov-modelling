/**
 * Контрольная конфигурация ведомости для тестов представления.
 *
 * `fullSettingsFor` включает все узлы, которые поддерживает документ профиля.
 * Это не «историческая ведомость» и не рекомендуемая конфигурация: набор
 * нужен, чтобы контрольный расчёт покрывал максимум строк, а тесты
 * группировки, фильтров и поиска работали на реальном объёме.
 */

import { createHash } from 'node:crypto';

import {
    SAIL_NODE_KINDS,
    defaultSettingsForProfile,
    sailNodeKindsForUi,
    type RiggingSettings,
} from '../../src/lib/rigging/settings.ts';
import { SAIL_CLASSES, TIERS } from '../../src/lib/rigging/profile.ts';
import { MAST_IDS, type RiggingResult } from '../../src/lib/rigging/types.ts';
import type { ProfileDocument } from '../../src/lib/rigging/document.ts';
import { ledgerRowKey } from '../../src/lib/rigging/ledgerKey.ts';

/** Все поддерживаемые профилем блоки включены; размеры — из defaults профиля. */
export function fullSettingsFor(document: ProfileDocument): RiggingSettings {
    const settings = defaultSettingsForProfile(document);
    const ui = document.profile.ui;
    const sailKinds = new Set(sailNodeKindsForUi(ui));

    for (const mastId of MAST_IDS) {
        const mast = settings.masts[mastId];
        mast.present = ui.masts;
        mast.topmast = ui.tiers.includes('topmast');
        mast.topgallant = ui.tiers.includes('topgallant');
        for (const tier of TIERS) {
            mast.yards[tier] = ui.yards && ui.tiers.includes(tier);
            mast.sails[tier] = ui.squareSails && ui.tiers.includes(tier);
        }
        for (const kind of SAIL_NODE_KINDS) {
            settings.sailNodes[kind][mastId] = sailKinds.has(kind) && mast.present;
        }
    }

    settings.bowsprit.present = ui.bowsprit;
    settings.bowsprit.jibboom = ui.jibboom;
    settings.bowsprit.flyingJibboom = ui.jibboom;
    settings.bowsprit.martingale = ui.martingale;
    settings.bowsprit.spritsailYard = ui.spritsaill;
    settings.bowsprit.spritsailSail = ui.spritsaill;
    settings.anchor.present = ui.anchor;
    settings.gun.present = ui.gun;

    for (const sailClass of SAIL_CLASSES) {
        settings.foreAndAft[sailClass].present = ui.foreAndAft.includes(sailClass);
    }

    settings.gaff.present = ui.gaff && !ui.gaffSail;
    settings.gaff.sailPresent = ui.gaff && !ui.gaffSail;
    settings.lateenYard.present = ui.lateenYard;
    settings.lateenYard.sailPresent = ui.lateenYard;
    settings.hullGroup = ui.hullGroup;

    return settings;
}

/**
 * Компактная проекция результата для контрольного снимка: ключ строки и
 * значения, которые не должны измениться при доработке интерфейса.
 * Порядок строк сохраняется — это порядок профиля (sortIndex).
 */
export interface ControlRow {
    key: string;
    group: string;
    tier: string | null;
    variant: string | null;
    status: string;
    modelMm: number | null;
    prototypeMm: number | null;
    material: string;
    basis: string;
}

export function controlRows(results: readonly RiggingResult[]): ControlRow[] {
    return results.map((result) => ({
        key: ledgerRowKey(result),
        group: result.group,
        tier: result.tier ?? null,
        variant: result.variant ?? null,
        status: result.status,
        modelMm: result.diameterModelMm,
        prototypeMm: result.diameterPrototypeMm,
        material: result.material,
        basis: result.coefficientBasis,
    }));
}

/** SHA-256 по канонической JSON-проекции; фиксирует значения и порядок строк. */
export function controlDigest(rows: readonly ControlRow[]): string {
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
