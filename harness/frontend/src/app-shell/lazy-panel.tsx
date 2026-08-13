import { Suspense, type ComponentType, type JSX } from 'react';

/**
 * A route chunk loaded through the published `lazyRoute` (12-18).
 *
 * The unit suite drives `loadRouteChunk` against a rejected promise, which is the
 * failure path. What it cannot cover is the ordinary one: that `lazyRoute` is still
 * `React.lazy`'s call shape, that a bundler emits a real separate chunk for the
 * `import()` inside it, and that the module arrives and renders. That is a claim about
 * a built bundle, so it can only be made here.
 *
 * The component is built at MODULE scope by the page and passed in — which is also the
 * only correct way to use it. `lazyRoute` called during a render returns a new
 * component type every time, so React would unmount and refetch the chunk on each
 * parent render.
 */
export function LazyPanel({ Chunk }: { Chunk: ComponentType }): JSX.Element {
  return (
    <section>
      <h3>Lazy route</h3>
      <Suspense fallback={<p data-testid="lazy-pending">carregando…</p>}>
        <Chunk />
      </Suspense>
    </section>
  );
}
