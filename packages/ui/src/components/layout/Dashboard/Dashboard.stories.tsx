import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@mui/material/Box/index.js';
import Button from '@mui/material/Button/index.js';
import TextField from '@mui/material/TextField/index.js';
import Typography from '@mui/material/Typography/index.js';
import { fn } from 'storybook/test';

import { Dashboard } from './Dashboard';

const meta: Meta<typeof Dashboard> = {
  title: 'Dashboards/Dashboard',
  component: Dashboard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Composable page shell. `<Dashboard>` is a context provider; every part — `Dashboard.Header`, `Dashboard.Breadcrumb`, `Dashboard.Filters`, `Dashboard.Info`, `Dashboard.FilterToggle`, `Dashboard.Settings`, `Dashboard.Export`, `Dashboard.MoreFilters`, `Dashboard.Body` — is opt-in. Compose only what you need; authoring order does not matter, parts render in a fixed slot order.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const table = (
  <Box sx={{ p: 4, borderRadius: 1, border: '1px dashed', borderColor: 'divider', textAlign: 'center', color: 'text.secondary' }}>
    Your table / grid goes here
  </Box>
);

export const FullComposition: Story = {
  args: { activeFilterCount: 2 },
  render: (args) => (
    <Dashboard {...args}>
      <Dashboard.Breadcrumb items={[{ label: 'Admin', href: '#' }, { label: 'Products' }]} />
      <Dashboard.Header title="Products">
        <Dashboard.Info title="About Products">
          Manage your catalog: create products, set prices, and control stock visibility.
        </Dashboard.Info>
        <Dashboard.FilterToggle />
        <Dashboard.Settings title="Product settings">
          <Typography>In development — coming in the next version.</Typography>
        </Dashboard.Settings>
        <Dashboard.Spacer />
        <Dashboard.Export onExport={fn()} />
        <Dashboard.Action>
          <Button variant="contained">New product</Button>
        </Dashboard.Action>
      </Dashboard.Header>
      <Dashboard.Filters>
        <TextField size="small" placeholder="Search across all columns…" fullWidth />
        <Dashboard.MoreFilters>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField size="small" label="Min price" type="number" />
            <TextField size="small" label="Max price" type="number" />
          </Box>
        </Dashboard.MoreFilters>
      </Dashboard.Filters>
      <Dashboard.Body>{table}</Dashboard.Body>
    </Dashboard>
  ),
};

export const HeaderOnly: Story = {
  render: () => (
    <Dashboard>
      <Dashboard.Header title="Simple page">
        <Dashboard.Action>
          <Button variant="contained">Primary action</Button>
        </Dashboard.Action>
      </Dashboard.Header>
      <Dashboard.Body>{table}</Dashboard.Body>
    </Dashboard>
  ),
};

export const WithoutFilters: Story = {
  render: () => (
    <Dashboard>
      <Dashboard.Breadcrumb items={[{ label: 'Admin', href: '#' }, { label: 'Team' }]} />
      <Dashboard.Header title="Team">
        <Dashboard.Info>Invite teammates and manage their roles.</Dashboard.Info>
      </Dashboard.Header>
      <Dashboard.Body>{table}</Dashboard.Body>
    </Dashboard>
  ),
};

export const OrderIndependent: Story = {
  name: 'Order-independent authoring',
  render: () => (
    <Dashboard>
      {/* Deliberately authored out of order — still renders breadcrumb → header → filters → body. */}
      <Dashboard.Body>{table}</Dashboard.Body>
      <Dashboard.Filters>
        <TextField size="small" placeholder="Search…" fullWidth />
      </Dashboard.Filters>
      <Dashboard.Header title="Reordered">
        <Dashboard.FilterToggle />
      </Dashboard.Header>
      <Dashboard.Breadcrumb items={[{ label: 'Admin', href: '#' }, { label: 'Reordered' }]} />
    </Dashboard>
  ),
};
