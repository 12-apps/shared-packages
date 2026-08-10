# DateRangePicker

Three views of ONE day range — a range calendar, a quick-pick column, and two
typed `dd/mm/aaaa` fields. Change any and the other two follow.

## Purpose

A range calendar alone makes "this quarter" cost two clicks, a month of paging
and a mental note of which day a quarter starts on. A list of presets alone
cannot express "the 3rd to the 19th". Typed fields alone make you spell out a
window you can already see. Each of the three is the fastest route to a
*different* range, so this control offers all three over one value instead of
picking a favourite.

It is a design-system control and knows nothing about the data behind the
range. The quick list, the maximum length and the clock "today" is read on are
all props — a consumer with its own periods passes them rather than teaching
this component about its domain.

## Not a fork of Calendar

The calendar half **is** [`Calendar`](../Calendar/Calendar.md) in
`selectionMode="range"`. The hover preview, the keyboard grid, backwards
selection and the length check all come from there. This component composes it;
it does not reimplement it.

The typed fields are `DayBoundInput`, the masked `dd/mm/aaaa` field the data
views already use — imported from inside the package rather than exported,
because a second masked date field would mean a second set of rules for what
backspace does.

## Public API

```ts
interface DateRangePickerProps {
  value: DateRangeDraft;                    // { from: string | null; to: string | null }
  onChange: (next: DateRangeDraft, meta: DateRangeChangeMeta) => void;
  timeZone?: string;                        // IANA zone (or offset) TODAY is read on
  now?: Date;                               // freeze the clock (stories, tests)
  maxRangeDays?: number;                    // longest usable range, inclusive days
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6; // default 0 (Sunday)
  quickRanges?: QuickRange[];               // default: the nine below; [] hides the column
  locale?: string;                          // month names / weekday initials
  numberOfMonths?: number;                  // default 2
  messages?: Partial<DateRangePickerMessages>;
  dataTestId?: string;                      // default 'date-range-picker'
  className?: string;
}
```

### The value is a DRAFT, not a window

`value` is `{ from, to }` with either end possibly `null`, and it accepts a pair
that is reversed or too long. A control whose value could only hold a legal
range has nowhere to put a reader who typed the end date first, and has to
either discard the keystrokes or lie about what is on screen.

Every `onChange` carries the verdict with it:

```ts
interface DateRangeChangeMeta {
  source: 'quick' | 'calendar' | 'from' | 'to';
  quickRangeId?: string;      // set only when source is 'quick'
  status: DateRangeStatus;    // { ok: true, window, days } | { ok: false, problem, days }
}
```

`resolveDayRange(draft, maxRangeDays)` is exported so a caller's confirm button
reads the SAME verdict rather than re-deriving "is this usable" from the two
strings and drifting from the message on screen.

`quickRangeId` is what lets a caller express a pick as its own thing. The
reports surface uses it to apply its real `today` preset when "Hoje" is chosen,
so the period afterwards reads `Hoje` and not `Personalizado…`.

## Quick ranges

Nine built-ins, all derivable from today and the calendar alone:

| id | window |
|---|---|
| `today` | today |
| `yesterday` | the day before today |
| `this-week` | the `weekStartsOn` day of this week → today |
| `last-7-days` | today and the 6 days before it |
| `this-month` | the 1st of this month → today |
| `last-30-days` | today and the 29 days before it |
| `this-quarter` | the 1st of this CALENDAR quarter (Jan/Apr/Jul/Oct) → today |
| `this-year` | 1 January → today |
| `last-365-days` | today and the 364 days before it |

"Last N days" **includes** today: on the 10th, "last 7 days" is the 4th through
the 10th. Quarters are calendar quarters; a fiscal quarter is a caller's own
`quickRanges` entry, not a variant of this one.

`createQuickRanges({ today: 'Hoje', … })` relabels the built-ins without
re-deriving their arithmetic — which is how two lists that claim the same thing
start disagreeing. `quickRanges` replaces the list wholesale; `[]` removes the
column.

## Time zone

Civil days are zone-free; **which day is today is not**. At 21:30 on 31 July in
São Paulo it is already 1 August in UTC, so "this month" resolved on the host's
clock can name a period the reader's store has not reached. `timeZone` is read
for exactly one thing — today — and every quick range hangs off it.

Absent, the host's own zone is used. That is right for a picker over the
reader's own data and wrong for one reporting on somewhere else.

## Maximum length

`maxRangeDays` is an inclusive day count and is enforced in three places at
once:

- a quick range longer than it is `aria-disabled`, keeps its place in the tab
  order, and renders the reason under its label;
- the calendar is given the same ceiling, so it cannot close a range over it;
- a typed pair over it is reported as `problem: 'over-max'` with the reason in
  the status line.

**Nothing is ever clamped.** Handing back eleven months for a control labelled
"This year" is worse than refusing: the reader gets a number for a period they
did not ask for and nothing on screen says so.

## When a typed date commits

The moment it is a **whole, real day** — eight digits naming a date that exists.

- Not on every keystroke: `2026` passes through `0002`, `0020` and `0202`, each
  a legal year, and committing those sends the calendar to the year 20 while the
  reader is still typing.
- Not only on blur: someone who types a date and looks at the calendar to check
  it would see the old month until they clicked somewhere else.
- Half-typed text stays in the field and changes nothing; leaving the field
  discards it and shows what the range actually is.
- Enter needs no special case — by the time it can be pressed, the date has
  already committed.

## Which month the calendar shows

`Calendar` reads its opening month from the range it is handed, and only when it
mounts. The picker remounts it when a **quick pick** or a **typed date** moves
the range, and never when a day inside the grid is clicked — a calendar that
jumped under the pointer picking in it would be unusable.

So the grid follows the range's **start**. Picking "This year" in August moves
it to January, because that is where the range now begins.

## Layout

Calendar first, quick column beside it (`md` and up), fields underneath. Below
`md` the quick entries wrap and stack under the calendar rather than taking a
column out of the day grid: at 390px a side column squeezes the grid to about
half its width and the numbers stop being readable.

There is no `size` prop. The day grid has a fixed metric that a size scale would
not change, and a prop that only altered the padding of the quick entries would
be a scale in name only.

## Accessibility

- The quick entries are native `<button>`s with `aria-pressed`; the active one
  is the entry the draft currently equals. (A listbox with `aria-selected` would
  model this too — the rule is to pick one and use it for every entry.)
- Over-cap entries are `aria-disabled`, **not** `disabled`: a disabled button is
  skipped by the tab order, so the reason under it would be unreachable by
  exactly the reader most likely to need it. They also carry
  `aria-describedby` pointing at that reason.
- The status line is `role="status" aria-live="polite"`, so a refusal is spoken
  when it appears rather than found by someone who goes looking.
- Both fields point at that line through `aria-describedby`, and are marked
  `error` when the PAIR is impossible — never merely incomplete, which would
  make the first click of a two-click control look like a mistake.
- Keyboard: the quick column is buttons; the grid is `Calendar`'s own roving
  focus (arrows, `Home`/`End`, `PageUp`/`PageDown`, Enter/Space).

## Copy

Every string is in `messages` and defaults to English. The summary prints days
in the same `dd/mm/aaaa` the fields are masked to rather than in the host
locale's order: one control cannot show the same date two ways, and an `en-US`
summary reading `08/05` over a field reading `05/08` leaves the reader to work
out which is lying. Replace `messages.summary` to choose another order.

## Test IDs

All derived from `dataTestId` (default `date-range-picker`):

| id | element |
|---|---|
| `{root}` | the container |
| `{root}-quick-list` | the quick group |
| `{root}-quick-{quickRangeId}` | one quick entry |
| `{root}-from`, `{root}-to` | the two `<input>`s |
| `{root}-status` | the summary / refusal line |

The calendar keeps its own ids (`calendar-container`, `calendar-header`,
`calendar-date-{day}`). **`calendar-date-{day}` is the day of the month only**,
so with two months on screen every day appears twice; a test that selects days
by that id should render `numberOfMonths={1}`.

## Usage

```tsx
const [range, setRange] = useState<DateRangeDraft>({ from: null, to: null });
const [status, setStatus] = useState<DateRangeStatus>(resolveDayRange(range));

<DateRangePicker
  value={range}
  onChange={(next, meta) => {
    setRange(next);
    setStatus(meta.status);
  }}
  timeZone="America/Sao_Paulo"
  maxRangeDays={366}
  locale="pt-BR"
  numberOfMonths={1}
/>
<Button disabled={!status.ok} onClick={() => status.ok && apply(status.window)}>
  Aplicar
</Button>
```

## Related

- [`Calendar`](../Calendar/Calendar.md) — the range grid this composes
- `DataViews` — where the masked `dd/mm/aaaa` field comes from
