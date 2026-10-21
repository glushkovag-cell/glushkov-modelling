import { describe, expect, it } from "vitest";
import { ClientError } from "graphql-request";
import { describeGraphQLError } from "./errors.js";

function clientError(
    errors: Array<{ message: string }>,
    status = 400,
): ClientError {
    return new ClientError(
        { errors, status } as never,
        {
            query: "query Secret($token: String!) { secret(token: $token) }",
            variables: { token: "super-secret-token" },
        } as never,
    );
}

describe("describeGraphQLError", () => {
    it("returns the first GraphQL error message", () => {
        const error = clientError([{ message: 'Field "date" is not defined' }]);

        expect(describeGraphQLError(error)).toBe('Field "date" is not defined');
    });

    it("does not leak the query, the variables or the response body", () => {
        const message = describeGraphQLError(
            clientError([{ message: "Something went wrong" }]),
        );

        expect(message).toBe("Something went wrong");
        expect(message).not.toContain("super-secret-token");
        expect(message).not.toContain("query Secret");
    });

    it("falls back to the HTTP status when there is no error message", () => {
        expect(describeGraphQLError(clientError([], 503))).toBe(
            "GraphQL request failed with HTTP 503",
        );
    });

    it("truncates long messages", () => {
        const message = describeGraphQLError(
            clientError([{ message: "x".repeat(500) }]),
        );

        expect(message.length).toBeLessThanOrEqual(301);
        expect(message.endsWith("…")).toBe(true);
    });

    it("passes plain errors through and hides unknown values", () => {
        expect(describeGraphQLError(new Error("fetch failed"))).toBe("fetch failed");
        expect(describeGraphQLError("nope")).toBe("Unknown error");
        expect(describeGraphQLError(undefined)).toBe("Unknown error");
    });
});
