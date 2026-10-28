import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { SequenceResolver } from './SequenceResolver';
import type { SequenceItem, SequenceResolverLabels } from './SequenceResolver.types';

/**
 * S-L1 in a real browser (FUT-3825): the step header after a jump — Back,
 * "2 de 2", "Ver todos (2)", close — on ONE line with nothing cut, on the
 * chrome a 320px and a 360px phone leave it (240px and 280px). The header's
 * narrow layout is a container query on the chrome, so the dialog is sized to
 * give the chrome exactly that width.
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

const meta: Meta<typeof SequenceResolver<Problem, string>> = {
  title: 'Feedback/SequenceResolver/Ver todos/Tests',
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
    overview: {
      label: (total) => `Ver todos (${total})`,
      title: '2 problemas a resolver',
      categories: [
        { label: 'Atrasado · 1', keys: ['late:luiz'] },
        { label: 'Avisou que não vai · 1', keys: ['away:talita'] },
      ],
      pickLabel: 'Resolver',
      continueLabel: 'Continuar em sequência',
    },
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
const mid = (el: HTMLElement): number => {
  const box = el.getBoundingClientRect();
  return box.top + box.height / 2;
};

/** Jump to the second problem, give the chrome `width` px, and check the header. */
async function headerAt(canvasElement: HTMLElement, width: number): Promise<void> {
  const page = within(canvasElement.ownerDocument.body);
  await userEvent.click(await page.findByTestId('sr-see-all'));
  await userEvent.click(await page.findByTestId('sr-overview-pick-1'));
  const close = await page.findByTestId('sr-close');
  const chrome = close.parentElement?.parentElement;
  const paper = page.getByRole('dialog');
  if (!chrome) throw new Error('no chrome');
  const inset = paper.getBoundingClientRect().width - chrome.getBoundingClientRect().width;
  paper.style.width = `${width + inset}px`;
  paper.style.minWidth = '0';
  paper.style.maxWidth = 'none';
  await waitFor(() => expect(Math.round(chrome.getBoundingClientRect().width)).toBe(width));

  const back = page.getByRole('button', { name: 'Voltar ao problema anterior' });
  const seeAll = page.getByRole('button', { name: 'Ver todos (2)' });
  const label = page.getByTestId('sr-step-label-end');
  await waitFor(() => expect(label).toBeVisible());
  await expect(label).toHaveTextContent('2 de 2');
  await waitFor(() => expect(page.getByTestId('sr-step-label')).not.toBeVisible());
  await waitFor(() => expect(Math.round(back.getBoundingClientRect().width)).toBe(44));
  await waitFor(() => expect(back.querySelector('[data-back-word]')).not.toBeVisible());
  await expect(Math.max(mid(back), mid(seeAll), mid(close)) - Math.min(mid(back), mid(seeAll), mid(close))).toBeLessThanOrEqual(4);
  await expect(cut(seeAll)).toBe(false);
  await expect(seeAll).toHaveTextContent('Ver todos (2)');
  await expect(cut(label)).toBe(false);
  await expect(seeAll.getBoundingClientRect().right).toBeLessThanOrEqual(close.getBoundingClientRect().left);
}

/** A 320px phone: the chrome is 240px. */
export const HeaderAt320: Story = {
  play: async ({ canvasElement }) => headerAt(canvasElement, 240),
};

/** A 360px phone: the chrome is 280px. */
export const HeaderAt360: Story = {
  play: async ({ canvasElement }) => headerAt(canvasElement, 280),
};

/** A 390px phone (310px): Back says its word, the label is back in the header, whole. */
export const HeaderAt390: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await page.findByTestId('sr-see-all'));
    await userEvent.click(await page.findByTestId('sr-overview-pick-1'));
    const close = await page.findByTestId('sr-close');
    const chrome = close.parentElement?.parentElement;
    const paper = page.getByRole('dialog');
    if (!chrome) throw new Error('no chrome');
    const inset = paper.getBoundingClientRect().width - chrome.getBoundingClientRect().width;
    paper.style.width = `${310 + inset}px`;
    paper.style.minWidth = '0';
    paper.style.maxWidth = 'none';
    const label = page.getByTestId('sr-step-label');
    await waitFor(() => expect(label).toBeVisible());
    await expect(page.getByRole('button', { name: 'Voltar ao problema anterior' })).toHaveTextContent('Voltar');
    await expect(cut(label)).toBe(false);
    await expect(cut(page.getByRole('button', { name: 'Ver todos (2)' }))).toBe(false);
    await waitFor(() => expect(page.getByTestId('sr-step-label-end')).not.toBeVisible());
  },
};
