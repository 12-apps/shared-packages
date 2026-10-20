import { useState, type JSX, type ReactNode } from "react";

import type { AuthPagesCopy, SignupPageProps } from "./index";
import { PT_BR_OTHER_WAYS } from "./pt-BR";
import { ProviderBlock } from "./card";
import { SignupActions } from "./signup-actions";
import type { EmailAuthScreens, SignupStep } from "../screens";

/**
 * The action block of an `emailFirst` sign-up, step by step (FUT-3806).
 *
 * On the e-mail step there is no submit yet, so the block is the other ways in
 * and the notice. On the next it is the submit, then the link that shows the
 * providers again — under the submit rather than beside the e-mail, so opening
 * them adds rows BELOW everything the person is filling in and moves none of
 * it — then the providers when opened, then the notice. Still one pinned block
 * (`SignupActions`), so the submit stays in view on a phone.
 *
 * Whether the providers are open is this block's own state, and it is spent
 * when the form steps back: emptying the e-mail shows the providers anyway, and
 * typing again starts from them hidden, as the first time.
 */
export function EmailFirstActions({
  step,
  gate,
  submit,
  providers,
  terms,
  otherWays,
  LinkButton,
}: {
  step: SignupStep;
  gate: ReactNode;
  submit: ReactNode;
  /** `null` when the host has no other way in: then there is no link to them. */
  providers: ReactNode;
  terms: SignupPageProps["terms"];
  /** Absent in a pack that predates it: the Portuguese words stand in. */
  otherWays: { show: string; hide: string } | undefined;
  LinkButton: EmailAuthScreens["LinkButton"];
}): JSX.Element {
  const [open, setOpen] = useState(false);
  // Reset while rendering, not in an effect: an effect would paint one frame
  // of the next step with the providers still open.
  if (step === "email" && open) setOpen(false);
  const details = step === "details";
  const showProviders = providers !== null && (!details || open);
  return (
    <SignupActions>
      {gate}
      {details && submit}
      {details && providers !== null && (
        <LinkButton onClick={() => setOpen(!open)} dataTestId="signup-other-ways" expanded={open}>
          {otherWaysLabel(otherWays, open)}
        </LinkButton>
      )}
      {showProviders && providers}
      {terms?.({ providers: showProviders })}
    </SignupActions>
  );
}

/** The link's words, from the pack or, for a pack that predates them, the Portuguese one. */
function otherWaysLabel(otherWays: { show: string; hide: string } | undefined, open: boolean): string {
  const words = otherWays ?? PT_BR_OTHER_WAYS;
  return open ? words.hide : words.show;
}

/** The terms gate's test hook, on the one block it is rendered as. */
export const TERMS_GATE_TEST_ID = "signup-terms-gate";

/**
 * The host's terms gate as ONE block of whichever column it lands in.
 *
 * Both columns it can land in space their children with a `gap` (see
 * `./card`), and a gate handed over as a fragment — a checkbox, a hint, a
 * spacer — would take that gap between each of its own parts. Wrapped, it takes
 * the gap once. An absent gate renders nothing, so it leaves no gap either.
 */
export function TermsGateBlock({ gate }: { gate: ReactNode }): JSX.Element | null {
  if (!present(gate)) return null;
  return <div data-testid={TERMS_GATE_TEST_ID}>{gate}</div>;
}

/** Whether a host slot has anything in it to render. */
export function present(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false;
}

/**
 * The block under the sign-up form: step by step when `emailFirst`, else the
 * gate, the submit, the providers and the notice together, as ever.
 */
export function signupActions({
  emailFirst,
  step,
  gate,
  submit,
  providers,
  terms,
  copy,
  screens,
}: {
  emailFirst: boolean;
  step: SignupStep;
  gate: ReactNode;
  submit: ReactNode;
  providers: ReactNode;
  terms: SignupPageProps["terms"];
  copy: AuthPagesCopy;
  screens: EmailAuthScreens;
}): JSX.Element {
  // `ProviderBlock`'s own test for "nothing", so the link and the block agree.
  const block = providers ? (
    <ProviderBlock label={copy.signup.providerDivider} dividerFirst>
      {providers}
    </ProviderBlock>
  ) : null;
  if (emailFirst) {
    return (
      <EmailFirstActions
        step={step}
        gate={gate}
        submit={submit}
        providers={block}
        terms={terms}
        otherWays={copy.signup.otherWays}
        LinkButton={screens.LinkButton}
      />
    );
  }
  return (
    <SignupActions>
      {gate}
      {submit}
      {block}
      {terms?.({ providers: true })}
    </SignupActions>
  );
}
