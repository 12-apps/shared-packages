'use client';

import KeyboardArrowDown from '@mui/icons-material/KeyboardArrowDown';
import Box from '@mui/material/Box/index.js';
import Skeleton from '@mui/material/Skeleton/index.js';
import Typography from '@mui/material/Typography/index.js';
import { useTheme } from '@mui/material/styles/index.js';
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

/** The name and, when the block opens onto something, the chevron beside it. */
const IdentityTitle: React.FC<
  Pick<AppHeaderIdentityProps, 'title' | 'size'> & {
    interactive: boolean;
    disclosed: boolean;
    dataTestId: string;
  }
> = ({ title, size = 'md', interactive, disclosed, dataTestId }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, minWidth: 0, width: '100%' }}>
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
);

/**
 * The disclosure, wrapping the NAME ROW and nothing else (12-63).
 *
 * The padding is cancelled by an equal negative margin, so the hover and the
 * focus ring bleed outward while the title still starts on the same pixel as
 * the lines under it. A padded button with no offset moves one of the two.
 */
const discloseSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 0.25,
  width: '100%',
  minWidth: 0,
  appearance: 'none',
  px: 0.5,
  mx: -0.5,
  py: 0.25,
  my: -0.25,
  border: 'none',
  borderRadius: 1.5,
  background: 'none',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  // Guarded: on a touch screen an unguarded `:hover` sticks after the tap that
  // opened the panel, so the row stays highlighted behind it.
  '@media (hover: hover)': { '&:hover': { backgroundColor: 'action.hover' } },
  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
} as const;

/**
 * The text column: the name row, then the quieter lines under it.
 *
 * ## `subtitle` and `status` are OUTSIDE the disclosure, on purpose (12-63)
 *
 * Both are `ReactNode`, and `AppHeaderStatus.items` is a `ReactNode[]` — so a
 * segment of the state line is free to be a control, and consumers put controls
 * there: a mesa chip, a service-mode picker. While the whole block was one
 * `<button>` those were `<button>`s inside a `<button>`, which is invalid HTML
 * (the content model of `button` excludes interactive content) and, more
 * visibly, means one tap fires two handlers. An adopting storefront opened two
 * popups on every tap of either control because of it, and had already
 * hand-rolled this component at one tier to dodge the nesting — a consumer
 * working around the component is the report.
 *
 * The target stays large. The button is the full-width NAME ROW, which is the
 * thing a reader aims at — what it gives up is the mark beside it, and a mark
 * that opens the panel is not worth a state line that cannot hold a control.
 */
const IdentityText: React.FC<
  Pick<
    AppHeaderIdentityProps,
    'title' | 'subtitle' | 'status' | 'size' | 'discloseLabel' | 'className'
  > & {
    onDisclose: (() => void) | undefined;
    disclosed: boolean;
    dataTestId: string;
  }
> = ({
  title,
  subtitle,
  status,
  size = 'md',
  onDisclose,
  disclosed,
  discloseLabel,
  className,
  dataTestId,
}) => {
  const name = (
    <IdentityTitle
      title={title}
      size={size}
      interactive={Boolean(onDisclose)}
      disclosed={disclosed}
      dataTestId={dataTestId}
    />
  );
  return (
    <Box sx={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      {onDisclose ? (
        <Box
          component="button"
          type="button"
          className={className}
          data-testid={dataTestId}
          onClick={onDisclose}
          aria-haspopup="dialog"
          aria-expanded={disclosed}
          aria-label={discloseLabel ?? `Detalhes de ${title}`}
          sx={discloseSx}
        >
          {name}
        </Box>
      ) : (
        name
      )}
      {subtitle && (
        <Typography variant="body2" color="text.secondary" component="span" sx={ONE_LINE}>
          {subtitle}
        </Typography>
      )}
      {status}
    </Box>
  );
};

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
 * The BLOCK's row: the mark, then the text column beside it.
 *
 * Always a `Box` div now — since 12-63 the disclosure is the name row inside
 * the text column ({@link discloseSx}), not this element. `width: '100%'` and
 * `minWidth: 0` stay because the column below still has to ellipsise against
 * something; the argument about a `<button>` sizing to max-content moved to
 * `discloseSx`, which is where the button now is.
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
 * Mark + title + state line, and — when it can be opened — a name row that is
 * the button.
 *
 * The disclosure used to wrap EVERYTHING, on the argument that the chevron
 * alone is a 20px target next to a 40px mark that does nothing. The target is
 * still not the chevron: the button is the full-width NAME ROW, which is what a
 * reader aims at. What it no longer swallows is the mark beside it and the
 * quieter lines below — because those lines take `ReactNode`s, consumers put
 * CONTROLS in them, and a control inside a button is invalid HTML whose every
 * tap fires two handlers. See {@link IdentityText} (12-63).
 *
 * `className` and `dataTestId` stay on the same elements they always named: the
 * block when it is static, the disclosure when there is one.
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

  return (
    <Box
      className={onDisclose ? undefined : className}
      data-testid={onDisclose ? undefined : dataTestId}
      sx={rowSx}
    >
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
        onDisclose={onDisclose}
        disclosed={disclosed}
        discloseLabel={discloseLabel}
        className={className}
        dataTestId={dataTestId}
      />
    </Box>
  );
};

AppHeaderIdentity.displayName = 'AppHeaderIdentity';
