import type { ProviderSetupGuide, SetupGuideContext, SetupProgress } from '../core/types';
import type { InfinitePaySetupGuideCopy } from './setup-guide-copy';

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
export function infinitePaySetupGuide(
  copy: InfinitePaySetupGuideCopy,
  ctx: SetupGuideContext,
): ProviderSetupGuide {
  const stages = [
    { id: 'handle', label: copy.stages.handle },
    { id: 'enable', label: copy.stages.enable },
    { id: 'activate', label: copy.stages.activate },
  ];

  const sections = [handleSection(copy, ctx), enableSection(copy, ctx)];
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
function enableSection(
  copy: InfinitePaySetupGuideCopy,
  ctx: SetupGuideContext,
): ProviderSetupGuide['sections'][number] {
  return {
    id: 'enable',
    title: copy.enable.title,
    doneSummary: { label: copy.enable.doneLabel, value: copy.enable.doneValue },
    intro: copy.enable.intro,
    steps: [
      {
        text: copy.enable.enableStep,
        button: {
          label: copy.enable.settingsButton,
          url: 'https://app.infinitepay.io/external-checkout#configuracoes',
        },
      },
      {
        // Reference only, never a task — presenting it as one is what sent
        // owners hunting for a registration screen that does not exist, and
        // folding it away is the same correction in layout form.
        copy: {
          label: copy.enable.webhookUrlLabel,
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
function handleSection(
  copy: InfinitePaySetupGuideCopy,
  ctx: SetupGuideContext,
): ProviderSetupGuide['sections'][number] {
  return {
    id: 'handle',
    title: copy.handle.title,
    intro: copy.handle.intro,
    steps: [
      {
        // InfinitePay's own warning on that page, repeated because the button
        // below lands on a CHANGE screen: an owner one field away from breaking
        // every link they have already sent out deserves to read this before
        // going there rather than discover it after.
        tone: 'warning',
        text: copy.handle.doNotChange,
      },
      {
        tone: 'warning',
        text: copy.handle.wrongTagPaysAStranger(ctx.brandName),
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
          label: copy.handle.seeMyTagButton,
          url: 'https://app.infinitepay.io/settings/change/infinite-tag',
        },
      },
    ],
  };
}
