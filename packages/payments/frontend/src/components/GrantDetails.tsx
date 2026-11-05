'use client';

import { Chip, Stack, Typography } from '@mui/material';

import type { ConnectedOAuthAccount } from '@12-apps/payments-backend';

import { expiryProximity } from './connection-state';
import type { OAuthConnectionCopy } from './settings-copy';
import { usePaymentsSettingsCopy } from './settings-copy-context';

/**
 * A connected grant's two details under the facts: when it lapses, and what it
 * may do. Their own file so the connection card stays inside the size gate.
 */

/**
 * The expiry caption, with PROXIMITY emphasis (FUT-683): the renewal sweep
 * normally refreshes a grant long before it lapses, so an expiry that is
 * actually close means renewal has been failing quietly — and this caption is
 * the only warning an owner gets before checkout starts refusing. A neutral
 * gray line read the same on the eve of an outage as a year out.
 */
export function ExpiryNote(props: { expiresAt: string }) {
  const copy = usePaymentsSettingsCopy().oauth;
  const when = new Date(props.expiresAt).toLocaleString('pt-BR');
  const proximity = expiryProximity(props.expiresAt);
  if (proximity === 'SAFE' || proximity === null) {
    return (
      <Typography variant="caption" color="text.secondary">
        {copy.validUntil(when)}
      </Typography>
    );
  }
  return (
    <Typography
      variant="caption"
      color={proximity === 'PAST' ? 'error.main' : 'warning.main'}
      sx={{ fontWeight: 600 }}
      data-testid="payments-expiry-warning"
    >
      {proximity === 'PAST'
        ? copy.expiredAt(when)
        : copy.expiresAt(when)}
    </Typography>
  );
}


/**
 * pt-BR labels for the scopes a store owner actually sees. Unknown scopes fall
 * back to the provider's own spelling — wrong words are worse than raw ones.
 */
function scopeLabels(copy: OAuthConnectionCopy): Record<string, string> {
  return {
    'payments.read': copy.scopes.read,
    'payments.create': copy.scopes.create,
    'payments.refund': copy.scopes.refund,
    'accounts.read': copy.scopes.account,
  };
}

/**
 * WHAT the connected grant may do (FUT-300): its granted scopes, in the
 * owner's words.
 *
 * The account and the connect date used to be repeated here, as sentences
 * under the facts grid that already states both (`ConnectionFacts`). One place
 * per thing: the grid answers "which account, since when"; this answers only
 * what the grid cannot.
 */
export function GrantedScopes(props: { account: ConnectedOAuthAccount }) {
  const copy = usePaymentsSettingsCopy().oauth;
  const { grantedScopes } = props.account;
  if (grantedScopes.length === 0) return null;
  return (
    <Stack
      direction="row"
      spacing={0.5}
      useFlexGap
      flexWrap="wrap"
      data-testid="payments-connected-account"
    >
      {grantedScopes.map((scope) => (
        <Chip key={scope} size="small" variant="outlined" label={scopeLabels(copy)[scope] ?? scope} />
      ))}
    </Stack>
  );
}

