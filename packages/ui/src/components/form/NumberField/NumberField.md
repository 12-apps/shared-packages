# NumberField

## Purpose

A **digits-only** numeric input whose value is a `number | null`. For the
counts, durations and limits settings forms are full of — "prepare in 15 min",
"keep for 30 days" — where a plain text input lets letters in and a
`type="number"` field brings scroll-wheel surprises, `e`, `-` and a value that is
a string.

- `inputMode="numeric"` on the `<input>` itself, so a phone opens its number pad.
- A non-digit keystroke never reaches the field; a paste keeps only its digits
  (`"1.500 min"` → `1500`).
- `suffix` — the unit — is drawn **inside** the field's border, at its end.
- ArrowUp / ArrowDown move by `step`, never past `min` / `max`.
- An empty field is `null`. Never `0`, never `NaN`: "cleared" and "zero" stay
  two different answers.

Built on [`Input`](../Input/Input.md), so it takes the field radius, height,
border, variants and sizes like every other field.

## Usage

```tsx
import { NumberField } from '@12-apps/ui/form/NumberField';

const [minutes, setMinutes] = useState<number | null>(15);

<NumberField
  label="Preparation time"
  value={minutes}
  onChange={setMinutes}
  min={1}
  max={120}
  step={5}
  suffix="min"
  helperText="Between 1 and 120"
/>
```

## Props

Everything [`Input`](../Input/Input.md) takes (`label`, `helperText`, `error`,
`size`, `variant`, `disabled`, `placeholder`, `data-testid`, …), except the ones
this field owns (`value`, `onChange`, `type`, `inputMode`, `pattern`, `min`,
`max`, `step`, `endAdornment`, `maxLength`), plus:

| prop | type | default | effect |
|---|---|---|---|
| `value` | `number \| null` | **required** | The value. `null` renders an empty field. |
| `onChange` | `(value: number \| null) => void` | **required** | Every edit, as a number, or `null` once cleared. Not called when an edit leaves the number unchanged. |
| `min` | `number` | — | Where ArrowDown stops, where an empty field's first arrow press lands, and what a blur raises a smaller value to. |
| `max` | `number` | — | Where ArrowUp stops, and what a blur lowers a larger value to. |
| `step` | `number` | `1` | How far one arrow press moves. |
| `suffix` | `ReactNode` | — | The unit, inside the field's border. Also read as part of the field's description. |

## Behaviour notes

- **Bounds apply to arrows at once, to typing on blur.** Typing `5` on the way to
  `50` must not snap to a minimum of `10` under the reader's fingers; the blur
  brings an out-of-range value back inside.
- **Digits only means non-negative integers.** There is no minus sign and no
  decimal separator; a field that needs either is not this one.
- **At most fifteen digits** — the longest run that is always a safe integer, so
  a pasted serial number never becomes a rounded float.
- From empty, either arrow lands on `min` (or `0`): the first press says "give me
  a number", and the floor is the one both directions agree on.
- A caller's `onKeyDown` runs first; calling `preventDefault()` in it cancels the
  field's own handling of that key.

## Accessibility

- `role="spinbutton"` with `aria-valuenow`, `aria-valuemin` and `aria-valuemax`
  — the arrow keys make it one, and a screen reader then says so, and says where
  in the range the value sits.
- The suffix has an id and is in the input's `aria-describedby` (after the
  helper text), so "15" is announced with its unit.
- `inputMode="numeric"` and `pattern="[0-9]*"` bring up the numeric keypad on
  iOS and Android.

## Best practices

- Put the unit in `suffix`, not in the label: "Preparation time" + `min` reads
  better than "Preparation time (min)", and the unit stays next to the number.
- Store `null` as "not set" on the host side. Coercing it to `0` is how a
  cleared field ends up submitting a value nobody chose.
