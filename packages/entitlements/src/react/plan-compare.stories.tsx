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

const PAYLOAD: TenantPlanPayload = {
  planKey: 'free',
  name: 'Gratuito',
  priceCents: 0,
  price: null,
  features: [],
  comparison: [
    tier('free', 'Gratuito', [false, false, false], { current: true, upgrade: false }),
    tier('pro', 'Pro', [true, false, false]),
    tier('max', 'Max', [true, true, true], { recommended: true }),
  ],
};

const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith('/plan') && (init?.method ?? 'GET') === 'GET') {
    return Response.json({ data: { plan: PAYLOAD } });
  }
  if (url.endsWith('/plan/request')) {
    return Response.json({ data: { request: { id: 'r1', status: 'open' }, created: true } });
  }
  return Response.json({ error: 'not found' }, { status: 404 });
};

function Demo({
  keys = CHAT_KEYS,
  canRequestPlanChange = true,
  copy = PT_BR_ENTITLEMENTS_WEB_COPY,
}: {
  keys?: string[];
  canRequestPlanChange?: boolean;
  copy?: EntitlementsWebCopy;
}): JSX.Element {
  const [{ PlanCompare }] = useState(() =>
    createWebEntitlements({
      apiBase: '/api/demo',
      fetchImpl: fakeFetch,
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

const meta: Meta = { title: 'Entitlements/PlanCompareDialog' };
export default meta;

/** The first caller's shape: three chat rows, the top tier offered. */
export const ChatRows: StoryObj = { render: () => <Demo /> };

/** No `plan:request`: the plan is named, and there is no request button. */
export const WithoutRequestPermission: StoryObj = {
  render: () => <Demo canRequestPlanChange={false} />,
};

/** None of the screen's keys is in the payload: said, never blank. */
export const NoMatchingRows: StoryObj = { render: () => <Demo keys={['unknown.key']} /> };

/** The English pack. */
export const EnglishCopy: StoryObj = { render: () => <Demo copy={EN_US_ENTITLEMENTS_WEB_COPY} /> };
