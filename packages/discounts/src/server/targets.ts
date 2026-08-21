import type { DiscountTargetType } from "../engine/kinds";
import type { ComboRequirement } from "../engine/types";
import type { DiscountTargets } from "./validate";

/**
 * The fold between what this package SPEAKS and what the schema STORES.
 *
 * The wire, the validator and the evaluator all speak id ARRAYS — `categoryIds`,
 * `menuItemIds`, and a `ComboRequirement` carrying one of each. The partial
 * stores by-value ROWS: `(target_type, target_id)`, with a nullable `slot_id`
 * telling a scope target from a combo slot's.
 *
 * Both shapes are right for their side. Arrays are what a form binds to and
 * what a matcher iterates; rows are what makes the schema shippable and the
 * reverse read ("which rules touch this row") an index. What is NOT right is
 * each host writing the translation by hand, because it is exactly the kind of
 * mechanical mapping where a dropped `slotId` produces a combo whose slots have
 * silently merged — a discount that still saves, still lists, and prices the
 * wrong thing.
 *
 * So it lives here, in one place, tested in both directions. The host's store
 * stays persistence: it hands these rows to Prisma and hands Prisma's rows back.
 */

/** One row of `discount_targets`, minus the ids the database assigns. */
export interface DiscountTargetRow {
  targetType: DiscountTargetType;
  targetId: string;
}

/** One row of `discount_combo_slots`, with the targets that belong to it. */
export interface DiscountComboSlotRow {
  /** The operator's order — also the order a card describes the combo in. */
  position: number;
  quantity: number;
  targets: readonly DiscountTargetRow[];
}

/** Everything a write persists BESIDE the discount's own columns. */
export interface DiscountTargetRows {
  /** What a CATEGORY- or ITEM-scoped rule covers (`slot_id IS NULL`). */
  scopeTargets: readonly DiscountTargetRow[];
  /** The combo's slots, each with its own targets. Empty unless COMBO-scoped. */
  comboSlots: readonly DiscountComboSlotRow[];
}

function rowsFor(
  categoryIds: readonly string[],
  menuItemIds: readonly string[],
): DiscountTargetRow[] {
  return [
    ...categoryIds.map((targetId) => ({ targetType: "CATEGORY" as const, targetId })),
    ...menuItemIds.map((targetId) => ({ targetType: "ITEM" as const, targetId })),
  ];
}

/**
 * Fold a validated write's targets into the rows the schema stores.
 *
 * The slots keep their INDEX as `position` rather than being handed an
 * arbitrary order: the list an operator built is the list a card reads out, and
 * two slots of the same size are otherwise indistinguishable once stored.
 */
export function toTargetRows(targets: DiscountTargets): DiscountTargetRows {
  return {
    scopeTargets: rowsFor(targets.categoryIds, targets.menuItemIds),
    comboSlots: targets.comboRequirements.map((requirement, index) => ({
      position: index,
      quantity: requirement.quantity,
      targets: rowsFor(requirement.categoryIds, requirement.menuItemIds),
    })),
  };
}

function idsOf(rows: readonly DiscountTargetRow[], type: DiscountTargetType): string[] {
  return rows.filter((row) => row.targetType === type).map((row) => row.targetId);
}

/**
 * Fold stored rows back into the id arrays a record and a rule are built from.
 *
 * The slots are sorted by `position` HERE rather than left to the caller's
 * `orderBy`: the order is part of what the combo means, and a store that
 * forgot the clause would produce a subtly different offer on every read
 * depending on how the database felt like returning the rows.
 */
export function fromTargetRows(rows: DiscountTargetRows): {
  categoryIds: string[];
  menuItemIds: string[];
  comboRequirements: ComboRequirement[];
} {
  const slots = [...rows.comboSlots].sort((left, right) => left.position - right.position);
  return {
    categoryIds: idsOf(rows.scopeTargets, "CATEGORY"),
    menuItemIds: idsOf(rows.scopeTargets, "ITEM"),
    comboRequirements: slots.map((slot) => ({
      menuItemIds: idsOf(slot.targets, "ITEM"),
      categoryIds: idsOf(slot.targets, "CATEGORY"),
      quantity: slot.quantity,
    })),
  };
}
