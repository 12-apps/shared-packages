import { useState, type JSX } from 'react';

import BarChartIcon from '@mui/icons-material/BarChartOutlined';
import CircleIcon from '@mui/icons-material/CircleOutlined';
import CreditCardIcon from '@mui/icons-material/CreditCardOutlined';
import ExpandIcon from '@mui/icons-material/KeyboardArrowDown';
import InstallMobileIcon from '@mui/icons-material/InstallMobileOutlined';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCartOutlined';

import { Collapsible } from '@12-apps/ui/layout/Collapsible';
import { Box } from '@12-apps/ui/mui/Box';
import { List } from '@12-apps/ui/mui/List';
import { ListItemButton } from '@12-apps/ui/mui/ListItemButton';
import { ListItemText } from '@12-apps/ui/mui/ListItemText';
import { alpha } from '@12-apps/ui/mui/styles';
import { Text } from '@12-apps/ui/typography/Text';

import { buildHarnessNav, rowHoldsSlug, type NavRow, type NavSection } from './nav-tree';

/**
 * The harness sidebar — the same sidebar the origin host's admin has
 * (`apps/admin/src/shell/admin-sidebar-nav.tsx`), rendered from the same
 * components against the same theme.
 *
 * It is deliberately not a lookalike built from inline styles. Every primitive
 * below — `Collapsible`, `List`, `ListItemButton`, `ListItemText`, `Text`, and
 * the `alpha(primary)` selection tint — is the one the admin uses, so the two
 * sidebars cannot drift into looking similar-but-not-quite. That also means
 * this chrome is itself a consumer of `@12-apps/ui`: if a release breaks
 * `Collapsible`, the harness's own navigation is the first thing to show it.
 *
 * What is NOT carried over is everything gate-shaped — the permission and
 * entitlement filters, the lock glyph and its upsell, the badge counts. Those
 * are the admin's reason for existing; here every page is always reachable.
 */

/** Icons are keyed by row, exactly as the admin keys them by `testId`. */
const ICON_BY_KEY: Record<string, typeof CircleIcon> = {
  checkout: ShoppingCartIcon,
  'pwa-install-prompt': InstallMobileIcon,
  'payments-provider-settings': CreditCardIcon,
  'report-builder': BarChartIcon,
};

/** The group header's caret — one per section, and nowhere else in the nav. */
function Chevron({ open }: { open: boolean }): JSX.Element {
  return (
    <ExpandIcon
      fontSize="small"
      aria-hidden
      sx={{
        transition: 'transform 150ms',
        transform: open ? 'none' : 'rotate(-90deg)',
      }}
    />
  );
}

function NavRowIcon({ row, active }: { row: NavRow; active: boolean }): JSX.Element {
  // An unknown key falls back to a neutral dot, so a page added to the registry
  // still renders an icon rather than a ragged row with no leading glyph.
  const Icon = ICON_BY_KEY[row.key] ?? CircleIcon;
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        flex: '0 0 auto',
        color: 'primary.main',
        opacity: active ? 1 : 0.75,
      }}
    >
      <Icon fontSize="small" aria-hidden />
    </Box>
  );
}

/** A top-level destination: leading icon + label, tinted when it is the page. */
function NavItem({ row, active }: { row: NavRow; active: boolean }): JSX.Element {
  return (
    <ListItemButton
      component="a"
      href={`#/${row.slug}`}
      data-testid={`harness-nav-${row.key}`}
      aria-label={row.label}
      aria-current={active ? 'page' : undefined}
      selected={active}
      sx={{
        gap: 1.5,
        borderRadius: 1.5,
        mx: 0.5,
        px: 1,
        py: 0.75,
        my: 0.25,
        color: active ? 'primary.main' : 'text.secondary',
        '&.Mui-selected': {
          bgcolor: (t) => alpha(t.palette.primary.main, 0.12),
          '&:hover': { bgcolor: (t) => alpha(t.palette.primary.main, 0.18) },
        },
      }}
    >
      <NavRowIcon row={row} active={active} />
      <ListItemText
        primary={row.label}
        secondary={row.pkg}
        primaryTypographyProps={{ variant: 'body2', noWrap: true, fontWeight: active ? 600 : 500 }}
        secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
      />
    </ListItemButton>
  );
}

/** A nested destination: indented, icon-less, same active treatment. */
function NavChild({ row, active }: { row: NavRow; active: boolean }): JSX.Element {
  return (
    <ListItemButton
      component="a"
      href={`#/${row.slug}`}
      data-testid={`harness-nav-${row.key}`}
      aria-label={row.label}
      aria-current={active ? 'page' : undefined}
      selected={active}
      sx={{
        gap: 1,
        borderRadius: 1.5,
        ml: 3.5,
        mr: 0.5,
        px: 1,
        py: 0.4,
        color: active ? 'primary.main' : 'text.secondary',
        '&.Mui-selected': {
          bgcolor: (t) => alpha(t.palette.primary.main, 0.1),
          '&:hover': { bgcolor: (t) => alpha(t.palette.primary.main, 0.16) },
        },
      }}
    >
      <ListItemText
        primary={row.label}
        primaryTypographyProps={{ variant: 'caption', noWrap: true, fontWeight: active ? 600 : 400 }}
      />
    </ListItemButton>
  );
}

/**
 * One top-level row plus the rows nested under it.
 *
 * The disclosure IS the route and has no control of its own: a row is open
 * while you are inside it — on its own page or one of its children's — and
 * closed once you leave. So there is no stale-open disclosure to reset, and no
 * way for the sidebar to disagree with the page you are on.
 */
function NavEntry({ row, activeSlug }: { row: NavRow; activeSlug: string }): JSX.Element {
  const childActive = row.children.some((child) => child.slug === activeSlug);
  return (
    <>
      {/* The parent lands on one of its own children, so when that child is the
          active page the CHILD carries the highlight and the parent does not —
          two tinted rows for one destination reads as two pages. */}
      <NavItem row={row} active={row.slug === activeSlug && !childActive} />
      {row.children.length > 0 && (
        <Collapsible open={rowHoldsSlug(row, activeSlug)}>
          {row.children.map((child) => (
            <NavChild key={child.key} row={child} active={child.slug === activeSlug} />
          ))}
        </Collapsible>
      )}
    </>
  );
}

/** One labelled section: a keyboard-operable header whose caret is the state. */
function NavSectionBlock({
  section,
  activeSlug,
  open,
  onToggle,
}: {
  section: NavSection;
  activeSlug: string;
  open: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <Box component="section" data-testid={`harness-nav-group-${section.key}`} sx={{ mb: 1 }}>
      <Box
        component="button"
        type="button"
        onClick={onToggle}
        data-testid={`harness-nav-section-toggle-${section.key}`}
        aria-expanded={open}
        aria-label={section.label}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          px: 1.5,
          py: 0.75,
          mt: 0.5,
          border: 0,
          background: 'transparent',
          cursor: 'pointer',
          color: 'text.secondary',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        <Text variant="caption" size="xs" color="secondary" weight="semibold" as="span">
          {section.label}
        </Text>
        <Box component="span" sx={{ display: 'inline-flex', color: 'text.disabled' }}>
          <Chevron open={open} />
        </Box>
      </Box>
      <Collapsible open={open}>
        {section.rows.map((row) => (
          <NavEntry key={row.key} row={row} activeSlug={activeSlug} />
        ))}
      </Collapsible>
    </Box>
  );
}

const SECTIONS = buildHarnessNav();

export function HarnessNav({ activeSlug }: { activeSlug: string }): JSX.Element {
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const toggle = (key: string) =>
    setCollapsed((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));

  return (
    <List component="nav" data-testid="harness-nav" sx={{ px: 1, py: 0 }}>
      {SECTIONS.map((section) => (
        <NavSectionBlock
          key={section.key}
          section={section}
          activeSlug={activeSlug}
          // A collapsed section hides its rows even when you are standing in
          // one of them, exactly as the admin's does. Forcing it back open made
          // the header look broken: you click collapse on the section you are
          // in and nothing happens.
          open={!collapsed.includes(section.key)}
          onToggle={() => toggle(section.key)}
        />
      ))}
    </List>
  );
}
