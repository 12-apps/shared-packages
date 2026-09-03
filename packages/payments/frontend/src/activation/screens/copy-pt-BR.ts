import { PT_BR_CARD_COPY } from '../../card';

import type { ActivationStepCopy } from './copy';

/**
 * Everything step 3 says, in Portuguese (FUT-764).
 *
 * A pack, not a default. Nothing in this package reads it: `createActivationStep`
 * still REQUIRES its copy, and a host that wants these words names them. That
 * distinction is the one `copy.ts` and `settings-copy.ts` argue for — a default
 * in the origin host's language reads as finished to the next host right up
 * until an owner sees it — and it is why the eight packs already on
 * `../../locales` are not a breach of it either.
 *
 * These sentences are here because they are the ACTIVATION STEP's vocabulary
 * and not one product's voice: "a cobrança de teste é o que libera as vendas",
 * "autenticado, mas não ativado", "última verificação há Ns". Every adopter
 * would write them again, word for word, because they describe outcomes this
 * package decides. They came from the first adopting host, where they had been
 * maintained beside a screen that no longer lives there.
 *
 * ## What does NOT get translated, in either half
 *
 * **Checkout Integrado** is the exact label on PagBank's own console; an owner
 * sent looking for "Integrated Checkout" is looking for a screen that does not
 * exist. **CPF** and its `000.000.000-00` mask are a Brazilian document and a
 * FORMAT — a translated mask shows a shape the field refuses. **PagBank** and
 * **InfinitePay** are names — PagBank now only as the console label above, since
 * the tax-id hint takes the provider as an ARGUMENT rather than naming one
 * (FUT-675). `{provider}` is this package's own placeholder, substituted after
 * the sentence is chosen.
 */
export const PT_BR_ACTIVATION_STEP_COPY: ActivationStepCopy = {
  intro: {
    title: 'Passo 3 · Ative as vendas',
    cardBody: (amountLabel) =>
      `Faça uma cobrança de teste${amountLabel ? ` de ${amountLabel}` : ''} no seu próprio ` +
      'cartão. Ela é estornada automaticamente e é o que comprova que sua loja consegue ' +
      'receber de verdade.',
    realCharge: (amountLabel) =>
      `Geramos uma cobrança real de ${amountLabel} na sua própria conta. Pagar por ela é o que ` +
      'comprova que sua loja consegue receber de verdade.',
    payingYourself: (amountLabel) =>
      `Você paga para si mesmo: os ${amountLabel} saem do seu meio de pagamento e caem na conta ` +
      'que recebe as vendas desta loja. Não há estorno porque o valor não sai do seu controle.',
  },
  actions: {
    chargeAndActivate: (amountLabel) => `Cobrar${amountLabel ? ` ${amountLabel}` : ''} e ativar`,
    payAndActivate: (amountLabel) => `Pagar ${amountLabel} e ativar`,
    testAgain: 'Testar novamente',
    retry: 'Tentar novamente',
    tryAgain: 'Tentar de novo',
    restart: 'Já habilitei — recomeçar o Passo 3',
    generateNewCharge: 'Gerar nova cobrança',
    checkNow: 'Conferir agora',
    alreadyPaidCheckNow: 'Já paguei — conferir agora',
    setProviderOrder: 'Definir a ordem entre provedores',
    seePublishedStore: 'Ver a loja publicada',
  },
  awaiting: {
    receivedTitle: 'Pagamento recebido — confirmando',
    receivedBody:
      'Estamos confirmando seu pagamento com o provedor. Isso costuma levar poucos segundos.',
    declinedTitle: 'O pagamento foi recusado',
    waitingTitle: 'Aguardando o pagamento…',
    waitingBody: (amountLabel) =>
      `Geramos a cobrança de ${amountLabel} e abrimos a página do provedor em outra aba. ` +
      'Pague por lá e volte aqui: conferimos sozinhos assim que o pagamento cair.',
    lastChecked: (seconds) => `Última verificação há ${seconds}s`,
    openPaymentPage: 'Abrir a página de pagamento',
    copyLink: 'Copiar link',
    linkCopied: 'Link copiado',
    showLink: 'Ver o link',
    hideLink: 'Esconder o link',
  },
  outcome: {
    approvedTitle: 'Cobrança de teste aprovada',
    refundedBody: (amountLabel) =>
      `Sua loja já consegue receber pagamentos. O ${amountLabel} foi estornado automaticamente.`,
    refundPendingBody: (amountLabel) =>
      `Sua loja já consegue receber pagamentos. O estorno do ${amountLabel} não foi concluído — ` +
      'ele aparecerá na sua fatura.',
    someAmount: 'valor',
    authenticatedNotActive: 'Autenticado, mas não ativado',
    refusedTitle: (displayName) => `A ${displayName} recusou criar a cobrança`,
    refusedBody: (displayName) =>
      `A ${displayName} recusou criar a cobrança. Isso quase sempre significa que o ` +
      'Checkout Integrado ainda está desligado na sua conta. Nada foi cobrado — ' +
      'reabrimos o Passo 2 acima: habilite lá e volte aqui.',
    unreachableTitle: 'Não conseguimos falar com o provedor',
    expiredTitle: 'A cobrança expirou',
    settledTitle: 'Cobrança de teste confirmada',
    settledBody: (amountLabel) =>
      `Sua loja já consegue receber pagamentos. O ${amountLabel} fica na sua conta — ` +
      'estornos da InfinitePay são feitos no app dela.',
    provenTitle: 'Cobrança de teste confirmada',
    provenBody:
      'Sua loja provou que consegue receber por este provedor. Ligamos as vendas ' +
      'automaticamente — você pode pausar pelo botão no topo quando quiser. Nenhuma nova ' +
      'cobrança é necessária.',
    providerSaid: 'Resposta do provedor:',
    blockedTitle: 'Falta confirmar o Passo 2',
    blockedBody:
      'Confirme acima que o Checkout Integrado está habilitado na sua conta. Sem ele o ' +
      'provedor não cria nenhum link de pagamento, e esta cobrança falharia.',
  },
  taxId: {
    label: 'CPF do titular',
    // No article, deliberately (FUT-675). This field renders from the CARD
    // flow only — pagbank, stone, stripe — and no single article fits all
    // three: "a Stone" and "a Stripe" are natural where PagBank is
    // conventionally "o PagBank", so the previous round's "A ${displayName}
    // exige" bought Stone's grammar with PagBank's. `por` takes no
    // contraction, so one string is correct for every name.
    //
    // The refusal sentences above still take an article ("A ${displayName}
    // recusou") and are NOT covered by that argument — they belong to the
    // redirect flow, which today renders for InfinitePay alone because
    // `card/tokenize.ts` has a tokenizer for exactly the three names above and
    // everything else FALLS BACK to redirect. That is a default, not a rule, so
    // the second redirect provider ever added inherits this same bug — along
    // with `settledBody`, which takes no `displayName` at all and so tells any
    // such provider's owner that refunds happen in InfinitePay's app.
    hint: (displayName) => `Exigido por ${displayName} em qualquer cobrança no cartão.`,
    placeholder: '000.000.000-00',
  },
  charge: {
    card: PT_BR_CARD_COPY,
    noTokenizer:
      'Ainda não há tokenização de cartão implementada para {provider}, ' +
      'então a cobrança de verificação não pode ser feita por aqui.',
    chargeFailed: 'Não foi possível concluir a cobrança de teste.',
    unreachable: 'Não foi possível conectar. Verifique sua conexão e tente novamente.',
  },
  redirect: {
    chargeExpired: 'A cobrança expirou.',
    confirmFailed: 'Não foi possível confirmar a cobrança de teste.',
    createFailed: 'Não foi possível gerar a cobrança de teste.',
    confirmTimedOut:
      'Não conseguimos confirmar o pagamento a tempo. Se você já pagou, a cobrança continua ' +
      'válida — recarregue a página para conferir de novo.',
  },
};
