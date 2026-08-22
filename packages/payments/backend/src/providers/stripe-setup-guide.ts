import type { ProviderSetupGuide, SetupGuideContext, SetupProgress } from '../core/types';
import type { StripeSetupGuideCopy } from './setup-guide-copy';

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
export function stripeSetupGuide(
  copy: StripeSetupGuideCopy,
  ctx: SetupGuideContext,
): ProviderSetupGuide {
  const stages = [
    { id: 'connect', label: copy.stages.connectOauth },
    { id: 'dashboard', label: copy.stages.dashboard },
    { id: 'activate', label: copy.stages.activate },
  ];
  const sections = [connectSection(copy), dashboardSection(copy, ctx, 'oauth')];
  // Same three stages, same confirmable section at index 1 — the mirror
  // `credentialsPath` requires. Only step 1 and the webhook wording change,
  // because only those depend on how the store connected.
  const credentialsPath = {
    stages: [
      { id: 'connect', label: copy.stages.connectCredentials },
      { id: 'dashboard', label: copy.stages.dashboard },
      { id: 'activate', label: copy.stages.activate },
    ],
    sections: [credentialsSection(copy, ctx), dashboardSection(copy, ctx, 'credentials')],
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

function connectSection(copy: StripeSetupGuideCopy): ProviderSetupGuide['sections'][number] {
  return {
    id: 'connect',
    title: copy.connect.title,
    intro: copy.connect.intro,
    steps: [
      {
        text: copy.connect.authorize,
        link: {
          label: copy.connect.aboutConnect,
          url: 'https://stripe.com/docs/connect',
        },
      },
      { text: copy.connect.returns },
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
function credentialsSection(
  copy: StripeSetupGuideCopy,
  ctx: SetupGuideContext,
): ProviderSetupGuide['sections'][number] {
  return {
    id: 'connect',
    title: copy.credentials.title,
    intro: copy.credentials.intro,
    steps: [
      {
        text: copy.credentials.keys,
        button: {
          label: copy.credentials.keysButton,
          url: 'https://dashboard.stripe.com/apikeys',
        },
      },
      {
        text: copy.credentials.webhook,
        copy: { label: copy.webhookUrlLabel, text: ctx.webhookUrl, collapsible: true },
      },
      { text: copy.credentials.save },
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
  copy: StripeSetupGuideCopy,
  ctx: SetupGuideContext,
  path: 'oauth' | 'credentials',
): ProviderSetupGuide['sections'][number] {
  return {
    id: 'dashboard',
    title: copy.dashboard.title,
    doneSummary: { label: copy.dashboard.doneLabel, value: copy.dashboard.doneValue },
    intro: copy.dashboard.intro,
    steps: [
      {
        text: copy.dashboard.methods,
        button: {
          label: copy.dashboard.methodsButton,
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
        text: copy.dashboard.tokenization,
        button: {
          label: copy.dashboard.tokenizationButton,
          url: 'https://dashboard.stripe.com/settings/integration',
        },
      },
      {
        text: copy.dashboard.payoutsEnabled,
        button: {
          label: copy.dashboard.dashboardButton,
          url: 'https://dashboard.stripe.com',
        },
      },
      {
        text: copy.dashboard.webhook(path === 'oauth'),
        copy: { label: copy.webhookUrlLabel, text: ctx.webhookUrl, collapsible: true },
      },
      { action: 'checkout-integrado-confirmado' },
    ],
    confirmLabel: copy.dashboard.confirmLabel,
  };
}
