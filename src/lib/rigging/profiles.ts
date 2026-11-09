/**
 * Сводки профилей для интерфейса и API.
 *
 * Профиль выбирается явно; год и исторический период профиль не выбирают.
 * Никакого автоматического подбора по году здесь нет — только сортировка и
 * представление уже загруженных документов.
 */

import type {
    ProfileDocument,
    ProfileManifestEntry,
    ProfileMetrics,
    ProfilePublicationStatus,
} from './document.ts';

/**
 * Структурированное пояснение к карточке профиля. Строки показываются
 * раздельно; числа берутся из документа, а не дублируются в разметке.
 */
export interface ProfileExplanation {
    /** «135 rule definitions: 27 standing, 63 running.» */
    summary: string;
    /** «A row in the results does not assert that a rope was historically fitted.» */
    disclaimer: string;
    /** «Groups: … · Materials: …» */
    taxonomy: string;
    /** «Calibration: 8 fitted roles · MAPE 32.3% · worst deviation —%.» */
    calibration: string | null;
    /** Уточнение к калибровке (MAPE, перенос между reference). */
    accuracy: string | null;
    /** Короткая оговорка профиля: «These are estimated diameters…». */
    caveat: string | null;
}

/**
 * Какие размерные базы реально использует профиль. Это не то же самое, что
 * видимость блока формы: например, early_plant показывает якорный блок, но
 * якорный канат считает от самой толстой мачты G, а не от ширины корпуса.
 */
export interface ProfileRequirements {
    mast: boolean;
    bowsprit: boolean;
    hullWidth: boolean;
    gunBore: boolean;
}

export interface ProfileSummary {
    profileId: string;
    profileVersion: string;
    family: string;
    name: string;
    status: ProfilePublicationStatus;
    yearFrom: number | null;
    yearTo: number | null;
    description: string;
    ruleCount: number;
    groups: string[];
    materialConditions: string[];
    warnings: string[];
    metrics: ProfileMetrics | null;
    explanation: ProfileExplanation;
    requirements: ProfileRequirements;
    ui: ProfileDocument['profile']['ui'];
}

const GROUP_ORDER = ['standing', 'running', 'bowsprit', 'anchor', 'gun'];

export function profileRequirements(document: ProfileDocument): ProfileRequirements {
    const kinds = new Set(document.rules.map((rule) => rule.base.kind));
    return {
        mast: kinds.has('mast') || kinds.has('thickestMast'),
        bowsprit: kinds.has('bowsprit'),
        hullWidth: kinds.has('hullWidth'),
        gunBore: kinds.has('gunBore'),
    };
}

const DISCLAIMER =
    'A row in the results does not assert that a rope was historically fitted.';

function countGroup(document: ProfileDocument, group: string): number {
    return document.rules.filter((rule) => rule.group === group).length;
}

function percent(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    return String(value);
}

function firstSentence(text: string): string {
    const match = text.match(/^.*?[.!?](?=\s|$)/);
    return (match?.[0] ?? text).trim();
}

function calibrationLine(metrics: ProfileMetrics | null): string | null {
    if (!metrics) return null;
    const transfer =
        metrics.crossTransferMaxPercent === null || metrics.crossTransferMaxPercent === undefined
            ? ''
            : ` · worst transfer ${percent(metrics.crossTransferMaxPercent)}%`;
    return (
        `Calibration: ${metrics.fittedRoles ?? '—'} fitted roles · ` +
        `MAPE ${percent(metrics.mapePercent)}% · ` +
        `worst deviation ${percent(metrics.maxDeviationPercent)}%${transfer}.`
    );
}

/** Краткое описание профиля без коэффициентов. */
export function summariseProfile(document: ProfileDocument): ProfileSummary {
    const groups = [...new Set(document.rules.map((rule) => rule.group))].sort(
        (a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b),
    );
    const metrics = document.profile.metrics ?? null;
    const warnings = [...document.profile.warnings];

    return {
        profileId: document.profile.profileId,
        profileVersion: document.profile.profileVersion,
        family: document.profile.family,
        name: document.profile.name,
        status: document.profile.status,
        yearFrom: document.profile.yearFrom,
        yearTo: document.profile.yearTo,
        description: describe(document),
        ruleCount: document.rules.length,
        groups,
        materialConditions: [...document.profile.materialConditions],
        warnings,
        metrics,
        requirements: profileRequirements(document),
        explanation: {
            summary:
                `${document.rules.length} rule definitions: ` +
                `${countGroup(document, 'standing')} standing, ` +
                `${countGroup(document, 'running')} running.`,
            disclaimer: DISCLAIMER,
            taxonomy:
                `Groups: ${groups.join(', ')} · ` +
                `Materials: ${document.profile.materialConditions.join(', ')}.`,
            calibration: calibrationLine(metrics),
            accuracy: metrics?.cardNote?.trim() || null,
            caveat: warnings[0] ? firstSentence(warnings[0]) : null,
        },
        ui: document.profile.ui,
    };
}

function describe(document: ProfileDocument): string {
    const total = document.rules.length;
    const standing = countGroup(document, 'standing');
    const running = countGroup(document, 'running');
    const draft = document.profile.status === 'draft' ? 'Draft, not published. ' : '';
    return `${draft}${total} rule definitions: ${standing} standing, ${running} running. ${DISCLAIMER}`;
}

export function sortProfilesByManifest(
    documents: ProfileDocument[],
    entries: ProfileManifestEntry[],
): ProfileDocument[] {
    const order = new Map(entries.map((entry, index) => [entry.profileId, index]));
    return [...documents].sort(
        (a, b) =>
            (order.get(a.profile.profileId) ?? 999) - (order.get(b.profile.profileId) ?? 999),
    );
}

export function manifestEntryFor(document: ProfileDocument): ProfileManifestEntry {
    return {
        profileId: document.profile.profileId,
        family: document.profile.family,
        name: document.profile.name,
        status: document.profile.status,
        latest: document.profile.profileVersion,
        versions: [
            {
                version: document.profile.profileVersion,
                status: document.profile.status,
                document: `profiles/${document.profile.profileId}/${document.profile.profileVersion}.json`,
                sha256: '',
            },
        ],
    };
}
