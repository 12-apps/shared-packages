import Inventory2Icon from '@mui/icons-material/Inventory2';
import CssBaseline from '@mui/material/CssBaseline/index.js';
import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { useState } from 'react';

import { SearchPalette } from './SearchPalette';
import type { SearchResultLead } from './SearchPalette.types';

interface Item {
  id: string;
  name: string;
  sub?: string;
  image?: string;
  date?: string;
}

const PRODUCTS: Item[] = [
  { id: 'p1', name: 'Sabão em pó 1kg', sub: 'Limpeza Roupas', date: 'Jul 12' },
  { id: 'p2', name: 'Sabonete 90g', sub: 'Cuidado Pessoal', date: 'Jul 11' },
  { id: 'p3', name: 'Detergente 500ml', sub: 'Limpeza Cozinha', date: 'Jul 10' },
  { id: 'p4', name: 'Sabão líquido 3L', sub: 'Limpeza Roupas', date: 'Jul 9' },
  { id: 'p5', name: 'Esponja (un)', sub: 'Limpeza Cozinha', date: 'Jul 8' },
  { id: 'p6', name: 'Escova de dente', sub: 'Cuidado Bucal', date: 'Jul 7' },
];

const FILTERS = [
  { id: 'last7', label: 'Últimos 7 dias' },
  { id: 'mine', label: 'Criados por mim' },
  { id: 'active', label: 'Ativos' },
];

const theme = createTheme();

const meta: Meta<typeof SearchPalette<Item>> = {
  title: 'Navigation/SearchPalette',
  component: SearchPalette,
  tags: ['autodocs', 'component:SearchPalette'],
  parameters: {
    docs: {
      description: {
        component:
          'A Gmail-style search palette: input + filter chips + rich result rows + "see all" footer. App-agnostic and configurable.',
      },
    },
  },
  decorators: [
    (Story) => (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <div style={{ maxWidth: 640, padding: 24, background: '#f1f3f4' }}>
          <Story />
        </div>
      </ThemeProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof SearchPalette<Item>>;

function lead(item: Item): SearchResultLead {
  return item.image
    ? { kind: 'image', src: item.image }
    : { kind: 'icon', node: <Inventory2Icon fontSize="small" /> };
}

function Harness({ initial = '' }: { initial?: string }) {
  const [query, setQuery] = useState(initial);
  const [active, setActive] = useState<string[]>(['last7']);
  const matches = PRODUCTS.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <SearchPalette<Item>
      value={query}
      onChange={setQuery}
      items={query.trim() ? matches : []}
      getKey={(p) => p.id}
      getPrimary={(p) => p.name}
      getSecondary={(p) => p.sub}
      getLead={lead}
      getTrailing={(p) => p.date}
      onSelect={(p) => setQuery(p.name)}
      filters={FILTERS}
      activeFilterIds={active}
      onToggleFilter={(id) =>
        setActive((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
      }
      onSubmitAll={() => undefined}
      emptyQueryContent={
        <div style={{ padding: '8px 16px', color: '#5f6368', fontSize: 13 }}>
          Comece a digitar para buscar…
        </div>
      }
      inputAriaLabel="Buscar"
      placeholder="Buscar páginas e registros…"
    />
  );
}

export const Default: Story = {
  render: () => <Harness />,
};

export const WithResults: Story = {
  render: () => <Harness initial="Sab" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Chips render and results are filtered + capped.
    await expect(canvas.getByTestId('search-palette-filters')).toBeInTheDocument();
    await waitFor(() => expect(canvas.getByTestId('search-palette-results')).toBeInTheDocument());
    await expect(canvas.getAllByText(/Sab/).length).toBeGreaterThan(0);
    // Footer "see all" is present with a non-empty query.
    await expect(canvas.getByTestId('search-palette-submit-all')).toBeInTheDocument();
  },
};

export const ToggleFilter: Story = {
  render: () => <Harness initial="a" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chip = canvas.getByTestId('search-palette-filter-mine');
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(chip);
    await waitFor(() => expect(chip).toHaveAttribute('aria-pressed', 'true'));
  },
};

export const EmptyQuery: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('search-palette-empty-query')).toBeInTheDocument();
  },
};
