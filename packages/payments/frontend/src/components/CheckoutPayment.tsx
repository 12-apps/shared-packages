'use client';

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';

import type { ClientChargeView, CustomerInfo, Money } from '@12-apps/payments-backend';

import type { ClientPaymentsConfig, PaymentsClient } from '../client';
import { useChargeStatus, useCreateCharge, usePaymentsClient } from '../context';

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
export interface CardFormValues {
  number: string;
  holder: string;
  expiry: string;
  cvv: string;
}

/** A provider-vaulted card the buyer may reuse ("Mastercard •••• 7599"). */
export interface SavedCardOption {
  savedCardToken: string;
  brand: string;
  last4: string;
  /** e.g. "02/2034" — shown as "Validade 02/2034". */
  expiry?: string;
}

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
}

function formatBRL(amount: Money): string {
  return (amount.amountCents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: amount.currency,
  });
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

function PixPanel({ charge }: { charge: ClientChargeView }) {
  const [copied, setCopied] = useState(false);
  if (!charge.pix) return null;
  return (
    <Stack spacing={1} alignItems="flex-start">
      {charge.pix.qrImageUrl ? (
        <Box component="img" src={charge.pix.qrImageUrl} alt="QR Code PIX" sx={{ width: 220 }} />
      ) : null}
      <TextField fullWidth multiline size="small" label="PIX copia e cola" value={charge.pix.qrText} />
      <Button
        size="small"
        onClick={() => {
          void navigator.clipboard.writeText(charge.pix?.qrText ?? '').then(() => setCopied(true));
        }}
      >
        {copied ? 'Copiado!' : 'Copiar código'}
      </Button>
      <Stack direction="row" spacing={1} alignItems="center">
        <CircularProgress size={16} />
        <Typography variant="body2">Aguardando pagamento…</Typography>
      </Stack>
    </Stack>
  );
}

function CardPanel({ disabled, onSubmit }: { disabled: boolean; onSubmit: (values: CardFormValues) => void }) {
  const [values, setValues] = useState<CardFormValues>({ number: '', holder: '', expiry: '', cvv: '' });
  const field = (key: keyof CardFormValues, label: string, width?: number) => (
    <TextField
      size="small"
      label={label}
      value={values[key]}
      sx={width ? { width } : undefined}
      onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
    />
  );
  return (
    <Stack spacing={2}>
      {field('number', 'Número do cartão')}
      {field('holder', 'Nome impresso no cartão')}
      <Stack direction="row" spacing={2}>
        {field('expiry', 'Validade (MM/AA)', 140)}
        {field('cvv', 'CVV', 100)}
      </Stack>
      <Button variant="contained" disabled={disabled} onClick={() => onSubmit(values)}>
        Pagar com cartão
      </Button>
    </Stack>
  );
}

interface CardSectionProps {
  amount: Money;
  savedCards: SavedCardOption[];
  disabled: boolean;
  onNewCard: (values: CardFormValues) => void;
  onSavedCard: (card: SavedCardOption) => void;
}

/** "Pague com cartão": saved cards as radios + "Novo cartão" fallback. */
function CardSection({ amount, savedCards, disabled, onNewCard, onSavedCard }: CardSectionProps) {
  const [selected, setSelected] = useState(savedCards[0]?.savedCardToken ?? 'new');
  const chosen = savedCards.find((c) => c.savedCardToken === selected);
  if (savedCards.length === 0) return <CardPanel disabled={disabled} onSubmit={onNewCard} />;
  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2">Pague com cartão</Typography>
      <RadioGroup value={selected} onChange={(_, v) => setSelected(v)}>
        {savedCards.map((card) => (
          <FormControlLabel
            key={card.savedCardToken}
            value={card.savedCardToken}
            control={<Radio />}
            label={`${card.brand} •••• ${card.last4}${card.expiry ? ` — Validade ${card.expiry}` : ''}`}
          />
        ))}
        <FormControlLabel value="new" control={<Radio />} label="Novo cartão — inserir outro cartão" />
      </RadioGroup>
      {chosen ? (
        <Button variant="contained" disabled={disabled} onClick={() => onSavedCard(chosen)}>
          Pagar {formatBRL(amount)}
        </Button>
      ) : (
        <CardPanel disabled={disabled} onSubmit={onNewCard} />
      )}
    </Stack>
  );
}

interface MethodChooserProps {
  config: ClientPaymentsConfig;
  amount: Money;
  savedCards: SavedCardOption[];
  loading: boolean;
  startPix: () => void;
  startCard: (values: CardFormValues) => void;
  startSavedCard: (card: SavedCardOption) => void;
}

/** One "Forma de pagamento" option card (PIX / Cartão). */
function MethodCard(props: { title: string; subtitle: string; selected: boolean; onClick: () => void }) {
  return (
    <Button
      variant="outlined"
      onClick={props.onClick}
      sx={{ flex: 1, justifyContent: 'flex-start', textAlign: 'left', borderWidth: props.selected ? 2 : 1 }}
    >
      <Stack alignItems="flex-start">
        <Typography variant="subtitle2">{props.title}</Typography>
        <Typography variant="caption" color="text.secondary">
          {props.subtitle}
        </Typography>
      </Stack>
    </Button>
  );
}

/** Pre-charge phase: "Forma de pagamento" method cards, then the flow. */
function MethodChooser(props: MethodChooserProps) {
  const { config, amount, savedCards, loading, startPix, startCard, startSavedCard } = props;
  const [method, setMethod] = useState<'PIX' | 'CARD'>('PIX');
  if (config.tokenization === 'REDIRECT') {
    return (
      <Button variant="contained" disabled={loading} onClick={startPix}>
        Continuar para o pagamento
      </Button>
    );
  }
  return (
    <>
      <Typography variant="subtitle2">Forma de pagamento</Typography>
      <Stack direction="row" spacing={2}>
        <MethodCard title="PIX" subtitle="Aprovação imediata" selected={method === 'PIX'} onClick={() => setMethod('PIX')} />
        <MethodCard title="Cartão" subtitle="Crédito à vista" selected={method === 'CARD'} onClick={() => setMethod('CARD')} />
      </Stack>
      {method === 'PIX' ? (
        <Button variant="contained" disabled={loading} onClick={startPix}>
          Gerar QR Code PIX
        </Button>
      ) : (
        <CardSection
          amount={amount}
          savedCards={savedCards}
          disabled={loading}
          onNewCard={startCard}
          onSavedCard={startSavedCard}
        />
      )}
    </>
  );
}

/** Poll target: only charges that can still change server-side. */
function pollRefOf(charge: ClientChargeView | null) {
  if (!charge || isFinalOnCreate(charge)) return null;
  return { provider: charge.provider, providerChargeId: charge.providerChargeId };
}

interface CheckoutGateProps {
  errorMessage: string | null;
  config: ClientPaymentsConfig | null | undefined;
}

/** Error / loading / payments-disabled gates ahead of the payment UI. */
function checkoutGate({ errorMessage, config }: CheckoutGateProps) {
  if (errorMessage) return <Alert severity="error">{errorMessage}</Alert>;
  if (config === undefined) return <CircularProgress data-testid="checkout-payment-loading" />;
  if (config === null) {
    return <Alert severity="warning">Esta loja ainda não aceita pagamentos online.</Alert>;
  }
  return null;
}

/** In-flight phase: the created charge decides what the buyer sees. */
function ChargePhase({ charge, amount }: { charge: ClientChargeView; amount: Money }) {
  if (charge.hostedCheckoutUrl && charge.status === 'PENDING') {
    return (
      <Stack spacing={2}>
        <Typography>Você será direcionado para concluir o pagamento com segurança.</Typography>
        <Button variant="contained" href={charge.hostedCheckoutUrl}>
          Pagar {formatBRL(amount)}
        </Button>
      </Stack>
    );
  }
  if (charge.method === 'PIX' && charge.status === 'PENDING') return <PixPanel charge={charge} />;
  return null;
}

export function CheckoutPayment(props: CheckoutPaymentProps) {
  const { reference, amount, customer, tokenizeCard, savedCards = [], onPaid, onFailed } = props;
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
        setTokenizeError('Pagamento com cartão indisponível.');
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
    [config, tokenizeCard, create, reference, customer],
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
  const gate = checkoutGate({ errorMessage, config });
  if (gate || config === undefined || config === null) return gate;

  return (
    <Stack spacing={2}>
      <Typography variant="h6">Total: {formatBRL(amount)}</Typography>
      {current ? (
        <ChargePhase charge={current} amount={amount} />
      ) : (
        <MethodChooser
          config={config}
          amount={amount}
          savedCards={savedCards}
          loading={loading}
          startPix={startPix}
          startCard={(values) => void startCard(values)}
          startSavedCard={startSavedCard}
        />
      )}
    </Stack>
  );
}
