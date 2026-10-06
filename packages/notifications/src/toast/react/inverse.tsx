/**
 * The toast's one look: the INVERSE surface — a near-black card on a light
 * screen, a near-white one on a dark screen. It is the tooltip's ground
 * (`neutralTones(theme).inverseSurface`), so a toast reads as "about the page"
 * rather than "part of it", whatever the page under it is painted in.
 *
 * The subtree is re-themed, not re-coloured: `InverseTheme` hands everything
 * inside the card a palette whose text, background and divider are the
 * inverse ones, so a library `Text`, `Button` or `Icon` placed in a toast by a
 * host reads correctly without the host knowing it sits on black.
 */
import { useMemo, type JSX, type ReactNode } from 'react';

import { ThemeProvider, alpha, useTheme, type Theme } from '@12-apps/ui/mui/styles';
import { contrastText, neutralTones } from '@12-apps/ui/tokens';

/** The card's ground and its ink, for the screen's mode. */
export function inverseColors(theme: Theme): { ground: string; ink: string } {
  const tones = neutralTones(theme);
  const ground = theme.palette.mode === 'dark' ? tones.surface : tones.inverseSurface;
  return { ground, ink: contrastText(ground) };
}

/** The outer theme with its palette turned over for the inverse ground. */
export function inverseTheme(outer: Theme): Theme {
  const { ground, ink } = inverseColors(outer);
  return {
    ...outer,
    palette: {
      ...outer.palette,
      mode: outer.palette.mode === 'dark' ? 'light' : 'dark',
      text: {
        ...outer.palette.text,
        primary: ink,
        secondary: alpha(ink, 0.72),
        disabled: alpha(ink, 0.5),
      },
      background: { ...outer.palette.background, default: ground, paper: ground },
      divider: alpha(ink, 0.24),
      action: {
        ...outer.palette.action,
        active: ink,
        hover: alpha(ink, 0.08),
        selected: alpha(ink, 0.16),
        focus: alpha(ink, 0.24),
        disabled: alpha(ink, 0.4),
        disabledBackground: alpha(ink, 0.12),
      },
    },
  };
}

/** Everything inside reads the inverse palette. */
export function InverseTheme({ children }: { children: ReactNode }): JSX.Element {
  const outer = useTheme();
  const theme = useMemo(() => inverseTheme(outer), [outer]);
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}

/**
 * The card's frame, shared by the packaged toast and a host's own body
 * (`ToastSurface`). Buttons inside take the card's ink: a brand-coloured text
 * button on near-black is the low-contrast case this look exists to avoid.
 */
export function toastSurfaceSx(theme: Theme): Record<string, unknown> {
  const { ground, ink } = inverseColors(theme);
  return {
    bgcolor: ground,
    color: ink,
    borderRadius: '12px',
    boxShadow: `0 10px 28px ${alpha(theme.palette.common.black, 0.28)}`,
    pointerEvents: 'auto',
    '& .MuiButton-root:not(.Mui-disabled)': { color: ink, borderColor: alpha(ink, 0.48) },
    '& .MuiButton-root.Mui-disabled': { color: alpha(ink, 0.4), borderColor: alpha(ink, 0.2) },
  };
}
