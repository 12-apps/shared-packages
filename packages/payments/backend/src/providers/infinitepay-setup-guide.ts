import type { ProviderSetupGuide, SetupGuideContext, SetupProgress } from '../core/types';

/**
 * InfinitePay's onboarding walkthrough.
 *
 * Connecting is literally one field, so the guide spends its words on the two
 * things the store cannot see.
 *
 * The first is that the handle decides WHERE the money lands, so a typo pays a
 * stranger. The second is newer and was actively misleading: this guide used to
 * carry a "Cadastrar webhook" stage telling the owner to send their
 * notification URL to `parcerias@cloudwalk.io` or register it "no cadastro da
 * sua integração". Neither exists. InfinitePay takes `webhook_url` in the
 * `POST /links` payload — which `linkPayload` already fills in on every single
 * charge — so the owner's task was to do nothing, and the guide sent them to
 * email a partnerships address about it.
 *
 * In its place is the step that WAS missing: Checkout Integrado ships disabled,
 * and until it is switched on in the app no link can be created at all, however
 * valid the InfiniteTag is.
 *
 * Sources: ajuda.infinitepay.io "Como usar o Checkout Integrado da InfinitePay"
 * and infinitepay.io/checkout-documentacao.
 *
 * The walkthrough shows ONE section: the step this store actually owes.
 *
 * Printing all three at once made the owner locate themselves in the guide on
 * every visit, and the task still outstanding looked identical to the two
 * already done. The order follows what blocks what — the InfiniteTag comes
 * first because nothing can be tested without it, Checkout Integrado second
 * because a valid tag still creates no links while it is off, activation last.
 *
 * With no `progress` from the host the whole guide is returned, unchanged: a
 * caller that cannot say what is done must not be shown a guide that has
 * decided for them.
 */
export function infinitePaySetupGuide(ctx: SetupGuideContext): ProviderSetupGuide {
  const stages = [
    { id: 'handle', label: 'Informar InfiniteTag' },
    { id: 'enable', label: 'Habilitar o Checkout' },
    { id: 'activate', label: 'Ativar vendas' },
  ];

  const sections = [handleSection(ctx), enableSection(ctx)];
  if (!ctx.progress) return { stages, sections };
  return { stages, sections, activeStage: activeStageOf(ctx.progress) };
}

/**
 * Which numbered step the stepper should sit on — the same three facts that
 * choose the section, so the two can never disagree. `stages.length` once the
 * charge has landed: nothing is left to do.
 *
 * A HOST may know one more fact than this — whether the owner has confirmed
 * Checkout Integrado is on, which no API can be asked — and is expected to
 * override downward with it. This value is what the server can prove.
 */
function activeStageOf(progress: SetupProgress): number {
  if (!progress.connected) return 0;
  return progress.proven ? 3 : 2;
}

/**
 * Only ever reached once the probe has passed, so it can always be finished
 * from here. Before that there is nothing to confirm: the owner may well have
 * enabled Checkout Integrado, but on an account the handle does not reach, and
 * letting them tick it off would carry a wrong tag into a real payment.
 */
function enableSection(ctx: SetupGuideContext): ProviderSetupGuide['sections'][number] {
  return {
    id: 'enable',
    title: 'Passo 2 · Habilite o Checkout Integrado',
    doneSummary: { label: 'Checkout Integrado', value: 'Habilitado na conta InfinitePay' },
    intro:
      'Em contas InfinitePay o Checkout Integrado vem **desligado**. Sem ele nenhum link de pagamento é criado — mesmo com a InfiniteTag certa.',
    steps: [
      {
        text: 'No app InfinitePay: **Vendas › Checkout › Configurações › Habilitar Checkout Integrado**.',
        button: {
          label: 'Abrir as configurações do checkout',
          url: 'https://app.infinitepay.io/external-checkout#configuracoes',
        },
      },
      {
        // Reference only, never a task — presenting it as one is what sent
        // owners hunting for a registration screen that does not exist, and
        // folding it away is the same correction in layout form.
        copy: {
          label: 'URL de notificação (você não precisa cadastrar)',
          text: ctx.webhookUrl,
          collapsible: true,
        },
      },
      { action: 'checkout-integrado-confirmado' },
    ],
  };
}

/**
 * The warnings come FIRST, above the button, and that ordering is the point.
 *
 * They used to be steps 2 and 3, under a button labelled "Ver a minha
 * InfiniteTag" that opens InfinitePay's CHANGE screen. So the owner read
 * "click here", clicked, and met the two sentences explaining what clicking
 * had just exposed them to only on the way back. A warning below the action it
 * warns about is a post-mortem.
 */
function handleSection(ctx: SetupGuideContext): ProviderSetupGuide['sections'][number] {
  return {
    id: 'handle',
    title: 'Passo 1 · Informe sua InfiniteTag',
    intro:
      'A InfinitePay identifica sua conta pela InfiniteTag — o mesmo @ que aparece no topo do app. Não há chave de API para copiar.',
    steps: [
      {
        // InfinitePay's own warning on that page, repeated because the button
        // below lands on a CHANGE screen: an owner one field away from breaking
        // every link they have already sent out deserves to read this before
        // going there rather than discover it after.
        tone: 'warning',
        text: 'A página da InfinitePay também permite **alterar** a tag — não altere. Mudar a InfiniteTag quebra suas cobranças, sua Loja Online e os links de pagamento já enviados, que precisam ser reemitidos.',
      },
      {
        tone: 'warning',
        text: `A InfiniteTag define para **qual conta** o dinheiro vai. Uma tag errada envia os pagamentos desta loja para outra pessoa, e não há como reverter pelo ${ctx.brandName} — confira caractere por caractere.`,
      },
      {
        // No prose: the button says what it does, and the field under it says
        // what to bring back.
        //
        // `painel.infinitepay.io` does not resolve — a store owner sent to it
        // lands on nothing at the exact moment they are being asked for the one
        // field that decides where their money goes. This page states the
        // current tag outright, which is what the step needs.
        button: {
          label: 'Ver a minha InfiniteTag',
          url: 'https://app.infinitepay.io/settings/change/infinite-tag',
        },
      },
    ],
  };
}
