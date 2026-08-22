import type { CategorySelectCopy, ConfirmActionCopy } from "@12-apps/ui/copy";
import type { DataViewsCopy } from "@12-apps/ui/data-display/DataViews";
import type {
  DiscountScope,
  DiscountTrigger,
  DiscountType,
  DiscountWindowState,
} from "../engine/kinds";

/**
 * Every word the discounts ADMIN screens put in front of a human — required
 * host config, with NO defaults.
 *
 * The third copy port in this package, after `DiscountRejectionCopy` (what a
 * buyer is told) and `DiscountsServerCopy` (what an operator is told when a
 * write is refused). Same rule, for the third time and for the same reason: a
 * default in the origin's language reads as finished to the next host right up
 * until a user sees it, and the copy-portability gate exists to refuse exactly
 * that.
 *
 * It is a LOT of keys, and that is the honest count rather than a design
 * failure. This surface is a grid, a form of fourteen inputs, two pickers, two
 * card layouts and four confirmation popups; the origin held roughly 1,800
 * lines, three quarters of which was this. Nothing here has been folded
 * together to make the interface look smaller — two sentences that happen to
 * match today in one language are two sentences.
 *
 * Grouped by SURFACE rather than alphabetically, because a host fills it in by
 * walking a screen.
 *
 * Interpolation is `{name}`-style and there are exactly four of them, each
 * documented at its key. A template rather than a function so the pack stays
 * plain data a host can lint, diff and translate.
 */

/** The labels for one closed set — every member, so nothing renders raw. */
type LabelsFor<TKey extends string> = Readonly<Record<TKey, string>>;

/** The list page: its chrome, its columns and its filters. */
export interface DiscountsScreenCopy {
  /** The page title, and the last breadcrumb crumb. */
  readonly title: string;
  /** The header's explanatory panel — its heading and its paragraph. */
  readonly aboutTitle: string;
  readonly aboutBody: string;
  /** The primary action that opens the create dialog. */
  readonly create: string;
  /** Shown when the tenant has no promotions at all. */
  readonly empty: string;
  /** The exported file's base name, without extension. */
  readonly exportFileName: string;
  /** While the first page is loading. */
  readonly loading: string;
  /** The read failed: a heading, and the button that tries again. */
  readonly loadFailed: string;
  readonly retry: string;
  /** Column headers, which are also the export's column keys. */
  readonly columns: {
    readonly name: string;
    readonly value: string;
    readonly type: string;
    readonly scope: string;
    readonly trigger: string;
    readonly window: string;
    readonly code: string;
    readonly usageCount: string;
    readonly active: string;
  };
  /** The two words a boolean column and its filter pill render. */
  readonly yes: string;
  readonly no: string;
}

/** The four closed sets, each labelled in full. */
export interface DiscountsVocabularyCopy {
  /**
   * The KIND toggle's words — the one question the form actually asks (see
   * `./form-kind`). It is keyed by `DiscountType` because every kind is named
   * after the type it stands for, `COMBO` included: a combo IS a discount, and
   * `BUNDLE_PRICE`'s label survives for the legacy rules that still carry it.
   */
  readonly kind: LabelsFor<DiscountType | "COMBO">;
  readonly type: LabelsFor<DiscountType>;
  readonly scope: LabelsFor<DiscountScope>;
  readonly trigger: LabelsFor<DiscountTrigger>;
  readonly window: LabelsFor<DiscountWindowState>;
}

/** The validity sentence, in all four shapes a nullable window can take. */
export interface DiscountsWindowCopy {
  /** Neither bound set — it runs until somebody stops it. */
  readonly always: string;
  /** Only a start. `{date}`. */
  readonly from: string;
  /** Only an end. `{date}`. */
  readonly until: string;
  /** Both. `{from}` and `{to}`. */
  readonly between: string;
}

/** The create/edit form: its inputs, and every rule it can refuse for. */
export interface DiscountsFormCopy {
  readonly createTitle: string;
  readonly editTitle: string;
  readonly submitCreate: string;
  readonly submitEdit: string;
  readonly name: string;
  readonly type: string;
  /** The kind toggle's own label — the form's first real question. */
  readonly kind: string;
  /** Which of the two rewards a COMBO gives, and the sentence under it. */
  readonly comboReward: string;
  readonly comboRewardHint: string;
  readonly percentOff: string;
  /** The example inside the empty percentage input. */
  readonly percentPlaceholder: string;
  readonly amountOff: string;
  /** The combo's total price, shown only for a BUNDLE_PRICE rule. */
  readonly bundlePrice: string;
  /** How many of the matched units are given away, for a FREE_UNITS rule. */
  readonly freeUnits: string;
  /** Under it: what "leve 3 pague 2" means in this rule's own numbers. */
  readonly freeUnitsHint: string;
  readonly trigger: string;
  readonly code: string;
  /** The example inside the empty coupon input. */
  readonly codePlaceholder: string;
  readonly scope: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly minSubtotal: string;
  readonly usageLimit: string;
  readonly perBuyerLimit: string;
  /** How many times ONE cart may claim the combo. Blank = as often as it fits. */
  readonly maxComboApplications: string;
  readonly maxComboApplicationsHint: string;
  /** The same cap for "leve 3, pague 2", which nobody calls a combo. */
  readonly maxFreeUnitsApplications: string;
  readonly active: string;
  readonly activeHint: string;
  readonly stackable: string;
  readonly stackableHint: string;
  /** The banner over a form the operator must fix before it will send. */
  readonly reviewFields: string;
  /** The banner over a write the SERVER refused. */
  readonly saveFailed: string;
  /** Per-input refusals, each attached to the input it names. */
  readonly nameRequired: string;
  readonly invalidPercent: string;
  readonly invalidAmount: string;
  readonly invalidBundlePrice: string;
  readonly invalidFreeUnits: string;
  /**
   * "Take 3, three free" is a giveaway, not a promotion — the free count has to
   * be smaller than what one application takes out of the cart. `{units}` is
   * that number, so the operator is told the ceiling rather than just refused.
   */
  readonly freeUnitsExceedCombo: string;
  /** The free-units builder names PRODUCTS, so its refusal says products. */
  readonly freeUnitsTargetRequired: string;
  readonly codeRequired: string;
  readonly categoryTargetRequired: string;
  readonly itemTargetRequired: string;
  /** COMBO scope with no groups: there is nothing for the reward to apply to. */
  readonly comboSlotsRequired: string;
  /** A group naming nothing can never be filled, so the combo never fires. */
  readonly comboSlotTargetRequired: string;
  readonly invalidComboQuantity: string;
  readonly invalidMaxComboApplications: string;
  readonly endsBeforeStarts: string;
}

/**
 * The combo builder — the "2 refrigerantes + 2 hambúrgueres + 2 batatas" half
 * of a promotion (FUT-268).
 *
 * A combo is a list of GROUPS, each a quantity and the rows that can fill it,
 * and the reward is whichever value the type asks for. So this group covers the
 * builder's chrome; the reward's own input is a `form` key beside the other
 * value fields, because to the operator it is one.
 */
export interface DiscountsComboCopy {
  /** The section heading over the group list. */
  readonly title: string;
  /** One sentence saying what a group is, in the merchant's terms. */
  readonly hint: string;
  /** The button that appends a group. */
  readonly addSlot: string;
  /** The accessible name of one group's remove control. `{position}`. */
  readonly removeSlot: string;
  /** One group's heading. `{position}` is 1-based — an operator counts from 1. */
  readonly slot: string;
  /** The units this group takes. */
  readonly quantity: string;
  /** The group's picker label, `{collection}` — the registration's own label. */
  readonly pick: string;
  /** Shown when COMBO is chosen and no group exists yet. */
  readonly empty: string;
  /**
   * The offer read back in the operator's own numbers, so a combo can be
   * checked without saving it. `{units}` and `{groups}`.
   */
  readonly summary: string;
  /**
   * The "leve 3, pague 2" builder (`./free-units-builder`), which is the same
   * stored shape wearing the sentence an operator would actually say. Its own
   * keys rather than the group builder's: "Grupo 1" and "Quantidade" are right
   * for a combo of several groups and wrong for one offer about one shelf.
   */
  readonly freeUnitsTitle: string;
  readonly freeUnitsHint: string;
  /** How many units the customer takes to earn the free ones. */
  readonly buyQuantity: string;
  /** That builder's picker label, `{collection}` — one offer, not one group. */
  readonly freeUnitsPick: string;
  /** The read-back, once both numbers make an offer. `{units}` and `{paid}`. */
  readonly freeUnitsSummary: string;
}

/** The target pickers, and what an empty selection says. */
export interface DiscountsTargetCopy {
  /** The picker's label, `{collection}` — the registration's own label. */
  readonly pick: string;
  /** The placeholder inside a searchable picker, `{collection}`. */
  readonly search: string;
  /** Shown under a picker the scope requires and nothing is chosen in. */
  readonly required: string;
}

/** The row and card menus, and the two destructive confirmations. */
export interface DiscountsActionsCopy {
  /** The kebab's accessible name — announced verbatim by a screen reader. */
  readonly menu: string;
  readonly edit: string;
  readonly delete: string;
  /** The delete popup for ONE rule. */
  readonly deleteTitle: string;
  readonly deleteDescription: string;
  /** The delete popup for a SELECTION. `{count}`. */
  readonly deleteManyTitle: string;
  readonly deleteManyDescription: string;
  /** When a delete fails and the server said nothing useful. */
  readonly deleteFailed: string;
  /** The shared snackbar's heading, over whatever an action reported. */
  readonly actionFailed: string;
}

/** The two card layouts. */
export interface DiscountsCardCopy {
  /** The chip a switched-off rule carries. Shown only when it is off. */
  readonly paused: string;
  /** Headings inside an expanded list-card body. */
  readonly ruleHeading: string;
  readonly targetsHeading: string;
  /** What an ORDER-scoped rule covers. */
  readonly wholeOrder: string;
  /** How many rows it points at: one, and `{count}` for the rest. */
  readonly oneTarget: string;
  readonly manyTargets: string;
  /** A CODE rule's secondary line, `{code}`. */
  readonly withCode: string;
  /** An empty target run inside a card. */
  readonly noTargets: string;
  /** Row labels inside the expanded body. */
  readonly usage: string;
  readonly minSubtotal: string;
  readonly perBuyerLimit: string;
  readonly unlimited: string;
}

export interface DiscountsWebCopy {
  readonly screen: DiscountsScreenCopy;
  readonly labels: DiscountsVocabularyCopy;
  readonly window: DiscountsWindowCopy;
  readonly form: DiscountsFormCopy;
  readonly combo: DiscountsComboCopy;
  readonly targets: DiscountsTargetCopy;
  readonly actions: DiscountsActionsCopy;
  readonly card: DiscountsCardCopy;
  /**
   * The words of the `@12-apps/ui` components these screens MOUNT but do not
   * own — the confirmation popup and the category picker.
   *
   * They arrive here because that package stopped shipping defaults for them
   * (FUT-760): a design system's Portuguese reached every adopter silently,
   * so its copy is required config now and this surface is one of its hosts.
   */
  readonly confirmAction: ConfirmActionCopy;
  readonly categorySelect: CategorySelectCopy;
  readonly dataViews: DataViewsCopy;
}

/**
 * Fill `{name}` placeholders. Unknown names are left alone rather than blanked,
 * so a pack with a typo shows the typo instead of a hole nobody can trace.
 */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}

/** Every leaf path of an object, dotted. */
function leafPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return prefix === "" ? [] : [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leafPaths(child, prefix === "" ? key : `${prefix}.${key}`),
  );
}

/** One dotted path out of a pack, or `undefined` where the path does not exist. */
function read(copy: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (node, key) =>
      node !== null && typeof node === "object"
        ? (node as Record<string, unknown>)[key]
        : undefined,
    copy,
  );
}

/**
 * The keys a pack is missing or left blank, as dotted paths.
 *
 * Walked from a REFERENCE pack rather than from a hand-kept key list: this
 * interface is seventy-odd keys deep in seven groups, and a list beside it
 * would be wrong within one release. Only the reference's SHAPE is read, never
 * its words — `createWebDiscounts` passes the pt-BR pack for that and nothing
 * of it survives into the answer.
 */
export function missingWebCopy(
  copy: DiscountsWebCopy | undefined,
  reference: DiscountsWebCopy,
): string[] {
  return leafPaths(reference).filter((path) => {
    const value = read(copy, path);
    // A leaf is satisfied by a non-blank string OR a function. The `@12-apps/ui`
    // packs folded in below carry entries that take the interpolated value as
    // an argument — `noResults.title(query)`, `footer.selectedCount(count)` —
    // because Portuguese decides word order and plural agreement per sentence.
    // Demanding a string here would report every one of them as missing.
    if (typeof value === "function") return false;
    return typeof value !== "string" || value.trim() === "";
  });
}
