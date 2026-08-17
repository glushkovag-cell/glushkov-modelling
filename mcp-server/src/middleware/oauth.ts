import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { config } from "../lib/config.js";

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
    if (!config.oauthIssuer || !config.oauthJwksUri || !config.oauthAudience) {
        throw new Error(
            "OAuth is not configured: set OAUTH_ISSUER, OAUTH_JWKS_URI and OAUTH_AUDIENCE.",
        );
    }

    if (!jwks) {
        jwks = createRemoteJWKSet(new URL(config.oauthJwksUri));
    }

    return jwks;
}

function jsonRpcUnauthorized(res: Response, message: string): void {
    res.setHeader(
        "WWW-Authenticate",
        `Bearer resource_metadata="${config.oauthResourceMetadataUri}", error="invalid_token", error_description="${message}"`,
    );

    res.status(401).json({
        jsonrpc: "2.0",
        error: {
            code: -32001,
            message,
        },
        id: null,
    });
}

function jsonRpcForbidden(res: Response, message: string): void {
    res.setHeader(
        "WWW-Authenticate",
        `Bearer resource_metadata="${config.oauthResourceMetadataUri}", error="insufficient_scope", scope="${config.oauthRequiredScope}"`,
    );

    res.status(403).json({
        jsonrpc: "2.0",
        error: {
            code: -32003,
            message,
        },
        id: null,
    });
}

function hasRequiredScope(payload: JWTPayload): boolean {
    const scope = payload.scope;

    if (typeof scope === "string") {
        return scope.split(/\s+/).includes(config.oauthRequiredScope);
    }

    if (Array.isArray(scope)) {
        return scope.includes(config.oauthRequiredScope);
    }

    return false;
}

/**
 * Проверяет OAuth 2.1 access token для маршрута /mcp-oauth.
 *
 * Принимает только JWT, выданные public-mcp в Keycloak:
 * - подпись проверяется по публичному JWKS;
 * - iss строго совпадает с OAUTH_ISSUER;
 * - aud включает OAUTH_AUDIENCE;
 * - token не истёк (jwtVerify);
 * - scope включает content:read.
 *
 * Старый bearerAuth для /mcp не используется и остаётся неизменным.
 */
export async function oauthAuth(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    const authorization = req.header("authorization") ?? "";
    const [scheme, token] = authorization.split(/\s+/, 2);

    if (scheme !== "Bearer" || !token) {
        jsonRpcUnauthorized(res, "A valid OAuth Bearer access token is required.");
        return;
    }

    try {
        const { payload } = await jwtVerify(token, getJwks(), {
            issuer: config.oauthIssuer,
            audience: config.oauthAudience,
            algorithms: ["RS256"],
        });

        if (!hasRequiredScope(payload)) {
            jsonRpcForbidden(
                res,
                `Access token must include scope '${config.oauthRequiredScope}'.`,
            );
            return;
        }

        res.locals.oauth = {
            subject: payload.sub ?? null,
            clientId:
                typeof payload.azp === "string"
                    ? payload.azp
                    : typeof payload.client_id === "string"
                        ? payload.client_id
                        : null,
            scope: payload.scope ?? "",
        };

        next();
    } catch (error) {
        console.warn("OAuth access token validation failed:", error);
        jsonRpcUnauthorized(res, "OAuth access token is invalid or expired.");
    }
}
