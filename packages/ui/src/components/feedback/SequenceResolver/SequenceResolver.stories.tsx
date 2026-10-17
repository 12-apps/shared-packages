import Box from '@mui/material/Box/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { useState } from 'react';

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

const doneOf = (summary: SequenceSummary) => ({
  title: summary.resolved === summary.total ? 'Tudo resolvido' : `${summary.resolved} de ${summary.total} resolvidas`,
  description:
    summary.resolved === summary.total
      ? 'O estoque está em dia.'
      : 'Os que você pulou continuam em “problemas a resolver”.',
  confirmLabel: 'Concluir',
});

const VERB: Record<Kind, string> = {
  limits: 'Salvar limites',
  purchase: 'Registrar e expor 12',
  restock: 'Levar 16',
  loss: 'Quebra',
};

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
  const answer = { label: VERB[item.kind], onClick: () => api.resolve(`${item.key}:answered`), disabled: api.busy };
  if (item.kind === 'loss') {
    return {
      content,
      primary: answer,
      tertiary: { label: 'Não foi perda: foi contagem de estoque', onClick: () => api.resolve(`${item.key}:count`) },
    };
  }
  if (item.kind === 'purchase') {
    return { content, primary: answer, secondary: { label: 'Ainda não comprei', onClick: api.skip } };
  }
  return { content, primary: answer };
}

interface DemoProps {
  withIntro?: boolean;
  queue?: Problem[];
  onBack?: (item: Problem, result: string) => Promise<void>;
  /** How long each answer's "server write" takes, in ms (0: answered at once). */
  writeMs?: number;
  /** Lines of form under each step — a purchase step taller than the viewport. */
  extraLines?: number;
}

/** A host: the intro's picks set the queue; Back calls the host's (fake) inverse. */
function Demo({ withIntro = false, queue: initial = PROBLEMS, onBack, writeMs = 0, extraLines = 0 }: DemoProps) {
  const [open, setOpen] = useState(true);
  const [showIntro, setShowIntro] = useState(withIntro);
  const [queue, setQueue] = useState<Problem[]>(initial);
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
        done={doneOf}
        labels={LABELS}
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

/** The intro: each kind with its count, or all of them in one run. */
export const Intro: Story = { args: { withIntro: true } };

/** The first step of a mixed run: no Back yet. */
export const Step: Story = { args: {} };

/** One step skipped: Back returns to it. */
export const StepWithBack: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    const body = resolverIn(canvasElement);
    await userEvent.click(await body.findByTestId('resolver-secondary'));
    await waitFor(() => expect(body.getByTestId('resolver-back')).toBeInTheDocument());
  },
};

/** The end screen after the last step: one answered, one skipped. */
export const Done: Story = {
  args: { queue: PROBLEMS.slice(0, 2) },
  play: async ({ canvasElement }) => {
    const body = resolverIn(canvasElement);
    await userEvent.click(await body.findByTestId('resolver-primary'));
    await waitFor(() => expect(body.getByTestId('resolver-step-label')).toHaveTextContent('Problema 2 de 2'));
    await userEvent.click(body.getByTestId('resolver-secondary'));
    await waitFor(() => expect(body.getByTestId('resolver-done')).toBeInTheDocument());
  },
};

/** A step whose answer is being written: every action disabled until it returns. */
export const Busy: Story = {
  args: { writeMs: 600_000 },
  play: async ({ canvasElement }) => {
    const body = resolverIn(canvasElement);
    await userEvent.click(await body.findByTestId('resolver-primary'));
    await waitFor(() => expect(body.getByTestId('resolver-primary')).toBeDisabled());
  },
};

/** Back's inverse failed: the step stays and the host's message shows. */
export const BackFailed: Story = {
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
export const LongStep: Story = { args: { queue: PROBLEMS.slice(2, 3), extraLines: 24 } };

/** Below 600px: the inset bottom sheet, its decorative handle, 44px+ targets. */
export const PhoneSheet: Story = {
  args: { withIntro: true },
  globals: { viewport: { value: 'xs', isRotated: false } },
};

/** The phone sheet on a step, after one skip. */
export const PhoneStepWithBack: Story = {
  ...StepWithBack,
  globals: { viewport: { value: 'xs', isRotated: false } },
};
