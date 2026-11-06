import type { DiscountWireRecord } from "./api";
import { comboRewardOf, kindOf } from "./form-kind";
import type { DiscountsFormatters } from "./format";

/**
 * What the create/edit form HOLDS, and what an existing rule opens as.
 *
 * Its own module because the form and its validators both need the shape, and
 * a type imported back out of the component file would make the two a cycle.
 *
 * Everything here is a STRING: `total-form` holds strings, because every value
 * in a text input is one. The two switches (booleans) and the target id lists
 * (arrays) are therefore not form values at all — they sit in local state
 * beside the container and are merged in at submit.
 */

export interface DiscountFormValues extends Record<string, string> {
  name: string;
  /** What kind of promotion this is. Decides `type` and `scope` — see `./form-kind`. */
  kind: string;
  /** Which of the three rewards a COMBO gives (FUT-4417). Ignored by every other kind. */
  comboReward: string;
  percentOff: string;
  amountOff: string;
  bundlePrice: string;
  freeUnits: string;
  maxComboApplications: string;
  scope: string;
  trigger: string;
  code: string;
  startsAt: string;
  endsAt: string;
  minSubtotal: string;
  usageLimit: string;
  perBuyerLimit: string;
}

/** `YYYY-MM-DD` for a native date input, from the wire's ISO instant. */
function toDateInput(iso: string | null): string {
  return iso === null ? "" : iso.slice(0, 10);
}

/**
 * A bound as the box shows it: the day the server says it runs on, when it
 * says one (FUT-4482); nothing when it says it cannot place the days; else the
 * stored instant's own date — which is what a server counting UTC midnights
 * always meant, and the only kind of server that sends neither.
 */
function dayInput(editing: DiscountWireRecord, bound: "starts" | "ends"): string {
  if (editing.daysUnknown === true) return "";
  const day = bound === "starts" ? editing.startsOn : editing.endsOn;
  return day === undefined ? toDateInput(bound === "starts" ? editing.startsAt : editing.endsAt) : (day ?? "");
}

/** A new rule's defaults: the most common promotion an operator creates. */
const BLANK: DiscountFormValues = {
  name: "",
  kind: "PERCENTAGE",
  comboReward: "PERCENTAGE",
  percentOff: "",
  amountOff: "",
  bundlePrice: "",
  freeUnits: "",
  maxComboApplications: "",
  scope: "ORDER",
  trigger: "AUTOMATIC",
  code: "",
  startsAt: "",
  endsAt: "",
  minSubtotal: "",
  usageLimit: "",
  perBuyerLimit: "",
};

export function initialValues(
  editing: DiscountWireRecord | null,
  formatters: DiscountsFormatters,
): DiscountFormValues {
  if (editing === null) return { ...BLANK };
  const cents = (value: number | null): string =>
    value === null ? "" : formatters.toInput(Number((value / 100).toFixed(2)));
  return {
    name: editing.name,
    kind: kindOf(editing),
    comboReward: comboRewardOf(editing),
    percentOff: editing.percentOffBp === null ? "" : formatters.toInput(editing.percentOffBp / 100),
    amountOff: cents(editing.amountOffCents),
    bundlePrice: cents(editing.bundlePriceCents ?? null),
    freeUnits: editing.freeUnits == null ? "" : String(editing.freeUnits),
    maxComboApplications:
      editing.maxComboApplications == null ? "" : String(editing.maxComboApplications),
    scope: editing.scope,
    trigger: editing.trigger,
    code: editing.code ?? "",
    startsAt: dayInput(editing, "starts"),
    endsAt: dayInput(editing, "ends"),
    minSubtotal: cents(editing.minSubtotalCents),
    usageLimit: editing.usageLimit === null ? "" : String(editing.usageLimit),
    perBuyerLimit: editing.perBuyerLimit === null ? "" : String(editing.perBuyerLimit),
  };
}

