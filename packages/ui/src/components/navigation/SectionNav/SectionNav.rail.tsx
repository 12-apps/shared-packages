import Typography from '@mui/material/Typography/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import type { ElementType, ReactNode } from 'react';

import type { SectionNavCopy } from '../../../copy';
import { rem } from '../../../tokens/scales';

import { destinationState, isMenu } from './SectionNav.helpers';
import {
  Box,
  CONTROL_RESET,
  CountedIcon,
  NOT_LIVE,
  SlotIcon,
  controlProps,
  destinationControl,
  focusRing,
} from './SectionNav.parts';
import { RailCreateMenu } from './SectionNav.railCreate';
import type {
  SectionNavAction,
  SectionNavBack,
  SectionNavDestination,
  SectionNavMenu,
  SectionNavProps,
} from './SectionNav.types';

/**
 * One rail row: icon, label, and the count at the far end.
 *
 * Destinations and menu entries draw the same row — in the rail there is room
 * for everything, so the difference between "a place" and "an action" is the
 * section it sits in, not its shape.
 *
 * `active` is the look; `current` is what `aria-current` reports, and is a
 * link's claim only — an action row that is ON says so with `aria-pressed`,
 * which arrives in `control`. Omitted, `current` follows `active`.
 */
function RailRow({
  label,
  description,
  icon,
  count,
  active,
  current = active,
  copy,
  testId,
  control,
  loading = false,
}: {
  label: string;
  description?: string;
  icon: ReactNode;
  count: number | undefined;
  active: boolean;
  current?: boolean;
  copy: SectionNavCopy;
  testId: string;
  control: Record<string, unknown>;
  loading?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Box
      {...control}
      aria-current={current ? 'page' : undefined}
      aria-busy={loading || undefined}
      data-testid={testId}
      sx={{
        ...CONTROL_RESET,
        ...focusRing(theme),
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        width: '100%',
        minHeight: rem(theme, 40),
        px: 1.25,
        py: 0.75,
        borderRadius: 1,
        textAlign: 'start',
        color: active ? 'primary.main' : 'text.primary',
        bgcolor: active ? 'action.selected' : 'transparent',
        '&:hover': { bgcolor: active ? 'action.selected' : 'action.hover' },
        '& svg': { color: 'primary.main', fontSize: rem(theme, 20) },
        [NOT_LIVE]: { color: 'text.disabled', '& svg': { color: 'text.disabled' } },
      }}
    >
      <CountedIcon
        icon={<SlotIcon icon={icon} loading={loading} />}
        count={count}
        label={copy.badge}
        testId={`${testId}-badge`}
      />
      <Box component="span" sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Typography component="span" variant="body2" sx={{ fontWeight: active ? 700 : 500 }}>
          {label}
        </Typography>
        {description ? (
          <Typography component="span" variant="caption" color="text.secondary">
            {description}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}

/** A heading between the rail's sections, in the sidebar's small-caps voice. */
function RailHeading({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <Typography variant="overline" color="text.secondary" sx={{ px: 1.25, pt: 1.5, lineHeight: 1.6 }}>
      {children}
    </Typography>
  );
}

/**
 * The `more` menu's groups, listed under its title — the rail has room for the
 * places it holds. A `disabled` menu has no trigger here to refuse, so every
 * row of it is inert instead. (`primary` folds behind one button instead —
 * `RailCreateMenu`.)
 */
function RailMenu({
  menu,
  linkComponent,
  copy,
  testId,
}: {
  menu: SectionNavMenu;
  linkComponent: ElementType | undefined;
  copy: SectionNavCopy;
  testId: string;
}): React.JSX.Element {
  return (
    <Box component="section" data-testid={testId} sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      <RailHeading>{menu.title}</RailHeading>
      {menu.groups.map((group) => (
        <Box key={group.id} sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          {group.title ? (
            <Typography variant="caption" color="text.secondary" sx={{ px: 1.25, pt: 0.5 }}>
              {group.title}
            </Typography>
          ) : null}
          {group.entries.map((entry) => (
            <RailRow
              key={entry.id}
              label={entry.label}
              description={entry.description}
              icon={entry.icon}
              count={entry.badge}
              active={entry.active === true}
              copy={copy}
              testId={entry.dataTestId ?? `${testId}-entry-${entry.id}`}
              control={controlProps({
                href: entry.href,
                linkComponent,
                inert: menu.disabled === true || entry.disabled === true,
                onClick: () => entry.onSelect?.(),
              })}
            />
          ))}
        </Box>
      ))}
    </Box>
  );
}

/** The way back out of the section, at the top of the rail. */
function RailBack({
  back,
  linkComponent,
  testId,
}: {
  back: SectionNavBack;
  linkComponent: ElementType | undefined;
  testId: string;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Box
      {...controlProps({ href: back.href, linkComponent })}
      data-testid={testId}
      sx={{
        ...CONTROL_RESET,
        ...focusRing(theme),
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.25,
        py: 0.75,
        mb: 0.5,
        borderRadius: 1,
        color: 'text.secondary',
        '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
        '& svg': { fontSize: rem(theme, 20) },
      }}
    >
      {back.icon}
      <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
        {back.label}
      </Typography>
    </Box>
  );
}

/** A primary that ACTS, as one row: there is no sheet to list on a wide screen. */
function RailAction({
  action,
  linkComponent,
  copy,
  testId,
}: {
  action: SectionNavAction;
  linkComponent: ElementType | undefined;
  copy: SectionNavCopy;
  testId: string;
}): React.JSX.Element {
  return (
    <RailRow
      label={action.label}
      icon={action.icon}
      count={undefined}
      active={false}
      copy={copy}
      testId={action.dataTestId ?? testId}
      loading={action.loading === true}
      control={controlProps({
        href: undefined,
        linkComponent,
        inert: action.disabled === true,
        busy: action.loading === true,
        onClick: action.onSelect,
      })}
    />
  );
}

/** A destination as a row: a link, or an action (a toggle when it carries `active`). */
function RailDestination({
  destination,
  linkComponent,
  copy,
  testId,
}: {
  destination: SectionNavDestination;
  linkComponent: ElementType | undefined;
  copy: SectionNavCopy;
  testId: string;
}): React.JSX.Element {
  const { current, lit } = destinationState(destination);
  return (
    <RailRow
      label={destination.label}
      icon={destination.icon}
      count={destination.badge}
      active={lit}
      current={current}
      copy={copy}
      testId={testId}
      loading={destination.loading === true}
      control={destinationControl(destination, linkComponent, () => destination.onSelect?.())}
    />
  );
}

/**
 * The wide-screen layout: a vertical rail — the way back, the heading, a
 * `primary` menu as one button that opens it (FUT-3015), the destinations, a
 * `primary` action as a row, then `more` listed in full.
 *
 * It fills the column the host gives it and scrolls on its own, like the
 * sidebar it stands in for.
 */
export function SectionNavRail({
  label,
  destinations,
  primary,
  more,
  back,
  heading,
  linkComponent,
  copy,
  dataTestId,
}: Required<Pick<SectionNavProps, 'label' | 'destinations' | 'copy' | 'dataTestId'>> &
  Pick<SectionNavProps, 'primary' | 'more' | 'back' | 'heading'> & {
    linkComponent: ElementType | undefined;
  }): React.JSX.Element {
  return (
    <Box
      component="nav"
      aria-label={label}
      data-testid={dataTestId}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0.25,
        height: '100%',
        overflowY: 'auto',
        px: 1,
        py: 1.5,
        bgcolor: 'background.paper',
      }}
    >
      {back ? <RailBack back={back} linkComponent={linkComponent} testId={`${dataTestId}-back`} /> : null}
      {heading ? <RailHeading>{heading}</RailHeading> : null}
      {isMenu(primary) ? (
        <RailCreateMenu menu={primary} linkComponent={linkComponent} copy={copy} testId={`${dataTestId}-primary`} />
      ) : null}
      {destinations.map((destination) => (
        <RailDestination
          key={destination.id}
          destination={destination}
          linkComponent={linkComponent}
          copy={copy}
          testId={destination.dataTestId ?? `${dataTestId}-dest-${destination.id}`}
        />
      ))}
      {primary && !isMenu(primary) ? (
        <RailAction action={primary} linkComponent={linkComponent} copy={copy} testId={`${dataTestId}-primary`} />
      ) : null}
      {more ? <RailMenu menu={more} linkComponent={linkComponent} copy={copy} testId={`${dataTestId}-more`} /> : null}
    </Box>
  );
}
