/**
 * One toast as drawn: an icon for its severity, a bold lead, the sentence, its
 * buttons and a close — on the inverse surface, at the top of the screen.
 *
 * Wraps rather than squeezes: the sentence takes the row and the buttons drop
 * under it when the card is too narrow for both, so a long server message never
 * pushes a button out of reach and no word is stood up one per line.
 */
import { type JSX, type ReactNode } from 'react';

import { Button } from '@12-apps/ui/form/Button';
import { Icon, type IconName } from '@12-apps/ui/icons';
import { Box } from '@12-apps/ui/mui/Box';
import { keyframes, useTheme, type Theme } from '@12-apps/ui/mui/styles';
import { Text } from '@12-apps/ui/typography/Text';

import type { ToastAction, ToastSeverity } from '../core';

import { InverseTheme, toastSurfaceSx } from './inverse';

const ICONS: Partial<Record<ToastSeverity, IconName>> = {
  success: 'CheckCircle',
  info: 'Info',
  warning: 'WarningAmber',
  error: 'ErrorOutline',
};

const PALETTE_KEY = { success: 'success', info: 'info', warning: 'warning', error: 'error' } as const;

/**
 * A signal's colour that reads on the card: the light step on a dark card, the
 * dark one on a light card. `theme` is the card's own (inverse) theme, so its
 * mode IS the card's ground.
 */
export function signalOnInverse(theme: Theme, severity: keyof typeof PALETTE_KEY): string {
  const colour = theme.palette[PALETTE_KEY[severity]];
  return theme.palette.mode === 'dark' ? colour.light : colour.dark;
}

const spin = keyframes({ to: { transform: 'rotate(360deg)' } });

function SeverityMark({ severity }: { severity: ToastSeverity }): JSX.Element | null {
  const theme = useTheme();
  if (severity === 'loading') {
    return (
      <Box
        aria-hidden="true"
        data-testid="toast-spinner"
        sx={{
          width: 18,
          height: 18,
          flexShrink: 0,
          borderRadius: '50%',
          border: 2,
          borderColor: 'currentColor',
          borderTopColor: 'transparent',
          animation: `${spin} 0.8s linear infinite`,
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      />
    );
  }
  const name = ICONS[severity];
  if (name === undefined || severity === 'neutral') return null;
  return (
    <Box aria-hidden="true" sx={{ display: 'flex', flexShrink: 0 }}>
      <Icon name={name} size="sm" color={signalOnInverse(theme, severity)} />
    </Box>
  );
}

const enter = keyframes({ from: { opacity: 0, transform: 'translateY(-8px)' }, to: { opacity: 1, transform: 'none' } });

/**
 * The inverse frame alone, for a host that draws its own body inside it (a
 * receipt with its own buttons, a notice with a scroller). Same ground, ink,
 * corner and shadow as the packaged card; the subtree reads the inverse palette.
 */
export function ToastSurface({
  children,
  testId,
  sx,
}: {
  children: ReactNode;
  testId?: string;
  sx?: Record<string, unknown>;
}): JSX.Element {
  const theme = useTheme();
  return (
    <Box
      data-testid={testId}
      // An overlay: it covers the page by design and takes no room in it.
      data-ui-overlay=""
      sx={{
        ...toastSurfaceSx(theme),
        animation: `${enter} 160ms ease-out`,
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        ...sx,
      }}
    >
      <InverseTheme>{children}</InverseTheme>
    </Box>
  );
}

export interface ToastCardProps {
  message: ReactNode;
  severity: ToastSeverity;
  title?: string;
  actions: readonly ToastAction[];
  dismissible: boolean;
  dismissLabel: string;
  testId?: string;
  onAction: (action: ToastAction) => void;
  onClose: () => void;
}

export function ToastCard({
  message,
  severity,
  title,
  actions,
  dismissible,
  dismissLabel,
  testId = 'toast',
  onAction,
  onClose,
}: ToastCardProps): JSX.Element {
  return (
    <ToastSurface testId={testId} sx={{ px: 1.5, py: 1 }}>
      <Box
        data-severity={severity}
        sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 0.5 }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flex: '1 1 12rem', minWidth: 0, py: 0.5 }}>
          <SeverityMark severity={severity} />
          <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            <Text variant="body" size="sm" as="p" data-testid={`${testId}-message`}>
              {title !== undefined && (
                <Text variant="body" size="sm" as="span" weight="bold">{`${title} · `}</Text>
              )}
              {message}
            </Text>
          </Box>
        </Box>
        {(actions.length > 0 || dismissible) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 'auto', flexShrink: 0 }}>
            {actions.map((action) => (
              <Button
                key={action.label}
                variant="ghost"
                color="neutral"
                size="sm"
                disabled={action.disabled}
                onClick={() => onAction(action)}
                dataTestId={action.testId ?? `${testId}-action`}
                sx={{ fontWeight: 'bold', whiteSpace: 'nowrap', minHeight: 40 }}
              >
                {action.label}
              </Button>
            ))}
            {dismissible && (
              <Button
                variant="ghost"
                color="neutral"
                size="sm"
                aria-label={dismissLabel}
                onClick={onClose}
                dataTestId={`${testId}-close`}
                sx={{ minWidth: 40, minHeight: 40, px: 1 }}
              >
                <Icon name="Close" size="sm" color="inherit" />
              </Button>
            )}
          </Box>
        )}
      </Box>
    </ToastSurface>
  );
}
