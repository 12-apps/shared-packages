import { Sheet } from '../../data-display/Sheet/Sheet';
import type { UsableModalSurfaceProps } from './UsableModal.types';

/**
 * The phone's surface: a bottom `Sheet`, loaded only when this layout is the one
 * drawn (`./UsableModal`). Its height is a ceiling, not a height: a short body
 * gives a short sheet, and a long one scrolls under the pinned footer.
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
      // The sheet marks its own footer `${dataTestId}-footer`, as the stacked surface does.
      footer={footer}
      rounded
      dataTestId={dataTestId}
    >
      {children}
    </Sheet>
  );
}
