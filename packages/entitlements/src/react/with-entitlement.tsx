/**
 * `withEntitlement` — the sanctioned way to plan-gate a page.
 *
 * Wrap the page module's export, never the route element: the wrap is then
 * statically greppable, which is what lets the coverage gate
 * (`scripts/entitlements-coverage.mjs`) assert that every routed page either
 * declares its gate or is allowlisted with a reason. A page open to every
 * tier is still wrapped where a key exists for it — "ungated" must be a
 * decision in the diff, not an omission.
 *
 * Reason semantics mirror `<Locked>` and a sidebar's lock resolution, so the
 * surfaces can never disagree:
 *   - `enabled`            → the page.
 *   - `disabled-by-tenant` → the page. The tenant's own switch is not a plan
 *     problem; the page's existing tenant-off UX stays authoritative.
 *   - `not-supported`      → the page. A key this snapshot does not carry is
 *     a stale client, and a stale client must never paywall a page the
 *     tenant owns — the server gate is the real enforcement either way.
 *   - anything else        → the full-page lock, in-shell (the chrome stays,
 *     so the operator is told what unlocks it instead of losing the nav).
 *
 * Presentation only: every wrapped page pairs with a server-side
 * `requireEntitlement`/`requireQuota` guard. A page gated client-side alone
 * looks fixed while `curl` still walks in.
 */
import type { ComponentType, JSX } from 'react';

import { Button } from '@12-apps/ui/form/Button';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import type { UpsellReason } from '../plan-wire';
import { useEntitlement } from './context';
import { raiseUpsell } from './upsell-channel';

/** The reasons that render the page instead of the lock. */
const PASS_THROUGH = new Set(['enabled', 'disabled-by-tenant', 'not-supported']);

/**
 * Reasons the upsell channel understands. An unknown reason on a locked
 * decision still IS a plan denial — same safe default as a 402 interceptor.
 */
const LOCK_REASONS: readonly UpsellReason[] = ['not-entitled', 'restricted', 'suspended'];

const LOCK_COPY: Record<UpsellReason, { title: string; body: string }> = {
  'not-entitled': {
    title: 'Recurso não incluído no seu plano',
    body: 'Seu plano atual não inclui esta área. Conheça as opções de plano para desbloqueá-la.',
  },
  'quota-exceeded': {
    title: 'Limite do plano atingido',
    body: 'Você usou todo o limite que o seu plano inclui para este recurso.',
  },
  restricted: {
    title: 'Pagamento pendente',
    body: 'Há uma pendência de pagamento na assinatura da loja, por isso esta área está temporariamente indisponível.',
  },
  suspended: {
    title: 'Assinatura suspensa',
    body: 'A assinatura da loja está suspensa e esta área ficou indisponível.',
  },
  // Never reached (disabled-by-tenant passes through) — present so the record
  // stays total over UpsellReason and the type system keeps it that way.
  'disabled-by-tenant': {
    title: 'Recurso desativado',
    body: 'Este recurso está desativado nas configurações da loja.',
  },
};

/**
 * The full-page lock. Kept deliberately thin: the upsell prompt host is the
 * single surface that owns the plan name and the request-the-plan CTA, so the
 * page states WHY and the button funnels into that surface.
 */
function PageLock({ feature, reason }: { feature: string; reason: UpsellReason }): JSX.Element {
  const decision = useEntitlement(feature);
  const copy = LOCK_COPY[reason];
  return (
    <Stack
      spacing={2}
      alignItems="flex-start"
      data-testid="page-locked"
      data-feature={feature}
      sx={{ maxWidth: 560, p: 2 }}
    >
      <Text variant="heading" size="lg" as="h1">
        {copy.title}
      </Text>
      <Text variant="body" as="p">
        {copy.body}
      </Text>
      <Button
        data-testid="page-locked-upsell"
        onClick={() =>
          raiseUpsell({ feature, requiredPlan: decision.requiredPlan ?? null, reason })
        }
      >
        Saiba mais
      </Button>
    </Stack>
  );
}

/**
 * Gate `Component` behind `feature`. Composes with lazy routes because the
 * wrap happens on the module's exported component — the lazy chunk resolves
 * to the already-wrapped page.
 */
export function withEntitlement<P extends object>(
  feature: string,
  Component: ComponentType<P>,
): ComponentType<P> {
  function Gated(props: P): JSX.Element {
    const decision = useEntitlement(feature);
    if (decision.enabled || PASS_THROUGH.has(decision.reason)) {
      return <Component {...props} />;
    }
    const reason = LOCK_REASONS.find((known) => known === decision.reason) ?? 'not-entitled';
    return <PageLock feature={feature} reason={reason} />;
  }
  Gated.displayName = `withEntitlement(${Component.displayName ?? Component.name ?? 'Page'})`;
  return Gated;
}
