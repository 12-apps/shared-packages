import React from 'react';
import type { ComponentType } from 'react';

import { useConfirmAction } from './ConfirmAction.hooks';
import { ConfirmActionDialog } from './ConfirmAction.parts';
import type {
  ConfirmHandler,
  ConfirmOptions,
  ConfirmableComponent,
  ConfirmableProps,
  WithConfirmationProps,
} from './ConfirmAction.types';

/**
 * Merge the HOC's baked-in defaults with the per-instance `confirm` prop.
 * Returns null when the instance opts out (`confirm={false}`) or when neither
 * side supplies the two fields a confirmation cannot be written without — the
 * question and the verb. A null result means "render the plain component",
 * which keeps the wrapped export usable in harmless contexts.
 */
function resolveOptions(
  defaults: Partial<ConfirmOptions> | undefined,
  instance: Partial<ConfirmOptions> | false | undefined,
): ConfirmOptions | null {
  if (instance === false) return null;
  const merged = { ...defaults, ...instance };
  if (!merged.title || !merged.confirmText) return null;
  return { ...merged, title: merged.title, confirmText: merged.confirmText };
}

/**
 * Adapt the wrapped component's `onClick` into a {@link ConfirmHandler}.
 *
 * The click argument is dropped (see `ConfirmHandler`) and the return value is
 * narrowed: a promise is handed back so the popup can hold its pending state
 * until the write settles, anything else becomes `undefined`. A component with
 * no `onClick` has nothing to guard, so confirming is a no-op.
 */
function useGuardedHandler(onClick: ConfirmableProps['onClick']): ConfirmHandler {
  return React.useCallback((): void | Promise<unknown> => {
    const result = onClick?.();
    return result instanceof Promise ? result : undefined;
  }, [onClick]);
}

/**
 * Give any click-driven component a confirmation popup, without restructuring
 * the call site.
 *
 * The wrapped component's own `onClick` becomes the GUARDED action: clicking
 * now opens the popup, and the handler runs only if the operator confirms. It
 * inherits the whole contract from `useConfirmAction` — cancel sends nothing, a
 * returned promise holds the popup in its pending state so a double-click
 * cannot fire two writes, and a rejection keeps the popup open carrying the
 * error.
 *
 * ```tsx
 * const ConfirmButton = withConfirmation(Button);
 *
 * <ConfirmButton
 *   color="danger"
 *   onClick={() => deleteCategoryAction({ tenantSlug, id: row.id })}
 *   confirm={{
 *     title: "Excluir a categoria?",
 *     entityName: row.name,
 *     description: "Ela vai para a lixeira e pode ser restaurada de lá.",
 *     confirmText: "Excluir",
 *   }}
 * >
 *   Excluir
 * </ConfirmButton>
 * ```
 *
 * Bake the wording in once when the same guard repeats — `withConfirmation(Button,
 * { confirmText: "Excluir" })` — and let each instance override what differs.
 * `confirm={false}` falls through to the plain component.
 *
 * Refs are not forwarded: the HOC renders a fragment (trigger + popup), so there
 * is no single node to hand back. Wrap a component that needs a ref at its own
 * call site with {@link ConfirmAction} instead.
 */
export function withConfirmation<P extends ConfirmableProps>(
  Wrapped: ComponentType<P>,
  defaults?: Partial<ConfirmOptions>,
): ConfirmableComponent<P> {
  function WithConfirmation(props: P & WithConfirmationProps): React.ReactElement {
    const { confirm, onClick } = props;
    const options = resolveOptions(defaults, confirm);
    const state = useConfirmAction(useGuardedHandler(onClick), options?.errorText);

    // `confirm` is ours and must not reach the DOM — an unknown attribute on a
    // <button> is a React warning at every render. The cast is the standard HOC
    // one: TypeScript cannot prove `Omit<P & X, 'confirm'>` is still a `P`.
    const { confirm: _confirm, ...rest } = props;
    const forwarded = rest as unknown as P;

    if (!options) return <Wrapped {...forwarded} />;

    return (
      <>
        <Wrapped {...forwarded} onClick={state.request} />
        <ConfirmActionDialog state={state} {...options} />
      </>
    );
  }

  WithConfirmation.displayName = `withConfirmation(${
    Wrapped.displayName ?? Wrapped.name ?? 'Component'
  })`;

  return WithConfirmation;
}
