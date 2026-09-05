/**
 * `@12-apps/payments-frontend` — the browser half of the payments platform.
 *
 * Plug-and-play MUI components for the two payment surfaces (per-provider
 * settings page, checkout payment step), plus the headless hooks and fetch
 * clients they are built on for hosts that want their own pixels. Imports
 * only TYPES from `@12-apps/payments-backend`; talks exclusively to the host's
 * mounted payments HTTP surface.
 */
export {
  createPaymentsClient,
  createPaymentsSettingsClient,
  isSettled,
  PaymentsClientError,
  type ClientChargeRequest,
  type ClientPaymentsConfig,
  type PaymentsClient,
  type PaymentsClientOptions,
  type PaymentsSettingsClient,
} from './client';

export {
  PaymentsProvider,
  useChargeStatus,
  useCreateCharge,
  usePaymentsClient,
  type ChargeRef,
  type ChargeStatusOptions,
  type ChargeStatusState,
  type CreateChargeState,
  type PaymentsProviderProps,
} from './context';

export {
  CheckoutPayment,
  type CardFormValues,
  type CheckoutPaymentProps,
  type SavedCardOption,
} from './components/CheckoutPayment';
// The words that step renders — required on the prop above, so a host wiring
// the legacy surface has to answer them (FUT-760).
export type {
  CheckoutPaymentCopy,
  LegacyCardCopy,
  LegacyMethodCopy,
  LegacyMoneyCopy,
  LegacyPixCopy,
  LegacyRefusalCopy,
} from './components/checkout-payment-copy';
export { PT_BR_CHECKOUT_PAYMENT_COPY } from './components/checkout-payment-pt-BR';

// ---------------------------------------------------------------------------
// The buyer checkout surface (FUT-564) — the storefront's three-step flow,
// mounted by a host in one line. See ADOPTING.md §3 for the ports and the
// design-system slot contract.
// ---------------------------------------------------------------------------
export {
  CheckoutFlow,
  type CheckoutCartView,
  type CheckoutFlowProps,
} from './components/checkout/checkout-flow';

// ---------------------------------------------------------------------------
// The MOUNTED buyer checkout (FUT-741) and the checkout PIPELINE (FUT-1240).
//
// Listed in `./flows/public` rather than inline, on the `./activation/public`
// precedent below: this barrel is at its size gate, and a surface that grows
// with every plugin type belongs beside the plugins.
// ---------------------------------------------------------------------------
export * from './flows/public';

export {
  buyerFieldsFor,
  fieldSatisfied,
} from './components/checkout/buyer-fields';
export {
  createCheckoutClient,
  DEFAULT_CHECKOUT_BASE_URL,
  type BuyerVaultSession,
  type CheckoutClient,
  type CheckoutTransport,
  type CheckoutTransportBinding,
  type CompleteVaultInput,
  type VaultedCardDisplay,
} from './components/checkout/transport';
export { type CheckoutHostPorts } from './components/checkout/use-checkout-controller';
// No `PaymentsUnavailable` here. The store-cannot-charge screen ships once, as
// `createPaymentFlows().screens.PaymentsUnavailable`, which asks the host for a
// `CheckoutAvailability.remedy` — `{ label, onSelect }`, filled with whatever
// that host's remedy actually is. The component this line used to export was a
// second copy of the same screen with the origin host's dining room in its API.
export type {
  CheckoutStepperCopy,
  CheckoutViewCopy,
  DadosStepCopy,
  EmptyCartCopy,
  PaymentStatusCopy,
  StatusOutcomeCopy,
} from './components/checkout/view-copy';
export {
  PT_BR_CHECKOUT_COPY,
  PT_BR_CHECKOUT_VIEW_COPY,
  PT_BR_PAYMENT_STATUS_COPY,
} from './components/checkout/pt-BR';
// The provider the card fields and buyer inputs read their words from — a host
// mounting a screen BELOW `CheckoutFlow` (or composing by hand) opens it
// itself; `CheckoutFlow` and `FlowsShell` already do (FUT-760).
export {
  CheckoutCopyProvider,
  useCheckoutCopy,
  type BuyerInfoCopy,
  type CheckoutCopy,
} from './components/checkout/copy-context';
// The screens BELOW the steps — the method tiles, the PIX and card panes, the
// wallet buttons, the hosted handover and the transport's own three sentences.
// Every slice is named on the barrel, not just the whole: a host writing its
// pack section by section types the section it is writing (FUT-760).
export type {
  CardPaneCopy,
  CheckoutScreensCopy,
  CheckoutTransportCopy,
  CheckoutValidationCopy,
  HostedHandoverCopy,
  MethodPickerCopy,
  PayerSummaryCopy,
  PaymentErrorCopy,
  PixPaneCopy,
  SettlingCopy,
  WalletCopy,
} from './components/checkout/screens-copy';
export { PT_BR_CHECKOUT_SCREENS_COPY } from './components/checkout/screens-pt-BR';
export { fetchCheckoutConfig } from './components/checkout/client';
/**
 * The `sessionStorage` key the hosted-checkout return leg parks the raised
 * order under. Public because it is already observable — a spec asserting the
 * handover, or a host clearing storage on sign-out, otherwise retypes the
 * literal and silently drifts when it changes.
 */
export { HOSTED_ORDER_STORAGE_KEY } from './components/checkout/hosted-return';
/**
 * Whether a hand-off from this tab is still waiting to be resolved.
 *
 * For a HOST GATE in front of the checkout route — a closed-shop curtain, a
 * plan check. Every such gate has to stand aside for a buyer coming back from
 * a payment, because that route is where the money gets confirmed, and a host
 * deciding it alone had to copy this package's marker list and storage key.
 * That copy goes stale: it did, the moment Stripe's 3-D Secure markers were
 * added here. Reads without consuming.
 */
export { hostedCheckoutReturnPending } from './components/checkout/hosted-return';
// ---------------------------------------------------------------------------
// Digital wallets (FUT-471/472) — the Google-branded button and the capability
// read it is gated on. `CheckoutFlow` wires these automatically; they are
// exported for hosts composing their own pixels.
// ---------------------------------------------------------------------------
export {
  GooglePayButton,
  type GooglePayApi,
  type GooglePayButtonProps,
  type GooglePaymentData,
  type GooglePaymentsClient,
  type GooglePayGatewayParams,
} from './components/checkout/google-pay-button';
export {
  ApplePayButton,
  applePaySupported,
  APPLE_PAY_SUPPORTED_NETWORKS,
  type ApplePayButtonProps,
  type ApplePayPaymentRequest,
  type ApplePaySessionClass,
  type ApplePaySessionLike,
} from './components/checkout/apple-pay-button';
export { applePayDeclared, googlePayConfig } from './components/checkout/method-capability';
export {
  CheckoutComponentsProvider,
  type CheckoutActionBarProps,
  type CheckoutAlertProps,
  type CheckoutButtonProps,
  type CheckoutCheckboxProps,
  type CheckoutComponents,
  type CheckoutInputProps,
  type CheckoutLoadingStateProps,
  type CheckoutRadioGroupProps,
  type CheckoutRadioOption,
  type CheckoutStepperProps,
  type CheckoutStepperStep,
  type CheckoutTextProps,
} from './components/checkout/ui';
/**
 * WHICH basket a checkout is for (FUT-1213).
 *
 * A host computes the signature from its own cart lines and hands it to the
 * flow on `cart.identity`, so a payment raised from an ABANDONED basket cannot
 * resume itself over the one the shopper is holding now. Exported because the
 * host owns the cart and therefore has to build it — see `basket.ts` for why
 * the identity is the lines and never the cart's id.
 */
export {
  basketSignature,
  type CheckoutBasketIdentity,
  type CheckoutBasketLine,
} from './components/checkout/basket';
/**
 * WHY a card was refused, and whether another attempt could work (FUT-1145).
 * A host wiring the confirmation screen's per-reason copy names these.
 */
export type {
  CheckoutDecline,
  CheckoutDeclineReason,
} from './components/checkout/decline';
export {
  type BuyerContact,
  type BuyerField,
  type BuyerInfo,
  type ChargeWalletInput,
  type CheckoutChainLink,
  type CheckoutCustomerField,
  type CheckoutError,
  type CheckoutOrder,
  type CheckoutProviderConfig,
  type CheckoutWalletType,
  type SettlementCheckout,
  type CreateOrderRequest,
  type CreateOrderResult,
  type OrderStatus,
  type PaymentMethod,
} from './components/checkout/types';

// The shared card-entry surface (form + tokenizer), used by the checkout above
// and by the admin's provider-activation charge (FUT-463) — same fields, same
// validation, same tokenization, or the activation proves nothing.
export {
  CardPayBar,
  NewCardForm,
  SavedCardsPicker,
  cvvLength,
  detectBrand,
  formatCardNumber,
  formatCpf,
  formatCvv,
  formatExpiry,
  onlyDigits,
  tokenizeCard,
  tokenizeForCheckout,
  tokenizerFor,
  validateCardNumber,
  validateCpf,
  validateCvv,
  validateExpiry,
  validateHolder,
  NEW_CARD,
  PT_BR_CARD_COPY,
  type CardBrand,
  type CardCopy,
  type CardFieldCopy,
  type CardTokenizeCopy,
  type CardDetails,
  type CardFieldErrors,
  type CardToken,
  type CardTokenizationConfig,
  type CardTokenizer,
  type SavedCard,
} from './card';
// The settings surface's words. `PaymentProviderSettings` takes the pack as a
// required prop and mounts the provider; the provider is exported for a host
// that composes the pieces itself (FUT-760).
export {
  PaymentsSettingsCopyProvider,
  usePaymentsSettingsCopy,
} from './components/settings-copy-context';
export { PT_BR_PAYMENTS_SETTINGS_COPY } from './components/settings-pt-BR';
export type {
  ConnectionBadgeCopy,
  ConnectionCardCopy,
  ConnectionStatusCopy,
  CredentialFormCopy,
  EnvironmentCopy,
  OAuthConnectionCopy,
  PaymentsSettingsCopy,
  ProviderPriorityCopy,
  SetupGuideCopy,
} from './components/settings-copy';
export {
  ProviderConnection,
  type ProviderConnectionProps,
} from './components/ProviderConnection';
export {
  ProviderPriorityList,
  type ProviderPriorityListProps,
} from './components/ProviderPriorityList';
export {
  ProviderSetupGuide,
  type ProviderSetupGuideProps,
} from './components/ProviderSetupGuide';
export {
  CHECKOUT_CONFIRM_ACTION,
  SetupGuideSection,
  type SetupGuideSectionProps,
} from './components/SetupGuideSection';
export { ProviderStatusBar, statusBadge } from './components/ProviderStatusBar';
// The START of the connect round trip (FUT-763): the `prepareConnect` a host
// hands to the settings screen, built from its own prepare route. The route is
// the host's; the exchange — method, shape, and what counts as a failure — is
// this package's, and a hand-written one casts the answer instead of checking
// it.
export {
  createConnectPreparer,
  type ConnectPreparerOptions,
} from './components/connect-preparer';
export {
  PaymentProviderSettings,
  type PaymentProviderSettingsProps,
} from './components/PaymentProviderSettings';
export { createWebPaymentsSettings } from './flows/create-payments-settings';
export type { BoundPaymentsSettingsProps, PaymentsSettingsSurface, PaymentsSettingsWebConfig } from './flows/create-payments-settings';

// ---------------------------------------------------------------------------
// The PLATFORM operations screens (FUT-479 / FUT-483, packaged by FUT-573) —
// the Connect-application consult and the homologação, as dumb components a
// host page mounts with data + callbacks from its own routes. Their backend
// halves are `consultConnectApplications`, `platformHomologacaoGuide`,
// `createHomologationRecordService` and `buildPlatformHomologacaoAnexo`.
// ---------------------------------------------------------------------------
export {
  ConnectApplicationPanel,
  type ConnectApplicationPanelProps,
} from './components/platform/ConnectApplicationPanel';
export { PlatformHomologacao, type PlatformHomologacaoProps } from './components/platform/PlatformHomologacao';
export {
  type HomologacaoSaveInput,
  type HomologacaoSaveState,
  type PlatformHomologationRecordView,
} from './components/platform/HomologacaoOutcomeCard';
// Both mounts require `copy`, so the contract and its pt-BR pack are part of
// the port — a required port a host cannot import is not one.
export type * from './components/platform/copy';
export { PT_BR_PLATFORM_HOMOLOGACAO_COPY } from './components/platform/pt-BR';

/**
 * Re-exported because it appears in the `prepareConnect` prop a host must
 * implement: without it the host could not type its own callback without
 * taking a direct dependency on the backend package.
 */
export type { PaymentEnvironment } from '@12-apps/payments-backend';

// ---------------------------------------------------------------------------
// The ACTIVATION STEP (FUT-463, FUT-763, FUT-764) — proving a connection can
// actually charge, both protocols and the screens that render them.
//
// A connection is not a capability: a completed grant says the owner authorized
// us, not that the account can take money. The owner's own card — or a real
// link they pay on the provider's page — goes through the SAME path a shopper's
// does, for a small amount, refunded or landing in their own account.
//
// Every branch in there was learned from a payment that went wrong: an owner
// who paid four times, a dead end blaming a store for a key that was never
// going to exist, a refusal wearing another failure's clothes. The SENTENCES
// stay the host's, required and defaultless, as everywhere here.
//
// Listed in `./activation/public` — see its header for why it is not inline.
// ---------------------------------------------------------------------------
export * from './activation/public';

// ---------------------------------------------------------------------------
// The two payment LEDGERS (FUT-764) — every charge raised against every order,
// and the subset where the provider captured LESS than the order was worth.
//
// UI-free on purpose. There is no component in that folder: a ledger is a
// table, every host already has one, and a grid slot wide enough to satisfy
// them all would be a worse contract than handing over rows. What moves is
// what a host was deriving twice and getting subtly wrong both times — which
// amount is "captured" when the audit diff and the payment row disagree, why a
// decision is shown INSTEAD of the order status, and what still counts as work.
// ---------------------------------------------------------------------------
export * from './ledger';

// ---------------------------------------------------------------------------
// The connect ROUND TRIP's other end (FUT-763): what the OAuth callback
// redirected back with, taken out of the address bar once. The codes are a
// union so a host's copy map is exhaustiveness-checked; the sentences stay the
// host's, as everywhere else in this package.
// ---------------------------------------------------------------------------
export {
  takeConnectReturn,
  useConnectReturn,
  type ConnectErrorCode,
  type ConnectReturn,
} from './components/connect-return';
