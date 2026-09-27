import Typography from '@mui/material/Typography/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import { useState, type ElementType, type ReactNode } from 'react';

import type { SectionNavCopy } from '../../../copy';
import { rem } from '../../../tokens/scales';

import { barSlots, menuActive, menuCount, type BarSlot } from './SectionNav.helpers';
import { Box, CONTROL_RESET, CountedIcon, controlProps, focusRing } from './SectionNav.parts';
import { RaisedActionButton } from './SectionNav.primary';
import { SectionNavSheet } from './SectionNav.sheet';
import type { SectionNavMenu, SectionNavProps } from './SectionNav.types';

/** Which of the bar's two menus is open, if any. */
type OpenMenu = 'primary' | 'more' | null;

/** The bar's height above the safe area — tall enough for an icon over a label. */
const barHeight = (theme: Parameters<typeof rem>[0]): string => rem(theme, 60);

/**
 * The bar's full height on screen, the safe area included — where its sheets
 * stop, and what a host reserves at the foot of its content so nothing it
 * floats (a toast, a receipt) lands under the bar.
 */
export function sectionNavBarInset(theme: Parameters<typeof rem>[0]): string {
  return `calc(${barHeight(theme)} + env(safe-area-inset-bottom))`;
}

/**
 * One slot: icon over label, current when `active`, a count on the icon.
 *
 * A destination is a link; the "more" slot is a button that opens its sheet.
 * Either way the whole slot is the target, so a thumb landing on the label
 * lands on the control.
 */
function Slot({
  label,
  icon,
  count,
  active,
  copy,
  testId,
  control,
  expanded,
}: {
  label: string;
  icon: ReactNode;
  count: number | undefined;
  active: boolean;
  copy: SectionNavCopy;
  testId: string;
  control: Record<string, unknown>;
  expanded?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Box
      {...control}
      aria-current={active ? 'page' : undefined}
      aria-expanded={expanded}
      data-testid={testId}
      sx={{
        ...CONTROL_RESET,
        ...focusRing(theme),
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.25,
        position: 'relative',
        color: active ? 'primary.main' : 'text.secondary',
        // The current slot is marked by more than its colour: a short rule on
        // its top edge, so the state survives a colour-blind reading.
        '&[aria-current="page"]::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          insetInline: '22%',
          height: rem(theme, 3),
          borderBottomLeftRadius: rem(theme, 3),
          borderBottomRightRadius: rem(theme, 3),
          bgcolor: 'primary.main',
        },
        '& svg': { fontSize: rem(theme, 22) },
      }}
    >
      <CountedIcon icon={icon} count={count} label={copy.badge} testId={`${testId}-badge`} />
      <Typography
        component="span"
        variant="caption"
        sx={{
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          lineHeight: 1.3,
          fontWeight: active ? 700 : 400,
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}

/** One slot of the bar, whichever kind it is. */
function BarSlotView({
  slot,
  primary,
  more,
  open,
  toggle,
  close,
  linkComponent,
  copy,
  dataTestId,
}: {
  slot: BarSlot;
  primary: SectionNavMenu | undefined;
  more: SectionNavMenu | undefined;
  open: OpenMenu;
  toggle: (menu: Exclude<OpenMenu, null>) => void;
  close: () => void;
  linkComponent: ElementType | undefined;
  copy: SectionNavCopy;
  dataTestId: string;
}): React.JSX.Element | null {
  if (slot.kind === 'primary' && primary) {
    return (
      <RaisedActionButton
        label={primary.label}
        icon={primary.icon}
        open={open === 'primary'}
        closeLabel={copy.close}
        dataTestId={`${dataTestId}-primary`}
        onClick={() => toggle('primary')}
      />
    );
  }
  if (slot.kind === 'more' && more) {
    return (
      <Slot
        label={more.label}
        icon={more.icon}
        count={menuCount(more)}
        active={open === 'more' || (open === null && menuActive(more))}
        expanded={open === 'more'}
        copy={copy}
        testId={`${dataTestId}-more`}
        control={controlProps({ href: undefined, linkComponent, onClick: () => toggle('more') })}
      />
    );
  }
  if (slot.kind !== 'destination') return null;
  const { destination } = slot;
  return (
    <Slot
      label={destination.label}
      icon={destination.icon}
      count={destination.badge}
      active={open === null && destination.active === true}
      copy={copy}
      testId={`${dataTestId}-dest-${destination.id}`}
      control={controlProps({ href: destination.href, linkComponent, onClick: close })}
    />
  );
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
}: Required<Pick<SectionNavProps, 'label' | 'destinations' | 'copy' | 'dataTestId'>> &
  Pick<SectionNavProps, 'primary' | 'more'> & { linkComponent: ElementType | undefined }): React.JSX.Element {
  const theme = useTheme();
  const [open, setOpen] = useState<OpenMenu>(null);
  const toggle = (menu: Exclude<OpenMenu, null>): void => setOpen((current) => (current === menu ? null : menu));
  const close = (): void => setOpen(null);

  return (
    <>
      <Box
        component="nav"
        aria-label={label}
        data-testid={dataTestId}
        sx={{
          flex: 'none',
          display: 'flex',
          alignItems: 'stretch',
          height: sectionNavBarInset(theme),
          paddingBottom: 'env(safe-area-inset-bottom)',
          borderTop: `1px solid ${theme.palette.divider}`,
          bgcolor: 'background.paper',
          // Above the backdrop ONLY while one of its own sheets is open, so the
          // primary button can close what it opened. Raised all the time it
          // would sit over every dialog the page opens, and on a small phone a
          // dialog's own footer is exactly where the bar is.
          position: 'relative',
          zIndex: open === null ? 'auto' : theme.zIndex.modal + 1,
        }}
      >
        {barSlots(destinations, more !== undefined, primary !== undefined).map((slot) => (
          <BarSlotView
            key={slot.kind === 'destination' ? slot.destination.id : slot.kind}
            slot={slot}
            primary={primary}
            more={more}
            open={open}
            toggle={toggle}
            close={close}
            linkComponent={linkComponent}
            copy={copy}
            dataTestId={dataTestId}
          />
        ))}
      </Box>
      {primary ? (
        <SectionNavSheet
          menu={primary}
          open={open === 'primary'}
          onClose={close}
          linkComponent={linkComponent}
          copy={copy}
          testId={`${dataTestId}-primary-sheet`}
          bottomOffset={sectionNavBarInset(theme)}
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
          bottomOffset={sectionNavBarInset(theme)}
        />
      ) : null}
    </>
  );
}
