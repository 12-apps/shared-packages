import {
  creationFailure,
  postActivation,
  refusedByProvider,
  type ActivationClock,
  type RedirectActivationState,
} from './redirect-state';
import type { RedirectActivationCopy } from './copy';

/**
 * Getting the owner onto the provider's payment page, in one press (FUT-763).
 *
 * Its own file because the ORDER of what happens inside that click is the whole
 * content of it, and it is easy to lose in a hook full of effects.
 */

/** A tab claimed for the payment page, before its address is known. */
interface PendingTab {
  send: (url: string) => void;
  discard: () => void;
}

/**
 * Claim a tab SYNCHRONOUSLY, to be pointed somewhere once the link exists.
 *
 * Pressing the pay button should land the owner on the payment page — that is
 * the whole action, and making them find a second button afterwards is the
 * extra step this flow exists to remove. But the URL does not exist yet: it is
 * minted by a request, and a `window.open` issued after that `await` has lost
 * the user's gesture, so every popup blocker eats it.
 *
 * Deliberately without `noopener`: that flag makes `window.open` return null,
 * leaving no handle to navigate. `opener` is cleared by hand instead.
 */
function claimTab(): PendingTab {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  return {
    // `replace`, so the blank entry does not become a Back destination.
    send: (target) => tab?.location.replace(target),
    discard: () => tab?.close(),
  };
}

/**
 * Mint the link and point the claimed tab at it.
 *
 * The ORDER here is load-bearing: the tab is claimed inside the click (see
 * {@link claimTab}), discarded rather than stranded on a refusal, and the poll
 * clock is only started once a link actually exists.
 */
export async function mintCharge(io: {
  url: string;
  live: ActivationClock;
  setState: (next: RedirectActivationState) => void;
  copy: RedirectActivationCopy;
  onCreateFailed?: () => void;
}): Promise<void> {
  const tab = claimTab();

  io.setState({ kind: 'creating' });
  const body = await postActivation(io.url, 'start');
  if (!body?.ok || !body.checkoutUrl) {
    // Never strand a blank tab on a failure the owner is about to read here.
    tab.discard();
    io.setState(creationFailure(body, io.copy));
    // A dropped request means the provider refused NOTHING, so nothing the
    // owner told us is called into question. Only an actual refusal withdraws
    // their confirmation of the provider-side step.
    if (refusedByProvider(body)) io.onCreateFailed?.();
    return;
  }
  tab.send(body.checkoutUrl);
  io.live.current.polling = true;
  io.live.current.startedAt = Date.now();
  io.setState({ kind: 'awaiting', checkoutUrl: body.checkoutUrl });
}
