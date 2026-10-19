interface Env {
	MCP_SERVER_NAME: string;
	CACHE_TTL_SECONDS: string;
	MCP_FALLBACK_VERSION?: string;
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

type VersionState = {
	version: string;
	source: "registry" | "fallback";
	fetchedAt: number;
	nextRefreshAt: number;
};

const REGISTRY_BASE_URL = "https://registry.modelcontextprotocol.io";
const DEFAULT_CACHE_TTL_SECONDS = 21600;
const ERROR_RETRY_SECONDS = 300;
const VERSION_STATE_TTL_SECONDS = 30 * 24 * 60 * 60;
const FETCH_TIMEOUT_MS = 20_000;
const BADGE_LABEL = "MCP Registry";
const DEFAULT_FALLBACK_VERSION = "1.3.0";
const VERSION_CACHE_KEY_PREFIX = "version-state:";

function getCacheTtl(env: Env): number {
	const value = Number.parseInt(env.CACHE_TTL_SECONDS, 10);

	return Number.isFinite(value) && value > 0
		? value
		: DEFAULT_CACHE_TTL_SECONDS;
}

function normalizeVersion(version: string): string {
	return version.trim().replace(/^v/i, "");
}

function getFallbackVersion(env: Env): string {
	const configuredVersion = env.MCP_FALLBACK_VERSION?.trim();

	return normalizeVersion(
		configuredVersion || DEFAULT_FALLBACK_VERSION,
	);
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
	version: string,
	cacheSeconds: number,
	source: string,
): Response {
	const payload: BadgePayload = {
		schemaVersion: 1,
		label: BADGE_LABEL,
		message: `v${normalizeVersion(version)}`,
		color: "brightgreen",
		cacheSeconds,
	};

	return jsonResponse(payload, 200, {
		"cache-control":
			`public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`,
		"x-badge-source": source,
	});
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function badgeSvgResponse(
	version: string,
	cacheSeconds: number,
	source: string,
): Response {
	const label = BADGE_LABEL;
	const message = `v${normalizeVersion(version)}`;

	const labelWidth = 83;
	const messageWidth = Math.max(
		45,
		Math.ceil(message.length * 6.5 + 12),
	);
	const width = labelWidth + messageWidth;

	const escapedLabel = escapeXml(label);
	const escapedMessage = escapeXml(message);
	const title = `${escapedLabel}: ${escapedMessage}`;

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${title}">
<title>${title}</title>
<linearGradient id="s" x2="0" y2="100%">
	<stop offset="0" stop-color="#fff" stop-opacity=".12"/>
	<stop offset="1" stop-opacity=".12"/>
</linearGradient>
<clipPath id="r">
	<rect width="${width}" height="20" rx="3"/>
</clipPath>
<g clip-path="url(#r)">
	<rect width="${labelWidth}" height="20" fill="#555"/>
	<rect
		x="${labelWidth}"
		width="${messageWidth}"
		height="20"
		fill="#4c1"
	/>
	<rect width="${width}" height="20" fill="url(#s)"/>
</g>
<g
	fill="#fff"
	text-anchor="middle"
	font-family="Verdana,Geneva,DejaVu Sans,sans-serif"
	font-size="11"
>
	<text x="${labelWidth / 2}" y="14">${escapedLabel}</text>
	<text
		x="${labelWidth + messageWidth / 2}"
		y="14"
	>${escapedMessage}</text>
</g>
</svg>`;

	return new Response(svg, {
		status: 200,
		headers: {
			"content-type": "image/svg+xml; charset=utf-8",
			"access-control-allow-origin": "*",
			"cache-control":
				`public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`,
			"x-badge-source": source,
			"x-content-type-options": "nosniff",
		},
	});
}

function extractVersion(payload: unknown): string | null {
	if (!payload || typeof payload !== "object") {
		return null;
	}

	const data = payload as RegistryVersion;

	if (
		typeof data.version === "string" &&
		data.version.trim()
	) {
		return normalizeVersion(data.version);
	}

	if (
		data.server &&
		typeof data.server.version === "string" &&
		data.server.version.trim()
	) {
		return normalizeVersion(data.server.version);
	}

	return null;
}

function buildRegistryUrl(serverName: string): string {
	return (
		`${REGISTRY_BASE_URL}/v0.1/servers/` +
		`${encodeURIComponent(serverName)}/versions/latest`
	);
}

function createVersionCacheKey(serverName: string): Request {
	return new Request(
		`https://badge-cache.internal/` +
		`${VERSION_CACHE_KEY_PREFIX}` +
		`${encodeURIComponent(serverName)}`,
	);
}

async function readVersionState(
	serverName: string,
): Promise<VersionState | null> {
	try {
		const cached = await caches.default.match(
			createVersionCacheKey(serverName),
		);

		if (!cached) {
			return null;
		}

		const payload =
			(await cached.json()) as Partial<VersionState>;

		if (
			typeof payload.version !== "string" ||
			!payload.version.trim() ||
			(
				payload.source !== "registry" &&
				payload.source !== "fallback"
			) ||
			typeof payload.fetchedAt !== "number" ||
			typeof payload.nextRefreshAt !== "number"
		) {
			return null;
		}

		return {
			version: normalizeVersion(payload.version),
			source: payload.source,
			fetchedAt: payload.fetchedAt,
			nextRefreshAt: payload.nextRefreshAt,
		};
	} catch (error) {
		console.warn("Unable to read badge version cache", {
			serverName,
			error:
				error instanceof Error
					? error.message
					: String(error),
		});

		return null;
	}
}

async function writeVersionState(
	serverName: string,
	state: VersionState,
): Promise<void> {
	const response = jsonResponse(state, 200, {
		"cache-control":
			`public, max-age=${VERSION_STATE_TTL_SECONDS}, ` +
			`s-maxage=${VERSION_STATE_TTL_SECONDS}`,
	});

	await caches.default.put(
		createVersionCacheKey(serverName),
		response,
	);
}

async function refreshVersion(
	serverName: string,
	currentState: VersionState,
	cacheSeconds: number,
): Promise<void> {
	const startedAt = Date.now();

	/*
	 * Сразу блокируем повторное обновление на короткий период.
	 * Это не позволяет нескольким параллельным запросам
	 * одновременно обращаться к Registry.
	 */
	const retryState: VersionState = {
		...currentState,
		nextRefreshAt:
			startedAt + ERROR_RETRY_SECONDS * 1000,
	};

	try {
		await writeVersionState(serverName, retryState);
	} catch (error) {
		console.warn("Unable to set badge refresh lock", {
			serverName,
			error:
				error instanceof Error
					? error.message
					: String(error),
		});
	}

	const controller = new AbortController();

	/*
	 * Запрос выполняется в фоне, поэтому пользователь не ждёт
	 * ответа Registry. Увеличенный таймаут нужен для случаев,
	 * когда Registry отвечает дольше 8–10 секунд.
	 */
	const timeout = setTimeout(
		() => controller.abort(),
		FETCH_TIMEOUT_MS,
	);

	try {
		const response = await fetch(
			buildRegistryUrl(serverName),
			{
				headers: {
					accept: "application/json",
					"user-agent":
						"glushkov-modelling-mcp-registry-badge/2.0",
				},
				signal: controller.signal,
			},
		);

		if (!response.ok) {
			throw new Error(
				`Registry returned HTTP ${response.status}`,
			);
		}

		const payload: unknown = await response.json();
		const version = extractVersion(payload);

		if (!version) {
			throw new Error(
				"Registry response does not contain a version",
			);
		}

		const fetchedAt = Date.now();

		await writeVersionState(serverName, {
			version,
			source: "registry",
			fetchedAt,
			nextRefreshAt:
				fetchedAt + cacheSeconds * 1000,
		});
	} catch (error) {
		/*
		 * При ошибке сохранённая или резервная версия остаётся
		 * доступной. Пользователь никогда не получает
		 * "registry unavailable".
		 */
		console.error(
			"Failed to refresh MCP Registry version",
			{
				serverName,
				registryUrl: buildRegistryUrl(serverName),
				timeoutMs: FETCH_TIMEOUT_MS,
				error:
					error instanceof Error
						? error.message
						: String(error),
			},
		);
	} finally {
		clearTimeout(timeout);
	}
}

async function getBadgeState(
	env: Env,
	ctx: ExecutionContext,
): Promise<{
	version: string;
	source: string;
	cacheSeconds: number;
	refreshScheduled: boolean;
}> {
	const serverName = env.MCP_SERVER_NAME?.trim();
	const cacheSeconds = getCacheTtl(env);
	const fallbackVersion = getFallbackVersion(env);

	if (!serverName) {
		return {
			version: fallbackVersion,
			source: "configured-fallback:no-server-name",
			cacheSeconds: ERROR_RETRY_SECONDS,
			refreshScheduled: false,
		};
	}

	const now = Date.now();
	const cachedState = await readVersionState(serverName);

	/*
	 * Если региональный Cloudflare-кэш пуст, сразу показываем
	 * известную опубликованную версию. Registry обновляется
	 * независимо в фоне.
	 */
	const state: VersionState = cachedState ?? {
		version: fallbackVersion,
		source: "fallback",
		fetchedAt: 0,
		nextRefreshAt: 0,
	};

	const refreshScheduled =
		now >= state.nextRefreshAt;

	if (refreshScheduled) {
		ctx.waitUntil(
			refreshVersion(
				serverName,
				state,
				cacheSeconds,
			),
		);
	}

	return {
		version: state.version,
		source: cachedState
			? `edge-cache:${state.source}`
			: "configured-fallback",
		cacheSeconds:
			state.source === "registry" &&
			!refreshScheduled
				? cacheSeconds
				: ERROR_RETRY_SECONDS,
		refreshScheduled,
	};
}

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: {
					"access-control-allow-origin": "*",
					"access-control-allow-methods":
						"GET, OPTIONS",
					"access-control-allow-headers":
						"content-type",
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

		if (
			url.pathname === "/" ||
			url.pathname === "/health"
		) {
			return jsonResponse(
				{
					ok: true,
					service: "mcp-registry-badge",
					serverName:
						env.MCP_SERVER_NAME?.trim() ||
						null,
					badgeEndpoint:
						`${url.origin}/badge`,
					badgeSvgEndpoint:
						`${url.origin}/badge.svg`,
					cacheTtlSeconds:
						getCacheTtl(env),
					versionStateTtlSeconds:
					VERSION_STATE_TTL_SECONDS,
					fetchTimeoutMs:
					FETCH_TIMEOUT_MS,
					fallbackVersion:
						getFallbackVersion(env),
				},
				200,
				{
					"cache-control": "no-store",
				},
			);
		}

		if (
			url.pathname !== "/badge" &&
			url.pathname !== "/badge.svg"
		) {
			return jsonResponse(
				{ error: "Not found" },
				404,
			);
		}

		const badgeState =
			await getBadgeState(env, ctx);

		const source = badgeState.refreshScheduled
			? `${badgeState.source};refresh=scheduled`
			: badgeState.source;

		if (url.pathname === "/badge.svg") {
			return badgeSvgResponse(
				badgeState.version,
				badgeState.cacheSeconds,
				source,
			);
		}

		return badgeResponse(
			badgeState.version,
			badgeState.cacheSeconds,
			source,
		);
	},
} satisfies ExportedHandler<Env>;
