import type { APIRoute } from 'astro';

import { apiError, jsonWithEtag, preflight } from '../../../../lib/rigging/apiResponse.ts';
import { getManifest, profileStoreErrors } from '../../../../lib/rigging/profileStore.ts';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
    const errors = profileStoreErrors();
    if (errors.length > 0) {
        return apiError(
            request,
            500,
            'profile_contract_violation',
            errors[0] ?? 'Profile contract violation.',
        );
    }

    return jsonWithEtag(request, getManifest(), 'public, max-age=60, must-revalidate');
};

export const OPTIONS: APIRoute = ({ request }) => preflight(request);
