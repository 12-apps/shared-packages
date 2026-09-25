import Typography from '@mui/material/Typography/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { SettingsLayout } from './SettingsLayout';
import type { SettingsNavGroup, SettingsNavItem } from './SettingsLayout.types';

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
      // eslint-disable-next-line test-flakiness/no-element-removal-check -- never rendered as a control, not removed by an action; the row itself is asserted present above
      await expect(within(inert).queryByRole('button')).toBeNull();
      await expect(canvas.getByTestId('settings-status-orders')).toBeInTheDocument();
    });
  },
};

export const SeededQuery: Story = {
  name: '🌱 Seeded Query Test',
  render: () => (
    <SettingsLayout title="Configuração" groups={GROUPS} defaultQuery="zzzz">
      {panel}
    </SettingsLayout>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('The rail opens already filtered by the seeded term', async () => {
      // The point of the prop: a screen named for a state has to be openable IN
      // that state, for a story, for a test, and for a host deep-linking `?q=`.
      await expect(canvas.getByTestId('settings-search').querySelector('input')).toHaveValue(
        'zzzz',
      );
      await expect(canvas.getByTestId('settings-empty')).toBeInTheDocument();
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
      /* eslint-disable test-flakiness/no-element-removal-check -- never rendered at the index, not removed by an action; the rail and panel are asserted present below */
      await expect(canvas.queryByTestId('settings-chips')).toBeNull();
      await expect(canvas.queryByTestId('settings-back')).toBeNull();
      /* eslint-enable test-flakiness/no-element-removal-check */
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
      // eslint-disable-next-line test-flakiness/no-viewport-dependent -- the subject under test is scrolling itself; the strip's width is pinned by the story's 320px wrapper and its shape by a numeric breakpoint past any viewport
      await waitFor(() => expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth));
    });

    await step('It scrolls itself to the open section without anyone clicking', async () => {
      // Smooth scrolling is animated, so this is waited on rather than read
      // once — a fixed sleep here is exactly the intermittency the gate refuses.
      // eslint-disable-next-line test-flakiness/no-viewport-dependent -- as above: pinned width, pinned shape, and the scroll is the behaviour being proved
      await waitFor(() => expect(strip.scrollLeft).toBeGreaterThan(0));
    });

    await step('The open chip ends inside the strip, not merely somewhere past 0', async () => {
      // `scrollLeft > 0` is also true of a strip that scrolled 3px and still
      // clips the chip it was asked to show. What the visitor needs is the chip.
      await waitFor(() => expectChipInside(canvas.getByTestId('settings-chip-payments'), strip));
    });
  },
};

// ---------------------------------------------------------------------------
// FUT-2606 — the strip keeps the open chip in view after it has mounted.
//
// Each story below reads geometry: that IS the behaviour under test. Widths are
// pinned by the story (a measured or fixed wrapper, a numeric breakpoint past
// any viewport), never taken from the runner's window.
// ---------------------------------------------------------------------------

/** Sub-pixel slack for a rect compared against a scroll offset. */
const HALF_PIXEL = 0.5;

/** The strip's visible box: its padding box, which is what `scrollLeft` pans. */
function visibleBox(strip: HTMLElement): { left: number; right: number; centre: number } {
  const left = strip.getBoundingClientRect().left + strip.clientLeft;
  return { left, right: left + strip.clientWidth, centre: left + strip.clientWidth / 2 };
}

/** Where `chip` sits in the strip's SCROLL content, independent of `scrollLeft`. */
function contentOffset(strip: HTMLElement, chip: HTMLElement): { start: number; centre: number } {
  const box = chip.getBoundingClientRect();
  // eslint-disable-next-line test-flakiness/no-viewport-dependent -- converts a rect into scroll-content coordinates; every caller pins the strip's width
  const start = box.left - visibleBox(strip).left + strip.scrollLeft;
  return { start, centre: start + box.width / 2 };
}

/** The strip's content width, up to and including its end padding after `last`. */
function contentWidth(strip: HTMLElement, last: HTMLElement): number {
  const endPadding = Number.parseFloat(getComputedStyle(strip).paddingInlineEnd);
  return contentOffset(strip, last).start + last.getBoundingClientRect().width + endPadding;
}

function expectChipInside(chip: HTMLElement, strip: HTMLElement): void {
  const box = chip.getBoundingClientRect();
  const view = visibleBox(strip);
  expect(box.left).toBeGreaterThanOrEqual(view.left - HALF_PIXEL);
  expect(box.right).toBeLessThanOrEqual(view.right + HALF_PIXEL);
}

/**
 * The storefront's account sections as its strip carries them, the open one
 * LAST — `/account/idioma`, where FUT-2606 was crawled.
 */
const ACCOUNT_CHIPS: SettingsNavItem[] = [
  { id: 'profile', label: 'Perfil' },
  { id: 'orders', label: 'Pedidos' },
  { id: 'addresses', label: 'Endereços' },
  { id: 'language', label: 'Idioma' },
];
const ACCOUNT_GROUPS: SettingsNavGroup[] = [
  { id: 'account', label: 'Minha conta', items: ACCOUNT_CHIPS },
];
const LAST_CHIP = 'language';

/**
 * What the strip has to spare at mount. Under the 6px the ticket allows and
 * well under the 14px a status marker adds (an 8px dot and the chip's 6px gap),
 * so the marker leaves the strip overflowing by 11px — past its 2px end padding.
 */
const SPARE_AT_MOUNT = 3;

/** Wide enough that the measuring copy never overflows. */
const PROBE_WIDTH = 1200;

/** A numeric breakpoint past any viewport: the narrow shape, whatever the runner opens. */
const ALWAYS_NARROW = 100000;

/** How wide the layout has to be for the four chips to fit exactly, measured on a copy. */
function fittedWidth(probe: HTMLElement): number {
  const strip = probe.querySelector<HTMLElement>('[data-testid="probe-chips"]');
  const last = probe.querySelector<HTMLElement>('[data-testid="probe-chip-language"]');
  if (!strip || !last) return PROBE_WIDTH;
  const aroundStrip = probe.getBoundingClientRect().width - strip.clientWidth;
  return aroundStrip + contentWidth(strip, last);
}

/** The Perfil chip before and after the profile read resolves — the marker is late. */
function accountChips(profileRead: boolean, asButtons: boolean): SettingsNavItem[] {
  return ACCOUNT_CHIPS.map((item) => ({
    ...item,
    // No `href` means the chip renders as a button and a tap calls `onSelectItem`.
    ...(asButtons ? {} : { href: `#/account/${item.id}` }),
    ...(item.id === 'profile' && profileRead ? { status: 'ok' as const, statusLabel: 'Completo' } : {}),
  }));
}

/**
 * A strip whose content WIDENS after mount with the same ids: the Perfil chip
 * gains its status marker when the profile read resolves, as the origin host's
 * storefront account pages do.
 *
 * The layout's width is measured rather than typed: a copy renders once, wide,
 * and the real strip then mounts at exactly its content width plus
 * `SPARE_AT_MOUNT`. A typed width would hold that margin on one machine's fonts
 * and not on the next — and the test is only meaningful INSIDE that margin.
 */
function LateMarkerStrip({
  opensOn,
  asButtons,
}: {
  opensOn: string;
  asButtons: boolean;
}): React.JSX.Element {
  const [activeItemId, setActiveItemId] = useState(opensOn);
  const [profileRead, setProfileRead] = useState(false);
  const [width, setWidth] = useState<number | null>(null);
  const probeRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const probe = probeRef.current;
    if (probe) setWidth(fittedWidth(probe) + SPARE_AT_MOUNT);
  }, []);

  const layout = (testIdPrefix: string, open: string): React.JSX.Element => (
    <SettingsLayout
      title="Minha conta"
      groups={ACCOUNT_GROUPS}
      activeItemId={open}
      navVariant="drilldown"
      railBreakpoint={ALWAYS_NARROW}
      indexHref="#/account"
      linkComponent="a"
      sectionChips={accountChips(profileRead, asButtons)}
      onSelectItem={setActiveItemId}
      testIdPrefix={testIdPrefix}
    >
      {panel}
    </SettingsLayout>
  );

  if (width === null) {
    // Measured with the LAST chip open: that is the state the strip has to fit.
    return (
      <div ref={probeRef} style={{ width: PROBE_WIDTH, visibility: 'hidden' }}>
        {layout('probe', LAST_CHIP)}
      </div>
    );
  }

  return (
    <div>
      <button type="button" data-testid="resolve-profile" onClick={() => setProfileRead(true)}>
        Profile read resolves
      </button>
      <div style={{ width }}>{layout('settings', activeItemId)}</div>
    </div>
  );
}

/** At mount the four chips fit, with less to spare than a marker will take. */
async function expectFitsWithLittleToSpare(strip: HTMLElement, last: HTMLElement): Promise<void> {
  // eslint-disable-next-line test-flakiness/no-viewport-dependent -- the strip's width is measured and pinned by the story itself; this is the precondition the story exists for
  const spare = strip.clientWidth - contentWidth(strip, last);
  await expect(spare).toBeGreaterThan(0);
  await expect(spare).toBeLessThan(6);
}

/** The profile read resolves; the Perfil marker widens the content past the strip. */
async function resolveProfile(canvas: ReturnType<typeof within>, strip: HTMLElement): Promise<void> {
  await userEvent.click(canvas.getByTestId('resolve-profile'));
  await waitFor(() => expect(canvas.getByTestId('settings-chip-status-profile')).toBeInTheDocument());
  // eslint-disable-next-line test-flakiness/no-viewport-dependent -- pinned width, as above; the overflow is the change under test
  await waitFor(() => expect(strip.scrollWidth - strip.clientWidth).toBeGreaterThanOrEqual(8));
}

export const ChipStripRecentresWhenContentWidens: Story = {
  name: '🎯 Chip Strip Re-centres After A Late Marker Test',
  render: () => <LateMarkerStrip opensOn={LAST_CHIP} asButtons={false} />,
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const strip = await canvas.findByTestId('settings-chips');
    const last = canvas.getByTestId(`settings-chip-${LAST_CHIP}`);

    await step('At mount the open chip is last and everything fits, just', async () => {
      await expect(last).toHaveAttribute('aria-current', 'page');
      await expectFitsWithLittleToSpare(strip, last);
    });

    await step('A chip before it gains its status marker after mount', async () => {
      await resolveProfile(canvas, strip);
    });

    await step('The open chip still ends inside the strip', async () => {
      await waitFor(() => expectChipInside(last, strip));
    });
  },
};

export const ChipStripRecentresAfterATap: Story = {
  name: '👆 Chip Strip Re-centres After A Tap Then A Late Marker Test',
  render: () => <LateMarkerStrip opensOn="profile" asButtons />,
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const strip = await canvas.findByTestId('settings-chips');
    const last = canvas.getByTestId(`settings-chip-${LAST_CHIP}`);

    await step('The visitor taps the last chip, and it becomes the open one', async () => {
      await userEvent.click(last);
      await waitFor(() => expect(last).toHaveAttribute('aria-current', 'page'));
      // Same strip, same element: the strip stays mounted across the navigation.
      await expect(canvas.getByTestId('settings-chips')).toBe(strip);
      await expectFitsWithLittleToSpare(strip, last);
    });

    await step('A chip before it then gains its status marker', async () => {
      await resolveProfile(canvas, strip);
    });

    await step('The chip the visitor tapped still ends inside the strip', async () => {
      // A tap is not a scroll: a strip that counted it as one would stop
      // re-centring here and leave the chip clipped.
      await waitFor(() => expectChipInside(last, strip));
    });
  },
};

/**
 * How far the strip sits from the positioned ancestor a host wraps it in. Any
 * non-zero offset shows the defect; 24 is a common gutter.
 */
const HOST_GUTTER = 24;

export const ChipStripCentresMiddleChipInOffsetHost: Story = {
  name: '📐 Chip Strip Centres A Middle Chip In An Offset Host Test',
  render: () => (
    // The 320px wrapper and numeric breakpoint of `ChipStripCentresActive`, with
    // the strip inside a POSITIONED ancestor that offsets it. `offsetLeft` is
    // measured from that ancestor, not from the strip.
    <div style={{ width: 320 }}>
      <div style={{ position: 'relative', paddingInlineStart: HOST_GUTTER }}>
        <SettingsLayout
          title="Configuração"
          groups={MARKED}
          activeItemId="hours"
          navVariant="drilldown"
          railBreakpoint={ALWAYS_NARROW}
          indexHref="#/config"
          linkComponent="a"
          sectionChips={CHIPS}
        >
          {panel}
        </SettingsLayout>
      </div>
    </div>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const strip = canvas.getByTestId('settings-chips');
    const chip = canvas.getByTestId('settings-chip-hours');

    await step('Neither the right target nor one off by the offset is clamped', async () => {
      // The precondition the assertion below needs: were either target clamped
      // to 0 or to the maximum, a wrong one could land in the same place.
      /* eslint-disable test-flakiness/no-viewport-dependent -- widths pinned by the story's wrapper and numeric breakpoint; the geometry is the subject */
      const target = contentOffset(strip, chip).centre - strip.clientWidth / 2;
      const max = strip.scrollWidth - strip.clientWidth;
      /* eslint-enable test-flakiness/no-viewport-dependent */
      await expect(strip.offsetLeft).toBeGreaterThanOrEqual(HOST_GUTTER);
      await expect(target).toBeGreaterThan(0);
      await expect(target + strip.offsetLeft).toBeLessThan(max);
    });

    await step("The open chip's centre lands on the strip's centre", async () => {
      await waitFor(() =>
        expect(
          Math.abs(
            chip.getBoundingClientRect().left +
              chip.getBoundingClientRect().width / 2 -
              visibleBox(strip).centre,
          ),
        ).toBeLessThanOrEqual(1),
      );
    });
  },
};

/** A scroll the visitor made: the event that says so, then the scroll itself. */
type VisitorGesture = 'wheel' | 'drag';

/**
 * The events that say a visitor is scrolling the strip, in the order a real
 * wheel or drag arrives in. The scroll itself is the caller's: an untrusted event
 * has no default action.
 */
function visitorGestureStarts(strip: HTMLElement, gesture: VisitorGesture): void {
  const firstChip = strip.firstElementChild ?? strip;
  if (gesture === 'wheel') {
    strip.dispatchEvent(new WheelEvent('wheel', { deltaX: -240, bubbles: true, cancelable: true }));
    return;
  }
  firstChip.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
  firstChip.dispatchEvent(new Event('touchstart', { bubbles: true }));
  // The browser takes the gesture over as a pan.
  firstChip.dispatchEvent(new PointerEvent('pointercancel', { pointerType: 'touch', bubbles: true }));
}

/** The finger lifts — heard on the window, where a gesture that left the strip ends. */
function fingerLifts(strip: HTMLElement): void {
  (strip.firstElementChild ?? strip).dispatchEvent(new Event('touchend', { bubbles: true }));
}

/**
 * Scroll the strip to its start the way a visitor would.
 *
 * An untrusted event has no default action, so the story performs the scroll the
 * browser would have performed — AFTER the event that says a visitor is doing it,
 * which is the order a real wheel or drag arrives in.
 */
async function visitorScrollsToStart(strip: HTMLElement, gesture: VisitorGesture): Promise<void> {
  const scrolled = new Promise<void>((resolve) => {
    strip.addEventListener('scroll', () => resolve(), { once: true });
  });
  visitorGestureStarts(strip, gesture);
  // eslint-disable-next-line test-flakiness/no-viewport-dependent -- the default action an untrusted event lacks; the strip's width is pinned by the story
  strip.scrollLeft = 0;
  await scrolled;
  if (gesture === 'drag') fingerLifts(strip);
}

/**
 * How long the strip has to go without a `scroll` to count as at rest. Longer
 * than any gap between two frames of a smooth scroll on a loaded runner.
 */
const QUIET_MS = 300;

/**
 * Where the strip comes to rest: a whole `QUIET_MS` poll with no `scroll` heard.
 * Heard rather than read — two equal `scrollLeft` reads can straddle a frame the
 * animation had not taken yet — and waited on, never slept: a smooth scroll's
 * length is the browser's business.
 */
async function settledScrollLeft(strip: HTMLElement): Promise<number> {
  const heard = { scrolls: 0, atLastPoll: -1 };
  const onScroll = (): void => {
    heard.scrolls += 1;
  };
  strip.addEventListener('scroll', onScroll);
  try {
    await waitFor(
      () => {
        const quiet = heard.scrolls === heard.atLastPoll;
        heard.atLastPoll = heard.scrolls;
        expect(quiet).toBe(true);
      },
      { interval: QUIET_MS, timeout: 5000 },
    );
  } finally {
    strip.removeEventListener('scroll', onScroll);
  }
  // eslint-disable-next-line test-flakiness/no-viewport-dependent -- pinned width; the scroll is the subject
  return strip.scrollLeft;
}

/**
 * The six Loja chips in a 320px layout; the Perfil chip gains its marker when
 * the story resolves the profile read, and the Endereço chip when it resolves
 * the address read. `startsWide` opens it at a width where
 * every chip fits — nothing to scroll — until the story narrows it, so the
 * strip's own smooth scroll starts at a moment the story chose.
 */
/** The chips whose status marker a story can make arrive late, in `VisitorScrolledStrip`. */
const LATE_READS = ['profile', 'address'] as const;

function VisitorScrolledStrip({
  opensOn,
  startsWide = false,
}: {
  opensOn: string;
  startsWide?: boolean;
}): React.JSX.Element {
  const [wide, setWide] = useState(startsWide);
  const [read, setRead] = useState<readonly string[]>([]);
  const chips = CHIPS.map((item) =>
    read.includes(item.id) ? { ...item, status: 'ok' as const, statusLabel: 'Ligado' } : item,
  );
  return (
    <div>
      <button type="button" data-testid="narrow-strip" onClick={() => setWide(false)}>
        Narrow the strip
      </button>
      {LATE_READS.map((id) => (
        <button
          key={id}
          type="button"
          data-testid={`resolve-${id}`}
          onClick={() => setRead((done) => [...done, id])}
        >
          {`${id} read resolves`}
        </button>
      ))}
      <div style={{ width: wide ? PROBE_WIDTH : 320 }}>
        <SettingsLayout
          title="Configuração"
          groups={MARKED}
          activeItemId={opensOn}
          navVariant="drilldown"
          railBreakpoint={ALWAYS_NARROW}
          indexHref="#/config"
          linkComponent="a"
          sectionChips={chips}
        >
          {panel}
        </SettingsLayout>
      </div>
    </div>
  );
}

/**
 * The strip reads 0 across several polls. Held rather than read once, so a
 * re-centre that starts a frame or two after a resize is caught rather than
 * raced; every read is kept, so one that moved fails for good instead of being
 * retried away.
 */
async function expectHeldAtStart(strip: HTMLElement): Promise<void> {
  const reads: number[] = [];
  await waitFor(() => {
    // eslint-disable-next-line test-flakiness/no-viewport-dependent -- pinned width; the scroll is the subject
    reads.push(strip.scrollLeft);
    expect(reads.filter((read) => read !== 0)).toEqual([]);
    expect(reads.length).toBeGreaterThanOrEqual(6);
  });
}

/** A late read resolves and its chip — before the open one — widens. */
async function contentWidens(
  canvas: ReturnType<typeof within>,
  id: (typeof LATE_READS)[number] = 'profile',
): Promise<void> {
  await userEvent.click(canvas.getByTestId(`resolve-${id}`));
  await waitFor(() => expect(canvas.getByTestId(`settings-chip-status-${id}`)).toBeInTheDocument());
}

/** The strip scrolls itself onto the open chip and comes to rest there. */
async function settlesOnOpenChip(strip: HTMLElement): Promise<void> {
  // eslint-disable-next-line test-flakiness/no-viewport-dependent -- pinned width; the scroll is the subject
  await waitFor(() => expect(strip.scrollLeft).toBeGreaterThan(0));
  await settledScrollLeft(strip);
}

function keepsVisitorScrollPlay(gesture: VisitorGesture): Story['play'] {
  return async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const strip = canvas.getByTestId('settings-chips');

    await step('The strip settles on the open chip by itself', async () => {
      // Settled = scrolled, and at rest: the visitor's scroll below must not
      // race the strip's own animation.
      await settlesOnOpenChip(strip);
    });

    await step(`The visitor scrolls it back to the start (${gesture})`, async () => {
      await visitorScrollsToStart(strip, gesture);
    });

    await step('The content widens after that', async () => {
      await contentWidens(canvas);
    });

    await step('The strip stays where the visitor put it', async () => {
      await expectHeldAtStart(strip);
    });
  };
}

export const ChipStripKeepsVisitorWheelScroll: Story = {
  name: '🖱️ Chip Strip Keeps A Wheel Scroll Test',
  render: () => <VisitorScrolledStrip opensOn="hours" />,
  play: keepsVisitorScrollPlay('wheel'),
};

export const ChipStripKeepsVisitorDragScroll: Story = {
  name: '✋ Chip Strip Keeps A Drag Scroll Test',
  render: () => <VisitorScrolledStrip opensOn="hours" />,
  play: keepsVisitorScrollPlay('drag'),
};

// ---------------------------------------------------------------------------
// FUT-2606 review — the strip's OWN smooth scroll is not the visitor's.
//
// The strip opens wide (nothing to scroll), is narrowed, and scrolls itself to
// the open chip — the LAST one — over many `scroll` ticks. Something a visitor
// does arrives on the first of those ticks. What it was decides whether the
// strip may re-centre later.
// ---------------------------------------------------------------------------

/** The open chip for these stories: the last, so a missed re-centre clips it. */
const LAST_LOJA_CHIP = 'payments';

/** Where the strip was, and how far it could go, on its first scroll tick. */
interface FirstTick {
  at: number;
  max: number;
}

/**
 * Run `act` on the strip's first `scroll` tick — inside its own smooth scroll —
 * and report where that tick found it.
 */
function onFirstScrollTick(strip: HTMLElement, act: () => void): Promise<FirstTick> {
  return new Promise((resolve) => {
    const tick = (): void => {
      // eslint-disable-next-line test-flakiness/no-viewport-dependent -- pinned width; where the animation was is the precondition
      resolve({ at: strip.scrollLeft, max: strip.scrollWidth - strip.clientWidth });
      act();
    };
    strip.addEventListener('scroll', tick, { once: true });
  });
}

/** Narrow the strip and let it scroll itself, `act` landing mid-animation. */
async function narrowWhile(
  canvas: ReturnType<typeof within>,
  strip: HTMLElement,
  act: () => void,
): Promise<{ first: FirstTick; rest: number }> {
  // eslint-disable-next-line test-flakiness/no-viewport-dependent -- the story opens wide on purpose; nothing to scroll is the precondition
  await expect(strip.scrollWidth).toBe(strip.clientWidth);
  const firstTick = onFirstScrollTick(strip, act);
  await userEvent.click(canvas.getByTestId('narrow-strip'));
  const first = await firstTick;
  return { first, rest: await settledScrollLeft(strip) };
}

/** Not a strip scroll: something a visitor does while the strip scrolls itself. */
type NotAStripScroll = 'key' | 'page-touch';

/**
 * Tab pressed on a chip, or a finger put on one to scroll the PAGE — which the
 * browser takes over as a pan (`pointercancel`) and which moves the strip not
 * at all. Neither is the visitor scrolling the strip.
 */
function visitorDoesSomethingElse(strip: HTMLElement, input: NotAStripScroll): void {
  const chip = strip.firstElementChild ?? strip;
  if (input === 'key') {
    chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    return;
  }
  chip.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
  chip.dispatchEvent(new Event('touchstart', { bubbles: true }));
  chip.dispatchEvent(new PointerEvent('pointercancel', { pointerType: 'touch', bubbles: true }));
}

function recentresAfterInputMidScrollPlay(input: NotAStripScroll): Story['play'] {
  return async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const strip = canvas.getByTestId('settings-chips');
    const open = canvas.getByTestId(`settings-chip-${LAST_LOJA_CHIP}`);

    await step(`Narrowed, it scrolls itself; a ${input} arrives mid-scroll`, async () => {
      const { first, rest } = await narrowWhile(canvas, strip, () =>
        visitorDoesSomethingElse(strip, input),
      );
      // The input landed INSIDE the animation, not after it: that is the race.
      await expect(first.at).toBeLessThan(rest);
      if (input === 'page-touch') fingerLifts(strip);
      await expectChipInside(open, strip);
    });

    await step('The content widens after that', async () => {
      await contentWidens(canvas);
    });

    await step('The strip re-centres: the open chip ends inside it', async () => {
      // A strip that took its own animation for the visitor's scroll would stop
      // re-centring here and leave the chip clipped by the marker's width.
      await waitFor(() => expectChipInside(open, strip));
    });
  };
}

export const ChipStripRecentresAfterAKeyMidScroll: Story = {
  name: '⌨️ Chip Strip Re-centres After A Key Mid-Scroll Test',
  render: () => <VisitorScrolledStrip opensOn={LAST_LOJA_CHIP} startsWide />,
  play: recentresAfterInputMidScrollPlay('key'),
};

export const ChipStripRecentresAfterAPageTouchMidScroll: Story = {
  name: '👆 Chip Strip Re-centres After A Page-Scroll Touch Mid-Scroll Test',
  render: () => <VisitorScrolledStrip opensOn={LAST_LOJA_CHIP} startsWide />,
  play: recentresAfterInputMidScrollPlay('page-touch'),
};

function keepsScrollMidAnimationPlay(gesture: VisitorGesture): Story['play'] {
  return async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const strip = canvas.getByTestId('settings-chips');

    await step(`Narrowed, it scrolls itself; the visitor ${gesture}s it back mid-scroll`, async () => {
      const { first, rest } = await narrowWhile(canvas, strip, () => {
        visitorGestureStarts(strip, gesture);
        // The default action an untrusted event lacks, ANIMATED: Chromium can let
        // the strip's in-flight smooth scroll land one more frame after an
        // instant scroll (seen: 0, then 16, and no `scrollend`), while a smooth
        // one replaces it cleanly. A wheel's own scroll is animated anyway.
        strip.scrollTo({ left: 0, behavior: 'smooth' });
      });
      // Mid-animation: the strip had started moving and had further to go.
      await expect(first.at).toBeGreaterThan(0);
      await expect(first.at).toBeLessThan(first.max);
      await expect(rest).toBe(0);
      if (gesture === 'drag') fingerLifts(strip);
    });

    await step('The content widens after that', async () => {
      await contentWidens(canvas);
    });

    await step('The strip stays where the visitor put it', async () => {
      await expectHeldAtStart(strip);
    });
  };
}

export const ChipStripKeepsWheelMidScroll: Story = {
  name: '🖱️ Chip Strip Keeps A Wheel Made Mid-Scroll Test',
  render: () => <VisitorScrolledStrip opensOn={LAST_LOJA_CHIP} startsWide />,
  play: keepsScrollMidAnimationPlay('wheel'),
};

export const ChipStripKeepsDragMidScroll: Story = {
  name: '✋ Chip Strip Keeps A Drag Made Mid-Scroll Test',
  render: () => <VisitorScrolledStrip opensOn={LAST_LOJA_CHIP} startsWide />,
  play: keepsScrollMidAnimationPlay('drag'),
};

export const ChipStripKeepsKeyScrollARecentreRaced: Story = {
  name: '⌨️ Chip Strip Keeps A Key Scroll A Re-centre Raced Test',
  render: () => <VisitorScrolledStrip opensOn="hours" />,
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const strip = canvas.getByTestId('settings-chips');

    await step('The strip settles on the open chip by itself', async () => {
      await settlesOnOpenChip(strip);
    });

    await step('A key press, then a re-centre, then the key\'s own scroll', async () => {
      // The race: between a visitor's key press and the first tick of the
      // scroll it causes, a resize re-centres the strip. Clearing the key's
      // arming there left the visitor's scroll unclaimed, read as the strip's.
      const recentre = onFirstScrollTick(strip, () =>
        // The key's default action, which an untrusted event lacks — smooth, as
        // Chromium scrolls on an arrow key.
        strip.scrollTo({ left: 0, behavior: 'smooth' }),
      );
      const chip = strip.firstElementChild ?? strip;
      chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      // Same task as the key press: the resize reaches the strip before the
      // key's scroll does.
      // Dispatched rather than `userEvent.click`ed: that one yields between its
      // events, and a frame could slip in.
      canvas
        .getByTestId('resolve-profile')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      // The strip's own re-centre started (nothing else scrolls it here), and
      // the key's scroll then took the strip back to the start.
      await expect((await recentre).at).toBeGreaterThan(0);
      await expect(await settledScrollLeft(strip)).toBe(0);
    });

    await step('The content widens again', async () => {
      await contentWidens(canvas, 'address');
    });

    await step('The strip stays where the visitor put it', async () => {
      await expectHeldAtStart(strip);
    });
  },
};
