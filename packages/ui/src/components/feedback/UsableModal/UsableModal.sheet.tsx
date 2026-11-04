import Box from '@mui/material/Box/index.js';

import { Sheet } from '../../data-display/Sheet/Sheet';
import { MODAL_STACK_BASE_Z_INDEX, MODAL_STACK_Z_INDEX_STEP } from '../../../tokens/layers';
import { safeAreaBottom } from '../../../utils/viewport';
import { useModalStack } from '../StackedModal/modal-stack';
import { hasFooter } from './has-footer';
import type { UsableModalSurfaceProps } from './UsableModal.types';

/**
 * The phone's surface: a bottom `Sheet`, loaded only when this layout is the one
 * drawn (`./UsableModal`). Its height is a ceiling, not a height: a short body
 * gives a short sheet, and a long one scrolls above the pinned footer.
 *
 * It is a named modal dialog (`asDialog`), like the stacked surface. And it
 * opens ABOVE any `StackedModal` already open: a drawer's default level (1200)
 * is under the stack's (1300 and up), and a sheet opened from a panel would
 * otherwise slide in behind it, invisible, holding the focus.
 */
export function UsableModalSheet({
  open,
  onClose,
  title,
  children,
  footer,
  closeLabel,
  dataTestId,
}: UsableModalSurfaceProps): React.JSX.Element {
  const { currentDepth } = useModalStack();
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      position="bottom"
      size="xl"
      title={title}
      closeLabel={closeLabel}
      asDialog
      zIndex={MODAL_STACK_BASE_Z_INDEX + (currentDepth + 1) * MODAL_STACK_Z_INDEX_STEP}
      // The sheet marks its own footer `${dataTestId}-footer`, as the stacked surface does.
      footer={hasFooter(footer) ? <Box sx={safeAreaBottom(0)}>{footer}</Box> : undefined}
      dataTestId={dataTestId}
    >
      {children}
    </Sheet>
  );
}
