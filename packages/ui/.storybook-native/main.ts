import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { StorybookConfig } from '@storybook/react-native-web-vite';
import { mergeConfig } from 'vite';

/**
 * THE NATIVE STORYBOOK: THE SAME STORIES, THE OTHER RENDERER.
 *
 * `@storybook/react-native-web-vite` renders React Native components in a
 * browser through react-native-web. Pointed at the SAME `*.stories.tsx` and
 * `*.test.stories.tsx` files the MUI Storybook uses, with `.native.*` resolved
 * ahead of the web file, every story and every `play` function runs against
 * `Button.native.tsx` here and `Button.tsx` there. A test story that passes in
 * both is the proof the two renderers agree; one that passes in only one is a
 * parity finding, not a flake.
 *
 * Which stories: exactly the components `entries.native.json` lists. Derived,
 * not written down, so a component ported without being wired into the
 * exports map does not show up here either — and the ledger stays honest.
 *
 * Stories tagged `native-skip` assert something only a DOM can answer (a real
 * `<button disabled>`, a computed CSS transform). They still run in the web
 * Storybook; the native test-runner excludes the tag and the parity gate
 * counts them.
 */
const root = dirname(fileURLToPath(import.meta.url));
const nativeEntries: Record<string, string> = JSON.parse(
  readFileSync(join(root, '../entries.native.json'), 'utf8'),
);

/** `src/components/form/Button/index.native.ts` -> `../src/components/form/Button/*.stories.@(ts|tsx)` */
const storyGlobs = Object.values(nativeEntries)
  .filter((source) => source.startsWith('src/components/'))
  .map((source) => `../${dirname(source)}/*.stories.@(ts|tsx)`);

const config: StorybookConfig = {
  stories: [...storyGlobs, '../src/icons/*.stories.@(ts|tsx)', '../src/**/*.native.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-links', '@storybook/addon-docs'],
  framework: {
    name: '@storybook/react-native-web-vite',
    options: {
      pluginReactOptions: {
        // The package's own native sources are TypeScript with no Flow, so
        // nothing needs the Babel pass; react-native-svg ships web builds.
        jsxRuntime: 'automatic',
      },
    },
  },
  async viteFinal(config) {
    return mergeConfig(config, {
      resolve: {
        // Same reason as vitest.native.config.ts: keep react-native-svg on its
        // ESM entry so the `.web.js` extension order below reaches its web renderer.
        alias: [{ find: /^react-native-svg$/, replacement: 'react-native-svg/lib/module/index.js' }],
        // The whole trick: `./Button` finds `Button.native.tsx` before `Button.tsx`.
        extensions: ['.native.tsx', '.native.ts', '.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.mjs', '.js', '.jsx', '.json'],
      },
      build: {
        rollupOptions: {
          onwarn(warning: { code?: string; message: string }, warn: (w: unknown) => void) {
            if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
            if (warning.message.includes('sourcemap')) return;
            warn(warning);
          },
        },
      },
    });
  },
};

export default config;
