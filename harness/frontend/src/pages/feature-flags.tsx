import type { JSX } from 'react';

import { featureFlagsManifest } from '@12-apps/feature-flags/manifest';
import { featureFlagsWebManifest } from '@12-apps/feature-flags/manifest/web';
import type { FeatureFlagsApiClient } from '@12-apps/feature-flags/react';
import { createWiringHost } from '@12-apps/wiring/consumer';

/**
 * `@12-apps/feature-flags` (FUT-884), adopted through the wiring consumer's
 * WEB half — the management screen a platform operator uses to put individual
 * people into a beta. The host supplies only what is genuinely its own: how
 * to reach the mounted server half (plain same-origin `fetch`; Vite proxies
 * `/api` to `harness/backend`, so every click below crosses a real socket
 * into the packed tarball's own handlers). Copy stays the package's pt-BR
 * defaults.
 *
 * Assembled at MODULE scope — the memoisation rule: surface members are
 * component TYPES, so a rebuild per render unmounts the tree.
 */

const BASE = '/api/platform/feature-flags';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Falha na requisição (${response.status}).`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function write(method: 'POST' | 'PUT', body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

const api: FeatureFlagsApiClient = {
  listFlags: () => call(''),
  listGrants: (key, page) => call(`/${encodeURIComponent(key)}/grants?page=${page}`),
  grantByEmail: (key, input) => call(`/${encodeURIComponent(key)}/grants`, write('POST', input)),
  setGrant: (key, userId, patch) =>
    call(`/${encodeURIComponent(key)}/grants/${encodeURIComponent(userId)}`, write('PUT', patch)),
  revoke: (key, userId) =>
    call(`/${encodeURIComponent(key)}/grants/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
};

const host = createWiringHost({
  name: 'harness-frontend',
  kind: 'web',
  // The browser half of the observability capability (mandatory since
  // wiring 1.3.0): errors tag with the package's namespace. The harness's
  // sink is the console.
  ports: {
    loggerFor: (namespace) => ({
      info: (message, ...meta) => console.info(`[${namespace}] ${message}`, ...meta),
      warn: (message, ...meta) => console.warn(`[${namespace}] ${message}`, ...meta),
      error: (message, ...meta) => console.error(`[${namespace}] ${message}`, ...meta),
    }),
  },
});
host.adoptWeb({
  manifest: featureFlagsManifest,
  web: featureFlagsWebManifest,
  bindings: { surface: { config: { api } } },
});

const surface = host.assemble().surfaces['@12-apps/feature-flags'] as {
  page: () => JSX.Element;
};

const Surface = surface.page;

export function FeatureFlagsPage(): JSX.Element {
  return (
    <div data-testid="page-feature-flags">
      <Surface />
    </div>
  );
}
