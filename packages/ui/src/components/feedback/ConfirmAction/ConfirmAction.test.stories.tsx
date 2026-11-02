import { ThemeProvider, type Theme } from '@mui/material/styles/index.js';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { PT_BR_CONFIRM_ACTION_COPY } from '../../../pt-BR';
import { Button } from '../../form/Button';

import { ConfirmAction } from './ConfirmAction';
import { createConfirmButton } from './ConfirmButton';

/** `copy` and `errorText` are required props; there are no default sentences. */
const COPY = PT_BR_CONFIRM_ACTION_COPY;

/** `ConfirmButton` is BUILT from copy, not imported ready-made. */
const ConfirmButton = createConfirmButton(COPY, COPY.defaultError);

const meta: Meta<typeof ConfirmAction> = {
  title: 'Overlays/ConfirmAction/Tests',
  component: ConfirmAction,
  parameters: {
    layout: 'centered',
    chromatic: { disableSnapshot: false },
  },
  tags: ['autodocs', 'test', 'component:ConfirmAction'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const BASE = {
  title: 'Excluir a categoria?',
  description: 'Ela vai para a lixeira e pode ser restaurada de lá.',
  confirmText: 'Excluir',
};

/** `BASE` plus the two props `ConfirmAction` cannot render without. */
const SPOKEN = { ...BASE, copy: COPY, errorText: COPY.defaultError };

/** The popup lives on `document.body`, so queries run against the whole screen. */
const body = (): ReturnType<typeof within> => within(document.body);

export const OpensWithoutRunningTheAction: Story = {
  name: '🧪 Trigger opens the popup and runs nothing',
  args: {
    ...SPOKEN,
    onConfirm: fn(),
    children: (request) => (
      <Button color="danger" onClick={request}>
        Excluir
      </Button>
    ),
  },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Excluir' }));

    await expect(body().getByText('Excluir a categoria?')).toBeInTheDocument();
    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};

export const CancelSendsNothing: Story = {
  name: '🧪 Cancel sends nothing',
  args: { ...OpensWithoutRunningTheAction.args, onConfirm: fn() },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Excluir' }));
    await userEvent.click(body().getByTestId('confirm-action-cancel-button'));

    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};

export const ConfirmRunsTheAction: Story = {
  name: '🧪 Confirm runs the action once',
  args: { ...OpensWithoutRunningTheAction.args, onConfirm: fn() },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Excluir' }));
    await userEvent.click(body().getByTestId('confirm-action-confirm-button'));

    await expect(args.onConfirm).toHaveBeenCalledTimes(1);
  },
};

export const TypeToConfirmGate: Story = {
  name: '🧪 Type-to-confirm gates the confirm button',
  args: {
    ...OpensWithoutRunningTheAction.args,
    onConfirm: fn(),
    typeToConfirm: 'Bebidas',
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Excluir' }));

    await expect(body().getByTestId('confirm-action-confirm-button')).toBeDisabled();
    await userEvent.type(body().getByTestId('confirm-action-type-to-confirm'), 'Bebidas');
    await expect(body().getByTestId('confirm-action-confirm-button')).toBeEnabled();
  },
};

export const KeyboardCancelsWithEscape: Story = {
  name: '🧪 Escape closes without running the action',
  args: { ...OpensWithoutRunningTheAction.args, onConfirm: fn() },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Excluir' }));
    await userEvent.keyboard('{Escape}');

    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};

export const HocGuardsTheWrappedButton: StoryObj<{ onClick: () => void }> = {
  name: '🧪 withConfirmation guards the wrapped button',
  render: (_args, { args }) => (
    <ConfirmButton color="danger" onClick={args.onClick} confirm={BASE}>
      Excluir
    </ConfirmButton>
  ),
  args: { onClick: fn() },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Excluir' }));
    await expect(args.onClick).not.toHaveBeenCalled();

    await userEvent.click(body().getByTestId('confirm-action-confirm-button'));
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

/**
 * A frame of `width` × 568 the dialog opens INSIDE (not portalled to the page),
 * so the space it is given is the frame's — which is what its container query
 * reads. The transform makes the frame the containing block of the dialog's
 * fixed backdrop, exactly as a phone's viewport is.
 */
const inFrame =
  (width: number): Decorator =>
  (Story) => (
    <ThemeProvider
      theme={(outer: Theme) => ({
        ...outer,
        components: { ...outer.components, MuiDialog: { defaultProps: { disablePortal: true } } },
      })}
    >
      <div style={{ width, height: 568, position: 'relative', transform: 'translateZ(0)', overflow: 'hidden' }}>
        <Story />
      </div>
    </ThemeProvider>
  );

/** The Turnos question of the review (FUT-3831): a long title, a destructive verb. */
const LONG_ASK = {
  title: 'Cancelar este turno de Admin User e os das próximas semanas?',
  description: 'A partir de amanhã, sexta 30/10, 18:00–23:30',
  confirmText: 'Cancelar turnos',
  cancelText: 'Manter',
  copy: COPY,
  errorText: COPY.defaultError,
  onConfirm: fn(),
  children: (request: () => void) => (
    <Button color="danger" onClick={request}>
      Excluir
    </Button>
  ),
};

const box = (testId: string): DOMRect => body().getByTestId(testId).getBoundingClientRect();

/**
 * FUT-3831 (3): in a 320px frame the icon column and the close button left
 * the title about two words a line. The icon now sits ABOVE the title and the
 * title takes the paper's width; the buttons, stacked, each take the row —
 * the destructive verb on top, Cancel at the bottom (the library's stacked
 * order, `components-guidelines.md`), and Cancel still first to tab to.
 */
export const NarrowFrameStacksTheTitleAndTheButtons: Story = {
  name: '🧪 At 320 the icon sits above the title and the buttons span the row',
  args: LONG_ASK,
  decorators: [inFrame(320)],
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(body().getByTestId('confirm-action-title')).toBeVisible());

    const icon = box('confirm-action-icon');
    const text = body().getByText(LONG_ASK.title).getBoundingClientRect();
    // MUI's modal marks body's other children aria-hidden; opened inside the
    // story root (not portalled), that includes the root holding it — a
    // harness artifact, so the paper is found by its role attribute instead.
    const paper = (document.querySelector('[role="alertdialog"]') as HTMLElement).getBoundingClientRect();
    await expect(icon.bottom).toBeLessThanOrEqual(text.top);
    // The title spans the paper less its 24px sides, not the ~150px left beside an icon.
    await expect(text.width).toBeGreaterThan(paper.width - 2 * 24 - 8);

    const confirm = box('confirm-action-confirm-button');
    const cancel = box('confirm-action-cancel-button');
    const actions = body().getByTestId('confirm-action-actions');
    const inner = actions.clientWidth - parseFloat(getComputedStyle(actions).paddingLeft) - parseFloat(getComputedStyle(actions).paddingRight);
    await expect(cancel.top).toBeGreaterThanOrEqual(confirm.bottom);
    await expect(Math.abs(confirm.width - inner)).toBeLessThanOrEqual(1);
    await expect(Math.abs(cancel.width - inner)).toBeLessThanOrEqual(1);
    const order = Array.from(actions.children as HTMLCollectionOf<HTMLElement>).map((el: HTMLElement) => el.getAttribute('data-testid'));
    await expect(order).toEqual(['confirm-action-cancel-button', 'confirm-action-confirm-button']);
  },
};

/** The same question given 800px: the icon stays beside the title — the frame decides, not the screen. */
export const WideFrameKeepsTheIconBeside: Story = {
  name: '🧪 At 800 the icon stays beside the title',
  args: LONG_ASK,
  decorators: [inFrame(800)],
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(body().getByTestId('confirm-action-title')).toBeVisible());

    const icon = box('confirm-action-icon');
    const text = body().getByText(LONG_ASK.title).getBoundingClientRect();
    await expect(icon.right).toBeLessThanOrEqual(text.left);
    await expect(icon.top).toBeLessThan(text.bottom);
  },
};
