# @12-apps/onboarding

Reusable, resumable, per-user×tenant **onboarding progress** for guided setup
flows — one small system any app/page can adopt.

- **Persists exactly which step a user stopped on** and an opaque per-feature
  payload, so a refresh resumes them where they left off (not the start).
- **Persistence-agnostic**: the UI + hook talk to an injected `OnboardingStore`,
  so you back it with Prisma server actions, tRPC, REST, or anything.
- Ships a **Prisma helper** (`createOnboardingRepository`) for the common case,
  and a **`GuidedSection`** UI that binds the state to `@12-apps/ui`'s
  `SectionOnboarding` + stepper.

Both halves ship here (12-23): the screens AND the endpoints they persist
through, one factory each. **[ADOPTING.md](./ADOPTING.md) is the adoption
contract** — the config table, the wiring rules that bite, and the Phase B notes
for a host that already has the table.

## Exports

| Entry | Export | What |
|---|---|---|
| `.` | `OnboardingProvider` / `useOnboarding` | Client state, mutations through an injected `OnboardingStore`. |
| `.` | `GuidedSection` | Landing hero → per-step wizard (stepper) → completed summary, driven by the persisted state. |
| `.` | `createOnboardingApiStore` / `fetchOnboardingState` | The store bound to the package's OWN endpoints, so the URL, the body shape and the date revival are stated once instead of in every host. |
| `.` | types | `OnboardingStore`, `OnboardingStateSnapshot`, `GuidedStep`, `GuidedNav`, … |
| `./server` | `createApiOnboarding({ db })` | The progress surface as framework-neutral route descriptors — `GET` and `PATCH` with `save` / `dismiss` / `reset`. |
| `./server` | `createOnboardingRepository(getPrisma)` | The Prisma read/write helper under it (data-merge + started/completed stamping). |
| `./hono` | `onboardingRouter({ db, resolveActor })` | The same surface as a mountable Hono router. `hono` is an OPTIONAL peer. |
| `prisma/` | `onboarding.prisma` + its migration | The package OWNS the `OnboardingState` model — a host syncs it (below) rather than retyping it. |

## The data model comes with the package

Do not copy the model into your schema by hand. Use Prisma's multi-file schema
folder and sync the package's own partial into it — a byte-for-byte COPY, never a
symlink (a symlinked migration is silently skipped by Prisma):

```bash
node node_modules/@12-apps/onboarding/scripts/sync-onboarding-schema.mjs prisma/schema
```

The migration ships in `prisma/migrations/`, and every statement in it is guarded
— so a host that ALREADY has `onboarding_states` applies it as a no-op, with no
`prisma migrate resolve` dance. See ADOPTING.md.

## Wiring

```ts
// server: one mount. The host keeps only who is calling, and where data lives.
const onboarding = onboardingRouter({
  db: async () => (await getPrismaClient()) as unknown as OnboardingPrisma,
  featureKeys: ['ai_integration'],
  resolveActor: (c) => resolveActorFor(c), // → { userId, clientId } | null
});
app.route('/api/admin/:tenantSlug', onboarding.router);

// browser: the package's own store, against those endpoints
const store = createOnboardingApiStore({ apiBase, featureKey: 'ai_integration' });
const initial = await fetchOnboardingState({ apiBase, featureKey: 'ai_integration' });

<OnboardingProvider featureKey="ai_integration" store={store} initialState={initial}>
  <GuidedSection steps={steps} title="…" configuredSummary={…} />
</OnboardingProvider>
```

A host whose persistence is NOT these routes (localStorage, tRPC, server actions)
still passes its own `OnboardingStore` — that seam is unchanged.
