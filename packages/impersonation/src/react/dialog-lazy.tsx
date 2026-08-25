/**
 * The start dialog, fetched when an operator opens one.
 *
 * `createWebImpersonation` already promises that "an app that only ever WEARS
 * sessions (a storefront) mounts the banner and nothing else". That promise was
 * true at RUNTIME — the factory returns `dialog: null` when no dialog is
 * configured — and false in the BUNDLE, because the factory reached `./dialog`
 * through a static import. A module graph does not read the `if`.
 *
 * What that cost is not theoretical. The dialog is a form: a tenant picker, an
 * app picker, a justification box and a write opt-in, which between them pull
 * `Select`, `Switch`, `Textarea` and `Dialog` out of `@12-apps/ui` and, through
 * them, some FIFTY `@mui/material` component modules. Every one of those was on
 * the storefront's critical path — parsed by a shopper's phone before the menu
 * could render, to support a screen only a platform operator can ever open.
 *
 * So the split follows the CONFIGURATION, which is what the API always said it
 * did:
 *
 *   - no `dialog` config -> `dialog: null`, and now nothing of `./dialog` is in
 *     the graph at all.
 *   - a `dialog` config  -> this boundary, plus a bind-time prefetch. The chunk
 *     starts downloading while the app boots, exactly as it did when it was part
 *     of the entry, so the operator's first click is no slower than before. What
 *     changes for that app is only that the bytes are no longer PARSED before
 *     its first paint.
 *
 * The banner is deliberately NOT treated this way and must not be: a chunk that
 * fails to load is a banner that does not render, and the start handshake
 * refuses to open a session in a document with no banner host. That rule is
 * about the bar. The dialog is opened by a deliberate click, by an operator, on
 * a back-office network.
 */
import { Suspense, lazy, type ComponentType, type JSX } from 'react';

import type { DialogParts, ImpersonationDialogProps } from './dialog';

/**
 * One module specifier, named once.
 *
 * The prefetch below and the `lazy` boundary MUST name the same module for the
 * prefetch to warm the boundary's fetch rather than a second copy of it.
 */
const loadDialog = (): Promise<typeof import('./dialog')> => import('./dialog');

/**
 * Start fetching the dialog now, for a host that configured one.
 *
 * Fire-and-forget on purpose: a failed prefetch must not reject anywhere a host
 * could see it, because the boundary re-imports on render and that is where a
 * real failure belongs. `import()` results are cached per module, so the render
 * either finds this promise already settled or joins it.
 */
export function prefetchImpersonationDialog(): void {
  void loadDialog().catch(() => undefined);
}

/**
 * A dialog component that loads its own implementation.
 *
 * `lazy` memoises the factory, so `bindImpersonationDialog(parts)` runs once no
 * matter how many times an operator opens the dialog — the same guarantee the
 * direct call gave.
 *
 * The fallback is `null` rather than a spinner because callers mount this
 * component only WHILE OPEN (`dialog.tsx` documents that, and relies on it for
 * its own state to reset). There is no closed-but-mounted frame to fill, so a
 * fallback with chrome of its own would flash a second surface in front of the
 * one the operator asked for.
 */
export function lazyImpersonationDialog(
  parts: DialogParts,
): ComponentType<ImpersonationDialogProps> {
  const Bound = lazy(async () => {
    const { bindImpersonationDialog } = await loadDialog();
    return { default: bindImpersonationDialog(parts) };
  });

  return function ImpersonationDialogBoundary(props: ImpersonationDialogProps): JSX.Element {
    return (
      <Suspense fallback={null}>
        <Bound {...props} />
      </Suspense>
    );
  };
}
