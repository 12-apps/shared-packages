import React from 'react';

import { useConfirmAction } from './ConfirmAction.hooks';
import { ConfirmActionDialog } from './ConfirmAction.parts';
import type { ConfirmActionProps } from './ConfirmAction.types';

/**
 * Wraps any trigger in a confirmation popup.
 *
 * The trigger is a render prop rather than a fixed element, so the same guard
 * covers a button, a dropdown item, an icon or a table row action without this
 * component knowing what any of them look like. The guarded handler runs ONLY
 * after the operator confirms:
 *
 * ```tsx
 * <ConfirmAction
 *   title="Excluir a categoria?"
 *   entityName={row.name}
 *   description="Ela vai para a lixeira e pode ser restaurada de lá."
 *   confirmText="Excluir"
 *   onConfirm={() => deleteCategoryAction({ tenantSlug, id: row.id })}
 * >
 *   {(request) => <Button color="danger" onClick={request}>Excluir</Button>}
 * </ConfirmAction>
 * ```
 *
 * For the common case — an existing button whose `onClick` is already the
 * destructive write — reach for {@link withConfirmation} instead, which needs
 * no restructuring of the call site.
 */
export function ConfirmAction({
  onConfirm,
  children,
  ...options
}: ConfirmActionProps): React.ReactElement {
  const state = useConfirmAction(onConfirm, options.errorText);

  return (
    <>
      {children(state.request, { pending: state.pending })}
      <ConfirmActionDialog state={state} {...options} />
    </>
  );
}

ConfirmAction.displayName = 'ConfirmAction';
