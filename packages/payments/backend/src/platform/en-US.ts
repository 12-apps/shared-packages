import type { ConnectApplicationCopy } from './connect-application';

/**
 * The en-US pack for the platform-operations surface — a NAMED constant a host
 * passes by hand, never a default.
 *
 * `missingAccountToken` is the one sentence here a host should NOT adopt
 * verbatim, in either language. It names a configuration surface — "the
 * `accountToken` field in this environment's application credentials" — and
 * where that field lives is a fact about the DEPLOYMENT, not about PagBank.
 * This reproduces what the package used to default to, which is right for a
 * host storing credentials in a row and wrong for one setting env vars.
 *
 * ## There is deliberately no English homologação pack
 *
 * `pt-BR.ts` also exports `PT_BR_HOMOLOGACAO_ANSWERS`, and this file has no
 * twin for it. That is not an omission — it is the same call
 * `.copy-portability-exceptions.json` already records as PERMANENT for
 * `homologacao-anexo.ts` and `homologacao-guide.ts`.
 *
 * Those answers are a SUBMISSION: they are typed into PagBank's own Pipefy
 * form and read by a PagBank reviewer, in Portuguese. Several of the fields are
 * multiple-choice options on that form, and an option translated into English
 * is a rejected submission. `accessInstructions` is capped by PagBank at 255
 * characters with a real store URL inside it, so its length was measured
 * against the Portuguese wording and would have to be measured again for any
 * other. Shipping an English "translation" here would produce a pack that looks
 * adoptable and cannot be submitted.
 *
 * A host filing that homologação writes its own answers about its own business
 * — which is what the pt-BR pack's own docstring already says, since those
 * sentences claim the platform sells menu items for restaurants and snack bars.
 */
export const EN_US_CONNECT_APPLICATION_COPY: ConnectApplicationCopy = {
  missingAccountToken:
    'PagBank account token missing — set the `accountToken` field in this ' +
    "environment's application credentials to look the application up.",
  consultFailed: (status, detail) =>
    `PagBank answered ${status} when looking the application up${detail === '' ? '' : ` — ${detail}`}`,
  unexpectedShape: 'PagBank answered in an unexpected format when looking the application up.',
  unreachable: 'Could not reach PagBank to look the application up. Try again.',
};
