import AddIcon from '@mui/icons-material/Add';
import AppsIcon from '@mui/icons-material/Apps';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import DeliveryDiningOutlinedIcon from '@mui/icons-material/DeliveryDiningOutlined';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import RoomServiceOutlinedIcon from '@mui/icons-material/RoomServiceOutlined';
import ShoppingBagOutlinedIcon from '@mui/icons-material/ShoppingBagOutlined';
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined';
import TableRestaurantOutlinedIcon from '@mui/icons-material/TableRestaurantOutlined';
import Box from '@mui/material/Box/index.js';
import React from 'react';

import { sxRem } from '../../../../tokens/scales';

import type { SectionNavAction, SectionNavDestination, SectionNavMenu } from '../SectionNav.types';

/**
 * The stories' example section, shared by the showcase and the interaction
 * tests. Kept out of the `*.stories.tsx` files because Storybook reads every
 * named export there as a story.
 */

/** A restaurant's shift, as the example section: the floor, the board, the waiter's round. */
export const DESTINATIONS: SectionNavDestination[] = [
  { id: 'floor', label: 'Floor', icon: <GridViewOutlinedIcon />, href: '#floor' },
  { id: 'board', label: 'Board', icon: <DashboardOutlinedIcon />, href: '#board', badge: 3, active: true },
  { id: 'serve', label: 'Serve', icon: <TableRestaurantOutlinedIcon />, href: '#serve', badge: 2 },
];

export const PRIMARY: SectionNavMenu = {
  label: 'Create',
  icon: <AddIcon />,
  title: 'Create now',
  groups: [
    {
      id: 'order',
      title: 'New order',
      layout: 'grid',
      entries: [
        { id: 'delivery', label: 'Delivery', icon: <DeliveryDiningOutlinedIcon />, onSelect: () => undefined },
        { id: 'pickup', label: 'Pickup', icon: <ShoppingBagOutlinedIcon />, onSelect: () => undefined },
        { id: 'counter', label: 'Counter', icon: <StorefrontOutlinedIcon />, onSelect: () => undefined },
      ],
    },
    {
      id: 'menu',
      title: 'Menu',
      entries: [
        {
          id: 'pause',
          label: 'Pause an item',
          description: 'Take it off sale until it is back',
          icon: <PauseCircleOutlineIcon />,
          onSelect: () => undefined,
        },
      ],
    },
  ],
};

export const MORE: SectionNavMenu = {
  label: 'More',
  icon: <AppsIcon />,
  title: 'More',
  groups: [
    {
      id: 'rest',
      layout: 'grid',
      entries: [
        { id: 'queue', label: 'Queue', icon: <GroupsOutlinedIcon />, href: '#queue', badge: 1 },
        { id: 'pass', label: 'Pass', icon: <RoomServiceOutlinedIcon />, href: '#pass' },
        { id: 'runs', label: 'Deliveries', icon: <DeliveryDiningOutlinedIcon />, href: '#runs' },
        { id: 'booked', label: 'Bookings', icon: <CalendarMonthOutlinedIcon />, href: '#booked' },
        { id: 'orders', label: 'Orders', icon: <ReceiptLongOutlinedIcon />, href: '#orders' },
      ],
    },
  ],
};

/** A phone-sized frame with the bar at its foot, the way a host docks it. */
export function PhoneFrame({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <Box
      sx={{
        width: sxRem(360),
        maxWidth: '100%',
        height: sxRem(640),
        display: 'flex',
        flexDirection: 'column',
        border: 1,
        borderColor: 'divider',
        borderRadius: 3,
        overflow: 'hidden',
        bgcolor: 'background.default',
      }}
    >
      <Box sx={{ flex: 1, p: 2 }} />
      {children}
    </Box>
  );
}


/** A desktop-column-sized frame for the rail. */
export function RailFrame({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Box sx={{ width: sxRem(240), height: sxRem(560), border: 1, borderColor: 'divider' }}>{children}</Box>;
}

/**
 * A screen's ACTIONS pinned at its foot — the same bar, drawn with verbs: a
 * bill being settled, one person at a time.
 *
 * `split` is DIMMED — it cannot be done yet, and a tap still reaches the host
 * so it can say why. `equal` is a TOGGLE that is on: `aria-pressed`, never
 * `aria-current`, because an action is not a page.
 */
export const ACTIONS: SectionNavDestination[] = [
  { id: 'split', label: 'Split', icon: <ReceiptLongOutlinedIcon />, onSelect: () => undefined, dimmed: true },
  { id: 'equal', label: 'Equally', icon: <GroupsOutlinedIcon />, onSelect: () => undefined, active: true },
  { id: 'person', label: 'Person', icon: <AddIcon />, onSelect: () => undefined },
];

export const PAY_ALL: SectionNavAction = {
  label: 'Pay all',
  icon: <StorefrontOutlinedIcon />,
  onSelect: () => undefined,
};
