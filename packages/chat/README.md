# @12-apps/chat

Conversation threads between the parties to one piece of work, where each
party is known to the others **only by its role's label**. No person id, name
or contact detail crosses the wire. Mount the routes once per audience, and the
same thread screen renders in a web SPA and in a React Native app.

## What is in the box

| subpath | what |
|---|---|
| `./server` | `createApiChat(config) → { routes }`: framework-neutral `GET /`, `POST /messages`, `POST /read`. `createChatReads` gives unread badges for the host's own lists. |
| `./client` | `createChatClient` and `useChatThread`, both platform-free: for a host drawing its own UI. |
| `./react` | `createWebChat(config) → { ChatThread }`: the web surface. |
| `./native` | `createNativeChat(config) → { ChatThread }`: the React Native surface. |
| `./manifest*` | wiring manifests for the server, web and native runtimes. |
| `prisma/` | `chat.prisma` (`ChatThread`, `ChatMessage`, `ChatReadMarker`) plus its migrations. `pnpm --filter @12-apps/chat prisma:sync` copies the partial into a host schema folder. |

## The host decides who is in a thread

```ts
const { routes } = createApiChat({
  db: () => getPrismaClient(),
  authorize: async (request) => {
    // Is this caller a party to the thread the URL names? Under which role?
    // May that role still write? Answer null for "no such thread for you" (404).
    return { tenantId, threadKey: `job:${request.params.id}`, role: "client",
             authorId: user.id, readerId: user.id, canWrite: true };
  },
  roles: {
    client: { label: "Client", shared: false, maxLength: 500, freeText: true,
              blockContact: [], quickReplies: [], rateLimit: { max: 20, windowMs: 60_000 } },
    agent:  { label: "Agent", shared: false, maxLength: 160, freeText: true,
              blockContact: ["phone", "email", "url", "handle"],
              quickReplies: [{ key: "arrived", text: "I have arrived." }],
              rateLimit: { max: 6, windowMs: 60_000 } },
    team:   { label: "Team", shared: true, maxLength: 1000, freeText: true,
              blockContact: [], quickReplies: [], rateLimit: { max: 30, windowMs: 60_000 } },
  },
  copy: EN_US_CHAT_SERVER_COPY,          // or a per-request resolver
  contactVocabulary: { numberWords: { nine: "9" }, atWords: ["at"] },
  onMessage: async (event) => { /* notify, publish a live hint */ },
  onRefused: async (event) => { /* who keeps trying to pass contact info */ },
  onError: (error, { hook }) => logger.error(`chat ${hook} failed`, error),
});
```

`db` may return the client or a promise of it. `onMessage` and `onRefused`
run in the background: the send answers without waiting for a push
provider, and a hook that throws or rejects is reported to `onError`, never
to the sender.

All of this belongs to the host: the write window, which role a caller holds,
the labels, and the quick replies' words. The package owns the rest:
- the role's content rules;
- the contact-info filter, which also reads the host's dodge-words;
- the per-author rate limit;
- what a message looks like on the wire.

### The wire

Every 2xx answers `{ data }`: `GET /` gives `{ thread, messages, unread }`,
`POST /messages` gives `{ message }` (201), and `POST /read` gives
`{ unread }`. A refusal answers `{ error, message }`, where `error` is the
package's code (`contact_info`, `closed`, `rate_limited`, …) and `message` is
the host's sentence. No person id ever crosses it: authors show only as their
role's label.

`POST /read` takes `{ upTo }`, the `createdAt` of the newest message the
reader was actually shown. The marker never moves backwards and never past
now, so a message that arrived after the screen loaded stays unread. Reading
never creates a thread row; the first message does.

### The contact filter

It reads the text after Unicode normalisation: full-width and other-script
digits, invisible characters, look-alike Cyrillic and Greek letters, a
bidi-reversed run, and spelled-out digits from the host's
`contactVocabulary`. A phone number is 8 digits within any 16 characters,
whatever separates them. Clock times, amounts after a currency symbol, and
spans matching the host's `neutralPatterns` (address units like
`apto 1204`, at most 4 digits each) are set aside first, so an address with
an apartment number passes; a set-aside span still counts as at least one
digit. An amount is set aside only when it is a price as a courier writes
one, at most four integer digits (`85,90`, `1.250,00`), so `$54321`,
`$98765,43` and `$8.765.432` are not. A CEP, a full date, or a
five-digit street number before a unit is refused; that is the documented
price.

Across messages it reads only a contiguous chain: the same author's recent
free text (`contactLookback`, default the last 12 messages within 10
minutes) joins the draft while each message ends where the next begins with
a digit, a dot or an at-sign. A number trickled one digit per message is
one number; `Apto 1204` followed by `Chego 19:30` is two lines. One author's
sends to a thread are checked one at a time in each process, so parallel
requests cannot pass the rule against each other's absence (several
replicas can still interleave). Bidi controls are removed before a message
is stored, so the screen shows what the filter read.

Every attempt spends a rate-limit slot, including a refused one, so probing
the filter runs out of attempts. It is a deterrent, not a guarantee: a
person determined to pass a number can always find an encoding no filter
reads, and `onRefused` is how the host sees who keeps trying. Known misses,
each the price of letting an ordinary line through: a word between the
pieces of a number (`98765 e 4321`), a number of nine or ten digits split
by one address unit or one price (`98 765 ap 4321`, `9876 $5.432` — a
space inside the first group is exactly how a street number is written),
both pieces behind a unit or a price (`apto 98765 apto 4321`), a chain broken
by a message of something else, and a picture. A mobile with its area code
(eleven digits) cannot hide behind one span. A host that wants `arroba` to count
toward a social handle adds it to `extraPatterns`.

### Retention

Messages keep `author_id` for moderation, and the package ships no delete
or anonymise API: retention (LGPD, GDPR) is the host's. The
`chat_messages (tenant_id, created_at)` index is there for the host's sweep.
`created_at` comes from the app process's clock, and messages in the same
millisecond are ordered by id.

### Indexes for the host's own queries

`chat_threads (tenant_id, last_message_at)` (1.1.0, migration
`20261003120000_add_chat_thread_activity_index`) serves a host badge that
counts the threads with activity since a moment (`tenant_id = ? AND
last_message_at >= ?`). A host that copies the package's migrations picks it
up with its next sync; it is additive, so it needs no release choreography.

## The screen

```tsx
const { ChatThread } = createWebChat({ fetch: credentialedFetch, copy: EN_US_CHAT_UI_COPY, formatTime });
<ChatThread endpoint={`/api/jobs/${id}/chat`} refreshSignal={liveTick} onUnreadChange={setBadge} />
```

The thread marks itself read up to the newest message it showed, and
`onUnreadChange` then gets the server's remaining count (normally 0). Pass
`autoMarkRead={false}` to mount it hidden only for its unread count.

`autoMarkRead="visible"` is for a thread that may be mounted out of sight (the
lower half of a drawer): a load's unread messages wait until the message list
is on screen, and are marked read then; a load that finds unread while the
list is already on screen marks at once. On the web the list is watched with
an `IntersectionObserver` (on screen from its first pixel); a browser without
one marks at once, as `true` does. On native a mounted list counts as on
screen. A host testing in jsdom stubs `IntersectionObserver` to drive it.
A host drawing its own list with `useChatThread({ autoMarkRead: "visible" })`
reports it through `controls.onVisibleChange(visible)`.

A read-only thread (`canWrite: false`) with no messages shows only the closed
notice: no empty-thread invitation to write the first message, and no list.

Own messages and the others' are told apart by their surface, not only by the
label's colour: the reader's own bubbles are a tint of the theme's
`palette.primary.main` (8% in light mode, 16% in dark), the others' sit on
the paper surface. A bubble is at most 80% of the thread wide (and 60
characters, on the web).

Accessibility: the list is a polite live region (`aria-live` on the web,
`accessibilityLiveRegion` on native), so an arriving message is announced.
On the web a click on the send button hands focus back to the field, and the
role's `maxLength` sits on the `<input>` itself.

Layout:
- **Web:** the messages sit in ui's `ScrollArea` (up to 60% of the viewport
  tall), which keeps the newest in view. `ScrollArea` needs `ResizeObserver`,
  so a host testing in jsdom stubs it.
- **Native:** the thread is a ui `Screen` with keyboard avoidance and its own
  `ScrollView`. Mount it in a parent with a bounded height (a flex-1 view, or
  `Screen scroll={false}`), never inside another ScrollView. Pass
  `keyboardOffset` (dp) when a header sits above it.

`createNativeChat` takes the same config. Both surfaces draw the thread from
`@12-apps/ui` primitives using only their cross-platform props, so a React
Native bundle resolves each primitive to its native twin through ui's
`react-native` export condition. What differs per platform is a slot of the
internal `ChatPlatform`, the one place platform styling lives:

| slot | receives | web | native |
|---|---|---|---|
| `Frame` | the list and the writing area | a `Stack` | a keyboard-avoiding `Screen` |
| `MessageList` | the bubbles, `label`, `scrollKey`, `onVisibleChange?` | `ScrollArea` + `IntersectionObserver` | `ScrollView`, visible on mount |
| `Bubble` | `{ mine, children }` | ui `Box` with `sx` (tint, `min(80%, 60ch)`) | ui `Box` with `style` (tint, `80%`) |
| `Composer` | the controlled field and its send action | `Input` + Enter | `Input` + the keyboard's send key |

The package opens no socket. Bump `refreshSignal` when your live channel says
the thread moved.

## Copy

Every sentence is required config, with no defaults. `PT_BR_*` and `EN_US_*`
packs ship for the routes (`CHAT_SERVER_COPY`) and the screen
(`CHAT_UI_COPY`); pass one by hand. Role labels are part of the role config,
so every surface shows the same name for a role.
