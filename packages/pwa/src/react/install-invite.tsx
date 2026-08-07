/**
 * The invite — "this thing can be an app", offered rather than forced.
 *
 * Two branches that share nothing but the app's name, because the platforms
 * share nothing: Chromium hands over a real installer, iOS hands over nothing
 * at all.
 *
 * ## The iOS branch is where the design work is
 *
 * A one-tap button converts on its own. A written instruction has to survive
 * somebody reading it, understanding it, and then finding a control they have
 * never deliberately looked at — and it only gets the two seconds they spend
 * glancing at a banner. Three things follow from that, and each replaces
 * something the obvious version got wrong:
 *
 * 1. **The reason leads, not the instruction.** The first version opened with
 *    "Adicione à sua tela de início" and demoted the payoff to grey caption
 *    text. Nobody adds a site to their Home Screen because they want to add a
 *    site to their Home Screen. On iOS the payoff is also literally gated:
 *    web push does not exist outside an installed app, so "get told when it is
 *    ready" is unavailable until they do this.
 * 2. **The glyph, not the word.** "Toque em Compartilhar" asks for a
 *    translation from a word to a shape. {@link ShareIcon} is the same shape
 *    that is in the browser chrome, so there is nothing to translate.
 * 3. **It points.** Safari's share control is in the BOTTOM bar, and a banner
 *    at the top of a page is pointing at nothing. `placement="anchored"` fixes
 *    the card near the control it is talking about and aims a chevron at it.
 *
 * None of this makes iOS install well — Apple gives no API and the ceiling is
 * low everywhere. It is a discovery affordance, not a funnel, and worth
 * measuring rather than assuming.
 */
import { Alert } from "@12-apps/ui/data-display/Alert";
import { Button } from "@12-apps/ui/form/Button";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";
import type { JSX } from "react";
import { useState } from "react";

import { isHandheld, useInstallPrompt, type UseInstallPromptOptions } from "../install-prompt";
import { resolveMessages, type PwaMessages } from "../messages";

import { ShareIcon } from "./share-icon";

export interface InstallInviteProps extends UseInstallPromptOptions {
  /** What is being installed — the store or app name, shown to the user. */
  what: string;
  /** Override any string. Defaults are pt-BR. */
  messages?: Partial<PwaMessages>;
  /**
   * Where the iOS instruction sits.
   *
   * `"anchored"` (the default) fixes it to the bottom of the viewport with a
   * chevron aimed at the browser's share control, which on iOS is where that
   * control actually is. `"inline"` renders it in the document flow — right
   * only when the host is already placing it near the bottom itself.
   */
  placement?: "anchored" | "inline";
}

/** The manual route: every iOS browser, because none of them has an API. */
function IosInstructions({
  what,
  messages,
  placement,
  onDismiss,
}: {
  what: string;
  messages: PwaMessages;
  placement: "anchored" | "inline";
  onDismiss: () => void;
}): JSX.Element {
  const anchored = placement === "anchored";
  return (
    <div
      data-testid="install-invite-ios"
      style={
        anchored
          ? {
              position: "fixed",
              // Above the browser's own bottom bar, not under it — the chevron
              // has to point AT the control, from just above it.
              left: 12,
              right: 12,
              bottom: 12,
              zIndex: 1300,
            }
          : undefined
      }
    >
      <Alert variant="info">
        <Stack spacing={0.5}>
          {/* The reason, first and largest. */}
          <Text variant="body" size="sm" as="span">
            {messages.iosBenefit(what)}
          </Text>

          {/* Then the mechanics, with the glyph inline where the word was. */}
          <Text variant="caption" size="xs" color="secondary" as="span">
            {messages.iosHow} <ShareIcon /> {messages.iosWhere}
          </Text>

          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Button
              variant="ghost"
              color="primary"
              size="sm"
              onClick={onDismiss}
              dataTestId="install-invite-dismiss"
            >
              {messages.dismiss}
            </Button>
            {anchored && (
              /* Aimed at the share control below. Decorative — the sentence
                 above already says where to go, so it is hidden from readers
                 rather than announced as a stray character. */
              <Text variant="body" size="sm" color="secondary" as="span" aria-hidden="true">
                ▼
              </Text>
            )}
          </Stack>
        </Stack>
      </Alert>
    </div>
  );
}

/** The one-tap route: Chromium held a prompt for us — on a phone OR a desktop. */
function PromptInvite({
  what,
  messages,
  onInstall,
  onDismiss,
}: {
  what: string;
  messages: PwaMessages;
  onInstall: () => Promise<void>;
  onDismiss: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  return (
    <Alert variant="info" data-testid="install-invite">
      <Stack spacing={0.5}>
        <Text variant="body" size="sm" as="span">
          {isHandheld() ? messages.promptHandheld(what) : messages.promptDesktop(what)}
        </Text>
        <Stack direction="row" spacing={1}>
          <Button
            variant="solid"
            color="primary"
            size="sm"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onInstall().finally(() => setBusy(false));
            }}
            dataTestId="install-invite-accept"
          >
            {messages.promptAccept}
          </Button>
          <Button
            variant="ghost"
            color="primary"
            size="sm"
            disabled={busy}
            onClick={onDismiss}
            dataTestId="install-invite-dismiss"
          >
            {messages.dismiss}
          </Button>
        </Stack>
      </Stack>
    </Alert>
  );
}

export function InstallInvite({
  what,
  messages: overrides,
  placement = "anchored",
  enabled,
  onDiagnostic,
}: InstallInviteProps): JSX.Element | null {
  const { offer, install, dismiss } = useInstallPrompt({ enabled, onDiagnostic });
  const messages = resolveMessages(overrides);

  if (offer === "none") return null;

  return offer === "ios-instructions" ? (
    <IosInstructions
      what={what}
      messages={messages}
      placement={placement}
      onDismiss={dismiss}
    />
  ) : (
    <PromptInvite what={what} messages={messages} onInstall={install} onDismiss={dismiss} />
  );
}
