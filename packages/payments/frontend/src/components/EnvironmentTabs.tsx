'use client';

import { Alert, Tab, Tabs } from '@mui/material';

import type { PaymentEnvironment } from '@12-apps/payments-backend';

/** One environment's human name — the tabs and the probe result share it. */
export const ENVIRONMENT_LABELS: Record<PaymentEnvironment, string> = {
  SANDBOX: 'Sandbox',
  PRODUCTION: 'Produção',
};

/**
 * Sentence case, because these are place names rather than shouted commands —
 * MUI upper-cases tab labels by default, which turns "Produção" into signage.
 */
const TAB_SX = { textTransform: 'none' } as const;

/**
 * The two environments as tabs, not a select: there are exactly two, and which
 * one you are editing changes what every field below it means. A closed
 * dropdown hides that, and credentials are stored PER environment — so pasting
 * a production token while "Sandbox" sits collapsed above is a mistake the
 * control itself should not allow.
 */
export function EnvironmentSelector({
  environment,
  onChange,
}: {
  environment: PaymentEnvironment;
  onChange: (next: PaymentEnvironment) => void;
}) {
  return (
    <Tabs
      value={environment}
      onChange={(_, next: PaymentEnvironment) => onChange(next)}
      aria-label="Ambiente"
      data-testid="payments-environment-tabs"
    >
      <Tab
        label="Sandbox"
        value="SANDBOX"
        data-testid="payments-environment-SANDBOX"
        sx={TAB_SX}
      />
      <Tab
        label="Produção"
        value="PRODUCTION"
        data-testid="payments-environment-PRODUCTION"
        sx={TAB_SX}
      />
    </Tabs>
  );
}

/**
 * A banner that makes Produção LOOK different from Sandbox.
 *
 * Two tabs of identical fields, differing by one word in a tab label, is the
 * whole of what distinguished "type here and nothing happens" from "type here
 * and this is what charges your customers". The tab you are on is the least
 * noticeable thing on the screen, and the consequences of being on the wrong
 * one are entirely invisible until money moves.
 *
 * It states only what this package can actually back. NOT "nothing is real in
 * Sandbox": whether a sandbox call is faked depends on the deployment, and
 * InfinitePay has no sandbox at all — a reassurance that is sometimes false is
 * worse than none. What is always true is that the two credential sets are
 * separate, and which one serves the store's checkout is `config.environment`
 * — so when you are looking at the other one, the banner says so.
 */
export function EnvironmentNotice({
  environment,
  active,
}: {
  environment: PaymentEnvironment;
  /** The environment this store's real checkout uses, when it has one. */
  active: PaymentEnvironment | null;
}) {
  const elsewhere = active !== null && active !== environment ? ENVIRONMENT_LABELS[active] : null;
  const production = environment === 'PRODUCTION';
  return (
    <Alert
      severity={production ? 'warning' : 'info'}
      variant="standard"
      square
      data-testid={`payments-environment-notice-${environment}`}
      sx={{ borderRadius: 0, py: 0.5, px: 3 }}
    >
      <strong>
        {production ? 'Produção — dinheiro real.' : 'Sandbox — ambiente de teste.'}
      </strong>{' '}
      {production
        ? 'Tudo o que você fizer aqui vale para as vendas da loja.'
        : 'Nenhum valor sai ou entra de verdade.'}
      {elsewhere ? ` Hoje a loja está usando ${elsewhere}.` : ''}
    </Alert>
  );
}

/**
 * The banner is deliberately NOT bundled with the tabs any more.
 *
 * It has to run edge to edge across the provider card — a full-bleed strip is
 * what makes it read as a property of everything below it, rather than as one
 * more paragraph indented inside the content. That is only possible if the card
 * has a padded header and an unpadded band between it and the body, so the two
 * halves are placed separately by `ActivePanel`.
 */
