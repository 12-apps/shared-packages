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
| `prisma/` | `chat.prisma` (`ChatThread`, `ChatMessage`, `ChatReadMarker`) plus its migration. `pnpm --filter @12-apps/chat prisma:sync` copies the partial into a host schema folder. |

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
});
```

All of this belongs to the host: the write window, which role a caller holds,
the labels, and the quick replies' words. The package owns the rest:
- the role's content rules;
- the contact-info filter, which also reads the host's dodge-words;
- the per-author rate limit;
- what a message looks like on the wire.

## The screen

```tsx
const { ChatThread } = createWebChat({ fetch: credentialedFetch, copy: EN_US_CHAT_UI_COPY, formatTime });
<ChatThread endpoint={`/api/jobs/${id}/chat`} refreshSignal={liveTick} onUnreadChange={setBadge} />
```

`createNativeChat` takes the same config. Both surfaces draw the thread from
`@12-apps/ui` primitives using only their cross-platform props, so a React
Native bundle resolves each primitive to its native twin through ui's
`react-native` export condition. Only the composer differs per platform.

The package opens no socket. Bump `refreshSignal` when your live channel says
the thread moved.

## Copy

Every sentence is required config, with no defaults. `PT_BR_*` and `EN_US_*`
packs ship for the routes (`CHAT_SERVER_COPY`) and the screen
(`CHAT_UI_COPY`); pass one by hand. Role labels are part of the role config,
so every surface shows the same name for a role.
