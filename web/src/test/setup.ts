import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Vitest environment setup (referenced by `vite.config.ts` -> `test.setupFiles`).
 *
 * jsdom implements neither `matchMedia` nor `ResizeObserver` nor `scrollTo`, and
 * components (or the router) touch all three; the stubs keep the suite from
 * failing for reasons unrelated to the behaviour under test.
 */
if (typeof window !== 'undefined') {
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }

  if (typeof window.scrollTo !== 'function') {
    Object.defineProperty(window, 'scrollTo', { writable: true, value: () => undefined });
  }

  if (typeof globalThis.ResizeObserver !== 'function') {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      writable: true,
      value: ResizeObserverStub,
    });
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  try {
    window.localStorage.clear();
  } catch {
    /* storage disabled in this environment */
  }
});
