import {
  LanguageOutlined,
  LockOutlined,
  NotificationsOutlined,
  PaletteOutlined,
  PaymentOutlined,
  PersonOutlined,
} from '@mui/icons-material';
import { Box, Stack, Typography } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useState } from 'react';

import { SettingsLayout } from './SettingsLayout';
import type { SettingsNavGroup } from './SettingsLayout.types';

const GROUPS: SettingsNavGroup[] = [
  {
    id: 'account',
    label: 'Account',
    items: [
      { id: 'profile', label: 'Profile', icon: <PersonOutlined fontSize="small" /> },
      {
        id: 'security',
        label: 'Security',
        icon: <LockOutlined fontSize="small" />,
        keywords: ['password', 'two-factor', '2fa'],
      },
      {
        id: 'notifications',
        label: 'Notifications',
        icon: <NotificationsOutlined fontSize="small" />,
      },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    description: 'Preferences that apply to this workspace only.',
    items: [
      { id: 'appearance', label: 'Appearance', icon: <PaletteOutlined fontSize="small" /> },
      {
        id: 'billing',
        label: 'Billing',
        icon: <PaymentOutlined fontSize="small" />,
        keywords: ['invoice', 'plan', 'payment'],
      },
    ],
  },
  {
    id: 'advanced',
    label: 'Advanced',
    items: [
      { id: 'language', label: 'Language & region', icon: <LanguageOutlined fontSize="small" /> },
    ],
  },
];

const ALL_ITEMS = GROUPS.flatMap((group) => group.items);

/** A minimal example panel that reflects the selected item. */
function ExamplePanel({ itemId }: { itemId: string }): React.JSX.Element {
  const item = ALL_ITEMS.find((candidate) => candidate.id === itemId) ?? ALL_ITEMS[0];
  return (
    <Stack spacing={1} sx={{ p: 1 }}>
      <Typography variant="h6">{item?.label}</Typography>
      <Typography variant="body2" color="text.secondary">
        This central panel renders a custom screen for “{item?.label}”. In a real app each item
        maps to its own route/component.
      </Typography>
      <Box
        sx={{
          mt: 1,
          height: 160,
          borderRadius: 1,
          border: (theme) => `1px dashed ${theme.palette.divider}`,
        }}
      />
    </Stack>
  );
}

const meta: Meta<typeof SettingsLayout> = {
  title: 'Layout/SettingsLayout',
  component: SettingsLayout,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs', 'component:SettingsLayout'],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Controlled example: clicking a rail item swaps the central panel. */
export const Default: Story = {
  render: () => {
    const InteractiveSettings = (): React.JSX.Element => {
      const [active, setActive] = useState('profile');
      return (
        <Box sx={{ p: 3, minHeight: 480 }}>
          <SettingsLayout
            title="Settings"
            searchPlaceholder="Search settings"
            groups={GROUPS}
            activeItemId={active}
            onSelectItem={setActive}
          >
            <ExamplePanel itemId={active} />
          </SettingsLayout>
        </Box>
      );
    };
    return <InteractiveSettings />;
  },
};

/** Group headers can carry a one-line description (Facebook-style). */
export const WithDescriptions: Story = {
  render: () => (
    <Box sx={{ p: 3, minHeight: 480 }}>
      <SettingsLayout title="Settings" groups={GROUPS} activeItemId="billing">
        <ExamplePanel itemId="billing" />
      </SettingsLayout>
    </Box>
  ),
};

/** A single group renders as a flat list under the search field. */
export const FlatSingleGroup: Story = {
  render: () => (
    <Box sx={{ p: 3, minHeight: 480 }}>
      <SettingsLayout
        title="Settings"
        groups={[{ id: 'all', label: 'All settings', items: ALL_ITEMS }]}
        activeItemId="profile"
      >
        <ExamplePanel itemId="profile" />
      </SettingsLayout>
    </Box>
  ),
};

/** Items with `href` + a `linkComponent` render as navigation links. */
export const AsLinks: Story = {
  render: () => {
    const linkedGroups: SettingsNavGroup[] = GROUPS.map((group) => ({
      ...group,
      items: group.items.map((item) => ({ ...item, href: `#/settings/${item.id}` })),
    }));
    return (
      <Box sx={{ p: 3, minHeight: 480 }}>
        <SettingsLayout
          title="Settings"
          groups={linkedGroups}
          activeItemId="security"
          linkComponent="a"
        >
          <ExamplePanel itemId="security" />
        </SettingsLayout>
      </Box>
    );
  },
};

/** Items without icons still align cleanly. */
export const NoIcons: Story = {
  render: () => {
    const plainGroups: SettingsNavGroup[] = GROUPS.map((group) => ({
      ...group,
      items: group.items.map(({ icon: _icon, ...rest }) => rest),
    }));
    return (
      <Box sx={{ p: 3, minHeight: 480 }}>
        <SettingsLayout title="Settings" groups={plainGroups} activeItemId="appearance">
          <ExamplePanel itemId="appearance" />
        </SettingsLayout>
      </Box>
    );
  },
};

/** Below `md` the rail stacks full-width above the panel. */
export const Responsive: Story = {
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
  render: () => (
    <Box sx={{ p: 2, minHeight: 480 }}>
      <SettingsLayout title="Settings" groups={GROUPS} activeItemId="profile">
        <ExamplePanel itemId="profile" />
      </SettingsLayout>
    </Box>
  ),
};
