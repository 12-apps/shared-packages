'use client';

import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';

import type { ClientChargeView, CustomerInfo, Money } from '@12-apps/payments-backend';

import type { ClientPaymentsConfig, PaymentsClient } from '../client';
import { useChargeStatus, useCreateCharge, usePaymentsClient } from '../context';

import type { CheckoutPaymentCopy, LegacyRefusalCopy } from './checkout-payment-copy';
import type { CardFormValues, SavedCardOption } from './checkout-payment-types';
import { formatAmount, MethodChooser, PixPanel } from './checkout-payment-views';

export type { CardFormValues, SavedCardOption };

/**
 * Plug-and-play checkout payment step — the reusable equivalent of the
 * buyer-facing payment screen. Renders the right flow for the merchant's
 * ACTIVE provider by switching on its client config and the created charge:
 *
 *   - PIX: create → show copy-paste QR payload (+ image when the provider
 *     returns one) → poll until PAID → `onPaid`
 *   - CARD: collect via a host-injected `tokenizeCard` (each provider's
 *     tokenization differs — Stripe SDK, public-key encryption, ...); only
 *     the resulting TOKEN reaches the backend
 *   - REDIRECT (hosted checkout, e.g. InfinitePay): send the buyer to
 *     `hostedCheckoutUrl`, poll on return
 *
 * Must be rendered inside a `<PaymentsProvider>`. The host owns totals,
 * order creation, and what happens on `onPaid` — this component owns only
 * the payment interaction.
 */
export interface CheckoutPaymentProps {
  /**
   * Opaque host-side handle for what is being paid (cart/order id). Sent as
   * a LOOKUP KEY only — the server resolves the authoritative amount and
   * reference from its own records, never from this component.
   */
  reference: string;
  /** Display total. Shown to the buyer; the server recomputes what is charged. */
  amount: Money;
  customer: CustomerInfo;
  /**
   * Provider-specific client-side tokenization, injected by the host using
   * `config.tokenization`/`config.publicKey` (SDK or public-key flows).
   * Required for providers whose config declares CARD support.
   */
  tokenizeCard?: (values: CardFormValues, config: ClientPaymentsConfig) => Promise<string>;
  /** Provider-vaulted cards for one-tap reuse (host loads them). */
  savedCards?: SavedCardOption[];
  onPaid: (charge: ClientChargeView) => void;
  onFailed?: (charge: ClientChargeView) => void;
  /**
   * Every sentence this step renders — the HOST's, required and with no
   * default (FUT-760). A pt-BR host passes `PT_BR_CHECKOUT_PAYMENT_COPY`.
   */
  copy: CheckoutPaymentCopy;
}

function firstError(...messages: (string | null | undefined)[]): string | null {
  for (const message of messages) if (message) return message;
  return null;
}

/** Card charges can settle synchronously on create (no polling needed). */
function isFinalOnCreate(charge: ClientChargeView): boolean {
  return charge.status !== 'PENDING' && charge.status !== 'AUTHORIZED';
}

/** Load the merchant's client-safe payment config once. */
function useClientConfig(client: PaymentsClient) {
  const [config, setConfig] = useState<ClientPaymentsConfig | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    client
      .getConfig()
      .then(setConfig)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [client]);
  return { config, error };
}

/** Fire onPaid/onFailed exactly when the charge reaches its outcome. */
function useChargeOutcome(
  current: ClientChargeView | null,
  settled: boolean,
  onPaid: (charge: ClientChargeView) => void,
  onFailed?: (charge: ClientChargeView) => void,
) {
  useEffect(() => {
    if (!current) return;
    if (current.status === 'PAID') onPaid(current);
    else if (settled || isFinalOnCreate(current)) onFailed?.(current);
  }, [current, settled, onPaid, onFailed]);
}

/** Poll target: only charges that can still change server-side. */
function pollRefOf(charge: ClientChargeView | null) {
  if (!charge || isFinalOnCreate(charge)) return null;
  return { provider: charge.provider, providerChargeId: charge.providerChargeId };
}

interface CheckoutGateProps {
  errorMessage: string | null;
  config: ClientPaymentsConfig | null | undefined;
  copy: LegacyRefusalCopy;
}

/** Error / loading / payments-disabled gates ahead of the payment UI. */
function checkoutGate({ errorMessage, config, copy }: CheckoutGateProps) {
  if (errorMessage) return <Alert severity="error">{errorMessage}</Alert>;
  if (config === undefined) return <CircularProgress data-testid="checkout-payment-loading" />;
  if (config === null) return <Alert severity="warning">{copy.paymentsOff}</Alert>;
  return null;
}

/** In-flight phase: the created charge decides what the buyer sees. */
function ChargePhase({
  charge,
  amount,
  copy,
}: {
  charge: ClientChargeView;
  amount: Money;
  copy: CheckoutPaymentCopy;
}) {
  if (charge.hostedCheckoutUrl && charge.status === 'PENDING') {
    return (
      <Stack spacing={2}>
        <Typography>{copy.refusal.redirectNotice}</Typography>
        <Button variant="contained" href={charge.hostedCheckoutUrl}>
          {copy.money.payAction(formatAmount(amount, copy.money))}
        </Button>
      </Stack>
    );
  }
  if (charge.method === 'PIX' && charge.status === 'PENDING') {
    return <PixPanel charge={charge} copy={copy.pix} />;
  }
  return null;
}

export function CheckoutPayment(props: CheckoutPaymentProps) {
  const { reference, amount, customer, tokenizeCard, savedCards = [], onPaid, onFailed, copy } =
    props;
  const client = usePaymentsClient();
  const { config, error: configError } = useClientConfig(client);
  const [tokenizeError, setTokenizeError] = useState<string | null>(null);
  const { charge, loading, create, error: createError } = useCreateCharge();
  const { charge: live, settled } = useChargeStatus(pollRefOf(charge));
  const current = live ?? charge;
  useChargeOutcome(current, settled, onPaid, onFailed);

  const startPix = useCallback(
    () => void create({ method: 'PIX', customer, orderRef: reference }),
    [create, reference, customer],
  );

  const startCard = useCallback(
    async (values: CardFormValues) => {
      if (!config || !tokenizeCard) {
        setTokenizeError(copy.refusal.cardUnavailable);
        return;
      }
      try {
        const token = await tokenizeCard(values, config);
        await create({
          method: 'CARD',
          customer,
          orderRef: reference,
          card: { token, holder: values.holder },
        });
      } catch (err) {
        setTokenizeError(err instanceof Error ? err.message : String(err));
      }
    },
    [config, tokenizeCard, create, reference, customer, copy],
  );

  const startSavedCard = useCallback(
    (card: SavedCardOption) =>
      void create({
        method: 'CARD',
        customer,
        orderRef: reference,
        card: { savedCardToken: card.savedCardToken },
      }),
    [create, reference, customer],
  );

  const errorMessage = firstError(configError, tokenizeError, createError && createError.message);
  const gate = checkoutGate({ errorMessage, config, copy: copy.refusal });
  if (gate || config === undefined || config === null) return gate;

  return (
    <Stack spacing={2}>
      <Typography variant="h6">{copy.money.totalLabel(formatAmount(amount, copy.money))}</Typography>
      {current ? (
        <ChargePhase charge={current} amount={amount} copy={copy} />
      ) : (
        <MethodChooser
          config={config}
          amount={amount}
          savedCards={savedCards}
          loading={loading}
          startPix={startPix}
          startCard={(values) => void startCard(values)}
          startSavedCard={startSavedCard}
          copy={copy}
        />
      )}
    </Stack>
  );
}
