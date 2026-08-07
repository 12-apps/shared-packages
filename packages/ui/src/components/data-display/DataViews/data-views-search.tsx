"use client";

/**
 * THE INLINE BAR'S SEARCH — the one control on the toolbar that cannot be
 * guessed from an icon's position, which is why it is the LAST thing the
 * degradation ladder takes away. See `data-views-overflow.ts`.
 */
import CloseIcon from "@mui/icons-material/Close";
import SearchIcon from "@mui/icons-material/Search";
import { IconButton, InputAdornment, TextField } from "@mui/material";
import { useEffect, useRef, useState } from "react";

import { Box } from "../../../mui/Box";

/** How long the box waits after the last keystroke before it queries. */
const SEARCH_DEBOUNCE_MS = 350;

/**
 * How wide the keyword box is allowed to be.
 *
 * The 200px floor is right while the box shares the row: a search you cannot
 * read six characters in is not a search. It is WRONG once the box has been
 * expanded out of its collapsed state on a narrow screen, where the cluster was
 * sized for a magnifier — the floor cannot be met there, so the row scrolled
 * sideways instead (154px of overhang at 320px). In that mode the box shrinks,
 * and if what is left would still be unreadable the bar hands it the whole
 * cluster instead (`searchTakeover`).
 */
function boxWidth(fill: boolean): { flex: number; minWidth: number; maxWidth: number | "none" } {
  return { flex: 1, minWidth: fill ? 0 : 200, maxWidth: fill ? "none" : 384 };
}

/**
 * The bar's keyword box.
 *
 * DEBOUNCED rather than committed on Enter/blur. In server mode every commit is
 * a round trip, and a box that only fires on blur makes the operator press a
 * key they were not told about to see any result at all — they type, nothing
 * happens, and the list looks broken. 350ms is long enough that a word costs
 * one query, short enough to feel like live search.
 *
 * `Escape` clears; the X clears without leaving the box. Both exist because
 * clearing by selecting-and-deleting is three gestures for the most common
 * thing anyone does to a search box.
 */
export function InlineKeyword({
  value,
  onChange,
  testId,
  autoFocus,
  onEscape,
  fill = false,
}: {
  value: string;
  onChange: (value: string) => void;
  testId?: string;
  autoFocus?: boolean;
  /** Called on Escape with the box already empty — the collapsed bar closes it. */
  onEscape?: () => void;
  /** Take whatever width there is, with no minimum — see {@link boxWidth}. */
  fill?: boolean;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const prev = useRef(value);
  // An external change (a saved view, the URL, "Limpar") wins over the draft.
  if (prev.current !== value) {
    prev.current = value;
    if (draft !== value) setDraft(value);
  }
  useEffect(() => {
    if (draft === value) return undefined;
    const timer = setTimeout(() => onChange(draft), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, value, onChange]);

  return (
    <TextField
      size="small"
      value={draft}
      autoFocus={autoFocus}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          if (draft === "") onEscape?.();
          setDraft("");
          return;
        }
        // Enter still commits IMMEDIATELY, ahead of the debounce — someone who
        // presses it has decided, and waiting out the timer reads as a stall.
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (draft !== value) onChange(draft);
      }}
      placeholder="Buscar…"
      inputProps={{ "aria-label": "Buscar em todas as colunas", "data-testid": testId }}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon sx={{ fontSize: 16, color: "text.secondary" }} />
          </InputAdornment>
        ),
        endAdornment: draft ? (
          <InputAdornment position="end">
            <IconButton
              size="small"
              aria-label="Limpar busca"
              data-testid={testId ? `${testId}-clear` : undefined}
              onClick={() => setDraft("")}
              sx={{ p: 0.25 }}
            >
              <CloseIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </InputAdornment>
        ) : undefined,
      }}
      // Takes the free space and gives it up first — step 3 of the ladder,
      // which needs no flag because flex does it (see `computeSplit`).
      sx={boxWidth(fill)}
    />
  );
}

/**
 * Step 4 of the ladder: the search as a magnifier.
 *
 * Carries a dot when a search is APPLIED. Collapsing a control that is
 * currently filtering the list, with nothing saying so, is how an operator ends
 * up staring at 3 rows of 214 and reading it as missing data.
 */
export function CollapsedSearch({
  active,
  onOpen,
  testId,
}: {
  active: boolean;
  onOpen: () => void;
  testId?: string;
}): React.JSX.Element {
  return (
    <IconButton
      size="small"
      onClick={onOpen}
      aria-label="Buscar"
      aria-expanded={false}
      data-testid={testId ? `${testId}-collapsed` : undefined}
      sx={{
        position: "relative",
        border: 1,
        borderRadius: 1,
        borderColor: active ? "primary.main" : "divider",
        color: active ? "primary.main" : "text.secondary",
        bgcolor: active ? "action.selected" : "background.paper",
      }}
    >
      <SearchIcon sx={{ fontSize: 18 }} />
      {active && (
        <Box
          component="span"
          sx={{
            position: "absolute",
            top: 2,
            right: 2,
            width: 6,
            height: 6,
            borderRadius: "50%",
            bgcolor: "primary.main",
          }}
        />
      )}
    </IconButton>
  );
}

