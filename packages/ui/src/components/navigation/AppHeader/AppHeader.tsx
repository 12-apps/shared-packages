'use client';

import Box from '@mui/material/Box';
import React from 'react';

import { withDefaults } from '../../../utils/withDefaults';

import type { AppHeaderProps } from './AppHeader.types';

/** Bar height, before the optional `below` row. */
const BAR_MIN_HEIGHT = { regular: 64, dense: 52 } as const;

/** The props {@link HEADER_DEFAULTS} guarantees a value for. */
type Defaulted =
  | 'position'
  | 'offsetTop'
  | 'maxWidth'
  | 'divider'
  | 'elevateOnScroll'
  | 'dense'
  | 'disableSpacer'
  | 'dataTestId';

/** `AppHeaderProps` as the body sees them: nothing defaulted is still optional. */
type ResolvedHeaderProps = AppHeaderProps & Required<Pick<AppHeaderProps, Defaulted>>;

const HEADER_DEFAULTS: Pick<ResolvedHeaderProps, Defaulted> = {
  position: 'sticky',
  offsetTop: 0,
  maxWidth: 1200,
  divider: true,
  elevateOnScroll: false,
  dense: false,
  disableSpacer: false,
  dataTestId: 'app-header',
};

/**
 * Watch the document scroll so a lifted bar can cast a shadow only once there
 * is something under it. Inert (and never attaches a listener) when off.
 */
function useScrolled(enabled: boolean): boolean {
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => {
    if (!enabled) return undefined;
    const onScroll = (): void => setScrolled(window.scrollY > 0);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [enabled]);
  return enabled && scrolled;
}

/**
 * The bar's own height, republished whenever it changes.
 *
 * A `fixed` bar is out of flow, so something has to reserve its space — and a
 * constant cannot, because this bar's height is whatever the caller's slots add
 * up to. A search field in `below`, a status line, a wrapped title: each moves
 * it, and a hard-coded spacer would leave the page's first element under the
 * bar or floating below a gap.
 */
function useMeasuredHeight(enabled: boolean): [React.RefObject<HTMLElement | null>, number] {
  const ref = React.useRef<HTMLElement | null>(null);
  const [height, setHeight] = React.useState(0);
  React.useEffect(() => {
    const node = ref.current;
    if (!enabled || !node) return undefined;
    const measure = (): void => setHeight(node.getBoundingClientRect().height);
    measure();
    // Measured once unconditionally, observed only where the API exists. jsdom
    // has no ResizeObserver, so constructing it unguarded takes down every
    // consumer's test that happens to render a fixed bar — a crash in THEIR
    // suite, thrown from a component they only laid out.
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled]);
  return [ref, height];
}

/**
 * The bar's own surface. Lifted out of the component both to keep it inside the
 * complexity bar and because the positioning rules are the fiddly part: a
 * `static` bar must claim neither a stacking context nor an offset, and only a
 * `fixed` one needs pinning to the viewport's edges.
 */
function surfaceSx({
  position,
  offsetTop,
  divider,
  scrolled,
}: Required<Pick<AppHeaderProps, 'position' | 'offsetTop' | 'divider'>> & {
  scrolled: boolean;
}): Record<string, unknown> {
  return {
    position,
    ...(position === 'static' ? {} : { top: offsetTop, zIndex: 'appBar' }),
    ...(position === 'fixed' ? { left: 0, right: 0 } : {}),
    backgroundColor: 'background.paper',
    borderBottom: divider ? 1 : 0,
    borderColor: 'divider',
    boxShadow: scrolled ? 2 : 0,
    transition: 'box-shadow 150ms ease',
  };
}

/** The trailing column: the muted note, and the actions under it. */
const HeaderTrailing: React.FC<Pick<AppHeaderProps, 'meta' | 'actions'>> = ({ meta, actions }) => {
  if (!meta && !actions) return null;
  return (
    <Box
      sx={{
        flex: '0 0 auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 0.5,
      }}
    >
      {meta && (
        <Box
          data-testid="app-header-meta"
          sx={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'text.disabled',
            lineHeight: 1,
          }}
        >
          {meta}
        </Box>
      )}
      {actions && (
        <Box
          component="nav"
          data-testid="app-header-actions"
          sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
        >
          {actions}
        </Box>
      )}
    </Box>
  );
};

/**
 * The application bar: a row of slots on one surface, plus an optional second
 * row that belongs to it.
 *
 * It knows nothing about routers, sessions, carts or stores — every slot is a
 * `ReactNode` and every behaviour is a callback, which is what lets one bar
 * serve a storefront, a back office and a platform console without any of them
 * leaking into the others. Compose it with {@link AppHeaderIdentity},
 * {@link AppHeaderStatus} and {@link AppHeaderDetails}, or put your own nodes in
 * the slots.
 *
 * The SURFACE always spans the viewport while the CONTENT stops at `maxWidth`
 * and centres, so the same bar reads as a phone header and as a desktop one
 * without a second component or a breakpoint at the call site.
 */
export const AppHeader: React.FC<AppHeaderProps> = (props) => {
  // A table of defaults rather than one per destructured prop: each `= default`
  // is a branch, and nine of them put this component over the complexity bar
  // before it rendered anything.
  const {
    leading,
    children,
    actions,
    meta,
    below,
    position,
    offsetTop,
    maxWidth,
    divider,
    elevateOnScroll,
    dense,
    disableSpacer,
    className,
    dataTestId,
    // True by construction — `withDefaults` fills exactly these keys — but not
    // something TS can follow through a `Partial<T>` table.
  } = withDefaults(props, HEADER_DEFAULTS) as ResolvedHeaderProps;

  const scrolled = useScrolled(elevateOnScroll);
  const needsSpacer = position === 'fixed' && !disableSpacer;
  const [ref, height] = useMeasuredHeight(needsSpacer);

  return (
    <>
      <Box
        ref={ref}
        component="header"
        className={className}
        data-testid={dataTestId}
        sx={surfaceSx({ position, offsetTop, divider, scrolled })}
      >
        <Box sx={{ maxWidth, mx: 'auto', px: { xs: 2, md: 3 } }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: { xs: 1, md: 2 },
              minHeight: dense ? BAR_MIN_HEIGHT.dense : BAR_MIN_HEIGHT.regular,
              py: 1,
            }}
          >
            {leading}
            {/* The identity takes the slack and is the only part allowed to
                shrink — the actions are targets and the meta note is already
                the smallest thing in the bar. */}
            <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>{children}</Box>
            <HeaderTrailing meta={meta} actions={actions} />
          </Box>
          {below && (
            <Box data-testid={`${dataTestId}-below`} sx={{ pb: 1.5 }}>
              {below}
            </Box>
          )}
        </Box>
      </Box>
      {needsSpacer && <Box aria-hidden data-testid={`${dataTestId}-spacer`} sx={{ height }} />}
    </>
  );
};

AppHeader.displayName = 'AppHeader';

export default AppHeader;
