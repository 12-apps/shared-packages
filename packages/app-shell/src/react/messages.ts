/**
 * Every string the shell renders, stated by the HOST.
 *
 * THE pt-BR TABLE THAT USED TO SIT BELOW THIS INTERFACE IS GONE, and the reason
 * is that its own docstring made the argument against it: "pt-BR by default,
 * because that is the product these screens were extracted from". That is a
 * description of one adopter, shipped inside the package every other adopter
 * installs — and reached by saying nothing, which is the one thing a host does
 * by accident.
 *
 * What it cost was not a translation problem. `messagesOf` spread the host's
 * override ON TOP, so a host that stated four of these nine got the extraction
 * origin's wording for the other five, mixed into its own screens, with nothing
 * anywhere reporting a gap. An all-or-nothing default is at least visible; a
 * partial one is invisible by construction.
 *
 * So `messages` is REQUIRED and whole. The interface is the checklist, and the
 * compiler names the sentences a host has not written yet.
 *
 * Write the consent copy SPECIFIC rather than reassuring-and-vague. The failure
 * it exists to replace was a user being stopped without being told why, and a
 * generic "something went wrong" here just moves the dead end.
 */
export interface AppShellMessages {
  /** Route error boundary. */
  routeErrorTitle: string;
  routeErrorRetry: string;
  /** The consent gate. */
  consentTitle: string;
  consentBody: string;
  consentWhyTitle: string;
  consentWhyBody: string;
  consentTermsLink: string;
  consentPrivacyLink: string;
  consentAccept: string;
}

/**
 * The messages in force.
 *
 * A pass-through rather than a merge: there is nothing left to merge WITH, and
 * that is the point of the change. Kept as a function because both callers read
 * it off a config object and because a later rule (a blank-string refusal, say)
 * belongs in one place.
 */
export function messagesOf(messages: AppShellMessages): AppShellMessages {
  return messages;
}
