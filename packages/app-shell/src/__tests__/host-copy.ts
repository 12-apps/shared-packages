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
