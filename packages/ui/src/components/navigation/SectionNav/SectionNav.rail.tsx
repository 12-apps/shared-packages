import Typography from '@mui/material/Typography/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import type { ElementType, ReactNode } from 'react';

import type { SectionNavCopy } from '../../../copy';
import { rem } from '../../../tokens/scales';

import { Box, CONTROL_RESET, CountedIcon, controlProps, focusRing } from './SectionNav.parts';
import type { SectionNavMenu, SectionNavProps } from './SectionNav.types';

/**
 * One rail row: icon, label, and the count at the far end.
 *
 * Destinations and menu entries draw the same row — in the rail there is room
 * for everything, so the difference between "a place" and "an action" is the
 * section it sits in, not its shape.
 */
function RailRow({
  label,
  description,
  icon,
  count,
  active,
  copy,
  testId,
  control,
}: {
  label: string;
  description?: string;
  icon: ReactNode;
  count: number | undefined;
  active: boolean;
  copy: SectionNavCopy;
  testId: string;
  control: Record<string, unknown>;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Box
      {...control}
      aria-current={active ? 'page' : undefined}
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
      }}
    >
      <CountedIcon icon={icon} count={count} label={copy.badge} testId={`${testId}-badge`} />
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

/** A menu's groups, listed under its title — nothing folded away on a wide screen. */
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
              testId={`${testId}-entry-${entry.id}`}
              control={controlProps({ href: entry.href, linkComponent, onClick: () => entry.onSelect?.() })}
            />
          ))}
        </Box>
      ))}
    </Box>
  );
}

/**
 * The wide-screen layout: a vertical rail — the way back, the destinations,
 * then every menu's entries.
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
  const theme = useTheme();
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
      {back ? (
        <Box
          {...controlProps({ href: back.href, linkComponent, onClick: () => undefined })}
          data-testid={`${dataTestId}-back`}
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
      ) : null}
      {heading ? <RailHeading>{heading}</RailHeading> : null}
      {destinations.map((destination) => (
        <RailRow
          key={destination.id}
          label={destination.label}
          icon={destination.icon}
          count={destination.badge}
          active={destination.active === true}
          copy={copy}
          testId={`${dataTestId}-dest-${destination.id}`}
          control={controlProps({ href: destination.href, linkComponent, onClick: () => undefined })}
        />
      ))}
      {primary ? (
        <RailMenu menu={primary} linkComponent={linkComponent} copy={copy} testId={`${dataTestId}-primary`} />
      ) : null}
      {more ? <RailMenu menu={more} linkComponent={linkComponent} copy={copy} testId={`${dataTestId}-more`} /> : null}
    </Box>
  );
}
