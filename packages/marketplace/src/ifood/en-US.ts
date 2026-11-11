import type { IfoodAdapterCopy } from "./copy";

/** The iFood adapter's en-US pack: the same reasons, translated. */
export const IFOOD_ADAPTER_COPY_EN_US = {
  reasonLabels: {
    "501": "System problems",
    "502": "Duplicate order",
    "503": "Item unavailable",
    "504": "No courier available",
    "505": "Menu out of date",
    "506": "Address outside the delivery area",
    "507": "Fraudulent or prank order",
    "508": "Outside delivery hours",
    "509": "Internal difficulties",
    "511": "Risk area",
    "512": "Opening later",
    "513": "Closed",
  },
  missingStreetNumber: "no number",
} as const satisfies IfoodAdapterCopy;
