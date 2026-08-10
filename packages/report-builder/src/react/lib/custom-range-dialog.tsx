/**
 * "Personalizado…" — the two dates a custom period IS (FUT-755).
 *
 * The API has accepted `preset=custom&from=…&to=…` since the period rules moved
 * into this package; what was missing was any way to SAY it from the screen. So
 * this invents no server contract — it is the affordance over one that already
 * validates the pair (`wire.ts`: both bounds required, `from <= to`, at most
 * {@link REPORT_MAX_RANGE_DAYS} days).
 *
 * It is MODAL, unlike the block configuration panel that is docked beside the
 * canvas on purpose. The difference is what is being decided: a block's
 * configuration is adjusted WHILE watching the block change, so a backdrop
 * would hide the only feedback there is. A period is two dates chosen once and
 * applied — nothing on the page updates while you pick, and there is nothing to
 * read underneath. `report-settings-dialog` is modal for the same reason.
 *
 * `Calendar` in range mode is the design system's own range input
 * (`@12-apps/ui/form/Calendar`, `selectionMode="range"`), so the hover preview,
 * the keyboard grid and the backwards selection all come with it rather than
 * being re-invented here.
 */
import { useEffect, useState, type JSX } from "react";

import { Modal, ModalContent } from "@12-apps/ui/feedback/Modal";
import { Button } from "@12-apps/ui/form/Button";
import { Calendar, type DateRange } from "@12-apps/ui/form/Calendar";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import { REPORT_MAX_RANGE_DAYS } from "../../server/range";

/** A custom period, as two INCLUSIVE calendar days on the tenant's clock. */
export interface CustomRangeWindow {
  /** `AAAA-MM-DD`, inclusive. */
  from: string;
  /** `AAAA-MM-DD`, inclusive. */
  to: string;
}

/**
 * `AAAA-MM-DD` → a LOCAL `Date`, which is the only kind `Calendar` deals in.
 *
 * Deliberately not `new Date(day)` / `Date.parse(day)`: the spec reads a bare
 * `AAAA-MM-DD` as UTC midnight, so in São Paulo it lands at 21:00 on the day
 * BEFORE and every date in the picker is off by one. Passing the three parts
 * separately builds local midnight, which round-trips exactly through
 * {@link toDayString}.
 */
function toLocalDate(day: string): Date | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!parts) return null;
  const date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A LOCAL `Date` → `AAAA-MM-DD`, read off the same local getters. */
function toDayString(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The seed window as `Calendar`'s own value, or an empty range when unusable. */
function seedRange(seed: CustomRangeWindow | null): DateRange {
  if (!seed) return { start: null, end: null };
  return { start: toLocalDate(seed.from), end: toLocalDate(seed.to) };
}

/** What is picked so far, in words — the sentence the Aplicar button acts on. */
function draftLabel(draft: DateRange): string {
  const day = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  if (!draft.start) return "Escolha a data inicial.";
  if (!draft.end) return `${day.format(draft.start)} – escolha a data final.`;
  return `${day.format(draft.start)} – ${day.format(draft.end)}`;
}

/** The picked window, or null while only one end has been chosen. */
function draftWindow(draft: DateRange): CustomRangeWindow | null {
  if (!draft.start || !draft.end) return null;
  return { from: toDayString(draft.start), to: toDayString(draft.end) };
}

/**
 * Cancel and confirm. Its own component so the dialog stays a body: `Aplicar`
 * carries the one rule worth reading twice — half a range is not a period.
 */
function PickerFooter({
  picked,
  onApply,
  onClose,
  dataTestId,
}: {
  /** The window so far, or null while only one end has been chosen. */
  picked: CustomRangeWindow | null;
  onApply: (window: CustomRangeWindow) => void;
  onClose: () => void;
  dataTestId: string;
}): JSX.Element {
  return (
    <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
      <Button variant="outline" size="sm" onClick={onClose} dataTestId={`${dataTestId}-cancel`}>
        Cancelar
      </Button>
      <Button
        variant="solid"
        size="sm"
        // Disabled rather than hidden, so the way out of the dialog does not
        // move under the pointer as the reader picks.
        disabled={picked === null}
        onClick={() => {
          if (picked) onApply(picked);
        }}
        dataTestId={`${dataTestId}-apply`}
      >
        Aplicar
      </Button>
    </Stack>
  );
}

export function CustomRangeDialog({
  open,
  seed,
  onApply,
  onClose,
  dataTestId,
}: {
  open: boolean;
  /**
   * The window the picker OPENS on: the applied custom range, or the window the
   * report is already showing. Not a blank calendar — choosing "Personalizado…"
   * while reading 30 dias means adjusting those thirty days, and a picker that
   * starts at nothing makes the reader page back to find them again.
   */
  seed: CustomRangeWindow | null;
  onApply: (window: CustomRangeWindow) => void;
  onClose: () => void;
  dataTestId: string;
}): JSX.Element {
  const [draft, setDraft] = useState<DateRange>(() => seedRange(seed));

  // Re-seed on every OPEN, not on every render: the draft is scratch state, and
  // a cancelled pick must not be what the next open starts from.
  useEffect(() => {
    if (open) setDraft(seedRange(seed));
  }, [open, seed]);

  return (
    <Modal open={open} onClose={onClose} size="lg" dataTestId={dataTestId}>
      <ModalContent dataTestId={`${dataTestId}-content`}>
        <Stack spacing={2}>
          <Text variant="heading" size="lg" weight="semibold" as="h2">
            Período personalizado
          </Text>
          {/*
            TWO months, side by side. A range that crosses a month boundary is
            the normal case here — "the last three weeks", "since the 28th" —
            and with one month visible the reader has to page forward, losing
            sight of the end they just picked. `Calendar` already defaults to 2
            in range mode; this dialog was overriding it back down to 1, which
            is why it rendered as a single month.

            The modal grows with it. At a width where two months genuinely do
            not fit, the calendar scrolls sideways inside this box rather than
            the page scrolling or the grid collapsing.
          */}
          <Box sx={{ display: "flex", justifyContent: "center", overflowX: "auto" }}>
            <Calendar
              selectionMode="range"
              locale="pt-BR"
              range={draft}
              // BOTH callbacks, and `onIntermediateRangeChange` is the one that
              // does the work: `onRangeChange` fires only on the click that
              // CLOSES a range, so a picker wired to it alone would not repaint
              // after the first click and the reader would see nothing happen.
              onIntermediateRangeChange={setDraft}
              onRangeChange={setDraft}
              // The server's own ceiling, so an over-long window is refused by
              // the control that offers it rather than by a 400 the reader
              // meets as "não foi possível carregar o relatório".
              maxRangeLength={REPORT_MAX_RANGE_DAYS}
            />
          </Box>
          <Text variant="body" size="sm" color="secondary" data-testid={`${dataTestId}-summary`}>
            {draftLabel(draft)}
          </Text>
          <PickerFooter
            picked={draftWindow(draft)}
            onApply={onApply}
            onClose={onClose}
            dataTestId={dataTestId}
          />
        </Stack>
      </ModalContent>
    </Modal>
  );
}
