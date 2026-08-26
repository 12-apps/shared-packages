'use client';

import KeyboardArrowDown from '@mui/icons-material/KeyboardArrowDown';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import React from 'react';

import { accentFor, type SizeValue } from '../../../tokens/scales';

import { AppHeaderBrand } from './AppHeader.brand';
import type { AppHeaderIdentityProps, AppHeaderStatusProps } from './AppHeader.types';

/** Title type scale, per house size step. */
const TITLE_PX: Record<SizeValue, number> = { xs: 14, sm: 15, md: 17, lg: 20, xl: 24 };

/** One line, ellipsised — a long store name must not push the actions off-screen. */
const ONE_LINE = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

/**
 * The dotted state line: "● Aberto agora · Retirada no balcão".
 *
 * Segments are joined here rather than by the caller because the separator is a
 * presentational choice — a caller that pre-joins its own string can never be
 * restyled, and each segment loses the chance to carry its own markup.
 */
export const AppHeaderStatus: React.FC<AppHeaderStatusProps> = ({
  tone,
  items,
  separator = '·',
  className,
  dataTestId = 'app-header-status',
}) => {
  const theme = useTheme();
  const visible = items.filter((item) => item !== null && item !== undefined && item !== '');
  if (visible.length === 0) return null;

  return (
    <Box
      className={className}
      data-testid={dataTestId}
      sx={{ display: 'flex', alignItems: 'center', gap: 0.75, ...ONE_LINE }}
    >
      {tone && (
        <Box
          aria-hidden
          data-testid={`${dataTestId}-dot`}
          sx={{
            width: 8,
            height: 8,
            flex: '0 0 auto',
            borderRadius: '50%',
            backgroundColor: accentFor(theme, tone).main,
          }}
        />
      )}
      <Typography variant="body2" color="text.secondary" component="span" sx={ONE_LINE}>
        {visible.map((item, index) => (
          // Index keys: the segments are positional presentation, and nothing
          // here reorders or is keyed on identity elsewhere.
          <React.Fragment key={index}>
            {index > 0 && (
              <>
                {/* Real spaces, not margin. A screen reader reads `textContent`,
                    and a CSS-only gap runs "Aberto agora" straight into
                    "Retirada no balcão" as one word. The glyph itself is
                    hidden — it is punctuation, not something to announce. */}
                {' '}
                <Box component="span" aria-hidden>
                  {separator}
                </Box>{' '}
              </>
            )}
            {item}
          </React.Fragment>
        ))}
      </Typography>
    </Box>
  );
};

AppHeaderStatus.displayName = 'AppHeaderStatus';

/** Title + chevron + the quieter lines under them. */
const IdentityText: React.FC<
  Pick<AppHeaderIdentityProps, 'title' | 'subtitle' | 'status' | 'size'> & {
    interactive: boolean;
    disclosed: boolean;
    dataTestId: string;
  }
> = ({ title, subtitle, status, size = 'md', interactive, disclosed, dataTestId }) => (
  <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, minWidth: 0 }}>
      <Typography
        component="span"
        data-testid={`${dataTestId}-title`}
        sx={{ fontSize: TITLE_PX[size], fontWeight: 700, lineHeight: 1.2, ...ONE_LINE }}
      >
        {title}
      </Typography>
      {interactive && (
        <KeyboardArrowDown
          aria-hidden
          data-testid={`${dataTestId}-chevron`}
          sx={{
            flex: '0 0 auto',
            fontSize: 20,
            opacity: 0.7,
            transition: 'transform 150ms ease',
            transform: disclosed ? 'rotate(180deg)' : 'none',
          }}
        />
      )}
    </Box>
    {subtitle && (
      <Typography variant="body2" color="text.secondary" component="span" sx={ONE_LINE}>
        {subtitle}
      </Typography>
    )}
    {status}
  </Box>
);

/** The placeholder held while the identity is still resolving. */
const IdentitySkeleton: React.FC<{ size: SizeValue; dataTestId: string }> = ({
  size,
  dataTestId,
}) => (
  <Box
    data-testid={`${dataTestId}-loading`}
    sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}
  >
    <Skeleton variant="rounded" width={40} height={40} sx={{ flex: '0 0 auto' }} />
    <Box sx={{ minWidth: 0, flex: 1 }}>
      <Skeleton variant="text" width={140} height={TITLE_PX[size] * 1.4} />
      <Skeleton variant="text" width={180} height={16} />
    </Box>
  </Box>
);

/**
 * Row styling shared by the static and the button rendering.
 *
 * `width: '100%'` is load-bearing, not cosmetic. A `<button>` sizes to
 * max-content and — unlike the `div` the non-interactive path renders — does
 * not stretch to fill its block container, so without it the DISCLOSING
 * identity measured its widest possible line at every viewport: the row's
 * right edge stayed pinned at 564px while the bar narrowed, `ONE_LINE` never
 * had a constraint to ellipsise against, and the title and state line ran
 * straight under the actions — 327px of overlap at 320px wide. Filling the
 * wrapper is what lets `minWidth: 0` bite and the ellipsis engage.
 */
const rowSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1.25,
  width: '100%',
  minWidth: 0,
  textAlign: 'left',
} as const;

/**
 * Mark + title + state line, and — when it can be opened — the whole block as
 * one button.
 *
 * The button wraps EVERYTHING rather than sitting next to the title, because on
 * a phone the chevron alone is a 20px target next to a 40px one that does
 * nothing. A shopper aiming at the store's name expects the store's details.
 */
export const AppHeaderIdentity: React.FC<AppHeaderIdentityProps> = ({
  title,
  subtitle,
  status,
  mark,
  logoUrl,
  seedColor,
  onDisclose,
  disclosed = false,
  discloseLabel,
  loading = false,
  size = 'md',
  className,
  dataTestId = 'app-header-identity',
}) => {
  if (loading) return <IdentitySkeleton size={size} dataTestId={dataTestId} />;

  const body = (
    <>
      {mark ?? (
        <AppHeaderBrand
          name={title}
          logoUrl={logoUrl}
          seedColor={seedColor}
          size={size}
          dataTestId={`${dataTestId}-brand`}
        />
      )}
      <IdentityText
        title={title}
        subtitle={subtitle}
        status={status}
        size={size}
        interactive={Boolean(onDisclose)}
        disclosed={disclosed}
        dataTestId={dataTestId}
      />
    </>
  );

  if (!onDisclose) {
    return (
      <Box className={className} data-testid={dataTestId} sx={rowSx}>
        {body}
      </Box>
    );
  }

  return (
    <Box
      component="button"
      type="button"
      className={className}
      data-testid={dataTestId}
      onClick={onDisclose}
      aria-haspopup="dialog"
      aria-expanded={disclosed}
      aria-label={discloseLabel ?? `Detalhes de ${title}`}
      sx={{
        ...rowSx,
        appearance: 'none',
        p: 0.5,
        ml: -0.5,
        border: 'none',
        borderRadius: 1.5,
        background: 'none',
        color: 'inherit',
        font: 'inherit',
        cursor: 'pointer',
        '&:hover': { backgroundColor: 'action.hover' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
      }}
    >
      {body}
    </Box>
  );
};

AppHeaderIdentity.displayName = 'AppHeaderIdentity';
