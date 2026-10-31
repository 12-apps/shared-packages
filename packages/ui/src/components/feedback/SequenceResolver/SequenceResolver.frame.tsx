import Box from '@mui/material/Box/index.js';
import React from 'react';

import { Dialog } from '../Dialog';
import { SequenceHeader } from './SequenceResolver.header';
import { chromeSx, columnSx, paperSx, scrollBodySx } from './SequenceResolver.styles';
import type { SequenceResolverLabels } from './SequenceResolver.types';
import type { Screen } from './SequenceResolver';

/**
 * Esc closes. `persistent` turns MUI's own Esc off together with the veil's
 * click (the prototype's veil does nothing), so Esc is put back here; a popup
 * inside a step that handles its own Esc stops it before it gets here.
 */
function escapeCloses(close: () => void) {
  return (event: React.KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.stopPropagation();
    close();
  };
}

export interface ResolverFrameProps {
  shown: boolean;
  /** The kept last step is playing its exit: a picture, nothing on it acts. */
  exiting: boolean;
  touch: boolean;
  titleId: string;
  testId: string;
  labels: SequenceResolverLabels;
  screen: Screen;
  close: () => void;
}

function swallowClick(event: React.SyntheticEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

export function ResolverFrame(props: ResolverFrameProps): React.JSX.Element {
  const { shown, exiting, touch, titleId, testId, labels, screen, close } = props;
  return (
    <Dialog
      open={shown}
      onClose={close}
      persistent
      variant={touch ? 'bottom-sheet' : 'default'}
      size="sm"
      aria-labelledby={titleId}
      onKeyDown={escapeCloses(close)}
      slotProps={{ paper: { sx: paperSx(touch) } }}
      dataTestId={testId}
    >
      <Box sx={columnSx} inert={exiting} aria-hidden={exiting || undefined} onClickCapture={exiting ? swallowClick : undefined}>
        <Box sx={chromeSx}>
          <SequenceHeader
            touch={touch}
            {...screen.header}
            closeLabel={labels.close}
            onClose={close}
            progressLabel={labels.progress}
            testId={testId}
          />
        </Box>
        <Box sx={scrollBodySx} data-testid={`${testId}-body`}>
          {screen.body}
        </Box>
      </Box>
    </Dialog>
  );
}
