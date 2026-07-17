import { Box, Button, Typography } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { ContentToolbar } from './ContentToolbar';
import { FilterTrigger } from './FilterTrigger';
import { MultiSelectDropdown } from './MultiSelectDropdown';
import { SortByDropdown } from './SortByDropdown';
import { ViewSelector } from './ViewSelector';
import type { SortFieldDefinition, ViewMode } from './ContentToolbar.types';

const meta: Meta<typeof ContentToolbar> = {
  title: 'Layout/ContentToolbar',
  component: ContentToolbar,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Shared content-page toolbar (Favorites / Personal Space / Recents style): a Select All / Clear All / count / actions cluster on the left and a free `rightControls` slot on the right. Ships with `ViewSelector`, `SortByDropdown`, `MultiSelectDropdown` and `FilterTrigger` to compose that slot.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const SORT_FIELDS: SortFieldDefinition[] = [
  {
    value: 'size',
    label: 'Size',
    triggerLabelStyle: 'range',
    orderOptions: [
      { value: 'large', label: 'Large' },
      { value: 'small', label: 'Small' },
    ],
  },
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
  { value: 'datasources', label: 'Data Sources', count: 3 },
];

/** A full reference toolbar with page title/description above it. */
function ToolbarHarness({ withSelection }: { withSelection: boolean }): React.JSX.Element {
  const [view, setView] = useState<ViewMode>('grid');
  const [zoom, setZoom] = useState<number[]>([50]);
  const [sortField, setSortField] = useState('size');
  const [sortOrder, setSortOrder] = useState('large');
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [panelOpen, setPanelOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(withSelection ? new Set(['a', 'b']) : new Set());

  return (
    <Box sx={{ maxWidth: 1100 }}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', pb: 2, mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          Favorites
        </Typography>
        <Typography sx={{ fontSize: '0.875rem', color: 'text.secondary', mt: 0.5 }}>
          Drag and drop items in grid view to reorder your favorites. Access your custom order using the Sort By menu.
        </Typography>
      </Box>
      <ContentToolbar
        hasSelection={selected.size > 0}
        selectedCount={selected.size}
        selectAll={() => setSelected(new Set(['a', 'b', 'c', 'd']))}
        clearSelection={() => setSelected(new Set())}
        selectAllTestId="fav-select-all"
        clearAllTestId="fav-clear-all"
        actions={
          <Button variant="text" size="small" color="inherit" sx={{ textTransform: 'none' }}>
            Delete
          </Button>
        }
        rightControls={
          <>
            <ViewSelector viewMode={view} onViewModeChange={setView} zoom={zoom} onZoomChange={setZoom} />
            <SortByDropdown
              fields={SORT_FIELDS}
              activeField={sortField}
              activeOrder={sortOrder}
              onFieldChange={setSortField}
              onOrderChange={setSortOrder}
              data-testid="sort-trigger"
            />
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
            <FilterTrigger open={panelOpen} onOpenChange={setPanelOpen} hasActiveFilters={types.size > 0} />
          </>
        }
      />
    </Box>
  );
}

export const Default: Story = {
  render: () => <ToolbarHarness withSelection={false} />,
};

export const WithSelection: Story = {
  render: () => <ToolbarHarness withSelection />,
};
