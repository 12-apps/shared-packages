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
 * WHAT IS HERE AND WHAT IS NOT: the picking is `DateRangePicker`
 * (`@12-apps/ui/form/DateRangePicker`) — calendar, quick ranges and the two
 * typed `dd/mm/aaaa` fields, all three over one range. This file supplies only
 * what the design system must not know: the tenant's clock, the server's
 * ceiling, the Portuguese copy, and the window the picker opens on. It reads
 * back a range; deciding how the reports surface EXPRESSES that range (a
 * rolling preset, or a custom window) belongs to `range-toggle.tsx`.
 */
import { useEffect, useRef, useState, type JSX } from "react";

import { Modal, ModalContent } from "@12-apps/ui/feedback/Modal";
import { Button } from "@12-apps/ui/form/Button";
import {
  createQuickRanges,
  DateRangePicker,
  resolveDayRange,
  type DateRangeChangeMeta,
  type DateRangeDraft,
  type DateRangePickerMessages,
  type QuickRange,
} from "@12-apps/ui/form/DateRangePicker";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import { REPORT_MAX_RANGE_DAYS } from "../../server/range";
import { DEFAULT_REPORT_TIME_ZONE } from "../../time";

/** A custom period, as two INCLUSIVE calendar days on the tenant's clock. */
export interface CustomRangeWindow {
  /** `AAAA-MM-DD`, inclusive. */
  from: string;
  /** `AAAA-MM-DD`, inclusive. */
  to: string;
}

/**
 * The quick column, in the reader's words.
 *
 * Four of these are deliberately word-for-word the period pills
 * (`REPORT_RANGE_LABELS`): choosing `Hoje` here has to mean the same thing as
 * choosing `Hoje` out there, and the picker reports WHICH entry was chosen so
 * the caller can apply the real preset rather than an identical-looking custom
 * window. The other five are periods the toggle does not offer at all, which is
 * most of the reason this column exists.
 */
const QUICK_RANGES: QuickRange[] = createQuickRanges({
  today: "Hoje",
  yesterday: "Ontem",
  "this-week": "Esta semana",
  "last-7-days": "7 dias",
  "this-month": "Este mês",
  "last-30-days": "30 dias",
  "this-quarter": "Este trimestre",
  "this-year": "Este ano",
  "last-365-days": "365 dias",
});

/**
 * The refusals, in the SAME words the server uses (`server/range.ts`).
 *
 * A window this refuses is one the server would refuse too, so a reader who
 * ignores the message and one who reaches the API by hand read the same
 * sentence — rather than one of them meeting it as "não foi possível carregar
 * o relatório".
 */
const MESSAGES: Partial<DateRangePickerMessages> = {
  from: "Data inicial",
  to: "Data final",
  quickRanges: "Períodos rápidos",
  incomplete: "Informe as datas inicial e final do período.",
  reversed: "A data final deve ser igual ou posterior à inicial.",
  overMax: ({ maxRangeDays }) => `O período não pode exceder ${maxRangeDays} dias.`,
};

/** The seed as the picker's own value; an empty draft when there is none. */
function seedDraft(seed: CustomRangeWindow | null): DateRangeDraft {
  return seed ? { from: seed.from, to: seed.to } : { from: null, to: null };
}

/**
 * Cancel and confirm. Its own component so the dialog stays a body: `Aplicar`
 * carries the one rule worth reading twice — half a range is not a period, and
 * neither is a reversed or over-long one.
 */
function PickerFooter({
  picked,
  quickRangeId,
  onApply,
  onClose,
  dataTestId,
}: {
  /** The window so far, or null while it is not one the server would accept. */
  picked: CustomRangeWindow | null;
  /** Which quick entry produced it, when one did. */
  quickRangeId: string | undefined;
  onApply: (window: CustomRangeWindow, quickRangeId?: string) => void;
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
        // move under the pointer as the reader picks. The picker has already
        // said WHY it is disabled, in the line above these buttons.
        disabled={picked === null}
        onClick={() => {
          if (picked) onApply(picked, quickRangeId);
        }}
        dataTestId={`${dataTestId}-apply`}
      >
        Aplicar
      </Button>
    </Stack>
  );
}

/**
 * The draft the dialog is holding, and which quick entry last set it.
 *
 * Its own hook so the component below stays a body: the re-seeding rule is the
 * fiddly part and it is easier to read on its own.
 */
function usePickerDraft(
  open: boolean,
  seed: CustomRangeWindow | null,
): {
  draft: DateRangeDraft;
  quickRangeId: string | undefined;
  change: (next: DateRangeDraft, meta: DateRangeChangeMeta) => void;
} {
  const [draft, setDraft] = useState<DateRangeDraft>(() => seedDraft(seed));
  const [quickRangeId, setQuickRangeId] = useState<string | undefined>(undefined);
  const wasOpen = useRef(false);

  // Re-seed on the transition INTO open, not on every render while open: the
  // draft is scratch state, a cancelled pick must not be what the next open
  // starts from, and re-seeding on every render would throw away a half-picked
  // range each time the screen behind the dialog re-rendered.
  useEffect(() => {
    if (open && !wasOpen.current) {
      setDraft(seedDraft(seed));
      setQuickRangeId(undefined);
    }
    wasOpen.current = open;
  }, [open, seed]);

  return {
    draft,
    quickRangeId,
    change: (next, meta) => {
      setDraft(next);
      // Only a quick pick carries an id, and any later edit drops it: a window
      // that started as "Hoje" and had one end retyped is a custom window
      // again, whatever it happens to equal.
      setQuickRangeId(meta.source === "quick" ? meta.quickRangeId : undefined);
    },
  };
}

interface CustomRangeDialogProps {
  open: boolean;
  /**
   * The window the picker OPENS on: the applied custom range, or the window the
   * report is already showing. Not a blank calendar — choosing "Personalizado…"
   * while reading 30 dias means adjusting those thirty days, and a picker that
   * starts at nothing makes the reader page back to find them again.
   */
  seed: CustomRangeWindow | null;
  /** The chosen window, and the quick entry that produced it if one did. */
  onApply: (window: CustomRangeWindow, quickRangeId?: string) => void;
  onClose: () => void;
  dataTestId: string;
  /**
   * The clock "hoje" is read on. Defaults to the same zone the report engine
   * falls back to when neither the spec nor the host names one, so the picker
   * and the numbers it produces agree about which day it is.
   */
  timeZone?: string;
}

export function CustomRangeDialog({
  open,
  seed,
  onApply,
  onClose,
  dataTestId,
  timeZone = DEFAULT_REPORT_TIME_ZONE,
}: CustomRangeDialogProps): JSX.Element {
  const picker = usePickerDraft(open, seed);
  const status = resolveDayRange(picker.draft, REPORT_MAX_RANGE_DAYS);

  return (
    <Modal open={open} onClose={onClose} size="md" dataTestId={dataTestId}>
      <ModalContent dataTestId={`${dataTestId}-content`}>
        <Stack spacing={2}>
          <Text variant="heading" size="lg" weight="semibold" as="h2">
            Período personalizado
          </Text>
          <DateRangePicker
            value={picker.draft}
            onChange={picker.change}
            timeZone={timeZone}
            // The server's own ceiling, so an over-long window is refused by
            // the control that offers it rather than by a 400 the reader meets
            // as "não foi possível carregar o relatório".
            maxRangeDays={REPORT_MAX_RANGE_DAYS}
            locale="pt-BR"
            // TWO months, which is this component's own default in range mode
            // and what this dialog was asked for. A range crossing a month
            // boundary — "the last three weeks", "since the 28th" — is the
            // normal case here, and with one month visible the reader has to
            // page forward and loses sight of the end they just picked.
            //
            // It does mean two cells answer to `calendar-date-<day>`, because
            // `Calendar` numbers them by day of month. That is handled where it
            // belongs: the specs scope the day to `calendar-month-0`. Rendering
            // less than the control should to keep a selector short would be
            // the tail wagging the dog.
            numberOfMonths={2}
            quickRanges={QUICK_RANGES}
            messages={MESSAGES}
            dataTestId="report-range-picker"
          />
          <PickerFooter
            picked={status.ok ? status.window : null}
            quickRangeId={picker.quickRangeId}
            onApply={onApply}
            onClose={onClose}
            dataTestId={dataTestId}
          />
        </Stack>
      </ModalContent>
    </Modal>
  );
}
