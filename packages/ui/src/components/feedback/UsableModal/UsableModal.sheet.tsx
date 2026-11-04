import Box from '@mui/material/Box/index.js';
import { useTheme, type Theme } from '@mui/material/styles/index.js';

import { Sheet } from '../../data-display/Sheet/Sheet';
import { MODAL_STACK_BASE_Z_INDEX, MODAL_STACK_Z_INDEX_STEP } from '../../../tokens/layers';
import { rem } from '../../../tokens/relative';
import { safeAreaBottom } from '../../../utils/viewport';
import { useModalStack } from '../StackedModal/modal-stack';
import { hasFooter } from './has-footer';
import type { UsableModalSurfaceProps } from './UsableModal.types';

/**
 * How tall the sheet may grow: the whole screen but a strip of the dimmed page
 * above it, so it still reads as a sheet over the screen it came from. The
 * Sheet's own `xl` ceiling is 600px — a phone of 844 lost a quarter of the
 * screen to it, and a modal's body (a form, a cardápio) is what needs it.
 */
const sheetCeiling = (theme: Theme) => ({ maxHeight: `calc(100% - ${rem(theme, 48)})` });

/**
 * The phone's surface: a bottom `Sheet`, loaded only when this layout is the one
 * drawn (`./UsableModal`). Its height is a ceiling, not a height: a short body
 * gives a short sheet, and a long one grows to `sheetCeiling` and scrolls above
 * the pinned footer.
 *
 * It is a named modal dialog (`asDialog`), like the stacked surface. And it
 * takes the level a panel pushed onto the stack would take (`BASE + depth *
 * STEP`): above any `StackedModal` already open — a drawer's default (1200) is
 * under the stack's 1300 and up, and a sheet opened from a panel would slide in
 * behind it, invisible, holding the focus — and never above the menus its own
 * body opens. With no stack that is 1300, MUI's `zIndex.modal`, the level a
 * Select's or a Popover's menu opens at; portalled later, the menu is on top.
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
  const theme = useTheme();
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      position="bottom"
      size="xl"
      style={sheetCeiling(theme)}
      title={title}
      closeLabel={closeLabel}
      asDialog
      zIndex={MODAL_STACK_BASE_Z_INDEX + currentDepth * MODAL_STACK_Z_INDEX_STEP}
      // The sheet marks its own footer `${dataTestId}-footer`, as the stacked surface does.
      footer={hasFooter(footer) ? <Box sx={safeAreaBottom(0)}>{footer}</Box> : undefined}
      dataTestId={dataTestId}
    >
      {children}
    </Sheet>
  );
}
