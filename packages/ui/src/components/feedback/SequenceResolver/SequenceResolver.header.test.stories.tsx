import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { SequenceResolver } from './SequenceResolver';
import type { SequenceItem, SequenceOverview, SequenceResolverLabels } from './SequenceResolver.types';

/**
 * The resolver's header in a real browser, at the chrome each phone leaves it
 * (the sheet's inset and padding take 80px: 320 → 240, 360 → 280, 375 → 295,
 * 390 → 310). The dialog is sized to give the chrome exactly that width; the
 * header's layouts are container queries on it.
 *
 * - WITHOUT "Ver todos" (the Estoque resolver, FUT-3672) the header is the one
 *   it always had: Back says its word, the label takes its own row when it
 *   must, the bar spans the chrome.
 * - WITH it (FUT-3825, S-L1): Back · "Ver todos (2)" · × on ONE line with
 *   nothing cut; on a narrow chrome Back is its chevron alone and the label
 *   sits on its own line under the full-width bar.
 */
interface Problem extends SequenceItem {
  who: string;
}

const QUEUE: Problem[] = [
  { key: 'late:luiz', kindLabel: 'Atrasado', who: 'Luiz entrega' },
  { key: 'away:talita', kindLabel: 'Avisou que não vai', who: 'Talita Siqueira' },
];

const LABELS: SequenceResolverLabels = {
  back: 'Voltar',
  backAccessible: 'Voltar ao problema anterior',
  close: 'Fechar',
  skip: 'Depois',
  step: (position, total) => `${position} de ${total}`,
  introStep: 'Problemas',
  doneStep: 'Pronto',
  progress: 'Progresso',
  failed: 'Não deu certo. Tente de novo.',
};

/** The Estoque resolver's own label, the longest one it writes. */
const LONG_LABELS: SequenceResolverLabels = {
  ...LABELS,
  step: (position, total) => `Problema ${position} de ${total} · Para repor na exposição do salão`,
};

const OVERVIEW: SequenceOverview = {
  label: (total) => `Ver todos (${total})`,
  title: '2 problemas a resolver',
  categories: [
    { label: 'Atrasado · 1', keys: ['late:luiz'] },
    { label: 'Avisou que não vai · 1', keys: ['away:talita'] },
  ],
  pickLabel: 'Resolver',
  continueLabel: 'Continuar em sequência',
};

const meta: Meta<typeof SequenceResolver<Problem, string>> = {
  title: 'Feedback/SequenceResolver/Header/Tests',
  component: SequenceResolver<Problem, string>,
  parameters: { layout: 'fullscreen' },
  tags: ['test', 'component:SequenceResolver'],
  args: {
    open: true,
    onClose: fn(),
    queue: QUEUE,
    renderStep: (item, api) => ({
      content: <h3 {...api.titleProps}>{item.who}</h3>,
      primary: { label: 'Resolver agora', onClick: () => api.resolve(item.key) },
    }),
    done: { title: 'Tudo resolvido', confirmLabel: 'Fechar' },
    labels: LABELS,
    dataTestId: 'sr',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** The text laid out wider than its box: cut (an ellipsis or a clip). */
const cut = (el: HTMLElement): boolean => {
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  return range.getBoundingClientRect().width > el.getBoundingClientRect().width + 0.5;
};
const box = (el: Element): DOMRect => el.getBoundingClientRect();
const mid = (el: Element): number => box(el).top + box(el).height / 2;

type Page = ReturnType<typeof within>;

/** Move to the second step (Back shows), then give the header row `width` px. */
async function secondStepAt(canvasElement: HTMLElement, width: number, viaOverview: boolean): Promise<{ page: Page; row: HTMLElement }> {
  const page = within(canvasElement.ownerDocument.body);
  if (viaOverview) {
    await userEvent.click(await page.findByTestId('sr-see-all'));
    await userEvent.click(await page.findByTestId('sr-overview-pick-1'));
  } else {
    await userEvent.click(await page.findByRole('button', { name: 'Resolver agora' }));
  }
  const close = await page.findByTestId('sr-close');
  await page.findByTestId('sr-back');
  const row = close.parentElement;
  if (!row) throw new Error('no header row');
  const paper = page.getByRole('dialog');
  const inset = box(paper).width - box(row).width;
  paper.style.width = `${width + inset}px`;
  paper.style.minWidth = '0';
  paper.style.maxWidth = 'none';
  await waitFor(() => expect(Math.round(box(row).width)).toBe(width));
  return { page, row };
}

/** Nothing of the header past the row's right edge; the bar the row's whole width. */
async function fitsTheRow(page: Page, row: HTMLElement): Promise<void> {
  for (const id of ['sr-back', 'sr-step-label', 'sr-close', 'sr-progress']) {
    await expect(box(page.getByTestId(id)).right).toBeLessThanOrEqual(box(row).right + 1);
  }
  await expect(Math.abs(box(page.getByTestId('sr-progress')).width - box(row).width)).toBeLessThanOrEqual(1);
}

/** No overview: Back keeps its word and the bar spans the chrome. */
async function plainAt(canvasElement: HTMLElement, width: number): Promise<void> {
  const { page, row } = await secondStepAt(canvasElement, width, false);
  const back = page.getByTestId('sr-back');
  await expect(back).toHaveTextContent('Voltar');
  await expect(cut(back)).toBe(false);
  await expect(page.getByTestId('sr-step-label')).toHaveTextContent('2 de 2');
  await fitsTheRow(page, row);
}

export const NoOverviewAt320: Story = { play: async ({ canvasElement }) => plainAt(canvasElement, 240) };
export const NoOverviewAt375: Story = { play: async ({ canvasElement }) => plainAt(canvasElement, 295) };

/** No overview, the Estoque resolver's long label at 320: it wraps under Back, the bar stays whole. */
export const NoOverviewLongLabelAt320: Story = {
  args: { labels: LONG_LABELS },
  play: async ({ canvasElement }) => {
    const { page, row } = await secondStepAt(canvasElement, 240, false);
    await expect(page.getByTestId('sr-back')).toHaveTextContent('Voltar');
    await expect(cut(page.getByTestId('sr-step-label'))).toBe(false);
    await fitsTheRow(page, row);
  },
};

/** With "Ver todos" on a narrow chrome: the header's line, then the bar, then the label on its own line. */
async function seeAllNarrowAt(canvasElement: HTMLElement, width: number): Promise<void> {
  const { page, row } = await secondStepAt(canvasElement, width, true);
  const back = page.getByRole('button', { name: 'Voltar ao problema anterior' });
  const seeAll = page.getByRole('button', { name: 'Ver todos (2)' });
  const close = page.getByTestId('sr-close');
  const label = page.getByTestId('sr-step-label');
  const bar = page.getByTestId('sr-progress');
  await waitFor(() => expect(Math.round(box(back).width)).toBe(44));
  await waitFor(() => expect(back.querySelector('[data-back-word]')).not.toBeVisible());
  await expect(Math.max(mid(back), mid(seeAll), mid(close)) - Math.min(mid(back), mid(seeAll), mid(close))).toBeLessThanOrEqual(4);
  await expect(seeAll).toHaveTextContent('Ver todos (2)');
  await expect(cut(seeAll)).toBe(false);
  await expect(label).toHaveTextContent('2 de 2');
  await expect(cut(label)).toBe(false);
  await expect(box(label).top).toBeGreaterThanOrEqual(box(bar).bottom);
  await expect(page.getAllByText('2 de 2')).toHaveLength(1);
  await fitsTheRow(page, row);
}

export const SeeAllAt320: Story = { args: { overview: OVERVIEW }, play: async ({ canvasElement }) => seeAllNarrowAt(canvasElement, 240) };
export const SeeAllAt360: Story = { args: { overview: OVERVIEW }, play: async ({ canvasElement }) => seeAllNarrowAt(canvasElement, 280) };

/** With "Ver todos" at 390: Back says its word, the label is on the header's line, whole. */
export const SeeAllAt390: Story = {
  args: { overview: OVERVIEW },
  play: async ({ canvasElement }) => {
    const { page, row } = await secondStepAt(canvasElement, 310, true);
    const label = page.getByTestId('sr-step-label');
    const close = page.getByTestId('sr-close');
    await waitFor(() => expect(page.getByTestId('sr-back').querySelector('[data-back-word]')).toBeVisible());
    await expect(Math.abs(mid(label) - mid(close))).toBeLessThanOrEqual(4);
    await expect(cut(label)).toBe(false);
    await expect(cut(page.getByRole('button', { name: 'Ver todos (2)' }))).toBe(false);
    await fitsTheRow(page, row);
  },
};

/** With "Ver todos" and a long label at 320: the label wraps on its own line under the bar, never beside it. */
export const SeeAllLongLabelAt320: Story = {
  args: { overview: OVERVIEW, labels: LONG_LABELS },
  play: async ({ canvasElement }) => {
    const { page, row } = await secondStepAt(canvasElement, 240, true);
    const label = page.getByTestId('sr-step-label');
    await waitFor(() => expect(box(label).top).toBeGreaterThanOrEqual(box(page.getByTestId('sr-progress')).bottom));
    await expect(cut(label)).toBe(false);
    await expect(cut(page.getByRole('button', { name: 'Ver todos (2)' }))).toBe(false);
    await fitsTheRow(page, row);
  },
};
