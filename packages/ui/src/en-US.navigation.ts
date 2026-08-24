/**
 * The en-US pack for the navigation family. Split the same way
 * `pt-BR.navigation.ts` is — see `en-US.ts` for why.
 */
import type {
  BreadcrumbCopy,
  CommandPaletteCopy,
} from './copy';

export const EN_US_COMMAND_PALETTE_COPY: CommandPaletteCopy = {
  execute: "Run",
  // The arrow glyphs and the key name are part of the hint a reader looks at
  // while their hands are on the keyboard, so they survive translation intact.
  navigate: "↑↓ Navigate",
  close: "ESC Close",
  recent: "Recent",
  tryAnotherTerm: "Try another term",
};

export const EN_US_BREADCRUMB_COPY: BreadcrumbCopy = {
  showMore: "Show more",
  moreItems: "More items",
};
