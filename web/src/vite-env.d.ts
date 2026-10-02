/// <reference types="vite/client" />

/**
 * Environment variables consumed by the client.
 *
 * `tsconfig.json` pins an explicit `types` array (vitest globals, jest-dom, node),
 * so `vite/client` is not picked up automatically — this reference is what makes
 * `import.meta.env` type-check in `src/api/client.ts`.
 */
interface ImportMetaEnv {
  /** Base URL of the gateway. Defaults to `/api`, which the dev server proxies. */
  readonly VITE_API_BASE_URL?: string;
  /** Target of the dev-server proxy (read by `vite.config.ts`). */
  readonly VITE_GATEWAY_URL?: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
