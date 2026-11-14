# @12-apps/messaging

A channel-agnostic conversational messaging connector. A tenant connects an
account on a messaging channel (a WhatsApp number today); the people who write
to it become **conversations**; what they write is stored, handed to the host,
and answered through the same channel. Each channel is an **adapter**; the
engine knows no channel.

WhatsApp Cloud API is the first adapter, at `@12-apps/messaging/whatsapp`.
E-mail, a chat workspace or any other channel joins later as one more object
of the same shape.

How a host adopts it: [ADOPTING.md](./ADOPTING.md).

## What the engine holds

| | |
|---|---|
| **Connections** | One row per account a tenant connected (`messaging_connections`). The channel's account id (WhatsApp's `phone_number_id`) is UNIQUE across tenants: an inbound event names the account, and the account names exactly one tenant. The credential (a business token) is SEALED through the host's encryption port; the package never sees a key, and never returns or logs the credential. Status `CONNECTED`, `REVOKED` or `ERROR`. |
| **The inbox** | Every verified delivery, raw, stored BEFORE the 200 (`messaging_inbox_deliveries`), unique on the SHA-256 of its body — a channel with no per-delivery id redelivers the same bytes. Processing state `PENDING` / `PROCESSED` / `FAILED`, attempts, the error. |
| **Conversations** | One per `(tenant, channel, contact)` (`messaging_conversations`). Owner state `AGENT` / `HUMAN` / `CLOSED` / `OPTED_OUT`, `lastInboundAt` (the service window counts from it), `lastMessageAt`, and a structured `summary` (JSON) with `summaryUpdatedAt`, which OUTLIVES the text. |
| **Messages** | Both directions (`messaging_messages`): kind (`TEXT`, `INTERACTIVE`, `AUDIO`, `OTHER`), body, an interactive message's choices, transcript, the channel's id (UNIQUE per channel: a redelivered message is a no-op), delivery status with one timestamp per receipt, and the author (`CONTACT`, `AGENT`, or `STAFF` with an optional staff user id). |

Host-specific links — a cart, a service mode, a customer record, the sale a
conversation led to — are NOT here. The host keeps them in its own tables,
keyed by the conversation id.

## The pipeline

```
POST /webhooks/messaging/:channel
  ├─ unknown channel ............................ 404
  ├─ signature over the RAW bytes fails ......... 401, nothing stored (fail closed)
  ├─ store the raw body (dedupe on its hash) .... 500 if the store fails, so the channel redelivers
  └─ 200, and queue messaging.process-delivery

messaging.process-delivery (a job)
  ├─ parse the stored bytes through the channel's adapter
  ├─ per event, resolve the tenant: the event's account against the connections
  │    unknown, revoked or in error ............. dropped (the edge already said 200)
  ├─ message  → create or re-open the conversation, update lastInboundAt,
  │             store the message (a known channel id is a no-op),
  │             then the host's onInboundMessage({ conversation, message })
  ├─ status   → stamp the outbound row's receipt once; the status only moves forward.
  │             A receipt that finds no message yet (it raced the sender storing
  │             the channel's id) settles the delivery FAILED: the sweep retries it
  └─ opt-out  → OPTED_OUT (a keyword message is stored; the hook is not called)
```

The tenant is never taken from the URL: a channel like WhatsApp posts every
connected account's events to the one callback configured on the app.

**Opt-out.** On WhatsApp, a message that is exactly `PARAR`, `SAIR`, `STOP` or
`CANCELAR` — case- and accent-insensitive, ignoring punctuation and emoji
around it ("PARAR.", "Parar!") — opts the contact out, as does Meta's own
`user_preferences` stop signal. "parar de enviar" does not. A message the
contact SENDS after the opt-out re-opens the conversation, in `AGENT` unless
the host's `reopenState` hook says otherwise (it may not answer `OPTED_OUT`).
The comparison is on the message's own time (`optedOutAt`), never on when it
was processed: a message sent before the opt-out and processed after it (a
retried job, the reconciliation sweep) is stored but does not re-open the
conversation and does not reach the host's hook. Every state change is a
compare-and-set against what was read, so two workers, or a staff hand-off,
racing an opt-out cannot undo it. No staff action can move a conversation out
of `OPTED_OUT`.

**Sending.** `engine.send` refuses (typed `MessagingSendError`, nothing
recorded) an `OPTED_OUT` conversation, a send the channel's policy refuses
(WhatsApp: free-form only within 24 hours of the contact's last message;
`WINDOW_CLOSED` at 24 h exactly and after), and a connection that is not
connected. Otherwise it records the outbound row `PENDING` BEFORE calling the
channel, then stores the channel's id (`ACCEPTED`), or marks the row `FAILED`
with the channel's error and throws `CHANNEL_FAILED`. Two limits of the channel
boundary, not of the package: an opt-out that lands while a send is already in
flight cannot recall it (the check runs before the call), and a `FAILED` row is
not proof the message was not delivered (a timeout, or an answer with no
message id, can follow a delivery Meta did make), so a host that retries a
`CHANNEL_FAILED` send may send twice. Templates (the only way to speak outside
the window) are a later story.

**Retention.** A conversation's text lives only while the conversation does:
12 hours (configurable) after its LAST message, every message's body, choices
and transcript are deleted. The conversation, its state and its summary stay.
The `messaging.retention` job finds due conversations with one indexed query
across every tenant, never a walk over tenants.

The raw webhook bodies (Meta's whole payload: the text, the phone number, the
profile name) go with it: the same sweep DELETES the inbox rows received before
the cutoff that are `PROCESSED`, and the `FAILED` ones that used up their
attempts, in batches through the `(state, received_at)` index. A row still
awaiting a retry keeps its bytes until it is processed or out of attempts —
minutes, not days. Dedupe survives, because it rests on the message row's
`(channel, external_id)`: a redelivery after the purge is a duplicate.

## The channel adapter

```ts
interface ChannelAdapter {
  readonly kind: string;                                   // "whatsapp"
  handshake(query): { ok: true; challenge } | { ok: false } | null;
  verify({ rawBody, header }): boolean;                    // fail closed
  parse(rawBody): NormalizedEvent[];                       // message | status | opt_out
  send({ credential, accountId, to, content }): Promise<{ externalId }>;
  readonly policy: SendPolicy;                             // when free-form sends are allowed
}
```

`NormalizedEvent` carries the channel account the event belongs to
(`accountId`), so tenant resolution is the engine's and the same for every
channel. `OutboundContent` is `TEXT`, `BUTTONS` or `LIST`; an adapter maps it
to its wire. `serviceWindowPolicy(ms)` and `OPEN_SEND_POLICY` cover the two
policies known so far.

## Subpaths

| subpath | what |
|---|---|
| `@12-apps/messaging` | `createMessagingEngine`, the ports, the store port with `createPrismaMessagingStore` and `createMemoryMessagingStore`, the adapter interface, the errors, the types. |
| `@12-apps/messaging/whatsapp` | `createWhatsAppAdapter`, and standalone: `verifyMetaSignature`, `verifyMetaSubscription`, `parseWhatsAppPayload`, `parseWhatsAppStatuses`, `isOptOutText`, the Graph sender, and the Embedded Signup helpers `exchangeSignupCode`, `readSignupAccounts`, `subscribeAppToWaba`. |
| `@12-apps/messaging/server` | `createApiMessaging` (the webhook route pair, in `@12-apps/wiring`'s `WireRoute` shape) and `MESSAGING_JOBS`. |
| `@12-apps/messaging/manifest`, `/manifest/server` | The wiring manifests. |

The signature check and the receipt parser are exported on their own because a
host that sends WhatsApp messages some other way (a platform notification
number) needs exactly those two and nothing else.

## Tests

`src/**/__tests__`, vitest. The pipeline, the sender and the retention sweep
run over recorded WhatsApp Cloud payloads (`src/__tests__/fixtures.ts`). One
store contract runs over the memory store and over the Prisma store on PGlite
with the shipped migration (`store-contract.test.ts`), so the double cannot
drift from Postgres. The manifest suite runs the wiring producer assertions
and an adoption by a real wiring host.
