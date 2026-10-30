# SequenceResolver

Resolve a **queue of problems one at a time** in one dialog whose body is replaced step by
step. The component owns the run — which step is on screen, what was answered or skipped,
where Back returns to, when the end screen shows — and nothing about the domain: every
step body, every word and every server call is the host's (FUT-3671).

```
┌──────────────────────────────────────────────┐
│ ‹ Back   Problem 3 of 13 · Purchase       ×  │  header: back (once a previous step exists), label, close
│ ▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  progress: steps left behind / total
│ Red Bull 250ml                               │  ┐
│ Register the purchase                        │  │ the host's step (renderStep)
│ No stock. Last purchase: 24 u for $ 163.20   │  ┘
│ It was a stock count                         │  tertiary (text button, optional)
│ ──────────────────────────────────────────── │
│                    [Not bought yet] [Save]   │  footer: secondary (skip by default) + primary
└──────────────────────────────────────────────┘
```

**When to use it.** A list of things that each need a decision (a stock screen's "N problems
to solve", a product's subproducts to restock), resolved in order, where Back must undo the
previous answer. **Not** `StackedModal` — that stacks nested dialogs, and thirteen problems
would be thirteen layers with a back button that closes a layer instead of undoing an
answer. **Not** `Stepper` — that shows a known, short list of named steps; this queue is
data-sized and shrinks while you go.

## Surfaces

- **≥ 600px (`sm`)**: a centred `Dialog` (`size="sm"`), capped by the viewport.
- **Either way the body is the only scroll region**: the handle, header and progress stay
  put while a long step scrolls under them, so it is never cut off and Back/close never
  scroll away.
- **< 600px**: the `Dialog` inset `bottom-sheet` variant, at most 95% of the dynamic
  viewport, scrolling inside; a drag handle on top is decoration only (the sheet does not
  drag). Every header and footer target is at least 44px tall there.
- **Without `overview` the header is the one it always was**: Back with its word, the step label
  beside it or on its own row when the sheet is narrow, close, the bar under them.
- **With "Ver todos (N)" the header is one line at every width, 320 included, and nothing on it
  is cut**: Back, "Ver todos (N)" and close keep their size. On a chrome under 300px (a phone
  under 375px) Back is its chevron alone — a 44px target named by `backAccessible`, else
  `back` — and the step label takes its own line under the full-width bar (it wraps if long,
  never beside the bar). Only a long host label on a wider chrome is cut, with an ellipsis.

## Props

| Prop | Type | Description |
|---|---|---|
| `open` | `boolean` | Shows the resolver. Every opening — with an intro or without — starts a fresh run. |
| `onClose` | `(summary) => void` | Close button, Esc and the end screen's button — or, with `done: null`, the queue running out. Gets `{ resolved, skipped, total, alsoResolved }`; a close toast counts `resolved + alsoResolved` (and shows only when that is above 0). Clicking the veil does nothing (as approved). |
| `intro` | `SequenceIntro?` | While given, the intro shows instead of the run: `title`, `description`, `categories` (`label`, `description`, `count`, `onPick`), `startAllLabel`, `onStartAll`. The host drops it and sets `queue` in the same update as a pick. |
| `queue` | `readonly I[]` (`I extends { key; kindLabel }`) | The problems, in order. Live data: it may shrink (siblings answered together) or grow mid-run. |
| `renderStep` | `(item, api) => SequenceStep` | The current step: `content`, `primary?`, `secondary?` (default: skip with `labels.skip`; `false` removes it), `tertiary?`, `footer?` (`'end'` default — right-aligned over a hairline; `'split'` — two equal columns, no hairline; on a phone the actions always share the row without a hairline), `canGoBack?` (`false`: this answer has no inverse — once it is answered, Back is not offered from the next step). |
| `onBack` | `(item, result) => Promise<void> \| void` | The host's server inverse, awaited before Back shows the previous step again. Called only when that step was RESOLVED. |
| `canGoBack` | `boolean` (default `true`) | Offer Back at all. It shows only once a previous step exists — on steps and on the end screen, never on the intro. |
| `overview` | `SequenceOverview?` | "Ver todos (N)" inside the run (FUT-3825): `label(total)`, `title`, `categories` (`label`, `description?`, `count?` — the host's bookkeeping, not drawn: the `label` says the number, "Atrasado · 1" — `keys`, `onPick?`), `pickLabel`, `continueLabel`. See "Ver todos". |
| `initialKey` | `string?` | Open the run at this problem (a click on its block). The ones before it follow it; nothing is passed over. |
| `done` | `SequenceDone \| (summary) => SequenceDone \| null` | The end screen: `title`, `description?`, `confirmLabel`. **`null` drops it** (FUT-3833): when the queue runs out — the last step answered or passed over, or the host's queue emptied under the run — the resolver calls `onClose(summary)` once and starts closing; the host's toast is the run's last word. A pending last write keeps the step until it returns; a refused one keeps it with its message and does not close. Never fires from the intro. |
| `labels` | `SequenceResolverLabels` | Every chrome word: `back`, `backAccessible?`, `close`, `skip`, `step(position, total, item)`, `introStep`, `doneStep`, `progress`, `failed`. **Required — the package ships no copy.** |
| `dataTestId` | `string` (default `sequence-resolver`) | Parts: `-back`, `-close`, `-step-label`, `-progress`, `-handle`, `-category-<n>`, `-start-all`, `-primary`, `-secondary`, `-tertiary`, `-footer`, `-error`, `-done`, `-done-confirm`, `-see-all`, `-overview`, `-overview-pick-<n>`, `-continue`. |

### The step API

| `api.` | |
|---|---|
| `resolve(result \| promise, { alsoResolved? })` | Answer and move on. `alsoResolved` counts OTHER problems this answer resolved too ("apply to every sibling") for the close summary; Back over the step takes them off again. Given the PROMISE of the host's write, the step stays on screen and `busy` until it settles (even if the host's refetch drops the entry first); a rejection keeps it and shows the rejection's message. |
| `skip()` | Leave it unanswered and move on. |
| `back()` | Same as the header's Back. |
| `jumpTo(key)` | Jump to that problem, as an overview pick does: the step on screen is passed over and the target shows. An answered or unknown key does nothing. |
| `busy` | True while a `resolve` promise or an `onBack` is pending. The footer, tertiary and Back are disabled by the component; disable the step's own answers with it. |
| `titleProps` | **Spread on the step's title** (the item's name). It names the dialog and takes focus on every advance. |

## Behaviour

- **Index.** The run is not an index into `queue`. Visited steps are kept in visit order,
  the steps ahead in queue order. A new `queue` drops the steps ahead it no longer has
  (resolved elsewhere — "apply to every sibling") and appends entries it has not seen; the
  total follows. The run never goes past the end: with nothing ahead the end screen shows.
- **An empty queue at the start shows the end screen.** Do not open the resolver (past the
  intro) before the problems have loaded.
- **Back** pops the last visited step. Over a resolved step it awaits `onBack(item, result)`
  first; over a skipped one it returns at once. A rejected `onBack` keeps the current step
  and shows the message (`labels.failed` when the rejection has none). Every step Back
  returned to is held on screen while the host's refetch has not put it back yet — two Backs
  before one refetch hold both — and is released once the queue has it again.
- **`onBack` receives the item as it was when the step was answered** (with that answer's
  result), not a fresher copy from a later queue.
- **The close summary counts what has settled.** An answer whose write is still pending
  when the reader closes is not in `resolved`.
- **An error belongs to its step**: once the run moves to another step (an answer, a skip,
  or a queue change), it is gone.
- **Busy** blocks every verb: a second tap, or a skip during a pending write, is ignored.
- **Focus** moves to the screen's title on open and on every advance or return; Tab is
  trapped in the dialog; Esc closes (a popup inside a step that handles its own Esc keeps it).
- **Labelling.** `role="dialog"`, `aria-modal`, `aria-labelledby` = the intro title, the
  step title (`api.titleProps`) or the end title. The progress bar is named by
  `labels.progress`.

## Ver todos (N) — the list inside the run

With `overview`, every step's header shows a text button `overview.label(total)` ("Ver todos (2)")
between the step label and close, while the run has more than one problem (never on the intro or
the end screen). It shows the overview **in the same dialog without ending the run**:

```
┌──────────────────────────────────────────────┐
│ 2 problemas a resolver                    ×  │  overview.title (names the dialog, takes focus)
│ ▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ Atrasado · 1                     [Resolver]  │  a category: label, description, pickLabel
│ Luiz entrega ainda não começou               │
│ Avisou que não vai · 1           [Resolver]  │
│ ──────────────────────────────────────────── │
│ [Continuar em sequência]                     │  continueLabel: back to the step it left
└──────────────────────────────────────────────┘
```

- **Each row is the label and description, then the pick on the right.** Where the words would
  get less than 192px beside it (a 320px phone) the pick drops under them, at its content width.
- **A pick jumps** to the category's first UNANSWERED problem — the first of its `keys` still ahead
  in the run, else one passed over — then calls its `onPick`. A category with none left has its
  pick disabled.
- **A jump passes over the step on screen**: Back from the target returns to it at once (nothing
  to undo), and Back again keeps today's meaning (over an answered step it awaits `onBack`). A
  host that never jumps (the Estoque resolver) sees no change.
- **Continue** returns to the step it left, nothing changed — the step stays mounted (hidden)
  under the overview, so what the person half-filled in it is still there, and focus goes back
  to its title. Close from the overview closes the run with its summary.
- Every opening of the resolver starts with the overview closed.

## Writing a step

The pattern the owner approved — **the item's name first** (large), the question second, the
facts third. Footer: the secondary is "Skip for now" (or a step-specific word), the primary
is the step's verb; two actions at most, plus at most ONE tertiary, which sits as a text
button above the footer.

```tsx
<SequenceResolver<Problem, Answer>
  open={open}
  onClose={(summary) => { setOpen(false); toastResolved(summary); }}
  intro={showIntro ? intro : undefined}
  queue={problems}
  renderStep={(item, api) => stepFor(item, api)}
  onBack={(item, answer) => api.undo(answer.undoId)}
  done={(s) => ({
    title: s.resolved === s.total ? copy.allSolved : copy.someSolved(s.resolved, s.total),
    description: copy.doneHint,
    confirmLabel: copy.finish,
  })}
  labels={copy.resolver}
/>
```

### Four step kinds, as a stock screen plugs them in

| Kind (`kindLabel`) | `content` | `primary` | `secondary` | `tertiary` / `footer` |
|---|---|---|---|---|
| **Limits** — no minimum/maximum | name; "How much stays on display?"; facts; min/max steppers (`NumberField`); "Apply to every subproduct of X (N)" checkbox | "Save limits" → `api.resolve(saveLimits(...))`; with the checkbox the host's refetch drops the siblings' steps, and `{ alsoResolved: N }` counts them | skip | `footer: 'split'` |
| **Purchase** — out of stock | name; "Register purchase"; last purchase; quantity / total paid (`NumberField`), supplier (`CreatableSelect`), destination; "Also put N on display" | "Register and display N" → `api.resolve(registerPurchase(...))` | `{ label: 'Not bought yet', onClick: api.skip }` | `footer: 'split'` |
| **Restock** — display below its rule | name; "How many to take?"; total / displayed / stored; the 0→max bar; − / + | "Take N" → `api.resolve(restock(...))` | skip | `footer: 'end'` |
| **Unexplained loss** — a write-off with no reason | name; "Why did these N leave?"; quick reasons + "Other reason" (each answers with `api.resolve`, disabled while `api.busy`); "Different reasons? Split the N" | — (the reason buttons answer); while splitting: "Save N reasons" | skip; while splitting: `{ label: 'One reason only', ... }` | "It was a stock count, not a loss" |

Each `resolve` returns what `onBack` needs to undo it (an undo id from the server), so Back
is one call to the host's inverse.

## Accessibility

- Dialog role, labelled title, focus trap (MUI's, via `Dialog`), Esc to close.
- Focus to the title on every screen change, so a screen reader announces the new problem.
- 44px+ targets below 600px (`lg` buttons, a 44px close).
- Errors are an assertive `Alert`; `aria-busy` marks the step while a write is pending.

## Related

- `Dialog` — the surface (default and inset `bottom-sheet` variants).
- `Progress` — the bar.
- `StackedModal`, `Stepper` — see "When to use it".
