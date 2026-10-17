import Box from '@mui/material/Box/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { useState } from 'react';

import { sxRem } from '../../../tokens/relative';
import { Button } from '../../form/Button';
import { SequenceResolver } from './SequenceResolver';
import type {
  SequenceIntro,
  SequenceItem,
  SequenceResolverLabels,
  SequenceStep,
  SequenceStepApi,
  SequenceSummary,
} from './SequenceResolver.types';

/**
 * A stock screen's four kinds of problem, as a host would plug them in. The
 * step bodies here are illustrative — the real ones belong to the host.
 */
type Kind = 'limits' | 'purchase' | 'restock' | 'loss';

interface Problem extends SequenceItem {
  kind: Kind;
  name: string;
  facts: string;
}

const KIND_WORD: Record<Kind, string> = {
  limits: 'Limites',
  purchase: 'Compra',
  restock: 'Reposição',
  loss: 'Baixa sem motivo',
};

const problem = (key: string, kind: Kind, name: string, facts: string): Problem => ({
  key,
  kind,
  kindLabel: KIND_WORD[kind],
  name,
  facts,
});

const PROBLEMS: Problem[] = [
  problem('l1', 'limits', 'Água tônica 350ml', 'Hoje está 0 / 0: o produto nunca aparece em “para repor”.'),
  problem('l2', 'limits', 'Suco de uva integral 1L', 'Hoje está 0 / 0. Na exposição 0 · guardado 6.'),
  problem('c1', 'purchase', 'Red Bull 250ml', 'Sem estoque. Última compra: 24 un por R$ 163,20.'),
  problem('r1', 'restock', 'Coca-Cola lata 350ml', 'Na exposição 8 de 24 · guardado 40.'),
  problem('b1', 'loss', 'Água com gás 510ml', 'Baixa de 4 un em 16/07, 14:32, sem motivo.'),
];

const LABELS: SequenceResolverLabels = {
  back: 'Voltar',
  backAccessible: 'Voltar ao problema anterior',
  close: 'Fechar',
  skip: 'Pular por agora',
  step: (position, total, item) => `Problema ${position} de ${total} · ${item.kindLabel}`,
  introStep: 'Problemas a resolver',
  doneStep: 'Pronto',
  progress: 'Progresso',
  failed: 'Não deu certo. Tente de novo.',
};

/** One kind's own word in the header ("Baixa 2 de 5") and its own end sentence — host copy. */
const SINGLE_WORD: Record<Kind, string> = { limits: 'Limites', purchase: 'Compra', restock: 'Reposição', loss: 'Baixa' };
const SINGLE_DONE: Record<Kind, string> = {
  limits: 'Esses produtos agora entram em “para repor”.',
  purchase: 'As compras entraram no estoque guardado.',
  restock: 'A exposição foi abastecida.',
  loss: 'As perdas já contam com elas.',
};

/** The host's labels for a run: a mixed run says "Problema 3 de 13 · Compra", one kind "Compra 1 de 2". */
const labelsFor = (single: Kind | null): SequenceResolverLabels =>
  single ? { ...LABELS, step: (position, total) => `${SINGLE_WORD[single]} ${position} de ${total}` } : LABELS;

const doneFor = (single: Kind | null) => (summary: SequenceSummary) => {
  const all = summary.resolved === summary.total;
  const allSentence = single ? SINGLE_DONE[single] : 'O estoque está em dia.';
  const skipped = single
    ? 'As que você pulou continuam no chip do topo.'
    : 'Os que você pulou continuam em “problemas a resolver”.';
  return {
    title: all ? 'Tudo resolvido' : `${summary.resolved} de ${summary.total} resolvidas`,
    description: all ? allSentence : skipped,
    confirmLabel: 'Concluir',
  };
};

const VERB: Record<Exclude<Kind, 'loss'>, string> = {
  limits: 'Salvar limites',
  purchase: 'Registrar e expor 12',
  restock: 'Levar 16',
};

/** A baixa is answered from its body: the store's quick reasons. */
const QUICK_REASONS = ['Quebra', 'Vencido', 'Consumo interno'];

const QUESTION: Record<Kind, string> = {
  limits: 'Quanto deve ficar na exposição?',
  purchase: 'Registrar compra',
  restock: 'Quanto levar para a exposição?',
  loss: 'Por que saíram estas 4 un?',
};

/** The documented order inside a step: the item's name first and large, the question, the facts. */
function stepOf(item: Problem, api: SequenceStepApi<string>): SequenceStep {
  const content = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Typography component="h3" variant="h5" {...api.titleProps}>
        {item.name}
      </Typography>
      <Typography variant="subtitle1" fontWeight={500}>
        {QUESTION[item.kind]}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {item.facts}
      </Typography>
    </Box>
  );
  if (item.kind === 'loss') {
    // No primary: each reason answers the step; the tertiary and Pular are the footer.
    const reasons = (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25, mt: 2 }}>
        {QUICK_REASONS.map((reason) => (
          <Button
            key={reason}
            variant="outline"
            color="neutral"
            disabled={api.busy}
            sx={{ minHeight: sxRem(44) }}
            onClick={() => api.resolve(`${item.key}:${reason}`)}
          >
            {reason}
          </Button>
        ))}
      </Box>
    );
    return {
      content: (
        <>
          {content}
          {reasons}
        </>
      ),
      tertiary: { label: 'Não foi perda: foi contagem de estoque', onClick: () => api.resolve(`${item.key}:count`) },
    };
  }
  const answer = { label: VERB[item.kind], onClick: () => api.resolve(`${item.key}:answered`), disabled: api.busy };
  if (item.kind === 'purchase') {
    return { content, primary: answer, secondary: { label: 'Ainda não comprei', onClick: api.skip }, footer: 'split' };
  }
  // Restock keeps its actions right-aligned over a hairline; limits is a two-column form footer.
  return { content, primary: answer, footer: item.kind === 'limits' ? 'split' : 'end' };
}

interface DemoProps {
  withIntro?: boolean;
  queue?: Problem[];
  onBack?: (item: Problem, result: string) => Promise<void>;
  /** How long each answer's "server write" takes, in ms (0: answered at once). */
  writeMs?: number;
  /** Lines of form under each step — a purchase step taller than the viewport. */
  extraLines?: number;
  /** Replaces every step's primary label — a host word longer than a phone row. */
  primaryLabel?: string;
}

/** A host: the intro's picks set the queue; Back calls the host's (fake) inverse. */
function Demo({ withIntro = false, queue: initial = PROBLEMS, onBack, writeMs = 0, extraLines = 0, primaryLabel }: DemoProps) {
  const [open, setOpen] = useState(true);
  const [showIntro, setShowIntro] = useState(withIntro);
  const [queue, setQueue] = useState<Problem[]>(initial);
  const kinds = new Set(queue.map((item) => item.kind));
  const single = !showIntro && kinds.size === 1 ? ([...kinds][0] ?? null) : null;
  const count = (kind: Kind): number => initial.filter((item) => item.kind === kind).length;
  const pick = (kind: Kind) => () => {
    setQueue(initial.filter((item) => item.kind === kind));
    setShowIntro(false);
  };
  const intro: SequenceIntro = {
    title: `${initial.length} problemas a resolver`,
    description: 'Resolva tudo em sequência, um por vez, ou escolha um tipo.',
    categories: [
      { label: 'Sem mínimo e máximo', description: 'definir quanto fica na exposição', count: count('limits'), onPick: pick('limits') },
      { label: 'Sem estoque', description: 'registrar a compra', count: count('purchase'), onPick: pick('purchase') },
      { label: 'Para repor na exposição', description: 'levar do guardado para a exposição', count: count('restock'), onPick: pick('restock') },
      { label: 'Baixas sem motivo', description: 'dizer por que saíram', count: count('loss'), onPick: pick('loss') },
    ].filter((category) => category.count > 0),
    startAllLabel: 'Resolver todos em sequência',
    onStartAll: () => {
      setQueue(initial);
      setShowIntro(false);
    },
  };
  const renderStep = (item: Problem, api: SequenceStepApi<string>): SequenceStep => {
    const slow = (result: string) =>
      new Promise<string>((done) => {
        setTimeout(() => done(result), writeMs);
      });
    const step = writeMs === 0 ? stepOf(item, api) : stepOf(item, { ...api, resolve: (result) => api.resolve(slow(String(result))) });
    if (primaryLabel && step.primary) step.primary = { ...step.primary, label: primaryLabel };
    if (extraLines === 0) return step;
    const form = Array.from({ length: extraLines }, (_, line) => (
      <Typography key={line} variant="body2" sx={{ py: 1, borderBottom: 1, borderColor: 'divider' }}>
        Campo {line + 1}
      </Typography>
    ));
    return { ...step, content: <>{step.content}{form}</> };
  };
  return (
    <Box sx={{ p: 2 }}>
      <Button
        onClick={() => {
          setShowIntro(withIntro);
          setQueue(initial);
          setOpen(true);
        }}
      >
        Abrir
      </Button>
      <SequenceResolver<Problem, string>
        open={open}
        onClose={() => setOpen(false)}
        intro={showIntro ? intro : undefined}
        queue={queue}
        renderStep={renderStep}
        onBack={onBack}
        done={doneFor(single)}
        labels={labelsFor(single)}
        dataTestId="resolver"
      />
    </Box>
  );
}

const meta: Meta<typeof Demo> = {
  title: 'Feedback/SequenceResolver',
  component: Demo,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Resolve a queue of problems one at a time in one dialog: progress, Back (with the host’s inverse), skip, close, an intro listing the kinds and an end screen. A centred dialog from 600px, the inset bottom sheet below. Every word and every step body comes from the host.',
      },
    },
  },
  tags: ['autodocs', 'component:SequenceResolver'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const resolverIn = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body);

/** The prototype's two frames: the computer stories at `lg` (1200), the phone ones at `xs` (400). */
const DESKTOP = { viewport: { value: 'lg', isRotated: false } };
const PHONE = { viewport: { value: 'xs', isRotated: false } };

/** The intro: each kind with its count, or all of them in one run. */
export const Intro: Story = { args: { withIntro: true }, globals: DESKTOP };

/** The first step of a mixed run: no Back yet. */
export const Step: Story = { args: {}, globals: DESKTOP };

/** One step skipped: Back returns to it. */
export const StepWithBack: Story = {
  globals: DESKTOP,
  args: {},
  play: async ({ canvasElement }) => {
    const body = resolverIn(canvasElement);
    await userEvent.click(await body.findByTestId('resolver-secondary'));
    await waitFor(() => expect(body.getByTestId('resolver-back')).toBeInTheDocument());
  },
};

/** The end screen after the last step: one answered, one skipped. */
export const Done: Story = {
  globals: DESKTOP,
  args: { queue: PROBLEMS.slice(0, 2) },
  play: async ({ canvasElement }) => {
    const body = resolverIn(canvasElement);
    await userEvent.click(await body.findByTestId('resolver-primary'));
    await waitFor(() => expect(body.getByTestId('resolver-step-label')).toHaveTextContent('2 de 2'));
    await userEvent.click(body.getByTestId('resolver-secondary'));
    await waitFor(() => expect(body.getByTestId('resolver-done')).toBeInTheDocument());
  },
};

/** A step whose answer is being written: every action disabled until it returns. */
export const Busy: Story = {
  globals: DESKTOP,
  args: { writeMs: 600_000 },
  play: async ({ canvasElement }) => {
    const body = resolverIn(canvasElement);
    await userEvent.click(await body.findByTestId('resolver-primary'));
    await waitFor(() => expect(body.getByTestId('resolver-primary')).toBeDisabled());
  },
};

/** Back's inverse failed: the step stays and the host's message shows. */
export const BackFailed: Story = {
  globals: DESKTOP,
  args: {
    onBack: () => Promise.reject(new Error('Não deu para desfazer a resposta. Tente de novo.')),
  },
  play: async ({ canvasElement }) => {
    const body = resolverIn(canvasElement);
    await userEvent.click(await body.findByTestId('resolver-primary'));
    await userEvent.click(await body.findByTestId('resolver-back'));
    await waitFor(() => expect(body.getByTestId('resolver-error')).toBeInTheDocument());
  },
};

/** A step taller than the viewport: the paper scrolls inside it, nothing is cut off. */
export const LongStep: Story = { args: { queue: PROBLEMS.slice(2, 3), extraLines: 24 }, globals: DESKTOP };

/** Below 600px: the inset bottom sheet, its decorative handle, 44px+ targets. */
export const PhoneSheet: Story = {
  args: { withIntro: true },
  globals: PHONE,
};

/** The phone sheet on a step, after one skip. */
export const PhoneStepWithBack: Story = {
  ...StepWithBack,
  globals: PHONE,
};

/** The phone sheet on the first step. */
export const PhoneStep: Story = { ...Step, globals: PHONE };

/** The phone sheet's end screen: the button full width. */
export const PhoneDone: Story = { ...Done, globals: PHONE };

/** The phone sheet with a step taller than the screen: 95% high, the body scrolls under fixed chrome. */
export const PhoneLongStep: Story = { ...LongStep, globals: PHONE };

/** A host word wider than a 320px row: the button takes the row and wraps inside it, nothing overflows. */
export const PhoneLongLabel: Story = {
  args: { primaryLabel: 'Registrar a compra e levar tudo para a exposição agora' },
  globals: { viewport: { value: 'xxs', isRotated: false } },
};

/** A restock step: auto-width actions right-aligned over a hairline (`footer: 'end'`). */
export const RestockStep: Story = { args: { queue: PROBLEMS.slice(3, 4) }, globals: DESKTOP };

/** A baixa answered from its body: no primary — the reasons, the tertiary above the footer, and Pular. */
export const LossStep: Story = { args: { queue: PROBLEMS.slice(4) }, globals: DESKTOP };

/** The baixa step on the phone sheet. */
export const PhoneLossStep: Story = { ...LossStep, globals: PHONE };

/** Opened straight into one kind (a row shortcut): step 1, no Back, the kind's own label ("Limites 1 de 2"). */
export const SingleKind: Story = { args: { queue: PROBLEMS.slice(0, 2) }, globals: DESKTOP };

/** A 1-of-1 run (one product's shortcut): "Compra 1 de 1". */
export const OneOfOne: Story = { args: { queue: PROBLEMS.slice(2, 3) }, globals: DESKTOP };

/** The end screen after a failed Back: the run stays on the end screen and the host's message shows. */
export const DoneBackFailed: Story = {
  globals: DESKTOP,
  args: {
    queue: PROBLEMS.slice(0, 1),
    onBack: () => Promise.reject(new Error('Não deu para desfazer a resposta. Tente de novo.')),
  },
  play: async ({ canvasElement }) => {
    const body = resolverIn(canvasElement);
    await userEvent.click(await body.findByTestId('resolver-primary'));
    await waitFor(() => expect(body.getByTestId('resolver-done')).toBeInTheDocument());
    await userEvent.click(body.getByTestId('resolver-back'));
    await waitFor(() => expect(body.getByTestId('resolver-error')).toBeInTheDocument());
  },
};
