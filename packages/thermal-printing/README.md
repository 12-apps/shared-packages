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

`./net` sits behind its own subpath so that importing the encoders into a
browser bundle never drags `node:net` in.

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
