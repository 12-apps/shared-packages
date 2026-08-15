import type { ProviderSetupGuide, SetupGuideContext, SetupProgress } from '../core/types';

/**
 * Stripe's onboarding walkthrough.
 *
 * Shorter than Stone's on purpose: an OAuth store does not copy a single key.
 * What remains is what authorization cannot do for them — enabling the
 * Brazilian payment methods on their own account, knowing where deliveries
 * land, and the charge that switches the store on.
 *
 * ## N stages, N-1 sections — the last one empty
 *
 * The final stage carries NO section, and that is load-bearing rather than an
 * omission: the host's activation card takes that slot, and the renderer only
 * gives it up once the guide has run out of sections (`SetupGuideSection`:
 * *"it is the last stage, so it may only appear once the guide is out of
 * sections"*).
 *
 * This guide used to pair four stages with four sections, and the deadlock was
 * total (FUT-799). `openSection` was never null, so the activation card never
 * rendered; `activeStageOf` returned 0, 2 or `stages.length` — never 3 — so a
 * connected store was pinned on `webhook`, and only `proven` could move it. But
 * `proven` is stamped BY the activation charge, which lives on the stage the
 * pairing hid. No store that connected Stripe could ever be enabled.
 *
 * That pairing came from FUT-691, which cured the opposite bug — a `webhook`
 * section no stage pointed at — by giving every stage a section. The two are
 * one mistake read from either end, and the invariant test in
 * `__tests__/providers.test.ts` now pins both directions at once, for every
 * guide rather than for this one.
 *
 * ## Why `methods` and `webhook` became one stage
 *
 * Both happen on Stripe's own screens and no API this adapter calls can tell
 * them apart, so no fact could ever have advanced the walkthrough from one to
 * the other. With `activeStageOf` sending a connected store straight to
 * `webhook`, the `methods` section (index 1) was unreachable from every state
 * too. One `dashboard` stage is what the store actually does: one visit, two
 * settings.
 *
 * It ends in the owner's own confirmation — the framework's one mechanism for
 * passing a step the server cannot observe — which is also what keeps the
 * notification URL reachable AFTER connecting, as the collapsed "Revisar" row.
 */
export function stripeSetupGuide(ctx: SetupGuideContext): ProviderSetupGuide {
  const stages = [
    { id: 'connect', label: 'Conectar conta' },
    { id: 'dashboard', label: 'Configurar na Stripe' },
    { id: 'activate', label: 'Ativar vendas' },
  ];
  const sections = [connectSection(), dashboardSection(ctx, 'oauth')];
  // Same three stages, same confirmable section at index 1 — the mirror
  // `credentialsPath` requires. Only step 1 and the webhook wording change,
  // because only those depend on how the store connected.
  const credentialsPath = {
    stages: [
      { id: 'connect', label: 'Informar as chaves' },
      { id: 'dashboard', label: 'Configurar na Stripe' },
      { id: 'activate', label: 'Ativar vendas' },
    ],
    sections: [credentialsSection(ctx), dashboardSection(ctx, 'credentials')],
  };
  // With no `progress` from the host the whole guide is returned, unchanged: a
  // caller that cannot say what is done must not be shown a guide that has
  // decided for them (same contract as InfinitePay's).
  if (!ctx.progress) return { stages, sections, credentialsPath };
  const activeStage = activeStageOf(ctx.progress, stages.length);
  return { stages, sections, activeStage, credentialsPath: { ...credentialsPath, activeStage } };
}

/**
 * Which numbered step the stepper sits on, from the two facts the server can
 * prove: the authorization reached an account (`connected`), and a real charge
 * landed (`proven`).
 *
 * A connected store is sent to the LAST stage — the sectionless one, where the
 * activation card lives. The renderer walks it back to `dashboard` by itself
 * until the owner confirms (`effectiveStage` clamps to the confirmable stage),
 * which is exactly how InfinitePay's guide is driven. Reporting the confirmable
 * stage from here instead is what made the last stage unreachable: that clamp
 * can only hold a walkthrough BACK, never carry it forward.
 */
function activeStageOf(progress: SetupProgress, stageCount: number): number {
  if (!progress.connected) return 0;
  return progress.proven ? stageCount : stageCount - 1;
}

function connectSection(): ProviderSetupGuide['sections'][number] {
  return {
    id: 'connect',
    title: 'Passo 1 · Conectar sua conta Stripe',
    intro:
      'A conexão é feita por autorização no site da Stripe — você não precisa copiar nenhuma chave, e pode revogar o acesso quando quiser, pelo painel da Stripe ou pelo botão “Desconectar” aqui. Prefere usar as suas próprias chaves? Abra “Prefiro informar as credenciais manualmente” abaixo: o passo a passo muda para esse caminho.',
    steps: [
      {
        text: 'Clique em “Conectar com Stripe” acima. Você será levado ao site da Stripe para entrar na sua conta e autorizar o acesso. Se ainda não tiver conta, dá para criar uma durante o processo.',
        link: {
          label: 'Sobre o Stripe Connect',
          url: 'https://stripe.com/docs/connect',
        },
      },
      {
        text: 'Ao autorizar, você volta automaticamente para esta página e a conexão aparece como “Conectado”.',
      },
    ],
  };
}

/**
 * Step 1 for a store using its OWN Stripe keys.
 *
 * The OAuth section cannot stand in for this one: it points at "Conectar com
 * Stripe", a button that is not rendered while the credential form is open,
 * and it opens by saying no key needs copying — to an owner looking at four
 * boxes for keys.
 *
 * Where each value comes from is the whole content, because that is the part
 * Stripe's own dashboard makes hard: the signing secret does not exist until
 * an endpoint is created, and it is shown once.
 */
function credentialsSection(ctx: SetupGuideContext): ProviderSetupGuide['sections'][number] {
  return {
    id: 'connect',
    title: 'Passo 1 · Informar as suas chaves da Stripe',
    intro:
      'Você está conectando com as **suas próprias chaves**. Elas ficam guardadas nesta loja, e o ambiente escolhido acima (Sandbox ou Produção) decide de qual conta da Stripe elas têm de vir — as chaves de teste não funcionam em produção.',
    steps: [
      {
        text: 'No painel da Stripe, abra “Desenvolvedores › Chaves de API” e copie a **Secret key** (`sk_...`) e a **Publishable key** (`pk_...`).',
        button: {
          label: 'Abrir chaves de API',
          url: 'https://dashboard.stripe.com/apikeys',
        },
      },
      {
        text: 'Em “Desenvolvedores › Webhooks”, crie um endpoint apontando para a URL de notificação desta loja e copie o **Signing secret** (`whsec_...`) que a Stripe mostra ao criá-lo. Sem ele, um pagamento aprovado não é confirmado aqui.',
        copy: { label: 'URL de notificação', text: ctx.webhookUrl, collapsible: true },
      },
      {
        text: 'Cole as chaves no formulário abaixo e clique em “Salvar e testar conexão”. Elas são enviadas à Stripe na hora, e o resultado de cada uma aparece logo em seguida.',
      },
    ],
  };
}

/**
 * The one visit to Stripe's dashboard, and the step the owner closes by hand.
 *
 * The notification URL is named in the step's own TEXT, not only in the copy
 * button's label: `CopyRow` renders `copy.label` as that button's aria-label
 * and nowhere else, so a step whose sentence never mentions the URL captions it
 * to screen readers alone.
 *
 * The webhook step is the one sentence that cannot serve both paths. Under
 * authorization the endpoint is registered for the store and the URL is there
 * to be checked; with its own keys the store must create it, and saying "ela já
 * vem configurada" to that owner describes work nobody has done.
 */
function dashboardSection(
  ctx: SetupGuideContext,
  path: 'oauth' | 'credentials',
): ProviderSetupGuide['sections'][number] {
  return {
    id: 'dashboard',
    title: 'Passo 2 · Configurar sua conta na Stripe',
    doneSummary: { label: 'Conta Stripe', value: 'Configurada por você' },
    intro:
      'A Stripe só processa PIX e boleto se esses meios estiverem habilitados na **sua própria** conta — a autorização não liga isso por você.',
    steps: [
      {
        text: 'No painel da Stripe, abra “Configurações › Métodos de pagamento” e ative PIX e Boleto para a sua conta brasileira.',
        button: {
          label: 'Abrir métodos de pagamento',
          url: 'https://dashboard.stripe.com/settings/payment_methods',
        },
      },
      {
        // The step 3 charge dies without this, and Stripe's refusal names a
        // dashboard toggle rather than anything the owner did here: "This
        // integration surface is unsupported for publishable key tokenization."
        // Newer accounts ship it OFF, so a store can pass every credential
        // check, reach the activation charge, and be stopped by a setting no
        // step ever mentioned — on the one screen whose job is to list the
        // settings only the owner can change.
        text: 'Abra “Configurações › Integração” e ative a tokenização de cartão com chave publicável. Contas novas vêm com isso desligado, e sem ele a Stripe recusa a cobrança de teste do Passo 3 com “integration surface is unsupported”.',
        button: {
          label: 'Abrir configurações de integração',
          url: 'https://dashboard.stripe.com/settings/integration',
        },
      },
      {
        text: 'Confirme que sua conta está habilitada para receber pagamentos — a Stripe pede documentos da empresa antes de liberar repasses.',
        button: {
          label: 'Abrir o painel da Stripe',
          url: 'https://dashboard.stripe.com',
        },
      },
      {
        text:
          path === 'oauth'
            ? 'A URL de notificação desta loja é a de baixo. Conectando por autorização ela já vem configurada — copie-a apenas se preferir cadastrar um endpoint próprio em “Desenvolvedores › Webhooks”.'
            : 'Confira que o endpoint criado em “Desenvolvedores › Webhooks” aponta para a URL de notificação desta loja, abaixo. Com as suas próprias chaves, este cadastro é seu — sem ele a Stripe não avisa esta loja quando um pagamento é aprovado.',
        copy: { label: 'URL de notificação', text: ctx.webhookUrl, collapsible: true },
      },
      { action: 'checkout-integrado-confirmado' },
    ],
    confirmLabel: 'Já configurei minha conta na Stripe',
  };
}
