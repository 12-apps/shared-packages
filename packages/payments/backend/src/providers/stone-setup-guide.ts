import { MERCHANT_EVENTS } from './stone-events';
import type { ProviderSetupGuide, SetupGuideContext, SetupProgress } from '../core/types';
import type { StoneSetupGuideCopy } from './setup-guide-copy';

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
export function stoneSetupGuide(
  copy: StoneSetupGuideCopy,
  ctx: SetupGuideContext,
): ProviderSetupGuide {
  const guide: ProviderSetupGuide = {
    stages: [
      { id: 'keys', label: copy.stages.keys },
      { id: 'webhook', label: copy.stages.webhook },
      { id: 'activate', label: copy.stages.activate },
    ],
    sections: [
      {
        id: 'keys',
        title: copy.keys.title,
        intro: copy.keys.intro,
        steps: [
          {
            text: copy.keys.generate,
            button: { label: copy.keys.dashboardButton, url: 'https://dash.pagar.me' },
          },
          {
            text: copy.keys.paste,
            link: {
              label: copy.keys.authDocsLink,
              url: 'https://docs.pagar.me/reference/autentica%C3%A7%C3%A3o-2',
            },
          },
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
          {
            text: copy.webhook.credentials(ctx.brandName),
          },
          {
            // Composed from the adapter's own list, never retyped per locale.
            text: copy.webhook.events(MERCHANT_EVENTS.join(', ')),
          },
          {
            // Re-homed from the `activate` section this guide used to ship. The
            // stage it belonged to has to stay empty for the activation card,
            // and the sentence is about finishing THIS step anyway.
            text: copy.webhook.testConnection,
          },
          { action: 'checkout-integrado-confirmado' },
        ],
        doneSummary: { label: copy.webhook.doneLabel, value: copy.webhook.doneValue },
        confirmLabel: copy.webhook.confirmLabel,
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
