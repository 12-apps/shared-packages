'use client';

import { Box, useTheme } from '@mui/material';
import type { Theme } from '@mui/material';
import React from 'react';

import type { SizeValue } from '../../../tokens/scales';

import { brandGradient, initialsOf } from './AppHeader.colors';
import type { AppHeaderBrandProps } from './AppHeader.types';

/** The mark's edge, per house size step. */
const MARK_PX: Record<SizeValue, number> = { xs: 24, sm: 32, md: 40, lg: 48, xl: 56 };

/** Initials are set at 40% of the mark so a two-letter pair never touches the edge. */
const INITIALS_RATIO = 0.4;

/** The mark's box, lifted out of the component to keep it inside the complexity bar. */
function markSx(
  theme: Theme,
  { edge, round, showLogo, seed }: { edge: number; round: boolean; showLogo: boolean; seed: string },
): Record<string, unknown> {
  return {
    width: edge,
    height: edge,
    flex: '0 0 auto',
    overflow: 'hidden',
    borderRadius: round ? '50%' : '30%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    // Only the initials need the gradient; a logo covers it entirely, and
    // painting it underneath would show at the corners of a transparent PNG.
    backgroundImage: showLogo ? 'none' : brandGradient(seed),
    backgroundColor: showLogo ? theme.palette.action.hover : 'transparent',
    color: theme.palette.getContrastText(seed),
    fontSize: Math.round(edge * INITIALS_RATIO),
    fontWeight: 700,
    lineHeight: 1,
    letterSpacing: '0.02em',
    userSelect: 'none',
  };
}

/**
 * The mark that opens the header: the logo when there is one, the name's
 * initials on a gradient derived from the brand colour when there is not.
 *
 * Both branches occupy the SAME box, so a header does not resize when a logo
 * arrives — or when one fails to load and the initials take over, which is the
 * case a plain `<img>` renders as a torn-page glyph beside the store's name.
 */
export const AppHeaderBrand: React.FC<AppHeaderBrandProps> = ({
  name,
  logoUrl,
  seedColor,
  size = 'md',
  shape = 'rounded',
  className,
  dataTestId = 'app-header-brand',
}) => {
  const theme = useTheme();
  const [broken, setBroken] = React.useState(false);
  // Keyed on the URL so a store that swaps its logo gets a fresh attempt rather
  // than inheriting the previous one's failure.
  React.useEffect(() => setBroken(false), [logoUrl]);

  const edge = MARK_PX[size];
  const seed = seedColor || theme.palette.primary.main;
  const showLogo = Boolean(logoUrl) && !broken;

  return (
    <Box
      className={className}
      data-testid={dataTestId}
      // `role="img"` + the name: the initials are a picture of the brand, not
      // two letters a screen reader should spell out.
      role="img"
      aria-label={name}
      sx={markSx(theme, { edge, round: shape === 'circle', showLogo, seed })}
    >
      {showLogo ? (
        <Box
          component="img"
          src={logoUrl ?? undefined}
          alt=""
          onError={() => setBroken(true)}
          data-testid={`${dataTestId}-logo`}
          sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <Box component="span" aria-hidden data-testid={`${dataTestId}-initials`}>
          {initialsOf(name)}
        </Box>
      )}
    </Box>
  );
};

AppHeaderBrand.displayName = 'AppHeaderBrand';

export default AppHeaderBrand;
