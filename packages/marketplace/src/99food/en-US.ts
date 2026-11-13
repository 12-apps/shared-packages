import type { NinetyNineFoodAdapterCopy } from "./copy";

/** The 99Food adapter's en-US pack: the same reasons, in English. */
export const NINETY_NINE_FOOD_ADAPTER_COPY_EN_US = {
  reasonLabels: {
    SYSTEMIC_ISSUES: "System problems",
    DUPLICATE_APPLICATION: "Duplicate order",
    UNAVAILABLE_ITEM: "Item unavailable",
    RESTAURANT_WITHOUT_DELIVERY_PERSON: "No courier available",
    OUTDATED_MENU: "Menu out of date",
    ORDER_OUTSIDE_THE_DELIVERY_AREA: "Address outside the delivery area",
    BLOCKED_CUSTOMER: "Blocked customer",
    OUTSIDE_DELIVERY_HOURS: "Outside delivery hours",
    INTERNAL_DIFFICULTIES_OF_THE_RESTAURANT: "Internal difficulties",
    RISK_AREA: "Risk area",
    DELIVERY_PROBLEM: "Delivery problem",
  },
  missingStreetNumber: "no number",
} as const satisfies NinetyNineFoodAdapterCopy;
