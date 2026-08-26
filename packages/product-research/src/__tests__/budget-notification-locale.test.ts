/**
 * THE BUDGET ALERT FOLLOWS ITS READER, not the process.
 *
 * A blueprint is built once, at the host's mount, and the alert it renders is
 * stored as TEXT — so before this, whichever language that mount named was the
 * language every future reader got, forever, and a single-locale host could
 * never tell the difference. These cases pin the two halves that close it: the
 * factory takes a resolver, and `generate` is what calls it.
 */

import { describe, expect, it } from 'vitest';

import { createResearchBudgetBlueprint, type ResearchBudgetPayload } from '../notifications';
import { RESEARCH_BUDGET_COPY } from '../locales';
import { EN_US_RESEARCH_BUDGET_COPY } from '../en-US';
import { PT_BR_RESEARCH_BUDGET_COPY } from '../pt-BR';

const payload: ResearchBudgetPayload = {
  scope: 'TENANT_DAY',
  sourceType: 'serp',
  period: '2026-08-26',
  capUnits: 50,
  tenantSlug: 'minha-loja',
};

/** What a bilingual host writes — the shape `localeCopy(PACK)` produces. */
const resolver = ({ locale }: { readonly locale?: string | null }) =>
  locale === 'en-US' ? RESEARCH_BUDGET_COPY['en-US'] : RESEARCH_BUDGET_COPY['pt-BR'];

describe('the budget alert in the reader\'s language', () => {
  it('renders each recipient in their own language from ONE blueprint', () => {
    const blueprint = createResearchBudgetBlueprint(resolver);

    expect(blueprint.generate(payload, { locale: 'en-US' }).title).toBe(
      EN_US_RESEARCH_BUDGET_COPY.title(payload),
    );
    expect(blueprint.generate(payload, { locale: 'pt-BR' }).title).toBe(
      PT_BR_RESEARCH_BUDGET_COPY.title(payload),
    );
  });

  it('resolves at generate, never at build — the failure this replaces', () => {
    /*
      Asked how many times the resolver ran: once per alert, not once per mount.
      A factory that resolved eagerly would answer 1 here, and would still pass
      every single-language assertion above it.
    */
    // A COUNTER OBJECT, not a closed-over `let`: reassigning a binding from
    // inside a stub is what `no-global-state-mutation` refuses.
    const seen = { calls: 0 };
    const counted = (context: { readonly locale?: string | null }) => {
      seen.calls += 1;
      return resolver(context);
    };

    const blueprint = createResearchBudgetBlueprint(counted);
    expect(seen.calls).toBe(0);

    blueprint.generate(payload, { locale: 'en-US' });
    blueprint.generate(payload, { locale: 'pt-BR' });
    expect(seen.calls).toBe(2);
  });

  it('treats an absent context as "nobody said" rather than an error', () => {
    const blueprint = createResearchBudgetBlueprint(resolver);

    expect(blueprint.generate(payload).title).toBe(PT_BR_RESEARCH_BUDGET_COPY.title(payload));
    expect(blueprint.generate(payload, {}).title).toBe(PT_BR_RESEARCH_BUDGET_COPY.title(payload));
  });

  it('still accepts a plain table, so a single-audience host is unchanged', () => {
    const blueprint = createResearchBudgetBlueprint(PT_BR_RESEARCH_BUDGET_COPY);

    expect(blueprint.generate(payload, { locale: 'en-US' }).title).toBe(
      PT_BR_RESEARCH_BUDGET_COPY.title(payload),
    );
  });

  it('keeps the DATA fields fixed across languages — they are not copy', () => {
    // `scope`, `sourceType` and `period` are wire values a host filters and a
    // screen keys on; translating them would make the same alert unmatchable
    // for one reader and matchable for the next.
    const blueprint = createResearchBudgetBlueprint(resolver);

    expect(blueprint.generate(payload, { locale: 'en-US' }).data).toEqual(
      blueprint.generate(payload, { locale: 'pt-BR' }).data,
    );
  });
});
