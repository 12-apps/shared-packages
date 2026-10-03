import type { ProviderSetupGuide, SetupGuideContext, SetupProgress } from '../core/types';
import type { ItauSetupGuideCopy } from './setup-guide-copy';

/**
 * Itau's onboarding walkthrough — the same shape as Stone's: keys, the
 * webhook, and the sectionless last stage every guide keeps for switching
 * sales on. Itau declares no `activationCharge` (it takes no card,
 * the only proof the activation flow can run), so no activation card fills
 * that stage: once connected, the owner turns it on with the status toggle.
 *
 * The webhook is registered by the credential probe itself (BACEN
 * `PUT /webhook/{chave}`, `itau-webhook-registration.ts`), and its result is a
 * check under the Pix key — the probe result is not stored, so this step
 * cannot report it and points there instead, keeping the URL for registering
 * by hand when the bank refused it. Until it is registered Itau notifies
 * nobody — payments are then only found when the checkout or the sweep asks,
 * which is slower but not lost. The step says so, rather than implying a
 * store without it takes no payments.
 */
export function itauSetupGuide(copy: ItauSetupGuideCopy, ctx: SetupGuideContext): ProviderSetupGuide {
  const guide: ProviderSetupGuide = {
    stages: [
      { id: 'credentials', label: copy.stages.credentials },
      { id: 'webhook', label: copy.stages.webhook },
      { id: 'activate', label: copy.stages.activate },
    ],
    sections: [
      {
        id: 'credentials',
        title: copy.credentials.title,
        intro: copy.credentials.intro,
        steps: [
          {
            text: copy.credentials.portal,
            button: { label: copy.credentials.portalButton, url: 'https://devportal.itau.com.br' },
          },
          { text: copy.credentials.certificate },
          { text: copy.credentials.paste },
        ],
      },
      {
        id: 'webhook',
        title: copy.webhook.title,
        intro: copy.webhook.intro,
        steps: [
          {
            text: copy.webhook.register,
            copy: { label: copy.webhookUrlLabel, text: ctx.webhookUrl },
          },
          { text: copy.webhook.withoutIt },
          { action: 'checkout-integrado-confirmado' },
        ],
        doneSummary: { label: copy.webhook.doneLabel, value: copy.webhook.doneValue },
        confirmLabel: copy.webhook.confirmLabel,
      },
    ],
  };
  if (!ctx.progress) return guide;
  return { ...guide, activeStage: activeStageOf(ctx.progress, guide.stages.length) };
}

/**
 * A connected store is past every stage the server can prove, so it is sent
 * to the last one; the renderer walks it back to the webhook step on its own
 * until the owner confirms it (`effectiveStage` can only hold a guide back).
 * There is no proof to wait for beyond the connection, so connected IS done.
 */
function activeStageOf(progress: SetupProgress, stageCount: number): number {
  return progress.connected ? stageCount - 1 : 0;
}
