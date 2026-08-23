import { Box } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { useState } from 'react';

import { FilterTrigger } from '../ContentToolbar/FilterTrigger';
import { TableFilter } from './TableFilter';
import type { TableFilterRange } from './TableFilter.types';
import { PT_BR_TABLE_FILTER_COPY } from '../../../pt-BR';

const meta: Meta<typeof TableFilter> = {
  title: 'Dashboards/TableFilter/Tests',
  component: TableFilter,
  parameters: { layout: 'fullscreen', chromatic: { disableSnapshot: false } },
  tags: ['autodocs', 'test', 'component:TableFilter', 'checked'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const CATEGORIES = [
  { value: 'drinks', label: 'Drinks' },
  { value: 'snacks', label: 'Snacks' },
];

function Harness(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [price, setPrice] = useState<TableFilterRange>({});
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 360 }}>
      <FilterTrigger open={open} onOpenChange={setOpen} hasActiveFilters={cats.size > 0} data-testid="funnel" />
      <TableFilter copy={PT_BR_TABLE_FILTER_COPY} open={open} onOpenChange={setOpen} hasActiveFilters={cats.size > 0}>
        <TableFilter.Layout>
          <TableFilter.Main>
            <Box data-testid="main">main</Box>
          </TableFilter.Main>
          <TableFilter.Panel onClearAll={() => setCats(new Set())} clearTestId="clear-all">
            <TableFilter.Section title="Attributes">
              <TableFilter.CheckboxField
                label="Category"
                options={CATEGORIES}
                selected={cats}
                onToggle={(value, checked) =>
                  setCats((prev) => {
                    const next = new Set(prev);
                    if (checked) next.add(value);
                    else next.delete(value);
                    return next;
                  })
                }
                testId="cat-field"
              />
              <TableFilter.RangeField label="Price" value={price} onChange={setPrice} testId="price-range" />
            </TableFilter.Section>
          </TableFilter.Panel>
        </TableFilter.Layout>
      </TableFilter>
    </Box>
  );
}

export const OpenPanelAndFilter: Story = {
  name: '🧪 Funnel opens panel; checkbox + range work',
  render: () => <Harness />,
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step('Funnel toggles the panel open', async () => {
      await expect(canvas.getByTestId('funnel')).toHaveAttribute('aria-expanded', 'false');
      await userEvent.click(canvas.getByTestId('funnel'));
      await waitFor(() => expect(canvas.getByTestId('funnel')).toHaveAttribute('aria-expanded', 'true'));
    });
    await step('Toggle a category checkbox', async () => {
      const drinks = canvas.getByTestId('cat-field-drinks').querySelector('input')!;
      await userEvent.click(drinks);
      await waitFor(() => expect(drinks).toBeChecked());
    });
    await step('Type a min price', async () => {
      const min = canvas.getByTestId('price-range-min');
      await userEvent.type(min, '10');
      await waitFor(() => expect(min).toHaveValue(10));
    });
    await step('Clear All Filters resets the checkbox', async () => {
      await userEvent.click(canvas.getByTestId('clear-all'));
      await waitFor(() => expect(canvas.getByTestId('cat-field-drinks').querySelector('input')).not.toBeChecked());
    });
  },
};
