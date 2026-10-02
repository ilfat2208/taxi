import { describe, expect, it } from 'vitest';
import { IdempotencyKeyHolder, transferSignature } from './idempotency';

/**
 * The idempotency rule the money path depends on: one key per *intent*.
 *
 * A retry of the same payload must reuse the key (so the server replays instead of
 * moving money twice), while a changed payload or an explicit "repeat" must mint a
 * new one (otherwise the server answers 409 or replays the wrong payment).
 */
describe('IdempotencyKeyHolder', () => {
  it('reuses the key for the same payload and mints a new one when it changes', () => {
    let counter = 0;
    const holder = new IdempotencyKeyHolder(() => `key-${++counter}`);

    const first = transferSignature({ sourceAccountId: 'acc-1', targetPhone: '+77009998877', amountMinor: 150000 });
    const sameAgain = transferSignature({ amountMinor: 150000, targetPhone: '+77009998877', sourceAccountId: 'acc-1' });
    const changed = transferSignature({ sourceAccountId: 'acc-1', targetPhone: '+77009998877', amountMinor: 200000 });

    // Same intent (even with the fields in another order) -> same key: a retry.
    expect(holder.acquire(first)).toBe('key-1');
    expect(holder.acquire(first)).toBe('key-1');
    expect(holder.acquire(sameAgain)).toBe('key-1');

    // The amount changed -> this is a different payment, so a different key.
    expect(holder.acquire(changed)).toBe('key-2');

    // A deliberate repeat after a successful transfer starts a brand-new intent.
    holder.reset();
    expect(holder.current).toBeNull();
    expect(holder.acquire(changed)).toBe('key-3');
  });
});
