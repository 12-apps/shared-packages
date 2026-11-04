import Box from '@mui/material/Box/index.js';
import type { ReactNode } from 'react';

import { StackedModal, StackedModalContent } from '../StackedModal/StackedModal';
import { ModalStackProvider, useInModalStack } from '../StackedModal/modal-stack';
import type { UsableModalSurfaceProps } from './UsableModal.types';

/**
 * The computer's surface: a `StackedModal`, loaded only when this layout is the
 * one drawn (`./UsableModal`).
 *
 * The footer is pinned at the bottom of the panel's scroll, not handed to
 * `StackedModal`'s `actions`: those sit in the header from `sm` up, and a
 * screen's acts belong under what they act on.
 */
export function UsableModalStacked(props: UsableModalSurfaceProps): React.JSX.Element {
  const inStack = useInModalStack();
  const panel = <StackedPanel {...props} />;
  // A host that keeps its own stack gets this panel pushed onto it; one that
  // keeps none gets a stack of one, which is what `StackedModal` needs to draw.
  return inStack ? panel : <ModalStackProvider>{panel}</ModalStackProvider>;
}

function StackedPanel({
  open,
  onClose,
  title,
  children,
  footer,
  closeLabel,
  backLabel,
  size,
  panelWidth,
  dataTestId,
}: UsableModalSurfaceProps): React.JSX.Element {
  return (
    <StackedModal
      open={open}
      onClose={onClose}
      navigationTitle={title}
      closeLabel={closeLabel}
      backLabel={backLabel}
      size={size}
      panelWidth={panelWidth}
      dataTestId={dataTestId}
    >
      <StackedModalContent sx={{ p: 0, display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
        <Box sx={{ flex: 1, p: 3 }}>{children}</Box>
        {footer !== undefined && <PinnedFooter dataTestId={dataTestId}>{footer}</PinnedFooter>}
      </StackedModalContent>
    </StackedModal>
  );
}

/** The action bar, held at the panel's bottom edge while the body scrolls under it. */
function PinnedFooter({ dataTestId, children }: { dataTestId?: string; children: ReactNode }): React.JSX.Element {
  return (
    <Box
      sx={{
        position: 'sticky',
        bottom: 0,
        px: 3,
        py: 2,
        bgcolor: 'background.paper',
        borderTop: (theme) => `1px solid ${theme.palette.divider}`,
      }}
      data-testid={dataTestId ? `${dataTestId}-footer` : undefined}
    >
      {children}
    </Box>
  );
}
