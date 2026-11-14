# Adopting @12-apps/messaging

The engine supplies the mechanism; the host answers what only it knows. Below
is what a host binds, in the order it binds it.

## 1. The database

The manifest's `db` capability is `composed`: copy `prisma/messaging.prisma`
into the host's multi-file schema folder (never a symlink) and apply
`prisma/migrations/20261114120000_messaging_connector` with the host's own
migrations. The partial names no host table: `tenant_id` and `staff_user_id`
are by-value strings with no foreign key. A host that declares domains per
table places the four tables (`messaging_connections`,
`messaging_inbox_deliveries`, `messaging_conversations`,
`messaging_messages`) in one domain of its own.

The host's links to its own world (a cart minted by a conversation, a matched
customer, the sale it led to) go in HOST tables keyed by the conversation id,
never in these.

## 2. The engine and its ports (`MessagingEngineConfig`)

| port | type | what the host answers |
|---|---|---|
| `store` | `MessagingStore` | `createPrismaMessagingStore(prisma)` over the client generated from a schema that includes the partial (structural: the delegates `messagingConnection`, `messagingInboxDelivery`, `messagingConversation`, `messagingMessage`). `createMemoryMessagingStore()` for tests. |
| `adapters` | `readonly ChannelAdapter[]` | One per channel: `createWhatsAppAdapter({ appSecret, verifyToken, graph: { fetch, baseUrl, apiVersion } })`. The app secret and verify token are read where the host keeps secrets; an empty one refuses every delivery or handshake. |
| `secrets` | `{ seal(plain); open(sealed) }` | Seal and open a connection's credential with the host's key (sync or async). `open` THROWS on a blob that will not open. |
| `enqueue` | `{ enqueue(name, payload, { dedupeKey? }) }` | The wiring `JobsEnqueuePort`. Never throws. The engine queues only `messaging.process-delivery` (`{ deliveryId }`, dedupe key `messaging.process-delivery:<deliveryId>`). |
| `clock` | `{ now(): Date }` | What time it is. |
| `logger` | `{ info, warn, error }` | The wiring `LoggerPort`; bind the `messaging` namespace's logger. Never handed a credential. |
| `hooks.onInboundMessage` | OPTIONAL. `({ conversation, message }) => Promise<void>` | A contact's message was stored: hand it to the host's agent or a person's inbox. Once per message, never for a redelivery, never for an opt-out. Keep it short (enqueue the host's own job): a throw is logged and not retried. Default: nothing. |
| `hooks.reopenState` | OPTIONAL. `(conversation) => "AGENT" \| "HUMAN" \| "CLOSED"` | The state a `CLOSED` or `OPTED_OUT` conversation re-opens into when its contact writes again. Default `AGENT`. |
| `retentionMs` | OPTIONAL, default 12 h | How long text is kept after a conversation's last message. |
| `retentionBatchSize`, `reconcileBatchSize`, `maxDeliveryAttempts`, `reconcileAfterMs` | OPTIONAL | 500, 50, 5, 2 minutes. |

## 3. The wiring capabilities

```ts
import { messagingManifest } from "@12-apps/messaging/manifest";
import { messagingServerManifest } from "@12-apps/messaging/manifest/server";

host.adoptServer({
  manifest: messagingManifest,
  server: messagingServerManifest,
  bindings: {
    http: { mountPath: "/api", config: { engine, logger } },
    jobs: { deps: { engine } },
  },
});
```

- **`http`** — `GET` and `POST /webhooks/messaging/:channel`, both `kind:
  "webhook"` (public: the channel authenticates by signature, per delivery).
  Mounted at `/api`, WhatsApp's callback URL is
  `/api/webhooks/messaging/whatsapp`. ONE URL per channel, for every tenant:
  the tenant is resolved from the event's account, not the path — state that
  routing exception wherever the host documents its webhook layout. The host's
  adapter must populate `request.request` (the raw fetch `Request`): the
  signature is over the raw bytes.
- **`jobs`** — `messaging.process-delivery` (on demand, 5 attempts),
  `messaging.reconcile-inbox` (every 5 minutes) and `messaging.retention`
  (every 10 minutes), the two sweeps on the single-flight `sweeps` queue with
  a lease. A host with no worker processes nothing, so it should not adopt the
  connector.
- **`db`** — section 1. **`observability`** — the `messaging` namespace.

Declined by the package, with the argument in `.wiring-conformance.json`:
`permissions` (no authenticated route ships yet; the host gates its own
connect and conversation routes), `notifications` (the host tells people
through `onInboundMessage`), `mcp` (conversations and phone numbers are off the
agent surface by design: a host must not put them back on it), `email`, the
environment, `e2e` and the web capabilities.

## 4. Connecting a WhatsApp number (Embedded Signup)

The browser half is Meta's SDK popup; it returns a `code`. The server half:

```ts
import { exchangeSignupCode, readSignupAccounts, subscribeAppToWaba } from "@12-apps/messaging/whatsapp";

const { accessToken } = await exchangeSignupCode(graph, { appId, appSecret, code });
const [account] = await readSignupAccounts(graph, { appId, appSecret, accessToken });
const [number] = account.phoneNumbers;
await subscribeAppToWaba(graph, { wabaId: account.wabaId, accessToken });
await engine.connect({
  tenantId,
  channel: "whatsapp",
  externalAccountId: number.id,
  externalParentId: account.wabaId,
  displayAddress: number.displayPhoneNumber,
  credential: accessToken, // sealed by the engine; never returned
});
```

`connect` refuses (`MessagingConnectError`, `ACCOUNT_TAKEN`) a number another
tenant holds, connected or in error; only a number its tenant revoked
(`engine.revoke`) can be connected elsewhere. `engine.markError` records a
token the channel rejects.

## 5. What the host calls on the engine

| call | when |
|---|---|
| `send({ tenantId, conversationId, content, author })` | The agent's or a person's reply. Catch `MessagingSendError` and read `code`: `OPTED_OUT`, `WINDOW_CLOSED`, `NOT_CONNECTED`, `NOT_FOUND`, `UNKNOWN_CHANNEL`, `CHANNEL_FAILED` (the row is `FAILED`; `messageId` names it). The sentence a person reads is the host's copy. |
| `setState(tenantId, conversationId, "AGENT" \| "HUMAN" \| "CLOSED")` | A hand-off. Returns null for an opted-out conversation: only the contact re-opens it. |
| `setSummary(tenantId, conversationId, summary)` | Replace the structured summary that outlives the text. Structured fields only, never free text. |
| `setTranscript(tenantId, messageId, text)` | An audio message's transcript. Deleted with the text. |
| `getConversation`, `listMessages`, `listConnections` | The host's own screens. No call returns a credential. |
| `revoke`, `markError` | Disconnecting a number, or recording a token Meta rejects. |

## 6. What stays the host's

Every sentence a person reads; who may connect a number or reply (the host's
permissions in front of its own routes); the agent behind `onInboundMessage`;
matching a contact to the host's own customer record; plan gates and usage
metering; and the links from a conversation to anything the host sells.
