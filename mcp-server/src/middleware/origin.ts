import type { NextFunction, Request, Response } from "express";

/**
 * Origin/CORS policy for the Streamable HTTP MCP endpoints.
 *
 * Rules:
 * - a request without an `Origin` header is a server-to-server call and is
 *   allowed (curl, MCP Inspector, provider backends);
 * - a request whose `Origin` is not on the allowlist is rejected with 403;
 * - an empty allowlist therefore denies every browser origin (fail closed)
 *   while non-browser clients keep working;
 * - preflight requests are answered with the headers MCP clients send.
 *
 * `MCP_ALLOWED_ORIGINS` is a comma-separated list, for example
 * `https://www.perplexity.ai,https://perplexity.ai`.
 */

const ALLOWED_METHODS = "POST, OPTIONS";

const ALLOWED_HEADERS = [
    "authorization",
    "content-type",
    "accept",
    "mcp-protocol-version",
    "mcp-session-id",
    "last-event-id",
].join(", ");

const PREFLIGHT_MAX_AGE_SECONDS = 600;

export type OriginMiddleware = (
    req: Request,
    res: Response,
    next: NextFunction,
) => void;

function setCorsHeaders(res: Response, origin: string): void {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
}

function rejectOrigin(res: Response, origin: string): void {
    console.warn(JSON.stringify({ event: "origin_rejected", origin }));

    res.status(403).json({
        jsonrpc: "2.0",
        error: {
            code: -32600,
            message: "Origin not allowed.",
        },
        id: null,
    });
}

export function createOriginCheck(
    allowedOrigins: readonly string[],
): OriginMiddleware {
    const allowed = new Set(allowedOrigins);

    return (req: Request, res: Response, next: NextFunction): void => {
        const origin = req.header("origin");

        if (req.method === "OPTIONS") {
            if (!origin) {
                // Not a browser preflight; nothing to negotiate.
                res.status(204).end();
                return;
            }

            if (!allowed.has(origin)) {
                res.status(403).end();
                return;
            }

            setCorsHeaders(res, origin);
            res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
            res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
            res.setHeader(
                "Access-Control-Max-Age",
                String(PREFLIGHT_MAX_AGE_SECONDS),
            );
            res.status(204).end();
            return;
        }

        if (!origin) {
            next();
            return;
        }

        if (!allowed.has(origin)) {
            rejectOrigin(res, origin);
            return;
        }

        setCorsHeaders(res, origin);
        next();
    };
}

