import Typography from '@mui/material/Typography/index.js';
import { alpha, useTheme, type SxProps, type Theme } from '@mui/material/styles/index.js';
import { useState, type ElementType, type ReactNode } from 'react';

import type { SectionNavCopy } from '../../../copy';
import { stackedOverlayZIndex } from '../../../tokens/layers';
import { rem } from '../../../tokens/scales';

import { barSlots, destinationState, isMenu, menuActive, menuCount, type BarSlot } from './SectionNav.helpers';
import {
  Box,
  CONTROL_RESET,
  CountedIcon,
  NOT_LIVE,
  SlotIcon,
  controlProps,
  useMounted,
  destinationControl,
  focusRing,
} from './SectionNav.parts';
import { RaisedActionButton } from './SectionNav.primary';
import { SectionNavSheet } from './SectionNav.sheet';
import type { SectionNavAction, SectionNavBadge, SectionNavDestination, SectionNavMenu, SectionNavProps } from './SectionNav.types';

/** Which of the bar's two menus is open, if any. */
type OpenMenu = 'primary' | 'more' | null;

/**
 * The bar's height above the safe area — tall enough for an icon over a label;
 * a compact bar holds the icon alone.
 */
const barHeight = (theme: Parameters<typeof rem>[0], compact = false): string => rem(theme, compact ? 48 : 60);

/** How the bar is drawn — `compact` is `SectionNavProps.compact`. */
export interface SectionNavBarOptions {
  compact?: boolean;
}

/**
 * The bar's full height on screen, the safe area included — where its sheets
 * stop, and what a host reserves at the foot of its content so nothing it
 * floats (a toast, a receipt) lands under the bar.
 */
export function sectionNavBarInset(theme: Parameters<typeof rem>[0], options: SectionNavBarOptions = {}): string {
  return `calc(${barHeight(theme, options.compact === true)} + env(safe-area-inset-bottom))`;
}

/**
 * One slot: icon over label, a count on the icon.
 *
 * `current` is the page the viewer is on and is what `aria-current` reports —
 * a link's claim only; an action slot that is ON says so with `aria-pressed`,
 * which arrives in `control`. `lit` is only how the slot looks, and goes out
 * while a sheet is open so the bar shows where the thumb is. Opening a sheet
 * is `aria-expanded`'s to say.
 *
 * A destination is a link or an action; the "more" slot is a button that
 * opens its sheet. Either way the whole slot is the target, so a thumb landing
 * on the label lands on the control. A `disabled` slot is a disabled button,
 * dimmed — the act is still where the hand expects it. A `loading` or
 * `dimmed` slot is drawn the same and stays focusable (`aria-disabled`).
 */
function Slot({
  label,
  icon,
  count,
  current,
  lit,
  copy,
  testId,
  control,
  expanded,
  loading = false,
  compact = false,
}: {
  label: string;
  icon: ReactNode;
  count: SectionNavBadge | undefined;
  current: boolean;
  lit: boolean;
  copy: SectionNavCopy;
  testId: string;
  control: Record<string, unknown>;
  expanded?: boolean;
  loading?: boolean;
  /** Icon only: the label stays the slot's name, out of sight, and its tooltip. */
  compact?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  const animate = useMounted();
  return (
    <Box
      {...control}
      title={compact ? label : undefined}
      aria-current={current ? 'page' : undefined}
      aria-expanded={expanded}
      aria-busy={loading || undefined}
      data-lit={lit ? 'true' : undefined}
      data-testid={testId}
      sx={slotSx(theme, lit, compact)}
    >
      <CountedIcon
        icon={
          <Box component="span" data-slot-pill="" sx={pillSx(theme)}>
            <SlotIcon icon={icon} loading={loading} />
          </Box>
        }
        count={count}
        label={copy.badge}
        attentionLabel={copy.attention}
        testId={`${testId}-badge`}
      />
      <Typography
        component="span"
        variant="caption"
        sx={{
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          lineHeight: 1.3,
          fontWeight: lit ? 700 : 600,
          color: lit ? 'text.primary' : 'inherit',
          ...labelFoldSx(theme, compact, animate),
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}

/**
 * The label folding away in a compact bar: it shrinks to no height and fades
 * while the bar shrinks, rather than leaving in one frame. Never `display:
 * none` — it is still the slot's accessible name. With reduced motion it
 * simply goes.
 */
function labelFoldSx(theme: Theme, compact: boolean, animate: boolean): Record<string, unknown> {
  return {
    maxHeight: compact ? 0 : rem(theme, 24),
    opacity: compact ? 0 : 1,
    transition: animate
      ? theme.transitions.create(['max-height', 'opacity'], { duration: theme.transitions.duration.shorter })
      : 'none',
    '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
  };
}

/** The pill behind a slot's icon — tinted while the slot is lit. */
function pillSx(theme: Theme): SxProps<Theme> {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    px: 1.75,
    py: 0.25,
    borderRadius: rem(theme, 999),
    transition: theme.transitions.create('background-color', { duration: theme.transitions.duration.shorter }),
  };
}

/** A slot's look: icon over label, a pill behind the lit icon, dimmed when disabled. */
function slotSx(theme: Theme, lit: boolean, compact: boolean): SxProps<Theme> {
  return {
    ...CONTROL_RESET,
    ...focusRing(theme),
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: compact ? 0 : 0.25,
    position: 'relative',
    color: lit ? 'primary.main' : 'text.secondary',
    // The current slot is marked by more than its colour: a tinted pill behind
    // its icon and a bolder label, so the state survives a colour-blind reading.
    '&[data-lit="true"] [data-slot-pill]': { bgcolor: alpha(theme.palette.primary.main, 0.14) },
    '& svg': { fontSize: rem(theme, 22) },
    [NOT_LIVE]: { color: 'text.disabled' },
  } as SxProps<Theme>;
}

/** What every slot kind is handed: the bar's open state and how to change it. */
interface SlotContext {
  open: OpenMenu;
  toggle: (menu: Exclude<OpenMenu, null>) => void;
  close: () => void;
  linkComponent: ElementType | undefined;
  copy: SectionNavCopy;
  dataTestId: string;
  compact: boolean;
}

/** The raised button: an action runs on tap; a menu opens its sheet. */
function PrimarySlot({
  primary,
  context,
}: {
  primary: SectionNavMenu | SectionNavAction;
  context: SlotContext;
}): React.JSX.Element {
  const testId = primary.dataTestId ?? `${context.dataTestId}-primary`;
  if (!isMenu(primary)) {
    return (
      <RaisedActionButton
        label={primary.label}
        icon={primary.icon}
        captioned
        compact={context.compact}
        disabled={primary.disabled}
        loading={primary.loading}
        dataTestId={testId}
        onClick={() => {
          context.close();
          primary.onSelect();
        }}
      />
    );
  }
  return (
    <RaisedActionButton
      label={primary.label}
      icon={primary.icon}
      open={context.open === 'primary'}
      closeLabel={context.copy.close}
      compact={context.compact}
      disabled={primary.disabled}
      dataTestId={testId}
      onClick={() => context.toggle('primary')}
    />
  );
}

/** The "more" slot: a button that opens its sheet, carrying its entries' counts. */
function MoreSlot({ more, context }: { more: SectionNavMenu; context: SlotContext }): React.JSX.Element {
  const { open } = context;
  return (
    <Slot
      label={more.label}
      icon={more.icon}
      count={menuCount(more)}
      current={false}
      lit={open === 'more' || (open === null && menuActive(more))}
      expanded={open === 'more'}
      copy={context.copy}
      testId={more.dataTestId ?? `${context.dataTestId}-more`}
      compact={context.compact}
      control={controlProps({
        href: undefined,
        linkComponent: context.linkComponent,
        inert: more.disabled === true,
        onClick: () => context.toggle('more'),
      })}
    />
  );
}

/** A destination: a link, or an action slot (a toggle when it carries `active`). */
function DestinationSlot({
  destination,
  context,
}: {
  destination: SectionNavDestination;
  context: SlotContext;
}): React.JSX.Element {
  const { current, lit } = destinationState(destination);
  return (
    <Slot
      label={destination.label}
      icon={destination.icon}
      count={destination.badge}
      current={current}
      lit={context.open === null && lit}
      copy={context.copy}
      testId={destination.dataTestId ?? `${context.dataTestId}-dest-${destination.id}`}
      loading={destination.loading === true}
      compact={context.compact}
      control={destinationControl(destination, context.linkComponent, () => {
        context.close();
        destination.onSelect?.();
      })}
    />
  );
}

/** One slot of the bar, whichever kind it is. */
function BarSlotView({
  slot,
  primary,
  more,
  context,
}: {
  slot: BarSlot;
  primary: SectionNavMenu | SectionNavAction | undefined;
  more: SectionNavMenu | undefined;
  context: SlotContext;
}): React.JSX.Element | null {
  if (slot.kind === 'primary') return primary ? <PrimarySlot primary={primary} context={context} /> : null;
  if (slot.kind === 'more') return more ? <MoreSlot more={more} context={context} /> : null;
  return <DestinationSlot destination={slot.destination} context={context} />;
}

/** The bar's own box: docked, a hairline on top, raised over the backdrop only while its sheet is open. */
function barSx(theme: Theme, sheetOpen: boolean, compact: boolean, animate: boolean): SxProps<Theme> {
  return {
    flex: 'none',
    display: 'flex',
    alignItems: 'stretch',
    boxSizing: 'border-box',
    height: sectionNavBarInset(theme, { compact }),
    // Folding to icons and back is a change of height the eye follows;
    // with reduced motion it simply happens.
    transition: animate ? theme.transitions.create('height', { duration: theme.transitions.duration.shorter }) : 'none',
    '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
    paddingBottom: 'env(safe-area-inset-bottom)',
    borderTop: `1px solid ${theme.palette.divider}`,
    bgcolor: 'background.paper',
    // Above the backdrop ONLY while one of its own sheets is open, so the
    // primary button can close what it opened. Raised all the time it
    // would sit over every dialog the page opens, and on a small phone a
    // dialog's own footer is exactly where the bar is. `stackedOverlayZIndex`,
    // not `zIndex.modal + 1`: a host lifting a bottom Drawer clear of a
    // stacked sheet catches this bar's OWN sheets too.
    position: 'relative',
    zIndex: sheetOpen ? stackedOverlayZIndex(theme) + 1 : 'auto',
  } as SxProps<Theme>;
}

/** The phone layout: a bottom bar, with its menus as bottom sheets. */
export function SectionNavBar({
  label,
  destinations,
  primary,
  more,
  linkComponent,
  copy,
  dataTestId,
  compact = false,
}: Required<Pick<SectionNavProps, 'label' | 'destinations' | 'copy' | 'dataTestId'>> &
  Pick<SectionNavProps, 'primary' | 'more' | 'compact'> & { linkComponent: ElementType | undefined }): React.JSX.Element {
  const sheetMenu = isMenu(primary) ? primary : undefined;
  const theme = useTheme();
  const animate = useMounted();
  const [open, setOpen] = useState<OpenMenu>(null);
  const toggle = (menu: Exclude<OpenMenu, null>): void => setOpen((current) => (current === menu ? null : menu));
  const close = (): void => setOpen(null);

  return (
    <>
      <Box
        component="nav"
        aria-label={label}
        data-testid={dataTestId}
        sx={barSx(theme, open !== null, compact, animate)}
      >
        {barSlots(destinations, more !== undefined, primary !== undefined).map((slot) => (
          <BarSlotView
            key={slot.kind === 'destination' ? `dest-${slot.destination.id}` : `menu-${slot.kind}`}
            slot={slot}
            primary={primary}
            more={more}
            context={{ open, toggle, close, linkComponent, copy, dataTestId, compact }}
          />
        ))}
      </Box>
      {sheetMenu ? (
        <SectionNavSheet
          menu={sheetMenu}
          open={open === 'primary'}
          onClose={close}
          linkComponent={linkComponent}
          copy={copy}
          testId={`${dataTestId}-primary-sheet`}
          bottomOffset={sectionNavBarInset(theme, { compact })}
        />
      ) : null}
      {more ? (
        <SectionNavSheet
          menu={more}
          open={open === 'more'}
          onClose={close}
          linkComponent={linkComponent}
          copy={copy}
          testId={`${dataTestId}-more-sheet`}
          bottomOffset={sectionNavBarInset(theme, { compact })}
        />
      ) : null}
    </>
  );
}
