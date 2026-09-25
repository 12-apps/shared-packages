import Box from '@mui/material/Box/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { Table } from './Table';
import type { ColumnConfig } from './Table.types';

const meta: Meta<typeof Table> = {
  title: 'Dashboards/Table/Tests',
  component: Table,
  parameters: {
    layout: 'centered',
    chromatic: { disableSnapshot: false },
  },
  tags: ['autodocs', 'test', 'component:Table'],
};

export default meta;
export type Story = StoryObj<typeof meta>;

// Simple test data
const testData = [
  { id: 1, name: 'John Doe', email: 'john@example.com', role: 'Admin' },
  { id: 2, name: 'Jane Smith', email: 'jane@example.com', role: 'User' },
  { id: 3, name: 'Bob Johnson', email: 'bob@example.com', role: 'Editor' },
];

const basicColumns: ColumnConfig[] = [
  { key: 'name', label: 'Name', sortable: true, priority: 1 },
  { key: 'email', label: 'Email', sortable: true, priority: 2 },
  { key: 'role', label: 'Role', sortable: false, priority: 3 },
];

export const BasicInteraction: Story = {
  render: function BasicInteractionTable() {
    const [selectedRows, setSelectedRows] = useState<(string | number)[]>([]);

    return (
      <Box width={600}>
        <Table
          data-testid="basic-table"
          columns={basicColumns}
          data={testData}
          selectable
          selectedRows={selectedRows}
          onSelectionChange={(newSelection) => setSelectedRows(newSelection)}
          variant="default"
        />
      </Box>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = canvas.getByTestId('basic-table');

    // Test table renders
    await expect(table).toBeInTheDocument();

    // Test data is rendered
    await expect(canvas.getByText('John Doe')).toBeInTheDocument();
    await expect(canvas.getByText('jane@example.com')).toBeInTheDocument();
    await expect(canvas.getByText('Bob Johnson')).toBeInTheDocument();

    // Test selection functionality
    const checkboxes = canvas.getAllByRole('checkbox');
    const selectAllCheckbox = checkboxes[0];
    const firstRowCheckbox = checkboxes[1];

    // Initially nothing selected
    await expect(selectAllCheckbox).not.toBeChecked();
    await expect(firstRowCheckbox).not.toBeChecked();

    // Select first row
    await userEvent.click(firstRowCheckbox);
    await expect(firstRowCheckbox).toBeChecked();

    // Select all
    await userEvent.click(selectAllCheckbox);
    await waitFor(() => {
      checkboxes.slice(1).forEach((checkbox) => {
        expect(checkbox).toBeChecked();
      });
      expect(selectAllCheckbox).toBeChecked();
    });
  },
};

export const FormInteraction: Story = {
  render: function FormInteractionTable() {
    const [selectedRows, setSelectedRows] = useState<(string | number)[]>([1]);

    return (
      <Box width={600}>
        <Typography variant="body2" gutterBottom>
          Selected: {selectedRows.join(', ')}
        </Typography>
        <Table
          data-testid="form-table"
          columns={basicColumns}
          data={testData}
          selectable
          selectedRows={selectedRows}
          onSelectionChange={(newSelection) => setSelectedRows(newSelection)}
          variant="striped"
        />
      </Box>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Verify initial selection
    await expect(canvas.getByText('Selected: 1')).toBeInTheDocument();

    // Check that first row checkbox is checked
    const checkboxes = canvas.getAllByRole('checkbox');
    const firstRowCheckbox = checkboxes[1];
    await expect(firstRowCheckbox).toBeChecked();

    // Test select all
    const selectAllCheckbox = checkboxes[0];
    await userEvent.click(selectAllCheckbox);

    await waitFor(() => {
      expect(canvas.getByText(/Selected: 1, 2, 3/)).toBeInTheDocument();
    });
  },
};

export const KeyboardNavigation: Story = {
  render: function KeyboardNavigationTable() {
    return (
      <Box width={600}>
        <Table
          data-testid="keyboard-table"
          columns={basicColumns}
          data={testData}
          selectable
          sortable
          variant="default"
        />
      </Box>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Test Tab navigation
    await userEvent.tab();
    const firstCheckbox = canvas.getAllByRole('checkbox')[0];
    await waitFor(() => expect(firstCheckbox).toHaveFocus());
  },
};

export const ScreenReader: Story = {
  render: function ScreenReaderTable() {
    return (
      <Box width={600}>
        <Table
          data-testid="accessible-table"
          columns={basicColumns}
          data={testData}
          selectable
          variant="default"
          aria-label="User table"
        />
      </Box>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = canvas.getByTestId('accessible-table');

    // Test accessibility attributes
    await expect(table).toHaveAttribute('aria-label', 'User table');

    // Test column headers
    const columnHeaders = canvas.getAllByRole('columnheader');
    expect(columnHeaders.length).toBeGreaterThan(0);
  },
};

export const FocusManagement: Story = {
  render: function FocusManagementTable() {
    return (
      <Box width={600}>
        <button data-testid="before">Before</button>
        <Table
          data-testid="focus-table"
          columns={basicColumns}
          data={testData}
          selectable
          variant="default"
        />
        <button data-testid="after">After</button>
      </Box>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const beforeButton = canvas.getByTestId('before');
    await userEvent.click(beforeButton);

    await userEvent.tab();
    const firstCheckbox = canvas.getAllByRole('checkbox')[0];
    await waitFor(() => expect(firstCheckbox).toHaveFocus());
  },
};

export const ResponsiveDesign: Story = {
  render: function ResponsiveTable() {
    return (
      <Box maxWidth={400}>
        <Table
          data-testid="responsive-table"
          columns={basicColumns}
          data={testData}
          responsive
          variant="glass"
        />
      </Box>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = canvas.getByTestId('responsive-table');

    await expect(table).toBeInTheDocument();
    await expect(canvas.getByText('John Doe')).toBeVisible();
  },
};

export const ThemeVariations: Story = {
  render: function ThemeVariationsTable() {
    return (
      <Box>
        <Table
          data-testid="theme-table"
          columns={basicColumns}
          data={testData}
          variant="default"
        />
      </Box>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = canvas.getByTestId('theme-table');

    await expect(table).toBeVisible();
  },
};

export const VisualStates: Story = {
  render: function VisualStatesTable() {
    return (
      <Box>
        <Table
          data-testid="loading-table"
          columns={basicColumns}
          data={[]}
          loading
          variant="default"
        />
      </Box>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = canvas.getByTestId('loading-table');

    await expect(table).toBeVisible();
    
    const loadingIndicator = canvas.getByTestId('table-loading');
    await expect(loadingIndicator).toBeInTheDocument();
  },
};

export const Performance: Story = {
  render: function PerformanceTable() {
    const data = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      name: `User ${i + 1}`,
      email: `user${i + 1}@example.com`,
      role: 'User',
    }));

    return (
      <Box height={300}>
        <Table
          data-testid="performance-table"
          columns={basicColumns}
          data={data}
          variant="default"
        />
      </Box>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = canvas.getByTestId('performance-table');

    await expect(table).toBeVisible();
    await expect(canvas.getByText('User 1')).toBeInTheDocument();
    await expect(canvas.getByText('User 20')).toBeInTheDocument();
  },
};

export const EdgeCases: Story = {
  render: function EdgeCasesTable() {
    return (
      <Box>
        <Table
          data-testid="empty-table"
          columns={basicColumns}
          data={[]}
          variant="default"
        />
      </Box>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = canvas.getByTestId('empty-table');

    await expect(table).toBeVisible();
    await expect(canvas.getByText('No data available')).toBeVisible();
  },
};

export const Integration: Story = {
  render: function IntegrationTable() {
    const [selectedRows, setSelectedRows] = useState<(string | number)[]>([]);

    return (
      <Box width={600}>
        <Typography variant="body2" gutterBottom>
          Selected: {selectedRows.length} rows
        </Typography>
        <Table
          data-testid="integration-table"
          columns={basicColumns}
          data={testData}
          selectable
          sortable
          selectedRows={selectedRows}
          onSelectionChange={(newSelection) => setSelectedRows(newSelection)}
          variant="default"
        />
      </Box>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = canvas.getByTestId('integration-table');

    await expect(table).toBeVisible();

    // Test selection
    const selectAllCheckbox = canvas.getAllByRole('checkbox')[0];
    await userEvent.click(selectAllCheckbox);

    await waitFor(() => {
      expect(canvas.getByText(/Selected: 3 rows/)).toBeVisible();
    });
  },
};

/**
 * A STICKY HEADER STICKS INSIDE THE TABLE'S OWN SCROLLER (FUT-2677).
 *
 * jsdom has no layout, so this is the one place the actual sticking is
 * checked: `getBoundingClientRect` on the `<thead>` and on the scroller after
 * scrolling, in a real browser. shared-packages CI does not run play
 * functions (FUT-2619) — this is reported by hand in the PR.
 */
// Waiting two animation frames is what the ticket (FUT-2677) asks for:
// `position: sticky` and scroll-anchoring settle across a paint, and jsdom
// cannot fake that — this file only runs in a real browser (Storybook play
// function).
async function waitTwoFrames(): Promise<void> {
  await new Promise<void>((resolve) =>
    // eslint-disable-next-line test-flakiness/no-animation-wait -- see the function comment above: two real frames are the thing under test.
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

/** The `<thead>`'s top sits within 1px of its scroller's — it stuck. */
async function expectHeaderStuckTo(scroller: HTMLElement): Promise<void> {
  // eslint-disable-next-line test-flakiness/no-viewport-dependent -- the bug this checks (FUT-2677) is defined in terms of scroll position: whether the header's rect tracks the scroller's after a scroll.
  scroller.scrollTop = 150;
  scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  await waitTwoFrames();

  const thead = scroller.querySelector('thead')!;
  const headerTop = thead.getBoundingClientRect().top;
  const scrollerTop = scroller.getBoundingClientRect().top;
  await expect(Math.abs(headerTop - scrollerTop)).toBeLessThanOrEqual(1);
}

const stickyRows = Array.from({ length: 60 }, (_, i) => ({
  id: i,
  name: `Row ${i}`,
  email: `row${i}@example.com`,
  role: 'User',
}));

export const StickyHeaderSticks: Story = {
  render: function StickyHeaderSticksTable() {
    return (
      <Box height={300} width={400} data-testid="sticky-header-sticks">
        <Table
          emptyText="Nenhum dado"
          columns={basicColumns}
          data={stickyRows}
          stickyHeader
          variant="striped"
          containerHeight={300}
        />
      </Box>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = canvas.getByRole('table');
    await expectHeaderStuckTo(table.parentElement as HTMLElement);
  },
};

export const AllFeaturesCombinedSticks: Story = {
  render: function AllFeaturesCombinedSticksTable() {
    return (
      <Box height={400} width={500} data-testid="all-features-sticks">
        <Table
          emptyText="Nenhum dado"
          columns={basicColumns}
          data={stickyRows}
          variant="gradient"
          glow
          density="comfortable"
          stickyHeader
          selectable
          sortable
          hoverable
          containerHeight={400}
        />
      </Box>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = canvas.getByRole('table');
    await expectHeaderStuckTo(table.parentElement as HTMLElement);
  },
};

export const VirtualStickyHeaderSticks: Story = {
  render: function VirtualStickyHeaderSticksTable() {
    const virtualData = Array.from({ length: 200 }, (_, i) => ({
      id: i,
      name: `Row ${i}`,
      email: `row${i}@example.com`,
      role: 'User',
    }));

    return (
      <Box width={400} data-testid="virtual-sticky-sticks">
        <Table
          emptyText="Nenhum dado"
          columns={basicColumns}
          data={virtualData}
          virtualScrolling
          stickyHeader
          containerHeight={300}
          overscan={5}
          variant="striped"
        />
      </Box>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = canvas.getByRole('table');
    await expectHeaderStuckTo(table.parentElement as HTMLElement);
  },
};

/**
 * THE VIRTUAL WINDOW IS RE-MEASURED WHEN THE HEADER CHANGES, WITHOUT A SCROLL
 * (FUT-2678).
 *
 * `overflow-anchor: none` turns off the browser's own scroll-anchoring, which
 * would otherwise mask the bug by firing a synthetic `scroll` event whenever
 * the header's height changes. Growing the header should not leave a blank
 * strip at the top of the body area — the `ResizeObserver` re-measures it
 * directly.
 */
export const HeaderResizeRepaints: Story = {
  render: function HeaderResizeRepaintsTable() {
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: i, name: `Row ${i}` }));
    const [tall, setTall] = useState(false);

    return (
      <Box width={400} data-testid="header-resize-repaints">
        <button data-testid="grow-header" onClick={() => setTall(true)}>
          Grow header
        </button>
        <Box
          data-testid="scroller-wrap"
          sx={{ '& .MuiTableContainer-root': { overflowAnchor: 'none' } }}
        >
          <Table
            emptyText="Nenhum dado"
            columns={[{ key: 'name', label: 'Nome' }]}
            data={rows}
            virtualScrolling
            containerHeight={300}
            overscan={0}
            variant="default"
          />
          {tall && (
            <style>{`[data-testid="header-resize-repaints"] thead { height: 452px; display: table-row-group; }`}</style>
          )}
        </Box>
      </Box>
    );
  },
  // What FUT-2678 fixes only shows up at a scroll offset the header's height
  // change can leave stale: the check is inherently about scroll position.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = canvas.getByRole('table');
    const scroller = table.parentElement as HTMLElement;

    // eslint-disable-next-line test-flakiness/no-viewport-dependent -- see the play function comment above.
    scroller.scrollTop = 3000;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    await waitTwoFrames();

    const beforeTop = scroller.getBoundingClientRect().top;
    const firstRowBefore = table.querySelector('tbody tr[aria-hidden]')?.nextElementSibling;
    const beforeGap = firstRowBefore
      ? firstRowBefore.getBoundingClientRect().top - beforeTop
      : 0;

    await userEvent.click(canvas.getByTestId('grow-header'));
    await waitTwoFrames();

    const afterTop = scroller.getBoundingClientRect().top;
    const firstRowAfter = table.querySelector('tbody tr[aria-hidden]')?.nextElementSibling;
    const afterGap = firstRowAfter ? firstRowAfter.getBoundingClientRect().top - afterTop : 0;

    // No blank strip: the first visible data row still starts at (about) the
    // top of the scroller's body area, not 400px into it.
    await expect(Math.abs(afterGap - beforeGap)).toBeLessThanOrEqual(2);
  },
};
