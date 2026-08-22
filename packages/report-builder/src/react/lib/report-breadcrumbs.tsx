/**
 * Where you are in the reports area — one line, on its own, above the report.
 *
 * What it replaces: two ad-hoc back links that each named their DESTINATION
 * rather than the place you were in. `← Relatórios` on the view screen and
 * `← Sair da edição` in the editor were written by different hands, sat inline
 * beside the report's name where they competed with it for the first thing you
 * read, and between them they never said that the editor is a level BELOW the
 * report, which is below the list. A person two levels down could go back one
 * step and no further.
 *
 * A trail says all of it in one line: list → report → editing, with every
 * level above the current one reachable in a single click.
 *
 * The component is the design system's `Breadcrumbs` — a bespoke trail here
 * would be a second breadcrumb in the product, drifting from the first the
 * moment either is touched. This module is only the two things the reports
 * area adds to it: SPA navigation (the design system renders real `<a href>`s,
 * which is correct, and which a router-driven app has to intercept), and a
 * caller's chance to say "not yet" — the editor's unsaved-changes prompt.
 */
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";

import { Box } from "@12-apps/ui/mui/Box";
import { Breadcrumbs } from "@12-apps/ui/navigation/Breadcrumbs";

import { NO_PRINT_CLASS } from "./print-export";
import { useReportCopy } from "../transport-context";

/** One level of the trail. */
export interface ReportCrumb {
  label: string;
  /**
   * Where this level lives. Absent on the LAST crumb — the page you are
   * already on, which the design system renders as text rather than a link.
   */
  href?: string;
  /**
   * This crumb's test id, when it takes over from an affordance that had one.
   * Positional ids cannot do that job: the trail grows an "Editando" step and
   * every index below it moves.
   */
  dataTestId?: string;
  /**
   * Run instead of navigating to `href`. For a screen that was handed a `back`
   * callback and should keep using it — the href stays for the link's own
   * semantics (middle-click, copy address), the callback does the moving.
   */
  onSelect?: () => void;
}

/** The design system's own crumb padding — `theme.spacing(0.5, 0.75)`. */
const CRUMB_PAD_X = "6px";

const CRUMBS_SX = {
  minWidth: 0,
  /*
   * Two insets to cancel, so the trail's first word lands on the same vertical
   * line as the report name under it — a trail floating 22px to the right of
   * the title it belongs to reads as a stray control rather than as this
   * page's address.
   *
   * The bar's own horizontal padding exists for the `glass` / `elevated` /
   * `outlined` variants, which paint a GROUND that would otherwise touch the
   * words. `default` paints nothing, so here that padding is pure indent.
   */
  "& .MuiBreadcrumbs-root": { px: 0 },
  /*
   * And the FIRST crumb's own padding, which earns its place — it is what
   * makes the hover state a box around the label rather than a box against it.
   * Cancelled on that crumb alone, so the box overhangs to the left and the
   * word itself lands on the column: exactly what the editable title does with
   * its own padding one line below.
   */
  "& .MuiBreadcrumbs-ol > li:first-of-type": { ml: `-${CRUMB_PAD_X}` },
} as const;

export function ReportBreadcrumbs({
  crumbs,
  dataTestId,
  onBeforeNavigate,
}: {
  crumbs: ReportCrumb[];
  dataTestId?: string;
  /**
   * Asked before leaving, with the href being left for. Return `false` to
   * cancel — the caller then owns saying why. Omitted, every crumb navigates
   * immediately, which is what a screen with nothing to warn about should get
   * for free.
   */
  onBeforeNavigate?: (href: string) => boolean;
}): JSX.Element {
  const copy = useReportCopy().screens.builder;
  const navigate = useNavigate();

  const items = crumbs.map((crumb) => {
    const { href } = crumb;
    return {
      label: crumb.label,
      ...(href ? { href } : {}),
      ...(crumb.dataTestId ? { dataTestId: crumb.dataTestId } : {}),
      ...(href
        ? {
            onClick: (event: { preventDefault: () => void }): void => {
              event.preventDefault();
              if (onBeforeNavigate && !onBeforeNavigate(href)) return;
              if (crumb.onSelect) crumb.onSelect();
              else void navigate(href);
            },
          }
        : {}),
    };
  });

  return (
    // The trail is metadata about the page, not part of the report, so it does
    // not print: `print-export` renders the report region alone, and this would
    // come out as a stray line of navigation above it.
    <Box className={NO_PRINT_CLASS} sx={CRUMBS_SX}>
      <Breadcrumbs
        items={items}
        size="sm"
        // No house glyph: the first level here is "Relatórios", a section of
        // the backoffice and not the product's home, and a home icon would
        // claim otherwise.
        showHomeIcon={false}
        separatorType="chevron"
        ariaLabel={copy.breadcrumbAria}
        {...(dataTestId ? { dataTestId } : {})}
      />
    </Box>
  );
}
