/**
 * Разбор JSON-пресета модели.
 *
 * Экспорт проекта содержит `settings` (все введённые параметры) и профиль.
 * Импорт обязан сохранить `profileId` и зафиксированную версию: молчаливая
 * подстановка другой версии запрещена.
 */

import type { ProfileDocument } from './document.ts';
import type { RiggingSettings } from './settings.ts';

export class PresetError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PresetError';
    }
}

/**
 * @param text содержимое JSON-файла
 * @param versions доступные версии: profileId → profileVersion
 */
export function parsePresetJson(
    text: string,
    versions: ReadonlyMap<string, string>,
): RiggingSettings {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new PresetError('The file is not valid JSON.');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new PresetError('The file does not contain a rigging preset.');
    }

    const container = parsed as { settings?: unknown } & Record<string, unknown>;
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

    return settings as RiggingSettings;
}

/** Карта доступных версий для parsePresetJson. */
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
