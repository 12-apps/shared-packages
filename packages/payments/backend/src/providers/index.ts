/**
 * The adapters' COPY surface — their ports and the pt-BR packs — listed here
 * rather than in the package root because that file sits at the 400-line size
 * gate, the same reason `activation/index.ts` and `platform/index.ts` exist.
 * Paths are relative to this folder.
 *
 * Deliberately NOT the adapters themselves. The root re-exports this file, and
 * the frontend package's stories value-import the root, so anything here that
 * pulled in `providers/shared.ts` would drag `node:crypto` into a browser
 * bundle and break the Storybook build. `copy.ts` is types only and erases
 * before a bundler sees it; `pt-BR.ts` imports nothing but those types. Each
 * adapter keeps shipping from its own `./providers/<name>` subpath, which the
 * provider-catalog contract reserves for exactly that.
 */
export type {
  InfinitePayCopy,
  PagbankCopy,
  ProbeUnreachableCopy,
  ProviderCopyPacks,
  StoneCopy,
  StripeCopy,
  StripeCredentialCopy,
  StripeModeFacts,
} from './copy';
export {
  PT_BR_INFINITEPAY_COPY,
  PT_BR_PAGBANK_COPY,
  PT_BR_PROVIDER_COPY,
  PT_BR_STONE_COPY,
  PT_BR_STRIPE_COPY,
} from './pt-BR';
export {
  EN_US_INFINITEPAY_COPY,
  EN_US_PAGBANK_COPY,
  EN_US_PROVIDER_COPY,
  EN_US_STONE_COPY,
  EN_US_STRIPE_COPY,
} from './en-US';
