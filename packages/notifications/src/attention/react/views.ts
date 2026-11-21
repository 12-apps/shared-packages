/**
 * How each kind LOOKS and what a tap on it does — the host's half of a kind,
 * keyed by the kind's id, beside the registry that says how it is measured.
 */
import type { ReactNode } from 'react';

import { AttentionWiringError, type AttentionItem } from '../core';

/** How one kind looks and what a tap on it does. */
export interface AttentionKindView<I extends AttentionItem = AttentionItem> {
  /** The glyph, drawn in the button's ink at 22px. */
  readonly icon: ReactNode | ((item: I) => ReactNode);
  /**
   * The subject and what it waits for, e.g. "#12" and "Rang the bell" — and
   * the subject read aloud when the drawn one is a short form ("Room 12").
   */
  readonly describe: (item: I) => {
    readonly title: string;
    readonly what: string;
    readonly spoken?: string;
  };
  /** A sheet drawn over the page while open. */
  readonly renderSheet?: (props: { readonly item: I; readonly close: () => void }) => ReactNode;
  /** Or anything else the host does itself — called instead of drawing a sheet. */
  readonly onOpen?: (item: I) => void;
  /**
   * Controls of the host's own on this kind's row in the attention LIST (the
   * "+N" popover), or `null`/`undefined`/a boolean for the row as it is.
   *
   * Drawn BESIDE the row's own button, never inside it, in the tab order right
   * after it, so unlike `icon` they may be interactive (accept, decline). A
   * click on one never opens the row: `renderSheet` and `onOpen` stay the row's
   * own and are not called. `close` shuts the list. Called during render, once
   * per row per render: keep it cheap and hook-free, and return an ELEMENT.
   *
   * Layout is the package's: controls start from the left, side by side when
   * they fit and each across the row when they do not (a container query), with
   * a 40 px floor below 600 px of row width.
   *
   * **The head item.** The dock button is one target and cannot hold controls,
   * so while the head's kind answers with controls the list also holds the head,
   * as its first row, and tapping the dock button opens that list rather than
   * the item (its row, in the list, opens it). The answer is read for the head
   * each render, so an item keeps its actions when it becomes the head, and a
   * head whose kind has none behaves exactly as before.
   */
  readonly renderActions?: (props: { readonly item: I; readonly close: () => void }) => ReactNode;
}

/** Views keyed by kind id. */
export type AttentionViews = Readonly<Record<string, AttentionKindView>>;

/** Widen one kind's view to the registry's item type — the twin of `attentionKind`. */
export function attentionView<I extends AttentionItem>(view: AttentionKindView<I>): AttentionKindView {
  return view as unknown as AttentionKindView;
}

/** What a kind's `renderActions` draws for one item, or `null` when it draws nothing. */
export function actionsOf(
  view: AttentionKindView | undefined,
  item: AttentionItem,
  close: () => void,
): ReactNode {
  const drawn = view?.renderActions?.({ item, close });
  return drawn === undefined || drawn === null || typeof drawn === 'boolean' ? null : drawn;
}

/** Whole minutes waited — floored, so a calm item never reads as its full budget early. */
export const minutesOf = (ms: number): number => Math.max(0, Math.floor(ms / 60_000));

export function iconOf(view: AttentionKindView, item: AttentionItem): ReactNode {
  return typeof view.icon === 'function' ? view.icon(item) : view.icon;
}

/**
 * Check the views against the registry once, at wiring time: a view for an
 * undeclared kind, or a declared kind with no view, is a typo that would
 * silently drop a whole kind from the button.
 */
export function defineAttentionViews(
  registry: { readonly kinds: readonly { readonly id: string }[] },
  views: AttentionViews,
): AttentionViews {
  const declared = new Set(registry.kinds.map((kind) => kind.id));
  const unknown = Object.keys(views).filter((id) => !declared.has(id));
  const missing = [...declared].filter((id) => views[id] === undefined);
  if (unknown.length > 0 || missing.length > 0) {
    throw new AttentionWiringError(
      [
        unknown.length > 0 ? `Views for undeclared kinds: ${unknown.join(', ')}.` : '',
        missing.length > 0 ? `Kinds with no view: ${missing.join(', ')}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
  }
  return views;
}
