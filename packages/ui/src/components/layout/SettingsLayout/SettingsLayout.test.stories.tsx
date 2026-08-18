import { Typography } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { SettingsLayout } from './SettingsLayout';
import type { SettingsNavGroup } from './SettingsLayout.types';

const GROUPS: SettingsNavGroup[] = [
  {
    id: 'account',
    label: 'Account',
    items: [
      { id: 'profile', label: 'Profile' },
      { id: 'security', label: 'Security', keywords: ['password', '2fa'] },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    description: 'Workspace-only preferences.',
    items: [{ id: 'billing', label: 'Billing' }],
  },
];

const meta: Meta<typeof SettingsLayout> = {
  title: 'Layout/SettingsLayout/Tests',
  component: SettingsLayout,
  parameters: {
    layout: 'fullscreen',
    chromatic: { disableSnapshot: false },
  },
  tags: ['autodocs', 'test', 'component:SettingsLayout'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const panel = <Typography data-testid="demo-panel">Panel content</Typography>;

export const StructureRender: Story = {
  name: '🧪 Structure Render Test',
  render: () => (
    <SettingsLayout title="Settings" groups={GROUPS} activeItemId="profile">
      {panel}
    </SettingsLayout>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Rail, search, groups and panel render', async () => {
      await expect(canvas.getByTestId('settings-rail')).toBeInTheDocument();
      await expect(canvas.getByTestId('settings-search')).toBeInTheDocument();
      await expect(canvas.getByTestId('settings-group-account')).toBeInTheDocument();
      await expect(canvas.getByTestId('settings-group-workspace')).toBeInTheDocument();
      await expect(canvas.getByTestId('settings-item-profile')).toBeInTheDocument();
      await expect(canvas.getByTestId('settings-panel')).toBeInTheDocument();
      await expect(canvas.getByTestId('demo-panel')).toBeInTheDocument();
    });
  },
};

export const ActiveHighlight: Story = {
  name: '🎯 Active Item Highlight Test',
  render: () => (
    <SettingsLayout title="Settings" groups={GROUPS} activeItemId="security">
      {panel}
    </SettingsLayout>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Active item carries aria-current=page', async () => {
      const active = canvas.getByTestId('settings-item-security');
      await expect(active).toHaveAttribute('aria-current', 'page');
      const inactive = canvas.getByTestId('settings-item-profile');
      await expect(inactive).not.toHaveAttribute('aria-current');
    });
  },
};

export const SelectionCallback: Story = {
  name: '🖱️ Selection Callback Test',
  args: { onSelectItem: fn() },
  render: (args) => (
    <SettingsLayout title="Settings" groups={GROUPS} activeItemId="profile" {...args}>
      {panel}
    </SettingsLayout>
  ),
  play: async ({ canvasElement, step, args }) => {
    const canvas = within(canvasElement);

    await step('Clicking a button item fires onSelectItem with its id', async () => {
      await userEvent.click(canvas.getByTestId('settings-item-billing'));
      await expect(args.onSelectItem).toHaveBeenCalledWith('billing');
    });
  },
};

export const SearchFilters: Story = {
  name: '🔎 Search Filter Test',
  render: () => (
    <SettingsLayout title="Settings" groups={GROUPS} activeItemId="profile">
      {panel}
    </SettingsLayout>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const search = canvas.getByTestId('settings-search').querySelector('input');

    await step('Typing a label narrows the rail', async () => {
      await userEvent.type(search as HTMLInputElement, 'secur');
      await expect(canvas.getByTestId('settings-item-security')).toBeInTheDocument();
      await waitFor(() => {
        expect(canvas.queryByTestId('settings-item-profile')).not.toBeInTheDocument();
        expect(canvas.queryByTestId('settings-group-workspace')).not.toBeInTheDocument();
      });
    });

    await step('Keywords are matched too', async () => {
      await userEvent.clear(search as HTMLInputElement);
      await userEvent.type(search as HTMLInputElement, 'password');
      await expect(canvas.getByTestId('settings-item-security')).toBeInTheDocument();
    });

    await step('No match shows the empty state', async () => {
      await userEvent.clear(search as HTMLInputElement);
      await userEvent.type(search as HTMLInputElement, 'zzzzz');
      await expect(canvas.getByTestId('settings-empty')).toBeInTheDocument();
    });
  },
};

export const LinkMode: Story = {
  name: '🔗 Link Mode Test',
  render: () => {
    const linked: SettingsNavGroup[] = GROUPS.map((group) => ({
      ...group,
      items: group.items.map((item) => ({ ...item, href: `#/settings/${item.id}` })),
    }));
    return (
      <SettingsLayout title="Settings" groups={linked} activeItemId="profile" linkComponent="a">
        {panel}
      </SettingsLayout>
    );
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Items with href render as anchors', async () => {
      const item = canvas.getByTestId('settings-item-security');
      await expect(item.tagName.toLowerCase()).toBe('a');
      await expect(item).toHaveAttribute('href', '#/settings/security');
    });
  },
};

export const KeyboardNavigation: Story = {
  name: '⌨️ Keyboard Navigation Test',
  render: () => (
    <SettingsLayout title="Settings" groups={GROUPS} activeItemId="profile">
      {panel}
    </SettingsLayout>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Search field is focusable and typeable', async () => {
      const input = canvas.getByTestId('settings-search').querySelector('input') as HTMLInputElement;
      await userEvent.click(input);
      await waitFor(() => expect(input).toHaveFocus());
      await userEvent.keyboard('pro');
      await expect(canvas.getByTestId('settings-item-profile')).toBeInTheDocument();
    });
  },
};

/** The four sections of a Loja rail, one per situation the host can resolve. */
const MARKED: SettingsNavGroup[] = [
  {
    id: 'store',
    label: 'Loja',
    items: [
      { id: 'profile', label: 'Perfil e marca', status: 'ok', statusLabel: 'Ligado' },
      { id: 'address', label: 'Endereço', status: 'off', statusLabel: 'Desligado' },
      { id: 'hours', label: 'Horários', status: 'new', statusLabel: 'Não visitado' },
      {
        id: 'domain',
        label: 'Domínio e app',
        status: 'locked',
        statusLabel: 'Incluído no plano Pro',
      },
    ],
  },
];

export const SituationMarkers: Story = {
  name: '🟢 Situation Marker Test',
  render: () => (
    <SettingsLayout title="Configuração" groups={MARKED} activeItemId="profile">
      {panel}
    </SettingsLayout>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Each row carries a marker tagged with its situation', async () => {
      await expect(canvas.getByTestId('settings-status-profile')).toHaveAttribute(
        'data-status',
        'ok',
      );
      await expect(canvas.getByTestId('settings-status-address')).toHaveAttribute(
        'data-status',
        'off',
      );
      await expect(canvas.getByTestId('settings-status-hours')).toHaveAttribute(
        'data-status',
        'new',
      );
      await expect(canvas.getByTestId('settings-status-domain')).toHaveAttribute(
        'data-status',
        'locked',
      );
    });

    await step('Colour is never the only carrier: the meaning is in the row name', async () => {
      // Reached by accessible name rather than by test id on purpose — this is
      // the assertion that a screen reader hears the situation at all.
      await expect(canvas.getByRole('button', { name: /Perfil e marca.*Ligado/ })).toBeVisible();
      await expect(
        canvas.getByRole('button', { name: /Domínio e app.*Incluído no plano Pro/ }),
      ).toBeVisible();
    });
  },
};

export const InertItem: Story = {
  name: '🚧 Inert Item Test',
  render: () => {
    const groups: SettingsNavGroup[] = [
      {
        id: 'store',
        label: 'Loja',
        items: [
          { id: 'profile', label: 'Perfil e marca' },
          { id: 'orders', label: 'Pedidos', inert: true, status: 'ok', statusLabel: 'Ligado' },
        ],
      },
    ];
    return (
      <SettingsLayout title="Configuração" groups={groups} activeItemId="profile">
        {panel}
      </SettingsLayout>
    );
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('An inert row is listed, with its marker, but is not a control', async () => {
      const inert = canvas.getByTestId('settings-item-orders');
      await expect(inert).toHaveAttribute('data-inert', 'true');
      await expect(within(inert).queryByRole('button')).toBeNull();
      await expect(canvas.getByTestId('settings-status-orders')).toBeInTheDocument();
    });
  },
};

export const EmptySearchExit: Story = {
  name: '🚪 Empty Search Exit Test',
  args: { emptySearchAction: { label: 'Limpar a busca', onClear: fn() } },
  render: (args) => (
    <SettingsLayout
      title="Configuração"
      groups={GROUPS}
      activeItemId="profile"
      emptySearchLabel="Nenhuma configuração encontrada."
      emptySearchAction={args.emptySearchAction}
    >
      {panel}
    </SettingsLayout>
  ),
  play: async ({ canvasElement, step, args }) => {
    const canvas = within(canvasElement);
    const search = canvas.getByTestId('settings-search').querySelector('input') as HTMLInputElement;

    await step('A search matching nothing offers the way out inside itself', async () => {
      await userEvent.type(search, 'zzzzz');
      await waitFor(() => expect(canvas.getByTestId('settings-empty')).toBeInTheDocument());
      await expect(canvas.getByTestId('settings-empty-action')).toHaveTextContent('Limpar a busca');
    });

    await step('Taking it clears the field and brings every section back', async () => {
      await userEvent.click(canvas.getByTestId('settings-empty-action'));
      await waitFor(() => expect(search).toHaveValue(''));
      await expect(canvas.getByTestId('settings-item-profile')).toBeInTheDocument();
      await expect(args.emptySearchAction?.onClear).toHaveBeenCalled();
    });
  },
};

/** The Loja sections, as the narrow-width chip strip carries them. */
const CHIPS = [
  { id: 'profile', label: 'Perfil e marca', href: '#/config/profile' },
  { id: 'address', label: 'Endereço', href: '#/config/address' },
  { id: 'hours', label: 'Horários', href: '#/config/hours' },
  { id: 'domain', label: 'Domínio e app', href: '#/config/domain' },
  { id: 'orders', label: 'Pedidos', href: '#/config/orders' },
  { id: 'payments', label: 'Pagamentos', href: '#/config/payments' },
];

export const DrilldownBothNavigations: Story = {
  name: '🧭 Both Navigations Mounted Test',
  render: () => (
    <SettingsLayout
      title="Configuração"
      groups={MARKED}
      activeItemId="hours"
      navVariant="drilldown"
      railBreakpoint="lg"
      indexHref="#/config"
      backLabel="Voltar"
      linkComponent="a"
      sectionChips={CHIPS}
    >
      {panel}
    </SettingsLayout>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('The rail and the chip strip are both in the DOM at once', async () => {
      // The invariant the whole CSS-not-JavaScript rule exists to protect: a
      // width cannot be offered less than another width, because there is only
      // one tree and `display` is all that separates the two shapes.
      await expect(canvas.getByTestId('settings-rail')).toBeInTheDocument();
      await expect(canvas.getByTestId('settings-chips')).toBeInTheDocument();
    });

    await step('Every rail section is also reachable from the strip', async () => {
      await expect(canvas.getByTestId('settings-chip-profile')).toBeInTheDocument();
      await expect(canvas.getByTestId('settings-chip-hours')).toBeInTheDocument();
    });

    await step('The open section is marked current in the strip, and only there', async () => {
      await expect(canvas.getByTestId('settings-chip-hours')).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(canvas.getByTestId('settings-chip-profile')).not.toHaveAttribute('aria-current');
    });

    await step('Inside a section there is a way back to the index', async () => {
      await expect(canvas.getByTestId('settings-back')).toHaveAttribute('href', '#/config');
    });
  },
};

export const DrilldownIndexKeepsPanelMounted: Story = {
  name: '📋 Drilldown Index Test',
  render: () => (
    <SettingsLayout
      title="Configuração"
      groups={MARKED}
      navVariant="drilldown"
      railBreakpoint="lg"
      atIndex
      indexHref="#/config"
      linkComponent="a"
    >
      {panel}
    </SettingsLayout>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('At the index there is no strip and no back link', async () => {
      await expect(canvas.queryByTestId('settings-chips')).toBeNull();
      await expect(canvas.queryByTestId('settings-back')).toBeNull();
    });

    await step('The list and the panel are both mounted; only display separates them', async () => {
      await expect(canvas.getByTestId('settings-rail')).toBeInTheDocument();
      await expect(canvas.getByTestId('demo-panel')).toBeInTheDocument();
      await expect(canvasElement.querySelector('[data-at-index="true"]')).not.toBeNull();
    });
  },
};

export const ChipStripCentresActive: Story = {
  name: '🎯 Chip Strip Auto-Centre Test',
  render: () => (
    // Narrow on purpose: the strip has to overflow for centring to mean anything.
    //
    // `railBreakpoint` is a number past any real viewport so the narrow shape is
    // the one under test whatever width the runner opens. Naming a breakpoint
    // here would key the strip's visibility on the VIEWPORT while this wrapper
    // constrains the CONTAINER — and above that breakpoint the strip is
    // `display: none`, which reads as "it did not scroll" rather than as "it was
    // never on screen". It also exercises the numeric breakpoint, which is why
    // `railBreakpoint` takes one at all.
    <div style={{ width: 320 }}>
      <SettingsLayout
        title="Configuração"
        groups={MARKED}
        activeItemId="payments"
        navVariant="drilldown"
        railBreakpoint={100000}
        indexHref="#/config"
        linkComponent="a"
        sectionChips={CHIPS}
      >
        {panel}
      </SettingsLayout>
    </div>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const strip = canvas.getByTestId('settings-chips');

    await step('The strip clips its own overflow rather than widening the page', async () => {
      await waitFor(() => expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth));
    });

    await step('It scrolls itself to the open section without anyone clicking', async () => {
      // Smooth scrolling is animated, so this is waited on rather than read
      // once — a fixed sleep here is exactly the intermittency the gate refuses.
      await waitFor(() => expect(strip.scrollLeft).toBeGreaterThan(0));
    });
  },
};
