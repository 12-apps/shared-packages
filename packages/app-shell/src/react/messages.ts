import { resolveAppShellCopy, type AppShellCopySource } from '../core/copy';

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
 * How a host says which language these nine sentences are read in.
 *
 * A HOOK, because what a host has is a hook: `useLocale()` from
 * `@12-apps/i18n/react`, or its own equivalent over whatever remembers the
 * choice. It is CONFIG rather than a dependency for the reason the consent
 * gate's `useSignal` seam is — this package must stay liftable into a repo that
 * has never heard of `@12-apps/i18n`, and carrying a second locale context is
 * how two of them come to disagree.
 *
 * Absent is legal and is the single-audience case: no seam, no tag, and
 * {@link messagesOf} answers with the pack the host configured.
 */
export type AppShellLocaleHook = () => string | null | undefined;

/** The "no locale wired" implementation: nobody said, on every render. */
export const noLocale: AppShellLocaleHook = () => undefined;

/**
 * The messages in force, for whoever is reading this render.
 *
 * Still not a merge — there is nothing left to merge WITH, which was the point
 * of removing the default. What it does now is resolve: a host may pass the
 * nine sentences, or a resolver over a tag-keyed pack
 * (`localeCopy(MY_SHELL_MESSAGES)`), and the two are the same to every caller
 * here.
 *
 * **Call it inside the render that shows the sentence.** This is the whole of
 * rule B, and the failure it prevents is invisible in a single-locale host: the
 * shell is built once at module scope, so a `messagesOf` at factory time pins
 * the crashed-page fallback and the consent dialog to whatever language the
 * app was IMPORTED in — which, for a browser that remembers a choice, is
 * whatever the first tab happened to load. Both call sites are components.
 */
export function messagesOf(
  source: AppShellCopySource<AppShellMessages>,
  locale?: string | null,
): AppShellMessages {
  return resolveAppShellCopy(source, locale);
}
