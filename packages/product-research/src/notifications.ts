/**
 * The paid-search budget alert as a NOTIFICATION BLUEPRINT — the wiring
 * contract's notifications capability, declared by the package that owns the
 * event (structural twin; no contract import).
 *
 * The fact is the pipeline's: a research run wanted a paid call and the
 * budget gate said no — this tenant's daily quota or the platform's monthly
 * cap is spent. The run already shows a BUDGET_EXCEEDED stat on the source
 * row; this blueprint is the same fact PUSHED once to whoever can act on it.
 * The ONCE is not enforced here: the spend counter's `notified_at` marker is
 * claimed by a conditional UPDATE host-side, so a cap that refuses a hundred
 * runs emits exactly one alert per period — this module only phrases what
 * that single winner emits.
 *
 * The words and the CTA link are HOST copy, so the blueprint is built by a
 * factory taking them; `PT_BR_RESEARCH_BUDGET_COPY` is the origin host's
 * pack, verbatim, and `RESEARCH_NOTIFICATIONS` (what the manifest declares)
 * is the blueprint built with it — a host with other words builds its own
 * through the same factory and feeds it to its notifications mount.
 */

/** Which limit was hit — the two scopes the spend counters track. */
export type ResearchBudgetScope = 'TENANT_DAY' | 'GLOBAL_MONTH';

export interface ResearchBudgetPayload {
  scope: ResearchBudgetScope;
  sourceType: string;
  /** The counter's period, "YYYY-MM-DD" (day) or "YYYY-MM" (month), UTC. */
  period: string;
  capUnits: number;
  /** Lets the host's copy build a CTA into its own URL space. */
  tenantSlug: string;
}

/** Twin of the wiring contract's `WireNotificationContent`. */
export interface ResearchNotificationContent {
  title: string;
  body: string;
  link?: string;
  data?: Readonly<Record<string, unknown>>;
}

/** Twin of the wiring contract's `WireNotificationBlueprint`. */
export interface ResearchNotificationBlueprint {
  type: string;
  /** SUGGESTED preference category; the host's taxonomy maps or vetoes it. */
  category: string;
  generate(payload: ResearchBudgetPayload): ResearchNotificationContent;
}

export const RESEARCH_BUDGET_NOTIFICATION_TYPE = 'research.budget-exhausted';

/** The host's words for the alert, and where its CTA lands. */
export interface ResearchBudgetCopy {
  title(payload: ResearchBudgetPayload): string;
  body(payload: ResearchBudgetPayload): string;
  /** Relative link into the host's own UI — the research home, typically. */
  link(payload: ResearchBudgetPayload): string;
}

/** The origin host's pack, verbatim. */
export const PT_BR_RESEARCH_BUDGET_COPY: ResearchBudgetCopy = {
  title: (payload) =>
    payload.scope === 'TENANT_DAY'
      ? 'Cota diária de busca paga esgotada'
      : 'Orçamento mensal de busca paga esgotado',
  body: (payload) => {
    const tail =
      'As pesquisas continuam funcionando com as fontes gratuitas; ' +
      'a busca paga volta automaticamente no próximo período.';
    return payload.scope === 'TENANT_DAY'
      ? `A loja atingiu a cota diária de ${payload.capUnits} busca(s) paga(s) ` +
          `(${payload.sourceType}) em ${payload.period}. ${tail}`
      : `A plataforma atingiu o orçamento mensal de ${payload.capUnits} busca(s) paga(s) ` +
          `(${payload.sourceType}) em ${payload.period}. ${tail}`;
  },
  link: (payload) => `/admin/${payload.tenantSlug}/research`,
};

/**
 * Build the blueprint with a host's copy. `category` suggests "system" — an
 * operational platform notice, not an order/payment/stock event — and stays
 * the host taxonomy's to map or veto at adoption.
 */
export function createResearchBudgetBlueprint(
  copy: ResearchBudgetCopy,
): ResearchNotificationBlueprint {
  return {
    type: RESEARCH_BUDGET_NOTIFICATION_TYPE,
    category: 'system',
    generate: (payload) => ({
      title: copy.title(payload),
      body: copy.body(payload),
      link: copy.link(payload),
      data: {
        scope: payload.scope,
        sourceType: payload.sourceType,
        period: payload.period,
        capUnits: payload.capUnits,
      },
    }),
  };
}

/** What the shared manifest declares: the blueprint with the pt-BR pack. */
export const RESEARCH_NOTIFICATIONS: readonly ResearchNotificationBlueprint[] = [
  createResearchBudgetBlueprint(PT_BR_RESEARCH_BUDGET_COPY),
];
