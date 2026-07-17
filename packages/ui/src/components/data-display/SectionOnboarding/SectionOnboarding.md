# SectionOnboarding Component

**Purpose:** Per-section onboarding wrapper. One configurable page section renders three ways depending on a `status`, so a first-time user meets a friendly hero + CTA instead of a wall of empty fields, while a returning user sees a compact "it's connected" summary with the form tucked behind an "Editar" toggle.

Composes the existing [`EmptyState`](../EmptyState/EmptyState.md) (the hero) and [`Stepper`](../Stepper/Stepper.md) (the progress preview). Drop it onto any settings/integration page and drive it from whatever "is this configured?" signal the feature already has (a `null` config, a `status` field, a row count) — no new query needed.

```ts
type SectionOnboardingStatus = 'unconfigured' | 'in-progress' | 'configured';

interface SectionOnboardingProps {
  status: SectionOnboardingStatus;
  title: string;
  description?: string;
  illustration?: React.ReactNode;
  steps?: Step[];                 // reuses Stepper's Step type
  activeStepId?: string;
  completedStepIds?: string[];
  primaryAction?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
  helpLink?: { label: string; href: string; external?: boolean };
  configuredTitle?: string;
  configuredSummary?: React.ReactNode;
  editLabel?: string;            // default 'Editar'
  collapseLabel?: string;        // default 'Ocultar'
  defaultExpanded?: boolean;     // default false
  children?: React.ReactNode;    // the real form / advanced controls
  className?: string;
  dataTestId?: string;
}
```

## The three states

| `status`        | What renders                                                                 |
|-----------------|------------------------------------------------------------------------------|
| `unconfigured`  | Optional step preview + `EmptyState` hero (title, description, illustration, CTA). **No form.** |
| `in-progress`   | Live `Stepper` (activeStepId / completedStepIds) + `children` (the form).     |
| `configured`    | Compact success summary (`configuredSummary`) + an **Editar** toggle that reveals `children`. |

### Self-managed reveal (zero-wrapper adoption)

When `status` is `unconfigured` and you pass **`children` but no `primaryAction`**, the hero
renders a built-in CTA (label from `startLabel`, default `'Começar'`) that reveals the form in
place — the root's `data-status` flips to `started`. This means a **server** page can adopt
onboarding by passing `status` + the form as children, with no client wrapper of its own. Pass a
custom `primaryAction` only when the button should do something else (e.g. route to a wizard),
which disables the built-in reveal.

## Deciding the status (server side)

The point is to compute `status` from data you already have — e.g. for the payments page:

```tsx
const config = await getMaskedPaymentConfig(tenant.id);

const status =
  config === null            ? 'unconfigured'
  : config.status !== 'VERIFIED' || !config.enabled ? 'in-progress'
  : 'configured';

<SectionOnboarding
  status={status}
  title="Receba pagamentos na sua loja"
  description="Conecte sua conta PagBank para vender por PIX e cartão."
  steps={[
    { id: 'connect', label: 'Conectar conta' },
    { id: 'homolog', label: 'Homologar' },
    { id: 'activate', label: 'Ativar vendas' },
  ]}
  primaryAction={{ label: 'Começar configuração', onClick: startSetup }}
  configuredSummary={<Chip label="Ativo — Produção" color="success" size="small" />}
>
  <PaymentIntegrationForm … />
</SectionOnboarding>
```

**Note:** `SectionOnboarding` is a client component (`'use client'`) because the configured state manages a reveal toggle. Compute `status` in the server component and pass it down; wire `primaryAction.onClick` from a small client wrapper.

**A11y**

- The edit toggle exposes `aria-expanded`.
- The success indicator icon is `aria-hidden`; the heading carries the meaning.
- The hero inherits `EmptyState`'s `role="region"` + `aria-labelledby`.

## Testing

### Test IDs

If `dataTestId` is provided it becomes the prefix; otherwise `section-onboarding` is the default.

| Element | Default Test ID |
|---------|----------------|
| Root (carries `data-status`) | `section-onboarding` |
| Step preview / progress | `section-onboarding-steps` |
| Hero (unconfigured) | `section-onboarding-hero` (+ EmptyState sub-ids) |
| Configured summary row | `section-onboarding-summary` |
| Edit/collapse toggle | `section-onboarding-edit-toggle` |
| Revealed content wrapper | `section-onboarding-content` |

### Common scenarios

- **Unconfigured** shows the hero + CTA and does **not** render the form.
- **In-progress** shows steps **and** the form together.
- **Configured** hides the form behind the toggle (`aria-expanded` flips on click); `defaultExpanded` starts it open.
- **No `steps`** → no stepper preview, hero still renders.
- **No `children`** in configured → no edit toggle offered.

See `SectionOnboarding.test.stories.tsx` for the interaction tests covering each.
