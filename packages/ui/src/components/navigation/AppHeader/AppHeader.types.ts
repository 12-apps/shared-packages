import type { Breakpoint } from '@mui/material/styles';
import type { ReactNode } from 'react';

import type { ColorValue, SizeValue } from '../../../tokens/scales';

/**
 * How the bar sits in the page.
 *
 * `fixed` lifts it out of flow, so {@link AppHeaderProps.disableSpacer} aside it
 * also renders a spacer of its own measured height — a fixed bar with nothing
 * reserving its space is the classic "first paragraph is under the header" bug.
 */
export type AppHeaderPosition = 'static' | 'sticky' | 'fixed';

/** Which surface the details panel takes on this viewport. */
export type AppHeaderDetailsPresentation = 'auto' | 'sheet' | 'dialog';

/**
 * The circular mark that opens the header: a logo when there is one, the name's
 * initials on a derived gradient when there is not.
 *
 * The gradient is DERIVED from `seedColor` rather than configured, so a caller
 * supplies one brand colour and gets a mark that belongs to it. With no seed it
 * derives from the theme's primary, which is what makes the mark correct in an
 * app that has no per-tenant colour at all.
 */
export interface AppHeaderBrandProps {
  /** Who the mark stands for. Initials come from it, and it labels the mark. */
  name: string;
  /** Logo image; replaces the initials when it loads. */
  logoUrl?: string | null;
  /** `#RRGGBB` (or any CSS colour) to derive the gradient from. */
  seedColor?: string | null;
  /** @default 'md' */
  size?: SizeValue;
  /** @default 'circle' */
  shape?: 'circle' | 'rounded';
  className?: string;
  dataTestId?: string;
}

/**
 * The one-line state under the title — a tone dot plus segments read as a
 * sentence ("Aberto agora · Retirada no balcão").
 */
export interface AppHeaderStatusProps {
  /** The dot's colour. Omit for no dot. */
  tone?: ColorValue;
  /** The segments, in reading order. Empty entries are dropped. */
  items: ReactNode[];
  /** What goes between segments. @default '·' */
  separator?: ReactNode;
  className?: string;
  dataTestId?: string;
}

/**
 * Mark + title + status, optionally the control that discloses the details
 * panel.
 *
 * There is deliberately no `href` here. A title that navigates is one line of
 * the consumer's own router in the `leading` slot, whereas an `href` prop would
 * have to guess whose link component it is being handed — `to` for one router,
 * `href` for another — and would half-work for everybody. `onDisclose` is the
 * only interaction the block owns: with it the block is a button and a chevron
 * appears, without it the block is static text.
 */
export interface AppHeaderIdentityProps
  extends Pick<AppHeaderBrandProps, 'logoUrl' | 'seedColor'> {
  /** The name shown, and the one the mark derives its initials from. */
  title: string;
  /** A quieter line under the title — use `status` for the dotted state line. */
  subtitle?: ReactNode;
  /** The state line, usually an {@link AppHeaderStatusProps} element. */
  status?: ReactNode;
  /** Replaces the derived mark entirely (an icon, an `<img>`, nothing). */
  mark?: ReactNode;
  /** Opens the details panel. Renders the block as a button with a chevron. */
  onDisclose?: () => void;
  /** Whether the panel `onDisclose` opens is currently open (`aria-expanded`). */
  disclosed?: boolean;
  /** Accessible name of the disclosure. @default `Detalhes de {title}` */
  discloseLabel?: string;
  /**
   * The identity is still being resolved — hold a skeleton the size of the real
   * block rather than a fallback name. An app that paints a placeholder title
   * flashes the wrong brand for a frame on every load.
   */
  loading?: boolean;
  /** @default 'md' */
  size?: SizeValue;
  className?: string;
  dataTestId?: string;
}

/**
 * The bar itself: a row of slots on a surface, with an optional second row that
 * belongs to the same surface (search, tabs, chips).
 *
 * Every slot is a `ReactNode`, so the header knows nothing about sessions,
 * routers, carts or stores — it lays out what it is handed.
 */
export interface AppHeaderProps {
  /** Before the identity: a back arrow, a menu toggle, a logo. */
  leading?: ReactNode;
  /** The identity block. Usually an `AppHeaderIdentity`. */
  children?: ReactNode;
  /** Trailing controls: sign-in, cart, account avatar. */
  actions?: ReactNode;
  /**
   * A small muted note pinned to the top-right corner above `actions` — a build
   * tag, an environment name. Hidden from assistive tech is NOT the default: if
   * it is worth showing it is worth reading.
   */
  meta?: ReactNode;
  /** A second row inside the same surface: a search field, tabs, filter chips. */
  below?: ReactNode;
  /** @default 'sticky' */
  position?: AppHeaderPosition;
  /**
   * A CSS length the bar offsets itself by when `sticky`/`fixed` — for whatever
   * already occupies the top of the viewport (an impersonation banner, an
   * offline bar). Accepts a `var(--x, 0px)` so the offset can be published by
   * the element itself. @default 0
   */
  offsetTop?: number | string;
  /**
   * How wide the content may grow before it stops and centres. This is what
   * makes one bar work on a phone and on a desktop: the surface still spans the
   * viewport, the content does not. @default 1200
   */
  maxWidth?: number | string;
  /** Draw the bottom border. @default true */
  divider?: boolean;
  /** Raise a shadow once the page has scrolled under the bar. @default false */
  elevateOnScroll?: boolean;
  /** Tighter vertical rhythm, for a bar with no status line. @default false */
  dense?: boolean;
  /** Skip the flow spacer a `fixed` bar renders. @default false */
  disableSpacer?: boolean;
  className?: string;
  dataTestId?: string;
}

/** One label/value line in the details panel. */
export interface AppHeaderDetailRow {
  /** Stable key; falls back to the label. */
  id?: string;
  label: string;
  value: ReactNode;
  /** Accent the value ("Aberto até 22h" in success green). */
  tone?: ColorValue;
}

/** The details panel's single full-width call to action. */
export interface AppHeaderDetailsAction {
  label: string;
  onClick: () => void;
  /** @default 'primary' */
  color?: ColorValue;
  disabled?: boolean;
  dataTestId?: string;
}

/**
 * The panel the identity's disclosure opens.
 *
 * It is ONE component with two presentations because they are one thing to the
 * user: a bottom sheet where the thumb is, a centred dialog where the pointer
 * is. `presentation: 'auto'` picks by viewport so a caller never writes that
 * branch — and never ships a phone-sized sheet stretched across a desktop.
 */
export interface AppHeaderDetailsProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  /** The label/value lines. Rendered above `children`. */
  rows?: AppHeaderDetailRow[];
  /** Anything the rows cannot express — a map, a note, a list. */
  children?: ReactNode;
  /** The single full-width action at the foot of the panel. */
  action?: AppHeaderDetailsAction;
  /** @default 'auto' */
  presentation?: AppHeaderDetailsPresentation;
  /** Below this breakpoint `auto` chooses the sheet. @default 'sm' */
  breakpoint?: Breakpoint;
  className?: string;
  dataTestId?: string;
}
