import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { Dashboard, markDashboardSlot } from './Dashboard';

const meta: Meta<typeof Dashboard> = {
  title: 'Dashboards/Dashboard/Tests',
  component: Dashboard,
  parameters: {
    layout: 'padded',
    chromatic: { disableSnapshot: false },
  },
  tags: ['autodocs', 'test', 'component:Dashboard', 'checked'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const body = <Box data-testid="content">content</Box>;

/** Full composition reused across tests. */
const Composed = ({ onExport = fn() }: { onExport?: (id: string) => void }) => (
  <Dashboard activeFilterCount={2}>
    <Dashboard.Breadcrumb items={[{ label: 'Admin', href: '#' }, { label: 'Products' }]} />
    <Dashboard.Header title="Products">
      <Dashboard.Info title="About Products">Manage your catalog.</Dashboard.Info>
      <Dashboard.FilterToggle />
      <Dashboard.Settings title="Product settings">
        <Typography>In development.</Typography>
      </Dashboard.Settings>
      <Dashboard.Spacer />
      <Dashboard.Export onExport={onExport} />
      <Dashboard.Action>
        <Button variant="contained">New product</Button>
      </Dashboard.Action>
    </Dashboard.Header>
    <Dashboard.Filters>
      <TextField size="small" placeholder="Search…" fullWidth inputProps={{ 'data-testid': 'search' }} />
      <Dashboard.MoreFilters>
        <TextField size="small" label="Min price" type="number" />
      </Dashboard.MoreFilters>
    </Dashboard.Filters>
    <Dashboard.Body>{body}</Dashboard.Body>
  </Dashboard>
);

export const FilterToggleInteraction: Story = {
  name: '🧪 Filter toggle shows/hides filters',
  render: () => <Composed />,
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step('Filters visible by default', async () => {
      await expect(canvas.getByTestId('search')).toBeVisible();
    });
    await step('Toggle hides the filter region', async () => {
      await userEvent.click(canvas.getByTestId('dashboard-filter-toggle'));
      await waitFor(() => expect(canvas.queryByTestId('search')).not.toBeInTheDocument());
    });
    await step('Toggle again restores it', async () => {
      await userEvent.click(canvas.getByTestId('dashboard-filter-toggle'));
      await waitFor(() => expect(canvas.getByTestId('search')).toBeVisible());
    });
  },
};

export const InfoPopover: Story = {
  name: '🧪 Info popover opens',
  render: () => <Composed />,
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step('Open the info popover', async () => {
      await userEvent.click(canvas.getByTestId('dashboard-info-trigger'));
      await waitFor(() => expect(within(document.body).getByText('About Products')).toBeVisible());
    });
  },
};

export const SettingsDialog: Story = {
  name: '🧪 Settings gear opens dialog',
  render: () => <Composed />,
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step('Open the settings dialog', async () => {
      await userEvent.click(canvas.getByTestId('dashboard-settings-trigger'));
      await waitFor(() => expect(within(document.body).getByText('In development.')).toBeVisible());
    });
  },
};

export const SettingsLink: Story = {
  name: '🧪 Settings gear links to a settings route (no dialog)',
  render: () => (
    <Dashboard>
      <Dashboard.Header title="Estoque">
        <Dashboard.Settings ariaLabel="Configurações de estoque" href="/admin/acme/config/inventory" />
      </Dashboard.Header>
      <Dashboard.Body>{body}</Dashboard.Body>
    </Dashboard>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step('Gear renders as an anchor pointing at the config route', async () => {
      const gear = canvas.getByTestId('dashboard-settings-trigger');
      await expect(gear.tagName).toBe('A');
      await expect(gear).toHaveAttribute('href', '/admin/acme/config/inventory');
    });
    await step('Clicking it opens no dialog', async () => {
      await userEvent.click(canvas.getByTestId('dashboard-settings-trigger'));
      await expect(canvas.queryAllByTestId('dashboard-settings-dialog')).toHaveLength(0);
    });
  },
};

export const ExportMenu: Story = {
  name: '🧪 Export menu invokes handler',
  render: () => {
    const onExport = fn();
    return <Composed onExport={onExport} />;
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step('Open export menu and choose CSV', async () => {
      await userEvent.click(canvas.getByTestId('dashboard-export-trigger'));
      await waitFor(() => expect(within(document.body).getByTestId('dashboard-export-csv')).toBeVisible());
      await userEvent.click(within(document.body).getByTestId('dashboard-export-csv'));
    });
  },
};

export const MoreFiltersExpands: Story = {
  name: '🧪 More filters expands advanced panel',
  render: () => <Composed />,
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step('Expand advanced filters', async () => {
      await userEvent.click(canvas.getByTestId('dashboard-more-filters-toggle'));
      await waitFor(() => expect(canvas.getByLabelText('Min price')).toBeVisible());
    });
  },
};

export const OrderIndependentRendering: Story = {
  name: '🧪 Renders in slot order regardless of authoring order',
  render: () => (
    <Dashboard>
      <Dashboard.Body>{body}</Dashboard.Body>
      <Dashboard.Header title="Reordered" />
      <Dashboard.Breadcrumb items={[{ label: 'Admin', href: '#' }, { label: 'Reordered' }]} />
    </Dashboard>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step('Breadcrumb renders before header, header before body', async () => {
      const breadcrumb = canvas.getByTestId('dashboard-breadcrumb');
      const header = canvas.getByTestId('dashboard-header');
      const content = canvas.getByTestId('dashboard-body');
      const bcBeforeHeader = breadcrumb.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING;
      const headerBeforeBody = header.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING;
      await expect(Boolean(bcBeforeHeader)).toBe(true);
      await expect(Boolean(headerBeforeBody)).toBe(true);
    });
  },
};

/** A page-owned wrapper around `<Dashboard.Header>`, tagged with its slot. */
const WrappedHeader = markDashboardSlot(
  ({ title }: { title: string }) => <Dashboard.Header title={title} />,
  'header',
);

export const MarkedWrapperKeepsHeaderAboveBody: Story = {
  name: '🧪 A slot-marked header wrapper still renders above the body',
  render: () => (
    <Dashboard>
      <Dashboard.Breadcrumb items={[{ label: 'Admin', href: '#' }, { label: 'Wrapped' }]} />
      <WrappedHeader title="Wrapped" />
      <Dashboard.Body>{body}</Dashboard.Body>
    </Dashboard>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step('Wrapped header sits above the body, not below it', async () => {
      const header = canvas.getByTestId('dashboard-header');
      const content = canvas.getByTestId('dashboard-body');
      const headerBeforeBody = header.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING;
      await expect(Boolean(headerBeforeBody)).toBe(true);
    });
  },
};
