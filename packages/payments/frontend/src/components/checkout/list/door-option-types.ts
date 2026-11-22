/**
 * The host's door options, as the list draws them (FUT-3591) — their own
 * module for the size gate on `types.ts`, which re-exports them.
 */
import type { ReactNode } from "react";

import type { CheckoutDoorPrice } from "./price-types";

/**
 * What a door option's `content` function is handed (FUT-3715).
 *
 * `choose` is exactly what the row's radio does; calling it on the chosen row
 * changes nothing. The list reports the choice through `onChoiceChange` as it
 * does for the radio — from an effect, after the render — so a host that
 * answers in the same tap keeps its answer across that render. The list never
 * moves keyboard focus here: where focus goes is the host's call.
 */
export interface CheckoutDoorRowControls {
  /** This option is the list's current choice. */
  chosen: boolean;
  /** Choose this option, as its radio would. */
  choose: () => void;
}

/**
 * One of the host's ways to pay at the door — "Dinheiro", "Maquininha".
 *
 * Every field is a fact the host already holds; the list never computes one.
 * Rebuild the array whenever any of them changes (a hook that returns it is the
 * natural shape): the list renders what it is handed on every render.
 */
export interface CheckoutDoorOption extends CheckoutDoorPrice {
  /** Stable within the list; reported back through `onChoiceChange`. */
  id: string;
  /** The row's label — "Dinheiro". */
  label: string;
  /** The muted line under the label — "Crédito, débito, vale-refeição ou Pix". */
  hint?: string;
  /**
   * A short pill under the hint — "Chama o garçom": what choosing the row sets
   * in motion, in the host's words. Drawn in the row's words column, chosen or
   * not. Absent ⇒ no pill.
   */
  tag?: string;
  /**
   * Hide the hint while the option is chosen — for an option whose opened
   * content says the same thing at length (the maquininha's brand lines).
   */
  hideHintWhileChosen?: boolean;
  /**
   * What opens INSIDE the row when it is chosen (the troco question, the
   * tender chips, the brand lines). Rendered only while chosen — unless
   * `showContentWhileIdle` — with no left indent: it starts where the row's own
   * content starts.
   *
   * As a function it is handed the row's own controls, so a control inside the
   * content can choose the row in the same tap that answers it (the troco
   * chips, FUT-3715). A plain node behaves exactly as before. The function is
   * called during the row's render, not mounted as a component: keep it one
   * shape for the option's life, and return a component of your own if the
   * content needs hooks.
   */
  content?: ReactNode | ((row: CheckoutDoorRowControls) => ReactNode);
  /**
   * Render `content` while the option is NOT chosen too — for an option whose
   * answers are themselves the way to choose it (FUT-3715). The unchosen row
   * keeps its unchosen frame; the content keeps its box and place in both
   * states, so choosing the row moves nothing.
   */
  showContentWhileIdle?: boolean;
  /** The bar button's verb while this option is chosen — "Enviar pedido". */
  action: string;
  /** The amount beside the verb. Absent ⇒ the cart's own total. */
  totalLabel?: string;
  /**
   * Why the button cannot send yet, in the host's words — or `null` when it
   * can. Shown under the button, which stays disabled while it is set.
   */
  blocked: string | null;
  /** The host's send is in flight: the button shows its busy state. */
  pending?: boolean;
  /** A refusal of the last send, in the host's words, shown under the button. */
  error?: string | null;
  /** Press of the bar's button while this option is chosen. Places the order. */
  onSend: () => void;
}
