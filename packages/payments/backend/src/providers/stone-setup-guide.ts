import type { ProviderSetupGuide, SetupGuideContext, SetupProgress } from '../core/types';

/**
 * Stone's onboarding walkthrough.
 *
 * Longer than Stripe's because Stone has no authorization flow: the store
 * really does have to generate a key pair and register a webhook by hand. The
 * dashboard is Pagar.me's — Stone's payments technology — which surprises
 * store owners, so the copy says so up front.
 *
 * ## The last stage is empty, and the guide has to REACH it
 *
 * Two omissions here deadlocked activation exactly as Stripe's pairing did
 * (FUT-800, found by the invariant test written with FUT-799).
 *
 * An `activate` SECTION meant `openSection` was never null, so the host's
 * activation card — the only control that raises the charge stamping
 * `chargeVerifiedAt` — could not render. And the guide returned no
 * `activeStage` at all, ignoring `ctx.progress` and answering with a static
 * object, so `effectiveStage` fell back to `guide.activeStage ?? 0` and, with
 * no confirmable section to clamp to, pinned the stepper on step 1 forever. A
 * store that had generated its keys and registered its webhook still read as
 * not having started. Stone declares `activationCharge`, so `proofMissing`
 * refused to enable it — and the control that would have satisfied that refusal
 * was the one the section pairing hid.
 *
 * So: the closing copy moves into the webhook section, `activate` becomes
 * sectionless, and the webhook step ends in the owner's own confirmation —
 * registering a URL in someone else's dashboard is precisely the kind of fact
 * no API here can report.
 */
export function stoneSetupGuide(ctx: SetupGuideContext): ProviderSetupGuide {
  const guide: ProviderSetupGuide = {
    stages: [
      { id: 'keys', label: 'Gerar chaves' },
      { id: 'webhook', label: 'Cadastrar webhook' },
      { id: 'activate', label: 'Ativar vendas' },
    ],
    sections: [
      {
        id: 'keys',
        title: 'Gerar suas chaves de API',
        intro:
          'A Stone processa pagamentos online pela plataforma Pagar.me (tecnologia da própria Stone) — por isso as chaves são geradas no painel do Pagar.me, com a mesma conta Stone.',
        steps: [
          {
            text: 'Abra o painel e vá em “Configurações › Chaves”. Copie a chave pública (pk_...) e gere a chave secreta (sk_...).',
            button: { label: 'Abrir o painel', url: 'https://dash.pagar.me' },
          },
          {
            text: 'Cole as duas chaves no formulário acima. Use as chaves de teste enquanto estiver no ambiente Sandbox e as de produção só depois de validar.',
            link: {
              label: 'Documentação de autenticação',
              url: 'https://docs.pagar.me/reference/autentica%C3%A7%C3%A3o-2',
            },
          },
        ],
      },
      {
        id: 'webhook',
        title: 'Cadastrar a URL de notificação',
        intro:
          'Sem webhook, um PIX pago só é detectado quando a tela consulta o status — o pedido pode demorar a confirmar.',
        steps: [
          {
            text: 'No painel, abra “Configurações › Webhooks” e cadastre a URL desta loja:',
            copy: { label: 'URL de notificação', text: ctx.webhookUrl },
          },
          {
            text: `Ao cadastrar, o painel pede um usuário e uma senha para autenticar as notificações. Defina os dois e informe exatamente os mesmos valores no formulário acima — é assim que o ${ctx.brandName} confirma que a notificação veio mesmo da Stone.`,
          },
          {
            text: 'Assine ao menos os eventos de cobrança: charge.paid, charge.payment_failed e charge.refunded.',
          },
          {
            // Re-homed from the `activate` section this guide used to ship. The
            // stage it belonged to has to stay empty for the activation card,
            // and the sentence is about finishing THIS step anyway.
            text: 'Feito isso, clique em “Testar conexão” acima: o teste faz uma chamada autenticada real e avisa se a chave estiver errada.',
          },
          { action: 'checkout-integrado-confirmado' },
        ],
        doneSummary: { label: 'Webhook', value: 'Cadastrado no painel Pagar.me' },
        confirmLabel: 'Já cadastrei a URL no painel',
      },
    ],
  };
  // With no `progress` from the host the whole guide is returned, unchanged: a
  // caller that cannot say what is done must not be shown a guide that has
  // decided for them (same contract as InfinitePay's and Stripe's).
  if (!ctx.progress) return guide;
  return { ...guide, activeStage: activeStageOf(ctx.progress, guide.stages.length) };
}

/**
 * Which numbered step the stepper sits on, from what the server can prove.
 *
 * A connected store goes to the LAST stage — the sectionless one the activation
 * card fills — and the renderer walks it back to `webhook` on its own until the
 * owner confirms. Reporting the confirmable stage from here instead would pin
 * the walkthrough there: `effectiveStage`'s clamp can only hold a guide BACK.
 */
function activeStageOf(progress: SetupProgress, stageCount: number): number {
  if (!progress.connected) return 0;
  return progress.proven ? stageCount : stageCount - 1;
}
