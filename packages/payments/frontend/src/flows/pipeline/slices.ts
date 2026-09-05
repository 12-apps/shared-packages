/**
 * WHERE A STEP'S OWN SCRAP OF STATE LIVES (FUT-1240).
 *
 * A step DECLARES its slice — the initial value, whether it survives a reload,
 * and how to read one back — and the engine owns the storage. That split is
 * what stops each step growing its own `sessionStorage` key with its own
 * spelling and its own idea of who it belongs to, which is how three of the
 * four hosted-order parks ended up unscoped.
 *
 * ## Scoped to the store, always
 *
 * The key is `payments.checkout.<slug>.<stepId>`. On a multi-tenant storefront
 * every store shares one origin, so an unscoped key is one slot every store
 * writes over: the shape that let store A's abandoned hand-off resume on store
 * B's checkout. A host with no slug gets `-`, which is the single-tenant case
 * and the only place there is nothing to confuse it with.
 *
 * ## Trust nothing that came back out
 *
 * Storage is the one input that did not come from this render. It is a string
 * a shopper can edit, a half-written value a killed tab left behind, or an
 * older bundle's shape. So a slice is rehydrated ONLY when the step declared a
 * `parse` and that parser accepts what was there; everything else falls back
 * to `initial(ctx)`. Same rule as `hosted-return.ts`'s `isCheckoutOrder`.
 */
import type { AnyCheckoutStep, CheckoutContext } from "./types";

/** The one place the key is spelled. */
export function sliceKey(tenantSlug: string | undefined, stepId: string): string {
  return `payments.checkout.${tenantSlug ?? "-"}.${stepId}`;
}

/** The parked value, or `null` — never a throw, and never an unparsed one. */
export function readSlice(
  step: AnyCheckoutStep,
  tenantSlug: string | undefined,
): unknown {
  const slice = step.slice;
  if (!slice || slice.persist !== "session" || !slice.parse) return null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage?.getItem(sliceKey(tenantSlug, step.id)) ?? null;
  } catch {
    // Storage disabled or unavailable — the same "nothing parked" as an empty
    // slot. A checkout that cannot remember a step still works; one that
    // throws on a private-mode browser does not.
    return null;
  }
  if (raw === null) return null;
  try {
    return slice.parse(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/** Park a slice, or drop it when the step does not persist. */
export function writeSlice(
  step: AnyCheckoutStep,
  tenantSlug: string | undefined,
  value: unknown,
): void {
  if (step.slice?.persist !== "session") return;
  try {
    window.sessionStorage?.setItem(
      sliceKey(tenantSlug, step.id),
      JSON.stringify(value),
    );
  } catch {
    // Storage full or disabled. The slice still lives in React for this visit;
    // only its survival across a reload is lost, and refusing to advance the
    // checkout over that would be the worse failure.
  }
}

/** Drop every registered step's parked slice — the end of one checkout. */
export function clearSlices(
  steps: readonly AnyCheckoutStep[],
  tenantSlug: string | undefined,
): void {
  for (const step of steps) {
    if (step.slice?.persist !== "session") continue;
    try {
      window.sessionStorage?.removeItem(sliceKey(tenantSlug, step.id));
    } catch {
      // Nothing to clear on a browser that refuses storage.
    }
  }
}

/**
 * Every step's slice at mount: what was parked when it can be trusted, and the
 * step's own `initial(ctx)` when it cannot.
 *
 * `ctx` here is the context BEFORE any slice is known, which is why
 * `CheckoutContext.slices` is empty on this pass — an `initial` that read its
 * own slice would be asking what it is about to answer.
 */
export function initialSlices(
  steps: readonly AnyCheckoutStep[],
  ctx: CheckoutContext,
): Record<string, unknown> {
  const slices: Record<string, unknown> = {};
  for (const step of steps) {
    if (!step.slice) continue;
    const parked = readSlice(step, ctx.tenantSlug);
    slices[step.id] = parked === null ? step.slice.initial(ctx) : parked;
  }
  return slices;
}
