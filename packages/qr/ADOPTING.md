# Adopting @12-apps/qr

A **leaf library**, not a plugin. It has no manifest, no routes, no tables and no
env: you call a function and get bytes back. Adopting it is an import and a
delete, and the delete is the point — this package exists because two hosts had
already written the same PDF writer twice, and the parts they got right are the
parts nobody can verify without a print run.

## The standardized surfaces

| Surface | Export | What the host does |
|---|---|---|
| **Print** | `@12-apps/qr/pdf` | `buildQrStickerPdf({ stickers, size, layout, brandName, title, date, creator })` → `Uint8Array`. Pure: no clock, no locale, no DOM. |
| **Scan** | `@12-apps/qr/scan` | `useQrCamera(active, onText)` → `{ videoRef, fault, live }`, plus `createQrDecoder()` if you drive your own loop. React is an optional-shaped peer; the pdf half never resolves it. |
| **Prisma** | — | **None, deliberately.** This package owns no tables. What a code POINTS AT is the host's; a partial here would make every adopter take a migration for rows it does not have. |
| **Wiring manifest** | — | **None, deliberately.** There is no wireable seam: nothing to mount, nothing to schedule, nothing to configure. It is a function. Recorded as an argued exemption in `.wiring-conformance.json` rather than as debt. |

## Host wiring rules (the ones that bite)

1. **The address on the sticker is the decision you cannot undo.** It gets
   laminated. **Derive it; never let it be typed, and never read it off
   `window.location`.** The browser's origin is whichever host the BACKOFFICE
   happened to be open on, which is not where the storefront answers, and a text
   field is a second unvalidated place to state something the product already
   decides — a store's verified domain when it has one, the deployment's own
   storefront host otherwise. Both are facts the server knows and can serve
   alongside the rest of the store. This package takes the finished URL and has
   no way to tell a good one from a bad one, so the derivation is yours; a
   warning next to an editable field is not a substitute for it.

2. **Ask for the size in millimetres, not pixels.** That is the unit the
   conversation with a gráfica happens in, and `STICKER_SIZES` deliberately ships
   dimensions with **no labels** — naming them is host copy, in the host's
   languages.

3. **`priceLine` is already formatted.** Currency, separators and placement are
   locale facts. Pass the string you would render on screen. And say at your call
   site what this package cannot: a price change means a reprint.

4. **Count the stickers before you download.** An operator who selected 12
   products and chose "one per variation" is about to get 48 pages. State the
   number in the dialog — the expansion is the host's rule, so the honesty about
   it has to be too.

5. **Do not re-decide the print constants.** Bleed, quiet zone, error correction
   and K-only black are not options, because each one is a failure you find at the
   print shop rather than in review. If you need a different *layout*, compose the
   exported operators (`mm`, `rect`, `line`, `text`, `buildPdf`) rather than
   forking the sticker — that keeps the invisible half shared.

6. **The viewfinder is yours, and so are the five fault sentences.** The package
   deliberately ships no UI and no copy for the scan half — see the README. What it
   does own is every path that turns the lens OFF: unmount, `active` going false,
   a failure part-way through `getUserMedia`, and the stream that arrives after
   somebody already closed the sheet. Do not re-implement teardown around it.

7. **Write the parser the hook refuses to.** A decoded string is untrusted input.
   Reduce it to ids you trust before routing, and give every rejection the same
   answer — a hostile sticker must not be distinguishable from a torn one.

## Migrating off a local copy

If your repo already has a hand-rolled version of this (the shape is a
`pdf-doc.ts` plus a `qr-sticker-*.ts` beside it):

1. Replace the imports with `@12-apps/qr/pdf`.
2. **Move your copy's strings out of the builder.** The local versions tend to
   read size labels straight from a copy module; here they are the host's, so the
   dialog owns them.
3. `brandName: ""` if you do not print one — the store line is then omitted and
   the code takes the room back.
4. Delete the local files. Keep any test that asserted a *host* rule (which URL
   goes on the laminate); the print-mechanics tests are this package's now.

## What it does not do

- **No on-screen QR.** Use `react-qr-code` or similar for the preview. This is
  the print path, at error correction H; a preview at M is fine and different.
- **No upload, no download, no filename.** It returns bytes. Where they go is a
  host concern, and the browser dance for it is three lines you already have.
- **No general PDF.** See the README's last section.
