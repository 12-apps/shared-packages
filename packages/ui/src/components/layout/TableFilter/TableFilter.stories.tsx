import { Box, Typography } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { FilterTrigger } from '../ContentToolbar/FilterTrigger';
import { TableFilter } from './TableFilter';
import type { TableFilterRange } from './TableFilter.types';

const meta: Meta<typeof TableFilter> = {
  title: 'Dashboards/TableFilter',
  component: TableFilter,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Compound filter-panel system (MUI port of the reference `TableFilter`). A `Panel` slides in from the right beside `Main`; compose it from `Keyword`, `Section`, `CheckboxField`, and `RangeField`. Pair the funnel `FilterTrigger` with the same open state.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const CATEGORIES = [
  { value: 'drinks', label: 'Drinks', count: 12 },
  { value: 'snacks', label: 'Snacks', count: 7 },
  { value: 'cleaning', label: 'Cleaning', count: 3 },
];

export const Default: Story = {
  render: () => {
    const [open, setOpen] = useState(true);
    const [keyword, setKeyword] = useState('');
    const [cats, setCats] = useState<Set<string>>(new Set(['drinks']));
    const [price, setPrice] = useState<TableFilterRange>({});
    const active = keyword !== '' || cats.size > 0 || price.min != null || price.max != null;

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: 420, border: 1, borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="h6">Products</Typography>
          <FilterTrigger open={open} onOpenChange={setOpen} hasActiveFilters={active} />
        </Box>
        <TableFilter open={open} onOpenChange={setOpen} hasActiveFilters={active}>
          <TableFilter.Layout>
            <TableFilter.Main>
              <Box sx={{ p: 2, color: 'text.secondary' }}>Table / grid content…</Box>
            </TableFilter.Main>
            <TableFilter.Panel
              onClearAll={() => {
                setKeyword('');
                setCats(new Set());
                setPrice({});
              }}
            >
              <TableFilter.Keyword value={keyword} onChange={setKeyword} />
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
                />
                <TableFilter.RangeField label="Price" unit="R$" step={0.01} value={price} onChange={setPrice} />
              </TableFilter.Section>
            </TableFilter.Panel>
          </TableFilter.Layout>
        </TableFilter>
      </Box>
    );
  },
};
