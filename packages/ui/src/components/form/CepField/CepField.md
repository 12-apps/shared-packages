# CepField Component

## Purpose

A CEP input that fills the rest of the address in — the autofill pattern every
Brazilian form has used for twenty years. The user types eight digits and the
logradouro, bairro, cidade and UF arrive on their own; only `número` and
`complemento` are left to type, because no CEP database holds them.

The component owns the *interaction* — masking, validation, debouncing,
race-safety, status — and takes the *lookup* as a prop. It therefore knows
nothing about providers, transport or authentication, and the same component
serves a supplier form, a store-location form or a delivery checkout.

## Features

- Masks to `#####-###` on every keystroke, tolerant of pasted/messy input
- Fires the lookup only once the CEP is complete, after a debounce
- Never re-queries a CEP it already resolved
- Race-safe: a slow response for a since-edited CEP can never overwrite a newer one
- Degrades to a plain masked input when the lookup fails, throws, or is absent
- Accessible status via `role="status"` / `aria-live="polite"` and `aria-busy`
- Works uncontrolled-by-a-form (props) or bound to `total-form` (`Fields.CepField`)

## Props Documentation

### Core Props

- `value`: Current value, masked or bare — the field re-masks it
- `onChange`: Called on every keystroke with the **masked** value
- `onLookup`: `(cep: string) => Promise<CepAddress | null>` — resolve a complete
  CEP. Omit for a masked, validated input with no lookup at all
- `onResolved`: `(address: CepAddress) => void` — called once a CEP resolves.
  This is where the caller fills its address fields
- `onNotFound`: `() => void` — called when a **complete** CEP fails to resolve.
  The counterpart to `onResolved`: a caller that auto-filled from a previous CEP
  should undo that here (see *Behaviour notes*)

### Display Props

- `label`: Visible label (default `CEP`)
- `placeholder`: Placeholder text (default `00000-000`)
- `name`: Field name / input id (default `postalCode`)
- `dataTestId`: Test id for the input (default `cep-field-<name>`)

### State Props

- `error`: Validation error from the caller's form, shown below the input
- `disabled`: Disables the input and suppresses lookups
- `debounceMs`: Delay after the last keystroke before looking up (default `500`)

### The `CepAddress` shape

```ts
interface CepAddress {
  cep: string;              // bare digits
  street: string | null;    // logradouro
  neighborhood: string | null; // bairro
  city: string | null;      // município
  state: string | null;     // UF
}
```

## Usage

### Standalone

```tsx
const [cep, setCep] = useState('');

<CepField
  value={cep}
  onChange={setCep}
  onLookup={(c) =>
    fetch(`/api/admin/${slug}/lookup/cep/${c}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => body?.data ?? null)
  }
  onResolved={(address) => {
    setStreet(address.street ?? '');
    setCity(address.city ?? '');
  }}
/>
```

### Bound to `total-form`

`Fields.CepField` wires the field to the surrounding `FormContainer` and writes
the resolved parts straight into sibling fields:

```tsx
<Fields.CepField
  name="postalCode"
  lookup={lookupCep}
  fills={{
    street: 'addressLine1',
    neighborhood: 'neighborhood',
    city: 'city',
    state: 'state',
  }}
/>
```

Omit a key from `fills` to leave that part alone — a form with no bairro column
simply doesn't map `neighborhood`.

## Behaviour notes

**Autofill never blocks.** A provider outage, an unknown CEP, a timeout or a
lookup that throws all land in the same place: a `notfound` status and a field
that behaves exactly like a plain text input. Saving is never gated on a
third-party service being up.

**It will not overwrite the user's work.** `Fields.CepField` writes a target
field only when it is empty, or when it still holds the exact value that the
component put there. So correcting the CEP re-fills the address, but a
hand-edited street survives the next lookup.

**It will not leave one CEP's address under another's.** When a complete CEP
fails to resolve, `Fields.CepField` undoes its own autofill (again, only the
fields still holding what it wrote). Otherwise typing CEP A, getting a hit, then
correcting to an unknown CEP B would silently save A's street and city against
B — a plausible wrong address, which is worse than an empty one. The same rule
governs the CNPJ autofill on the fornecedores form.

**Validation is shape-only.** A CEP is a postal range, not a checksummed
document — there is no check digit to verify. Whether it *exists* is answered by
the lookup. The pure helpers (`formatCep`, `isValidCep`) live in
`@12-apps/forms-core` so the browser mask and any server-side guard share one rule.

## Accessibility

- The status line is a `role="status"` live region, so screen readers announce
  "Buscando endereço…" / "Endereço preenchido pelo CEP" without stealing focus
- `aria-busy` reflects the in-flight lookup
- `aria-describedby` links the input to its status region
- `inputMode="numeric"` brings up the numeric keypad on mobile
- `autoComplete="postal-code"` lets the browser's own autofill participate
