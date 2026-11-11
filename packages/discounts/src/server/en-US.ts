import type { CompleteDiscountsServerCopy } from "./copy";

/**
 * The en-US pack — a NAMED export a host passes by hand
 * (`copy: EN_US_DISCOUNTS_SERVER_COPY`), never a default.
 *
 * Every sentence names what the operator must change, because these are form
 * errors: the route reports them with the offending FIELD alongside, so an
 * admin form can paint that input rather than only flashing a banner. A
 * translation that generalised them ("invalid data") would keep the field and
 * lose the instruction.
 */
export const EN_US_DISCOUNTS_SERVER_COPY: CompleteDiscountsServerCopy = {
  invalidQuery: "Invalid query parameters.",
  notFound: "Discount not found.",
  invalidPercent: "Enter a percentage greater than 0 and at most 100.",
  invalidAmount: "Enter a discount amount greater than zero.",
  codeRequired: "Enter the coupon code the customer will type.",
  categoryTargetRequired: "Select at least one category for this discount.",
  itemTargetRequired: "Select at least one product for this discount.",
  // The format is the WIRE's, not a locale's: the route parses YYYY-MM-DD
  // whichever language reports the failure, so naming any other order here
  // would send an operator to type something the endpoint rejects.
  invalidDate: "Invalid date. Use the format YYYY-MM-DD.",
  endsBeforeStarts: "The end date must be after the start date.",
  endsBeforeStartDay: "The end date cannot be before the start date.",
  datesNeedKnownZone:
    "These dates can't be saved: the store's time zone was not recognised. Fix the time zone and try again.",
  keepWindowWithDates:
    "The saved dates can't be kept and changed in the same request. Send only one of the two.",
  windowChanged: "The promotion changed while you were editing. Open it again and save.",
  invalidSchedule: "Invalid promotion schedule. Pick at least one day, and a start and end time that differ.",
  invalidMinSubtotal: "The minimum order must be greater than zero (or left blank).",
  invalidUsageLimit: "The usage limit must be greater than zero (or left blank).",
  invalidPerBuyerLimit: "The per-customer limit must be greater than zero (or left blank).",
  comboScopeRequired: "Bundle price and free items only apply to bundle discounts.",
  invalidComboSlots: "A bundle needs at least one group of items.",
  comboTargetRequired: "Select at least one product or category for each group of the bundle.",
  invalidComboQuantity: "Enter a quantity greater than zero for each group of the bundle.",
  invalidBundlePrice: "Enter the bundle price, greater than zero.",
  invalidFreeUnits: "Enter how many items are free, greater than zero.",
  freeUnitsExceedCombo: "The bundle has to charge for at least one item.",
  invalidMaxComboApplications:
    "The bundles-per-cart limit must be greater than zero (or left blank).",
  foreignTarget: "Select categories and products belonging to this store.",
  bulk: {
    activated: "Activated.",
    deactivated: "Deactivated.",
    extended: "Validity extended.",
    revived: "Had ended: valid again.",
    extendedPaused: "Had ended and was paused: validity extended, still deactivated.",
    restored: "Back to what it was before the batch.",
    alreadyActive: "Was already active.",
    alreadyInactive: "Was already inactive.",
    alreadyEndsThen: "Already ends on that day.",
    alreadyRestored: "Was already as before the batch.",
    noEndDate: "No end date: nothing to extend.",
    notLater: "The new date is not after the current end.",
    stillEnded: "The new date is still in the past: it would stay ended.",
    zoneUnknown: "The store's time zone was not recognised: dates can't change now.",
    zoneOff: "The discount's dates are whole days and the store is not counting them now: dates can't change.",
    notFound: "The discount no longer exists.",
    changedSince: "Changed after the batch: left as it is.",
    changedDuringBatch: "Changed during the batch. Try again.",
    failed: "This discount could not be changed.",
    tooManyIds: "At most {max} discounts at a time. Filter the list and try again.",
    atomicRefused: "Nothing was written: {count} discounts cannot take the change.",
  },
};
