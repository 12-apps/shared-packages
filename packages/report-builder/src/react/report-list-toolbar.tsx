/**
 * The report list's one control row (FUT-755) — `prototype.html`'s `.filters`.
 *
 * Search first, then the three scope pills, then the primary action pushed to
 * the far right. The old row interleaved them — two scope buttons, then the
 * search box, then "Novo relatório" — so the control that CREATES a report sat
 * in the same visual run as the controls that narrow the list, and neither
 * group read as a group.
 *
 * The pills are `aria-pressed` toggles rather than a `ToggleGroup`, matching
 * the prototype: they are three alternatives, but each is announced as its own
 * pressed/unpressed control, which is what a screen reader needs when the
 * "group" is really a filter with a current value.
 *
 * `inventory.md` §3.5 nominates `layout/ContentToolbar` for this row, and it
 * was tried: see the comment on the row below for the measurement that sent it
 * back. `layout/CardGrid` and `data-display/Chip`, the other two the inventory
 * asks for, are both in use on this screen.
 */
import type { JSX } from "react";

import { Button } from "@12-apps/ui/form/Button";
import { Input } from "@12-apps/ui/form/Input";
import { Box } from "@12-apps/ui/mui/Box";

import { CONTROL_HEIGHT_PX, CONTROL_ROW_SX } from "./lib/report-surface";
import { REPORT_SCOPE_LABELS, REPORT_SCOPES, type ReportScope } from "./report-list-filters";

/** Magnifier, inside the field on the left — the prototype's `.search svg`. */
function SearchIcon(): JSX.Element {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

/** The `+` on the primary action, at control scale rather than tile scale. */
function SmallPlusIcon(): JSX.Element {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ScopePills({
  scope,
  onScopeChange,
}: {
  scope: ReportScope;
  onScopeChange: (scope: ReportScope) => void;
}): JSX.Element {
  return (
    <>
      {REPORT_SCOPES.map((option) => (
        <Button
          key={option}
          variant={option === scope ? "solid" : "outline"}
          size="sm"
          aria-pressed={option === scope}
          onClick={() => onScopeChange(option)}
          // A pill, not a rounded rectangle: this is the one place the surface's
          // control radius is deliberately overridden, because "pill" is what
          // separates a filter from the buttons it sits beside.
          sx={{ borderRadius: "999px", flexShrink: 0 }}
          data-testid={`reports-scope-${option}`}
        >
          {REPORT_SCOPE_LABELS[option]}
        </Button>
      ))}
    </>
  );
}

export function ReportListToolbar({
  scope,
  search,
  onScopeChange,
  onSearchChange,
  onCreate,
}: {
  scope: ReportScope;
  search: string;
  onScopeChange: (scope: ReportScope) => void;
  onSearchChange: (search: string) => void;
  onCreate: () => void;
}): JSX.Element {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        // The row WRAPS, which is the whole reason it is not `ContentToolbar`.
        // That component is a selection toolbar first — it renders a Select All
        // cluster this screen has no use for, and its browsing row is pinned
        // `nowrap` with the filters in a horizontally-scrolling box. Measured
        // at 390px that put the search box on screen and the three scope pills
        // behind a sideways scroll, which is the one control on this toolbar a
        // phone must not have to hunt for.
        flexWrap: "wrap",
        rowGap: 1,
        ...CONTROL_ROW_SX,
      }}
    >
      <Box
        sx={{
          // A whole line to itself on a phone, a 200–340px field beside the
          // pills anywhere wider — `prototype.html`'s `.search` exactly.
          flex: { xs: "1 1 100%", sm: "1 1 200px" },
          minWidth: 0,
          maxWidth: { xs: "100%", sm: 340 },
        }}
      >
        <Input
          size="sm"
          fullWidth
          type="search"
          aria-label="Buscar relatório"
          placeholder="Buscar relatório"
          startAdornment={<SearchIcon />}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          data-testid="reports-search"
        />
      </Box>
      <ScopePills scope={scope} onScopeChange={onScopeChange} />
      {/* `ml: auto` is the prototype's `.spacer`: the primary action sits at
          the far edge on a shared line, and stays right-aligned on its own. */}
      <Button
        variant="solid"
        size="sm"
        icon={<SmallPlusIcon />}
        onClick={onCreate}
        sx={{ ml: "auto", height: `${CONTROL_HEIGHT_PX}px`, whiteSpace: "nowrap", flexShrink: 0 }}
        data-testid="reports-new"
      >
        Novo relatório
      </Button>
    </Box>
  );
}
