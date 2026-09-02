import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { Pool } from 'pg';

const MAX_BODY_BYTES = 32 * 1024;

const PERPLEXITY_DOMAINS = new Set([
    'perplexity.ai',
    'perplexity.com',
]);

const URI_METADATA_FIELDS = Object.freeze([
    'redirect_uris',
    'client_uri',
    'logo_uri',
    'tos_uri',
    'policy_uri',
    'jwks_uri',
    'sector_identifier_uri',
    'request_uris',
    'initiate_login_uri',
]);

const config = {
    port: Number(process.env.PORT ?? 8082),
    realm: process.env.REALM ?? 'public-mcp',
    keycloakOrigin: (process.env.KEYCLOAK_ORIGIN ?? 'http://keycloak:8080').replace(/\/$/, ''),
    publicOrigin: (process.env.PUBLIC_AUTH_ORIGIN ?? 'https://auth.glushkov-modelling.com').replace(/\/$/, ''),
};

const pool = new Pool({
    host: process.env.AUDIT_DB_HOST,
    port: Number(process.env.AUDIT_DB_PORT ?? 5432),
    database: process.env.AUDIT_DB_NAME,
    user: process.env.AUDIT_DB_USER,
    password: process.env.AUDIT_DB_PASSWORD,
    connectionTimeoutMillis: 1500,
});

const discoveryPath = `/realms/${config.realm}/.well-known/openid-configuration`;
const registrationPath = `/realms/${config.realm}/clients-registrations/openid-connect`;

function reply(res, status, body, requestId, headers = {}) {
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-request-id': requestId,
        ...headers,
    });
    res.end(JSON.stringify(body));
}

function canonicalHost(hostname) {
    const host = hostname.toLowerCase().replace(/\.$/, '');
    return ['localhost', '127.0.0.1', '::1'].includes(host) ? 'localhost' : host;
}

function valuesForUriMetadataField(value) {
    if (typeof value === 'string') {
        return [value];
    }

    if (Array.isArray(value)) {
        return value.filter((item) => typeof item === 'string');
    }

    return [];
}

function uriMetadata(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return [];
    }

    const seen = new Set();
    const values = [];

    for (const field of URI_METADATA_FIELDS) {
        for (const uri of valuesForUriMetadataField(payload[field])) {
            try {
                const parsed = new URL(uri);
                const scheme = parsed.protocol.slice(0, -1).toLowerCase();
                const hostname = canonicalHost(parsed.hostname);
                const port = parsed.port;
                const key = `${field}\u0000${scheme}\u0000${hostname}\u0000${port}`;

                if (seen.has(key)) {
                    continue;
                }

                seen.add(key);
                values.push({
                    field,
                    scheme,
                    hostname,
                    ...(port ? { port: Number(port) } : {}),
                });
            } catch {
                const value = uri.slice(0, 256);
                const key = `${field}\u0000invalid\u0000${value}`;

                if (!seen.has(key)) {
                    seen.add(key);
                    values.push({
                        field,
                        invalid: true,
                        value,
                    });
                }
            }
        }
    }

    return values;
}

function observedHosts(metadata) {
    return [...new Set(metadata.map((item) => (
        item.invalid ? 'invalid-uri' : item.hostname
    )))].sort();
}

function redirectHosts(metadata) {
    return [...new Set(metadata
        .filter((item) => item.field === 'redirect_uris')
        .map((item) => (item.invalid ? 'invalid-uri' : item.hostname)))].sort();
}

function sourceIp(headers) {
    const forwarded = headers['x-forwarded-for'];
    const first = typeof forwarded === 'string' ? forwarded.split(',', 1)[0].trim() : '';
    return isIP(first) ? first : null;
}

function isDcrPayload(payload) {
    return payload
        && typeof payload === 'object'
        && !Array.isArray(payload)
        && Array.isArray(payload.redirect_uris)
        && payload.redirect_uris.length > 0
        && payload.redirect_uris.every((uri) => typeof uri === 'string');
}

function isPerplexity(payload) {
    if (!Array.isArray(payload?.redirect_uris) || payload.redirect_uris.length === 0) {
        return false;
    }

    return payload.redirect_uris.every((uri) => {
        try {
            const host = canonicalHost(new URL(uri).hostname);

            return [...PERPLEXITY_DOMAINS].some(
                (domain) => host === domain || host.endsWith(`.${domain}`),
            );
        } catch {
            return false;
        }
    });
}

function isTrustedHostsRejection(status, text) {
    if (status < 400 || status >= 500) {
        return false;
    }

    try {
        const body = JSON.parse(text);
        const message = [
            body.error,
            body.error_description,
            body.errorMessage,
            body.message,
        ]
            .filter((value) => typeof value === 'string')
            .join(' ')
            .toLowerCase();

        return message.includes('trusted host')
            || message.includes('host is not trusted')
            || message.includes('policy_host_not_trusted')
            || message.includes('trusted_hosts');
    } catch {
        return false;
    }
}

async function audit(event) {
    try {
        await pool.query(
            `INSERT INTO audit.dcr_attempts
             (request_id, realm, source_ip, client_name, redirect_hosts, result,
              http_status, rejection_category, upstream_request_id)
             VALUES ($1, $2, $3::inet, $4, $5::jsonb, $6, $7, $8, $9)`,
            [
                event.requestId,
                config.realm,
                event.sourceIp,
                typeof event.clientName === 'string' ? event.clientName.slice(0, 200) : null,
                JSON.stringify(event.uriMetadata ?? []),
                event.result,
                event.status,
                event.category,
                event.upstreamRequestId,
            ],
        );
    } catch (error) {
        console.error(JSON.stringify({
            event: 'audit_write_failed',
            request_id: event.requestId,
            code: error.code ?? error.name,
        }));
    }
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;

        req.on('data', (chunk) => {
            total += chunk.length;

            if (total > MAX_BODY_BYTES) {
                req.destroy();
                reject(new Error('body_too_large'));
                return;
            }

            chunks.push(chunk);
        });

        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

async function keycloak(path, options = {}) {
    return fetch(`${config.keycloakOrigin}${path}`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
        ...options,
    });
}

function forward(res, upstream, text, requestId) {
    const headers = {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
        'x-request-id': requestId,
    };

    for (const name of [
        'location',
        'www-authenticate',
        'access-control-allow-origin',
        'access-control-allow-headers',
        'access-control-allow-methods',
        'vary',
    ]) {
        const value = upstream.headers.get(name);
        if (value) {
            headers[name] = value;
        }
    }

    res.writeHead(upstream.status, headers);
    res.end(text);
}

const server = http.createServer(async (req, res) => {
    const requestId = randomUUID();
    const path = new URL(req.url, 'http://127.0.0.1').pathname;

    try {
        if (req.method === 'GET' && path === '/healthz') {
            reply(res, 200, { status: 'ok' }, requestId);
            return;
        }

        if (req.method === 'GET' && path === '/readyz') {
            try {
                await pool.query('SELECT 1');
                reply(res, 200, { status: 'ready' }, requestId);
            } catch {
                reply(res, 503, { status: 'not_ready' }, requestId);
            }
            return;
        }

        if (req.method === 'GET' && path === discoveryPath) {
            const upstream = await keycloak(discoveryPath);
            const text = await upstream.text();

            if (!upstream.ok) {
                forward(res, upstream, text, requestId);
                return;
            }

            const discovery = JSON.parse(text);
            discovery.registration_endpoint = `${config.publicOrigin}${registrationPath}`;
            reply(res, 200, discovery, requestId);
            return;
        }

        if (req.method !== 'POST' || path !== registrationPath) {
            reply(res, 404, { error: 'not_found' }, requestId);
            return;
        }

        const ip = sourceIp(req.headers);
        let raw;

        try {
            raw = await readBody(req);
        } catch {
            await audit({
                requestId,
                sourceIp: ip,
                uriMetadata: [],
                result: 'invalid_request',
                status: 413,
                category: 'body_too_large',
            });

            reply(res, 413, { error: 'invalid_client_metadata' }, requestId);
            return;
        }

        let payload;

        try {
            payload = JSON.parse(raw);
        } catch {
            await audit({
                requestId,
                sourceIp: ip,
                uriMetadata: [],
                result: 'invalid_request',
                status: 400,
                category: 'invalid_json',
            });

            reply(res, 400, { error: 'invalid_client_metadata' }, requestId);
            return;
        }

        if (!isDcrPayload(payload)) {
            await audit({
                requestId,
                sourceIp: ip,
                clientName: payload?.client_name,
                uriMetadata: uriMetadata(payload),
                result: 'invalid_request',
                status: 400,
                category: 'invalid_metadata',
            });

            reply(res, 400, { error: 'invalid_client_metadata' }, requestId);
            return;
        }

        const metadata = uriMetadata(payload);
        const hosts = observedHosts(metadata);

        if (metadata.some((item) => item.invalid)) {
            await audit({
                requestId,
                sourceIp: ip,
                clientName: payload.client_name,
                uriMetadata: metadata,
                result: 'invalid_request',
                status: 400,
                category: 'invalid_uri',
            });

            reply(res, 400, { error: 'invalid_client_metadata' }, requestId);
            return;
        }

        let upstream;

        try {
            upstream = await keycloak(registrationPath, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    accept: 'application/json',
                },
                body: raw,
            });
        } catch (error) {
            await audit({
                requestId,
                sourceIp: ip,
                clientName: payload.client_name,
                uriMetadata: metadata,
                result: 'failed',
                status: 502,
                category: 'proxy_error',
            });

            throw error;
        }

        const status = upstream.status;
        const upstreamRequestId = upstream.headers.get('x-request-id');

        let text;
        try {
            text = await upstream.text();
        } catch (error) {
            await audit({
                requestId,
                sourceIp: ip,
                clientName: payload.client_name,
                uriMetadata: metadata,
                result: 'failed',
                status: 502,
                category: 'proxy_error',
                upstreamRequestId,
            });

            throw error;
        }

        if (status >= 500) {
            await audit({
                requestId,
                sourceIp: ip,
                clientName: payload.client_name,
                uriMetadata: metadata,
                result: 'failed',
                status,
                category: 'keycloak_error',
                upstreamRequestId,
            });
        } else if (isTrustedHostsRejection(status, text)) {
            await audit({
                requestId,
                sourceIp: ip,
                clientName: payload.client_name,
                uriMetadata: metadata,
                result: 'rejected',
                status,
                category: 'trusted_hosts',
                upstreamRequestId,
            });
        }

        if (!upstream.ok || !isPerplexity(payload)) {
            forward(res, upstream, text, requestId);
            return;
        }

        let registration;

        try {
            registration = JSON.parse(text);
        } catch (error) {
            console.error(JSON.stringify({
                event: 'keycloak_invalid_success_response',
                request_id: requestId,
                code: error.name,
            }));

            reply(res, 502, { error: 'server_error' }, requestId);
            return;
        }

        registration.response_types = ['code'];

        reply(res, status, registration, requestId, {
            ...(upstream.headers.get('location')
                ? { location: upstream.headers.get('location') }
                : {}),
        });
    } catch (error) {
        console.error(JSON.stringify({
            event: 'dcr_proxy_failed',
            request_id: requestId,
            code: error.code ?? error.name,
        }));

        if (!res.headersSent) {
            reply(res, 502, { error: 'server_error' }, requestId);
        }
    }
});

server.listen(config.port, '0.0.0.0', () => {
    console.log(`dcr-compat listening on ${config.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
        await pool.end();
        server.close(() => process.exit(0));
    });
}
