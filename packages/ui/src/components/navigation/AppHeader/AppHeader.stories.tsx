import MenuIcon from '@mui/icons-material/Menu';
import SearchIcon from '@mui/icons-material/Search';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import { Box, Chip, InputAdornment, Stack, Tab, Tabs, TextField } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { fn } from 'storybook/test';

import { Button } from '../../form/Button/Button';

import { AppHeader } from './AppHeader';
import { AppHeaderBrand } from './AppHeader.brand';
import { AppHeaderDetails } from './AppHeader.details';
import { AppHeaderIdentity, AppHeaderStatus } from './AppHeader.identity';
import type { AppHeaderDetailRow } from './AppHeader.types';

const STORE_ROWS: AppHeaderDetailRow[] = [
  { id: 'now', label: 'Agora', value: 'Aberto até 22h', tone: 'success' },
  { id: 'weekdays', label: 'Seg a sex', value: '8h — 22h' },
  { id: 'weekend', label: 'Sáb e dom', value: '9h — 20h' },
  {
    id: 'address',
    label: 'Endereço',
    value: 'Rua Padre Pedro Pinto, 1200\nVenda Nova, Belo Horizonte',
  },
  { id: 'pickup', label: 'Retirada', value: 'No balcão, na hora' },
  { id: 'payment', label: 'Pagamento', value: 'Pix, crédito, débito' },
];

const StoreStatus = (): React.JSX.Element => (
  <AppHeaderStatus tone="success" items={['Aberto agora', 'Retirada no balcão']} />
);

const SearchField = (): React.JSX.Element => (
  <TextField
    fullWidth
    size="small"
    placeholder="Buscar entre 123 produtos"
    slotProps={{
      input: {
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon fontSize="small" />
          </InputAdornment>
        ),
      },
    }}
  />
);

/**
 * The page's own category strip, dropped into `below`. Plain MUI tabs here on
 * purpose: the story is showing what the slot carries, not documenting Tabs.
 */
const CategoryTabs = (): React.JSX.Element => {
  const [tab, setTab] = React.useState('bebidas');
  return (
    <Tabs value={tab} onChange={(_, next: string) => setTab(next)} variant="scrollable">
      {['Bebidas', 'Snacks', 'Doces', 'Padaria', 'Mercearia'].map((label) => (
        <Tab key={label} value={label.toLowerCase()} label={label} />
      ))}
    </Tabs>
  );
};

const SubcategoryChips = (): React.JSX.Element => (
  <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', pt: 1 }}>
    {['Energéticos', 'Cervejas', 'Refrigerantes', 'Chás e sucos', 'Águas'].map((label) => (
      <Chip key={label} label={label} variant="outlined" size="small" />
    ))}
  </Stack>
);

const meta: Meta<typeof AppHeader> = {
  title: 'Navigation/AppHeader',
  component: AppHeader,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The application bar as a set of slots on one surface. It knows nothing about ' +
          'routers, sessions, carts or stores, so the same bar serves a storefront, a back ' +
          'office and a platform console. Compose it with AppHeaderIdentity (mark + title + ' +
          'state line), AppHeaderStatus and AppHeaderDetails (the disclosure panel, a bottom ' +
          'sheet on phones and a centred dialog on large screens).',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    position: { control: { type: 'select' }, options: ['static', 'sticky', 'fixed'] },
    maxWidth: { control: { type: 'number' } },
    leading: { control: false },
    children: { control: false },
    actions: { control: false },
    meta: { control: false },
    below: { control: false },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** The storefront bar from the design: mark, name, state line, sign-in, build tag. */
export const Default: Story = {
  args: {
    position: 'static',
    meta: 'Build 18',
    actions: (
      <Button variant="outline" size="sm" onClick={fn()}>
        Entrar
      </Button>
    ),
    children: (
      <AppHeaderIdentity
        title="Future Drink"
        seedColor="#6366F1"
        status={<StoreStatus />}
        onDisclose={fn()}
      />
    ),
  },
};

/** The same bar carrying the page's own search, tabs and chips in `below`. */
export const WithSearchAndFilters: Story = {
  args: {
    ...Default.args,
    below: (
      <Box sx={{ pt: 0.5 }}>
        <SearchField />
        <Box sx={{ pt: 1 }}>
          <CategoryTabs />
        </Box>
        <SubcategoryChips />
      </Box>
    ),
  },
};

/**
 * A wide viewport. The surface still spans it; the content stops at `maxWidth`
 * and centres — one component, no breakpoint at the call site.
 */
export const LargeScreen: Story = {
  args: WithSearchAndFilters.args,
  parameters: { viewport: { defaultViewport: 'desktop' } },
};

export const Phone: Story = {
  args: WithSearchAndFilters.args,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

/** A back office: menu toggle in `leading`, no state line, an avatar in `actions`. */
export const BackOffice: Story = {
  args: {
    position: 'static',
    leading: (
      <Button variant="text" size="sm" aria-label="Abrir menu" onClick={fn()}>
        <MenuIcon />
      </Button>
    ),
    children: <AppHeaderIdentity title="Padaria Central" subtitle="Backoffice" size="sm" />,
    actions: <AppHeaderBrand name="Ana Souza" size="sm" shape="circle" seedColor="#0EA5E9" />,
  },
};

/** Every brand input: a seed colour, a logo, a one-word name, no colour at all. */
export const BrandMarks: Story = {
  render: () => (
    <Stack direction="row" spacing={2} sx={{ p: 3, alignItems: 'center' }}>
      <AppHeaderBrand name="Future Drink" seedColor="#6366F1" />
      <AppHeaderBrand name="Padaria Central" seedColor="#F97316" />
      <AppHeaderBrand name="Verde" seedColor="#16A34A" />
      <AppHeaderBrand name="Cinza Neutro" seedColor="#9CA3AF" />
      <AppHeaderBrand name="Sem cor" />
      <AppHeaderBrand name="Com logo" logoUrl="https://placehold.co/80x80/6366F1/FFF/png?text=FD" />
      <AppHeaderBrand name="Grande" seedColor="#6366F1" size="xl" shape="circle" />
    </Stack>
  ),
};

/** The identity while the store lookup is still in flight. */
export const LoadingIdentity: Story = {
  args: {
    position: 'static',
    children: <AppHeaderIdentity title="" loading />,
    actions: (
      <Button variant="outline" size="sm">
        Entrar
      </Button>
    ),
  },
};

/** A name long enough to prove the identity — and only the identity — gives way. */
export const LongName: Story = {
  args: {
    position: 'static',
    meta: 'Build 18',
    actions: (
      <Button variant="outline" size="sm">
        Entrar
      </Button>
    ),
    children: (
      <AppHeaderIdentity
        title="Mercado de Autoatendimento Venda Nova Belo Horizonte"
        seedColor="#6366F1"
        status={<AppHeaderStatus tone="warning" items={['Fecha em 15 min', 'Retirada no balcão']} />}
        onDisclose={fn()}
      />
    ),
  },
};

/** Every tone the state line can take. */
export const StatusTones: Story = {
  render: () => (
    <Stack spacing={1.5} sx={{ p: 3 }}>
      <AppHeaderStatus tone="success" items={['Aberto agora', 'Retirada no balcão']} />
      <AppHeaderStatus tone="warning" items={['Fecha em 15 min']} />
      <AppHeaderStatus tone="danger" items={['Fechado', 'Abre 8h']} />
      <AppHeaderStatus tone="info" items={['Somente entrega']} />
      <AppHeaderStatus tone="neutral" items={['Mesa 12', 'Comanda aberta']} />
      <AppHeaderStatus items={['Sem indicador']} />
    </Stack>
  ),
};

/** The whole thing wired: the disclosure opens the panel, the panel closes it. */
const StorefrontDemo = ({
  presentation,
}: {
  presentation?: 'auto' | 'sheet' | 'dialog';
}): React.JSX.Element => {
  const [open, setOpen] = React.useState(false);
  return (
    <Box sx={{ minHeight: 420 }}>
      <AppHeader
        position="static"
        meta="Build 18"
        actions={
          <>
            <Button variant="text" size="sm" aria-label="Carrinho">
              <ShoppingCartIcon fontSize="small" />
            </Button>
            <Button variant="outline" size="sm">
              Entrar
            </Button>
          </>
        }
        below={<SearchField />}
      >
        <AppHeaderIdentity
          title="Future Drink"
          seedColor="#6366F1"
          status={<StoreStatus />}
          disclosed={open}
          onDisclose={() => setOpen(true)}
        />
      </AppHeader>
      <AppHeaderDetails
        open={open}
        onClose={() => setOpen(false)}
        title="Future Drink"
        subtitle="Mercado de autoatendimento"
        rows={STORE_ROWS}
        action={{ label: 'Trocar de loja', onClick: fn() }}
        presentation={presentation}
      />
    </Box>
  );
};

/** Open the panel and let the viewport decide which surface it takes. */
export const WithDetails: Story = { render: () => <StorefrontDemo /> };

/** Forced to the phone surface: a bottom sheet with a grab handle. */
export const DetailsAsSheet: Story = { render: () => <StorefrontDemo presentation="sheet" /> };

/** Forced to the large-screen surface: a centred dialog. */
export const DetailsAsDialog: Story = { render: () => <StorefrontDemo presentation="dialog" /> };

/** Sticky, lifted on scroll, with enough page under it to try. */
export const StickyOnScroll: Story = {
  render: () => (
    <Box>
      <AppHeader
        position="sticky"
        elevateOnScroll
        meta="Build 18"
        actions={
          <Button variant="outline" size="sm">
            Entrar
          </Button>
        }
      >
        <AppHeaderIdentity title="Future Drink" seedColor="#6366F1" status={<StoreStatus />} />
      </AppHeader>
      <Box sx={{ p: 3 }}>
        {Array.from({ length: 30 }, (_, index) => (
          <Box key={index} sx={{ py: 2, borderBottom: 1, borderColor: 'divider' }}>
            Produto {index + 1}
          </Box>
        ))}
      </Box>
    </Box>
  ),
};
