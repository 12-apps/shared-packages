'use client';

import { Box, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import type {
  BrowserWalletFailure,
  BrowserWalletResult,
  EvidenceWallet,
  EvidenceWalletsConfig,
} from '@12-apps/payments-backend';

import {
  applePaySessionClass,
  applePaySupported,
  startApplePaySession,
  type ApplePayPaymentMethod,
  type ApplePaySessionClass,
} from '../checkout/apple-pay-button';
import {
  paymentDataRequest,
  sheetDismissed,
  useGooglePayClient,
  type GooglePayApi,
  type GooglePaymentData,
  type GooglePaymentsClient,
} from '../checkout/google-pay-button';
import type { AppleAbsence, HomologacaoEvidenceWalletsCopy } from './copy';
import { usePlatformCopy } from './copy-context';

/**
 * The wallet step of the evidence card (FUT-3755): Google Pay's and Apple
 * Pay's sheets, opened BEFORE "generate" because each opens only inside the
 * operator's own tap — the browser refuses a sheet started from the async
 * chain "generate" runs. A press keeps the wallet's token in state, the screen
 * says the wallet is ready (network and last four, never the token), and
 * "generate" hands the results to phase 2 with the cards.
 *
 * The sheets are the checkout's own: the same `PaymentsClient` probe and
 * payment request (`google-pay-button.tsx`), the same `ApplePaySession`
 * (`apple-pay-button.tsx`). Google Pay runs in the environment the host's
 * seller view names (`TEST` for the sandbox evidence, `PRODUCTION` for the
 * production one, FUT-4198) and mints against the seller's PagBank account; Apple Pay is offered only where the device has an
 * `ApplePaySession`, the host has an Apple Pay identity, and the host validates
 * the merchant.
 */

/** The wallets, in the order the evidence file prints them. */
const WALLETS: readonly EvidenceWallet[] = ['GOOGLE_PAY', 'APPLE_PAY'];

type Results = Partial<Record<EvidenceWallet, BrowserWalletResult>>;

interface EvidenceWalletsInput {
  /** What each sheet needs, from the host's seller view; null when the host gave none. */
  config: EvidenceWalletsConfig | null;
  /** The host's Apple Pay merchant validation (server-side); absent, Apple Pay is not offered. */
  validateApplePayMerchant?: (validationURL: string) => Promise<unknown>;
  /** Injectable `google.payments.api` for tests; omit to load pay.js. */
  googlePayApi?: GooglePayApi | null;
}

const failed = (type: EvidenceWallet, failure: BrowserWalletFailure): BrowserWalletResult => ({
  type,
  token: null,
  brand: null,
  last4: null,
  failure,
});

/** Four trailing digits, or null — the only part of the number a wallet shows. */
function lastFour(text: string | undefined): string | null {
  return /(\d{4})\s*$/.exec(text ?? '')?.[1] ?? null;
}

function googleResult(data: GooglePaymentData): BrowserWalletResult {
  const info = data.paymentMethodData.info;
  return {
    type: 'GOOGLE_PAY',
    token: data.paymentMethodData.tokenizationData.token,
    brand: info?.cardNetwork ?? null,
    last4: lastFour(info?.cardDetails),
  };
}

function appleResult(token: string, method: ApplePayPaymentMethod | null): BrowserWalletResult {
  return { type: 'APPLE_PAY', token, brand: method?.network ?? null, last4: lastFour(method?.displayName) };
}

/** Open Google's sheet — synchronously, inside the tap — and keep what it answers. */
function runGooglePay(
  client: GooglePaymentsClient,
  google: NonNullable<EvidenceWalletsConfig['googlePay']>,
  cents: number,
  record: (result: BrowserWalletResult) => void,
): void {
  let loading: Promise<GooglePaymentData>;
  try {
    loading = client.loadPaymentData(paymentDataRequest(google, { totalCents: cents }));
  } catch {
    record(failed('GOOGLE_PAY', 'TOKEN_ERROR'));
    return;
  }
  loading.then(
    (data) => record(googleResult(data)),
    (error: unknown) => record(failed('GOOGLE_PAY', sheetDismissed(error) ? 'DISMISSED' : 'TOKEN_ERROR')),
  );
}

/**
 * Start Apple's session — synchronously, inside the tap — and keep its token.
 * The order is raised later, at "generate", so the sheet is closed as soon as
 * it authorizes: Apple's sheet would otherwise time out waiting for it.
 */
function runApplePay(
  Session: ApplePaySessionClass,
  cents: number,
  input: { copy: HomologacaoEvidenceWalletsCopy; validate: (validationURL: string) => Promise<unknown> },
  record: (result: BrowserWalletResult) => void,
): void {
  const seen: { failure: BrowserWalletFailure | null; method: ApplePayPaymentMethod | null } = { failure: null, method: null };
  const { copy } = input;
  let sheet: ReturnType<typeof startApplePaySession>;
  try {
    sheet = startApplePaySession({
      Session,
      cents,
      copy: {
        orderTotal: copy.applePaySheetTotal,
        cannotStart: copy.applePayCannotStart,
        cannotComplete: copy.applePayCannotComplete,
        payAction: copy.applePayButton,
      },
      validateMerchant: (url) =>
        input.validate(url).catch((error: unknown) => {
          seen.failure = 'MERCHANT_VALIDATION_FAILED';
          throw error;
        }),
      onError: () => {
        seen.failure ??= 'TOKEN_ERROR';
      },
      onPaymentMethod: (method) => {
        seen.method = method;
      },
    });
  } catch {
    record(failed('APPLE_PAY', 'TOKEN_ERROR'));
    return;
  }
  void sheet.answer.then((key) => {
    if (key === null) return record(failed('APPLE_PAY', seen.failure ?? 'DISMISSED'));
    sheet.complete(true);
    record(appleResult(key, seen.method));
  });
}

/** Apple Pay, when this device can show the sheet, the host has an identity, and validates the merchant. */
function appleOffer(input: EvidenceWalletsInput): { Session: ApplePaySessionClass; validate: (url: string) => Promise<unknown> } | null {
  const validate = input.validateApplePayMerchant;
  if (!input.config?.applePay.configured || !validate || !applePaySupported()) return null;
  const Session = applePaySessionClass();
  return Session ? { Session, validate } : null;
}

/** Why a wallet with no press cannot run here — or undefined when it simply was not pressed. */
function notOffered(wallet: EvidenceWallet, input: EvidenceWalletsInput, googleReady: boolean): BrowserWalletResult | undefined {
  if (wallet === 'GOOGLE_PAY') return input.config?.googlePay && !googleReady ? failed(wallet, 'NOT_AVAILABLE') : undefined;
  if (!input.config?.applePay.configured) return failed(wallet, 'NOT_CONFIGURED');
  // An identity with no host validation: the sheet could never be validated.
  if (!input.validateApplePayMerchant) return failed(wallet, 'MERCHANT_VALIDATION_FAILED');
  return applePaySupported() ? undefined : failed(wallet, 'NOT_AVAILABLE');
}

/** Why Apple Pay has no button on a screen whose host carries wallets — null when it has one, or no wallets at all. */
function appleAbsence(input: EvidenceWalletsInput, offered: boolean): AppleAbsence | null {
  if (offered || !input.config) return null;
  const failure = notOffered('APPLE_PAY', input, false)?.failure;
  return failure === 'NOT_CONFIGURED' || failure === 'NOT_AVAILABLE' || failure === 'MERCHANT_VALIDATION_FAILED' ? failure : null;
}

/** The wallet step's state: the sheets' answers, the presses that open them, and what phase 2 gets. */
/** The server names the environment: TEST for the sandbox evidence, PRODUCTION for the production one (FUT-4198). */
function googleEnvironment(google: EvidenceWalletsConfig['googlePay'] | null): 'TEST' | 'PRODUCTION' {
  return google?.environment ?? 'TEST';
}

export function useEvidenceWallets(input: EvidenceWalletsInput) {
  const copy = usePlatformCopy().evidence.wallets;
  const [results, setResults] = useState<Results>({});
  const google = input.config?.googlePay ?? null;
  // `null` tells the client hook not to load pay.js at all.
  const client = useGooglePayClient(google ? input.googlePayApi : null, googleEnvironment(google));
  const apple = appleOffer(input);
  const cents = input.config?.amountCents ?? 0;
  const record = (result: BrowserWalletResult): void => setResults((previous) => ({ ...previous, [result.type]: result }));
  return {
    results,
    google: client && google ? { client, press: () => runGooglePay(client, google, cents, record) } : null,
    apple: apple ? { press: () => runApplePay(apple.Session, cents, { copy, validate: apple.validate }, record) } : null,
    /** Why Apple Pay has no button here, or null when it has one. */
    appleAbsent: appleAbsence(input, apple !== null),
    /** What phase 2 gets: each wallet's answer, or why it could not be offered here. */
    collect: (): BrowserWalletResult[] =>
      WALLETS.flatMap((wallet) => {
        const result = results[wallet] ?? notOffered(wallet, input, client !== null);
        return result ? [result] : [];
      }),
    /** A token pays once: a run that used them clears them. */
    reset: () => setResults({}),
  };
}

export type EvidenceWallets = ReturnType<typeof useEvidenceWallets>;

/** Google's own button (its brand rule), drawn by `createButton`; the press opens the sheet in the tap. */
function GooglePayMount({ client, onPress, locale }: { client: GooglePaymentsClient; onPress: () => void; locale: string }): ReactNode {
  const mount = useRef<HTMLDivElement | null>(null);
  const latest = useRef(onPress);
  latest.current = onPress;
  useEffect(() => {
    const element = mount.current;
    if (!element) return undefined;
    element.replaceChildren(client.createButton({ onClick: () => latest.current(), buttonSizeMode: 'fill', buttonLocale: locale }));
    return () => element.replaceChildren();
  }, [client, locale]);
  return <Box ref={mount} data-testid="evidence-google-pay" sx={{ minHeight: 40, width: { xs: '100%', sm: 240 }, '& > *': { width: '100%' } }} />;
}

/** Apple's button: Safari draws it (`-apple-pay-button`); elsewhere the name on a black pill. */
function ApplePayPress({ label, onPress }: { label: string; onPress: () => void }): ReactNode {
  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      onClick={onPress}
      data-testid="evidence-apple-pay"
      sx={{
        WebkitAppearance: '-apple-pay-button',
        height: 40,
        width: { xs: '100%', sm: 240 },
        border: 0,
        borderRadius: 1,
        cursor: 'pointer',
        bgcolor: 'common.black',
        color: 'common.white',
        '@supports (-webkit-appearance: -apple-pay-button)': { '& > span': { display: 'none' } },
      }}
    >
      <span aria-hidden>{label}</span>
    </Box>
  );
}

/** One wallet's line under the buttons: ready with its card, or that it answered no token. */
function WalletLine({ result, copy }: { result: BrowserWalletResult; copy: HomologacaoEvidenceWalletsCopy }): ReactNode {
  const name = copy.names[result.type];
  const card = [result.brand, result.last4 ? `•••• ${result.last4}` : null].filter(Boolean).join(' ');
  return (
    <Typography
      variant="body2"
      role="status"
      color={result.token ? 'text.primary' : 'error.main'}
      data-testid={`evidence-wallet-${result.token ? 'ready' : 'failed'}-${result.type}`}
    >
      {result.token ? copy.ready(name, card) : copy.failed(name)}
    </Typography>
  );
}

/** The wallet step: nothing at all when the host's seller view carries no wallets. */
export function EvidenceWalletBlock({ wallets }: { wallets: EvidenceWallets }): ReactNode {
  const copy = usePlatformCopy().evidence.wallets;
  if (!wallets.google && !wallets.apple && !wallets.appleAbsent) return null;
  const lines = WALLETS.flatMap((wallet) => {
    const result = wallets.results[wallet];
    return result ? [result] : [];
  });
  return (
    <Stack spacing={1} data-testid="evidence-wallets" sx={{ maxWidth: '72ch' }}>
      <Typography variant="body2" fontWeight={600}>
        {copy.heading}
      </Typography>
      {wallets.google || wallets.apple ? (
        <Typography variant="caption" component="p" color="text.secondary">
          {copy.hint}
        </Typography>
      ) : null}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        {wallets.google ? (
          <GooglePayMount client={wallets.google.client} onPress={wallets.google.press} locale={copy.googlePayButtonLocale} />
        ) : null}
        {wallets.apple ? <ApplePayPress label={copy.applePayButton} onPress={wallets.apple.press} /> : null}
      </Stack>
      {wallets.appleAbsent ? (
        <Typography variant="caption" component="p" color="text.secondary" data-testid="evidence-apple-pay-absent">
          {copy.applePayAbsent[wallets.appleAbsent]}
        </Typography>
      ) : null}
      {lines.map((result) => (
        <WalletLine key={result.type} result={result} copy={copy} />
      ))}
    </Stack>
  );
}
