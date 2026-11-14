/**
 * The two pieces every SALE surface ends on — the line naming the plan, and
 * the press that asks for it — shared by the upsell prompt and the per-screen
 * plan comparison, so the `plan:request` gate is written once.
 *
 * PRICING copy stays out: these name the tier and file the lead; what a tier
 * costs is the plan screen's business, where the numbers arrive from the
 * host's billing.
 */
import { useState, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { Button } from '@12-apps/ui/form/Button';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import { createPlanApi } from './plan-api';
import type { ResolvedWebConfig } from './web-config';

/** What the ask is for: the tier, and the feature that prompted it, if any. */
interface UpgradeTarget {
  /** The tier to request — null renders nothing: there is nothing to sell. */
  requiredPlan: string | null;
  /** Filed beside the ask so a human knows which lock led to it. */
  feature?: string;
}

/**
 * The ask-for-the-plan action. Mirrors the plan page's gate: the WRITE requires
 * `plan:request` server-side, so a caller without it gets told which plan
 * unlocks the feature and to talk to whoever holds that permission — never a
 * button that answers 403.
 */
export function UpgradeCta({
  target,
  planName,
  config,
}: {
  target: UpgradeTarget;
  planName: string | null;
  config: ResolvedWebConfig;
}): JSX.Element | null {
  const [state, setState] = useState<{ sent: boolean; pending: boolean; error: Error | null }>({
    sent: false,
    pending: false,
    error: null,
  });
  const copy = config.copy.upsell;
  const { requiredPlan, feature } = target;
  if (requiredPlan === null) return null;
  if (!config.canRequestPlanChange) {
    return (
      <Text as="div" size="sm" color="secondary" data-testid="upsell-ask-admin">
        {copy.askAdmin}
      </Text>
    );
  }
  if (state.sent) {
    // Never the raw plan key, not even here: while the commercial name is
    // still loading, `requestReceived` gets null and drops the clause.
    return (
      <Alert severity="info" data-testid="upsell-request-sent">
        {copy.requestReceived({ planName })}
      </Alert>
    );
  }
  const ask = (): void => {
    setState({ sent: false, pending: true, error: null });
    createPlanApi(config.apiBase, config.fetchImpl, config.copy.requestFailed)
      .requestPlanChange({ requestedPlan: requiredPlan, feature })
      .then(
        () => setState({ sent: true, pending: false, error: null }),
        (error: unknown) =>
          setState({
            sent: false,
            pending: false,
            error: error instanceof Error ? error : new Error(String(error)),
          }),
      );
  };
  return (
    <Stack spacing={1}>
      {state.error === null ? null : (
        <Alert severity="error" data-testid="upsell-request-error">
          {state.error.message}
        </Alert>
      )}
      <Button size="sm" fullWidth disabled={state.pending} data-testid="upsell-cta" onClick={ask}>
        {copy.requestAction}
      </Button>
    </Stack>
  );
}

/**
 * The pitch line — only once the catalog resolves the COMMERCIAL name: the
 * raw plan key must never face a customer, not even as a loading fallback,
 * and a null `requiredPlan` must never leave the pitch dangling around a
 * blank. The name slot is markup, so the sentence ships as prefix + suffix
 * around it, each half carrying its own spacing.
 */
export function PlanPitchLine({
  planName,
  config,
}: {
  planName: string | null;
  config: ResolvedWebConfig;
}): JSX.Element | null {
  if (planName === null) return null;
  const { prefix, suffix } = config.copy.upsell.planPitch;
  return (
    <Text as="div" data-testid="upsell-plan-name">
      {prefix}
      <strong>{planName}</strong>
      {suffix}
    </Text>
  );
}
