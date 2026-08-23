'use client';

import { Alert, Box, Tab, Tabs, Typography } from '@mui/material';

import type { PaymentEnvironment } from '@12-apps/payments-backend';

import { T } from './panel-tokens';
import type { EnvironmentCopy } from './settings-copy';
import { usePaymentsSettingsCopy } from './settings-copy-context';

/**
 * One environment's human name — the tabs and the probe result share it.
 *
 * Built from the host's pack rather than declared here (FUT-760): the names
 * appear inside the probe's own failure sentence too, so one spelling has to
 * serve both or the screen contradicts itself.
 */
export function environmentLabels(copy: EnvironmentCopy): Record<PaymentEnvironment, string> {
  return { SANDBOX: copy.sandbox, PRODUCTION: copy.production };
}

/**
 * Sentence case, because these are place names rather than shouted commands —
 * MUI upper-cases tab labels by default, which turns "Produção" into signage.
 */
const TAB_SX = {
  textTransform: 'none',
  minHeight: 0,
  minWidth: 0,
  borderRadius: '6px',
  px: '14px',
  py: '6px',
  fontSize: '12.5px',
  fontWeight: 600,
  color: T.ink3,
  '&.Mui-selected': {
    background: T.bg,
    color: T.ink,
    boxShadow: '0 1px 3px rgba(0,0,0,.09)',
  },
} as const;

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
  const copy = usePaymentsSettingsCopy().environment;
  // A segmented control, not underlined tabs. Two options that CHANGE WHAT
  // EVERY FIELD BELOW MEANS should look like a switch being thrown, and the
  // label above says which switch — "Ambiente" alone reads as a page section.
  return (
    <Box>
      <Typography
        sx={{ display: 'block', fontSize: '12px', fontWeight: 650, color: T.ink2, mb: '5px' }}
      >
        {copy.groupLabel}
      </Typography>
      <Tabs
        value={environment}
        onChange={(_, next: PaymentEnvironment) => onChange(next)}
        aria-label={copy.groupLabel}
        data-testid="payments-environment-tabs"
        slotProps={{ indicator: { sx: { display: 'none' } } }}
        sx={{
          minHeight: 0,
          width: 'fit-content',
          background: T.bg2,
          border: `1px solid ${T.line}`,
          borderRadius: '9px',
          p: '4px',
        }}
      >
        <Tab
          label={copy.sandbox}
          value="SANDBOX"
          data-testid="payments-environment-SANDBOX"
          sx={TAB_SX}
        />
        <Tab
          label={copy.production}
          value="PRODUCTION"
          data-testid="payments-environment-PRODUCTION"
          sx={TAB_SX}
        />
      </Tabs>
    </Box>
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
  band = true,
}: {
  environment: PaymentEnvironment;
  /** The environment this store's real checkout uses, when it has one. */
  active: PaymentEnvironment | null;
  /**
   * Rendered as the card's full-bleed strip (the default), or as an ordinary
   * inset alert.
   *
   * The band geometry — square corners, and `px: 3` matching the card's own
   * padding so the text lines up with the content above and below — only reads
   * correctly when the strip actually spans the card. Stacked INSIDE the manual
   * disclosure, where it is already inset by the accordion, the same values
   * indent the text a second time and square off a box that is visibly not
   * touching either edge.
   */
  band?: boolean;
}) {
  const copy = usePaymentsSettingsCopy().environment;
  const elsewhere =
    active !== null && active !== environment ? environmentLabels(copy)[active] : null;
  const production = environment === 'PRODUCTION';
  return (
    <Alert
      severity={production ? 'warning' : 'info'}
      variant="standard"
      square={band}
      data-testid={`payments-environment-notice-${environment}`}
      sx={band ? { borderRadius: 0, py: 0.5, px: 3 } : { py: 0.5 }}
    >
      <strong>
        {production ? copy.productionMeaning : copy.sandboxMeaning}
      </strong>{' '}
      {production ? copy.productionConsequence : copy.sandboxConsequence}
      {elsewhere ? copy.storeIsUsing(elsewhere) : ''}
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
