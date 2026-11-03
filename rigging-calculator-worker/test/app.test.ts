import { describe, expect, it } from 'vitest';

import { handleRequest } from '../src/http/app';
import { buildInput, defaultSettings } from '../../src/lib/rigging/settings.ts';

const API = 'https://rigging.example.test';

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`${API}${path}`, { headers });
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function json(response: Response): Promise<any> {
  return response.json();
}

function mainMastOnly() {
  const settings = defaultSettings();
  for (const mastId of ['fore', 'mizzen'] as const) {
    settings.masts[mastId].present = false;
  }
  settings.masts.main.yards = { lower: false, topmast: false, topgallant: false };
  settings.bowsprit.present = false;
  settings.anchor.present = false;
  settings.gun.present = false;
  settings.gaff.present = false;
  for (const sailClass of Object.keys(settings.foreAndAft) as Array<
    keyof typeof settings.foreAndAft
  >) {
    settings.foreAndAft[sailClass].present = false;
  }
  return buildInput(settings);
}

describe('rigging API', () => {
  it('health не требует данных', async () => {
    const response = await handleRequest(get('/api/rigging/v1/health'));
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      ok: true,
      apiVersion: '1',
      algorithmVersion: '1.0.0',
    });
  });

  it('profiles отдаёт опубликованный traditional_plant', async () => {
    const response = await handleRequest(get('/api/rigging/v1/profiles'));
    expect(response.status).toBe(200);
    const data = await json(response);
    expect(data.profiles).toHaveLength(1);
    expect(data.profiles[0]).toMatchObject({
      profileId: 'traditional_plant',
      status: 'published',
      yearFrom: 1625,
      yearTo: 1860,
    });
    expect(data.profiles[0].sources[0]).toContain('Lees');
  });

  it('calculate возвращает диаметры по общему ядру', async () => {
    const response = await handleRequest(
      post('/api/rigging/v1/calculate', mainMastOnly()),
    );
    expect(response.status).toBe(200);

    const data = await json(response);
    expect(data.apiVersion).toBe('1');
    expect(data.profileId).toBe('traditional_plant');
    expect(data.profileVersion).toBe('1.0.0');
    expect(Array.isArray(data.results)).toBe(true);

    const stay = data.results.find(
      (result: { ruleId: string; nodeId: string }) =>
        result.ruleId === 'st.lower.stay' && result.nodeId.includes('main'),
    );
    expect(stay).toBeTruthy();
    expect(stay.diameterModelMm).toBeCloseTo(1.2, 12);

    const shroud = data.results.find(
      (result: { ruleId: string }) => result.ruleId === 'st.lower.shroud',
    );
    expect(shroud.diameterModelMm).toBeCloseTo(0.66, 12);
  });

  it('диапазон профиля и модель/прототип обрабатываются ядром', async () => {
    const input = mainMastOnly();
    input.measurements.mastDiameter.main = {
      value: 640,
      unitId: 'mm',
      basis: 'prototype',
      measurementPointId: 'partner',
    };
    const response = await handleRequest(post('/api/rigging/v1/calculate', input));
    const data = await json(response);
    const stay = data.results.find(
      (result: { ruleId: string }) => result.ruleId === 'st.lower.stay',
    );
    expect(stay.diameterModelMm).toBeCloseTo(1.2, 12);
  });

  it('невалидный JSON даёт 400', async () => {
    const response = await handleRequest(
      post('/api/rigging/v1/calculate', '{"broken":'),
    );
    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe('BAD_JSON');
  });

  it('невалидная форма тела даёт 422 с полями', async () => {
    const response = await handleRequest(post('/api/rigging/v1/calculate', {}));
    expect(response.status).toBe(422);
    const data = await json(response);
    expect(data.error.code).toBe('INVALID_PARAMS');
    expect(data.error.fields).toContain('scaleDenominator');
    expect(data.error.fields).toContain('nodes');
    expect(data.error.fields).toContain('measurements');
  });

  it('доменная валидация возвращается в validationErrors', async () => {
    const input = mainMastOnly();
    input.scaleDenominator = 0;
    const response = await handleRequest(post('/api/rigging/v1/calculate', input));
    expect(response.status).toBe(200);
    const data = await json(response);
    expect(data.validationErrors[0].code).toBe('INVALID_SCALE');
  });

  it('неизвестный маршрут даёт 404', async () => {
    const response = await handleRequest(get('/api/rigging/v1/unknown'));
    expect(response.status).toBe(404);
    expect((await json(response)).error.code).toBe('NOT_FOUND');
  });

  it('неподдерживаемый метод даёт 405', async () => {
    const response = await handleRequest(get('/api/rigging/v1/calculate'));
    expect(response.status).toBe(405);
    expect((await json(response)).error.code).toBe('METHOD_NOT_ALLOWED');
  });

  it('preflight возвращает 204 и CORS для разрешённого origin', async () => {
    const response = await handleRequest(
      new Request(`${API}/api/rigging/v1/calculate`, {
        method: 'OPTIONS',
        headers: {
          origin: 'https://www.glushkov-modelling.com',
          'access-control-request-method': 'POST',
        },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://www.glushkov-modelling.com',
    );
    expect(response.headers.get('vary')).toBe('Origin');
  });

  it('слишком большое тело даёт 413', async () => {
    const response = await handleRequest(
      post('/api/rigging/v1/calculate', 'x'.repeat(70 * 1024)),
    );
    expect(response.status).toBe(413);
    expect((await json(response)).error.code).toBe('BODY_TOO_LARGE');
  });
});
