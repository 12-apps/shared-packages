/**
 * The PLATFORM's paste-ready homologação answers (FUT-483, packaged by
 * FUT-573).
 *
 * PagBank clears a direct integrator for production charges through a
 * homologação form (Pipefy); until it does, live charges answer
 * `403 ACCESS_DENIED` even with valid credentials. The homologação is the
 * PLATFORM's, once — store owners are platform users and are exempt — so the
 * answers below describe the platform's own integration and point the
 * reviewer at a storefront the platform controls.
 *
 * The services list names BOTH `API de Pedidos e Pagamentos (Order)` and
 * `API Connect`: the integration calls `/orders` AND `/oauth2/*`, and a guide
 * naming only Order under-declares what was integrated.
 *
 * Everything deployment-specific arrives as {@link PlatformHomologacaoGuideFacts}
 * — only the host knows its public origin, its brand and which store a
 * reviewer may visit — so this module stays host-agnostic and the answers
 * stay computable in one place.
 */

/** Everything a host must say about itself for the answers to be true. */
export interface PlatformHomologacaoGuideFacts {
  /** The name the products answer introduces the platform by. */
  brandName: string;
  /** The deployment's public origin, e.g. `https://app.example.com`. */
  siteUrl: string;
  /** The reviewer-visitable storefront (a store the platform controls). */
  demoStoreUrl: string;
}

/** Everything the platform screen renders as paste-ready form answers. */
export interface HomologacaoGuide {
  /** The official homologação form. */
  formUrl: string;
  /**
   * SIP — Suporte Integração PagBank. The parallel channel for the
   * `403 ACCESS_DENIED` question; whichever answers first settles whether the
   * form covers Connect.
   */
  supportFormUrl: string;
  docsUrl: string;
  /** PagBank's official request/response example the anexo mirrors. */
  exampleUrl: string;
  integrationType: string;
  /** BOTH services — Order and Connect — see the module header. */
  services: string[];
  /** "Instruções de acesso" (the form caps at 255 chars — keep it under). */
  accessInstructions: string;
  siteUrl: string;
  demoStoreUrl: string;
  productsDescription: string;
  slaText: string;
}

/**
 * The "instruções de acesso" answer. The form field caps at 255 characters —
 * this wording was validated against that limit with a real store URL; don't
 * lengthen it without re-checking (the guide test pins the budget).
 */
function accessInstructionsText(demoStoreUrl: string): string {
  return (
    `Acesse ${demoStoreUrl}. Clique em Entrar e faça login com uma conta Google. ` +
    'Adicione produtos ao carrinho e finalize o pedido escolhendo PIX (QR Code na tela) ou cartão de crédito.'
  );
}

/** The platform's answers, built from the deployment's real URLs. */
export function platformHomologacaoGuide(facts: PlatformHomologacaoGuideFacts): HomologacaoGuide {
  return {
    formUrl: 'https://app.pipefy.com/public/form/2e56YZLK',
    supportFormUrl: 'https://app.pipefy.com/public/form/sBlh9Nq6',
    docsUrl: 'https://developer.pagbank.com.br/docs/solicitar-homologacao',
    exampleUrl:
      'https://dev.pagbank.uol.com.br/reference/criar-pagar-pedido-com-cartao#crie-e-pague-o-pedido',
    integrationType: 'Desenvolvimento próprio',
    services: ['API de Pedidos e Pagamentos (Order)', 'API Connect'],
    accessInstructions: accessInstructionsText(facts.demoStoreUrl),
    siteUrl: facts.siteUrl,
    demoStoreUrl: facts.demoStoreUrl,
    productsDescription:
      `Plataforma ${facts.brandName} de cardápio digital e pedidos online (multi-loja): ` +
      'itens de restaurantes e lanchonetes vendidos pelas lojas da plataforma, ' +
      'com pagamento via PIX e cartão de crédito.',
    slaText:
      'Prazo (SLA): até 4 dias úteis quando os registros são enviados corretamente; ' +
      'estendido caso contrário.',
  };
}
