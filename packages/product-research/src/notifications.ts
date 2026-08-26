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
 * factory taking them — the same carve-out the MCP capability documents for
 * vocabulary-dependent tools. The manifest therefore declares NO static
 * `notifications` capability: a blueprint pre-worded here would be a silent
 * pt-BR default, the exact anti-pattern the copy gate refuses. A host calls
 * {@link createResearchBudgetBlueprint} with its words (`./pt-BR` ships the
 * origin host's pack) and feeds the result to its notifications mount — a
 * line in the host's diff, which is the point.
 */

import { resolveResearchCopy, type ResearchCopySource } from './copy-source';

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

/** Twin of the wiring contract's `WireNotificationContext`. */
export interface ResearchNotificationContext {
  readonly locale?: string | null;
}

/** Twin of the wiring contract's `WireNotificationBlueprint`. */
export interface ResearchNotificationBlueprint {
  type: string;
  /** SUGGESTED preference category; the host's taxonomy maps or vetoes it. */
  category: string;
  /**
   * Render the alert for ONE recipient. `context` is optional, so a runtime
   * that passes nothing is stating that it has no language for this reader
   * rather than asserting a default.
   */
  generate(
    payload: ResearchBudgetPayload,
    context?: ResearchNotificationContext,
  ): ResearchNotificationContent;
}

export const RESEARCH_BUDGET_NOTIFICATION_TYPE = 'research.budget-exhausted';

/** The host's words for the alert, and where its CTA lands. */
export interface ResearchBudgetCopy {
  title(payload: ResearchBudgetPayload): string;
  body(payload: ResearchBudgetPayload): string;
  /** Relative link into the host's own UI — the research home, typically. */
  link(payload: ResearchBudgetPayload): string;
}

/**
 * Build the blueprint with a host's copy. `category` suggests "system" — an
 * operational platform notice, not an order/payment/stock event — and stays
 * the host taxonomy's to map or veto at adoption.
 *
 * ## The words may follow the reader, and `generate` is where they must
 *
 * `copy` takes a table OR a RESOLVER, and the resolver runs inside `generate`,
 * at the one moment the recipient is known — never on this line. A blueprint
 * is built ONCE, at the host's mount, so resolving here would answer every
 * future reader of this alert in whichever language the process started in,
 * invisibly, because a single-locale host cannot tell the difference. It is
 * the same rule `resolveResearchCopy` states for the connector context, on the
 * one surface where the reader is a person rather than a request.
 *
 * A host with one audience passes its table and nothing about its adoption
 * changes.
 */
export function createResearchBudgetBlueprint(
  copy: ResearchCopySource<ResearchBudgetCopy>,
): ResearchNotificationBlueprint {
  return {
    type: RESEARCH_BUDGET_NOTIFICATION_TYPE,
    category: 'system',
    generate: (payload, context) => {
      // Resolved per alert, from the recipient's own tag.
      const words = resolveResearchCopy(copy, context?.locale ?? undefined);
      return {
      title: words.title(payload),
      body: words.body(payload),
      link: words.link(payload),
      data: {
        scope: payload.scope,
        sourceType: payload.sourceType,
        period: payload.period,
        capUnits: payload.capUnits,
      },
      };
    },
  };
}
