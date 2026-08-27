# Adopting @12-apps/thermal-printing

This package is a **plug-and-play printing plugin**: one library, reusable
across repositories, exposing standardized surfaces. A host points at those
surfaces; when the library updates, every host updates with no app changes.

## The standardized plugin surfaces

| Surface | Export | What the host does |
|---|---|---|
| **Core** | `@12-apps/thermal-printing` | Nothing to wire — the line model, the column table, the wrapper, the field/rule builders. Isomorphic: a browser composing a preview reads the same widths the server encodes. |
| **ESC/POS** | `…/escpos` | `encodeTicket(lines)`. No configuration: the command set is the universally implemented core and the code page is CP850. |
| **HTML** | `…/html` | `renderTicketHtml(lines, paperWidthMm, lang)`. Hand the string to a tab that prints it. |
| **Socket** | `…/net` | `sendToNetworkPrinter(host, port, bytes)`. Node-only; behind its own subpath so a browser bundle never resolves `node:net`. |
| **Routing** | `…/routing` | `printerFor(printerRoute(rows), destinationId)`. Generic over your rows — pass them straight in. |
| **Prisma** | — none | This package owns **no models**. Printers and print jobs are host tables; see below. |

## The one thing you must build yourself, and why

**The layout.** The package deliberately does not compose your ticket, and that
is not an omission to be fixed later.

What a ticket says is a product decision that is wrong for every host but the
one it was written for: which line is the headline, whether an item's quantity
leads or trails, whether a total is printed at all, which fields are dropped on
a 32-column roll. And *how* it says it is worse — the currency, the time zone,
the date format and every label are the host's, in the host's language, and a
package that shipped them would be shipping one product's vocabulary to
everybody.

So the host writes a function from its own domain object to `TicketLine[]`,
using the builders here for the arithmetic:

```ts
import { centered, columnsFor, field, line, rule, wrap } from '@12-apps/thermal-printing';

export function layoutTicket(order: Order, paperWidthMm: number): TicketLine[] {
  const columns = columnsFor(paperWidthMm);
  const lines = [centered(order.storeName, 'bold'), centered(`#${order.reference}`)];

  lines.push(rule(columns), line(headline(order), 'double'), rule(columns));
  for (const item of order.items) {
    // Quantity leads and the wrap indents past it, so a wrapped item still
    // reads as one thing.
    const indent = String(item.quantity).length + 2;
    lines.push(...wrap(`${item.quantity}x ${item.name}`, columns, indent).map((t) => line(t, 'bold')));
  }
  lines.push(rule(columns), ...field(copy.total, money(order.totalCents), columns));
  return lines;
}
```

Then pick an encoder by how the printer is attached — same lines either way:

```ts
import { encodeTicket } from '@12-apps/thermal-printing/escpos';
import { renderTicketHtml } from '@12-apps/thermal-printing/html';
import { sendToNetworkPrinter } from '@12-apps/thermal-printing/net';

const lines = layoutTicket(order, printer.paperWidthMm);

if (printer.transport === 'NETWORK') {
  const result = await sendToNetworkPrinter(printer.host, printer.port, encodeTicket(lines));
  if (!result.ok) await recordFailure(job, sayIt(result));   // ← your words
} else {
  await queueForTheBrowser(job, renderTicketHtml(lines, printer.paperWidthMm, 'pt-BR'));
}
```

## Host wiring rules (the ones that bite)

1. **Map `reason` to your own copy, and do not print the raw `detail`.** The
   failure is `{ reason, target, detail? }`. `reason` is one of `unreachable`,
   `connection-error`, `write-failed` — three cases because they send an
   operator to three different places, and a host that collapses them tells
   somebody to check a cable that is fine. `detail` is Node's own message: fine
   for a log, not for a screen, and never localized.

2. **Never report "printed".** Neither transport can tell you the paper came
   out. Record what you know — the bytes were sent, or the document reached the
   OS — and give the operator a reprint. An auto-print with no reprint is an
   order that silently never reached anybody.

3. **Store the ticket, not a reference to the order.** Paper is a snapshot of
   what was true when it was queued. A job that waited while somebody edited the
   order must print what was ordered, so freeze the `TicketLine[]` (or the
   domain snapshot you build them from) into the job row rather than
   re-deriving it at send time.

4. **A local printer stops when the tab does, and the settings screen must say
   so.** There is no way around this and no way to detect it server-side. State
   it in the printer's own words where somebody configures it, or the first
   quiet evening is a mystery.

5. **`printerFor` returning `null` is a normal answer.** A host that configured
   one destination's printer and no default genuinely does not print the rest.
   Say so; do not fall back to an arbitrary device.

6. **Enforce the paper width you store.** `columnsFor` falls back to the wider
   roll rather than throwing, which keeps an unknown width printable — but that
   makes it a poor validator. Build your schema and your database CHECK from
   `PAPER_WIDTHS_MM` so the two cannot drift.

## Why there is no Prisma partial

Printers and print jobs are host tables, and their columns are host decisions:
what a destination *is* (a kitchen section, a floor, a department), whether a
job is deduplicated and on what key, how many attempts it gets. The package
would have to guess all three, and a wrong guess is a migration every adopter
pays for.

What it does give you is the shape of the row it reads — `RoutablePrinter` is
`{ id, destinationId, active }` and nothing else, so your own rows satisfy it
with no mapping layer.

One rule worth carrying across, whatever your schema: **one printer per
destination needs two partial unique indexes**, not one. `NULL` is not equal to
itself in a UNIQUE index, so a single index over `(scope, destination_id)`
leaves the default — the destination most hosts actually use — as the one that
can be configured twice.

```sql
CREATE UNIQUE INDEX printers_one_per_destination
  ON printers (scope_id, destination_id) WHERE destination_id IS NOT NULL;
CREATE UNIQUE INDEX printers_one_default
  ON printers (scope_id) WHERE destination_id IS NULL;
```
