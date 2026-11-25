'use client';

import { Button, Stack, Typography } from '@mui/material';
import { useState, type ReactNode } from 'react';

import type { EvidenceRunSection } from '@12-apps/payments-backend';

import { TAP_SX } from './ConnectEnvironmentCard';
import type { HomologacaoProductionEvidenceCopy } from './copy';
import type { EvidenceWallets } from './HomologacaoEvidenceWallets';
import { ConfirmDialog, type HomologacaoProductionSellerView } from './HomologacaoProductionEvidenceCard';
import { retryPlanOf, type RetryPlan } from './production-retry';
import type { useProductionForm, useProductionRun } from './use-production-run';

/**
 * Retry only what did not pass (FUT-5584, the owner: "Se falhar só uma coisa,
 * quero poder tentar só aquela coisa"): one press raises again, in the same
 * run, the scenarios that failed or never ran and took no money; what passed
 * is never charged again. It asks "confirmar" like the first charge, since it
 * charges real money too.
 */

/** A section's name as the scenario list says it. */
function sectionName(section: EvidenceRunSection, copy: HomologacaoProductionEvidenceCopy): string {
  const names = copy.scenarios.names;
  if (section === 'PIX') return names.pix;
  if (section === 'CARD') return names.credit;
  if (section === 'DEBIT') return names.debit;
  return section === 'GOOGLE_PAY' ? names.googlePay : names.applePay;
}

const namesOf = (sections: readonly EvidenceRunSection[], copy: HomologacaoProductionEvidenceCopy): string =>
  sections.map((section) => sectionName(section, copy)).join(', ');

/**
 * Retry only what did not pass (FUT-5584): one press raises again, in the
 * same run, the scenarios that failed or never ran and took no money; what
 * passed is never charged again. Under it, what the other ones still need.
 */
function RetryBlock({
  copy,
  plan,
  disabled,
  onRetry,
}: {
  copy: HomologacaoProductionEvidenceCopy;
  plan: RetryPlan;
  disabled: boolean;
  onRetry: () => void;
}): ReactNode {
  if (plan.now.length === 0 && plan.waiting.length === 0) return null;
  const needs = plan.waiting.filter((section): section is Exclude<EvidenceRunSection, 'PIX'> => section !== 'PIX');
  return (
    <Stack spacing={0.75} data-testid="production-retry">
      {plan.now.length > 0 ? (
        <Button variant="contained" disabled={disabled} onClick={onRetry} data-testid="production-retry-failed" sx={{ ...TAP_SX, alignSelf: 'flex-start' }}>
          {copy.retry.button(namesOf(plan.now, copy))}
        </Button>
      ) : null}
      {needs.length > 0 ? (
        <Typography variant="caption" color="text.secondary" data-testid="production-retry-waiting">
          {copy.retry.waiting(needs.map((section) => `${sectionName(section, copy)} — ${copy.retry.needs[section]}`).join('; '))}
        </Typography>
      ) : null}
    </Stack>
  );
}

/** "R$ 3,00" for three scenarios: R$ 1,00 each. */
const reaisFor = (count: number): string => `R$ ${count},00`;

interface ProductionRetryProps {
  copy: HomologacaoProductionEvidenceCopy;
  seller: HomologacaoProductionSellerView | null;
  form: ReturnType<typeof useProductionForm>;
  wallets: EvidenceWallets;
  flow: ReturnType<typeof useProductionRun>;
}

/** What the retry raises right now, and what the others still wait for; nothing while a run goes on. */
function planOf({ seller, form, wallets, flow }: ProductionRetryProps): RetryPlan {
  const offered = flow.canRetry && seller?.connected === true && !flow.busy;
  return retryPlanOf(offered ? seller?.retryable : null, {
    credit: form.retryInputs.credit,
    debit: form.retryInputs.debit,
    googlePay: Boolean(wallets.results.GOOGLE_PAY?.token),
    applePay: wallets.appleIncluded,
  });
}

export function ProductionRetry(props: ProductionRetryProps): ReactNode {
  const { copy, form, wallets, flow } = props;
  const [retrying, setRetrying] = useState<readonly EvidenceRunSection[] | null>(null);
  const plan = planOf(props);
  return (
    <>
      <RetryBlock copy={copy} plan={plan} disabled={!form.retryInputs.buyer} onRetry={() => setRetrying(plan.now)} />
      <ConfirmDialog
        open={retrying !== null}
        copy={{
          ...copy.confirm,
          title: copy.retry.confirmTitle,
          body: copy.retry.confirmBody(namesOf(retrying ?? [], copy), reaisFor(retrying?.length ?? 0)),
        }}
        onCancel={() => setRetrying(null)}
        onConfirm={() => {
          const sections = retrying ?? [];
          setRetrying(null);
          // Apple's sheet opens synchronously inside the confirm's tap, as on a first run.
          void flow.retry(sections, sections.includes('APPLE_PAY') ? wallets.openApple() : null);
        }}
      />
    </>
  );
}
