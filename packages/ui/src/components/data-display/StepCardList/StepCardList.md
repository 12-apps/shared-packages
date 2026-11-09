# StepCardList

**Purpose:** every step of a form on screen at once, each as a card. Answered steps collapse into one button that reopens them, the current step draws its face, the rest wait dashed. The visitor always sees how many steps there are and how many are left.

**Why not `Stepper`:** `Stepper` is a progress strip: a label and a description per step, with no slot for the step's face, no answer summary and no reopen control on a finished step. `StepCardList` is the card form of the same idea.

```ts
type StepCardState = 'done' | 'current' | 'todo' | 'error'; // error = done, but the answer is invalid

interface StepCardItem {
  id: string;
  title: string; // the heading of the current step, the text of a todo step
  state: StepCardState;
  caption?: string; // done card, small secondary line. Default: `${number} · ${title}`
  answer?: ReactNode; // done card, bold
  detail?: ReactNode; // done card, muted line
  error?: string; // state 'error': error colour, linked with aria-describedby
  onChange?: () => void; // reopens the step; without it a done card is plain content
  changeLabel?: string; // the visible word ("Edit"); no default
  changeAriaLabel?: string; // optional accessible name for the button
  children?: ReactNode; // the face, drawn on the current card only
}

interface StepCardListProps {
  items: readonly StepCardItem[];
  reveal?: RevealOptions | false; // insets for sticky bars; false = focus only, no scroll
  revealWatch?: readonly (Element | null)[]; // bars whose resize re-runs the reveal
  focusOnMount?: boolean; // default false: focus moves only when the current step CHANGES
  headingLevel?: 2 | 3 | 4 | 5 | 6; // default 2
  'aria-label'?: string;
  dataTestId?: string; // default 'step-card-list'; items are `<id>-<step id>`
}
```

## Behaviour

- An `<ol>`; each item is an `<li>` with `data-state`. The current item has `aria-current="step"`.
- Numbers count the items in the list: leave a hidden step out of `items`.
- A **done** card is one `type="button"`: marker (check), caption, bold answer, muted line, then `changeLabel`. The whole card is the target. Its accessible name is what it shows unless `changeAriaLabel` is given.
- An **error** card is a done card whose marker is the error colour and whose `error` text shows under the answer; the button is described by it. Colour is not the only signal: the marker is an exclamation mark and the text is there.
- The **current** card renders `children` under its heading. When a step *becomes* current after the list was drawn (after "continue" or after a done card's change button), its heading takes focus and the card is revealed (see below). The first draw leaves the page's own focus alone unless `focusOnMount`.
- A **todo** card shows the number and `title`.
- There is no default copy: every word is a prop. The only generated string is the default caption's `N · title`.
- Theme tokens only (`primary.main`, `error.main`, `divider`, `action.hover`, `text.secondary`); sizes in `sxRem`; the change word narrows by a container query, never a media query.

## Reveal helpers (`@12-apps/ui/utils`)

The scroll is also exported for any caller that opens content in place:

```ts
revealDelta(box, view, gap = 12): number          // pure: 0 | end `gap` above the view's end | top `gap` under its top
revealBlock(el, { topInset?, bottomInset?, gap? }) // scroll the nearest scroller just enough
followBlock(el, { ...insets, settleMs?, watch? }) => stop // reveal now and again while it grows or a watched bar resizes
```

Insets are px, or a function read at every reveal (a bar that publishes its height). `watch` takes the bars the insets measure. A block taller than the view puts its top under the top inset; a block already whole in view does not move the page. Smooth unless `prefers-reduced-motion: reduce`.

## Usage

```tsx
<StepCardList
  aria-label={labels.steps}
  reveal={{ bottomInset: () => submitBar.current?.offsetHeight ?? 0 }}
  revealWatch={[submitBar.current]}
  items={[
    { id: 'kind', title: labels.kind, state: 'done', answer: 'Flour', detail: 'Dry goods', changeLabel: labels.change, onChange: () => open('kind') },
    { id: 'amount', title: labels.amount, state: 'current', children: <AmountFields /> },
    { id: 'price', title: labels.price, state: 'todo' },
  ]}
/>
```

## Testing

Test ids: the `<ol>` is `step-card-list`; each `<li>` is `step-card-list-<id>`, with `-answer`, `-detail`, `-error`, `-change` (the button) and `-change-label` inside.
