/**
 * Print-to-PDF export (FUT-310). Spike verdict, recorded: server-side chart
 * rasterization would need either a headless browser in the PRODUCTION
 * runtime (Chromium ships for tests only) or a second, canvas-based chart
 * implementation kept in sync with SpecChart — both out of proportion for
 * v1. The browser's print engine already rasterizes exactly what the viewer
 * shows, charts included, so v1 exports through it: a scoped print region,
 * print-only CSS and `window.print()`. "Save as PDF" is the print dialog's
 * default on every supported browser.
 */
import type { JSX } from "react";

import { Button } from "@12-apps/ui/form/Button";

/** Marks the ONE subtree that prints; everything else is hidden. */
export const PRINT_REGION_ATTR = "data-print-region";

/** Hides an element inside the print region (control rows, buttons). */
export const NO_PRINT_CLASS = "report-no-print";

/** Keeps a dashboard block from being split across PDF pages. */
export const PRINT_BLOCK_ATTR = "data-print-block";

/** Browsers suggest `document.title` as the PDF filename. */
export function printableTitle(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, " ");
  return cleaned === "" ? "relatorio" : cleaned;
}

/** Swap the tab title for the report's name while the print dialog is up. */
function printWithTitle(title: string): void {
  if (typeof window === "undefined") return;
  const previous = document.title;
  document.title = printableTitle(title);
  try {
    window.print();
  } finally {
    document.title = previous;
  }
}

/**
 * The print-only rules, mounted once per viewer page: only the print region
 * is visible, positioned at the page origin; `NO_PRINT_CLASS` elements
 * disappear; blocks don't split across pages.
 */
export function PrintStyles(): JSX.Element {
  return (
    <style>{`
@media print {
  body * { visibility: hidden; }
  [${PRINT_REGION_ATTR}], [${PRINT_REGION_ATTR}] * { visibility: visible; }
  [${PRINT_REGION_ATTR}] { position: absolute; left: 0; top: 0; width: 100%; }
  .${NO_PRINT_CLASS} { display: none !important; }
  [${PRINT_BLOCK_ATTR}] { break-inside: avoid; }
}
`}</style>
  );
}

/** Tray-with-an-arrow — `prototype.html` marks every export with this glyph. */
function DownloadIcon(): JSX.Element {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </svg>
  );
}

export function PrintExportButton({
  title,
  label = "Exportar PDF",
  dataTestId = "report-export-pdf",
}: {
  title: string;
  /**
   * Defaults to the long form the built-in report screens have always shown.
   * The saved-report page passes the prototype's shorter `Exportar`, where the
   * button sits in a right-hand cluster of three and the extra word only
   * competes with the primary action beside it.
   */
  label?: string;
  dataTestId?: string;
}): JSX.Element {
  return (
    <Button
      variant="outline"
      size="sm"
      icon={<DownloadIcon />}
      onClick={() => printWithTitle(title)}
      data-testid={dataTestId}
    >
      {label}
    </Button>
  );
}
