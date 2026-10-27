import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/catalog/client';

describe('точка входа Worker', () => {
  it('экспортирует fetch и отвечает на health без конфигурации', async () => {
    const response = await worker.fetch(
      new Request('https://api.example.test/api/rope/v1/health'),
      {} as Env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, apiVersion: '1' });
  });
});
