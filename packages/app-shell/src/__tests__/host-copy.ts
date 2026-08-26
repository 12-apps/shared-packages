import type { AppShellMessages } from '../react/messages';
import type { AppShellServerMessages } from '../server/config';

/**
 * THE SUITE'S OWN VOICE — deliberately not the extraction origin's.
 *
 * `messages` became required config (see `react/messages.ts`), so every test
 * that mounts the shell has to state its copy. It would be easy to paste the
 * table that used to be the default back in here, and that would quietly undo
 * the change: a suite asserting the origin's sentences passes just as happily
 * whether the host supplied them or a resurrected default did.
 *
 * So these sentences belong to a fictional host — a CYCLING CLUB's members
 * area. It is still pt-BR, because the rule being enforced is "copy is the
 * host's", not "copy is English": a package that swapped one product's
 * Portuguese for one product's English would have moved the problem, not fixed
 * it. But no shipped file could plausibly contain the word "pedalada", so if a
 * default ever returns, these strings stop appearing and the suites that read
 * them fail — which is the only way a consumer notices a default at all.
 */
export const CLUB_MESSAGES: AppShellMessages = {
  routeErrorTitle: 'Não foi possível abrir esta parte do clube',
  routeErrorRetry: 'Tentar de novo',
  consentTitle: 'Nosso regulamento mudou',
  consentBody:
    'Revisamos o regulamento do clube e a política de dados dos associados. Precisamos do seu aceite para liberar as inscrições nas pedaladas.',
  consentWhyTitle: 'Por que estamos pedindo agora',
  consentWhyBody:
    'Sua associação continua em dia. Só o aceite está na versão anterior — e é ele que trava a inscrição na próxima pedalada.',
  consentTermsLink: 'Ler o regulamento',
  consentPrivacyLink: 'Ler a política de dados',
  // Not the bare 'Li e aceito' the old default used: an assertion that reads
  // the same string either way proves nothing about who supplied it.
  consentAccept: 'Li e aceito o regulamento',
};

/** The same, for the server half's single failure body. */
export const CLUB_SERVER_MESSAGES: AppShellServerMessages = {
  recordFailed: 'Não foi possível registrar seu aceite. Tente de novo em instantes.',
};

/**
 * The SAME club, reading English — the other half of a pack.
 *
 * A resolver is only worth having if there are two things to resolve TO, so the
 * copy-resolver suite needs a second language rather than a second wording.
 * Same fictional host, so a default sneaking back is still the thing that
 * breaks these assertions.
 */
export const CLUB_MESSAGES_EN: AppShellMessages = {
  routeErrorTitle: 'This part of the club would not open',
  routeErrorRetry: 'Try again',
  consentTitle: 'Our club rules have changed',
  consentBody:
    'We have revised the club rules and the members data policy. We need you to accept the latest version before you can sign up for rides.',
  consentWhyTitle: 'Why you are seeing this now',
  consentWhyBody:
    'Your membership is fine. Only your acceptance is on the previous version — and that is what is blocking the next ride sign-up.',
  consentTermsLink: 'Read the club rules',
  consentPrivacyLink: 'Read the data policy',
  consentAccept: 'I have read and accept the rules',
};

/** Both languages, keyed by tag — what a host hands `localeCopy`. */
export const CLUB_MESSAGES_PACK = {
  'pt-BR': CLUB_MESSAGES,
  'en-US': CLUB_MESSAGES_EN,
} as const;

/**
 * What a bilingual host writes, spelled out rather than imported.
 *
 * This is `localeCopy` from `@12-apps/i18n`, which the package cannot depend on
 * — so the suite states the shape the mirror has to accept instead of asserting
 * against the real thing. An unrecognised tag lands on the default, exactly as
 * the real one does, because that is the behaviour the accessor is being handed.
 */
export function clubLocaleCopy<T>(pack: {
  readonly 'pt-BR': T;
  readonly 'en-US': T;
}): (context: { readonly locale?: string | null }) => T {
  return ({ locale }) => (locale === 'en-US' ? pack['en-US'] : pack['pt-BR']);
}
