/**
 * Every string the shell renders, in one overridable table.
 *
 * pt-BR by default, because that is the product these screens were extracted
 * from and product copy is never "translated" while tidying code. A host in
 * another language passes a partial override; a host in this one passes nothing.
 *
 * The consent copy is deliberately SPECIFIC rather than reassuring-and-vague. The
 * whole failure it replaces was a user being stopped without being told why, and
 * a generic "não foi possível continuar" here would just move the dead end.
 */
export interface AppShellMessages {
  /** Route error boundary. */
  routeErrorTitle: string;
  routeErrorRetry: string;
  /** The consent gate. */
  consentTitle: string;
  consentBody: string;
  consentWhyTitle: string;
  consentWhyBody: string;
  consentTermsLink: string;
  consentPrivacyLink: string;
  consentAccept: string;
}

export const DEFAULT_MESSAGES: AppShellMessages = {
  routeErrorTitle: 'Não foi possível abrir esta página',
  routeErrorRetry: 'Recarregar',
  consentTitle: 'Atualizamos nossos termos',
  consentBody:
    'Precisamos do seu aceite na versão mais recente dos Termos de Uso e da Política de Privacidade para continuar.',
  consentWhyTitle: 'Por que isso apareceu agora',
  consentWhyBody:
    'Sua conta segue ativa. Só o aceite está desatualizado — e é ele que bloqueia finalizar uma compra.',
  consentTermsLink: 'Ler os Termos de Uso',
  consentPrivacyLink: 'Ler a Política de Privacidade',
  consentAccept: 'Li e aceito',
};

export function messagesOf(override?: Partial<AppShellMessages>): AppShellMessages {
  return { ...DEFAULT_MESSAGES, ...override };
}
