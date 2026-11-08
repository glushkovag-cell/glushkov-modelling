/**
 * Доставка документов профилей в Worker.
 *
 * Документы не входят в бандл Worker (никакого snapshot): они читаются с
 * сайта по HTTP и кэшируются в caches.default. Версия — immutable на год,
 * «последняя» — короткий TTL. При сетевой ошибке используется закэтированная
 * копия; если её нет — 503, без подстановки другого профиля.
 */

import { validateProfileDocument, type ProfileDocument, type ProfileManifest } from '../../../src/lib/rigging/document.ts';

export interface ProfileEnv {
  /** База сайта с /api/rigging/profiles; в тестах можно подменить. */
  PROFILES_BASE_URL?: string;
  /** Тестовый шов: готовый манифест без сети. */
  PROFILE_MANIFEST?: ProfileManifest;
  /** Тестовый шов: готовые документы по ключу `${profileId}@${version}`. */
  PROFILE_DOCUMENTS?: Record<string, ProfileDocument>;
}

const DEFAULT_BASE = 'https://www.glushkov-modelling.com';

export class ProfileUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileUnavailableError';
  }
}

function baseUrl(env: ProfileEnv): string {
  return (env.PROFILES_BASE_URL ?? DEFAULT_BASE).replace(/\/+$/, '');
}

function cacheApi(): Cache | null {
  try {
    // caches.default есть в Workers, но не в стандартном типе CacheStorage.
    const storage = caches as unknown as { default?: Cache };
    return typeof caches !== 'undefined' && storage.default ? storage.default : null;
  } catch {
    return null;
  }
}

async function fetchJson(url: string): Promise<unknown | null> {
  const cache = cacheApi();
  const request = new Request(url, { headers: { accept: 'application/json' } });

  if (cache) {
    const cached = await cache.match(request);
    if (cached) return cached.json();
  }

  let response: Response;
  try {
    response = await fetch(request);
  } catch {
    throw new ProfileUnavailableError(`Profile source is unreachable: ${url}`);
  }

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new ProfileUnavailableError(
      `Profile source returned ${response.status} for ${url}`,
    );
  }

  if (cache) {
    try {
      await cache.put(request, response.clone());
    } catch {
      // Кэш — оптимизация, не источник истины.
    }
  }

  return response.json();
}

export async function loadManifest(env: ProfileEnv): Promise<ProfileManifest> {
  if (env.PROFILE_MANIFEST) return env.PROFILE_MANIFEST;

  const payload = (await fetchJson(`${baseUrl(env)}/api/rigging/profiles`)) as
    | ProfileManifest
    | null;
  if (!payload || !Array.isArray(payload.profiles)) {
    throw new ProfileUnavailableError('Profile manifest is unavailable.');
  }
  return payload;
}

function fromTestSeam(
  profileId: string,
  version: string | null | undefined,
  documents: Record<string, ProfileDocument>,
): ProfileDocument | null {
  if (version) return documents[`${profileId}@${version}`] ?? null;

  let best: ProfileDocument | null = null;
  for (const [key, document] of Object.entries(documents)) {
    if (!key.startsWith(`${profileId}@`)) continue;
    if (!best || compareVersions(document.profile.profileVersion, best.profile.profileVersion) > 0) {
      best = document;
    }
  }
  return best;
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

export async function loadProfileDocument(
  profileId: string,
  version: string | null | undefined,
  env: ProfileEnv,
): Promise<ProfileDocument | null> {
  if (env.PROFILE_DOCUMENTS) {
    return fromTestSeam(profileId, version, env.PROFILE_DOCUMENTS);
  }

  const path = version
    ? `/api/rigging/profiles/${encodeURIComponent(profileId)}/${encodeURIComponent(version)}`
    : `/api/rigging/profiles/${encodeURIComponent(profileId)}`;
  const payload = (await fetchJson(`${baseUrl(env)}${path}`)) as ProfileDocument | null;

  if (!payload) return null;

  const issues = validateProfileDocument(payload);
  if (issues.length > 0) {
    throw new ProfileUnavailableError(
      `Profile ${profileId} violates the contract: ${issues[0]}`,
    );
  }

  if (payload.profile.profileId !== profileId) {
    throw new ProfileUnavailableError(
      `Profile source returned ${payload.profile.profileId} for ${profileId}.`,
    );
  }

  return payload;
}
