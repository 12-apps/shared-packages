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

## Exports

| Export | What |
|--------|------|
| `OnboardingProvider` / `useOnboarding` | Client state, mutations through an injected `OnboardingStore`. |
| `GuidedSection` | Landing hero → per-step wizard (stepper) → completed summary, driven by the persisted state. |
| `createOnboardingRepository(getPrisma)` | Optional Prisma read/write helper (data-merge + started/completed stamping). |
| types | `OnboardingStore`, `OnboardingStateSnapshot`, `GuidedStep`, `GuidedNav`, … |

## Required data model (Prisma consumers)

Add this model to your schema (column names are what `createOnboardingRepository`
expects via the `userId_clientId_featureKey` composite key):

```prisma
model OnboardingState {
  id          String    @id @default(uuid())
  userId      String    @map("user_id")
  clientId    String    @map("client_id")   // tenant
  featureKey  String    @map("feature_key")
  status      String    @default("not_started") // not_started|in_progress|completed|dismissed
  step        String?
  data        Json      @default("{}")
  startedAt   DateTime? @map("started_at")
  completedAt DateTime? @map("completed_at")
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  @@unique([userId, clientId, featureKey])
  @@index([clientId, featureKey, status])
  @@map("onboarding_states")
}
```

## Wiring (Next server actions example)

```ts
// repository (server): bind the factory to your Prisma client
export const { getOnboardingState, upsertOnboardingState, listOnboardingByStatus } =
  createOnboardingRepository(async () => (await getPrismaClient()) as unknown as OnboardingPrisma);

// store (client): implement OnboardingStore over your server actions
export function makeOnboardingStore(tenantSlug: string, featureKey: string): OnboardingStore { … }

// page: compute initial state on the server, inject the store on the client
<OnboardingProvider featureKey="ai_integration" store={store} initialState={initial}>
  <GuidedSection steps={steps} title="…" configuredSummary={…} />
</OnboardingProvider>
```
