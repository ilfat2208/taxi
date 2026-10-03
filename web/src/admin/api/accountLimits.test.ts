import { describe, expect, it } from 'vitest';
import { bodyOf, jsonResponse, stubFetch } from '../../test/utils';
import {
  fetchAccountLimits,
  normalizeAccountLimits,
  setAccountLimit,
  type SetAccountLimitRequest,
} from './accountLimits';

/**
 * Лимиты счёта: разбор ответа `AccountDtos.LimitsResponse` и тело `PUT`.
 *
 * Образцы ниже повторяют то, что отдаёт `AccountLimitService.snapshot`: окно без
 * настроенного лимита приходит с `configured: false` и `null` в суммах. Именно это
 * и проверяется в первую очередь — «лимита нет» не должно превращаться в «лимит 0».
 */

const LIMITS_RESPONSE = {
  accountId: '01M3Y1AYYJGHVVY7NCZQ690MJF',
  currency: 'KZT',
  limits: [
    {
      window: 'DAILY',
      configured: true,
      outgoingLimitMinor: 50_000_00,
      usedMinor: 12_300_00,
      remainingMinor: 37_700_00,
      windowStart: '2024-09-01T00:00:00Z',
      windowEnd: '2024-09-02T00:00:00Z',
      updatedAt: '2024-09-01T09:10:00Z',
    },
    {
      window: 'MONTHLY',
      configured: false,
      outgoingLimitMinor: null,
      usedMinor: 4_500_00,
      remainingMinor: null,
      windowStart: '2024-09-01T00:00:00Z',
      windowEnd: '2024-10-01T00:00:00Z',
      updatedAt: null,
    },
  ],
  velocity: { enabled: true, maxOperations: 12, window: 'PT1H', operationsInWindow: 3 },
};

describe('разбор лимитов', () => {
  it('читает настроенное и ненастроенное окно по-разному', () => {
    const limits = normalizeAccountLimits(LIMITS_RESPONSE);

    expect(limits.accountId).toBe('01M3Y1AYYJGHVVY7NCZQ690MJF');
    expect(limits.currency).toBe('KZT');
    expect(limits.limits).toHaveLength(2);

    const daily = limits.limits[0]!;
    expect(daily.configured).toBe(true);
    expect(daily.outgoingLimitMinor).toBe(5_000_000);
    expect(daily.usedMinor).toBe(1_230_000);
    expect(daily.remainingMinor).toBe(3_770_000);
    expect(daily.windowEnd).toBe('2024-09-02T00:00:00Z');

    const monthly = limits.limits[1]!;
    expect(monthly.configured).toBe(false);
    // Ключевое: отсутствие лимита — это null, а не 0 и не «осталось 0 ₸».
    expect(monthly.outgoingLimitMinor).toBeNull();
    expect(monthly.remainingMinor).toBeNull();
    expect(monthly.updatedAt).toBeNull();
    // Израсходованное в окне сервис отдаёт даже без лимита — это не выдумка.
    expect(monthly.usedMinor).toBe(450_000);
  });

  it('читает скоростной контроль', () => {
    const velocity = normalizeAccountLimits(LIMITS_RESPONSE).velocity;

    expect(velocity).toEqual({
      enabled: true,
      maxOperations: 12,
      window: 'PT1H',
      operationsInWindow: 3,
    });
  });

  it('не рисует блок скорости, которого сервис не прислал', () => {
    expect(normalizeAccountLimits({ accountId: 'acc-1', currency: 'KZT' }).velocity).toBeNull();
    expect(normalizeAccountLimits({ accountId: 'acc-1', velocity: null }).velocity).toBeNull();
    expect(normalizeAccountLimits({}).limits).toEqual([]);
  });

  it('выводит configured из суммы, если сервис не прислал флаг', () => {
    expect(normalizeAccountLimits({ limits: [{ window: 'DAILY', outgoingLimitMinor: 100 }] }).limits[0]).toMatchObject({
      configured: true,
      outgoingLimitMinor: 100,
    });
    expect(normalizeAccountLimits({ limits: [{ window: 'DAILY' }] }).limits[0]).toMatchObject({
      configured: false,
      outgoingLimitMinor: null,
    });
  });

  it('принимает числа строкой и не теряет неизвестное окно', () => {
    const [window] = normalizeAccountLimits({
      limits: [{ window: 'WEEKLY', configured: true, outgoingLimitMinor: '150000', usedMinor: '0' }],
    }).limits;

    expect(window).toMatchObject({
      window: 'WEEKLY',
      outgoingLimitMinor: 150_000,
      usedMinor: 0,
    });
  });
});

describe('запросы лимитов', () => {
  it('читает лимиты по пути контроллера', async () => {
    const fetchMock = stubFetch((url) => {
      expect(url).toBe('/api/v1/accounts/acc-1/limits');
      return jsonResponse(LIMITS_RESPONSE);
    });

    const limits = await fetchAccountLimits('acc-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(limits.limits[0]?.configured).toBe(true);
  });

  it('меняет лимит через PUT с телом window + outgoingLimitMinor', async () => {
    const fetchMock = stubFetch((url, init) => {
      expect(url).toBe('/api/v1/accounts/acc-1/limits');
      expect(init?.method).toBe('PUT');
      const sent = bodyOf<SetAccountLimitRequest>(init);
      expect(sent).toEqual({ window: 'MONTHLY', outgoingLimitMinor: 1_234_500 });
      // Валюты в теле нет: её берёт сервис, иначе лимит можно выразить не в той валюте.
      expect(Object.keys(sent)).toEqual(['window', 'outgoingLimitMinor']);
      return jsonResponse(LIMITS_RESPONSE);
    });

    const applied = await setAccountLimit('acc-1', {
      window: 'MONTHLY',
      outgoingLimitMinor: 1_234_500,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(applied.currency).toBe('KZT');
  });
});
