import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { createOriginCheck } from "./origin.js";

const ALLOWED = ["https://www.perplexity.ai", "https://perplexity.ai"];

interface MockResponse {
    statusCode: number;
    body: unknown;
    ended: boolean;
    header(name: string): string | undefined;
}

function createRequest(init: { method?: string; origin?: string } = {}): Request {
    return {
        method: init.method ?? "POST",
        header(name: string) {
            return name.toLowerCase() === "origin" ? init.origin : undefined;
        },
    } as unknown as Request;
}

function createResponse(): MockResponse {
    const headers = new Map<string, string>();

    const response = {
        statusCode: 200,
        body: undefined as unknown,
        ended: false,
        setHeader(name: string, value: string) {
            headers.set(name.toLowerCase(), value);
            return response;
        },
        getHeader(name: string) {
            return headers.get(name.toLowerCase());
        },
        header(name: string) {
            return headers.get(name.toLowerCase());
        },
        status(code: number) {
            response.statusCode = code;
            return response;
        },
        json(body: unknown) {
            response.body = body;
            response.ended = true;
            return response;
        },
        end() {
            response.ended = true;
            return response;
        },
    };

    return response as unknown as MockResponse;
}

function run(
    middleware: ReturnType<typeof createOriginCheck>,
    request: Request,
    response: MockResponse,
): NextFunction {
    const next = vi.fn() as unknown as NextFunction;

    middleware(request, response as unknown as Response, next);

    return next;
}

describe("createOriginCheck", () => {
    it("allows a non-browser request without Origin", () => {
        const middleware = createOriginCheck(ALLOWED);
        const response = createResponse();

        const next = run(middleware, createRequest(), response);

        expect(next).toHaveBeenCalledOnce();
        expect(response.header("access-control-allow-origin")).toBeUndefined();
    });

    it("allows an allowlisted Origin and sets the CORS headers", () => {
        const middleware = createOriginCheck(ALLOWED);
        const response = createResponse();

        const next = run(
            middleware,
            createRequest({ origin: "https://www.perplexity.ai" }),
            response,
        );

        expect(next).toHaveBeenCalledOnce();
        expect(response.header("access-control-allow-origin")).toBe(
            "https://www.perplexity.ai",
        );
        expect(response.header("vary")).toContain("Origin");
    });

    it("rejects an Origin that is not on the list", () => {
        const middleware = createOriginCheck(ALLOWED);
        const response = createResponse();

        const next = run(
            middleware,
            createRequest({ origin: "https://evil.test" }),
            response,
        );

        expect(next).not.toHaveBeenCalled();
        expect(response.statusCode).toBe(403);
        expect(response.header("access-control-allow-origin")).toBeUndefined();
        expect(response.body).toMatchObject({
            jsonrpc: "2.0",
            error: { code: -32600, message: "Origin not allowed." },
            id: null,
        });
    });

    it("fails closed when the allowlist is empty", () => {
        const middleware = createOriginCheck([]);
        const browser = createResponse();
        const serverToServer = createResponse();

        const nextBrowser = run(
            middleware,
            createRequest({ origin: "https://www.perplexity.ai" }),
            browser,
        );
        const nextServer = run(middleware, createRequest(), serverToServer);

        expect(nextBrowser).not.toHaveBeenCalled();
        expect(browser.statusCode).toBe(403);
        expect(nextServer).toHaveBeenCalledOnce();
    });

    it("answers a preflight from an allowed Origin with 204 and CORS headers", () => {
        const middleware = createOriginCheck(ALLOWED);
        const response = createResponse();

        const next = run(
            middleware,
            createRequest({ method: "OPTIONS", origin: "https://perplexity.ai" }),
            response,
        );

        expect(next).not.toHaveBeenCalled();
        expect(response.statusCode).toBe(204);
        expect(response.header("access-control-allow-origin")).toBe(
            "https://perplexity.ai",
        );
        expect(response.header("access-control-allow-methods")).toContain("POST");
        expect(response.header("access-control-allow-headers")).toContain(
            "authorization",
        );
        expect(response.header("access-control-max-age")).toBe("600");
    });

    it("rejects a preflight from a foreign Origin without CORS headers", () => {
        const middleware = createOriginCheck(ALLOWED);
        const response = createResponse();

        run(
            middleware,
            createRequest({ method: "OPTIONS", origin: "https://evil.test" }),
            response,
        );

        expect(response.statusCode).toBe(403);
        expect(response.header("access-control-allow-origin")).toBeUndefined();
    });

    it("answers a preflight without Origin with 204 and no CORS headers", () => {
        const middleware = createOriginCheck(ALLOWED);
        const response = createResponse();

        run(middleware, createRequest({ method: "OPTIONS" }), response);

        expect(response.statusCode).toBe(204);
        expect(response.header("access-control-allow-origin")).toBeUndefined();
    });
});
