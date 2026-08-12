import MenuIcon from '@mui/icons-material/Menu';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import { Box, Stack } from '@mui/material';
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

/**
 * The bar with its disclosure actually wired.
 *
 * Every story that shows a chevron renders through this, because a chevron
 * hooked to a spy is a lie: it invites the one click the component exists for
 * and answers with nothing, and from the outside that is indistinguishable from
 * a broken panel. Real state here, so the click opens the real panel.
 */
const DisclosingHeader = ({
  title,
  status,
  presentation,
  cart = false,
}: {
  title: string;
  status?: React.ReactNode;
  presentation?: 'auto' | 'sheet' | 'dialog';
  cart?: boolean;
}): React.JSX.Element => {
  const [open, setOpen] = React.useState(false);
  return (
    <Box sx={{ minHeight: 420 }}>
      <AppHeader
        position="static"
        actions={
          <>
            {cart && (
              <Button variant="text" size="sm" aria-label="Carrinho">
                <ShoppingCartIcon fontSize="small" />
              </Button>
            )}
            <Button variant="outline" size="sm">
              Entrar
            </Button>
          </>
        }
      >
        <AppHeaderIdentity
          title={title}
          seedColor="#6366F1"
          status={status}
          disclosed={open}
          onDisclose={() => setOpen(true)}
        />
      </AppHeader>
      <AppHeaderDetails
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        subtitle="Mercado de autoatendimento"
        rows={STORE_ROWS}
        action={{ label: 'Trocar de loja', onClick: fn() }}
        presentation={presentation}
      />
    </Box>
  );
};

const meta: Meta<typeof AppHeader> = {
  title: 'Navigation/AppHeader',
  component: AppHeader,
  parameters: {
    layout: 'fullscreen',
    // Storybook 9 moved viewport into core and made it globals-driven: the
    // story-level key is `globals.viewport.value`, naming one of these options.
    // The old `parameters.viewport.defaultViewport` is accepted silently and
    // does nothing, which is why the phone story used to render full-width.
    viewport: {
      options: {
        phone: { name: 'Phone', styles: { width: '390px', height: '844px' }, type: 'mobile' },
        desktop: { name: 'Desktop', styles: { width: '1440px', height: '900px' }, type: 'desktop' },
      },
    },
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

/** The storefront bar: mark, name, state line, sign-in — and a disclosure that opens. */
export const Default: Story = {
  render: () => <DisclosingHeader title="Future Drink" status={<StoreStatus />} cart />,
};

/** The same bar on a phone, where the panel takes the bottom-sheet surface. */
export const Phone: Story = {
  render: () => <DisclosingHeader title="Future Drink" status={<StoreStatus />} cart />,
  globals: { viewport: { value: 'phone' } },
};

/**
 * A wide viewport. The surface still spans it; the content stops at `maxWidth`
 * and centres — one component, no breakpoint at the call site.
 */
export const LargeScreen: Story = {
  render: () => <DisclosingHeader title="Future Drink" status={<StoreStatus />} cart />,
  globals: { viewport: { value: 'desktop' } },
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

/**
 * A name long enough to prove the identity — and only the identity — gives way.
 *
 * Narrow the canvas: the title ellipsises and the state line clips, while the
 * actions keep their width and stay clear of both.
 */
export const LongName: Story = {
  render: () => (
    <DisclosingHeader
      title="Mercado de Autoatendimento Venda Nova Belo Horizonte"
      status={<AppHeaderStatus tone="warning" items={['Fecha em 15 min', 'Retirada no balcão']} />}
    />
  ),
};

/** Open the panel and let the viewport decide which surface it takes. */
export const WithDetails: Story = {
  render: () => <DisclosingHeader title="Future Drink" status={<StoreStatus />} cart />,
};

/** Forced to the phone surface: a bottom sheet, sized to what is in it. */
export const DetailsAsSheet: Story = {
  render: () => (
    <DisclosingHeader title="Future Drink" status={<StoreStatus />} cart presentation="sheet" />
  ),
};

/** Forced to the large-screen surface: a centred dialog. */
export const DetailsAsDialog: Story = {
  render: () => (
    <DisclosingHeader title="Future Drink" status={<StoreStatus />} cart presentation="dialog" />
  ),
};

/** Sticky, lifted on scroll, with enough page under it to try. */
export const StickyOnScroll: Story = {
  render: () => (
    <Box>
      <AppHeader
        position="sticky"
        elevateOnScroll
        actions={
          <Button variant="outline" size="sm">
            Entrar
          </Button>
        }
      >
        <AppHeaderIdentity title="Future Drink" seedColor="#6366F1" status={<StoreStatus />} />
      </AppHeader>
      <Stack sx={{ p: 3 }}>
        {Array.from({ length: 30 }, (_, index) => (
          <Box key={index} sx={{ py: 2, borderBottom: 1, borderColor: 'divider' }}>
            Produto {index + 1}
          </Box>
        ))}
      </Stack>
    </Box>
  ),
};
