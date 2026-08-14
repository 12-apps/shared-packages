import { useEffect, useState, type JSX, type ReactNode } from 'react';

import MenuIcon from '@mui/icons-material/Menu';

import { Drawer } from '@12-apps/ui/layout/Drawer';
import { Sidebar, SidebarContent, SidebarHeader } from '@12-apps/ui/layout/Sidebar';
import { Box } from '@12-apps/ui/mui/Box';
import { alpha, type Theme } from '@12-apps/ui/mui/styles';
import useMediaQuery from '@12-apps/ui/mui/useMediaQuery';
import { Text } from '@12-apps/ui/typography/Text';

import { impersonation } from '../impersonation/surface';
import { HarnessNav } from './harness-nav';

/**
 * The harness chrome — the shape future-pay's admin shell has
 * (`apps/admin/src/shell/admin-shell.tsx`): a fixed-viewport flex row where a
 * `Sidebar` and the content each own an independent scroll region, the sidebar
 * panel tinted a few percent of primary so it reads as chrome rather than as
 * more page.
 *
 * On a phone it becomes what the admin becomes: an overlay drawer behind a
 * menu button, so the content gets the whole width. This file used to say that
 * behaviour had "no meaning here" — that was wrong, and hand-testing found it.
 * A 280px rail out of a 660px viewport leaves the report canvas 380px, which
 * is narrower than one chart, and the harness is where these packages are
 * looked at on a phone.
 *
 * The admin's shell still does two things this one has no use for: it resolves
 * the actor's permissions and the tenant's entitlements before it can draw a
 * row, and it persists rail and section state per tenant+user. There is no
 * actor and no tenant here.
 */

/**
 * Where the rail stops fitting. The same query the admin uses, deliberately —
 * the two shells changing shape at different widths would make the harness a
 * bad place to check how a package behaves at a breakpoint.
 */
const MOBILE_QUERY = '(max-width:900px)';

/** Subtle primary tint that distinguishes the sidebar panel from the content. */
export const panelBg = (t: Theme): string => alpha(t.palette.primary.main, 0.04);

/** Stacked-layers mark, drawn rather than imported — the sidebar's only art. */
function BrandMark(): JSX.Element {
  return (
    <Box component="span" sx={{ display: 'inline-flex', color: 'primary.main', flex: '0 0 auto' }}>
      <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m12 3 9 5-9 5-9-5 9-5Z" fill="currentColor" opacity={0.9} />
        <path
          d="m3 12 9 5 9-5"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.5}
        />
        <path
          d="m3 16 9 5 9-5"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.3}
        />
      </svg>
    </Box>
  );
}

function BrandHeader(): JSX.Element {
  return (
    <Box
      data-testid="harness-brand-header"
      sx={{ display: 'flex', alignItems: 'center', width: '100%', p: 2, bgcolor: panelBg }}
    >
      <BrandMark />
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0, ml: 1 }}>
        <Text variant="heading" size="lg" as="span">
          Harness
        </Text>
        <Text variant="caption" size="xs" color="secondary" as="span">
          published
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Whether the overlay nav is open, and the two rules that close it.
 *
 * It closes on a route change, because every row in this nav IS a route change
 * and a drawer that stays open over the page you just asked for hides it. And
 * it closes when the viewport grows back to desktop, so rotating a tablet with
 * the drawer open does not leave an overlay pinned above a rail that is now
 * docked anyway.
 */
function useMobileNav(
  isMobile: boolean,
  activeSlug: string,
): { open: boolean; toggle: () => void; close: () => void } {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [activeSlug]);

  useEffect(() => {
    if (!isMobile) setOpen(false);
  }, [isMobile]);

  return {
    open,
    toggle: () => setOpen((prev) => !prev),
    close: () => setOpen(false),
  };
}

/** The rail's contents — identical either way; only what wraps them changes. */
function NavPanel({ activeSlug }: { activeSlug: string }): JSX.Element {
  return (
    <>
      <SidebarHeader style={{ padding: 0 }}>
        <BrandHeader />
      </SidebarHeader>
      <SidebarContent>
        <Box sx={{ bgcolor: panelBg, minHeight: '100%' }}>
          <HarnessNav activeSlug={activeSlug} />
        </Box>
      </SidebarContent>
    </>
  );
}

/**
 * Docks the sidebar in-flow on desktop; wraps it in an overlay drawer on
 * mobile.
 *
 * `Sidebar` stays on both paths so the nav is the same component in the same
 * theme at every width — the drawer supplies the overlay and the backdrop, not
 * a second implementation of the rail.
 */
function HarnessNavRegion({
  isMobile,
  open,
  onClose,
  activeSlug,
}: {
  isMobile: boolean;
  open: boolean;
  onClose: () => void;
  activeSlug: string;
}): JSX.Element {
  const panel = (
    <Sidebar variant="fixed" width={280} dataTestId="harness-sidebar">
      <NavPanel activeSlug={activeSlug} />
    </Sidebar>
  );

  if (!isMobile) return panel;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      variant="left"
      width={280}
      dataTestId="harness-sidebar-drawer"
    >
      {panel}
    </Drawer>
  );
}

/**
 * The phone's only chrome: the mark, the name, and the way back to the nav.
 *
 * It exists because the drawer is closed by default, and a nav you cannot see
 * needs something visible to open it. On desktop it is not rendered at all —
 * the rail is already on screen, and a second header above it would be a title
 * bar for a page that has its own.
 */
function MobileTopBar({ onOpenNav }: { onOpenNav: () => void }): JSX.Element {
  return (
    <Box
      component="header"
      data-testid="harness-top-bar"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1,
        py: 1,
        flex: '0 0 auto',
        bgcolor: panelBg,
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Box
        component="button"
        type="button"
        onClick={onOpenNav}
        data-testid="harness-nav-toggle"
        aria-label="Abrir navegação"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          // 44px, which is the smallest target a thumb hits reliably. The icon
          // inside is 20px; the rest is the part you are allowed to miss by.
          width: 44,
          height: 44,
          flex: '0 0 auto',
          border: 0,
          borderRadius: 1.5,
          background: 'transparent',
          cursor: 'pointer',
          color: 'text.secondary',
          '&:hover': { bgcolor: (t) => alpha(t.palette.primary.main, 0.08) },
        }}
      >
        <MenuIcon fontSize="small" aria-hidden />
      </Box>
      <BrandMark />
      <Text variant="heading" size="md" as="span">
        Harness
      </Text>
    </Box>
  );
}

export function HarnessShell({
  activeSlug,
  children,
}: {
  activeSlug: string;
  children: ReactNode;
}): JSX.Element {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const nav = useMobileNav(isMobile, activeSlug);
  const ImpersonationBanner = impersonation.banner;

  return (
    // `100dvh`, not `100vh`: on a phone the browser's own chrome retracts as
    // you scroll, and `vh` measures the tallest state — so a fixed-viewport
    // shell sized in `vh` puts its last row under the address bar, where it
    // cannot be tapped. `dvh` follows the viewport that actually exists.
    <Box sx={{ display: 'flex', height: '100dvh', overflow: 'hidden' }}>
      <HarnessNavRegion
        isMobile={isMobile}
        open={nav.open}
        onClose={nav.close}
        activeSlug={activeSlug}
      />
      {/* A column on both paths, so the page below scrolls under a top bar that
          stays put rather than scrolling away with it. */}
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
        {/* ONCE per app, in the chrome, ABOVE the scroll region — never per
            page. `flow` because this shell already owns a non-scrolling top
            region, so the bar drops in as a `flex: 0 0 auto` row and the content
            simply gets shorter. A storefront whose own header is fixed passes
            `placement="fixed"` instead and the package offsets the chrome by
            the bar's measured height. It renders nothing when there is no
            session but STAYS MOUNTED: the package refuses to start a session in
            a document with no banner host. */}
        <ImpersonationBanner />
        {isMobile ? <MobileTopBar onOpenNav={nav.toggle} /> : null}
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            overflow: 'auto',
            // 24px of gutter on a 390px screen spends 12% of the width on
            // nothing. The narrow tier keeps a margin, not a frame.
            p: { xs: 1.5, md: 3 },
          }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}
