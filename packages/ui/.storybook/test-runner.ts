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

    // FUT-2805 follow-up: one retry-transition story needs a request that
    // fails the FIRST time and succeeds on the cache-busted retry
    // (`?retry=N`, `useLazyImage`'s own convention) — `always-errors` always
    // fails and `never-resolves` never settles, so neither can stand in for
    // "goes from error to loaded". A tiny inline PNG, not a real fetch: real
    // networking is exactly what every other route here exists to avoid.
    const TINY_PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAHgAAABQCAIAAABd+SbeAAAAg0lEQVR42u3QQQ0AAAgEoOtkScMZyhbOBxsJSPVwIApEi0a0aNEWRItGtGjRFkSLRrRo0YgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEi0a0aNGIFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGI/mMBAXhJ2KHxSr8AAAAASUVORK5CYII=',
      'base64',
    );
    await page.route('https://lazyimage-fut2805.invalid/fails-then-loads.png*', (route) => {
      const isRetry = route.request().url().includes('retry=');
      if (isRetry) {
        route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG });
      } else {
        route.abort();
      }
    });
  },
};

export default config;
