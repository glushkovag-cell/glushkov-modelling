/**
 * HTTP-обвязка эндпоинтов профилей: ETag, Cache-Control, CORS и единый формат
 * ошибок. Пространство имён /api/rigging/* не наследует tutorial-контроллеры.
 */

const SITE_ORIGINS = new Set([
    'https://www.glushkov-modelling.com',
    'https://glushkov-modelling.com',
    'http://localhost:4321',
]);

function isAllowedOrigin(origin: string): boolean {
    if (SITE_ORIGINS.has(origin)) return true;
    return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export function corsHeaders(origin: string | null): Record<string, string> {
    const headers: Record<string, string> = { vary: 'Origin, Accept-Encoding' };
    if (origin && isAllowedOrigin(origin)) {
        headers['access-control-allow-origin'] = origin;
        headers['access-control-allow-methods'] = 'GET, OPTIONS';
        headers['access-control-allow-headers'] = 'content-type, if-none-match';
        headers['access-control-max-age'] = '86400';
    }
    return headers;
}

export async function sha256Hex(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

export async function jsonWithEtag(
    request: Request,
    payload: unknown,
    cacheControl: string,
    status = 200,
): Promise<Response> {
    const body = JSON.stringify(payload);
    const etag = `"sha256:${await sha256Hex(body)}"`;
    const headers = {
        'content-type': 'application/json; charset=utf-8',
        etag,
        'cache-control': cacheControl,
        ...corsHeaders(request.headers.get('origin')),
    };

    if (request.headers.get('if-none-match') === etag) {
        return new Response(null, { status: 304, headers });
    }

    return new Response(body, { status, headers });
}

export async function apiError(
    request: Request,
    status: number,
    code: string,
    message: string,
    headers: Record<string, string> = {},
): Promise<Response> {
    return new Response(
        JSON.stringify({
            error: {
                code,
                message,
                requestId: request.headers.get('cf-ray') ?? crypto.randomUUID(),
            },
        }),
        {
            status,
            headers: {
                'content-type': 'application/json; charset=utf-8',
                'cache-control': 'no-store',
                ...corsHeaders(request.headers.get('origin')),
                ...headers,
            },
        },
    );
}

export function preflight(request: Request): Response {
    return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}
