import type { ConnectApplicationCopy } from './connect-application';

/**
 * The pt-BR pack for the platform-operations surface — a NAMED constant a host
 * passes by hand, never a default.
 *
 * The filename is what exempts this file from the copy-portability gate:
 * Portuguese may ship, it may not be silent.
 *
 * `missingAccountToken` is the one sentence here a host should NOT adopt
 * verbatim. It names a configuration surface — "informe o campo accountToken
 * nas credenciais da aplicação" — and where that field lives is a fact about
 * the deployment, not about PagBank. This reproduces what the package used to
 * default to, which is right for a host storing credentials in a row and wrong
 * for one setting env vars.
 */
export const PT_BR_CONNECT_APPLICATION_COPY: ConnectApplicationCopy = {
  missingAccountToken:
    'Token da conta PagBank ausente — informe o campo accountToken nas credenciais ' +
    'da aplicação deste ambiente para consultar a aplicação.',
  consultFailed: (status, detail) =>
    `O PagBank respondeu ${status} ao consultar a aplicação${detail === '' ? '' : ` — ${detail}`}`,
  unexpectedShape: 'O PagBank respondeu em um formato inesperado ao consultar a aplicação.',
  unreachable: 'Não foi possível falar com o PagBank para consultar a aplicação. Tente novamente.',
};

/**
 * The pt-BR homologação answers this package used to write for the host.
 *
 * A SAMPLE rather than a default, and the distinction matters more here than
 * anywhere else in the repo: these are declarations a PagBank reviewer reads
 * and the platform is accountable for. Adopting them unchanged is a claim
 * about your own business — the wording below says the platform sells menu
 * items for restaurants and snack bars — so read them before passing them.
 *
 * They reproduce, verbatim, what `platformHomologacaoGuide` and
 * `buildPlatformHomologacaoAnexo` used to produce, which is what makes them
 * the right answers for the deployment they were written for and only that
 * one.
 */
export const PT_BR_HOMOLOGACAO_ANSWERS = {
  /**
   * PagBank caps this field at `ACCESS_INSTRUCTIONS_MAX` (255) characters, and
   * a realistically long store URL still has to fit — this wording was
   * measured against that. Lengthen it and re-check.
   */
  accessInstructions: (demoStoreUrl: string): string =>
    `Acesse ${demoStoreUrl}. Clique em Entrar e faça login com uma conta Google. ` +
    'Adicione produtos ao carrinho e finalize o pedido escolhendo PIX (QR Code na tela) ou cartão de crédito.',
  productsDescription: (brandName: string): string =>
    `Plataforma ${brandName} de cardápio digital e pedidos online (multi-loja): ` +
    'itens de restaurantes e lanchonetes vendidos pelas lojas da plataforma, ' +
    'com pagamento via PIX e cartão de crédito.',
  slaText:
    'Prazo (SLA): até 4 dias úteis quando os registros são enviados corretamente; ' +
    'estendido caso contrário.',
  /** The anexo's "Fluxo da integração" paragraph. */
  integrationSummary: (facts: { demoStoreUrl: string; webhookUrl: string }): string =>
    [
      'Fluxo da integração: a plataforma opera lojas multi-tenant; o checkout da',
      `loja de demonstração (${facts.demoStoreUrl}) cria o pedido`,
      'com QR Code PIX (1); o cliente paga pelo app do banco; o PagBank envia webhook para',
      facts.webhookUrl,
      'e a confirmação é validada consultando o pedido (2) antes de marcar como pago.',
      'A chave pública (3) alimenta a criptografia de cartão no navegador.',
      'Via API Connect (/oauth2/*), cada lojista autoriza a aplicação da plataforma',
      'na própria conta PagBank (authorization_code + refresh), com os tokens',
      'resultantes usados nas mesmas APIs de Pedidos acima.',
    ].join('\n'),
};
