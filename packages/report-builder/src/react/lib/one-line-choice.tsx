/**
 * One question's options, on ONE line (FUT-4063): the segmented toggle while its
 * options fit the row whole, and a select the moment they would not — never a
 * label broken onto a second line, never a second row of options.
 *
 * The choice is drawn NEUTRAL (`selection="quiet"`): a period or a grouping is
 * a selection, not an alert, and a host whose primary is red would otherwise
 * paint the chosen period as a fault.
 *
 * How it knows: the toggle is laid out unbroken (`nowrap`) inside a wrapper
 * that may not grow past its row. When the toggle is wider than the wrapper it
 * would have wrapped, so the select takes its place, and the toggle's natural
 * width is remembered: the toggle returns once the row is that wide again. A
 * layout effect measures before paint, so no frame shows the broken toggle.
 * With no layout at all (a test DOM, a print pass) the toggle stays.
 */
import { useLayoutEffect, useRef, useState, type JSX, type RefObject, type SyntheticEvent } from "react";

import { Select } from "@12-apps/ui/form/Select";
import { ToggleGroup } from "@12-apps/ui/form/ToggleGroup";
import { Box } from "@12-apps/ui/mui/Box";

interface OneLineChoiceProps<T extends string> {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  /** The question's name: the toggle's `aria-label`, the select's visible label. */
  label: string;
  dataTestId: string;
  /** Always the select (a host-labelled period, FUT-4063). */
  select?: boolean;
  /**
   * The option already chosen was picked again — on the toggle (which reports
   * it as `null`) or in the select (which reports no change). Absent: a no-op.
   * The custom period uses it to re-open its picker.
   */
  onReselect?: (value: T) => void;
  /** The toggle's own frame (the custom report's segmented look). */
  toggleSx?: Record<string, unknown>;
}

/** Whether the toggle fits: unknown widths (no layout) count as fitting. */
function toggleFits(needed: number, available: number): boolean {
  return needed <= 0 || available <= 0 || needed <= available + 0.5;
}

/**
 * The control that stands in for the one just swapped out: the select's
 * combobox, or the toggle's chosen button (else its first).
 */
function swappedControl(wrapper: HTMLElement): HTMLElement | null {
  for (const selector of ['[role="combobox"]', 'button[aria-pressed="true"]', "button"]) {
    const found = wrapper.querySelector<HTMLElement>(selector);
    if (found) return found;
  }
  return null;
}

function useFitsOneLine(): {
  wrapperRef: RefObject<HTMLDivElement | null>;
  toggleRef: RefObject<HTMLDivElement | null>;
  fits: boolean;
} {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLDivElement | null>(null);
  const needed = useRef(0);
  // Whether the control held focus when a resize swapped it (N2): the new one
  // takes it, so a reader on the keyboard is not dropped onto the page.
  const hadFocus = useRef(false);
  const [fits, setFits] = useState(true);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !hadFocus.current) return;
    hadFocus.current = false;
    swappedControl(wrapper)?.focus();
  }, [fits]);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return undefined;
    const measure = (): void => {
      const toggle = toggleRef.current;
      if (toggle) needed.current = toggle.scrollWidth;
      const next = toggleFits(needed.current, wrapper.clientWidth);
      if (next !== fits) hadFocus.current = wrapper.contains(document.activeElement);
      setFits(next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [fits]);

  return { wrapperRef, toggleRef, fits };
}

/**
 * The wrapper's room: a host-labelled select keeps the width it always had; a
 * select that stands in for a toggle takes its whole row (so the toggle comes
 * back once that row could hold it); a toggle may not grow past its row.
 */
function choiceSx(forced: boolean, asSelect: boolean) {
  if (forced) return { minWidth: 0, flex: { xs: "1 1 100%", md: "0 1 auto" } };
  if (asSelect) return { minWidth: 0, flex: "1 1 100%" };
  return { minWidth: 0, maxWidth: "100%", flex: "0 1 auto" };
}

/**
 * Whether a select's close came from picking an option (a click, or Enter or
 * Space on it) — and which. Escape, Tab and a click outside close it too, and
 * pick nothing.
 */
function pickedOnClose(event: SyntheticEvent): string | null {
  const key = "key" in event ? (event as { key?: string }).key : undefined;
  const picked = event.type === "click" || key === "Enter" || key === " ";
  if (!picked) return null;
  const target = event.target instanceof Element ? event.target.closest("[data-value]") : null;
  return target?.getAttribute("data-value") ?? null;
}

export function OneLineChoice<T extends string>({
  options,
  value,
  onChange,
  label,
  dataTestId,
  select = false,
  onReselect,
  toggleSx,
}: OneLineChoiceProps<T>): JSX.Element {
  const { wrapperRef, toggleRef, fits } = useFitsOneLine();
  const asSelect = select || !fits;
  return (
    <Box
      ref={wrapperRef}
      data-choice={asSelect ? "select" : "toggle"}
      sx={choiceSx(select, asSelect)}
    >
      {asSelect ? (
        <Select
          size="sm"
          label={label}
          options={options}
          value={value}
          onChange={(event) => onChange(event.target.value as T)}
          // A select reports no change when the chosen option is picked again.
          onClose={(event) => {
            if (onReselect && pickedOnClose(event) === value) onReselect(value);
          }}
          data-testid={dataTestId}
        />
      ) : (
        <ToggleGroup
          ref={toggleRef}
          variant="exclusive"
          selection="quiet"
          size="sm"
          options={options}
          value={value}
          onChange={(_event, next) => {
            // An exclusive toggle reports `null` when the chosen option is clicked again.
            if (next === null) onReselect?.(value);
            else if (typeof next === "string") onChange(next as T);
          }}
          aria-label={label}
          dataTestId={dataTestId}
          sx={{
            ...toggleSx,
            flexWrap: "nowrap",
            "& .MuiToggleButton-root": { whiteSpace: "nowrap", flexShrink: 0 },
          }}
        />
      )}
    </Box>
  );
}
