/**
 * Borrowing the document's vertical overscroll, and giving it back (12-61).
 *
 * `overscroll-behavior-y: contain` is the property that switches the BROWSER's
 * own overscroll refresh off while leaving its visual overscroll — the bounce,
 * the glow — alone. `none` would take that too, which is why it is not used.
 * WebKit reads it on `html`, Chromium on `body`, so both are set.
 *
 * ## Why this counts holders instead of just saving and restoring
 *
 * The obvious version — capture `element.style.overscrollBehaviorY` at mount,
 * write it back at unmount — is wrong as soon as two mounts overlap, and it
 * fails in the worst available direction. The second mount captures the FIRST
 * one's `contain`; the first restores `""`; the second then writes `contain`
 * back, and nothing ever removes it. The document is left permanently unable to
 * overscroll-refresh, which on Android means the shopper has lost Chromium's
 * native pull-to-refresh AND has no mounted gesture to replace it.
 *
 * So the first holder records what it found and applies the lock, the rest only
 * increment, and the property is restored when the last one leaves.
 */

/** Live holders per element — the count that decides when to restore. */
const holders = new WeakMap<Element, number>();

/** What the element's inline value was before the FIRST holder took it. */
const original = new WeakMap<Element, string>();

/** The two elements the two engines read. `body` is absent during SSR. */
function lockTargets(): HTMLElement[] {
  if (typeof document === "undefined") return [];
  return [document.documentElement, document.body].filter(Boolean);
}

/**
 * Take the lock, and return the function that gives it back.
 *
 * Idempotent per call: each `acquire` must be released exactly once, which is
 * what a React effect's cleanup contract already guarantees.
 */
export function acquireOverscrollLock(): () => void {
  const targets = lockTargets();
  targets.forEach((element) => {
    const held = holders.get(element) ?? 0;
    if (held === 0) {
      original.set(element, element.style.overscrollBehaviorY);
      element.style.overscrollBehaviorY = "contain";
    }
    holders.set(element, held + 1);
  });

  return () => {
    targets.forEach((element) => {
      const held = (holders.get(element) ?? 1) - 1;
      if (held > 0) {
        holders.set(element, held);
        return;
      }
      element.style.overscrollBehaviorY = original.get(element) ?? "";
      holders.delete(element);
      original.delete(element);
    });
  };
}
