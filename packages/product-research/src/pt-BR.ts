import type { ResearchHttpMessages } from './http';
import type { ResearchBudgetCopy } from './notifications';

/**
 * The pt-BR packs — the origin host's words, shipped as a NAMED PACK (the
 * copy-portability doctrine): a host imports a pack and passes it BY HAND,
 * so choosing Portuguese is a line in the host's diff rather than a silent
 * default. Nothing in this package reads these itself.
 */

/** Every sentence the HTTP surface can answer with — pass to `messages`. */
export const PT_BR_RESEARCH_MESSAGES: ResearchHttpMessages = {
  credentialRefused: (reason) => `Credencial recusada pelo provedor: ${reason}`,
  sourceUrlRejected: (violation) => `URL da fonte rejeitada: ${violation}`,
  keylessSource: 'Esta fonte de preços não usa chave de aplicação.',
  incompleteCredentialFields: (fields) => `Informe todos os campos da chave: ${fields.join(', ')}.`,
  invalidQuote: 'Cotação inválida.',
};

/** The budget alert's phrasing and CTA — pass to `createResearchBudgetBlueprint`. */
export const PT_BR_RESEARCH_BUDGET_COPY: ResearchBudgetCopy = {
  title: (payload) =>
    payload.scope === 'TENANT_DAY'
      ? 'Cota diária de busca paga esgotada'
      : 'Orçamento mensal de busca paga esgotado',
  body: (payload) => {
    const tail =
      'As pesquisas continuam funcionando com as fontes gratuitas; ' +
      'a busca paga volta automaticamente no próximo período.';
    return payload.scope === 'TENANT_DAY'
      ? `A loja atingiu a cota diária de ${payload.capUnits} busca(s) paga(s) ` +
          `(${payload.sourceType}) em ${payload.period}. ${tail}`
      : `A plataforma atingiu o orçamento mensal de ${payload.capUnits} busca(s) paga(s) ` +
          `(${payload.sourceType}) em ${payload.period}. ${tail}`;
  },
  link: (payload) => `/admin/${payload.tenantSlug}/research`,
};

/**
 * The label segments this package's permission ids read in, for a pt-BR
 * host's role editor — compose beside `PRODUCT_RESEARCH_PERMISSIONS`, whose
 * own declaration deliberately carries no words.
 */
export const PT_BR_RESEARCH_PERMISSION_LABELS = {
  domains: { research: 'Pesquisa de preços' },
  actions: { read: 'Ver', write: 'Editar' },
} as const;
