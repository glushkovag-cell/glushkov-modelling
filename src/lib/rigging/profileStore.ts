/**
 * Серверный загрузчик профилей для Astro SSR.
 *
 * Документы лежат в data/rigging и попадают в серверный бандл на сборке
 * (import.meta.glob), поэтому рантайм не читает диск и не зависит от рабочего
 * каталога. Рантайм имеет один контракт: документ профиля и манифест.
 *
 * Worker сюда не импортирует: он получает те же документы по HTTP и кэширует
 * их в caches.default (см. rigging-calculator-worker/src/profiles/client.ts).
 */

import {
    validateProfileDocument,
    type ProfileDocument,
    type ProfileManifest,
    type ProfileManifestEntry,
} from './document.ts';
import { sortProfilesByManifest } from './profiles.ts';

const documentModules = import.meta.glob('../../../data/rigging/profiles/*/*.json', {
    eager: true,
    import: 'default',
}) as Record<string, ProfileDocument>;

const manifestModules = import.meta.glob('../../../data/rigging/index.json', {
    eager: true,
    import: 'default',
}) as Record<string, ProfileManifest>;

export const PROFILE_STORE_ERRORS: string[] = [];

function compareVersions(a: string, b: string): number {
    const left = a.split('.').map(Number);
    const right = b.split('.').map(Number);
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
        const difference = (left[index] ?? 0) - (right[index] ?? 0);
        if (difference !== 0) return difference;
    }
    return 0;
}

const byKey = new Map<string, ProfileDocument>();
const byId = new Map<string, ProfileDocument[]>();

for (const document of Object.values(documentModules)) {
    const issues = validateProfileDocument(document);
    if (issues.length > 0) {
        for (const issue of issues) {
            PROFILE_STORE_ERRORS.push(
                `${document?.profile?.profileId ?? 'unknown'}@${document?.profile?.profileVersion ?? 'unknown'}: ${issue}`,
            );
        }
        continue;
    }
    const key = `${document.profile.profileId}@${document.profile.profileVersion}`;
    byKey.set(key, document);
    const versions = byId.get(document.profile.profileId) ?? [];
    versions.push(document);
    versions.sort((a, b) =>
        compareVersions(b.profile.profileVersion, a.profile.profileVersion),
    );
    byId.set(document.profile.profileId, versions);
}

const committedManifest = Object.values(manifestModules)[0];

export function getManifest(): ProfileManifest {
    if (committedManifest) return committedManifest;

    const entries: ProfileManifestEntry[] = [];
    for (const [profileId, versions] of byId) {
        const latest = versions[0];
        if (!latest) continue;
        entries.push({
            profileId,
            family: latest.profile.family,
            name: latest.profile.name,
            status: latest.profile.status,
            latest: latest.profile.profileVersion,
            versions: versions.map((document) => ({
                version: document.profile.profileVersion,
                status: document.profile.status,
                document: `profiles/${profileId}/${document.profile.profileVersion}.json`,
                sha256: '',
            })),
        });
    }
    return {
        manifestVersion: '1.0.0',
        schemaVersion: '1.0.0',
        generatedAt: new Date(0).toISOString(),
        profiles: entries,
    };
}

/** Все профили, в порядке манифеста, по последней версии каждого. */
export function listProfileDocuments(): ProfileDocument[] {
    const latest = [...byId.values()].map((versions) => versions[0]).filter(Boolean);
    return sortProfilesByManifest(latest as ProfileDocument[], getManifest().profiles);
}

export function getProfileDocument(
    profileId: string,
    version?: string | null,
): ProfileDocument | null {
    if (version) return byKey.get(`${profileId}@${version}`) ?? null;
    return byId.get(profileId)?.[0] ?? null;
}

export function listProfileVersions(profileId: string): ProfileDocument[] {
    return [...(byId.get(profileId) ?? [])];
}

/** Проверка целостности для CI и для страницы: пустой массив — всё хорошо. */
export function profileStoreErrors(): string[] {
    return [...PROFILE_STORE_ERRORS];
}
