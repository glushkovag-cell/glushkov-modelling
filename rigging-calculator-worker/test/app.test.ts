import { describe, expect, it } from 'vitest';

import { handleRequest } from '../src/http/app';
import { buildInput, defaultSettings } from '../../src/lib/rigging/settings.ts';
import type { ProfileDocument, ProfileManifest } from '../../src/lib/rigging/document.ts';
import traditionalJson from '../../data/rigging/profiles/traditional_plant/1.0.0.json';
import earlyJson from '../../data/rigging/profiles/early_plant/1.2.1.json';
import manifestJson from '../../data/rigging/index.json';

const API = 'https://rigging.example.test';

const ENV = {
  PROFILE_MANIFEST: manifestJson as unknown as ProfileManifest,
  PROFILE_DOCUMENTS: {
    'traditional_plant@1.0.0': traditionalJson as unknown as ProfileDocument,
    'early_plant@1.2.1': earlyJson as unknown as ProfileDocument,
  },
};

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
    const response = await handleRequest(get('/api/rigging/v1/health'), ENV);
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      ok: true,
      apiVersion: '1',
      algorithmVersion: '1.0.0',
    });
  });

  it('profiles отдаёт манифест из четырёх профилей', async () => {
    const response = await handleRequest(get('/api/rigging/v1/profiles'), ENV);
    expect(response.status).toBe(200);
    const data = await json(response);
    expect(data.apiVersion).toBe('1');
    expect(data.profiles).toHaveLength(4);
    expect(data.profiles.map((entry: { profileId: string }) => entry.profileId)).toEqual([
      'traditional_plant',
      'yacht_metal_yacht',
      'yacht_metal_schooner',
      'early_plant',
    ]);
    expect(data.profiles[3].latest).toBe('1.2.1');
  });

  it('calculate возвращает диаметры по общему ядру', async () => {
    const response = await handleRequest(
      post('/api/rigging/v1/calculate', mainMastOnly()),
      ENV,
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
    const response = await handleRequest(post('/api/rigging/v1/calculate', input), ENV);
    const data = await json(response);
    const stay = data.results.find(
      (result: { ruleId: string }) => result.ruleId === 'st.lower.stay',
    );
    expect(stay.diameterModelMm).toBeCloseTo(1.2, 12);
  });

  it('невалидный JSON даёт 400', async () => {
    const response = await handleRequest(
      post('/api/rigging/v1/calculate', '{"broken":'),
      ENV,
    );
    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe('BAD_JSON');
  });

  it('невалидная форма тела даёт 422 с полями', async () => {
    const response = await handleRequest(post('/api/rigging/v1/calculate', {}), ENV);
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
    const response = await handleRequest(post('/api/rigging/v1/calculate', input), ENV);
    expect(response.status).toBe(200);
    const data = await json(response);
    expect(data.validationErrors[0].code).toBe('INVALID_SCALE');
  });

  it('неизвестный маршрут даёт 404', async () => {
    const response = await handleRequest(get('/api/rigging/v1/unknown'), ENV);
    expect(response.status).toBe(404);
    expect((await json(response)).error.code).toBe('NOT_FOUND');
  });

  it('неподдерживаемый метод даёт 405', async () => {
    const response = await handleRequest(get('/api/rigging/v1/calculate'), ENV);
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
      ENV,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://www.glushkov-modelling.com',
    );
    expect(response.headers.get('vary')).toBe('Origin');
  });

  it('неизвестный профиль даёт 422 и не подменяется', async () => {
    const input = mainMastOnly();
    input.profileId = 'unknown_profile';
    const response = await handleRequest(post('/api/rigging/v1/calculate', input), ENV);
    expect(response.status).toBe(422);
    const data = await json(response);
    expect(data.error.code).toBe('PROFILE_NOT_FOUND');
    expect(data.error.fields).toContain('profileId');
  });

  it('запрошенная версия профиля фиксируется в расчёте', async () => {
    const input = mainMastOnly();
    input.profileVersion = '1.0.0';
    const response = await handleRequest(post('/api/rigging/v1/calculate', input), ENV);
    expect(response.status).toBe(200);
    expect((await json(response)).profileVersion).toBe('1.0.0');
  });

  it('early_plant считается тем же ядром по документу профиля', async () => {
    const input = mainMastOnly();
    input.profileId = 'early_plant';
    input.profileVersion = '1.2.1';
    input.measurements.mastDiameter.main = {
      value: 8,
      unitId: 'mm',
      basis: 'model',
      measurementPointId: 'unknown',
    };
    const response = await handleRequest(post('/api/rigging/v1/calculate', input), ENV);
    expect(response.status).toBe(200);
    const data = await json(response);
    expect(data.profileId).toBe('early_plant');
    expect(data.profileVersion).toBe('1.2.1');
    const shroud = data.results.find(
      (result: { ruleId: string; ownerId: string }) =>
        result.ruleId === 'ep.st.lower.shroud' && result.ownerId === 'main',
    );
    expect(shroud.diameterModelMm).toBeCloseTo(3 / 28 * 8, 12);
    expect(shroud.coefficientBasis).toBe('preliminary_fit');
  });

  it('слишком большое тело даёт 413', async () => {
    const response = await handleRequest(
      post('/api/rigging/v1/calculate', 'x'.repeat(70 * 1024)),
      ENV,
    );
    expect(response.status).toBe(413);
    expect((await json(response)).error.code).toBe('BODY_TOO_LARGE');
  });
});
