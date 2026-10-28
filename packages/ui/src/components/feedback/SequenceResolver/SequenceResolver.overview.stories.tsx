import Box from '@mui/material/Box/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { useState } from 'react';

import { Button } from '../../form/Button';
import { SequenceResolver } from './SequenceResolver';
import type { SequenceItem, SequenceOverview, SequenceResolverLabels, SequenceStep, SequenceStepApi } from './SequenceResolver.types';

/**
 * "Ver todos (N)" inside the run, as a Turnos host plugs it in (FUT-3823,
 * prototype D frames d03, d04, m01). The steps are illustrative — the host's.
 */
type Kind = 'late' | 'away';

interface Problem extends SequenceItem {
  kind: Kind;
  who: string;
  area: string;
  question: string;
  facts: [string, string][];
}

const PROBLEMS: Problem[] = [
  {
    key: 'late:luiz',
    kind: 'late',
    kindLabel: 'Atrasado',
    who: 'Luiz entrega',
    area: 'Entregas',
    question: 'Ainda não começou. Era 20:39.',
    facts: [
      ['Escala', 'Hoje, 20:39–00:00 · toda semana'],
      ['Agora', '20:45 · 6 min de atraso'],
    ],
  },
  {
    key: 'away:talita',
    kind: 'away',
    kindLabel: 'Avisou que não vai',
    who: 'Talita Siqueira',
    area: 'Entregas',
    question: 'Avisou que não vai na terça.',
    facts: [
      ['Turno', 'Ter, 18:00–22:00'],
      ['Motivo', 'Passou mal'],
    ],
  },
];

const LABELS: SequenceResolverLabels = {
  back: 'Voltar',
  close: 'Fechar',
  skip: 'Depois',
  step: (position, total) => `${position} de ${total}`,
  introStep: 'Problemas de turno',
  doneStep: 'Pronto',
  progress: 'Progresso',
  failed: 'Não deu certo. Tente de novo.',
};

const overviewOf = (open: Problem[]): SequenceOverview => {
  const late = open.filter((p) => p.kind === 'late');
  const away = open.filter((p) => p.kind === 'away');
  return {
    label: (total) => `Ver todos (${total})`,
    title: open.length === 1 ? '1 problema a resolver' : `${open.length} problemas a resolver`,
    categories: [
      { label: `Atrasado · ${late.length}`, description: `${late.map((p) => p.who).join(', ')} ainda não começou`, count: late.length, keys: late.map((p) => p.key) },
      { label: `Avisou que não vai · ${away.length}`, description: away.map((p) => `${p.who}, ter`).join(' · '), count: away.length, keys: away.map((p) => p.key) },
    ].filter((category) => category.count > 0),
    pickLabel: 'Resolver',
    continueLabel: 'Continuar em sequência',
  };
};

function stepOf(item: Problem, api: SequenceStepApi<string>, last: boolean): SequenceStep {
  return {
    content: (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography component="h3" variant="body1" fontWeight={500} {...api.titleProps}>
          {item.who} · {item.area}
        </Typography>
        <Typography variant="h6" component="p">
          {item.question}
        </Typography>
        <Box
          component="dl"
          sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 0.5, m: 0, p: 1.5, borderRadius: 1.25, bgcolor: 'action.hover' }}
        >
          {item.facts.map(([k, v]) => (
            <Box key={k} sx={{ display: 'contents' }}>
              <Typography component="dt" variant="body2" color="text.secondary">
                {k}
              </Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0 }}>
                {v}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>
    ),
    primary:
      item.kind === 'late'
        ? { label: 'Iniciar turno agora', onClick: () => api.resolve(`${item.key}:start`) }
        : { label: 'Ciente, fica sem ninguém', onClick: () => api.resolve(`${item.key}:ack`) },
    secondary: { label: last ? 'Esperar mais' : 'Esperar mais · próximo', onClick: api.skip },
  };
}

interface DemoProps {
  initialKey?: string;
  /** The first step's answer has no inverse (an "Iniciar turno agora" past 10 minutes). */
  firstIsFinal?: boolean;
}

function Demo({ initialKey, firstIsFinal = false }: DemoProps) {
  const [open, setOpen] = useState(true);
  const [answered, setAnswered] = useState<string[]>([]);
  const queue = PROBLEMS;
  const openProblems = queue.filter((p) => !answered.includes(p.key));
  return (
    <Box sx={{ p: 2 }}>
      <Button onClick={() => setOpen(true)}>2 problemas a resolver ›</Button>
      <SequenceResolver<Problem, string>
        open={open}
        onClose={() => setOpen(false)}
        queue={queue}
        initialKey={initialKey}
        overview={overviewOf(openProblems)}
        renderStep={(item, api) => {
          const step = stepOf(item, { ...api, resolve: (r) => { setAnswered((prev) => [...prev, item.key]); api.resolve(r); } }, item.key === queue[queue.length - 1]?.key);
          return firstIsFinal && item.key === queue[0]?.key ? { ...step, canGoBack: false } : step;
        }}
        onBack={(item) => {
          setAnswered((prev) => prev.filter((key) => key !== item.key));
        }}
        done={(s) => ({ title: s.resolved === s.total ? 'Tudo resolvido' : `${s.resolved} de ${s.total} resolvidos`, confirmLabel: 'Fechar' })}
        labels={LABELS}
        dataTestId="resolver"
      />
    </Box>
  );
}

const meta: Meta<typeof Demo> = {
  title: 'Feedback/SequenceResolver/Ver todos',
  component: Demo,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          '"Ver todos (N)" in the header of every step: the kinds with their counts inside the same dialog, a Resolver per kind that jumps to its first unanswered problem, and "Continuar em sequência" back to the step it left. Back after a jump returns to the step left.',
      },
    },
  },
  tags: ['autodocs', 'component:SequenceResolver'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const body = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body);
const DESKTOP = { viewport: { value: 'lg', isRotated: false } };
const PHONE = { viewport: { value: 'xs', isRotated: false } };

/** d03 — the chip opens the run at the first problem: "1 de 2" and "Ver todos (2)". */
export const Step: Story = { args: {}, globals: DESKTOP };

/** d04 — "Ver todos" inside the run: the kinds with counts, Resolver per kind, "Continuar em sequência". */
export const SeeAll: Story = {
  args: {},
  globals: DESKTOP,
  play: async ({ canvasElement }) => {
    const page = body(canvasElement);
    await userEvent.click(await page.findByTestId('resolver-see-all'));
    await waitFor(() => expect(page.getByTestId('resolver-overview')).toBeInTheDocument());
  },
};

/** A kind's Resolver: the run jumps to it, and Back returns to the step it left. */
export const AfterJump: Story = {
  args: {},
  globals: DESKTOP,
  play: async ({ canvasElement }) => {
    const page = body(canvasElement);
    await userEvent.click(await page.findByTestId('resolver-see-all'));
    await userEvent.click(await page.findByTestId('resolver-overview-pick-1'));
    await waitFor(() => expect(page.getByTestId('resolver-back')).toBeInTheDocument());
  },
};

/** A click on Talita's block opens the run at her problem (`initialKey`). */
export const OpenedAtAProblem: Story = { args: { initialKey: 'away:talita' }, globals: DESKTOP };

/** m01 — the phone sheet: the same header on one line, "Ver todos (2)" beside "1 de 2". */
export const Phone: Story = { args: {}, globals: PHONE };

/** The overview on the phone sheet. */
export const PhoneSeeAll: Story = { ...SeeAll, globals: PHONE };

/** An answer with no inverse (`canGoBack: false`): the next step offers no Back. */
export const NoWayBack: Story = {
  args: { firstIsFinal: true },
  globals: DESKTOP,
  play: async ({ canvasElement }) => {
    const page = body(canvasElement);
    await userEvent.click(await page.findByTestId('resolver-primary'));
    await waitFor(() => expect(page.getByTestId('resolver-step-label')).toHaveTextContent('2 de 2'));
  },
};
