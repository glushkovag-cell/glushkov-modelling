# DCR compatibility proxy

Proxy for Keycloak Dynamic Client Registration in realm `public-mcp`.

## Endpoints

- `GET /realms/public-mcp/.well-known/openid-configuration`
- `POST /realms/public-mcp/clients-registrations/openid-connect`
- `GET /healthz`
- `GET /readyz`

## Behavior

The proxy forwards DCR calls to Keycloak and preserves Keycloak as the policy authority.

For successful registrations whose `redirect_uris` consist exclusively of known Perplexity callback URLs, it returns the Keycloak registration response with:

```json
{ "response_types": ["code"] }
```

All other upstream responses are passed through unchanged.

## Audit

Each DCR attempt writes one safe record to `audit.dcr_attempts`. The proxy stores normalized redirect hostnames, not full redirect URIs, request bodies, authorization headers, tokens, codes or client secrets.

The PostgreSQL role requires `INSERT` on `audit.dcr_attempts`.

## Run

```bash
npm install
npm test
node server.mjs
```