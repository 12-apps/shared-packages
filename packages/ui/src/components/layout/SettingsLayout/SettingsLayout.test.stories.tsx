import { Typography } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { SettingsLayout } from './SettingsLayout';
import type { SettingsNavGroup } from './SettingsLayout.types';

const GROUPS: SettingsNavGroup[] = [
  {
    id: 'account',
    label: 'Account',
    items: [
      { id: 'profile', label: 'Profile' },
      { id: 'security', label: 'Security', keywords: ['password', '2fa'] },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    description: 'Workspace-only preferences.',
    items: [{ id: 'billing', label: 'Billing' }],
  },
];

const meta: Meta<typeof SettingsLayout> = {
  title: 'Layout/SettingsLayout/Tests',
  component: SettingsLayout,
  parameters: {
    layout: 'fullscreen',
    chromatic: { disableSnapshot: false },
  },
  tags: ['autodocs', 'test', 'component:SettingsLayout'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const panel = <Typography data-testid="demo-panel">Panel content</Typography>;

export const StructureRender: Story = {
  name: '🧪 Structure Render Test',
  render: () => (
    <SettingsLayout title="Settings" groups={GROUPS} activeItemId="profile">
      {panel}
    </SettingsLayout>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Rail, search, groups and panel render', async () => {
      await expect(canvas.getByTestId('settings-rail')).toBeInTheDocument();
      await expect(canvas.getByTestId('settings-search')).toBeInTheDocument();
      await expect(canvas.getByTestId('settings-group-account')).toBeInTheDocument();
      await expect(canvas.getByTestId('settings-group-workspace')).toBeInTheDocument();
      await expect(canvas.getByTestId('settings-item-profile')).toBeInTheDocument();
      await expect(canvas.getByTestId('settings-panel')).toBeInTheDocument();
      await expect(canvas.getByTestId('demo-panel')).toBeInTheDocument();
    });
  },
};

export const ActiveHighlight: Story = {
  name: '🎯 Active Item Highlight Test',
  render: () => (
    <SettingsLayout title="Settings" groups={GROUPS} activeItemId="security">
      {panel}
    </SettingsLayout>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Active item carries aria-current=page', async () => {
      const active = canvas.getByTestId('settings-item-security');
      await expect(active).toHaveAttribute('aria-current', 'page');
      const inactive = canvas.getByTestId('settings-item-profile');
      await expect(inactive).not.toHaveAttribute('aria-current');
    });
  },
};

export const SelectionCallback: Story = {
  name: '🖱️ Selection Callback Test',
  args: { onSelectItem: fn() },
  render: (args) => (
    <SettingsLayout title="Settings" groups={GROUPS} activeItemId="profile" {...args}>
      {panel}
    </SettingsLayout>
  ),
  play: async ({ canvasElement, step, args }) => {
    const canvas = within(canvasElement);

    await step('Clicking a button item fires onSelectItem with its id', async () => {
      await userEvent.click(canvas.getByTestId('settings-item-billing'));
      await expect(args.onSelectItem).toHaveBeenCalledWith('billing');
    });
  },
};

export const SearchFilters: Story = {
  name: '🔎 Search Filter Test',
  render: () => (
    <SettingsLayout title="Settings" groups={GROUPS} activeItemId="profile">
      {panel}
    </SettingsLayout>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const search = canvas.getByTestId('settings-search').querySelector('input');

    await step('Typing a label narrows the rail', async () => {
      await userEvent.type(search as HTMLInputElement, 'secur');
      await expect(canvas.getByTestId('settings-item-security')).toBeInTheDocument();
      await waitFor(() => {
        expect(canvas.queryByTestId('settings-item-profile')).not.toBeInTheDocument();
        expect(canvas.queryByTestId('settings-group-workspace')).not.toBeInTheDocument();
      });
    });

    await step('Keywords are matched too', async () => {
      await userEvent.clear(search as HTMLInputElement);
      await userEvent.type(search as HTMLInputElement, 'password');
      await expect(canvas.getByTestId('settings-item-security')).toBeInTheDocument();
    });

    await step('No match shows the empty state', async () => {
      await userEvent.clear(search as HTMLInputElement);
      await userEvent.type(search as HTMLInputElement, 'zzzzz');
      await expect(canvas.getByTestId('settings-empty')).toBeInTheDocument();
    });
  },
};

export const LinkMode: Story = {
  name: '🔗 Link Mode Test',
  render: () => {
    const linked: SettingsNavGroup[] = GROUPS.map((group) => ({
      ...group,
      items: group.items.map((item) => ({ ...item, href: `#/settings/${item.id}` })),
    }));
    return (
      <SettingsLayout title="Settings" groups={linked} activeItemId="profile" linkComponent="a">
        {panel}
      </SettingsLayout>
    );
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Items with href render as anchors', async () => {
      const item = canvas.getByTestId('settings-item-security');
      await expect(item.tagName.toLowerCase()).toBe('a');
      await expect(item).toHaveAttribute('href', '#/settings/security');
    });
  },
};

export const KeyboardNavigation: Story = {
  name: '⌨️ Keyboard Navigation Test',
  render: () => (
    <SettingsLayout title="Settings" groups={GROUPS} activeItemId="profile">
      {panel}
    </SettingsLayout>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Search field is focusable and typeable', async () => {
      const input = canvas.getByTestId('settings-search').querySelector('input') as HTMLInputElement;
      await userEvent.click(input);
      await waitFor(() => expect(input).toHaveFocus());
      await userEvent.keyboard('pro');
      await expect(canvas.getByTestId('settings-item-profile')).toBeInTheDocument();
    });
  },
};
