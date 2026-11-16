/**
 * Разбор JSON-пресета модели.
 *
 * Экспорт проекта содержит `settings` (все введённые параметры), профиль и
 * выбранные нити. Импорт обязан сохранить `profileId` и зафиксированную
 * версию: молчаливая подстановка другой версии запрещена.
 */

import type { ProfileDocument } from './document.ts';
import type { RiggingSettings } from './settings.ts';
import { makeThreadPick, type ThreadPick } from './threadPick.ts';

export class PresetError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PresetError';
    }
}

export interface ParsedPresetThread {
    /** Стабильный ключ строки ведомости. */
    rowKey: string;
    pick: ThreadPick;
}

export interface ParsedPreset {
    settings: RiggingSettings;
    threadPicks: ParsedPresetThread[];
}

function parseThreadPicks(value: unknown): ParsedPresetThread[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        throw new PresetError('The preset has invalid threads.');
    }

    const picks: ParsedPresetThread[] = [];
    for (const [index, raw] of value.entries()) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new PresetError(`Thread pick ${index + 1} is not an object.`);
        }
        const entry = raw as Record<string, unknown>;
        const rowKey = typeof entry.rowKey === 'string' ? entry.rowKey.trim() : '';
        if (!rowKey) {
            throw new PresetError(`Thread pick ${index + 1} has no rowKey.`);
        }

        const threadId =
            typeof entry.thread_id === 'string'
                ? entry.thread_id.trim()
                : typeof entry.threadId === 'string'
                  ? entry.threadId.trim()
                  : '';
        if (!threadId) {
            throw new PresetError(`Thread pick ${index + 1} has no thread_id.`);
        }
        if (
            typeof entry.brand !== 'string' ||
            entry.brand === '' ||
            typeof entry.number !== 'string' ||
            entry.number === ''
        ) {
            throw new PresetError(`Thread pick ${index + 1} has no brand or number.`);
        }

        const pick = makeThreadPick(
            {
                threadId,
                brand: entry.brand,
                number: entry.number,
                dtex: entry.dtex as number,
                threadsPerStrand: entry.threadsPerStrand as number,
                diameterMm: entry.diameterMm as number,
                deviationPercent: entry.deviationPercent as number,
            },
            entry.targetMm as number,
            entry.rowDiameterMm as number,
        );
        if (!pick) {
            throw new PresetError(`Thread pick ${index + 1} has invalid measurements.`);
        }

        picks.push({ rowKey, pick });
    }

    return picks;
}

/**
 * Разбирает как полный экспорт проекта, так и «голый» settings.
 * @param text содержимое JSON-файла
 * @param versions доступные версии: profileId → profileVersion
 */
export function parsePreset(
    text: string,
    versions: ReadonlyMap<string, string>,
): ParsedPreset {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new PresetError('The file is not valid JSON.');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new PresetError('The file does not contain a rigging preset.');
    }

    const container = parsed as { settings?: unknown; threads?: unknown } & Record<
        string,
        unknown
    >;
    const candidate = container.settings ?? container;

    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw new PresetError('The preset has no settings object.');
    }

    const settings = candidate as Partial<RiggingSettings>;
    if (typeof settings.profileId !== 'string' || settings.profileId === '') {
        throw new PresetError('The preset has no profileId.');
    }
    if (!versions.has(settings.profileId)) {
        throw new PresetError(`Preset profile ${settings.profileId} is not available.`);
    }
    if (
        typeof settings.profileVersion === 'string' &&
        settings.profileVersion !== '' &&
        settings.profileVersion !== versions.get(settings.profileId)
    ) {
        throw new PresetError(
            `Preset profile version ${settings.profileVersion} is not available ` +
                `(current ${versions.get(settings.profileId)}).`,
        );
    }
    if (typeof settings.scaleDenominator !== 'number' || !(settings.scaleDenominator > 0)) {
        throw new PresetError('The preset has no valid scaleDenominator.');
    }
    if (!settings.masts || typeof settings.masts !== 'object') {
        throw new PresetError('The preset has no mast settings.');
    }

    return {
        settings: settings as RiggingSettings,
        threadPicks: parseThreadPicks(container.threads),
    };
}

/** Совместимый помощник: только настройки, без нитей. */
export function parsePresetJson(
    text: string,
    versions: ReadonlyMap<string, string>,
): RiggingSettings {
    return parsePreset(text, versions).settings;
}

/** Карта доступных версий для parsePreset. */
export function profileVersions(
    documents: readonly ProfileDocument[],
): Map<string, string> {
    return new Map(
        documents.map((document) => [
            document.profile.profileId,
            document.profile.profileVersion,
        ]),
    );
}
