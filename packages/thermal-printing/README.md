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
| `@12-apps/thermal-printing` | The line model — `TicketLine`, `columnsFor`, `wrap`, `line`, `centered`, `rule`, `field`, `PAPER_WIDTHS_MM`. Pure, isomorphic. |
| `…/escpos` | `encodeTicket(lines)` → `Uint8Array`. Initialise, CP850, align, emphasise, double height, feed, partial cut. |
| `…/html` | `renderTicketHtml(lines, paperWidthMm, lang?)` → a standalone document sized in `ch`, with `@page { margin: 0 }`. |
| `…/net` | `sendToNetworkPrinter(host, port, bytes, options?)`. Node-only (`node:net`), never throws, structured failures. |
| `…/routing` | `printerRoute(printers)` / `printerFor(route, destinationId)` — per-destination with a default, generic over your own printer rows. |
| `…/discovery` | `scanForPrinters(options?)` / `probePrinter(host, port?)` — find the address nobody wrote down. Node-only. |
| `…/discovery/bridge` | `startDiscoveryBridge({ allowedOrigins })` — a loopback server an HTTPS page may call to run that scan. Node-only. |
| `…/electron` | `printHtml({ html, deviceName, session? })` — an offscreen window, a silent print to a named device (or the default), destroyed after. A refusal rejects with `PrintRefusedError` (`reason: string \| null`, never a sentence). `electron` is an optional peer. |
| `…/discovery/cli` | `runFinder({ allowedOrigins })` / `main(argv, env)` — the helper a merchant downloads, as a function to bundle. Node-only. |

`./net` and `./discovery` sit behind their own subpaths so that importing the
encoders into a browser bundle never drags `node:net` in, and `./electron`
behind its own so that nothing else ever imports `electron`.

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
