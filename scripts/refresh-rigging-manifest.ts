/**
 * Пересобирает data/rigging/index.json из файлов профилей.
 *
 * Профиль — JSON-документ, а манифест хранит его sha256. Любое изменение
 * байтов (правка, форматирование, перевод строки) требует обновления хеша,
 * иначе падает tests/rigging-profiles.test.ts.
 *
 * Использование:
 *   npm run rigging:manifest          # пересобрать манифест
 *   npm run rigging:manifest:check    # только проверить, не устарел ли он
 *
 * Документ проверяется тем же validateProfileDocument, что и рантайм.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateProfileDocument, type ProfileDocument } from '../src/lib/rigging/document.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data', 'rigging');
const PROFILES_DIR = join(DATA_DIR, 'profiles');
const MANIFEST_PATH = join(DATA_DIR, 'index.json');

const CHECK_ONLY = process.argv.includes('--check');

const STATUSES = new Set(['draft', 'published', 'deprecated']);

interface VersionEntry {
    version: string;
    status: string;
    document: string;
    sha256: string;
}

interface ManifestEntry {
    profileId: string;
    family: string;
    name: string;
    status: string;
    latest: string;
    versions: VersionEntry[];
}

interface Manifest {
    manifestVersion: string;
    schemaVersion: string;
    generatedAt: string;
    profiles: ManifestEntry[];
}

function fail(message: string): never {
    console.error(`✗ ${message}`);
    process.exit(1);
}

function compareVersions(a: string, b: string): number {
    const left = a.split('.').map(Number);
    const right = b.split('.').map(Number);
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
        const difference = (left[index] ?? 0) - (right[index] ?? 0);
        if (difference !== 0) return difference;
    }
    return 0;
}

function readExisting(): Manifest | null {
    if (!existsSync(MANIFEST_PATH)) return null;
    try {
        return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
    } catch {
        return fail('data/rigging/index.json не является валидным JSON.');
    }
}

function profileDirectories(): string[] {
    return readdirSync(PROFILES_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
}

function buildEntry(profileId: string): ManifestEntry {
    const directory = join(PROFILES_DIR, profileId);
    const files = readdirSync(directory)
        .filter((file) => file.endsWith('.json'))
        .sort();

    if (files.length === 0) {
        return fail(`Профиль ${profileId}: нет ни одного JSON-файла версии.`);
    }

    const versions: VersionEntry[] = [];
    let latestDoc: ProfileDocument | null = null;

    for (const file of files) {
        const path = join(directory, file);
        const text = readFileSync(path, 'utf8');
        let document: ProfileDocument;
        try {
            document = JSON.parse(text) as ProfileDocument;
        } catch (error) {
            return fail(
                `${profileId}/${file}: невалидный JSON — ${error instanceof Error ? error.message : String(error)}`,
            );
        }

        const issues = validateProfileDocument(document);
        if (issues.length > 0) {
            return fail(`${profileId}/${file}: нарушен контракт профиля:\n  - ${issues.join('\n  - ')}`);
        }

        if (document.profile.profileId !== profileId) {
            return fail(
                `${profileId}/${file}: profileId ${document.profile.profileId} не совпадает с папкой.`,
            );
        }

        const expectedFile = `${document.profile.profileVersion}.json`;
        if (file !== expectedFile) {
            return fail(`${profileId}/${file}: profileVersion должен совпадать с именем файла ${expectedFile}.`);
        }
        if (!STATUSES.has(document.profile.status)) {
            return fail(`${profileId}/${file}: неизвестный status ${document.profile.status}.`);
        }

        versions.push({
            version: document.profile.profileVersion,
            status: document.profile.status,
            document: `profiles/${profileId}/${file}`,
            sha256: createHash('sha256').update(text).digest('hex'),
        });

        if (!latestDoc || compareVersions(document.profile.profileVersion, latestDoc.profile.profileVersion) > 0) {
            latestDoc = document;
        }
    }

    versions.sort((a, b) => compareVersions(a.version, b.version));
    if (!latestDoc) return fail(`Профиль ${profileId}: не удалось определить latest.`);

    return {
        profileId,
        family: latestDoc.profile.family,
        name: latestDoc.profile.name,
        status: latestDoc.profile.status,
        latest: latestDoc.profile.profileVersion,
        versions,
    };
}

const existing = readExisting();
const existingOrder = existing?.profiles.map((entry) => entry.profileId) ?? [];
const directories = profileDirectories();

const orderedIds = [
    ...existingOrder.filter((profileId) => directories.includes(profileId)),
    ...directories.filter((profileId) => !existingOrder.includes(profileId)),
];

const profiles = orderedIds.map(buildEntry);

const manifest: Manifest = {
    manifestVersion: existing?.manifestVersion ?? '1.0.0',
    schemaVersion: existing?.schemaVersion ?? '1.0.0',
    // Не меняем дату при каждой правке: иначе любой запуск создаёт лишний diff.
    generatedAt: existing?.generatedAt ?? new Date().toISOString(),
    profiles,
};

const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
const current = existsSync(MANIFEST_PATH) ? readFileSync(MANIFEST_PATH, 'utf8') : '';

const oldHashes = new Map(
    (existing?.profiles ?? []).flatMap((entry) =>
        entry.versions.map((version) => [`${entry.profileId}@${version.version}`, version.sha256]),
    ),
);

for (const entry of profiles) {
    for (const version of entry.versions) {
        const key = `${entry.profileId}@${version.version}`;
        const old = oldHashes.get(key);
        if (!old) {
            console.log(`+ ${key}  ${version.sha256.slice(0, 12)}…  (новая версия)`);
        } else if (old !== version.sha256) {
            console.log(`~ ${key}  ${old.slice(0, 12)}… → ${version.sha256.slice(0, 12)}…`);
        }
    }
}

if (serialized === current) {
    console.log('✓ data/rigging/index.json актуален');
    process.exit(0);
}

if (CHECK_ONLY) {
    console.error('✗ data/rigging/index.json устарел. Выполните: npm run rigging:manifest');
    process.exit(1);
}

writeFileSync(MANIFEST_PATH, serialized);
console.log('✓ data/rigging/index.json обновлён');
