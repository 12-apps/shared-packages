/**
 * A private copy of `feedback/Dialog`'s `focusFirstTabbable` (FUT-2696), which
 * this maintenance line predates. `SettingCard` needs the same "move focus to
 * the first tabbable descendant, or the element itself" rule when it opens in
 * place — pulling the shared `Dialog.focus` module forward would drag the
 * Dialog focus-trap fix it shipped with onto a line that only takes security
 * and backport fixes.
 */

/**
 * The candidate list `FocusTrap`'s own `defaultGetTabbable` uses
 * (`@mui/material/Unstable_TrapFocus/FocusTrap.js`). A match whose resolved
 * `tabIndex` is -1 is skipped, as the trap itself skips one.
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
 * itself — given `tabIndex={-1}` if it does not already carry one — when
 * nothing inside is focusable.
 *
 * Backs off when focus already sits on a DESCENDANT of `target` other than
 * `target` itself: that is a caller's `autoFocus` (or an explicit `.focus()`
 * of their own) that arrived before this ran, and it keeps winning.
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
