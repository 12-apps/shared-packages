import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, fn, waitFor, within } from 'storybook/test';

import { DayRuler } from './DayRuler';
import { DAY_RULER_LABELS } from './DayRuler.labels';

/**
 * The day ruler's gestures in a real browser (FUT-3825): the hour under the
 * pointer comes from the track's real box. The jsdom suite
 * (`__tests__/DayRuler.test.tsx`) holds the full matrix.
 */
const meta: Meta<typeof DayRuler> = {
  title: 'Data Display/DayRuler/Tests',
  component: DayRuler,
  parameters: { layout: 'fullscreen', chromatic: { disableSnapshot: false } },
  tags: ['autodocs', 'test', 'component:DayRuler'],
  args: {
    rows: [
      {
        id: 'bruno',
        label: 'Bruno Lima',
        nameAdornment: <span>Freela</span>,
        blocks: [
          { id: 'p1', start: 11, end: 19, label: '11:00–19:00', tone: 'plan', movable: true, resizable: true, breakSpan: { start: 14, end: 15 } },
        ],
      },
      { id: 'kelly', label: 'Kelly Fontoura', blocks: [] },
    ],
    now: 20.75,
    labels: DAY_RULER_LABELS['pt-BR'],
    'aria-label': 'Escala do dia',
    dataTestId: 'dr',
    onCreate: fn(),
    onMove: fn(),
    onResize: fn(),
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

/** The x of `hour` on a row's track (06:00 → 02:00). */
function xOf(track: HTMLElement, hour: number): number {
  const box = track.getBoundingClientRect();
  return box.left + ((hour - 6) / 20) * box.width;
}

const mouse = { pointerType: 'mouse', isPrimary: true } as const;

/** D-C1 + D-R1: a drag on Kelly's empty track creates from 10:00 to the pointer, snapped to 15 min. */
export const DragCreates: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const track = canvas.getByTestId('dr-track-kelly');
    fireEvent.pointerDown(track, { ...mouse, button: 0, clientX: xOf(track, 10) });
    await settle();
    fireEvent.pointerMove(window, { ...mouse, buttons: 1, clientX: xOf(track, 12.55) });
    await settle();
    await waitFor(() => expect(canvas.getByTestId('dr-preview')).toHaveTextContent('10:00–12:30'));
    fireEvent.pointerUp(window, mouse);
    await waitFor(() => expect(args.onCreate).toHaveBeenCalledWith('kelly', 10, 12.5));
  },
};

/** D-C3 + D-E10: the middle dragged +2h keeps its length, and its break travels with it. */
export const MoveCarriesTheBreak: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const track = canvas.getByTestId('dr-track-bruno');
    const block = canvas.getByTestId('dr-block-p1');
    fireEvent.pointerDown(block, { ...mouse, button: 0, clientX: xOf(track, 12) });
    await settle();
    fireEvent.pointerMove(window, { ...mouse, buttons: 1, clientX: xOf(track, 14) });
    await settle();
    await waitFor(() => expect(block).toHaveTextContent('13:00–21:00'));
    const band = canvas.getByTestId('dr-break-p1').getBoundingClientRect();
    await expect(Math.abs(band.left - xOf(track, 16))).toBeLessThan(3);
    fireEvent.pointerUp(window, mouse);
    await waitFor(() => expect(args.onMove).toHaveBeenCalledWith('p1', 13, 21));
  },
};

/** D-C4 + D-R2: the right handle dragged to 20:00 resizes the end. */
export const ResizeEnd: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const track = canvas.getByTestId('dr-track-bruno');
    fireEvent.pointerDown(canvas.getByTestId('dr-handle-r-p1'), { ...mouse, button: 0, clientX: xOf(track, 19) });
    await settle();
    fireEvent.pointerMove(window, { ...mouse, buttons: 1, clientX: xOf(track, 20) });
    await settle();
    fireEvent.pointerUp(window, mouse);
    await waitFor(() => expect(args.onResize).toHaveBeenCalledWith('p1', 11, 20));
  },
};

/**
 * FUT-3831 review: on a narrow (compact) ruler a bar's hit band covers the
 * whole bar. The end handles sit above it, so a press on the right end still
 * resizes — it does not start a move — and the middle still moves.
 */
export const ResizeEndOnACompactRuler: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 600 }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const track = canvas.getByTestId('dr-track-bruno');
    const handle = canvas.getByTestId('dr-handle-r-p1').getBoundingClientRect();
    const y = handle.top + handle.height / 2;
    // What a real press at the bar's end lands on is the handle, not the band.
    const target = document.elementFromPoint(handle.left + handle.width / 2, y) as Element;
    await expect(target).toBe(canvas.getByTestId('dr-handle-r-p1'));
    fireEvent.pointerDown(target, { ...mouse, button: 0, clientX: xOf(track, 19) });
    await settle();
    fireEvent.pointerMove(window, { ...mouse, buttons: 1, clientX: xOf(track, 20) });
    await settle();
    fireEvent.pointerUp(window, mouse);
    await waitFor(() => expect(args.onResize).toHaveBeenCalledWith('p1', 11, 20));
    await expect(args.onMove).not.toHaveBeenCalled();
    // The middle of the bar is still a move.
    const bar = canvas.getByTestId('dr-block-p1').getBoundingClientRect();
    const middle = document.elementFromPoint(bar.left + bar.width / 2, y) as Element;
    fireEvent.pointerDown(middle, { ...mouse, button: 0, clientX: xOf(track, 15) });
    await settle();
    fireEvent.pointerMove(window, { ...mouse, buttons: 1, clientX: xOf(track, 16) });
    await settle();
    fireEvent.pointerUp(window, mouse);
    await waitFor(() => expect(args.onMove).toHaveBeenCalledWith('p1', 12, 20));
  },
};

/** D-C8: Alt+→ moves by one snap, read aloud. */
export const KeyboardMove: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const block = canvas.getByTestId('dr-block-p1');
    await fireEvent.keyDown(block, { key: 'ArrowRight', altKey: true });
    await waitFor(() => expect(args.onMove).toHaveBeenCalledWith('p1', 11.25, 19.25));
    await waitFor(() => expect(canvas.getByTestId('dr-live')).toHaveTextContent('11:15–19:15'));
  },
};

/** D-E11: the adornment sits beside the name. */
export const Adornment: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const name = canvas.getByText('Bruno Lima').getBoundingClientRect();
    const tag = canvas.getByText('Freela').getBoundingClientRect();
    // Beside the name while the column has room; under it in a narrow one — never over it.
    await expect(tag.left >= name.right - 0.5 || tag.top >= name.bottom - 0.5).toBe(true);
  },
};

/**
 * R2-2: a name that is a button sits as a block of its own height — no
 * baseline strut — so the meta starts right under it, as in the prototype
 * (d02: ~22px from the name's top to the meta's).
 */
export const NameButtonKeepsTheRowTight: Story = {
  args: {
    rows: [
      { id: 'b', label: 'Bruno Lima', meta: 'em turno desde 08:26 · sem escala', onLabelClick: fn(), blocks: [] },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Bruno Lima' });
    const meta = canvas.getByText('em turno desde 08:26 · sem escala');
    await expect(getComputedStyle(button).display).toBe('block');
    const gap = meta.getBoundingClientRect().top - button.getBoundingClientRect().bottom;
    await expect(gap).toBeGreaterThanOrEqual(0);
    await expect(gap).toBeLessThanOrEqual(3);
  },
};

/**
 * On a narrow ruler a block says only its start when its range does not fit
 * it, by pixels: a 5-hour block keeps "18:00–23:00", a 1h30 one says "18:00".
 */
export const ShortLabelByWidth: Story = {
  args: {
    rows: [
      { id: 'a', label: 'Ana', blocks: [{ id: 'w', start: 18, end: 23, label: '18:00–23:00', shortLabel: '18:00', tone: 'plan' }] },
      // 1h30 on a 756px ruler: ~57px, room for "18:00" but not for the range
      // (a 1-hour bar, ~38px, leaves too little even for its start: FUT-3831).
      { id: 'c', label: 'Caio', blocks: [{ id: 'n', start: 18, end: 19.5, label: '18:00–19:30', shortLabel: '18:00', tone: 'plan' }] },
    ],
  },
  decorators: [
    (Story) => (
      <div style={{ width: 756 }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId('dr-block-w').innerText.trim()).toBe('18:00–23:00'));
    await waitFor(() => expect(canvas.getByTestId('dr-block-n').innerText.trim()).toBe('18:00'));
  },
};

/**
 * B3 (D-E4, D-E5): a stacked ruler (a 736px pane) still draws "Na escala, por
 * hora" and the hour axis, across the full width like the tracks; only a
 * phone-sized pane (560px) drops them.
 */
export const CoverageAndAxisWhileStacked: Story = {
  args: {
    coverage: [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0],
    coverageLabel: 'Na escala, por hora',
  },
  decorators: [
    (Story) => (
      <div style={{ width: 736 }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const track = canvas.getByTestId('dr-track-bruno');
    const row = canvas.getByTestId('dr-row-bruno');
    // Stacked: the track takes the row's whole width, under the name.
    await waitFor(() => expect(Math.abs(track.getBoundingClientRect().width - row.getBoundingClientRect().width)).toBeLessThanOrEqual(1));
    const coverage = canvas.getByTestId('dr-coverage');
    const axis = canvas.getByTestId('dr-axis');
    await expect(coverage).toBeVisible();
    await expect(axis).toBeVisible();
    await expect(canvas.getByText('Na escala, por hora')).toBeVisible();
    const bars = coverage.lastElementChild ?? coverage;
    await expect(Math.abs(bars.getBoundingClientRect().left - track.getBoundingClientRect().left)).toBeLessThanOrEqual(1);
    await expect(Math.abs(bars.getBoundingClientRect().width - track.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
  },
};

/** A phone-sized pane (560px): no coverage row, no axis. */
export const NoCoverageOnAPhonePane: Story = {
  args: CoverageAndAxisWhileStacked.args,
  decorators: [
    (Story) => (
      <div style={{ width: 560 }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId('dr-coverage')).not.toBeVisible());
    await waitFor(() => expect(canvas.getByTestId('dr-axis')).not.toBeVisible());
  },
};

/** The element a finger at (x, y) lands on, as the browser hit-tests it (pseudo-elements included). */
function hitAt(x: number, y: number): Element | null {
  return document.elementFromPoint(x, y);
}

/**
 * FUT-3831 (1): on a phone a 1-hour turno is a 16px bar, and its hit band was
 * only as wide as the bar. It is at least 40px wide now, centred on the bar —
 * and where two bars are closer than that, each band stops at the midpoint of
 * the gap, so a tap never opens the neighbour.
 */
export const ShortBarHitBandOnAPhone: Story = {
  args: {
    readOnly: false,
    rows: [
      { id: 'm', label: 'Marina', blocks: [{ id: 'one', start: 12, end: 13, label: '12:00–13:00', shortLabel: '12:00', tone: 'plan', movable: true }] },
      {
        id: 'p',
        label: 'Priscila',
        blocks: [
          { id: 'l', start: 12, end: 13, label: '12:00–13:00', shortLabel: '12:00', tone: 'plan' },
          { id: 'r', start: 13.5, end: 14.5, label: '13:30–14:30', shortLabel: '13:30', tone: 'plan' },
        ],
      },
    ],
  },
  decorators: [
    (Story) => (
      <div style={{ width: 320 }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const one = canvas.getByTestId('dr-block-one');
    const bar = one.getBoundingClientRect();
    await expect(bar.width).toBeLessThan(20);
    const cx = bar.left + bar.width / 2;
    const cy = bar.top + bar.height / 2;
    // 18px either side of the centre is the bar's; 23px is the track's again.
    await expect(hitAt(cx + 18, cy)).toBe(one);
    await expect(hitAt(cx - 18, cy)).toBe(one);
    await expect(hitAt(cx + 23, cy)).toBe(canvas.getByTestId('dr-track-m'));
    // A tap in the band opens the block.
    fireEvent.click(hitAt(cx + 18, cy) as Element);
    await expect(args.onBlockClick).toHaveBeenCalledWith('one');
    // A mouse drag that starts in the band still moves it.
    const track = canvas.getByTestId('dr-track-m');
    fireEvent.pointerDown(hitAt(cx + 18, cy) as Element, { ...mouse, button: 0, clientX: cx + 18 });
    await settle();
    fireEvent.pointerMove(window, { ...mouse, buttons: 1, clientX: cx + 18 + (xOf(track, 14) - xOf(track, 12)) });
    await settle();
    fireEvent.pointerUp(window, mouse);
    await waitFor(() => expect(args.onMove).toHaveBeenCalledWith('one', 14, 15));

    // Two bars 8px apart split the gap at its midpoint.
    const left = canvas.getByTestId('dr-block-l');
    const right = canvas.getByTestId('dr-block-r');
    const l = left.getBoundingClientRect();
    const r = right.getBoundingClientRect();
    const y = l.top + l.height / 2;
    const mid = (l.right + r.left) / 2;
    await expect(hitAt(mid - 1.5, y)).toBe(left);
    await expect(hitAt(mid + 1.5, y)).toBe(right);
    // Neither band reaches across the other bar.
    await expect(hitAt(r.left + r.width / 2, y)).toBe(right);
    await expect(hitAt(l.left + l.width / 2, y)).toBe(left);
  },
};

/**
 * FUT-3831 (2): one row's "Iniciar agora" no longer reserves a column down
 * the whole ruler. The actions sit under the name, and every track — the row
 * with actions and the rows without — takes the same full width, so the hours
 * still line up down the ruler and the axis above it.
 */
export const ActionsReserveNoColumn: Story = {
  args: {
    rows: [
      {
        id: 'alice',
        label: 'Alice Tanaka',
        meta: 'atrasado · era 05:30',
        group: 'Cozinha',
        blocks: [{ id: 'a1', start: 6, end: 13, label: '06:00–13:00', tone: 'late' }],
        actions: <button type="button">Iniciar agora</button>,
      },
      { id: 'bruno', label: 'Bruno Esteves', meta: 'livre', group: 'Cozinha', blocks: [] },
    ],
  },
  decorators: [
    (Story) => (
      <div style={{ width: 1280 }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('dr-row-bruno').getBoundingClientRect();
    const withActions = canvas.getByTestId('dr-track-alice').getBoundingClientRect();
    const without = canvas.getByTestId('dr-track-bruno').getBoundingClientRect();
    // No blank band at the end of the rows: the tracks reach the row's end.
    await expect(Math.abs(without.right - row.right)).toBeLessThanOrEqual(1);
    // Time-aligned: every track starts and ends at the same x, and so does the axis.
    await expect(Math.abs(withActions.left - without.left)).toBeLessThanOrEqual(1);
    await expect(Math.abs(withActions.right - without.right)).toBeLessThanOrEqual(1);
    const axis = canvas.getByTestId('dr-axis').lastElementChild as HTMLElement;
    await expect(Math.abs(axis.getBoundingClientRect().right - without.right)).toBeLessThanOrEqual(1);
    // The button sits in the name's column, under the name.
    const button = canvas.getByRole('button', { name: 'Iniciar agora' }).getBoundingClientRect();
    await expect(button.right).toBeLessThanOrEqual(withActions.left);
    await expect(button.top).toBeGreaterThanOrEqual(canvas.getByText('atrasado · era 05:30').getBoundingClientRect().bottom);
  },
};

/**
 * FUT-3831 (4): a 1-hour bar on a 900px ruler is ~33px — too short for its
 * range and too short even for "12:00" (30px of text in 21px of room). It
 * shows nothing rather than a cut text; its tooltip and its accessible name
 * still say the whole range.
 */
export const ShortBarCutsNoText: Story = {
  args: {
    rows: [
      { id: 's', label: 'Sexta', blocks: [{ id: 'x', start: 12, end: 13, label: '12:00–13:00', shortLabel: '12:00', tone: 'plan' }] },
      { id: 'w', label: 'Wide', blocks: [{ id: 'y', start: 12, end: 18, label: '12:00–18:00', shortLabel: '12:00', tone: 'plan' }] },
    ],
  },
  decorators: [
    (Story) => (
      <div style={{ width: 900 }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = canvas.getByTestId('dr-block-x');
    await expect(bar.getBoundingClientRect().width).toBeLessThan(36);
    // Nothing drawn inside a bar is cut: every text shown is as wide as its own laid-out text.
    await waitFor(() => {
      for (const span of Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-dr-text]'))) {
        if (span.offsetParent === null) continue;
        const range = document.createRange();
        range.selectNodeContents(span);
        expect(range.getBoundingClientRect().width).toBeLessThanOrEqual(span.getBoundingClientRect().width + 0.5);
      }
    });
    await waitFor(() => expect(bar.innerText.trim()).toBe(''));
    await expect(canvas.getByRole('button', { name: '12:00–13:00' })).toBe(bar);
    await expect(bar).toHaveAttribute('title', '12:00–13:00');
    // A bar with room still says its whole range.
    await waitFor(() => expect(canvas.getByTestId('dr-block-y').innerText.trim()).toBe('12:00–18:00'));
  },
};

/**
 * FUT-3831 (round 3): at 1280 the "agora" line ran through a late block's
 * label ("07:30–1|3:00"). It is drawn under the blocks now: where it crosses a
 * label, the label is on top; on a block whose fill is not opaque (the dashed
 * plan) the label takes an opaque ground of its own.
 */
export const NowLineNeverCutsALabel: Story = {
  args: {
    now: 10.25,
    rows: [
      { id: 'alice', label: 'Alice Tanaka', blocks: [{ id: 'late', start: 7.5, end: 13, label: '07:30–13:00', tone: 'late' }] },
      { id: 'bruno', label: 'Bruno Esteves', blocks: [{ id: 'plan', start: 7.5, end: 13, label: '07:30–13:00', tone: 'plan' }] },
    ],
  },
  decorators: [
    (Story) => (
      <div style={{ width: 1280 }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const nows = canvas.getAllByTestId('dr-now');
    // The line ignores the pointer (a press goes through it to the track), so
    // hit-testing skips it. For the probe alone it takes the pointer, and the
    // hit test then answers what is PAINTED on top.
    const probe = document.createElement('style');
    probe.textContent = '[data-testid="dr-now"] { pointer-events: auto !important; }';
    document.head.appendChild(probe);
    for (const id of ['late', 'plan']) {
      const bar = canvas.getByTestId(`dr-block-${id}`);
      const label = bar.querySelector<HTMLElement>('[data-dr-text="full"]') as HTMLElement;
      const text = label.getBoundingClientRect();
      const line = nows.find((now) => bar.parentElement?.contains(now)) as HTMLElement;
      const x = line.getBoundingClientRect().left + 1;
      // The premise: the line falls inside the label's text.
      await expect(x > text.left && x < text.right).toBe(true);
      // What is on top there, across the text's height, is the label — never the line.
      for (const y of [text.top + 2, text.top + text.height / 2, text.bottom - 2]) {
        const top = document.elementFromPoint(x, y);
        await expect(top === label || label.contains(top) || top === bar).toBe(true);
      }
      // The line is still drawn, and still shows above the bar.
      await expect(document.elementFromPoint(x, line.getBoundingClientRect().top + 1)).toBe(line);
    }
    probe.remove();
    // The dashed plan's faint fill is not opaque, so its label carries an opaque ground.
    const planLabel = canvas.getByTestId('dr-block-plan').querySelector<HTMLElement>('[data-dr-text="full"]') as HTMLElement;
    const ground = getComputedStyle(planLabel).backgroundColor;
    await expect(ground.startsWith('rgb(')).toBe(true);
  },
};
