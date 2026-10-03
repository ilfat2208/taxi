import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/errors';
import { stubFetch } from '../../test/utils';
import {
  GATEWAY_HEALTH_PATH,
  fetchGatewayHealth,
  gatewayHealthUrl,
  normalizeGatewayHealth,
} from './gatewayHealth';

/**
 * Состояние шлюза для раздела «Обзор».
 *
 * Главное, что здесь проверяется, — не разбор happy path, а честность: `DOWN`
 * приходит с HTTP 503 и обязан остаться ДАННЫМИ о здоровье, а не превратиться в
 * «ошибку запроса»; детализация, которой шлюз не отдал, не должна считаться
 * пустым списком здоровых проверок.
 */

describe('адрес здоровья', () => {
  it('берёт относительный путь: /api-префикс к актуатору не относится', () => {
    // В тестовой сборке VITE_API_BASE_URL не задан, значит API_BASE_URL === '/api'.
    expect(gatewayHealthUrl()).toBe(GATEWAY_HEALTH_PATH);
  });
});

describe('разбор ответа актуатора', () => {
  it('читает UP с детализацией проверок', () => {
    const health = normalizeGatewayHealth({
      status: 'UP',
      components: {
        db: { status: 'UP', details: { database: 'PostgreSQL' } },
        redis: { status: 'UP' },
        ping: { status: 'UP' },
      },
    });

    expect(health.status).toBe('UP');
    expect(health.detailsExposed).toBe(true);
    expect(health.components.map((component) => component.name)).toEqual(['db', 'ping', 'redis']);
    expect(health.components.every((component) => component.status === 'UP')).toBe(true);
    expect(health.httpStatus).toBe(200);
  });

  it('оставляет DOWN данными о здоровье и запоминает HTTP-код', () => {
    const health = normalizeGatewayHealth({ status: 'DOWN', components: { db: { status: 'DOWN' } } }, 503);

    expect(health.status).toBe('DOWN');
    expect(health.httpStatus).toBe(503);
    expect(health.components).toEqual([{ name: 'db', status: 'DOWN' }]);
  });

  it('не выдумывает детализацию, когда шлюз отдал только статус', () => {
    const health = normalizeGatewayHealth({ status: 'UP' });

    expect(health.components).toEqual([]);
    expect(health.detailsExposed).toBe(false);
  });

  it('не принимает непонятную проверку за здоровую', () => {
    const health = normalizeGatewayHealth({
      status: 'UP',
      components: { db: { status: 200 }, cache: 'UP' },
    });

    expect(health.components).toEqual([
      { name: 'cache', status: 'UNKNOWN' },
      { name: 'db', status: 'UNKNOWN' },
    ]);
  });

  it('без статуса отвечает UNKNOWN, а не UP', () => {
    expect(normalizeGatewayHealth({}).status).toBe('UNKNOWN');
    expect(normalizeGatewayHealth(null).status).toBe('UNKNOWN');
    expect(normalizeGatewayHealth({ status: '' }).status).toBe('UNKNOWN');
  });
});

describe('запрос здоровья', () => {
  it('разбирает 503 с телом DOWN как состояние, а не как ошибку', async () => {
    stubFetch((url) => {
      expect(url).toBe(GATEWAY_HEALTH_PATH);
      return {
        ok: false,
        status: 503,
        headers: new Headers(),
        text: async () => JSON.stringify({ status: 'DOWN', components: { db: { status: 'DOWN' } } }),
      };
    });

    const health = await fetchGatewayHealth();

    expect(health.status).toBe('DOWN');
    expect(health.httpStatus).toBe(503);
  });

  it('на HTML от прокси бросает ApiError с кодом шлюза', async () => {
    stubFetch(() => ({
      ok: false,
      status: 502,
      headers: new Headers(),
      text: async () => '<html>502 Bad Gateway</html>',
    }));

    await expect(fetchGatewayHealth()).rejects.toBeInstanceOf(ApiError);
    await expect(fetchGatewayHealth()).rejects.toMatchObject({ status: 502 });
  });

  it('не молчит, если 200 пришёл не отчётом о здоровье', async () => {
    stubFetch(() => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => '<html>index</html>',
    }));

    await expect(fetchGatewayHealth()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
