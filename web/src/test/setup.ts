import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Vitest environment setup (referenced by `vite.config.ts` -> `test.setupFiles`).
 *
 * jsdom implements neither `matchMedia` nor `ResizeObserver` nor `scrollTo`, and
 * components (or the router) touch all three; the stubs keep the suite from
 * failing for reasons unrelated to the behaviour under test.
 */

/**
 * Vitest runs one worker per test file, and the page tests mount real routers with
 * lazily imported Leaflet maps. Under that load a page can take longer than the
 * one-second default of `findBy*`/`waitFor` to appear, which used to fail a random
 * handful of tests per run. Waiting longer only makes the *success* path patient:
 * a missing element still fails the test, just after five seconds instead of one.
 */
configure({ asyncUtilTimeout: 5_000 });

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
