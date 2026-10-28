import { Box } from "@mui/material";
import { Suspense, createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useCheckoutCopy } from "../copy-context";
import { useCheckoutComponents } from "../ui";

import { PartBoundary } from "./lazy-body";
import type { ColumnBodyProps } from "./summary-column-body";

/**
 * What the phone's "Resumo do pedido" sheet draws (FUT-589): the same body the
 * computer's column loads — lines, the host's money rows, "Total", the credit
 * rows — handed down by the layout. `null` where there is no sheet: a
 * computer, a host laying out its own column, the Pix screen and the hand-off
 * (which are not inside the layout).
 */
const SheetBody = createContext<{ body: ColumnBodyProps; Body: (props: ColumnBodyProps) => JSX.Element; forget: () => void } | null>(null);

export const SummarySheetProvider = SheetBody.Provider;

/** True under the sheet's body: what the host's money rows read to leave their controls out. */
const InSheet = createContext(false);

/**
 * Whether this render is inside the phone's "Resumo do pedido" sheet (FUT-589).
 * The sheet draws the host's money rows (`CheckoutCartView.discountLines`) READ-ONLY:
 * the saldo and the note are asked on the page and in the bar, never a second
 * time over them, so a host whose rows carry a control leaves it out here — the
 * same thing it does inside its own computer column.
 */
export function useInSummarySheet(): boolean {
  return useContext(InSheet);
}

/** The gap between the sheet's edge and the bar's first line. */
const SHEET_GAP_PX = 8;

/** What stays of the steps above the sheet at its tallest, so the page under it still shows. */
const STEPS_PEEK_PX = 64;

/**
 * The height from the toggle's top to the bottom of the screen: where the sheet
 * stops. Re-measured while it is open whenever the bar changes height (the payer
 * line, the saldo, a reason under the button), so the sheet stays on the bar.
 */
function useRoomBelow(anchor: React.RefObject<HTMLElement | null>, open: boolean): Room {
  const [room, setRoom] = useState<Room>({ below: 0, left: 0, width: null });
  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const line = anchor.current?.getBoundingClientRect();
      const top = line?.top ?? window.innerHeight;
      // The sheet's content takes the bar's own column: on a tablet the bar's content is a
      // centred column, and a sheet spread over the whole width would not line up with it.
      setRoom({ below: Math.max(0, window.innerHeight - top + SHEET_GAP_PX), left: line?.left ?? 0, width: line && line.width > 0 ? line.width : null });
    };
    measure();
    window.addEventListener("resize", measure);
    const bar = anchor.current?.parentElement ?? null;
    const observer = bar && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (bar) observer?.observe(bar);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [anchor, open]);
  return room;
}

/** Where the sheet sits: its bottom above the bar, and its content in the bar's column. */
interface Room {
  below: number;
  left: number;
  /** The bar line's width; `null` before it is measured, when the content takes the sheet's own width. */
  width: number | null;
}

/** Escape closes the sheet; a listener only while it is open. */
function useEscape(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);
}

/** The chevron beside "Ver resumo": up while the sheet is closed, down while it is open. */
function Chevron({ open }: { open: boolean }): JSX.Element {
  return (
    <Box component="svg" aria-hidden viewBox="0 0 24 24" sx={{ width: 18, height: 18, flex: "none", transition: "transform 150ms", transform: open ? "rotate(180deg)" : "none" }}>
      <path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </Box>
  );
}

/** The sheet itself: a scrim over the steps, and the summary above the bar. */
function Sheet({ id, room, onClose, children }: { id: string; room: Room; onClose: () => void; children: ReactNode }): JSX.Element {
  const { below } = room;
  const column = room.width === null ? { px: 2 } : { ml: `${room.left}px`, width: `${room.width}px`, maxWidth: "100%" };
  const { Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.layout;
  const headingRef = useRef<HTMLDivElement | null>(null);
  const headingId = `${id}-title`;
  // The focus lands on the heading: the sheet is read, not filled in, and the bar under it stays usable.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return createPortal(
    <>
      <Box
        aria-hidden
        onClick={onClose}
        data-testid="list-summary-scrim"
        sx={{ position: "fixed", top: 0, left: 0, right: 0, bottom: `${below}px`, zIndex: (t) => t.zIndex.modal, bgcolor: "rgba(0,0,0,0.35)", cursor: "pointer" }}
      />
      {/* A non-modal dialog: no focus trap, because the bar below it (the pay button) stays usable. */}
      <Box
        id={id}
        role="dialog"
        aria-modal={false}
        aria-labelledby={headingId}
        data-testid="list-summary-sheet"
        sx={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: `${below}px`,
          zIndex: (t) => t.zIndex.modal + 1,
          maxHeight: `calc(100dvh - ${below + STEPS_PEEK_PX}px)`,
          overflowY: "auto",
          bgcolor: "background.paper",
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          boxShadow: 8,
          pt: 2,
          pb: 1.75,
        }}
      >
        <Box sx={{ ...column, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 1.75 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1 }}>
            <Box ref={headingRef} id={headingId} tabIndex={-1} sx={{ outline: "none" }}>
              <Text variant="heading" size="md" weight="bold" as="h2" style={{ margin: 0 }}>
                {copy.summaryTitle}
              </Text>
            </Box>
            <Box
              component="button"
              type="button"
              aria-label={copy.summaryClose}
              onClick={onClose}
              data-testid="list-summary-close"
              sx={{ width: 40, height: 40, m: -1, mr: -1, flex: "none", border: 0, p: 0, bgcolor: "transparent", color: "text.secondary", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 2, "&:focus-visible": { outline: 2, outlineColor: "primary.main" } }}
            >
              <Box component="svg" aria-hidden viewBox="0 0 24 24" sx={{ width: 20, height: 20 }}>
                <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
              </Box>
            </Box>
          </Box>
          {children}
        </Box>
      </Box>
    </>,
    document.body,
  );
}

/**
 * The bar's first line on a phone, when the layout has a summary to show
 * (FUT-589, option B): the host's line on the left, "Ver resumo" and a chevron
 * on the right, the whole line one button that opens the sheet above the bar.
 * The bar stays where it is and keeps working under the sheet — choosing a row
 * and paying do not need the sheet closed. The sheet's body is the column's
 * own chunk, fetched the first time it opens. Escape, the scrim, the ✕ and
 * the line itself close it, and the focus goes back to the line.
 *
 * Without a summary to show (no layout above — the Pix screen, the hand-off —
 * or a layout with nothing in it) the host's line is drawn as before. `held`
 * closes an open sheet and keeps it closed: the card's 5-second bar has
 * started, and what is on screen is that bar, not the summary.
 */
export function SummaryToggleLine({ summary, testId, held = false }: { summary: ReactNode; testId: string; held?: boolean }): JSX.Element {
  const sheet = useContext(SheetBody);
  const copy = useCheckoutCopy().screens.layout;
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  const room = useRoomBelow(toggle, open && !held);
  const close = useCallback(() => {
    setOpen(false);
    toggle.current?.focus();
  }, []);
  useEscape(open && !held, close);
  useEffect(() => {
    if (held) setOpen(false);
  }, [held]);
  if (!sheet) return <Box data-testid={testId} sx={{ "&:empty": { display: "none" } }}>{summary}</Box>;
  const { Body, body, forget } = sheet;
  return (
    <>
      <Box
        component="button"
        type="button"
        ref={toggle}
        aria-expanded={open && !held}
        aria-controls={open && !held ? id : undefined}
        disabled={held}
        onClick={() => (open ? close() : setOpen(true))}
        data-testid="list-summary-toggle"
        sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, width: "100%", minHeight: 40, my: -0.75, p: 0, border: 0, bgcolor: "transparent", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer", borderRadius: 1, "&:focus-visible": { outline: 2, outlineColor: "primary.main", outlineOffset: 2 } }}
      >
        <Box component="span" data-testid={testId} sx={{ minWidth: 0 }}>{summary}</Box>
        <Box component="span" sx={{ display: "flex", alignItems: "center", gap: 0.5, flex: "none", color: "primary.main", fontWeight: 600, typography: "body2", whiteSpace: "nowrap" }}>
          {copy.summaryOpen}
          <Chevron open={open} />
        </Box>
      </Box>
      {open && !held ? (
        <Sheet id={id} room={room} onClose={close}>
          <PartBoundary fallback={null} retry={forget}>
            <Suspense fallback={<Box data-testid="list-summary-loading" sx={{ minHeight: 48 }} />}>
              <InSheet.Provider value>
                <Body {...body} />
              </InSheet.Provider>
            </Suspense>
          </PartBoundary>
        </Sheet>
      ) : null}
    </>
  );
}
