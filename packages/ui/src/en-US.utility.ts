/**
 * The en-US pack for the utility family. Split the same way
 * `pt-BR.utility.ts` is — see `en-US.ts` for why.
 */
import type {
  InstallPromptCopy,
  UserAvatarCopy,
} from './copy';

export const EN_US_INSTALL_PROMPT_COPY: InstallPromptCopy = {
  title: "Install this app",
  installLabel: "Install",
  dismissLabel: "Dismiss the install prompt",
  // The two halves wrap the platform's share glyph, which the component renders
  // between them. Splitting the sentence is what lets the icon sit inline, so
  // the translation has to keep the same seam rather than one whole sentence.
  iosTapBefore: "Tap",
  iosTapAfter: 'and then "Add to Home Screen"',
  shareLabel: "Share",
};

export const EN_US_USER_AVATAR_COPY: UserAvatarCopy = {
  signOut: "Sign out",
};
