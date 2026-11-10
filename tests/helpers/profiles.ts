/**
 * Загрузка документов профилей в Node-тестах.
 *
 * В браузере/SSR документы приходят через import.meta.glob (profileStore.ts),
 * в Worker — по HTTP. Тесты читают те же файлы с диска, чтобы источник истины
 * оставался один.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type {
    ProfileDocument,
    ProfileManifest,
} from '../../src/lib/rigging/document.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const PROFILES_DIR = join(ROOT, 'data', 'rigging', 'profiles');

export function loadDocument(profileId: string, version: string): ProfileDocument {
    const path = join(PROFILES_DIR, profileId, `${version}.json`);
    return JSON.parse(readFileSync(path, 'utf8')) as ProfileDocument;
}

export function loadAllDocuments(): ProfileDocument[] {
    const documents: ProfileDocument[] = [];
    for (const entry of readdirSync(PROFILES_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const directory = join(PROFILES_DIR, entry.name);
        for (const file of readdirSync(directory)) {
            if (!file.endsWith('.json')) continue;
            documents.push(
                JSON.parse(readFileSync(join(directory, file), 'utf8')) as ProfileDocument,
            );
        }
    }
    return documents;
}

export function loadManifest(): ProfileManifest {
    return JSON.parse(
        readFileSync(join(ROOT, 'data', 'rigging', 'index.json'), 'utf8'),
    ) as ProfileManifest;
}

export const TRADITIONAL = (): ProfileDocument => loadDocument('traditional_plant', '1.0.0');
export const YACHT = (): ProfileDocument => loadDocument('yacht_metal_yacht', '1.0.0');
export const SCHOONER = (): ProfileDocument => loadDocument('yacht_metal_schooner', '1.0.0');
export const EARLY = (): ProfileDocument => loadDocument('early_plant', '1.2.1');
