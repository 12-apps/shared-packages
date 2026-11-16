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
 * select) is skipped, and so is one that is not rendered (`hidden`,
 * `display: none`, `visibility: hidden`) or will not take focus (disabled): the
 * next invalid control gets it instead. One that cannot take focus itself (a
 * toggle's `role="group"`) hands it to its pressed segment, else its first
 * focusable descendant.
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

/** Whether `element`, or an ancestor up to `form`, is hidden from view. */
function notRendered(element: HTMLElement, form: HTMLFormElement): boolean {
  for (let node: HTMLElement | null = element; node && node !== form; node = node.parentElement) {
    if (node.hidden) return true;
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return true;
  }
  return false;
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
 * Focus the first invalid control inside `form` that can take focus, and
 * scroll it into view; a smooth scroll unless the person prefers reduced
 * motion. Returns whether one took the focus: with none, nothing moves.
 */
export function focusFirstInvalid(form: HTMLFormElement | null): boolean {
  if (!form) return false;
  for (const invalid of Array.from(form.querySelectorAll<HTMLElement>('[aria-invalid="true"]'))) {
    if (hiddenFromAssistiveTech(invalid) || notRendered(invalid, form)) continue;
    const target = focusTargetOf(invalid);
    if (!target) continue;
    target.focus({ preventScroll: true });
    // A control the browser will not focus (not rendered, inert) is passed by.
    if (target.ownerDocument.activeElement !== target) continue;
    if (typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
    return true;
  }
  return false;
}
