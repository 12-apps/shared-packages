/**
 * The per-screen plan comparison (FUT-5062), explorable with NO host: a fake
 * `fetch` answers the plan read and the ask, so the real factory renders.
 *
 * The rows are a chat feature's three lines across a free, a middle and a top
 * tier — the shape of the first caller — with an unrelated reports line in the
 * payload that the dialog must leave out.
 */
import { useState, type JSX } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '@12-apps/ui/form/Button';

import type { ComparisonTier, TenantPlanPayload } from '../plan-wire';
import { createWebEntitlements } from './create-web-entitlements';
import { EN_US_ENTITLEMENTS_WEB_COPY } from './en-US';
import { PT_BR_ENTITLEMENTS_WEB_COPY } from './pt-BR';
import type { EntitlementsWebCopy } from './copy';

const CHAT_KEYS = ['chat.line', 'chat.assistant', 'chat.own-model'];

function tier(
  key: string,
  name: string,
  included: [boolean, boolean, boolean],
  over: Partial<ComparisonTier> = {},
): ComparisonTier {
  return {
    key,
    name,
    priceCents: null,
    price: null,
    priceNote: null,
    pitch: '',
    headline: '',
    headlineUnit: '',
    current: false,
    upgrade: true,
    recommended: false,
    sections: [
      {
        title: 'Atendimento',
        lines: [
          { key: 'chat.line', label: 'Linha de chat da loja', included: included[0], detail: null },
          { key: 'chat.assistant', label: 'Atendente de chat com IA', included: included[1], detail: null },
          { key: 'chat.own-model', label: 'Usar a sua própria IA no atendente', included: included[2], detail: null },
        ],
      },
      {
        title: 'Relatórios',
        lines: [{ key: 'reports.export', label: 'Exportar relatórios', included: true, detail: 'até 10' }],
      },
    ],
    ...over,
  };
}

const FREE = tier('free', 'Gratuito', [false, false, false], { current: true, upgrade: false });
// The owner's spec: Pro has rows 1-2, Max all three.
const PRO = tier('pro', 'Pro', [true, true, false]);
const MAX = tier('max', 'Max', [true, true, true], { recommended: true });

const THREE_TIERS = [FREE, PRO, MAX];
const FOUR_TIERS = [FREE, tier('basic', 'Básico', [true, false, false]), PRO, MAX];
const FIVE_TIERS = [
  FREE,
  tier('basic', 'Básico', [true, false, false]),
  PRO,
  tier('business', 'Empresarial', [true, true, false]),
  MAX,
];

function fakeFetch(comparison: ComparisonTier[]): typeof fetch {
  const plan: TenantPlanPayload = {
    planKey: 'free',
    name: 'Gratuito',
    priceCents: 0,
    price: null,
    features: [],
    comparison,
  };
  return async (input, init) => {
    const url = String(input);
    if (url.endsWith('/plan') && (init?.method ?? 'GET') === 'GET') {
      return Response.json({ data: { plan } });
    }
    if (url.endsWith('/plan/request')) {
      return Response.json({ data: { request: { id: 'r1', status: 'open' }, created: true } });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  };
}

function Demo({
  keys = CHAT_KEYS,
  canRequestPlanChange = true,
  copy = PT_BR_ENTITLEMENTS_WEB_COPY,
  tiers = THREE_TIERS,
}: {
  keys?: string[];
  tiers?: ComparisonTier[];
  canRequestPlanChange?: boolean;
  copy?: EntitlementsWebCopy;
}): JSX.Element {
  const [{ PlanCompare }] = useState(() =>
    createWebEntitlements({
      apiBase: '/api/demo',
      fetchImpl: fakeFetch(tiers),
      canRequestPlanChange,
      copy,
      plansPath: '#plans',
    }),
  );
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open</Button>
      <PlanCompare
        open={open}
        onClose={() => setOpen(false)}
        keys={keys}
        plan="max"
        feature="chat.assistant"
      />
    </>
  );
}

/**
 * A screen's OWN title and rows (FUT-3921): the first caller words six rows
 * from three entitlements (a key repeats), and asks for one "Conhecer o
 * <plano>" per plan on sale. The tiers carry no copy of the screen's.
 */
const WIN_ROWS = [
  { key: 'win.list', label: 'Lista com WhatsApp (envio manual)' },
  { key: 'win.email', label: 'E-mail “Sentimos sua falta”' },
  { key: 'win.email', label: 'Crédito na carteira de cada cliente' },
  { key: 'win.email', label: 'Enviar para todos com um toque' },
  { key: 'win.auto', label: 'Envio automático todo dia' },
  { key: 'win.auto', label: 'Teto de crédito por mês' },
];

function winTier(
  key: string,
  name: string,
  included: [boolean, boolean, boolean],
  over: Partial<ComparisonTier> = {},
): ComparisonTier {
  const [list, email, auto] = included;
  return {
    ...tier(key, name, [false, false, false], over),
    sections: [
      {
        title: 'Clientes',
        lines: [
          { key: 'win.list', label: 'Lista de clientes', included: list, detail: null },
          { key: 'win.email', label: 'E-mail de volta', included: email, detail: null },
          { key: 'win.auto', label: 'Envio automático', included: auto, detail: null },
        ],
      },
    ],
  };
}

const WIN_FREE = winTier('free', 'Grátis', [true, false, false], { current: true, upgrade: false });
const WIN_PRO = winTier('pro', 'Pro', [true, true, false]);
const WIN_MAX = winTier('max', 'Max', [true, true, true], { recommended: true });

function OwnRowsDemo({ tiers }: { tiers: ComparisonTier[] }): JSX.Element {
  const [{ PlanCompare }] = useState(() =>
    createWebEntitlements({
      apiBase: '/api/demo',
      fetchImpl: fakeFetch(tiers),
      canRequestPlanChange: true,
      copy: PT_BR_ENTITLEMENTS_WEB_COPY,
      plansPath: '#plans',
    }),
  );
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open</Button>
      <PlanCompare
        open={open}
        onClose={() => setOpen(false)}
        title="Clientes sumidos"
        rows={WIN_ROWS}
        offer="each"
        feature="win.email"
      />
    </>
  );
}

const meta: Meta = { title: 'Entitlements/PlanCompareDialog' };
export default meta;

/** The first caller's shape: three chat rows, the top tier offered. */
export const ChatRows: StoryObj = { render: () => <Demo /> };

/** Four tiers on sale — a table from ~514 px of frame, stacked below it. */
export const ChatRowsFourTiers: StoryObj = { render: () => <Demo tiers={FOUR_TIERS} /> };

/** Five tiers — stacked in the dialog at every width. */
export const ChatRowsFiveTiers: StoryObj = { render: () => <Demo tiers={FIVE_TIERS} /> };

/** No `plan:request`: the plan is named, and there is no request button. */
export const WithoutRequestPermission: StoryObj = {
  render: () => <Demo canRequestPlanChange={false} />,
};

/** None of the screen's keys is in the payload: said, never blank. */
export const NoMatchingRows: StoryObj = { render: () => <Demo keys={['unknown.key']} /> };

/** The English pack. */
export const EnglishCopy: StoryObj = { render: () => <Demo copy={EN_US_ENTITLEMENTS_WEB_COPY} /> };

/** The screen's title and rows, the only plan on sale (Max) offered alone. */
export const OwnRowsOnePlanOnSale: StoryObj = {
  render: () => <OwnRowsDemo tiers={[WIN_FREE, WIN_MAX]} />,
};

/** Two plans on sale: two actions on ONE line at every width, Max solid. */
export const OwnRowsEachPlan: StoryObj = {
  render: () => <OwnRowsDemo tiers={[WIN_FREE, WIN_PRO, WIN_MAX]} />,
};
