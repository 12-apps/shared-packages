import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';

/**
 * Storybook for `@12-apps/payments-frontend` (FUT-742).
 *
 * Modelled on `packages/ui/.storybook/main.ts` — same framework, same addons,
 * same tunnel-host handling — because a second, differently-shaped Storybook in
 * one repo is a second thing to keep working.
 *
 * What is deliberately NOT here: any alias, any `optimizeDeps` entry for our own
 * packages, any `ssr.noExternal`. The stories import `@12-apps/payments-backend`
 * the way a consumer would. If that needs special Vite config to resolve, that
 * is a packaging bug in the backend, and papering over it here would hide it.
 */

// Storybook answers 403 "Invalid host" to any Host header it was not told
// about, which is every host a tunnel puts in front of it.
//
// STORYBOOK_ALLOWED_HOSTS: 'all', or a comma-separated host list. Unset keeps
// the default — local and network addresses only.
function allowedHosts(): true | string[] {
  const raw = process.env.STORYBOOK_ALLOWED_HOSTS?.trim() ?? '';
  if (raw === 'all') return true;
  return raw
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
}

/**
 * Hot reload through a tunnel.
 *
 * Vite's HMR client derives its websocket URL from the PAGE's location, so a
 * Storybook served at `https://<host>/` tries to open `wss://<host>:6007/` — a
 * port no tunnel forwards. The socket never connects and the page silently
 * stops updating, which is worse than no HMR because nothing says it happened.
 */
function hmr(): { protocol: string; host: string; clientPort: number } | undefined {
  const raw = process.env.STORYBOOK_ALLOWED_HOSTS?.trim() ?? '';
  // 'all' names no host to connect back to, so there is nothing to point at.
  const host = raw === 'all' ? '' : raw.split(',')[0]?.trim();
  if (!host) return undefined;
  return { protocol: 'wss', host, clientPort: 443 };
}

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: ['@storybook/addon-links', '@storybook/addon-docs'],

  core: {
    allowedHosts: allowedHosts(),
  },

  framework: {
    name: '@storybook/react-vite',
    options: {},
  },

  async viteFinal(viteConfig) {
    return mergeConfig(viteConfig, {
      server: { hmr: hmr() },
      optimizeDeps: {
        // Pre-bundle the docs renderer's own React dependency. builder-vite's
        // candidate list does not name it, and under pnpm it is reachable only
        // through @storybook/addon-docs — so without this Vite first meets it
        // when a docs page loads, re-optimizes, and reloads mid-render, leaving
        // the page holding two optimizer generations and two copies of React.
        include: ['@storybook/addon-docs > @mdx-js/react'],
      },
    });
  },
};

export default config;
