/**
 * Реестр расчётных профилей и подбор по году/периоду.
 *
 * На момент MVP в реестре один профиль traditional_plant в статусе draft без
 * подтверждённого исторического диапазона (yearFrom/yearTo = null). Поэтому он
 * не выдаётся как автоматически подходящий под введённый год, а показывается
 * для явного выбора с честной пометкой. Логика подбора по опубликованным
 * профилям уже заложена и активируется, когда появятся published-профили.
 */

import { PROFILE_ID, PROFILE_VERSION, type HistoricalContext } from './types.ts';

export type ProfileStatus = 'draft' | 'verified' | 'published' | 'deprecated';

export interface ProfileMeta {
    profileId: string;
    profileVersion: string;
    name: string;
    status: ProfileStatus;
    yearFrom: number | null;
    yearTo: number | null;
    description: string;
    riggingFamilies: string[];
    materialConditions: string[];
    exclusions: string[];
    applicabilityNotes: string;
    sources: string[];
}

export type ProfileMatchKind =
    | 'in_range'
    | 'partial_overlap'
    | 'draft_unconfirmed'
    | 'no_range';

export interface ProfileMatch {
    profile: ProfileMeta;
    match: ProfileMatchKind;
    note: string;
}

export const PROFILE_REGISTRY: ProfileMeta[] = [
    {
        profileId: PROFILE_ID,
        profileVersion: PROFILE_VERSION,
        name: 'Traditional plant rigging',
        status: 'published',
        yearFrom: 1625,
        yearTo: 1860,
        description:
            'Estimate profile for traditional fibre rigging of square-rigged vessels, headsails, staysails and a gaff sail.',
        riggingFamilies: ['traditional_plant'],
        materialConditions: ['fiber'],
        exclusions: [
            'topgallant sails and beyond (bomb-topsails, studding sails)',
            'boat, lateen and yacht rigging',
            'metal element geometry (wire, chain, rod)',
        ],
        applicabilityNotes:
            'Range 1625–1860 follows the scope of James Lees, "The Masting and Rigging of English Ships of War, 1625–1860". The diameter ratios remain engineering estimates or a preliminary fit, not a verbatim historical table.',
        sources: [
            'James Lees, The Masting and Rigging of English Ships of War, 1625–1860 (range accepted as the profile applicability scope).',
        ],
    },
];

/**
 * Подбор профилей. Опубликованные профили сопоставляются по диапазону;
 * draft-профили без диапазона возвращаются как draft_unconfirmed для явного
 * выбора и никогда не выдаются за published-совпадение.
 */
export function findSuitableProfiles(context: HistoricalContext): ProfileMatch[] {
    const matches: ProfileMatch[] = [];

    for (const profile of PROFILE_REGISTRY) {
        if (profile.status !== 'published') {
            matches.push({
                profile,
                match: 'draft_unconfirmed',
                note: 'Draft — applicability range not yet confirmed. Shown for explicit selection, not as a published match.',
            });
            continue;
        }

        if (profile.yearFrom === null || profile.yearTo === null) {
            matches.push({
                profile,
                match: 'no_range',
                note: 'Published profile without a confirmed range.',
            });
            continue;
        }

        if (context.mode === 'year') {
            if (context.year === null) continue;
            const within = profile.yearFrom <= context.year && context.year <= profile.yearTo;
            if (!within) continue;
            matches.push({
                profile,
                match: 'in_range',
                note: `Matches the entered year (profile range ${profile.yearFrom}–${profile.yearTo}).`,
            });
            continue;
        }

        if (context.mode === 'period') {
            if (context.periodFrom === null || context.periodTo === null) continue;
            const overlaps =
                profile.yearFrom <= context.periodTo && profile.yearTo >= context.periodFrom;
            if (!overlaps) continue;
            const full =
                profile.yearFrom <= context.periodFrom && context.periodTo <= profile.yearTo;
            matches.push({
                profile,
                match: full ? 'in_range' : 'partial_overlap',
                note: full
                    ? `Covers the entered period (profile range ${profile.yearFrom}–${profile.yearTo}).`
                    : `Partial coverage: profile range ${profile.yearFrom}–${profile.yearTo}.`,
            });
            continue;
        }
    }

    return matches;
}
