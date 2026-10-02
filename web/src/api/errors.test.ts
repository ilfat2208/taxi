import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError, fieldErrorOf, humanMessage, toApiError } from './errors';

/**
 * The API answers failures with RFC 7807 `problem+json`, and the client must turn
 * that into something a user can act on: a code to map, a detail to show, field
 * errors to attach to inputs and a correlation id to quote to support.
 */
describe('RFC 7807 error parsing', () => {
  it('parses a full problem+json body, including field errors and correlationId', () => {
    const body = JSON.stringify({
      type: 'https://docs.taxi.local/errors/INSUFFICIENT_FUNDS',
      title: 'Unprocessable Entity',
      status: 422,
      detail: 'account 01J8 has 500.00 KZT available but 1500.00 KZT is required',
      code: 'INSUFFICIENT_FUNDS',
      instance: '/api/v1/payments/transfers',
      correlationId: '01J8ZCQ7Y4R3F0N5G8K2M9QW1T',
      timestamp: '2024-09-01T10:15:30Z',
      details: { accountId: '01J8', availableMinor: 50000, requiredMinor: 150000 },
      errors: [{ field: 'amountMinor', message: 'amountMinor must be positive', rejectedValue: -1 }],
    });

    const error = toApiError(422, body, 'header-correlation');

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(422);
    expect(error.code).toBe('INSUFFICIENT_FUNDS');
    expect(error.instance).toBe('/api/v1/payments/transfers');
    expect(error.correlationId).toBe('01J8ZCQ7Y4R3F0N5G8K2M9QW1T');
    expect(error.fieldError('amountMinor')).toBe('amountMinor must be positive');
    expect(fieldErrorOf(error, 'amountMinor')).toBe('amountMinor must be positive');
    expect(error.detail).toContain('available but');
    expect(error.retryable).toBe(false);
    // The code is mapped to human wording, which wins over the English detail.
    expect(humanMessage(error)).toBe('Недостаточно средств на счёте');

    // A 5xx keeps the correlation id and is marked retryable.
    const broken = toApiError(500, JSON.stringify({ code: 'INTERNAL_ERROR' }), 'corr-500');
    expect(broken.retryable).toBe(true);
    expect(broken.correlationId).toBe('corr-500');
  });

  it('degrades gracefully when the body is HTML, empty or an unusual problem', () => {
    const html = toApiError(502, '<html><body>502 Bad Gateway</body></html>', 'corr-502');
    expect(html.code).toBe('INTERNAL_ERROR');
    expect(html.correlationId).toBe('corr-502');
    expect(html.detail).not.toContain('<html');

    const empty = toApiError(500, '', 'corr-500');
    expect(empty.detail).toBe('Внутренняя ошибка сервиса');

    const conflict = toApiError(409, JSON.stringify({ code: 'IDEMPOTENCY_CONFLICT' }), null);
    expect(humanMessage(conflict)).toBe('Этот запрос уже отправлялся с другими данными');

    const unknown = toApiError(400, JSON.stringify({ code: 'WEIRD_CODE', detail: 'Своими словами' }), null);
    expect(humanMessage(unknown)).toBe('Своими словами');

    // Transport failures are explained differently, and keep their request id.
    const network = new NetworkError('Не удалось связаться с сервером', { correlationId: 'corr-net' });
    expect(humanMessage(network)).toContain('Нет связи с сервером');
    expect(network.correlationId).toBe('corr-net');
    expect(network.retryable).toBe(true);

    const aborted = new NetworkError('Запрос отменён', { aborted: true });
    expect(aborted.retryable).toBe(false);
    expect(humanMessage(aborted)).toBe('Запрос отменён');
  });
});
