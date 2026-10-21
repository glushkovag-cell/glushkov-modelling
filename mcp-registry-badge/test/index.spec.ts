import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

const ORIGIN = 'https://example.com';

describe('mcp-registry-badge worker', () => {
	it('reports health without touching the registry', async () => {
		const response = await SELF.fetch(`${ORIGIN}/`);

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');

		const body = await response.json<Record<string, unknown>>();

		expect(body).toMatchObject({
			ok: true,
			service: 'mcp-registry-badge',
			serverName: 'com.glushkov-modelling/content',
		});
		expect(body.badgeEndpoint).toBe(`${ORIGIN}/badge`);
		expect(body.badgeSvgEndpoint).toBe(`${ORIGIN}/badge.svg`);
	});

	it('rejects methods other than GET with 405', async () => {
		const response = await SELF.fetch(`${ORIGIN}/`, { method: 'POST' });

		expect(response.status).toBe(405);
		expect(response.headers.get('allow')).toBe('GET, OPTIONS');
	});

	it('answers CORS preflight with 204', async () => {
		const response = await SELF.fetch(`${ORIGIN}/badge`, { method: 'OPTIONS' });

		expect(response.status).toBe(204);
		expect(response.headers.get('access-control-allow-origin')).toBe('*');
	});

	it('returns 404 for unknown paths', async () => {
		const response = await SELF.fetch(`${ORIGIN}/nope`);

		expect(response.status).toBe(404);
	});
});
