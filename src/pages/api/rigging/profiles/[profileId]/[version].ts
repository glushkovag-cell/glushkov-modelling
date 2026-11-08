import type { APIRoute } from 'astro';

import { apiError, jsonWithEtag, preflight } from '../../../../../lib/rigging/apiResponse.ts';
import { getProfileDocument, profileStoreErrors } from '../../../../../lib/rigging/profileStore.ts';
import { SCHEMA_VERSION } from '../../../../../lib/rigging/types.ts';

export const prerender = false;

export const GET: APIRoute = async ({ request, params }) => {
    const profileId = params.profileId ?? '';
    const version = params.version ?? '';

    const errors = profileStoreErrors().filter((error) => error.startsWith(`${profileId}@`));
    if (errors.length > 0) {
        return apiError(request, 500, 'profile_contract_violation', errors[0] as string);
    }

    const document = getProfileDocument(profileId, version);
    if (!document) {
        return apiError(
            request,
            404,
            'version_not_found',
            `Unknown profile version: ${profileId}@${version}.`,
        );
    }
    if (document.profile.schemaVersion !== SCHEMA_VERSION) {
        return apiError(
            request,
            422,
            'unsupported_schema',
            `Profile schemaVersion ${document.profile.schemaVersion} is not supported.`,
        );
    }

    return jsonWithEtag(request, document, 'public, max-age=31536000, immutable', 200);
};

export const OPTIONS: APIRoute = ({ request }) => preflight(request);
