import Box from '@mui/material/Box/index.js';
import Button from '@mui/material/Button/index.js';
import Typography from '@mui/material/Typography/index.js';
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

/**
 * The heaviest selection row there is, at the width it has to survive.
 *
 * Everything the bar can carry at once: "Limpar filtros", the count, the
 * `selectionExtra` widening ("Seleção: 48 produtos — todas as páginas" plus its
 * own "Limpar seleção") and an "Ações (20)" button. That is the Produtos
 * catalogue with a page ticked and the scope armed, and on a 320px phone it is
 * ~180px more than one line holds.
 *
 * Pinned as a story because the failure is a LAYOUT one and jsdom has no layout
 * engine: the row used to overflow the toolbar and take "Ações" off-screen
 * behind a sideways scroll, which no assertion in `__tests__` can see. Open it
 * at 320 and 390 — the widening and the actions button belong on their own
 * line, and the document must not scroll sideways.
 */
export const NarrowSelectionOverflow: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' }, layout: 'fullscreen' },
  render: () => (
    <Box sx={{ px: 2, py: 1.25, borderTop: 1, borderBottom: 1, borderColor: 'divider' }}>
      <ContentToolbar
        selectAllLabel="Selecionar todos"
        selectAllText="Selecionar todos nesta página"
        clearAllText="Limpar filtros"
        hasSelection
        selectedCount={20}
        selectAll={() => {}}
        clearSelection={() => {}}
        selectAllTestId="produtos-select-all"
        clearAllTestId="produtos-clear-all"
        exclusiveSelection
        selectionExtra={
          <>
            <Typography component="span" sx={{ fontSize: '0.75rem' }}>
              Seleção: 48 produtos — todas as páginas
            </Typography>
            <Button variant="text" size="small" sx={{ textTransform: 'none' }}>
              Limpar seleção
            </Button>
          </>
        }
        actions={
          <Button variant="outlined" size="small" sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}>
            Ações (20) ▾
          </Button>
        }
        leadingControls={<Box />}
        rightControls={<Box />}
      />
    </Box>
  ),
};
