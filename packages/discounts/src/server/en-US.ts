import type { DiscountsServerCopy } from "./copy";

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
export const EN_US_DISCOUNTS_SERVER_COPY: DiscountsServerCopy = {
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
};
