# @12-apps/thermal-printing

Receipt printing for the two ways a thermal printer is attached, behind **one**
fixed-width document.

```bash
pnpm add @12-apps/thermal-printing
```

## The problem it solves

A receipt printer reaches a host one of two ways, and the host does not get to
choose which one the shop bought:

| | **Network** (Wi-Fi / Ethernet) | **Local** (USB cable) |
|---|---|---|
| how it is reached | raw ESC/POS over a TCP socket, `:9100` by convention | the browser on the machine it is plugged into, printing through the OS |
| who drives it | the server — `./net` | a tab — `./html` |
| with nothing open | still prints | stops, silently: a USB device has no address |
| what a success means | the bytes left the process | the document reached the operating system |

The naive shape is two code paths, and the cost shows up the first time a store
swaps one kind of printer for the other: the ticket changes, because a second
path is a second layout. So the split here is **one document, two encoders**.

```
       host builds            this package encodes
   ┌──────────────────┐      ┌─────────────────────┐
   │  TicketLine[]    │─────▶│ ./escpos → bytes    │──▶ socket (./net)
   │  (line, field,   │      │ ./html   → document │──▶ a tab prints it
   │   rule, wrap)    │      └─────────────────────┘
   └──────────────────┘
```

The layout is authoritative for both. `./html` renders the same lines in a
monospace column of exactly the same width rather than laying out a `<table>` —
that is the divergence the package exists to refuse.

## What it does not do

**It carries no copy.** Not one sentence, in any language. A failed send returns
a `reason` code and the `host:port` it was aimed at; the host turns that into
words, in the language of whoever is reading the screen. Two hosts can say "the
printer at 10.0.0.9 did not answer" and "the kitchen printer is offline" from
the same event.

**It does not compose your ticket.** What a ticket says, in what order, is the
host's product decision — and it is where the host's own vocabulary, currency
and time zone live. This package gives you the arithmetic underneath it: column
counts, wrapping with a hanging indent, dividers, `Label: value` fields that
disappear when there is no value.

**It owns no models and no routes.** There is no Prisma partial and nothing to
mount.

## Surfaces

| Export | What it is |
|---|---|
| `@12-apps/thermal-printing` | The line model — `TicketLine`, `columnsFor`, `wrap`, `line`, `centered`, `rule`, `field`, `PAPER_WIDTHS_MM`, and the [reference-sheet vocabulary](#the-vocabulary-four-sizes-bands-boxes-rows-pictures): `textLines`, `band`, `box`, `row`, `image`, `LINE_SIZES`, `printableDotsFor`, `textWidth`. Pure, isomorphic. |
| `…/escpos` | `encodeTicket(lines)` → `Uint8Array`. Initialise, CP850, align, emphasise, font and magnification, reverse, line spacing, `GS v 0` raster, feed, partial cut. |
| `…/html` | `renderTicketHtml(lines, paperWidthMm, lang?)` → a standalone document exactly the roll's printable width (72 mm of 80, 48 mm of 58), pure black on white, with `@page { margin: 0 }`. `rasterToDataUri(raster)` → the 1-bit picture as a `data:` URI, for a preview. |
| `…/raster` | `rasterizeSvg(svg, { width })` → RGBA at the printer's dot size; `toMonochrome(rgba, options?)` → a printable 1-bit `RasterImage`. Pure, isomorphic, no canvas and no native module. |
| `…/net` | `sendToNetworkPrinter(host, port, bytes, options?)`. Node-only (`node:net`), never throws, structured failures. |
| `…/routing` | `printerRoute(printers)` / `printerFor(route, destinationId)` — per-destination with a default, generic over your own printer rows. |
| `…/discovery` | `scanForPrinters(options?)` / `probePrinter(host, port?)` — find the address nobody wrote down. Node-only. |
| `…/discovery/bridge` | `startDiscoveryBridge({ allowedOrigins })` — a loopback server an HTTPS page may call to run that scan. Node-only. |
| `…/electron` | `printHtml({ html, deviceName, session? })` — an offscreen window, a silent print to a named device (or the default), destroyed after. A refusal rejects with `PrintRefusedError` (`reason: string \| null`, never a sentence). `electron` is an optional peer. |
| `…/discovery/cli` | `runFinder({ allowedOrigins })` / `main(argv, env)` — the helper a merchant downloads, as a function to bundle. Node-only. |

`./net` and `./discovery` sit behind their own subpaths so that importing the
encoders into a browser bundle never drags `node:net` in, and `./electron`
behind its own so that nothing else ever imports `electron`.

## The vocabulary: four sizes, bands, boxes, rows, pictures

A receipt is more than one size of text. The builders below cover what a
designed ticket uses, and every one of them produces **plain text plus a flag**,
so the two encoders print the same characters in the same places: a row is
padded here, a box is drawn here, a band is centred here.

```ts
import { band, box, image, row, rule, textLines, columnsFor } from '@12-apps/thermal-printing';

const w = printer.paperWidthMm; // 58 or 80
const lines = [
  image(logo),                                                     // a RasterImage, centred
  ...textLines(copy.headline, w, { size: 'xlarge', bold: true, align: 'center' }),
  ...band(copy.paidBanner, w),                                     // white on black, edge to edge
  ...row(item.label, money(item.totalCents), w, { indent: 3 }),    // amount flush right
  rule(columnsFor(w)),
  ...row(copy.total, money(totalCents), w, { size: 'large', bold: true }),
  ...box(copy.bringChange, w),                                     // ┌──┐ │ … │ └──┘
  ...textLines(copy.footer, w, { size: 'small', align: 'center' }),
];
```

The size-aware builders take the **paper width**, not a column count: with four
sizes there are four counts per roll, and the builder knows which one its size
needs. The legacy `line`, `centered`, `rule` and `field` are unchanged, and a
ticket that uses only them encodes to exactly the bytes it did before.

### The four sizes, and how they map onto ESC/POS

ESC/POS has no point sizes — it has two built-in fonts and integer
magnification. Each size is one font at one multiplier, all four reachable with
`ESC !` alone (the part of the command set every printer in this class has):

| size | reference step | font | magnification | cell (dots) | glyph height | columns 58 mm | columns 80 mm |
|---|---|---|---|---|---|---|---|
| `small` | P — details | B | 1 × 1 | 9 × 17 | ≈ 6 pt | 42 | 64 |
| `medium` | M — text | A | 1 × 1 | 12 × 24 | ≈ 8.5 pt | 32 | 48 |
| `large` | G — highlights (`TOTAL`) | B | 2 × 2 | 18 × 34 | ≈ 12 pt | 21 | 32 |
| `xlarge` | GG — headline | A | 2 × 2 | 24 × 48 | ≈ 17 pt | 16 | 24 |

`medium` and `large` match 8.5 pt and 12 pt almost exactly at 8 dots/mm. `small`
is Font B, the only step below Font A. `xlarge` is the biggest step reachable
without `GS !`; the next one (3 × 3) would leave 16 columns on 80 mm and 10 on
58 mm, which cannot hold a typical headline on the narrow roll.

**Why these sizes use double width when `double` never does.** The legacy
`double` emphasis stays double *height* only, because a line wrapped at 48
columns and printed twice as wide silently rewraps at 24. That danger is a
column count disagreeing with a magnification. A sized line carries its size,
`columnsFor(paperWidthMm, size)` answers for it, and the builders wrap at that
count — so width and height are magnified together, and a glyph that is only
taller (which reads as condensed) is avoided.

The HTML document reproduces the column counts rather than the point sizes: the
body is the printable width in millimetres (72 mm on 80 mm, 48 mm on 58 mm) with
its type sized so `columnsFor(paperWidthMm)` characters fill it — one column is
1.5 mm, the printer's own Font A cell — and a size with N columns is set at
(body columns / N) em — `small` 0.75em, `large` 1.5em, `xlarge` 2em on 80 mm. A
line wraps at the same place on screen as on paper, and nothing reaches the
margin the head cannot print. Text is pure black, stroked about one dot thicker
so a regular-weight stem prints solid rather than as dithered grey; a picture is
drawn at one image pixel per dot (`width / 8` mm), unsmoothed.

`LINE_SIZE_METRICS` and `FONT_CELL_DOTS` export the table, for a host that wants
to draw its own preview.

### Bands and boxes

- **`band`** prints reverse (`GS B 1`), padded to the full column count so the
  black runs from one edge of the roll to the other — a reverse-printed space is
  a black cell. In HTML it is `background:#000;color:#fff` with
  `print-color-adjust:exact`, without which a browser drops the background when
  printing and the band comes out white on white.
- **`box`** is drawn with the box-drawing characters CP850 carries (`┌─┐│└┘`),
  since ESC/POS has no rectangle command; it prints on every printer and renders
  identically in the browser.
- Both close the line spacing (`ESC 3 n`, n = the cell height) so a multi-line
  band is one block and the verticals of a box join; `ESC 2` restores it after.
- Both default to **bold** — they are there to be noticed; pass `bold: false`
  to opt out.

> **Hardware assumption to verify on paper:** `ESC 3 n` is read as `n` dots,
> which holds for the 203-dpi class this package targets (Bematech MP4200,
> Epson TM-T20 and alike, where the line-spacing motion unit is one dot). A
> printer whose vertical motion unit is different (set by `GS P`, or a
> 180/300-dpi head) would space framed lines tighter or looser than the cell;
> check a band and a box on the actual model before relying on them.

### Rows

`row(label, amount, paperWidthMm, { size?, bold?, indent? })` puts the amount
flush right on the **first** line and wraps the label beside it (under an
optional hanging indent). An amount so long the label would get under a third
of the line moves to a line of its own below the label, still flush right.
The amount is never split or truncated: one wider than the whole line prints
whole on its own line and runs past the edge (the printer wraps it), because a
cut amount is a wrong amount.

**Widths are code points of NFC text** (`textWidth`), not UTF-16 units, in
every builder: an emoji counts one column and a decomposed `é` is composed
first. That is exactly what the ESC/POS encoder writes — one CP850 byte per
code point, `?` for an unmappable one — so alignment holds on paper. A browser
may draw an emoji wider than one monospace cell in the HTML preview.

### Pictures

A `RasterImage` is `{ width, height, data }` in printer **dots** (8 per mm):
rows top to bottom, `Math.ceil(width / 8)` bytes each, MSB leftmost, 1 = black —
exactly `GS v 0`'s format, so the encoder copies it, in strips of at most 255
rows. Rasterise at `printableDotsFor(paperWidthMm)` for a full-width logo (576
dots on 80 mm, 384 on 58 mm) or smaller for a mark; neither encoder rescales.
In HTML the same bits become a 1-bit BMP `data:` URI (no canvas, no deflate, the
same code in Node and in a browser), sized at 12 dots per character so it takes
the width on screen it takes on paper, with `image-rendering: pixelated`.

### Getting a picture down to one bit (`./raster`)

A thermal head has one ink. **A 50 % threshold is the wrong default**: brand
colours are mostly light — an orange like `#ED7A1F` has a luma of 0.57 — so a
logo in one prints only its darkest details, or nothing.

```ts
import { rasterizeSvg, toMonochrome } from '@12-apps/thermal-printing/raster';
import { image, printableDotsFor } from '@12-apps/thermal-printing';

// A vector mark, drawn at the size it will print (12 mm = 96 dots):
const mark = toMonochrome(rasterizeSvg(markSvg, { width: 96 }));
// A bitmap logo the host decoded to RGBA at the dot width (canvas, sharp, …):
const logo = toMonochrome({ width, height, data: rgba });

lines.unshift(image(logo));
```

**The policy** (`mode: 'auto'`, the default):

- **Flat artwork** — a few solid colours, which is what a logo or a mark is — is
  **thresholded at luma 0.75**. What an owner sees: an orange, red, blue or
  green logo prints as a crisp black silhouette with its white details knocked
  out; a pale tint (light yellow, pastel, light grey — luma 0.75 and up)
  disappears. Show them the preview (`rasterToDataUri`) before paper does.
- **A photograph** — many colours — is **dithered** (Atkinson; Floyd–Steinberg
  on request), so tone becomes dot density. An orange area comes out as a fine
  pattern of about 40 % black, not solid black.
- A transparent pixel is paper. The result's `method` says which branch ran.

`mode: 'threshold' | 'dither'`, `threshold` and `kernel` override the choice.

**Why the SVG rasteriser is a small one.** The full-fidelity options are native
modules (`resvg-js`, `sharp`: a binary per platform and nothing in a browser) or
a WebAssembly build (megabytes, and an async init) — in a package that has no
dependencies at all. What a one-colour printer reproduces is flat fills, and a
mark drawn for one plate is flat fills by construction, so `rasterizeSvg` draws
exactly that, anti-aliased: `path` (every command), `rect` (rounded), `circle`,
`ellipse`, `polygon`, `polyline`, `g`, `transform`, `fill`, `fill-rule`,
`fill-opacity`, `opacity`, `viewBox` and `preserveAspectRatio` (meet or none).
Whatever it does not draw — strokes, gradients, text, `<image>`, `<use>`,
clipping, masks, filters, `<style>` — it **names** in `unsupported`, so a host
can refuse the file or rasterise it itself and come in at `toMonochrome`.
Decoding PNG/JPEG is deliberately left to the host, which already has a codec.

**An uploaded SVG is untrusted input**, so every cost it can ask for is capped,
and a document over any cap is **refused** — a 0 × 0 result with the reason in
`unsupported` — never thrown on and never allocated:

| limit | value | reason in `unsupported` |
|---|---|---|
| source length, `MAX_SVG_LENGTH` | 256 000 characters | `too large` |
| output, `MAX_RASTER_WIDTH` × `MAX_RASTER_HEIGHT` | 576 × 2048 dots (checked before allocating, including a height derived from the viewBox) | `output too large` |
| shapes, `MAX_SHAPES` | 4096 | `too many shapes` |
| flattened vertices, `MAX_PATH_POINTS` | 250 000 | `too many path points` |
| scan-conversion work, `MAX_FILL_WORK` | 50 000 000 units, **estimated from the edges before any row is filled** (edge sub-rows × log₂ edges, plus 5 per bounding-box pixel — an upper bound on the real work) | `too complex to fill` |

The document is read by a hand-written linear scanner (no backtracking regular
expressions, so no crafted comment, attribute or number can make parsing
polynomial), and each shape is composited only across the pixels it covers on
each row. `toMonochrome` checks its input too: a buffer that is not exactly
`width × height × 4` bytes, or dimensions past 576 × 2048, throw a `RangeError`
before anything is allocated — those dimensions are the host's own choice after
decoding, so a mismatch is a caller bug rather than something an upload reaches.

## Finding a printer nobody wrote the address of down

A settings screen asking a shop owner for an IP address is asking a fair
question of a network engineer and an unfair one of somebody selling lunch: the
address was handed out by a router they have never logged into, to a device with
no screen. `./discovery` sweeps the local network for devices listening on the
printing port and grades what it finds.

**An open port proves nothing about the device.** A print spooler, a second
server or an unrelated appliance may all answer on 9100. So the probe asks a
real ESC/POS question once connected — `DLE EOT 1`, real-time status, which
prints nothing and is safe to send to a non-printer — and grades a device that
answers `confirmed` against one that merely opened the port, `candidate`.
Silence is never taken as evidence AGAINST a printer, because a good deal of
this hardware does not implement status at all. Nothing picks for the operator:
every candidate is returned, and the test page is still the only proof.

**A browser cannot do any of this**, which is what `./discovery/bridge` is for.
An HTTPS page may not fetch `http://192.168.0.50` — mixed content — and even
over plaintext Chrome's Private Network Access rules demand a preflight that a
printer on :9100 could never answer. Loopback is the one exemption: `127.0.0.1`
is *potentially trustworthy*, so a helper running on the merchant's own machine
can hold the scan and hand the answer to the tab.

That server is reachable by every page the merchant has open, so it binds
loopback only, answers **only the origins it was started with**, and exits on a
TTL. The origin allowlist is the real control — browsers set `Origin`
themselves and a page cannot forge it — and the TTL bounds the window it has to
be wrong in. Without both, this is a port scanner any website could aim at a
shop's network. `runFinder` therefore **refuses to start with no origin**:
there is no safe default, so there is no default.

### Packaging the helper

`./discovery/cli` is a function, not a binary, because this package publishes
TypeScript source and a host's distribution is its own. A branded build bundles
`main()` with esbuild and wraps it for each platform, baking its own origin in
through `PRINTER_FINDER_ORIGINS` so a merchant double-clicks an icon rather than
typing a flag:

```bash
esbuild --bundle --platform=node --format=cjs --outfile=finder.cjs \
  --banner:js='process.env.PRINTER_FINDER_ORIGINS ||= "https://admin.example.com"' \
  your-entry.cjs
```

**A binary needs signing to be usable by the people it is for.** An unsigned
`.exe` meets Windows SmartScreen's "unrecognized app" wall and an unnotarized
`.app` is refused outright by Gatekeeper — for a shop owner, either is where
this feature ends. That is a certificate and a release pipeline, not code.

## The three things that are easy to get wrong

**The code page.** A printer does not speak UTF-8 — it prints the glyph at each
byte. Sending an accented word as UTF-8 puts two characters where one belongs,
on every printer, looking exactly like a font problem. `./escpos` selects CP850
and maps the Latin-script characters a ticket carries; anything outside the
table loses its diacritic before it falls back to `?`, because a word somebody
can still read beats a `?` mid-word.

**"Sent" is not "printed".** There is no protocol above a raw `:9100` socket: no
handshake, no acknowledgement, no status frame. An empty roll, a jam, and a
perfect ticket are the same success — and `window.print()` returns when the
dialog is dismissed, which is no better. A host that reports "printed" is making
a promise the transport never made. Give the operator a reprint instead.

**A destination that owns a printer is answered by it or by nothing.** Switching
one room's printer off must stop that room's tickets, not quietly reroute them
somewhere else — a ticket coming out in the wrong room is one nobody in that
room ever sees. `./routing` keeps inactive printers in the map precisely so that
"no printer here" and "the printer here is off" stay different answers.

## Adoption

See [ADOPTING.md](./ADOPTING.md).
