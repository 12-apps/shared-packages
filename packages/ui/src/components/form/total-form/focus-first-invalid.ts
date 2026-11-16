/**
 * Where a refused submit takes the person: the FIRST invalid control of the
 * form, in DOM order, focused and scrolled into view.
 *
 * Without it focus stayed on the submit button, and on a short phone the first
 * highlighted field could sit above the viewport while the alert asked to fix
 * "the highlighted fields". A keyboard or screen-reader user was not taken to
 * the problem at all.
 *
 * A control is found by `aria-invalid="true"`, which every `Fields.*` sets while
 * it shows an error, so a caller's own control that sets it is found too. A
 * control hidden from assistive tech (MUI's native `<input>` behind a menu
 * select) is skipped. One that cannot take focus itself (a toggle's
 * `role="group"`) hands it to its pressed segment, else its first focusable
 * descendant.
 */

const FOCUSABLE = [
  'input:not([type="hidden"]):not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function hiddenFromAssistiveTech(element: HTMLElement): boolean {
  return element.closest('[aria-hidden="true"]') !== null;
}

function focusTargetOf(element: HTMLElement): HTMLElement | null {
  if (element.matches(FOCUSABLE)) return element;
  return (
    element.querySelector<HTMLElement>('[aria-pressed="true"]:not([disabled])') ??
    element.querySelector<HTMLElement>(FOCUSABLE)
  );
}

/** Whether the person asked the system for less motion. */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Focus the first invalid control inside `form` and scroll it into view; a
 * smooth scroll unless the person prefers reduced motion. Returns whether one
 * was found: with none, nothing moves.
 */
export function focusFirstInvalid(form: HTMLFormElement | null): boolean {
  if (!form) return false;
  for (const invalid of Array.from(form.querySelectorAll<HTMLElement>('[aria-invalid="true"]'))) {
    if (hiddenFromAssistiveTech(invalid)) continue;
    const target = focusTargetOf(invalid);
    if (!target) continue;
    target.focus({ preventScroll: true });
    if (typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
    return true;
  }
  return false;
}
