/**
 * The way out of a refused request, as one button (FUT-3137): a host renders it
 * beside the refusal it already shows, and a click opens the upgrade prompt
 * every other trigger lands on.
 *
 * It reads the refusal itself — the status and the body the server answered —
 * because the body is self-sufficient (see `upsellPromptFromPaymentRequired`).
 * So it renders NOTHING for everything an upgrade does not fix: any status but
 * 402, a 402 without an entitlement code, and a plan denial with no plan to
 * offer (`requiredPlan: null`, already on the top tier), where "Ver planos"
 * would open a prompt with nothing to sell. A host can therefore hand it every
 * refusal without deciding which ones are a sale.
 */
import type { ComponentProps, JSX } from 'react';

import { Button } from '@12-apps/ui/form/Button';

import { raiseUpsell, upsellPromptFromPaymentRequired } from './upsell-channel';

/** A refused request as the host received it. */
export interface UpgradeButtonProps {
  /** The HTTP status; absent when the request never reached the server. */
  status?: number;
  /** The parsed response body. */
  body?: unknown;
  /**
   * The colour of the refusal it sits in — `danger` (the default) inside a red
   * alert. Outlined in that colour rather than a solid brand fill: beside a
   * refusal whose sentence names free ways out first (another role, a freed
   * seat), the paid one is offered, not pushed, and never outranks the form's
   * own submit.
   */
  color?: ComponentProps<typeof Button>['color'];
}

export function UpgradeButton({
  status,
  body,
  color = 'danger',
  label,
}: UpgradeButtonProps & { label: string }): JSX.Element | null {
  const prompt = status === undefined ? null : upsellPromptFromPaymentRequired(status, body);
  if (prompt === null || prompt.requiredPlan === null) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      color={color}
      onClick={() => raiseUpsell(prompt)}
      dataTestId="upgrade-button"
    >
      {label}
    </Button>
  );
}
