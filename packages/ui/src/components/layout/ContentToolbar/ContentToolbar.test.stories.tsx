import { Box } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { useState } from 'react';

import { ContentToolbar } from './ContentToolbar';
import { FilterTrigger } from './FilterTrigger';
import { MultiSelectDropdown } from './MultiSelectDropdown';
import { SortByDropdown } from './SortByDropdown';
import type { SortFieldDefinition } from './ContentToolbar.types';

const meta: Meta<typeof ContentToolbar> = {
  title: 'Layout/ContentToolbar/Tests',
  component: ContentToolbar,
  parameters: { layout: 'padded', chromatic: { disableSnapshot: false } },
  tags: ['autodocs', 'test', 'component:ContentToolbar', 'checked'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const SORT_FIELDS: SortFieldDefinition[] = [
  {
    value: 'name',
    label: 'Name',
    orderOptions: [
      { value: 'asc', label: 'A–Z' },
      { value: 'desc', label: 'Z–A' },
    ],
  },
  { value: 'modified', label: 'Modified', showOrderInTrigger: false },
];

const CONTENT_TYPES = [
  { value: 'workbooks', label: 'Workbooks', count: 12 },
  { value: 'views', label: 'Views', count: 8 },
];

export const SelectAndClear: Story = {
  name: '🧪 Select All → selection chrome → Clear All',
  render: () => {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    return (
      <ContentToolbar
        hasSelection={selected.size > 0}
        selectedCount={selected.size}
        selectAll={() => setSelected(new Set(['a', 'b', 'c']))}
        clearSelection={() => setSelected(new Set())}
        selectAllTestId="t-select-all"
        clearAllTestId="t-clear-all"
        rightControls={<Box data-testid="right-slot">right</Box>}
      />
    );
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step('No selection: no count indicator', async () => {
      await waitFor(() => expect(canvas.queryByTestId('selected-count-indicator')).not.toBeInTheDocument());
    });
    await step('Select All shows count + Clear All', async () => {
      await userEvent.click(canvas.getByTestId('t-select-all'));
      await waitFor(() => expect(canvas.getByTestId('selected-count-indicator')).toHaveTextContent('3 items selected'));
      await expect(canvas.getByTestId('t-clear-all')).toBeVisible();
    });
    await step('Clear All resets', async () => {
      await userEvent.click(canvas.getByTestId('t-clear-all'));
      await waitFor(() => expect(canvas.queryByTestId('selected-count-indicator')).not.toBeInTheDocument());
    });
  },
};

export const SortByInteraction: Story = {
  name: '🧪 Sort By opens and changes field',
  render: () => {
    const onField = fn();
    const [field, setField] = useState('name');
    return (
      <ContentToolbar
        hasSelection={false}
        selectedCount={0}
        selectAll={fn()}
        clearSelection={fn()}
        rightControls={
          <SortByDropdown
            fields={SORT_FIELDS}
            activeField={field}
            activeOrder="asc"
            onFieldChange={(value) => {
              onField(value);
              setField(value);
            }}
            onOrderChange={fn()}
            data-testid="sort-trigger"
          />
        }
      />
    );
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step('Open the Sort By menu', async () => {
      await userEvent.click(canvas.getByTestId('sort-trigger'));
      await waitFor(() => expect(within(document.body).getByTestId('sort-modified-option')).toBeVisible());
    });
    await step('Pick Modified', async () => {
      await userEvent.click(within(document.body).getByTestId('sort-modified-option'));
      await waitFor(() => expect(canvas.getByTestId('sort-trigger')).toHaveTextContent('Modified'));
    });
  },
};

export const ContentTypeMultiSelect: Story = {
  name: '🧪 Content Type toggles stay open',
  render: () => {
    const [types, setTypes] = useState<Set<string>>(new Set());
    return (
      <ContentToolbar
        hasSelection={false}
        selectedCount={0}
        selectAll={fn()}
        clearSelection={fn()}
        rightControls={
          <MultiSelectDropdown
            label="Content Type"
            options={CONTENT_TYPES}
            selected={types}
            onToggle={(value, checked) =>
              setTypes((prev) => {
                const next = new Set(prev);
                if (checked) next.add(value);
                else next.delete(value);
                return next;
              })
            }
            onClear={() => setTypes(new Set())}
            data-testid="content-type-trigger"
          />
        }
      />
    );
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    await step('Open and select one type; menu stays open; trigger reflects it', async () => {
      await userEvent.click(canvas.getByTestId('content-type-trigger'));
      await waitFor(() => expect(body.getByText('Workbooks')).toBeVisible());
      await userEvent.click(body.getByText('Workbooks'));
      await waitFor(() => expect(canvas.getByTestId('content-type-trigger')).toHaveTextContent('Workbooks'));
      // Menu is still open (multi-select), so the Clear control is present.
      await expect(body.getByTestId('content-type-trigger-clear')).toBeVisible();
    });
  },
};

const CATEGORY_TYPES = [
  { value: 'bebidas', label: 'Bebidas', count: 12 },
  { value: 'sobremesas', label: 'Sobremesas', count: 8 },
  { value: 'lanches', label: 'Lanches', count: 23 },
  { value: 'saladas', label: 'Saladas', count: 5 },
  { value: 'massas', label: 'Massas', count: 9 },
  { value: 'carnes', label: 'Carnes', count: 14 },
  { value: 'peixes', label: 'Peixes', count: 3 },
  { value: 'vegano', label: 'Vegano', count: 7 },
  { value: 'infantil', label: 'Infantil', count: 4 },
];

export const MultiSelectSearch: Story = {
  name: '🧪 Long list auto-shows search + filters options',
  render: () => {
    const [types, setTypes] = useState<Set<string>>(new Set());
    return (
      <ContentToolbar
        hasSelection={false}
        selectedCount={0}
        selectAll={fn()}
        clearSelection={fn()}
        rightControls={
          <MultiSelectDropdown
            label="Categoria"
            options={CATEGORY_TYPES}
            selected={types}
            onToggle={(value, checked) =>
              setTypes((prev) => {
                const next = new Set(prev);
                if (checked) next.add(value);
                else next.delete(value);
                return next;
              })
            }
            onClear={() => setTypes(new Set())}
            allLabel="Todas"
            searchPlaceholder="Buscar…"
            noResultsLabel="Nenhum resultado"
            data-testid="category-trigger"
          />
        }
      />
    );
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    await step('Open: 9 options auto-render a search box', async () => {
      await userEvent.click(canvas.getByTestId('category-trigger'));
      await waitFor(() => expect(body.getByTestId('category-trigger-search')).toBeVisible());
      await expect(body.getByText('Sobremesas')).toBeVisible();
      await expect(body.getByText('Lanches')).toBeVisible();
    });
    await step('Typing filters the list case-insensitively', async () => {
      await userEvent.type(body.getByTestId('category-trigger-search'), 'sobre');
      await waitFor(() => expect(body.queryByText('Lanches')).not.toBeInTheDocument());
      await expect(body.getByText('Sobremesas')).toBeVisible();
    });
    await step('Selecting a filtered option keeps the menu open', async () => {
      await userEvent.click(body.getByText('Sobremesas'));
      await waitFor(() => expect(canvas.getByTestId('category-trigger')).toHaveTextContent('Sobremesas'));
      await expect(body.getByTestId('category-trigger-search')).toBeVisible();
    });
    await step('A non-matching query shows the empty state', async () => {
      await userEvent.clear(body.getByTestId('category-trigger-search'));
      await userEvent.type(body.getByTestId('category-trigger-search'), 'zzz');
      await waitFor(() => expect(body.getByTestId('category-trigger-no-results')).toBeVisible());
    });
  },
};

export const FilterTriggerActiveDot: Story = {
  name: '🧪 Filter trigger toggles + shows active dot',
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <ContentToolbar
        hasSelection={false}
        selectedCount={0}
        selectAll={fn()}
        clearSelection={fn()}
        rightControls={<FilterTrigger open={open} onOpenChange={setOpen} hasActiveFilters data-testid="filter-btn" />}
      />
    );
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step('Toggle opens the filter', async () => {
      const btn = canvas.getByTestId('filter-btn');
      await expect(btn).toHaveAttribute('aria-expanded', 'false');
      await userEvent.click(btn);
      await waitFor(() => expect(canvas.getByTestId('filter-btn')).toHaveAttribute('aria-expanded', 'true'));
    });
  },
};
