/**
 * The round button: what to do next, how long it has waited, and how hard it
 * asks for the eye.
 *
 *        ╭───────╮
 *       ╱  (🛎)   ╲     a ring = the share of the budget spent
 *      │   7 min   │    (the second lap once late; full once spent)
 *       ╲         ╱
 *        ╰───────╯
 *
 * ## Colour is never the only channel
 *
 * Calm is `success`, late `warning`, spent `warning.dark` — and each state has
 * a SHAPE of its own as well: calm is still or barely pulsing, late pulses,
 * spent pulses twice as fast, shakes, and wears a second outline, so a reader
 * who cannot tell green from amber still tells the three apart. Under
 * `prefers-reduced-motion` nothing moves; the outline and the minutes stay.
 */
import type { JSX, MouseEvent, ReactNode } from 'react';

import { Box } from '@12-apps/ui/mui/Box';
import { keyframes, type Theme } from '@12-apps/ui/mui/styles';

import { pulseOf, type AttentionEntry, type AttentionPulse, type AttentionSeverity } from '../core';

/** The fill a severity wears. */
export function severityFill(theme: Theme, severity: AttentionSeverity): string {
  if (severity === 'calm') return theme.palette.success.main;
  if (severity === 'late') return theme.palette.warning.main;
  return theme.palette.warning.dark;
}

/** The ink on that fill. */
export function severityInk(theme: Theme, severity: AttentionSeverity): string {
  return severity === 'calm' ? theme.palette.success.contrastText : theme.palette.warning.contrastText;
}

const ringOut = keyframes`
  from { transform: scale(1); opacity: 0.55; }
  to { transform: scale(1.9); opacity: 0; }
`;
const ringSoft = keyframes`
  from { transform: scale(1); opacity: 0.3; }
  to { transform: scale(1.4); opacity: 0; }
`;
const shake = keyframes`
  0%, 78%, 100% { transform: rotate(0deg); }
  82% { transform: rotate(-12deg); }
  86% { transform: rotate(12deg); }
  90% { transform: rotate(-8deg); }
  94% { transform: rotate(8deg); }
`;

/** One halo: which animation, how long, and how late it starts. */
function halos(pulse: AttentionPulse): readonly { readonly animation: string }[] {
  switch (pulse) {
    case 'still':
      return [];
    case 'soft':
      return [{ animation: `${ringSoft} 3s ease-out infinite` }];
    case 'strong':
      return [
        { animation: `${ringOut} 1.8s ease-out infinite` },
        { animation: `${ringOut} 1.8s ease-out 0.9s infinite` },
      ];
    case 'spent':
      return [
        { animation: `${ringOut} 1s ease-out infinite` },
        { animation: `${ringOut} 1s ease-out 0.5s infinite` },
      ];
  }
}

const SIZE = 64;
const RADIUS = 27;

const BUTTON_SX = {
  position: 'relative',
  width: SIZE,
  height: SIZE,
  p: 0,
  border: 0,
  borderRadius: '50%',
  bgcolor: 'transparent',
  cursor: 'pointer',
  flexShrink: 0,
  touchAction: 'none',
  '&:focus-visible': {
    outline: 2,
    outlineStyle: 'solid',
    outlineColor: 'primary.main',
    outlineOffset: 4,
  },
} as const;

const HALO_SX = {
  position: 'absolute',
  inset: 0,
  borderRadius: '50%',
  pointerEvents: 'none',
  '@media (prefers-reduced-motion: reduce)': { animation: 'none', opacity: 0 },
} as const;

export interface AttentionButtonProps {
  readonly entry: Pick<AttentionEntry, 'severity' | 'progress'>;
  /** The glyph of the item's kind, drawn in the button's ink. */
  readonly icon: ReactNode;
  /** The wait, short: "7 min". */
  readonly waited: string;
  /** The whole thing read aloud. */
  readonly label: string;
  readonly onOpen: () => void;
  readonly dataTestId?: string;
}

/** The ring: a faint full track, and the share of the lap spent drawn over it. */
function Ring({ progress }: { readonly progress: number }): JSX.Element {
  const arc = Math.max(0.03, Math.min(1, progress)) * 100;
  const centre = SIZE / 2;
  return (
    <Box
      component="svg"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    >
      <circle
        cx={centre}
        cy={centre}
        r={RADIUS}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.32}
        strokeWidth={4}
      />
      <circle
        cx={centre}
        cy={centre}
        r={RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={4}
        pathLength={100}
        strokeDasharray={`${arc} 100`}
        strokeLinecap="round"
        transform={`rotate(-90 ${centre} ${centre})`}
      />
    </Box>
  );
}

const CENTRE_SX = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '1px',
  lineHeight: 1,
} as const;

/** The disc itself: the fill, the ring, the glyph and the minutes — and, once spent, the shake and the outline. */
function Face({
  severity,
  progress,
  spent,
  icon,
  waited,
}: {
  readonly severity: AttentionSeverity;
  readonly progress: number;
  readonly spent: boolean;
  readonly icon: ReactNode;
  readonly waited: string;
}): JSX.Element {
  return (
    <Box
      component="span"
      aria-hidden
      data-outline={spent ? 'double' : 'none'}
      sx={{
        position: 'absolute',
        inset: 0,
        borderRadius: '50%',
        bgcolor: (theme: Theme) => severityFill(theme, severity),
        color: (theme: Theme) => severityInk(theme, severity),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: (theme: Theme) =>
          spent
            ? `0 0 0 3px ${theme.palette.background.paper}, 0 0 0 7px ${severityFill(theme, severity)}, ${theme.shadows[6]}`
            : theme.shadows[4],
        animation: spent ? `${shake} 2.2s ease-in-out infinite` : 'none',
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      }}
    >
      <Ring progress={progress} />
      <Box component="span" sx={CENTRE_SX}>
        <Box component="span" sx={{ display: 'flex', '& svg': { width: 22, height: 22 } }}>
          {icon}
        </Box>
        <Box component="strong" sx={{ fontSize: 11, whiteSpace: 'nowrap' }}>
          {waited}
        </Box>
      </Box>
    </Box>
  );
}

export function AttentionButton({
  entry,
  icon,
  waited,
  label,
  onOpen,
  dataTestId = 'attention-button',
}: AttentionButtonProps): JSX.Element {
  const pulse = pulseOf(entry);
  return (
    <Box
      component="button"
      type="button"
      aria-haspopup="dialog"
      aria-label={label}
      onClick={onOpen}
      data-testid={dataTestId}
      data-severity={entry.severity}
      data-pulse={pulse}
      sx={BUTTON_SX}
    >
      {halos(pulse).map((halo, index) => (
        <Box
          key={index}
          component="span"
          aria-hidden
          sx={{
            ...HALO_SX,
            bgcolor: (theme: Theme) => severityFill(theme, entry.severity),
            animation: halo.animation,
          }}
        />
      ))}
      <Face
        severity={entry.severity}
        progress={entry.progress}
        spent={pulse === 'spent'}
        icon={icon}
        waited={waited}
      />
    </Box>
  );
}

export interface AttentionOthersButtonProps {
  readonly count: number;
  /** The most severe of the rest — the ink of the number. */
  readonly severity: AttentionSeverity;
  readonly label: string;
  readonly expanded: boolean;
  readonly onClick: (anchor: HTMLElement) => void;
  readonly dataTestId?: string;
}

/**
 * "+N": how many more are waiting. Quiet on purpose — white, with the number
 * in the colour of the worst of them — so it never competes with the button.
 */
export function AttentionOthersButton({
  count,
  severity,
  label,
  expanded,
  onClick,
  dataTestId = 'attention-others',
}: AttentionOthersButtonProps): JSX.Element {
  return (
    <Box
      component="button"
      type="button"
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-label={label}
      data-testid={dataTestId}
      data-severity={severity}
      onClick={(event: MouseEvent<HTMLElement>) => onClick(event.currentTarget)}
      sx={{
        position: 'relative',
        zIndex: 1,
        minWidth: 44,
        height: 44,
        px: 1.25,
        boxSizing: 'border-box',
        borderRadius: 22,
        bgcolor: 'background.paper',
        color: (theme: Theme) =>
          severity === 'calm' ? theme.palette.success.main : severityFill(theme, severity),
        border: '1.5px solid currentColor',
        boxShadow: 2,
        font: 'inherit',
        fontSize: 14,
        fontWeight: 700,
        cursor: 'pointer',
        '&:focus-visible': {
          outline: 2,
          outlineStyle: 'solid',
          outlineColor: 'primary.main',
          outlineOffset: 2,
        },
      }}
    >
      +{count}
    </Box>
  );
}
