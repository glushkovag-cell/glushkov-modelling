import { ClientError, GraphQLClient } from "graphql-request";
import { config } from "./config.js";
import { describeGraphQLError } from "./errors.js";

/**
 * Единый клиент к WPGraphQL для всех read-only инструментов.
 * Аутентификация — через Application Password read-only пользователя WordPress
 * (Basic Auth), если задана в переменных окружения. Если не задана, запросы
 * выполняются от имени неаутентифицированного посетителя (только публичные данные).
 */
function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};

  // Тот же заголовок, что и у Astro-сайта — без него Cloudflare/WAF возвращает 404.
  if (config.wpGraphqlSecret) {
    headers["X-GraphQL-Secret"] = config.wpGraphqlSecret;
  }

  if (config.wpReadonlyUsername && config.wpReadonlyAppPassword) {
    const token = Buffer.from(
      `${config.wpReadonlyUsername}:${config.wpReadonlyAppPassword}`,
    ).toString("base64");
    headers.Authorization = `Basic ${token}`;
  }

  return headers;
}

export const graphqlClient = new GraphQLClient(config.wpGraphqlUrl, {
  headers: buildHeaders(),
});

/**
 * Обёртка над graphqlClient.request с таймаутом, чтобы один медленный запрос
 * к WPGraphQL не блокировал MCP-сервер надолго.
 */
export async function requestWithTimeout<TResult>(
  query: string,
  variables?: Record<string, unknown>,
  timeoutMs: number = config.requestTimeoutMs,
): Promise<TResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await graphqlClient.request<TResult>({
      document: query,
      variables: variables ?? {},
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      console.error(JSON.stringify({
        event: "graphql_request_timeout",
        timeout_ms: timeoutMs,
      }));

      throw new Error(`WPGraphQL request timed out after ${timeoutMs} ms`);
    }

    // The original message embeds the query, the variables and the response
    // body; log it here and rethrow a client-safe description.
    console.error(JSON.stringify({
      event: "graphql_request_failed",
      status: error instanceof ClientError ? error.response.status : null,
      message: describeGraphQLError(error),
    }));

    throw new Error(describeGraphQLError(error));
  } finally {
    clearTimeout(timeout);
  }
}
