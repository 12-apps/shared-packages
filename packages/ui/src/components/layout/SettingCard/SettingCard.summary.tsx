import Box from '@mui/material/Box/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import React, { useCallback, useLayoutEffect, useState } from 'react';

import { Icon } from '../../../icons';
import { rem } from '../../../tokens/relative';
import { InteractiveTooltip } from '../../data-display/InteractiveTooltip';

import { SETTING_CARD } from './SettingCard.metrics';
import { partTestId } from './SettingCard.parts';

/**
 * Whether a clamped element is hiding text — measured, never guessed from the
 * string's length, because what fits depends on the width the card is GIVEN.
 * Re-measured whenever the element resizes, so a card that widens drops its [i].
 */
export const useClamped = (): { ref: (node: HTMLElement | null) => void; clamped: boolean } => {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [clamped, setClamped] = useState(false);
  const ref = useCallback((next: HTMLElement | null) => setNode(next), []);

  useLayoutEffect(() => {
    if (!node) return undefined;
    const measure = (): void => setClamped(node.scrollHeight > node.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return { ref, clamped };
};

/**
 * The [i] beside a card's title while its summary is cut: hover shows the whole
 * text, a click or tap pins it — so it works on a phone, where there is no hover.
 */
export const SummaryInfo: React.FC<{ label: string; summary: React.ReactNode; dataTestId?: string }> = ({
  label,
  summary,
  dataTestId,
}) => {
  const theme = useTheme();
  return (
    <InteractiveTooltip
      variant="light"
      size="sm"
      maxWidth={SETTING_CARD.infoMaxWidth}
      hoverContent={summary}
      pinnedContent={summary}
      dataTestId={partTestId(dataTestId, 'info')}
    >
      <Box
        component="button"
        type="button"
        aria-label={label}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          border: 0,
          background: 'none',
          color: theme.palette.text.secondary,
          cursor: 'pointer',
          borderRadius: '50%',
          '&:focus-visible': {
            outline: `${rem(theme, SETTING_CARD.infoFocusRingWidth)} solid ${theme.palette.primary.main}`,
            outlineOffset: rem(theme, SETTING_CARD.infoFocusRingOffset),
          },
        }}
      >
        <Icon name="InfoOutlined" size="xs" />
      </Box>
    </InteractiveTooltip>
  );
};
