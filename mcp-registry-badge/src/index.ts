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

const REGISTRY_BASE_URL = "https://registry.modelcontextprotocol.io";
const DEFAULT_CACHE_TTL_SECONDS = 3600;

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
): Response {
	const payload: BadgePayload = {
		schemaVersion: 1,
		label: "MCP Registry",
		message,
		color,
		cacheSeconds,
	};

	return jsonResponse(payload, 200, {
		"cache-control": `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`,
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

async function fetchLatestVersion(
	serverName: string,
): Promise<{ version: string | null; registryStatus: number }> {
	const encodedServerName = encodeURIComponent(serverName);

	const registryUrl =
		`${REGISTRY_BASE_URL}/v0.1/servers/` +
		`${encodedServerName}/versions/latest`;

	const response = await fetch(registryUrl, {
		headers: {
			accept: "application/json",
			"user-agent": "glushkov-modelling-mcp-registry-badge/1.0",
		},
		cf: {
			cacheEverything: true,
			cacheTtl: DEFAULT_CACHE_TTL_SECONDS,
		},
	});

	if (!response.ok) {
		return {
			version: null,
			registryStatus: response.status,
		};
	}

	const payload: unknown = await response.json();

	return {
		version: extractVersion(payload),
		registryStatus: response.status,
	};
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const cacheSeconds = getCacheTtl(env);

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
					serverName: env.MCP_SERVER_NAME,
					badgeEndpoint: `${url.origin}/badge`,
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

		if (!env.MCP_SERVER_NAME?.trim()) {
			return badgeResponse("not configured", "red", 300);
		}

		try {
			const { version, registryStatus } = await fetchLatestVersion(
				env.MCP_SERVER_NAME.trim(),
			);

			if (registryStatus === 404) {
				return badgeResponse("not published", "lightgrey", cacheSeconds);
			}

			if (registryStatus < 200 || registryStatus >= 300) {
				return badgeResponse("registry unavailable", "orange", 300);
			}

			if (!version) {
				return badgeResponse("version unknown", "yellow", 300);
			}

			const formattedVersion = version.replace(/^v/i, "");

			return badgeResponse(`v${formattedVersion}`, "brightgreen", cacheSeconds);
		} catch (error) {
			console.error("Failed to fetch MCP Registry version", {
				error: error instanceof Error ? error.message : String(error),
			});

			return badgeResponse("registry unavailable", "orange", 300);
		}
	},
} satisfies ExportedHandler<Env>;
