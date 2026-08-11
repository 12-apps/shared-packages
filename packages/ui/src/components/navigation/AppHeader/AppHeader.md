# AppHeader

The application bar, as a set of slots on one surface — plus the identity block,
the state line and the disclosure panel that usually fill them.

It is deliberately ignorant. There is no router in it, no session, no cart, no
store: every slot is a `ReactNode` and every behaviour is a callback. That is
what lets one bar serve a storefront, a back office and a platform console
without any of the three leaking into the other two.

```tsx
import {
  AppHeader,
  AppHeaderDetails,
  AppHeaderIdentity,
  AppHeaderStatus,
} from '@12-apps/ui/navigation/AppHeader';

const [open, setOpen] = useState(false);

<AppHeader
  meta="Build 18"
  actions={<Button onClick={signIn}>Entrar</Button>}
  below={<SearchField />}
>
  <AppHeaderIdentity
    title={store.name}
    logoUrl={store.logoUrl}
    seedColor={store.primaryColor}
    status={<AppHeaderStatus tone="success" items={['Aberto agora', 'Retirada no balcão']} />}
    disclosed={open}
    onDisclose={() => setOpen(true)}
  />
</AppHeader>

<AppHeaderDetails
  open={open}
  onClose={() => setOpen(false)}
  title={store.name}
  subtitle={store.tagline}
  rows={[
    { label: 'Agora', value: 'Aberto até 22h', tone: 'success' },
    { label: 'Endereço', value: `${store.street}\n${store.district}` },
  ]}
  action={{ label: 'Trocar de loja', onClick: goToStorePicker }}
/>;
```

## The parts

| Component            | What it is                                                       |
| -------------------- | ---------------------------------------------------------------- |
| `AppHeader`          | The bar: `leading`, the identity (children), `actions`, `meta`, `below` |
| `AppHeaderIdentity`  | Mark + title + state line, and the disclosure when it can open one |
| `AppHeaderBrand`     | The mark alone — a logo, or initials on a gradient derived from one colour |
| `AppHeaderStatus`    | The dotted state line: `● Aberto agora · Retirada no balcão`      |
| `AppHeaderDetails`   | The panel behind the disclosure — a sheet on phones, a dialog on large screens |

Each is exported on its own, so a bar that wants only the mark, or only the
state line, takes just that.

## One bar, every width

The SURFACE always spans the viewport; the CONTENT stops at `maxWidth` (1200 by
default) and centres. So the same element reads as a phone header and as a
desktop one, with no breakpoint at the call site and no second component.

`AppHeaderDetails` follows the same rule one level down. It is one component
with two presentations because it is one thing to the user — a bottom sheet
within reach of a thumb, a centred dialog under a pointer — and `presentation:
'auto'` (the default) picks by viewport. Force it with `'sheet'` or `'dialog'`
when the surrounding layout has already decided: a preview frame, a kiosk, a
story.

## One brand colour is enough

`seedColor` takes a single hex and the mark derives its own gradient from it, by
rotating the seed's hue toward the warm side and lifting its lightness. With no
seed it derives from the theme's primary instead, so an app with no per-tenant
colour needs to pass nothing.

The alternative — a second "highlight" prop — asks every caller to pick a colour
that pairs with a colour they already picked, and in a multi-tenant app it asks
that of people who will never see this component. A seed with no hue worth
rotating (a grey, a black) stays grey: a hueless brand is not given a colour it
never chose. A seed the browser cannot parse is returned untouched rather than
throwing.

## What it will not do

- **Navigate.** There is no `href` on the identity. An `href` would have to guess
  whose link component it is being handed — `to` for one router, `href` for
  another — and would half-work for everybody. A title that navigates is one line
  of your own router in the `leading` slot.
- **Fetch anything.** `loading` on the identity holds a skeleton the size of the
  real block; you decide when that is true. It exists because the obvious
  fallback is actively wrong on a white-label storefront: painting a placeholder
  name flashes the platform's brand for a frame on every load, on a page a
  merchant pays for it not to appear on.
- **Own its own open state.** `AppHeaderDetails` is controlled. The disclosure
  and the panel are separate components precisely so the panel can live wherever
  the layout needs it.

## Accessibility

- The mark is `role="img"` labelled with the name, so a screen reader says
  "Future Drink" rather than spelling out "F D".
- With `onDisclose`, the whole identity block is one `<button>` with
  `aria-haspopup="dialog"` and a live `aria-expanded`. The button wraps
  everything rather than sitting beside the title: on a phone the chevron alone
  is a 20px target next to a 40px one that does nothing, and a shopper aiming at
  the store's name expects the store's details.
- The state line separates its segments with real whitespace, not CSS margin —
  a screen reader reads `textContent`, and a margin-only gap runs "Aberto agora"
  straight into "Retirada no balcão" as one word. The separator glyph itself is
  `aria-hidden`: it is punctuation, not something to announce.
- A `fixed` bar renders a spacer of its own MEASURED height. A constant cannot
  do it — the height is whatever your slots add up to, and a search field in
  `below` moves it — so the bar observes itself and republishes. Where
  `ResizeObserver` does not exist (jsdom, so: your tests) it measures once
  instead of throwing.

## Props

See `AppHeader.types.ts`. Every prop is documented at its declaration.
