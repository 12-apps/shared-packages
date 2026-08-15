import type { AppShellMessages } from '@12-apps/app-shell/react';

/**
 * THIS HOST'S OWN SENTENCES.
 *
 * `messages` is required on `createWebAppShell` now. It used to be optional over
 * a pt-BR table the package shipped — the extraction origin's copy, spread UNDER
 * whatever a host passed, so a host that stated four of the nine silently
 * inherited another product's wording for the other five.
 *
 * This harness said nothing at all, and so rendered that table start to finish
 * while claiming to be an independent consumer. That is exactly how the default
 * stayed invisible: its only reader was the one place that would never notice.
 *
 * So the words here are deliberately NOT the origin's. The harness is a demo
 * hardware shop: it says "loja" and "conta", and its consent copy is about
 * ordering parts, not about anything the origin sells. If the package ever
 * reintroduces a default these sentences stop appearing and the specs that read
 * them fail — which is the only way a consumer can notice a default coming back.
 *
 * Every field is spelled out rather than spread over a base: the type is the
 * checklist, and a partial object would compile only because some other host's
 * table filled the gaps, which is the arrangement being removed.
 */
export const HARNESS_SHELL_MESSAGES: AppShellMessages = {
  routeErrorTitle: 'Não foi possível abrir esta página',
  routeErrorRetry: 'Recarregar',
  consentTitle: 'Atualizamos as condições da loja',
  consentBody:
    'Revisamos as condições de uso e a política de privacidade da loja. Precisamos do seu aceite na versão mais recente para liberar novos pedidos.',
  consentWhyTitle: 'Por que isso apareceu agora',
  consentWhyBody:
    'Sua conta continua ativa. Só o aceite está na versão anterior — e é ele que impede fechar um pedido.',
  consentTermsLink: 'Ler as condições de uso',
  consentPrivacyLink: 'Ler a política de privacidade',
  consentAccept: 'Li e aceito as condições',
};
