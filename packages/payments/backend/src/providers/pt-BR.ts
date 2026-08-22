import type {
  InfinitePayCopy,
  PagbankCopy,
  ProviderCopyPacks,
  StoneCopy,
  StripeCopy,
  StripeModeFacts,
} from './copy';

/**
 * The pt-BR packs for the four built-in adapters — NAMED constants a host
 * passes by hand, never a default.
 *
 * The filename is what exempts this file from the copy-portability gate:
 * Portuguese may ship, it may not be silent. Every sentence below is VERBATIM
 * what the adapter used to produce, so a host adopting these sees no change on
 * screen — what changes is that the words are now chosen in a diff.
 */

/** How this pack names the two Stripe modes mid-sentence. */
const MODE_WORD = (live: boolean): string => (live ? 'produção (live)' : 'teste (test)');

/**
 * What to call the credential that authenticates the charge.
 *
 * A grant and a pasted key are the same thing to Stripe and two different
 * nouns to an owner — and in Portuguese they take different genders, which is
 * why the whole sentence is composed here rather than around a fragment.
 */
const SOURCE = (viaGrant: boolean): string => (viaGrant ? 'A autorização' : 'A chave secreta');

export const PT_BR_STRIPE_COPY: StripeCopy = {
  unreachable:
    'Não conseguimos falar com a Stripe agora. ' +
    'Suas credenciais foram salvas — teste a conexão de novo em instantes.',
  fields: {
    connectedAccountHelp:
      'Deixe em branco. Só preencha se você é uma plataforma Connect cobrando em nome de outra conta — com as suas próprias chaves, este campo faz a Stripe recusar a conexão.',
  },
  refused: (detail) =>
    detail ? `Credenciais recusadas pela Stripe: ${detail}` : 'Credenciais recusadas pela Stripe.',
  checks: {
    chargesDisabled: (viaGrant, accountId) =>
      `${SOURCE(viaGrant)} funciona${accountId ? ` (conta ${accountId})` : ''}, mas a Stripe ainda ` +
      'não liberou cobranças nesta conta. Conclua o cadastro da empresa no painel da Stripe — ' +
      'enquanto isso, toda cobrança será recusada.',
    secretKeyModeMismatch: (viaGrant, mode: StripeModeFacts) =>
      `${SOURCE(viaGrant)} é de ${MODE_WORD(mode.key)}, mas esta conexão está configurada como ` +
      `${MODE_WORD(mode.connection)}. Use a chave do ambiente correspondente.`,
    secretKeyResolved: (viaGrant, accountId) =>
      `${SOURCE(viaGrant)} responde pela conta ${accountId}.`,
    secretKeyAccepted: (viaGrant) => `${SOURCE(viaGrant)} foi aceita pela Stripe.`,
    publishableKeyMissing:
      'Sem a chave publicável o navegador não consegue tokenizar cartões, então o checkout ' +
      'com cartão não funciona nesta loja.',
    publishableKeyShape: 'Isto não parece uma chave publicável — ela começa com `pk_`.',
    publishableKeyModeMismatch: (mode) =>
      `A chave publicável é de ${MODE_WORD(mode.key)} e esta conexão é ${MODE_WORD(mode.connection)}. ` +
      'O cartão do comprador seria recusado sem explicação.',
    publishableKeyOk: (live) =>
      `Chave publicável de ${MODE_WORD(live)}, coerente com o ambiente desta conexão.`,
    webhookSecretViaGrant:
      'Contas conectadas por autorização usam o endpoint da plataforma — nada a cadastrar.',
    webhookSecretMissing:
      'Sem o segredo de assinatura, as confirmações de pagamento da Stripe serão recusadas.',
    webhookSecretShape: 'Isto não parece um segredo de assinatura — ele começa com `whsec_`.',
    webhookSecretShapeOnly:
      'O formato está certo. A Stripe não oferece como conferir se o segredo é o correto — ' +
      'isso só aparece na primeira notificação recebida.',
    connectedAccountMismatch: (resolved, declared) =>
      `A chave informada responde pela conta ${resolved}, e não por ${declared}. ` +
      'Uma das duas está errada — e é ela que decide para qual conta o dinheiro vai.',
    connectedAccountOk: (declared) => `Confere com a conta que a chave resolve (${declared}).`,
    severalFailed: (count, firstMessage) =>
      `${count} credenciais precisam de atenção. ${firstMessage}`,
  },
};

export const PT_BR_STONE_COPY: StoneCopy = {
  unreachable:
    'Não conseguimos falar com a Stone/Pagar.me agora. ' +
    'Suas credenciais foram salvas — teste a conexão de novo em instantes.',
  secretKeyMissing: 'Chave secreta não configurada.',
  refused: 'Chave recusada pela Stone/Pagar.me.',
  fields: {
    secretKey: 'Chave secreta (sk_...)',
    publicKey: 'Chave pública (pk_...)',
    webhookUser: 'Usuário do webhook',
    webhookPassword: 'Senha do webhook',
  },
  payer: { boletoInstructions: 'Pagar até o vencimento', statementDescriptor: 'PEDIDO' },
};

export const PT_BR_PAGBANK_COPY: PagbankCopy = {
  unreachable:
    'Não conseguimos falar com o PagBank agora. ' +
    'Suas credenciais foram salvas — teste a conexão de novo em instantes.',
  tokenMissing: 'Token não configurado.',
  refused: 'Token recusado pelo PagBank.',
  fields: {
    token: 'Token do PagBank',
    publicKey: 'Chave pública (cartão)',
    webhookToken: 'Token de webhook',
    googlePayMerchantId: 'Google Pay: ID do lojista (gatewayMerchantId)',
  },
};

export const PT_BR_INFINITEPAY_COPY: InfinitePayCopy = {
  unreachable:
    'Não conseguimos falar com a InfinitePay agora. Sua tag foi salva — teste a conexão de novo em instantes.',
  handleMissing: 'Handle não configurado.',
  tagNotFound:
    'Não encontramos essa InfiniteTag na InfinitePay. Confira a tag no app e tente de novo.',
  refused: 'Handle recusado pela InfinitePay.',
  noCheckoutUrl: 'InfinitePay não retornou a URL do checkout.',
  handleHelp:
    'Confira caractere por caractere. Mostramos a tag em fonte monoespaçada para você distinguir 0 de O e l de 1.',
  fields: { handle: 'InfiniteTag ($usuario)' },
};

/**
 * All four packs together, for a host that wants today's wording everywhere —
 * and the shape `allProviderAdapters` takes.
 *
 * Still one line in the host's diff, and still nothing this package reaches
 * for on its own.
 */
export const PT_BR_PROVIDER_COPY: ProviderCopyPacks = {
  pagbank: PT_BR_PAGBANK_COPY,
  stone: PT_BR_STONE_COPY,
  infinitepay: PT_BR_INFINITEPAY_COPY,
  stripe: PT_BR_STRIPE_COPY,
};
