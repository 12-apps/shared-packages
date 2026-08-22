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
 *
 * ## Three answers had to join them (FUT-760)
 *
 * `productsDescription` said, in this package, that the platform sells
 * "itens de restaurantes e lanchonetes" — so any other adopter would have
 * submitted a homologação declaring somebody else's business to PagBank.
 * `accessInstructions` walked the reviewer through THIS product's Google
 * sign-in and cart, and `slaText` is the deployment's own promise. All three
 * are now required facts.
 *
 * What stays here is PagBank's OWN vocabulary — `integrationType` and the two
 * `services` values are options on their Pipefy form, and a "translated" one
 * is a rejected submission. Portuguese, permanently, and correctly.
 */

/** Everything a host must say about itself for the answers to be true. */
export interface PlatformHomologacaoGuideFacts {
  /** The name the products answer introduces the platform by. */
  brandName: string;
  /** The deployment's public origin, e.g. `https://app.example.com`. */
  siteUrl: string;
  /** The reviewer-visitable storefront (a store the platform controls). */
  demoStoreUrl: string;
  /**
   * How the reviewer gets from that storefront to a paid order — the form's
   * "Instruções de acesso".
   *
   * The host's, because it describes the host's own sign-in and checkout: the
   * text this package used to build named a Google login and a PIX QR code on
   * screen, which is a walkthrough of ONE product.
   *
   * The 255-character cap is PagBank's and stays enforced here — see
   * {@link ACCESS_INSTRUCTIONS_MAX}. The words are yours; the budget is not.
   */
  accessInstructions: string;
  /**
   * What the platform sells, for the form's products question.
   *
   * The answer that made this module un-adoptable: it described a digital menu
   * of restaurant items, and a host in any other trade would have submitted it
   * unchanged. `brandName` is yours to interpolate.
   */
  productsDescription: string;
  /**
   * The review turnaround the platform states.
   *
   * PagBank publishes no single number and the wording is a commitment, so it
   * is the host that makes it.
   */
  slaText: string;
}

/**
 * PagBank's own limit on the "Instruções de acesso" field.
 *
 * Exported because a host writing that answer needs the number, and finding it
 * by having a submission truncated is the expensive way.
 */
export const ACCESS_INSTRUCTIONS_MAX = 255;

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
  /** "Instruções de acesso" — capped at {@link ACCESS_INSTRUCTIONS_MAX}. */
  accessInstructions: string;
  siteUrl: string;
  demoStoreUrl: string;
  productsDescription: string;
  slaText: string;
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
    accessInstructions: facts.accessInstructions,
    siteUrl: facts.siteUrl,
    demoStoreUrl: facts.demoStoreUrl,
    productsDescription: facts.productsDescription,
    slaText: facts.slaText,
  };
}
