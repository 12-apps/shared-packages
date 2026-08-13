import type { JSX } from 'react';

/**
 * A routed page in its own chunk — reached only through the `import()` inside
 * `lazyRoute`, which is what makes the bundler emit it separately.
 *
 * Its own module for that reason: fold it into the panel and there is no dynamic
 * import left, so the thing under test stops existing while the spec keeps passing.
 */
export default function LazyChunk(): JSX.Element {
  return <p data-testid="lazy-loaded">chunk carregado</p>;
}
