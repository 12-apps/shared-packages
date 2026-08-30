# @12-apps/qr

QR codes in both directions.

```bash
pnpm add @12-apps/qr
```

| subpath | what it does |
| --- | --- |
| `@12-apps/qr/pdf` | a URL → print-ready sticker artwork a gráfica can run |
| `@12-apps/qr/scan` | a device camera → the text a QR carries |

## Why this exists

Both halves of "QR" are things every host eventually needs and nobody should
write twice, because both fail in ways you cannot see on a screen.

**Printing.** The browser will happily draw a code and `window.print()` will
print the page around it — chrome, sidebar and all, at whatever size the paper
happens to be. What a print shop actually reads is a short list, and every item
on it is invisible in a preview: the declared page boxes, whether the marks sit
outside the trim, how many plates the black is built from, and whether the code
kept its quiet zone. Get any one wrong and you find out when the box of
laminated stickers arrives.

**Reading.** A camera has a lifecycle and a component has a render, and mixing
the two is how a scanner ends up leaving the lens on — a failure nothing crashes
on and no suite notices, whose only symptom is the indicator light on somebody's
phone staying lit after they closed the sheet. Plus two decoders, because there
is no one way that works: `BarcodeDetector` is the platform's own and is what
Chrome and Android have; WebKit has never shipped it, so on iOS Safari the
"fallback" is not a fallback, it is the whole feature.

## Printing a sticker

```ts
import { buildQrStickerPdf, pdfDateOf, STICKER_SIZES } from "@12-apps/qr/pdf";

const bytes = buildQrStickerPdf({
  stickers: [
    {
      label: "Cerveja Pilsen 350ml",
      url: "https://loja.example.com/market/p/abc/def",
      hint: "Aponte a câmera e pague pelo celular",
      priceLine: "R$ 8,90",     // optional — see below
    },
  ],
  size: STICKER_SIZES.small,     // 50 × 70 mm
  layout: "individual",          // or "sheet" — A4 with cut guides
  brandName: "Bar do Zé",
  title: "QR do mercado",
  date: pdfDateOf(new Date()),
  creator: "Your app",
});
```

`bytes` is a `Uint8Array` — hand it to a download, an upload, or a mailer. The
builder is **pure**: it reads no clock (hence `date`), no locale and no DOM, so
it runs identically in a browser, in a job, and in a test.

### It prints a URL, not a table

Every word on the sticker arrives as data. There is deliberately **no copy in
this package** — `STICKER_SIZES` is dimensions and stable ids, and what a size
is *called* is yours, in your languages. A package that shipped one language's
names would either force it on every caller or need a locale resolver in order
to print a rectangle.

### `priceLine` is a string, and optional

A shelf label without a price is not a shelf label; a table's plaquinha with one
is wrong. So it is per sticker, optional, and already **formatted** — currency
and its placement are locale facts this package has no business deciding.

The part it cannot help you with: a price change means a reprint. Say so at your
call site.

## Reading a code

```tsx
import { useQrCamera } from "@12-apps/qr/scan";

function Scanner({ onCode }: { onCode: (text: string) => void }) {
  const { videoRef, fault, live } = useQrCamera(true, onCode);
  if (fault) return <p>{yourCopy[fault]}</p>;
  return <video ref={videoRef} autoPlay playsInline muted />;
}
```

`fault` is one of `unsupported | denied | missing | busy | failed` — five values,
not five sentences, because each one is a different thing to *do* about it and
what to SAY is yours, in your languages.

### The pixels are not in this package

A viewfinder is styled chrome. It belongs to whichever design system you already
ship, and a package bringing its own would either fight that system or drag it in
as a dependency. You get a hook and a `<video>` ref; the surface around it is
yours.

### A scanned code is untrusted input

The hook hands you the decoded string and stops there, deliberately. It is a
sticker — anybody can print one and put it anywhere.

**Never navigate to what comes back.** Reduce it to values you already trust (an
id you then look up), and route with those. A `javascript:` code, a foreign
origin, a path escape and a phishing link should all end at the same honest
refusal. That parser is yours because only you know what a legitimate code says.

### It keeps reading after a hit

A decoded code is not necessarily a *usable* one — a Wi-Fi QR on the same table
decodes perfectly — so the loop does not stop on the first success. Ignore
repeats of a code you have already refused.

## The decisions baked in

These are the ones that only fail on paper, so they are not configurable:

| | why |
| --- | --- |
| `TrimBox` + `BleedBox` **declared** | that is how a RIP knows where the blade goes; artwork that only *looks* trimmed gets imposed by eye |
| **3mm bleed**, artwork running into it | a blade landing a hair off leaves no white lip |
| **crop marks outside the bleed** | a mark over the artwork is a mark on every sticker in the run |
| **K-only black** | rich black is four plates, and any misregistration fringes every edge of a code whose whole job is to be read by a camera in bad light |
| **error correction H** | it gets scratched, splashed and half-covered — H tolerates ~30% loss, the on-screen default 15% |
| **4-module quiet zone**, drawn | the most common way a printed code stops scanning, and invisible on screen because the browser gives you one free |

`layout` is the one real fork: `individual` is one page per sticker with trim,
bleed and marks — what a print shop imposes and die-cuts. `sheet` is A4 with
thin cut guides, for the office printer at 11pm when one label went missing.

## Sizes

| id | trimmed size |
| --- | --- |
| `small` | 50 × 70 mm |
| `medium` | 70 × 100 mm |
| `tent` | 100 × 150 mm |

Any `{ widthMm, heightMm }` is legal; these are the common ones. Millimetres
because that is the unit the conversation with a gráfica happens in.

## A note on the PDF writer

`@12-apps/qr/pdf` also exports the small writer underneath the sticker (`mm`,
`rect`, `line`, `text`, `buildPdf`, `FILL_BLACK`). It is **not** a general PDF
library and will not become one: it writes filled rectangles, stroked lines and
base-14 text, which is all a sticker sheet needs. Anything past that is a reason
to reach for a real library, not to grow this one.

It is published so a host that wants a different *layout* can compose these
operators instead of forking the sticker — the parts worth sharing are the ones
nobody can check on screen, and those stay in the builder however the page is
arranged.

## Seeing the artwork

You cannot review a print job in a diff, and the failures this package guards
against are all invisible on screen. To look at real output:

```ts
// scratch.ts — run it with vitest, which already resolves this package's TS
import { writeFileSync } from "node:fs";
import { buildQrStickerPdf, pdfDateOf, STICKER_SIZES } from "@12-apps/qr/pdf";

writeFileSync("/tmp/sample.pdf", buildQrStickerPdf({
  stickers: [{ label: "Cerveja Pilsen 350ml", url: "https://…", hint: "Aponte a câmera", priceLine: "R$ 8,90" }],
  size: STICKER_SIZES.small, layout: "individual", brandName: "Bar do Zé",
  title: "QR do mercado", date: pdfDateOf(new Date()), creator: "scratch",
}));
```

Open it in any reader and check the four things a test cannot judge for you: the
code scans with a real phone **at the distance it will be read from**, the trim
marks fall where you expect, the type is legible at size, and the label is not
running off the sticker.

That last check matters most at the small preset with a long URL — a denser code
means finer modules, and the smallest sticker is where a payload first stops
scanning.

## License

MIT
