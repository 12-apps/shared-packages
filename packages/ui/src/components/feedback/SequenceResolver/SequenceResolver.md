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

- **≥ 600px (`sm`)**: a centred `Dialog` (`size="sm"`). The paper scrolls inside the
  viewport, so a long step is never cut off.
- **< 600px**: the `Dialog` inset `bottom-sheet` variant, at most 95% of the dynamic
  viewport, scrolling inside; a drag handle on top is decoration only (the sheet does not
  drag). Every header and footer target is at least 44px tall there.

## Props

| Prop | Type | Description |
|---|---|---|
| `open` | `boolean` | Shows the resolver. Opening it (past the intro) starts a fresh run. |
| `onClose` | `(summary) => void` | Close button, Esc and the end screen's button. Gets `{ resolved, skipped, total }` for the host's "N resolved · Undo" toast. The veil does nothing (as approved). |
| `intro` | `SequenceIntro?` | While given, the intro shows instead of the run: `title`, `description`, `categories` (`label`, `description`, `count`, `onPick`), `startAllLabel`, `onStartAll`. The host drops it and sets `queue` in the same update as a pick. |
| `queue` | `readonly I[]` (`I extends { key; kindLabel }`) | The problems, in order. Live data: it may shrink (siblings answered together) or grow mid-run. |
| `renderStep` | `(item, api) => SequenceStep` | The current step: `content`, `primary?`, `secondary?` (default: skip with `labels.skip`; `false` removes it), `tertiary?`. |
| `onBack` | `(item, result) => Promise<void> \| void` | The host's server inverse, awaited before Back shows the previous step again. Called only when that step was RESOLVED. |
| `canGoBack` | `boolean` (default `true`) | Offer Back at all. It shows only once a previous step exists — on steps and on the end screen, never on the intro. |
| `done` | `SequenceDone \| (summary) => SequenceDone` | The end screen: `title`, `description?`, `confirmLabel`. |
| `labels` | `SequenceResolverLabels` | Every chrome word: `back`, `backAccessible?`, `close`, `skip`, `step(position, total, item)`, `introStep`, `doneStep`, `progress`, `failed`. **Required — the package ships no copy.** |
| `dataTestId` | `string` (default `sequence-resolver`) | Parts: `-back`, `-close`, `-step-label`, `-progress`, `-handle`, `-category-<n>`, `-start-all`, `-primary`, `-secondary`, `-tertiary`, `-footer`, `-error`, `-done`, `-done-confirm`. |

### The step API

| `api.` | |
|---|---|
| `resolve(result \| promise)` | Answer and move on. Given the PROMISE of the host's write, the step stays on screen and `busy` until it settles (even if the host's refetch drops the entry first); a rejection keeps it and shows the rejection's message. |
| `skip()` | Leave it unanswered and move on. |
| `back()` | Same as the header's Back. |
| `busy` | True while a `resolve` promise or an `onBack` is pending. The footer, tertiary and Back are disabled by the component; disable the step's own answers with it. |
| `titleProps` | **Spread on the step's title** (the item's name). It names the dialog and takes focus on every advance. |

## Behaviour

- **Index.** The run is not an index into `queue`. Visited steps are kept in visit order,
  the steps ahead in queue order. A new `queue` drops the steps ahead it no longer has
  (resolved elsewhere — "apply to every sibling") and appends entries it has not seen; the
  total follows. The run never goes past the end: with nothing ahead the end screen shows.
- **Back** pops the last visited step. Over a resolved step it awaits `onBack(item, result)`
  first; over a skipped one it returns at once. A rejected `onBack` keeps the current step
  and shows the message (`labels.failed` when the rejection has none). The step Back
  returned to stays on screen while the host's refetch has not put it back yet.
- **Busy** blocks every verb: a second tap, or a skip during a pending write, is ignored.
- **Focus** moves to the screen's title on open and on every advance or return; Tab is
  trapped in the dialog; Esc closes (a popup inside a step that handles its own Esc keeps it).
- **Labelling.** `role="dialog"`, `aria-modal`, `aria-labelledby` = the intro title, the
  step title (`api.titleProps`) or the end title. The progress bar is named by
  `labels.progress`.

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

| Kind (`kindLabel`) | `content` | `primary` | `secondary` | `tertiary` |
|---|---|---|---|---|
| **Limits** — no minimum/maximum | name; "How much stays on display?"; facts; min/max steppers (`NumberField`); "Apply to every subproduct of X (N)" checkbox | "Save limits" → `api.resolve(saveLimits(...))`; with the checkbox the host's refetch drops the siblings' steps | skip | — |
| **Purchase** — out of stock | name; "Register purchase"; last purchase; quantity / total paid (`NumberField`), supplier (`CreatableSelect`), destination; "Also put N on display" | "Register and display N" → `api.resolve(registerPurchase(...))` | `{ label: 'Not bought yet', onClick: api.skip }` | — |
| **Restock** — display below its rule | name; "How many to take?"; total / displayed / stored; the 0→max bar; − / + | "Take N" → `api.resolve(restock(...))` | skip | — |
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
