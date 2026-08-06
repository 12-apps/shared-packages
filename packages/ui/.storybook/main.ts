import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';

// Storybook answers 403 "Invalid host" to any Host header it was not told
// about, which is every host a tunnel puts in front of it (scripts/tunnel.sh).
// This one value covers both checks: core-server's own middleware reads it, and
// builder-vite forwards it to Vite's server.allowedHosts.
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

const config: StorybookConfig = {
  stories: [
    '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)',
    // Sibling packages whose components must be explorable without a host
    // (FUT-420) — same single Storybook, their stories grouped by title.
    '../../product-research-ui/src/**/*.stories.@(ts|tsx)',
  ],
  addons: ['@storybook/addon-links', '@storybook/addon-docs'],

  core: {
    allowedHosts: allowedHosts(),
  },

  framework: {
    name: '@storybook/react-vite',
    options: {},
  },

  async viteFinal(config) {
    const { default: istanbul } = await import('vite-plugin-istanbul');

    config.build = config.build || {};
    config.build.rollupOptions = config.build.rollupOptions || {};
    config.build.rollupOptions.onwarn = (warning, warn) => {
      // Ignore "use client" directive warnings
      if (warning.code === 'MODULE_LEVEL_DIRECTIVE') {
        return;
      }
      // Ignore sourcemap warnings
      if (warning.message.includes('sourcemap')) {
        return;
      }
      // Log other warnings
      warn(warning);
    };

    return mergeConfig(config, {
      plugins: [
        istanbul({
          include: ['src/**/*.{ts,tsx}'],
          exclude: ['node_modules', 'test/', '**/*.stories.{ts,tsx}', '**/*.test.{ts,tsx}'],
          requireEnv: false,
          forceBuildInstrument: true,
        }),
      ],
      optimizeDeps: {
        // Pre-bundle the docs renderer's own React dependency. builder-vite's
        // candidate list does not name it, and under pnpm it is reachable only
        // through @storybook/addon-docs — so without this Vite first meets it
        // when a docs page loads, re-optimizes, and reloads mid-render:
        //
        //   [vite] new dependencies optimized: @mdx-js/react
        //   [vite] optimized dependencies changed. reloading
        //
        // The page is then holding two optimizer generations, so React and MDX
        // resolve to different copies and every docs page dies on
        // "Cannot read properties of null (reading 'useContext')".
        include: ['@storybook/addon-docs > @mdx-js/react'],
      },
    });
  },
};

export default config;
