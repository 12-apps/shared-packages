import Box from '@mui/material/Box/index.js';
import Button from '@mui/material/Button/index.js';
import TextField from '@mui/material/TextField/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ReactNode, useState } from 'react';
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

/**
 * Keeps a link's click inside the story, and records where it was going.
 *
 * In link mode the gear is a real `<a href>`, and test-storybook plays every
 * story of a file in ONE page. Followed, the click navigated that page to
 * `/admin/acme/config/inventory`, off Storybook: the story itself still passed
 * (its assertions ran first), and the stories after it failed on
 * `ReferenceError: __test is not defined` whenever the navigation landed before
 * they started (FUT-2619). The runner's helper had left with the old page.
 *
 * Capture phase on a wrapper, so the component and its own handlers are
 * untouched: only the browser's default action (following the link) is
 * cancelled, and the target it would have followed is printed for the play
 * function to assert.
 */
const StayInStory = ({ children }: { children: ReactNode }) => {
  const [followed, setFollowed] = useState('');
  return (
    <Box
      onClickCapture={(event) => {
        const link = (event.target as Element).closest('a[href]');
        if (!link) return;
        event.preventDefault();
        setFollowed(link.getAttribute('href') ?? '');
      }}
    >
      {children}
      <output data-testid="followed-link">{followed}</output>
    </Box>
  );
};

export const SettingsLink: Story = {
  name: '🧪 Settings gear links to a settings route (no dialog)',
  render: () => (
    <StayInStory>
      <Dashboard>
        <Dashboard.Header title="Estoque">
          <Dashboard.Settings ariaLabel="Configurações de estoque" href="/admin/acme/config/inventory" />
        </Dashboard.Header>
        <Dashboard.Body>{body}</Dashboard.Body>
      </Dashboard>
    </StayInStory>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step('Gear renders as an anchor pointing at the config route', async () => {
      const gear = canvas.getByTestId('dashboard-settings-trigger');
      await expect(gear.tagName).toBe('A');
      await expect(gear).toHaveAttribute('href', '/admin/acme/config/inventory');
    });
    await step('Clicking it follows the link and opens no dialog', async () => {
      const page = canvasElement.ownerDocument.defaultView?.location.pathname;
      await userEvent.click(canvas.getByTestId('dashboard-settings-trigger'));
      // The click reached the anchor and would have gone to the config route…
      await expect(canvas.getByTestId('followed-link')).toHaveTextContent('/admin/acme/config/inventory');
      // …and the page it would have left is still this story.
      await expect(canvasElement.ownerDocument.defaultView?.location.pathname).toBe(page);
      // The dialog-mode gear's dialog renders into document.body, a portal the
      // canvas never contains, and not in the same tick as the click. So look
      // THERE, and give it the window `SettingsDialog` above gives the real one
      // to appear (`waitFor`'s default): the wait must run out without it.
      await expect(
        waitFor(() => expect(within(document.body).getByTestId('dashboard-settings-dialog')).toBeInTheDocument()),
      ).rejects.toThrow();
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
