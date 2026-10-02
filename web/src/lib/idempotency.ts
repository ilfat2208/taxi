import { useCallback, useRef } from 'react';
import { newIdempotencyKey } from '../api/client';

/**
 * One `Idempotency-Key` per user *intent*, not per HTTP attempt.
 *
 * The API replays the original response when a request is repeated with the same
 * key and the same body, and answers `409 IDEMPOTENCY_CONFLICT` when the key is
 * reused with a different body. That gives the client a simple rule:
 *
 *  - a retry of the *same* payload (network blip, user pressing "Повторить" after
 *    a 5xx) must reuse the key, so the money moves at most once;
 *  - any change to the payload — or a deliberate "repeat transfer" — must mint a
 *    new key, otherwise the server would reject or replay the wrong request.
 *
 * The holder is keyed by a *signature* (all money-moving fields serialized), which
 * implements exactly that rule and makes it unit-testable without React.
 */
export class IdempotencyKeyHolder {
  private signature: string | null = null;
  private key: string | null = null;
  private readonly generate: () => string;

  constructor(generate: () => string = newIdempotencyKey) {
    this.generate = generate;
  }

  /** Key for this payload: reused while the signature is unchanged. */
  acquire(signature: string): string {
    if (this.key === null || this.signature !== signature) {
      this.key = this.generate();
      this.signature = signature;
    }
    return this.key;
  }

  /** Drop the key so the next submit is a brand-new intent ("Повторить"). */
  reset(): void {
    this.key = null;
    this.signature = null;
  }

  get current(): string | null {
    return this.key;
  }
}

export interface UseIdempotencyKey {
  /** Key to send for this payload, generated on first use. */
  acquire: () => string;
  /** Forget the key: the next submit is a new intent. */
  reset: () => void;
  holder: IdempotencyKeyHolder;
}

/** React binding for {@link IdempotencyKeyHolder}. */
export function useIdempotencyKey(signature: string): UseIdempotencyKey {
  const holderRef = useRef<IdempotencyKeyHolder | null>(null);
  if (holderRef.current === null) {
    holderRef.current = new IdempotencyKeyHolder();
  }
  const holder = holderRef.current;

  const acquire = useCallback(() => holder.acquire(signature), [holder, signature]);
  const reset = useCallback(() => holder.reset(), [holder]);

  return { acquire, reset, holder };
}

/** Stable serialization of the fields that must not change under one key. */
export function transferSignature(input: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(input)
      .sort()
      .map((key) => [key, input[key] ?? null]),
  );
}
