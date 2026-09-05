/**
 * THE DEV-MODE ASSERTION THAT KEEPS HOOK ORDER HONEST (FUT-1216 risk 1).
 *
 * Every registered step, gate and settlement method may declare a `useFacts()`,
 * and the engine calls them in ARRAY ORDER on every render. React's hook
 * identity is positional, so the order — and therefore the membership — of
 * those arrays is part of the component's hook signature.
 *
 * A host that builds them inline (`steps={[scheduleStep, addressStep]}` in
 * JSX, or `const GATES = gates.filter(...)` in a component body) hands the
 * engine a NEW array every render. Today that usually still works, which is
 * the danger: it works right up until a filter's answer changes and a
 * `useFacts` disappears from the middle of the list, at which point React
 * silently pairs the wrong state with the wrong plugin. There is no error, no
 * warning, and the symptom is a checkout that reads another plugin's facts.
 *
 * So this refuses the shape rather than the symptom. In a development build a
 * plugin array that is not identity-stable across renders THROWS, naming the
 * array and the fix: hoist it to module scope, or memoise it. In production it
 * does nothing at all — a live checkout must never be taken down by a wiring
 * complaint, and by then the shape has been provable for the host's whole dev
 * and test cycle.
 */
import { useRef } from "react";

/** Whether this bundle is a development one. */
function inDevelopment(): boolean {
  // `process` is absent in a plain browser and replaced at build time by every
  // bundler a host is likely to use; both readings are guarded so neither can
  // throw inside a render.
  try {
    return typeof process !== "undefined" && process.env?.["NODE_ENV"] !== "production";
  } catch {
    return false;
  }
}

/** What a host is told when it rebuilds an array per render. */
function unstablePluginMessage(name: string): string {
  return (
    `createPaymentFlows: \`${name}\` must be the SAME array on every render. ` +
    "Every registered plugin's `useFacts()` runs in array order, so React's hook " +
    "order is a function of this array's membership — a fresh array per render " +
    "will eventually pair one plugin's state with another's, silently. Hoist it " +
    "to module scope (`const STEPS = [...]`) or memoise it. This check runs in " +
    "development builds only."
  );
}

/**
 * Assert one plugin array is the same object it was last render.
 *
 * `undefined` is stable by definition — a host that registers nothing has
 * nothing to keep still — and the FIRST render has nothing to compare with.
 */
export function useStablePluginArray(
  name: string,
  array: readonly unknown[] | undefined,
): void {
  const seen = useRef<readonly unknown[] | undefined>(array);
  if (array === undefined || seen.current === undefined) return;
  if (seen.current === array) return;
  // THROWN BEFORE THE REF MOVES, and that ordering is the whole assertion.
  // React answers a failed concurrent render by retrying the root
  // synchronously; a check that had already recorded the new array would pass
  // on that retry, React would report itself recovered, and the misconfigured
  // host would see nothing at all. Refusing again is what puts the complaint
  // in front of an error boundary — and what keeps it there until the array is
  // actually hoisted.
  if (inDevelopment()) throw new Error(unstablePluginMessage(name));
  seen.current = array;
}
