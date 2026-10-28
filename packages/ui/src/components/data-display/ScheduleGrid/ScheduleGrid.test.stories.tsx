import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, fn, waitFor, within } from 'storybook/test';

import { PT_BR_UI_LABELS } from '../../../pt-BR.labels';
import { ScheduleGrid } from './ScheduleGrid';
import type { ScheduleGridCell } from './ScheduleGrid.types';

/**
 * The week grid's gestures in a real browser (FUT-3825): real layout, real
 * pointer events. The jsdom suite (`__tests__/ScheduleGrid.test.tsx`) holds
 * the full matrix; these prove the same paths where boxes and hit-testing are
 * the browser's own.
 */
const COLUMNS = ['Seg 19/10', 'Ter 20/10', 'Qua 21/10', 'Qui 22/10', 'Sex 23/10', 'Sáb 24/10', 'Dom 25/10'].map((label, day) => ({
  label,
  today: day === 0,
}));

const CELLS: Record<string, ScheduleGridCell> = {
  'ana:2': {
    blocks: [
      {
        id: 'k1',
        label: '11:00–19:00',
        note: 'pausa 14:00–15:00',
        tone: 'plan',
        movable: true,
        copyable: true,
        breakSpan: { start: 0.375, end: 0.5 },
      },
    ],
  },
  'bia:1': { blocks: [], blocked: true, blockedLabel: 'Afastamento' },
};
const cell = (rowId: string, day: number): ScheduleGridCell => CELLS[`${rowId}:${day}`] ?? { blocks: [] };

const meta: Meta<typeof ScheduleGrid> = {
  title: 'Data Display/ScheduleGrid/Tests',
  component: ScheduleGrid,
  parameters: { layout: 'fullscreen', chromatic: { disableSnapshot: false } },
  tags: ['autodocs', 'test', 'component:ScheduleGrid'],
  args: {
    columns: COLUMNS,
    groups: [
      {
        title: 'Entregas',
        rows: [
          { id: 'ana', label: 'Ana Lima', total: '8h', nameAdornment: <span>Freela</span> },
          { id: 'bia', label: 'Bia Souza', meta: 'Afastamento · licença', total: '—' },
        ],
      },
    ],
    cell,
    totalLabel: 'horas',
    createPreview: () => '08:00–14:00',
    labels: PT_BR_UI_LABELS.scheduleGrid,
    'aria-label': 'Escala da semana',
    dataTestId: 'sg',
    onCreate: fn(),
    onCopy: fn(),
    onMove: fn(),
    onBlockClick: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A real gesture's events arrive in separate tasks, so React has committed the
 * press (and attached its window listeners) before the first move. A synthetic
 * gesture fired in one task must yield to React's microtask the same way.
 */
const settle = async (): Promise<void> => {
  await Promise.resolve();
};

const press = (el: Element): void => {
  fireEvent.pointerDown(el, { pointerType: 'mouse', button: 0, isPrimary: true });
};
const over = (el: Element): void => {
  fireEvent.pointerMove(el, { pointerType: 'mouse', isPrimary: true, buttons: 1 });
};
const lift = (el: Element): void => {
  fireEvent.pointerUp(el, { pointerType: 'mouse', isPrimary: true });
  fireEvent.click(el);
};

/** G-C2 + G-R1: a drag across Ana's row creates on each crossed open day, never on her taken Wednesday. */
export const DragCreatesAlongTheRow: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const plus = (day: number) => within(canvas.getByTestId(`sg-cell-ana-${day}`)).getByRole('button');
    press(plus(1));
    await settle();
    over(canvas.getByTestId('sg-cell-ana-2'));
    await settle();
    over(canvas.getByTestId('sg-cell-ana-3'));
    await settle();
    await waitFor(() => expect(canvas.getByTestId('sg-cell-ana-3')).toHaveTextContent('08:00–14:00'));
    lift(canvas.getByTestId('sg-cell-ana-3'));
    await waitFor(() => expect(args.onCreate).toHaveBeenCalledWith('ana', [1, 3]));
  },
};

/** G-C3 + G-R2: the right grip dragged to Friday copies to Thursday and Friday. */
export const GripCopies: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    press(canvas.getByTestId('sg-grip-r-k1'));
    await settle();
    over(canvas.getByTestId('sg-cell-ana-3'));
    await settle();
    over(canvas.getByTestId('sg-cell-ana-4'));
    await settle();
    lift(canvas.getByTestId('sg-cell-ana-4'));
    await waitFor(() => expect(args.onCopy).toHaveBeenCalledWith('k1', [3, 4]));
    await expect(args.onBlockClick).not.toHaveBeenCalled();
  },
};

/** G-C4 + G-R3: the middle dropped on Bia's afastamento does nothing; on an open day it moves. */
export const MoveRefusesABlockedDay: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    press(canvas.getByTestId('sg-block-k1'));
    await settle();
    over(canvas.getByTestId('sg-cell-bia-1'));
    await settle();
    lift(canvas.getByTestId('sg-cell-bia-1'));
    await waitFor(() => expect(args.onMove).not.toHaveBeenCalled());
    press(canvas.getByTestId('sg-block-k1'));
    await settle();
    over(canvas.getByTestId('sg-cell-bia-4'));
    await settle();
    lift(canvas.getByTestId('sg-cell-bia-4'));
    await waitFor(() => expect(args.onMove).toHaveBeenCalledWith('k1', 'bia', 4));
  },
};

/** G-C8: Shift+→ copies one day, read aloud. */
export const KeyboardCopy: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const block = canvas.getByTestId('sg-block-k1');
    await fireEvent.keyDown(block, { key: 'ArrowRight', shiftKey: true });
    await waitFor(() => expect(args.onCopy).toHaveBeenCalledWith('k1', [3]));
    await waitFor(() => expect(canvas.getByTestId('sg-live')).toHaveTextContent('11:00–19:00 copiado para Qui 22/10'));
  },
};

/** G-E14 + G-E15: the break band lies inside its block at its share; the adornment sits beside the name. */
export const BreakAndAdornment: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const block = canvas.getByTestId('sg-block-k1').getBoundingClientRect();
    const band = canvas.getByTestId('sg-break-k1').getBoundingClientRect();
    await expect(band.left).toBeGreaterThan(block.left);
    await expect(band.right).toBeLessThan(block.right);
    await expect(Math.abs(band.left - block.left - block.width * 0.375)).toBeLessThan(2);
    const name = canvas.getByText('Ana Lima').getBoundingClientRect();
    const tag = canvas.getByText('Freela').getBoundingClientRect();
    // Beside the name while the column has room; under it in a narrow one — never over it.
    await expect(tag.left >= name.right - 0.5 || tag.top >= name.bottom - 0.5).toBe(true);
  },
};

/** G-C10: touch never drags. */
export const TouchDoesNotDrag: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const plus = within(canvas.getByTestId('sg-cell-ana-0')).getByRole('button');
    fireEvent.pointerDown(plus, { pointerType: 'touch', button: 0, isPrimary: true });
    await settle();
    fireEvent.pointerMove(canvas.getByTestId('sg-cell-ana-1'), { pointerType: 'touch', isPrimary: true, buttons: 1 });
    await settle();
    fireEvent.pointerUp(canvas.getByTestId('sg-cell-ana-1'), { pointerType: 'touch', isPrimary: true, buttons: 1 });
    await waitFor(() => expect(args.onCreate).not.toHaveBeenCalled());
  },
};

/** The text laid out wider than its box: cut (an ellipsis or a clip). */
const cut = (el: Element): boolean => {
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  return range.getBoundingClientRect().width > el.getBoundingClientRect().width + 0.5;
};

/**
 * B4 (G-E3): in a pane a phone gives it, the days keep a width where a block
 * says its hours — no coloured sliver — and scroll sideways under the pinned
 * names, inside the grid's own region (the page does not scroll sideways).
 */
async function phonePane(canvasElement: HTMLElement): Promise<void> {
  const canvas = within(canvasElement);
  const scroll = canvas.getByTestId('sg-scroll');
  await waitFor(() => expect(getComputedStyle(scroll).overflowX).toBe('auto'));
  await expect(canvas.getByTestId('sg-row-ana').getBoundingClientRect().width).toBeGreaterThan(scroll.getBoundingClientRect().width);
  for (const block of canvas.getAllByRole('button').filter((el) => el.hasAttribute('data-sg-block'))) {
    await expect(block.getBoundingClientRect().width).toBeGreaterThanOrEqual(80);
  }
  const label = canvas.getByTestId('sg-block-k1').querySelector('[data-sg-line="label"]');
  if (!label) throw new Error('no label line');
  await expect(cut(label)).toBe(false);
  await expect(getComputedStyle(canvas.getAllByRole('rowheader')[0] as HTMLElement).position).toBe('sticky');
  const page = canvasElement.ownerDocument.documentElement;
  // eslint-disable-next-line test-flakiness/no-viewport-dependent -- the subject is scrolling itself: the pane's width is pinned by the story's wrapper
  await expect(page.scrollWidth).toBeLessThanOrEqual(page.clientWidth);
}

const pane = (width: number) => [
  (Story: () => React.JSX.Element) => (
    <div style={{ width, maxWidth: '100%' }}>
      <Story />
    </div>
  ),
];

/** A 390px pane: no sliver, the words show, the days scroll. */
export const PhonePane390: Story = { decorators: pane(390), play: async ({ canvasElement }) => phonePane(canvasElement) };

/** A 320px pane: the same. */
export const PhonePane320: Story = { decorators: pane(320), play: async ({ canvasElement }) => phonePane(canvasElement) };

/** Every note a turno carries in the prototype and the FUT-3881 slots, the longest included. */
const TABLET_CELLS: Record<string, ScheduleGridCell> = {
  'ana:0': { blocks: [{ id: 't1', label: '20:39–00:00', note: 'Atrasado', tone: 'late', movable: true, copyable: true }] },
  'ana:1': { blocks: [{ id: 't2', label: '17:00–23:00', note: '↻ toda semana', tone: 'plan', movable: true, copyable: true }] },
  'ana:2': { blocks: [{ id: 't3', label: '11:00–17:00', note: '↻ a cada 2 semanas', tone: 'plan', movable: true, copyable: true }] },
  'ana:3': { blocks: [{ id: 't4', label: '11:00–19:00', note: 'pausa 14:00–15:00', tone: 'plan', movable: true, copyable: true }] },
  'bia:0': { blocks: [{ id: 't5', label: '21:00–23:30', note: 'Sem ninguém', tone: 'uncovered', movable: true }] },
  'bia:2': { blocks: [{ id: 't6', label: 'Em turno', note: 'desde 08:26', tone: 'onduty' }] },
  'bia:4': { blocks: [{ id: 't7', label: '18:00–22:00', note: 'Ausente', tone: 'away', movable: true }] },
};

/**
 * R2-1 (G-E3): on a tablet's container (a 768px and a 900px window less the
 * page's padding) every block's hours and note are whole — the state stays in
 * words — and the days scroll sideways when they do not fit.
 */
async function tabletPane(canvasElement: HTMLElement): Promise<void> {
  const canvas = within(canvasElement);
  const lines = Array.from(canvasElement.querySelectorAll('[data-sg-line]'));
  await expect(lines).toHaveLength(14);
  for (const line of lines) await expect({ text: line.textContent, cut: cut(line) }).toEqual({ text: line.textContent, cut: false });
  await expect(getComputedStyle(canvas.getByTestId('sg-scroll')).overflowX).toBe('auto');
}

const tabletArgs = { cell: (rowId: string, day: number): ScheduleGridCell => TABLET_CELLS[`${rowId}:${day}`] ?? { blocks: [] } };

/** A 768px window: the grid's container is 704px. */
export const TabletPane768: Story = { args: tabletArgs, decorators: pane(704), play: async ({ canvasElement }) => tabletPane(canvasElement) };

/** A 900px window: the grid's container is 836px. */
export const TabletPane900: Story = { args: tabletArgs, decorators: pane(836), play: async ({ canvasElement }) => tabletPane(canvasElement) };

/** A pane `width` wide with room under it, so the page itself can scroll. */
const laptop = (width: number) => [
  (Story: () => React.JSX.Element) => (
    <div style={{ width, maxWidth: '100%', paddingBottom: 2000 }}>
      <Story />
    </div>
  ),
];

/** Grips that are drawn: a copyable block's edge copy is there. */
const visibleGrips = (root: HTMLElement): number =>
  Array.from(root.querySelectorAll('[data-sg-grip]')).filter((el) => getComputedStyle(el).display !== 'none').length;

/**
 * R3-1 (G-C3, G-E4, G-L2): a laptop's grid beside the admin's rail and panel
 * (a 930–1030px container) is the computer frame: from 940 up it does not
 * scroll sideways, keeps its edge grips and its header sticks to the page;
 * every hours line is whole. Just below (930) the days scroll, grips kept.
 */
async function laptopPane(canvasElement: HTMLElement, scrolls: boolean): Promise<void> {
  const canvas = within(canvasElement);
  const scroll = canvas.getByTestId('sg-scroll');
  const table = canvas.getByRole('table');
  await waitFor(() => expect(getComputedStyle(scroll).overflowX).toBe(scrolls ? 'auto' : 'visible'));
  const row = canvas.getByTestId('sg-row-ana');
  if (!scrolls) await expect(row.getBoundingClientRect().width).toBeLessThanOrEqual(scroll.getBoundingClientRect().width + 0.5);
  await expect(visibleGrips(canvasElement)).toBeGreaterThan(0);
  for (const line of Array.from(canvasElement.querySelectorAll('[data-sg-line="label"]'))) {
    await expect({ text: line.textContent, cut: cut(line) }).toEqual({ text: line.textContent, cut: false });
  }
  const header = canvas.getByTestId('sg-header');
  const view = canvasElement.ownerDocument.defaultView;
  if (!view) throw new Error('no window');
  const before = header.getBoundingClientRect().top;
  view.scrollTo(0, before + 40);
  await waitFor(() => expect(Math.abs(header.getBoundingClientRect().top)).toBeLessThanOrEqual(1));
  await expect(table.getBoundingClientRect().top).toBeLessThan(-30);
  view.scrollTo(0, 0);
}

/** R4-1: the real 1280 admin with an always-visible 17px scrollbar on <main> leaves 923px. */
export const LaptopPane923: Story = { args: tabletArgs, decorators: laptop(923), play: async ({ canvasElement }) => laptopPane(canvasElement, false) };
export const LaptopPane930: Story = { args: tabletArgs, decorators: laptop(930), play: async ({ canvasElement }) => laptopPane(canvasElement, false) };
export const LaptopPane960: Story = { args: tabletArgs, decorators: laptop(960), play: async ({ canvasElement }) => laptopPane(canvasElement, false) };
export const LaptopPane990: Story = { args: tabletArgs, decorators: laptop(990), play: async ({ canvasElement }) => laptopPane(canvasElement, false) };
export const LaptopPane1030: Story = { args: tabletArgs, decorators: laptop(1030), play: async ({ canvasElement }) => laptopPane(canvasElement, false) };

/** In the scrolled range (a 900px pane) edge copy is still there. */
export const ScrolledPaneKeepsGrips: Story = {
  args: tabletArgs,
  decorators: pane(836),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(getComputedStyle(within(canvasElement).getByTestId('sg-scroll')).overflowX).toBe('auto'));
    await expect(visibleGrips(canvasElement)).toBeGreaterThan(0);
  },
};

/** A page scroll of `by` px: the header row stays at the top while the table goes past. */
async function headerSticksToThePage(canvasElement: HTMLElement, by = 40): Promise<void> {
  const canvas = within(canvasElement);
  const header = canvas.getByTestId('sg-header');
  const table = canvas.getByRole('table');
  const view = canvasElement.ownerDocument.defaultView;
  if (!view) throw new Error('no window');
  view.scrollTo(0, header.getBoundingClientRect().top + view.scrollY + by);
  await waitFor(() => expect(Math.abs(header.getBoundingClientRect().top)).toBeLessThanOrEqual(1));
  await expect(table.getBoundingClientRect().top).toBeLessThan(-(by - 10));
  view.scrollTo(0, 0);
}

/**
 * B1 (ADR 0173, G-L2): while the days scroll sideways (a 900px and a 768px
 * window's container) the header row still sticks to the PAGE, and it follows
 * the days sideways — each day's header over its own column.
 */
async function scrolledHeader(canvasElement: HTMLElement): Promise<void> {
  const canvas = within(canvasElement);
  const scroll = canvas.getByTestId('sg-scroll');
  const row = canvas.getByTestId('sg-row-ana');
  await waitFor(() => expect(getComputedStyle(scroll).overflowX).toBe('auto'));
  await expect(row.getBoundingClientRect().width).toBeGreaterThan(scroll.getBoundingClientRect().width + 1);
  // eslint-disable-next-line test-flakiness/no-viewport-dependent -- the subject is scrolling itself: the pane's width is pinned by the story's wrapper
  scroll.scrollLeft = 120;
  scroll.dispatchEvent(new Event('scroll'));
  const day = canvas.getAllByRole('columnheader')[2] as HTMLElement;
  const cellOfDay = canvas.getByTestId('sg-cell-ana-2');
  await waitFor(() => expect(Math.abs(day.getBoundingClientRect().left - cellOfDay.getBoundingClientRect().left)).toBeLessThanOrEqual(1));
  // eslint-disable-next-line test-flakiness/no-viewport-dependent -- the subject is scrolling itself: the pane's width is pinned by the story's wrapper
  scroll.scrollLeft = 0;
  scroll.dispatchEvent(new Event('scroll'));
  await headerSticksToThePage(canvasElement);
}

export const StickyHeaderWhileScrolling836: Story = { args: tabletArgs, decorators: laptop(836), play: async ({ canvasElement }) => scrolledHeader(canvasElement) };
export const StickyHeaderWhileScrolling704: Story = { args: tabletArgs, decorators: laptop(704), play: async ({ canvasElement }) => scrolledHeader(canvasElement) };

const FORTNIGHT = Array.from({ length: 14 }, (_, day) => ({ label: `Dia ${day + 1}`, today: day === 0 }));

/** B2: fourteen days in a 1216px container scroll inside the grid; the page never scrolls sideways. */
export const FourteenDays: Story = {
  args: { columns: FORTNIGHT, ...tabletArgs },
  decorators: laptop(1216),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = canvasElement.ownerDocument.documentElement;
    // eslint-disable-next-line test-flakiness/no-viewport-dependent -- the subject is scrolling itself: the pane's width is pinned by the story's wrapper
    await waitFor(() => expect(page.scrollWidth).toBeLessThanOrEqual(page.clientWidth));
    await expect(getComputedStyle(canvas.getByTestId('sg-scroll')).overflowX).toBe('auto');
    await headerSticksToThePage(canvasElement);
  },
};
