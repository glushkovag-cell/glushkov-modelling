import { ClientError } from 'graphql-request';

/**
 * Errors returned to MCP clients must never contain the GraphQL query, its
 * variables or the raw response body: `graphql-request` interpolates all of
 * them into `ClientError.message`. Only the first GraphQL error message — or
 * the HTTP status when the server sent none — is safe to expose. The full
 * details are logged server-side by `graphql-client.ts`.
 */

const MAX_MESSAGE_LENGTH = 300;

function truncate(message: string): string {
    const trimmed = message.trim();

    return trimmed.length > MAX_MESSAGE_LENGTH
        ? `${trimmed.slice(0, MAX_MESSAGE_LENGTH)}…`
        : trimmed;
}

export function describeGraphQLError(error: unknown): string {
    if (error instanceof ClientError) {
        const firstMessage = error.response.errors?.[0]?.message;

        if (typeof firstMessage === 'string' && firstMessage.trim() !== '') {
            return truncate(firstMessage);
        }

        return `GraphQL request failed with HTTP ${error.response.status}`;
    }

    if (error instanceof Error) {
        return truncate(error.message);
    }

    return 'Unknown error';
}
