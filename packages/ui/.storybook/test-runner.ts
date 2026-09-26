import type { TestRunnerConfig } from '@storybook/test-runner';

// CodeEditor's Monaco now loads from this package's own `monaco-editor`
// dependency, bundled by whatever Vite entry calls `configureCodeEditor`
// (`.storybook/preview.tsx`, and any host — see CodeEditor.md), instead of
// `@monaco-editor/react`'s default CDN loader (FUT-2697). Aborting the CDN
// host here is the proof: a story that still depended on it would time out
// waiting for `.monaco-editor` to mount, rather than pass by accident on a
// runner that happens to reach the network.
const config: TestRunnerConfig = {
  async preVisit(page) {
    await page.route('**/cdn.jsdelivr.net/**', (route) => route.abort());

    // FUT-2774: LazyImage's `.test.stories.tsx` probes two real-browser sizing
    // claims. `always-errors` aborts at once, so the <img> fires `error` on the
    // first frame with nothing to wait on. `never-resolves` is intercepted and
    // never told to `abort`/`continue`/`fulfill`, so the request stays pending
    // for the run's whole life — `isLoading` never flips, and the loading
    // indicator (what's under test) stays up deterministically instead of
    // racing the real network.
    await page.route('https://lazyimage-fut2774.invalid/always-errors.png', (route) => route.abort());
    await page.route('https://lazyimage-fut2774.invalid/never-resolves.png', () => {
      // Intentionally does not resolve the route.
    });
  },
};

export default config;
