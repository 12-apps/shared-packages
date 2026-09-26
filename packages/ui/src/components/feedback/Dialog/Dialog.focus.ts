/**
 * WHERE INITIAL FOCUS LANDS WHEN A DIALOG OPENS (FUT-2696).
 *
 * MUI's `FocusTrap` focuses ITS OWN root when nothing inside already has
 * focus (`FocusTrap.js`: `if (!rootRef.current.contains(doc.activeElement))
 * … rootRef.current.focus()`). For `MuiDialog` that root is
 * `.MuiDialog-container` — the `role="presentation"` wrapper the Transition
 * clones its ref onto — which sits OUTSIDE the `role="dialog"` paper. A
 * screen reader user landing there hears the page behind the dialog, not the
 * dialog, and the first Tab does not start from the dialog's own controls.
 *
 * The WAI-ARIA APG dialog pattern wants focus INSIDE the dialog on open: the
 * first tabbable descendant of the element carrying `role="dialog"`, or that
 * element itself (given `tabIndex={-1}`, since it is not otherwise reachable
 * by Tab) when it holds nothing focusable.
 *
 * `focusDialogOnEntered` is wired to `TransitionProps.onEntered` /
 * `SlideProps.onEntered` on both renderers rather than to a mount effect,
 * because it needs to run AFTER `FocusTrap`'s own mount effect has already
 * had its turn — `onEntered` fires once the enter transition has finished,
 * well after every mount effect has settled, so there is nothing left to
 * race. A caller's own `autoFocus` on a field inside the dialog already wins
 * against `FocusTrap` for the same reason `FocusTrap` documents: React's
 * `autoFocus` runs synchronously during commit, before `FocusTrap`'s effect
 * even checks whether focus is already inside its root — so by the time this
 * runs, that field is already `contains()`-ed by the dialog and this backs
 * off rather than moving focus away from it.
 */

/**
 * The candidate list `FocusTrap`'s own `defaultGetTabbable` uses
 * (`@mui/material/Unstable_TrapFocus/FocusTrap.js`), so "first tabbable
 * descendant" means the same thing here as it does to the trap that then
 * keeps Tab cycling inside it. Like the trap, a match whose resolved
 * `tabIndex` is -1 is skipped: `<button tabIndex={-1}>` is focusable but out
 * of the Tab order, so it is not the first Tab stop.
 */
const FOCUSABLE_SELECTOR = [
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  'button:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
].join(',');

/**
 * Move focus into `target`: its first tabbable descendant, or `target`
 * itself — given `tabIndex={-1}` if it does not already carry one, exactly as
 * `FocusTrap` gives its own root — when nothing inside is focusable.
 *
 * Backs off when focus already sits on a DESCENDANT of `target` other than
 * `target` itself: that is a caller's `autoFocus` (or an explicit `.focus()`
 * of their own) that arrived before this ran, and it keeps winning. Focus
 * already sitting ON `target` (as `FocusTrap` leaves it on the drawer's
 * paper, which is its own trap root) is not a caller's choice, so it does
 * not block a first-tabbable descendant from taking over.
 */
export function focusFirstTabbable(target: HTMLElement): void {
  const active = target.ownerDocument.activeElement;
  if (active !== target && target.contains(active)) return;

  const tabbable = Array.from(target.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).find(
    (element) => element.tabIndex >= 0,
  );
  if (tabbable) {
    tabbable.focus();
    return;
  }
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus();
}

/**
 * `node` is what the transition hands back: `.MuiDialog-container` for
 * `ModalDialog` (the paper is a descendant, carrying `role="dialog"`), or the
 * drawer's own paper directly for `DrawerDialog` (`Slide` wraps the paper with
 * no intermediate container, and the paper carries no `role` at all — see
 * `Dialog.md`). Either way, focus the `[role="dialog"]` descendant if there is
 * one, else `node` itself.
 */
export function focusDialogOnEntered(node: HTMLElement): void {
  const dialog = node.getAttribute('role') === 'dialog'
    ? node
    : (node.querySelector<HTMLElement>('[role="dialog"]') ?? node);
  focusFirstTabbable(dialog);
}
