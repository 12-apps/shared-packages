import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * THE NATIVE UNIT-TEST LANE, IN A BROWSER-SHAPED DOM.
 *
 * `react-native` is aliased to `react-native-web`, so a `*.native.test.tsx`
 * renders the native component through the same renderer the native Storybook
 * uses and asserts on it with `@testing-library/react`: `testID` becomes
 * `data-testid`, `accessibilityRole="button"` becomes `role="button"`, and the
 * queries the web tests already use keep working. It is one toolchain for both
 * halves rather than a second runner with a second set of matchers.
 *
 * What it does NOT prove: anything about a real device — layout on Yoga's
 * native side, a gesture, a platform font. That is the harness's job
 * (`harness/native`), which bundles the PUBLISHED tarball through Metro.
 *
 * `resolve.extensions` puts `.native.*` first so a shared test story or a test
 * written against `./Button` reaches `Button.native.tsx` here and `Button.tsx`
 * under the default config — the same file, two renderers.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: 'react-native-web' },
      // Vitest resolves the bare specifier to the package's CommonJS `main`
      // and hands it to Node, whose require() then walks into React Native's
      // Flow-typed internals. Naming the ESM entry keeps it inside Vite, where
      // the `.web.js` extension order below picks the web renderer.
      { find: /^react-native-svg$/, replacement: 'react-native-svg/lib/module/index.js' },
    ],
    extensions: ['.native.tsx', '.native.ts', '.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.mjs', '.js', '.jsx', '.json'],
  },
  define: {
    // react-native-web reads this the way React Native's own runtime does.
    __DEV__: 'true',
  },
  test: {
    server: {
      deps: {
        // Transformed by Vite rather than loaded by Node, so the `.web.js`
        // extension order above applies inside them too. Left external, Node
        // loads react-native-svg's native entry, which imports React Native's
        // Flow-typed internals and dies on `import typeof`.
        inline: [/node_modules\/react-native-web\//, /node_modules\/react-native-svg\//],
      },
    },
    pool: 'forks',
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.native.ts'],
    include: ['src/**/*.native.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: 'coverage-native',
      include: ['src/**/*.native.{ts,tsx}', 'src/**/*.metrics.ts', 'src/tokens/**', 'src/platform/**'],
      exclude: ['src/**/*.test.*', 'src/**/*.stories.*'],
    },
  },
});
