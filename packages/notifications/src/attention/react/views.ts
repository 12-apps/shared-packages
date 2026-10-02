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
  /** The subject and what it waits for, e.g. "Room 12" and "Rang the bell". */
  readonly describe: (item: I) => {
    readonly title: string;
    readonly what: string;
  };
  /** A sheet drawn over the page while open. */
  readonly renderSheet?: (props: { readonly item: I; readonly close: () => void }) => ReactNode;
  /** Or anything else the host does itself — called instead of drawing a sheet. */
  readonly onOpen?: (item: I) => void;
}

/** Views keyed by kind id. */
export type AttentionViews = Readonly<Record<string, AttentionKindView>>;

/** Widen one kind's view to the registry's item type — the twin of `attentionKind`. */
export function attentionView<I extends AttentionItem>(view: AttentionKindView<I>): AttentionKindView {
  return view as unknown as AttentionKindView;
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
