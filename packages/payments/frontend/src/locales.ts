import type { ActivationStepCopy } from './activation/screens/copy';
import { EN_US_ACTIVATION_STEP_COPY } from './activation/screens/copy-en-US';
import { PT_BR_ACTIVATION_STEP_COPY } from './activation/screens/copy-pt-BR';
import type { CardCopy } from './card/copy';
import { EN_US_CARD_COPY, PT_BR_CARD_COPY } from './card';
import type { CheckoutPaymentCopy } from './components/checkout-payment-copy';
import { EN_US_CHECKOUT_PAYMENT_COPY } from './components/checkout-payment-en-US';
import { PT_BR_CHECKOUT_PAYMENT_COPY } from './components/checkout-payment-pt-BR';
import type { CheckoutCopy } from './components/checkout/copy-context';
import {
  EN_US_CHECKOUT_COPY,
  EN_US_CHECKOUT_VIEW_COPY,
  EN_US_PAYMENT_STATUS_COPY,
} from './components/checkout/en-US';
import {
  PT_BR_CHECKOUT_COPY,
  PT_BR_CHECKOUT_VIEW_COPY,
  PT_BR_PAYMENT_STATUS_COPY,
} from './components/checkout/pt-BR';
import { EN_US_CHECKOUT_SCREENS_COPY } from './components/checkout/screens-en-US';
import type { CheckoutScreensCopy } from './components/checkout/screens-copy';
import { PT_BR_CHECKOUT_SCREENS_COPY } from './components/checkout/screens-pt-BR';
import type { CheckoutViewCopy, PaymentStatusCopy } from './components/checkout/view-copy';
import type { PlatformHomologacaoCopy } from './components/platform/copy';
import { EN_US_PLATFORM_HOMOLOGACAO_COPY } from './components/platform/en-US';
import { PT_BR_PLATFORM_HOMOLOGACAO_COPY } from './components/platform/pt-BR';
import { EN_US_PAYMENTS_SETTINGS_COPY } from './components/settings-en-US';
import type { PaymentsSettingsCopy } from './components/settings-copy';
import { PT_BR_PAYMENTS_SETTINGS_COPY } from './components/settings-pt-BR';

/**
 * Every surface this half renders, in both languages, keyed by tag.
 *
 * The two AUDIENCES here are worth keeping apart when a host wires them: the
 * checkout packs are read by a SHOPPER mid-purchase and the settings and
 * homologação packs by the store's OPERATOR. A store whose owner reads English
 * and whose buyers read Portuguese is the ordinary case, not an edge one, so
 * these resolve from different preferences rather than one.
 *
 * `LocalePack` is declared here rather than imported, and in this package that
 * is not merely a preference: `payments/no-host-imports` forbids
 * `packages/payments/**` from importing a sibling workspace package at all.
 */
type LocalePack<T> = { readonly 'pt-BR': T; readonly 'en-US': T };

/**
 * Step 3's words (FUT-764). `createActivationStep` still REQUIRES its copy and
 * reads nothing from here — a host that wants these names them, which is the
 * distinction between a pack and a default. They arrived from the first
 * adopting host, where they had outlived the screen they belonged to.
 */
export const ACTIVATION_STEP_COPY = {
  'pt-BR': PT_BR_ACTIVATION_STEP_COPY,
  'en-US': EN_US_ACTIVATION_STEP_COPY,
} as const satisfies LocalePack<ActivationStepCopy>;

export const CARD_COPY = {
  'pt-BR': PT_BR_CARD_COPY,
  'en-US': EN_US_CARD_COPY,
} as const satisfies LocalePack<CardCopy>;

export const CHECKOUT_SCREENS_COPY = {
  'pt-BR': PT_BR_CHECKOUT_SCREENS_COPY,
  'en-US': EN_US_CHECKOUT_SCREENS_COPY,
} as const satisfies LocalePack<CheckoutScreensCopy>;

export const CHECKOUT_COPY = {
  'pt-BR': PT_BR_CHECKOUT_COPY,
  'en-US': EN_US_CHECKOUT_COPY,
} as const satisfies LocalePack<CheckoutCopy>;

export const CHECKOUT_VIEW_COPY = {
  'pt-BR': PT_BR_CHECKOUT_VIEW_COPY,
  'en-US': EN_US_CHECKOUT_VIEW_COPY,
} as const satisfies LocalePack<CheckoutViewCopy>;

export const PAYMENT_STATUS_COPY = {
  'pt-BR': PT_BR_PAYMENT_STATUS_COPY,
  'en-US': EN_US_PAYMENT_STATUS_COPY,
} as const satisfies LocalePack<PaymentStatusCopy>;

export const CHECKOUT_PAYMENT_COPY = {
  'pt-BR': PT_BR_CHECKOUT_PAYMENT_COPY,
  'en-US': EN_US_CHECKOUT_PAYMENT_COPY,
} as const satisfies LocalePack<CheckoutPaymentCopy>;

export const PAYMENTS_SETTINGS_COPY = {
  'pt-BR': PT_BR_PAYMENTS_SETTINGS_COPY,
  'en-US': EN_US_PAYMENTS_SETTINGS_COPY,
} as const satisfies LocalePack<PaymentsSettingsCopy>;

export const PLATFORM_HOMOLOGACAO_COPY = {
  'pt-BR': PT_BR_PLATFORM_HOMOLOGACAO_COPY,
  'en-US': EN_US_PLATFORM_HOMOLOGACAO_COPY,
} as const satisfies LocalePack<PlatformHomologacaoCopy>;

/**
 * The en-US packs are published from HERE rather than from the root barrel,
 * which is at its 400-line budget. That is a happier arrangement than it
 * sounds: `@12-apps/payments-frontend/locales` is now the one subpath that
 * holds everything about language — the per-locale packs and the records that
 * key them — while the root keeps exporting the pt-BR names it always has, so
 * no existing import moves.
 */
export { EN_US_ACTIVATION_STEP_COPY } from './activation/screens/copy-en-US';
export { EN_US_CARD_COPY } from './card';
export { EN_US_CHECKOUT_PAYMENT_COPY } from './components/checkout-payment-en-US';
export {
  EN_US_CHECKOUT_COPY,
  EN_US_CHECKOUT_VIEW_COPY,
  EN_US_PAYMENT_STATUS_COPY,
} from './components/checkout/en-US';
export { EN_US_CHECKOUT_SCREENS_COPY } from './components/checkout/screens-en-US';
export { EN_US_PAYMENTS_SETTINGS_COPY } from './components/settings-en-US';
export { EN_US_PLATFORM_HOMOLOGACAO_COPY } from './components/platform/en-US';
