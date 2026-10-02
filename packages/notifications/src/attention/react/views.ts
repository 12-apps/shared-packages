/**
 * How each kind LOOKS and what a tap on it does — the host's half of a kind,
 * keyed by the kind's id, beside the registry that says how it is measured.
 */
import type { ReactNode } from 'react';

import type { AttentionItem } from '../core';

/** How one kind looks and what a tap on it does. */
export interface AttentionKindView<I extends AttentionItem = AttentionItem> {
  /** The glyph, drawn in the button's ink at 22px. */
  readonly icon: ReactNode | ((item: I) => ReactNode);
  /** "Mesa 10" and "Pratos prontos": the subject and what it waits for. */
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

export const minutesOf = (ms: number): number => Math.max(0, Math.round(ms / 60_000));

export function iconOf(view: AttentionKindView, item: AttentionItem): ReactNode {
  return typeof view.icon === 'function' ? view.icon(item) : view.icon;
}
