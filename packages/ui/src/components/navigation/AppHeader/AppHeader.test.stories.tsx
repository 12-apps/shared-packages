import Box from '@mui/material/Box';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { Button } from '../../form/Button/Button';

import { AppHeader } from './AppHeader';
import { AppHeaderBrand } from './AppHeader.brand';
import { AppHeaderDetails } from './AppHeader.details';
import { AppHeaderIdentity, AppHeaderStatus } from './AppHeader.identity';
import type { AppHeaderDetailRow } from './AppHeader.types';

const STORE_ROWS: AppHeaderDetailRow[] = [
  { id: 'now', label: 'Agora', value: 'Aberto até 22h', tone: 'success' },
  { id: 'weekdays', label: 'Seg a sex', value: '8h — 22h' },
  { id: 'address', label: 'Endereço', value: 'Rua Padre Pedro Pinto, 1200\nVenda Nova' },
];

/** The wired storefront the interaction tests drive. */
const Storefront = ({
  presentation,
  onAction = fn(),
}: {
  presentation?: 'auto' | 'sheet' | 'dialog';
  onAction?: () => void;
}): React.JSX.Element => {
  const [open, setOpen] = React.useState(false);
  return (
    <Box sx={{ minHeight: 360 }}>
      <AppHeader
        position="static"
        meta="Build 18"
        actions={
          <Button variant="outline" size="sm">
            Entrar
          </Button>
        }
      >
        <AppHeaderIdentity
          title="Future Drink"
          seedColor="#6366F1"
          status={<AppHeaderStatus tone="success" items={['Aberto agora', 'Retirada no balcão']} />}
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
        action={{ label: 'Trocar de loja', onClick: onAction }}
        presentation={presentation}
      />
    </Box>
  );
};

const meta: Meta<typeof AppHeader> = {
  title: 'Navigation/AppHeader/Tests',
  component: AppHeader,
  parameters: { layout: 'fullscreen', chromatic: { disableSnapshot: false } },
  tags: ['autodocs', 'test', 'component:AppHeader'],
};

export default meta;
export type Story = StoryObj<typeof meta>;

export const BasicInteraction: Story = {
  render: () => <Storefront presentation="dialog" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const disclosure = canvas.getByRole('button', { name: 'Detalhes de Future Drink' });
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(disclosure);

    // The panel is a portal, so it is queried from the document, not the canvas.
    const panel = within(document.body);
    await waitFor(() => expect(panel.getByText('Aberto até 22h')).toBeInTheDocument());

    // Assert on the node already held rather than re-querying it by role: an open
    // MUI Modal marks the rest of the app `aria-hidden` to trap assistive tech
    // inside the dialog, so while the panel is up the canvas has NO accessible
    // roles at all and `getByRole` fails on a bar that is behaving correctly.
    await waitFor(() => expect(disclosure).toHaveAttribute('aria-expanded', 'true'));
  },
};

/** Cleared at the top of the play run, so a replay cannot inherit its calls. */
const chooseStore = fn();

export const FormInteraction: Story = {
  render: () => <Storefront presentation="dialog" onAction={chooseStore} />,
  play: async ({ canvasElement }) => {
    chooseStore.mockClear();
    const canvas = within(canvasElement);
    const panel = within(document.body);

    // The bar holds no fields of its own — it is a shell, and the page owns
    // whatever it puts in `below`. Its one COMMITTING control is the disclosure
    // panel's call to action, so that is the submit path worth driving here.
    await userEvent.click(canvas.getByTestId('app-header-identity'));

    const action = await waitFor(() => panel.getByRole('button', { name: 'Trocar de loja' }));
    await userEvent.click(action);
    await waitFor(() => expect(chooseStore).toHaveBeenCalled());
  },
};

export const KeyboardNavigation: Story = {
  render: () => <Storefront presentation="dialog" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const disclosure = canvas.getByRole('button', { name: 'Detalhes de Future Drink' });

    // Tab rather than `.focus()`: this asserts the bar's real tab order, and the
    // identity is the first thing in it.
    await userEvent.tab();
    await waitFor(() => expect(disclosure).toHaveFocus());

    // A real <button>, so Enter opens it — no key handler of our own.
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(within(document.body).getByText('Aberto até 22h')).toBeInTheDocument(),
    );
  },
};

export const ScreenReader: Story = {
  render: () => (
    <AppHeader position="static">
      <AppHeaderIdentity
        title="Future Drink"
        seedColor="#6366F1"
        status={<AppHeaderStatus tone="success" items={['Aberto agora', 'Retirada no balcão']} />}
        onDisclose={fn()}
      />
    </AppHeader>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // The mark is a picture of the brand, not two letters to spell out.
    await expect(canvas.getByRole('img', { name: 'Future Drink' })).toBeInTheDocument();

    // The disclosure announces what it is and what it does.
    const disclosure = canvas.getByRole('button', { name: 'Detalhes de Future Drink' });
    await expect(disclosure).toHaveAttribute('aria-haspopup', 'dialog');

    // The state line reads as a sentence: the separator is punctuation, and the
    // segments are separated by real whitespace rather than by CSS margin.
    await expect(canvas.getByTestId('app-header-status')).toHaveTextContent(
      'Aberto agora · Retirada no balcão',
    );
  },
};

export const FocusManagement: Story = {
  render: () => <Storefront presentation="dialog" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const disclosure = canvas.getByRole('button', { name: 'Detalhes de Future Drink' });

    await userEvent.click(disclosure);

    // Focus moves into the dialog, which is what makes Escape and Tab work.
    await waitFor(() => {
      const dialog = document.querySelector('.MuiDialog-root');
      expect(dialog?.contains(document.activeElement)).toBe(true);
    });
  },
};

export const ResponsiveDesign: Story = {
  render: () => (
    <Box>
      <Storefront presentation="sheet" />
      <Storefront presentation="dialog" />
    </Box>
  ),
  play: async ({ canvasElement }) => {
    // Both presentations render the same body, so a caller switching between
    // them never loses content.
    const canvas = within(canvasElement);
    const [sheetDisclosure] = canvas.getAllByRole('button', { name: 'Detalhes de Future Drink' });
    await userEvent.click(sheetDisclosure as HTMLElement);
    await waitFor(() => expect(document.querySelector('.MuiDrawer-root')).toBeInTheDocument());
  },
};

/**
 * The disclosing identity must give way to the actions, not run under them.
 *
 * A real browser is the only place this can be caught: jsdom lays nothing out,
 * so the bug this guards measured clean in every unit test while the title and
 * state line sat on top of the sign-in button at every phone width. The cause
 * was that a `<button>` sizes to max-content and will not shrink inside its
 * block wrapper, so the ellipsis never had a width to work against.
 */
export const IdentityYieldsToActions: Story = {
  render: () => (
    // `maxWidth` and not `width`: a hard 360 is wider than the narrowest phone
    // this story exists to cover, so it overflowed the 320px viewport by 40px and
    // put a horizontal scrollbar under a bar that fits perfectly well.
    <Box sx={{ width: '100%', maxWidth: 360 }}>
      <AppHeader position="static" actions={<Button size="sm">Entrar</Button>}>
        <AppHeaderIdentity
          title="Mercado de Autoatendimento Venda Nova Belo Horizonte"
          seedColor="#6366F1"
          status={<AppHeaderStatus tone="success" items={['Aberto agora', 'Retirada no balcão']} />}
          onDisclose={fn()}
        />
      </AppHeader>
    </Box>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const identity = canvas.getByTestId('app-header-identity');
    const actions = canvas.getByTestId('app-header-actions');

    // The assertion that matters: no horizontal overlap. Before the fix the
    // identity's right edge stayed pinned at its max-content width and crossed
    // the actions by 327px at 320px wide.
    await waitFor(() =>
      expect(identity.getBoundingClientRect().right).toBeLessThanOrEqual(
        actions.getBoundingClientRect().left,
      ),
    );

    // …and it is set up to give way by ellipsising rather than by overflowing.
    // Asserted from the computed style, not from scrollWidth vs clientWidth:
    // scroll metrics are viewport-dependent (test-flakiness/no-viewport-dependent
    // rejects them), and the contract here is that the clipping rules are on the
    // title at all — losing them is what let the text escape its box.
    const title = canvas.getByTestId('app-header-identity-title');
    const titleStyle = getComputedStyle(title);
    await expect(titleStyle.overflow).toBe('hidden');
    await expect(titleStyle.textOverflow).toBe('ellipsis');
    await expect(titleStyle.whiteSpace).toBe('nowrap');
  },
};

export const ThemeVariations: Story = {
  render: () => (
    <AppHeader position="static" meta="Build 18" actions={<Button size="sm">Entrar</Button>}>
      <AppHeaderIdentity
        title="Future Drink"
        seedColor="#6366F1"
        status={<AppHeaderStatus tone="success" items={['Aberto agora']} />}
      />
    </AppHeader>
  ),
  play: async ({ canvasElement }) => {
    // Every surface is a theme token, so the bar follows the app's mode.
    await expect(within(canvasElement).getByTestId('app-header')).toBeInTheDocument();
  },
};

export const VisualStates: Story = {
  render: () => (
    <Box>
      <AppHeader position="static">
        <AppHeaderIdentity title="Carregando" loading />
      </AppHeader>
      <AppHeader position="static">
        <AppHeaderIdentity title="Sem estado" seedColor="#F97316" />
      </AppHeader>
      <AppHeader position="static" divider={false}>
        <AppHeaderIdentity
          title="Fechado"
          seedColor="#DC2626"
          status={<AppHeaderStatus tone="danger" items={['Fechado', 'Abre 8h']} />}
          onDisclose={fn()}
        />
      </AppHeader>
    </Box>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId('app-header-identity-loading')).toBeInTheDocument();
    // A loading identity shows no name — a placeholder would flash the wrong
    // brand on every load.
    await waitFor(() => expect(canvas.queryByText('Carregando')).not.toBeInTheDocument());
    await expect(canvas.getByTestId('app-header-status-dot')).toBeInTheDocument();
  },
};

export const Performance: Story = {
  render: () => (
    <Box>
      {Array.from({ length: 20 }, (_, index) => (
        <AppHeader key={index} position="static">
          <AppHeaderIdentity title={`Loja ${index + 1}`} seedColor="#6366F1" />
        </AppHeader>
      ))}
    </Box>
  ),
  play: async ({ canvasElement }) => {
    // 20 bars, each deriving its own gradient: the derivation is arithmetic on
    // one colour, not a layout pass.
    await expect(within(canvasElement).getAllByTestId('app-header')).toHaveLength(20);
  },
};

export const EdgeCases: Story = {
  render: () => (
    <Box>
      <AppHeader position="static" meta="Build 18" actions={<Button size="sm">Entrar</Button>}>
        <AppHeaderIdentity
          title="Mercado de Autoatendimento Venda Nova Belo Horizonte Zona Norte"
          seedColor="#6366F1"
          status={<AppHeaderStatus tone="warning" items={['Fecha em 15 min', '', null]} />}
          onDisclose={fn()}
        />
      </AppHeader>
      <AppHeader position="static">
        <AppHeaderIdentity title="Verde" mark={<AppHeaderBrand name="Verde" />} />
      </AppHeader>
    </Box>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Empty segments are dropped rather than rendered as stray separators.
    await expect(canvas.getByTestId('app-header-status')).toHaveTextContent('Fecha em 15 min');
    await expect(canvas.getByTestId('app-header-status').textContent).not.toContain('··');

    // A one-word name yields one initial.
    await expect(canvas.getByRole('img', { name: 'Verde' })).toHaveTextContent('V');
  },
};

export const Integration: Story = {
  render: () => <Storefront presentation="dialog" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const panel = within(document.body);

    await userEvent.click(canvas.getByRole('button', { name: 'Detalhes de Future Drink' }));

    // Every row the caller passed reaches the panel, address newline included.
    await waitFor(() => expect(panel.getByText('Aberto até 22h')).toBeInTheDocument());
    await expect(panel.getByText('8h — 22h')).toBeInTheDocument();
    await expect(panel.getByText(/Venda Nova/u)).toBeInTheDocument();

    // And the way out is a single full-width action.
    await expect(panel.getByRole('button', { name: 'Trocar de loja' })).toBeInTheDocument();
  },
};
