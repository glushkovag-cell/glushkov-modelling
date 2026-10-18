interface Env {
	MCP_SERVER_NAME: string;
	CACHE_TTL_SECONDS: string;
}

type BadgePayload = {
	schemaVersion: 1;
	label: string;
	message: string;
	color: string;
	cacheSeconds: number;
};

type RegistryVersion = {
	version?: string;
	server?: {
		name?: string;
		version?: string;
	};
	[key: string]: unknown;
};

type VersionLookupResult = {
	version: string | null;
	registryStatus: number;
	source: "live" | "stale";
};

const REGISTRY_BASE_URL = "https://registry.modelcontextprotocol.io";
const DEFAULT_CACHE_TTL_SECONDS = 3600;
const ERROR_CACHE_TTL_SECONDS = 300;
const FETCH_TIMEOUT_MS = 8000;
const BADGE_LABEL = "MCP Registry";
const STALE_CACHE_KEY_PREFIX = "latest-version:";

function getCacheTtl(env: Env): number {
	const value = Number.parseInt(env.CACHE_TTL_SECONDS, 10);

	return Number.isFinite(value) && value > 0
		? value
		: DEFAULT_CACHE_TTL_SECONDS;
}

function jsonResponse(
	body: unknown,
	status = 200,
	headers: HeadersInit = {},
): Response {
	return new Response(JSON.stringify(body, null, 2), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"access-control-allow-origin": "*",
			...headers,
		},
	});
}

function badgeResponse(
	message: string,
	color: string,
	cacheSeconds: number,
	extraHeaders: HeadersInit = {},
): Response {
	const payload: BadgePayload = {
		schemaVersion: 1,
		label: BADGE_LABEL,
		message,
		color,
		cacheSeconds,
	};

	return jsonResponse(payload, 200, {
		"cache-control": `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`,
		...extraHeaders,
	});
}

function extractVersion(payload: unknown): string | null {
	if (!payload || typeof payload !== "object") {
		return null;
	}

	const data = payload as RegistryVersion;

	if (typeof data.version === "string" && data.version.trim()) {
		return data.version.trim();
	}

	if (
		data.server &&
		typeof data.server.version === "string" &&
		data.server.version.trim()
	) {
		return data.server.version.trim();
	}

	return null;
}

function buildRegistryUrl(serverName: string): string {
	const encodedServerName = encodeURIComponent(serverName);

	return (
		`${REGISTRY_BASE_URL}/v0.1/servers/` +
		`${encodedServerName}/versions/latest`
	);
}

function createCacheKey(serverName: string): Request {
	return new Request(
		`https://stale-cache.local/${STALE_CACHE_KEY_PREFIX}${encodeURIComponent(serverName)}`,
	);
}

async function readStaleVersion(
	cache: Cache,
	serverName: string,
): Promise<string | null> {
	const cached = await cache.match(createCacheKey(serverName));

	if (!cached) {
		return null;
	}

	try {
		const payload = (await cached.json()) as { version?: unknown };

		return typeof payload.version === "string" && payload.version.trim()
			? payload.version.trim()
			: null;
	} catch {
		return null;
	}
}

async function writeStaleVersion(
	cache: Cache,
	serverName: string,
	version: string,
	cacheSeconds: number,
): Promise<void> {
	const response = jsonResponse(
		{
			version,
			cachedAt: new Date().toISOString(),
		},
		200,
		{
			"cache-control": `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`,
		},
	);

	await cache.put(createCacheKey(serverName), response);
}

async function fetchLatestVersion(
	serverName: string,
	cacheSeconds: number,
): Promise<VersionLookupResult> {
	const cache = caches.default;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(buildRegistryUrl(serverName), {
			headers: {
				accept: "application/json",
				"user-agent": "glushkov-modelling-mcp-registry-badge/1.1",
			},
			cf: {
				cacheEverything: true,
				cacheTtl: cacheSeconds,
			},
			signal: controller.signal,
		});

		if (!response.ok) {
			const staleVersion = await readStaleVersion(cache, serverName);

			if (staleVersion) {
				return {
					version: staleVersion,
					registryStatus: response.status,
					source: "stale",
				};
			}

			return {
				version: null,
				registryStatus: response.status,
				source: "live",
			};
		}

		const payload: unknown = await response.json();
		const version = extractVersion(payload);

		if (version) {
			await writeStaleVersion(cache, serverName, version, cacheSeconds);
		}

		return {
			version,
			registryStatus: response.status,
			source: "live",
		};
	} catch (error) {
		const staleVersion = await readStaleVersion(cache, serverName);

		if (staleVersion) {
			return {
				version: staleVersion,
				registryStatus: 599,
				source: "stale",
			};
		}

		throw error;
	} finally {
		clearTimeout(timeout);
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const cacheSeconds = getCacheTtl(env);
		const serverName = env.MCP_SERVER_NAME?.trim();

		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: {
					"access-control-allow-origin": "*",
					"access-control-allow-methods": "GET, OPTIONS",
					"access-control-allow-headers": "content-type",
				},
			});
		}

		if (request.method !== "GET") {
			return jsonResponse(
				{ error: "Method not allowed" },
				405,
				{ allow: "GET, OPTIONS" },
			);
		}

		if (url.pathname === "/" || url.pathname === "/health") {
			return jsonResponse(
				{
					ok: true,
					service: "mcp-registry-badge",
					serverName: serverName ?? null,
					badgeEndpoint: `${url.origin}/badge`,
					cacheTtlSeconds: cacheSeconds,
					fetchTimeoutMs: FETCH_TIMEOUT_MS,
				},
				200,
				{
					"cache-control": "no-store",
				},
			);
		}

		if (url.pathname !== "/badge") {
			return jsonResponse({ error: "Not found" }, 404);
		}

		if (!serverName) {
			return badgeResponse("not configured", "red", ERROR_CACHE_TTL_SECONDS);
		}

		try {
			const { version, registryStatus, source } = await fetchLatestVersion(
				serverName,
				cacheSeconds,
			);

			if (source === "stale" && version) {
				const formattedVersion = version.replace(/^v/i, "");

				return badgeResponse(`v${formattedVersion}`, "green", ERROR_CACHE_TTL_SECONDS, {
					"x-badge-source": "stale-cache",
					"x-registry-status": String(registryStatus),
				});
			}

			if (registryStatus === 404) {
				return badgeResponse("not published", "lightgrey", cacheSeconds, {
					"x-badge-source": "live",
					"x-registry-status": "404",
				});
			}

			if (registryStatus < 200 || registryStatus >= 300) {
				return badgeResponse("registry unavailable", "orange", ERROR_CACHE_TTL_SECONDS, {
					"x-badge-source": "live",
					"x-registry-status": String(registryStatus),
				});
			}

			if (!version) {
				return badgeResponse("version unknown", "yellow", ERROR_CACHE_TTL_SECONDS, {
					"x-badge-source": "live",
					"x-registry-status": String(registryStatus),
				});
			}

			const formattedVersion = version.replace(/^v/i, "");

			return badgeResponse(`v${formattedVersion}`, "brightgreen", cacheSeconds, {
				"x-badge-source": "live",
				"x-registry-status": String(registryStatus),
			});
		} catch (error) {
			console.error("Failed to fetch MCP Registry version", {
				serverName,
				error: error instanceof Error ? error.message : String(error),
			});

			return badgeResponse("registry unavailable", "orange", ERROR_CACHE_TTL_SECONDS, {
				"x-badge-source": "error",
				"x-registry-status": "599",
			});
		}
	},
} satisfies ExportedHandler<Env>;
