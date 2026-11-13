# @12-apps/fiscal

Brazilian consumption-tax machinery and fiscal documents for any host that
sells: the **IBS/CBS engine**, the neutral sale document, the fiscal service
over sped-nfe, and the **fiscal document module** that issues through it.

| subpath | what it is |
|---|---|
| `@12-apps/fiscal/engine` | `computeTax(input) → TaxBreakdown`: pure, no I/O, no clock, no defaults. Plus `computeTaxWithOracle` over an injected `OfficialCalculator` port, and `compareBreakdowns`. |
| `@12-apps/fiscal/tables/<file>.json` | Versioned rate tables — DATA, never code. The engine stamps the table's `version` on every result. |
| `@12-apps/fiscal/documents` | The fiscal document: its state machine, the emitter profile and issuing points, the ports a host implements (store, storage, cipher, sale source), the signing identity, the per-series number draw (`FISCAL_NEXT_NUMBER_SQL`), the engine-to-document line mapping and `createFiscalDocuments`, the service. |
| `@12-apps/fiscal/issuer` | The Issuer port and its first adapter, `createSidecarIssuer`, over the fiscal service's HTTP contract. |
| `@12-apps/fiscal/danfe` | The DANFE NFC-e as ESC/POS-ready lines for 58 and 80 mm; `./danfe/pt-BR` carries the Manual's own words. |
| `@12-apps/fiscal/http`, `/jobs`, `/notifications` | The wiring capabilities: the routes, the job blueprints, the notification blueprints over host copy. |
| `@12-apps/fiscal/manifest` | The `@12-apps/wiring` manifest: permissions, db, observability, `server: ["http", "jobs"]` (`./manifest/server`). |
| `@12-apps/fiscal/sale` | `SaleForDocument`, the neutral document shape: one sale, host-agnostic, as the fiscal service accepts it. Types only; its JSON schema is `@12-apps/fiscal/sidecar/schema/sale-for-document.schema.json`. |
| `@12-apps/fiscal/sidecar` | The fiscal service's wire contract: each endpoint's request and answer, and the error classes (`REJECTED`, `RETRYABLE`, `CONTINGENCY`, `AUTH`, `INVALID`). |
| `sidecar/` (folder) | The fiscal service itself: PHP over sped-nfe, stateless, with its `Dockerfile` (images pinned by digest). Issues, signs offline, transmits, cancels, looks up and inutilizes NF-e and NFC-e. See [sidecar/README.md](./sidecar/README.md). |

## The engine

```ts
import { computeTax } from "@12-apps/fiscal/engine";
import tables from "@12-apps/fiscal/tables/ibs-cbs-2026-11-13.json" with { type: "json" };

const breakdown = computeTax({
  lines: [
    {
      id: "item-1",
      valueCents: 3990, // what the buyer pays for the line, after its allocated discount
      quantity: 1, // qCom, at most four decimals
      foodAndDrink: true,
      taxClass: { cClassTrib: "200047", cstIbsCbs: "200", regimeEspecifico: "BARES_RESTAURANTES", reductionBp: 0 },
    },
  ],
  seller: { regime: "REGIME_REGULAR", regimeEffectiveFrom: "2026-01-01", restaurantRegime: true },
  destinationIbge: "3550308", // the establishment, or for a delivered good the place of delivery
  exclusions: { serviceCharge: null, retainedIntermediation: null },
  tables,
  supplyDate: "2026-11-20", // the local day of the supply, in the seller's clock
});
// breakdown.lines[i]: one NF-e item each — valueCents (vProd), taxBaseCents (vBC),
//   cbsRateBp/cbsCents, ibsUfRateBp/ibsUfCents, ibsMunRateBp/ibsMunCents, reductionBp,
//   taxCents, netValueCents (vProdLiq) and netUnitValue (vUnComLiq), the class snapshot
// breakdown: the sums, netValueCents (vProdLiqTot), gorjetaExcludedCents,
//   intermediationExcludedCents, treatment, informative, provisional, taxInsidePrice,
//   tablesVersion
```

Money is integer cents, rates integer basis points, dates `YYYY-MM-DD`. Any
value the engine cannot read — a missing object, an `undefined` where `null` is
required, a malformed table — is refused with a `FiscalEngineError` carrying a
`code`; nothing is defaulted.

### What a host passes as a line's value

Always **the price the buyer pays for the line** (all units, after the line's
share of an unconditional discount). The engine decides from the rate table
whether the tax is inside it:

- **A period with `taxInsidePrice: false` (2026).** The value is the base:
  `vBC = value`, each tax is `vBC × rate`, and `netValueCents` /
  `netUnitValue` are `null` — the tax is not part of `vProd` yet.
- **A period with `taxInsidePrice: true` (2027 on, where the IBS/CBS compose
  `vProd`).** The value is tax-inclusive. The engine takes the taxes out: `vBC`
  is the largest whole-cent base whose rounded taxes, added back, fit inside
  the value; each tax is rounded on that `vBC`; `netValueCents` (`vProdLiq`) is
  the value less the taxes, so `vProdLiq + Σ tax = vProd` to the cent; and
  `netUnitValue` (`vUnComLiq`, reais with ten decimals) times the quantity is
  within the layout's ±0,01 of `vProdLiq` (rule I11c-20). The price never
  changes; the tax is a share of it.

### The rules it applies (LC 214/2025)

- **Rates by the date of the supply**, from the table's period covering it:
  2026 CBS 0.9% and IBS 0.1% (arts. 343, 346), informative (art. 348 §1);
  2027–2028 IBS 0.05% state + 0.05% municipal (art. 344); later years the
  reference rates the table carries. A period whose figures are not yet law is
  `status: "ESTIMATE"` and stamps its results `provisional: true`.
- **Destination** (art. 11 I): a state's or municipality's own rate where the
  table lists one (`byUf`, `byMunicipality`), the reference rate elsewhere.
- **Regimes** (art. 41): regime regular and the Simples híbrido → `FULL`;
  Simples inside the DAS → `INFORMATIVE`, carrying the figures a regime store
  would show and no amount "por fora"; MEI and não contribuinte → `NONE`, zero
  and not informative. In 2026 the test rates are not applied to Simples
  optants (art. 348 III "c"), read from the period's `appliesToSimplesNacional`.
- **Bares e restaurantes**: in a store with `restaurantRegime`, a line whose
  class is `BARES_RESTAURANTES` (prepared food, non-alcoholic drinks prepared
  on the premises — art. 273; official class 200047) takes the table's 40%
  reduction (art. 275); alcohol and resale carry `regimeEspecifico: null` and
  the full rate (art. 273 §2). Outside the special regime a class's own
  `reductionBp` applies (a cesta-básica zero rate is a 100% reduction).
- **Exclusions**, restaurant regime only (art. 274 par. único), each
  **segregated as its own item** with no tax (RCBS art. 399 §2; without the
  segregation the base is the full value, §4), under the table's
  `exclusionClasses`:
  - the service charge, when passed in full to the staff AND at most 15% of
    the food and drink (I): one item, class 410019. Above 15%, or kept by the
    store, nothing is excluded — the WHOLE charge is a taxed item under the
    class the host passes. There is no partial exclusion.
  - what a platform retained for delivery and intermediation (II): one item,
    class 410020, passed as `retainedIntermediation` and NOT inside any line's
    value. No goods line's base moves for it. Outside the restaurant regime it
    is refused: there the amount belongs in the lines.
- **Rounding**: per item, per tax, to whole cents, **half-even** — what the
  official calculator does (R$ 5,00 × 0,9% = 0,045 → 0,04), never a floor; the
  reduction applies to the rate before the product is rounded, and every order
  figure is the sum of its rounded items. The effective rate (`pAliqEfet`) is
  not output: the product is computed exactly from the nominal rate and the
  reduction, which equals `vBC × pAliqEfet` for any whole-percent reduction —
  every reduction in the official table (V0066) is one: 30, 40, 50, 60, 70, 80
  or 100%.

### The oracle mode

`computeTaxWithOracle(input, calculator)` takes the same input and asks an
`OfficialCalculator` port for each taxed item's rates, reduction and taxes; the
regime, the exclusions and the bases stay the engine's (in a tax-inside-price
period the base is taken out with the table's rates, since the calculator
takes a base). A host points the port at the official calculator's HTTP API.
The package's suite replays REAL recorded calculator answers for 2026
(`src/engine/__tests__/fixtures/calculator/`, version and date in
`recording.json`) and asserts `compareBreakdowns` finds nothing. The
calculator has no rates for 2027 and later yet, so those years' goldens are
the engine's own estimates, marked `provisional`.

## The fiscal documents

```ts
import { createFiscalDocuments, createPrismaFiscalStore, createSigningIdentities } from "@12-apps/fiscal/documents";
import { createSidecarIssuer } from "@12-apps/fiscal/issuer";

const documents = createFiscalDocuments({
  store: createPrismaFiscalStore({ prisma }), // the package's own store: the host passes its Prisma client

  issuer: createSidecarIssuer({ baseUrl: "http://fiscal-sidecar:8080", fetch, timeoutMs: 90_000 }),
  signing: createSigningIdentities({ cipher }),
  cipher,                // the host's { encrypt, decrypt }: certificate, password and CSC at rest
  readCertificate,       // the host's: an A1's expiry, or a throw when it does not open
  storage,               // where the XMLs live
  sales,                 // SaleSource: the host's sale as a SaleDraft (`documentLines` maps the engine's breakdown)
  notify,                // the host's notifier (never throws)
  now: () => new Date(),
  utcOffset: (ownerId, at) => "-03:00",
  reasons: { contingency, inutilization, substitution }, // host words SEFAZ receives, 15–255 chars
  staleAfterMs: 5 * 60_000,          // the base of the backoff
  nfceOnlineToleranceMs: 5 * 60_000, // SEFAZ's late-dhEmi limit (704), the state's
  newId: () => crypto.randomUUID(),
});
await documents.issue({ ownerId, subjectId, issuingPointId, model: "NFCE" });
```

**One document is one number.** The state machine (`transition`) is pure:

```
PENDING ─SUBMIT→ SUBMITTED ─AUTHORIZE→ AUTHORIZED ─CANCEL→ CANCELLED
                     ├─DENY→ DENIED   ├─REJECT→ REJECTED   └─RETRY→ SUBMITTED
PENDING | SUBMITTED ─REPLACE→ REPLACED
PENDING ─SIGN_OFFLINE→ CONTINGENCY ─AUTHORIZE | DENY | REJECT | RETRY→ …
```

Every step yields an event carrying the fiscal service's raw answer, with any
secret-named key scrubbed. `CANCELLED` is reached only from `AUTHORIZED`, and
nothing leaves `REJECTED`, `DENIED`, `REPLACED` or `CANCELLED` for `AUTHORIZED`
(a property suite walks random sequences).

- **The counters are the package's, and so is their store.**
  `createPrismaFiscalStore({ prisma })` runs over the host's Prisma client
  (raw SQL on the package's migration); a host keeps no counter and writes no
  numbering transaction. A counter is keyed by the issuer's CNPJ, the model
  and the series, as SEFAZ numbers (one CNPJ can serve several owners); a
  series belongs to one issuing point. A number is drawn in the same
  transaction as the document's insert (`FISCAL_NEXT_NUMBER_SQL`), so a failed
  write gives it back.
- **One live document per subject.** The partial unique index
  `fiscal_documents_live_subject_key` refuses a second live document for an
  (owner, subject, model); `issue()` answers the existing one when a
  concurrent call won.
- **Going offline is a second document, in one transaction.** When the
  service answers `CONTINGENCY` for an NFC-e at a point with a contingency
  series — or the sweep finds an online NFC-e past `nfceOnlineToleranceMs`,
  which SEFAZ would refuse as late — the sale is numbered on that series AND
  the online document is `REPLACED` in the same transaction, before anything
  is signed. Signing follows (`tpEmis = 9`); the `transmit-contingency` job
  sends it, and warns at 20 hours (the deadline is 24). Offline, the paper is
  ONE copy, the consumer's.
- **Every number SEFAZ never used is settled.** `numberVoid` says what is
  owed: a lookup first when a send went unanswered (`outcomeUnknown` is
  sticky until a definitive answer or a lookup clears it — the package
  computes every access key, so a lookup is always possible), the NFC-e
  cancel BY SUBSTITUTION (event 110112, naming the contingency twin) when
  SEFAZ authorised it after all, an inutilization otherwise; `DENIED` when
  the lookup finds it denied (the denial spent it).
- **A rejected contingency NFC-e is never voided.** The buyer holds its
  DANFE: it stays `REJECTED` with SEFAZ's code, the store corrects the sale,
  and `resendContingency` signs it again under the same series, number and
  key code (`POST …/resend`), with the corrected sale's totals. A correction
  that changes the total or the buyer's document — what the DANFE the buyer
  holds prints and its QR encodes — is refused (`RESEND_CHANGES_PRINTED_FIELDS`):
  that sale needs a new note, issued by a person.
- **An authorised document always has its XML.** A lookup that finds a
  SUBMITTED document authorised joins the signed XML the service returned to
  the lookup's `protNFe`; without both, the document stays SUBMITTED (its
  protocol kept, so it never goes offline) and the sweep sends the same call
  again, which the service settles with the XML. A REPLACED number that was
  ever SUBMITTED is always looked up before it is voided.
- **Nothing is retried silently.** Each failed step counts (`failures`) and
  backs off (`nextAttemptAt`, doubling to 64 × `staleAfterMs`); the queues
  are ordered by the next attempt, so a failing row never pins their head. A
  refusal SEFAZ will repeat (241, 256, 501, a certificate refused), or
  `MAX_FAILURES` in a row, hands the document to a person (`attention`, the
  `fiscal.document-needs-attention` notification); `POST …/release` gives it
  back to the sweep.
- **What the classes mean here.** `REJECTED`, `INVALID` and `INTERNAL` reject
  (the same call fails again); `RETRYABLE`, `AUTH` and a `CONTINGENCY` with no
  offline path retry, with the same number and key code.
- **Who signs** is the profile's `signingIdentity`: `STORE_CERTIFICATE` (the
  store's A1, decrypted for one call) or `PLATFORM`, declared and answering
  `NOT_SUPPORTED` until FUT-2229 q4 says how the platform signs.
- **Secrets** are encrypted through the host's cipher on arrival, decrypted by
  the signing identity for one call, and never stored in clear, logged,
  answered or put in an error. The CSC's id and token are saved together or
  not at all.

**Not in this release** (FUT-4717): an offline register signing on a block of
the contingency series reserved in advance, recording what it signed, and
voiding the known rest of a finished block. The port it will build on is
declared, unimplemented: `ContingencyBlockSource`.

NFS-e is not covered: only the platform's own NFS-e is planned (FUT-2242).

## The DANFE NFC-e

`renderDanfeNfce({ xml, paperWidth: 58 | 80, labels })` reads the authorised
XML (or the signed XML of a document issued offline, which prints the
"EMITIDA EM CONTINGÊNCIA" variant) and answers lines in the Manual do DANFE
NFC-e's divisions I–VIII: the issuer, the title, every item, the totals and
payments, the fiscal message and the key, the consumer, the number and
protocol, and the QR code (a line carrying `qrCode`, for the host to
rasterise). Each line is `{ text, align, emphasis }`, the shape
`@12-apps/thermal-printing` encodes, at 32 or 48 columns.

## The manifest

`@12-apps/fiscal/manifest` declares the permissions `fiscal:read`,
`fiscal:manage`, `fiscal:issue` and `fiscal:cancel`, here and nowhere else;
the Prisma partial `prisma/fiscal.prisma` and its migrations; the `fiscal`
observability namespace; and `server: ["http", "jobs"]`:

| route (under the host's mount) | permission |
|---|---|
| `GET /fiscal/profile`, `GET /fiscal/issuing-points` | `fiscal:read` |
| `PUT /fiscal/profile`, `PUT /fiscal/profile/certificate`, `POST /fiscal/issuing-points` | `fiscal:manage` |
| `POST /fiscal/documents` | `fiscal:issue` |
| `GET /fiscal/documents/:documentId`, `POST …/lookup`, `GET …/danfe?paper=58\|80` (AUTHORIZED or CONTINGENCY only; 409 otherwise) | `fiscal:read` |
| `POST /fiscal/documents/:documentId/cancel` | `fiscal:cancel` |
| `POST /fiscal/documents/:documentId/resend` (a rejected contingency NFC-e), `POST …/release` (back from a person) | `fiscal:issue` |

The jobs are `fiscal.sweep` and `fiscal.transmit-contingency` (every five
minutes, a 30-minute lease and a batch sized so the worst run ends inside it) and `fiscal.certificate-expiry` (daily, telling owners on the
30th, 15th, 7th, 3rd and last day, and daily once expired). The alerts (certificate expiring, document rejected)
and the other two (needs attention, contingency deadline) ship as
`createFiscalNotificationBlueprints(copy)`, over the host's words. The
settings screen and the documents list (`web: ["surface"]`) come with their
screen tickets; `.wiring-conformance.json` argues each capability not
declared.

The RBAC bullet of the host's tax docs (which still places the four
permissions in the host's catalog) is corrected in the host's pull request that
bumps `@12-apps/fiscal`, not here.
